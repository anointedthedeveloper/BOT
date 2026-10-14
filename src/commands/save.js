import { UserError } from '../utils/errors.js';
import { extractTags, formatBytes } from '../utils/text.js';
import { handleItemSubcommand } from './_items.js';

export default {
  name: 'save',
  aliases: ['saved'],
  category: 'Saved content',
  description: 'Save a message you replied to (text, image, video, audio, document)',
  usage: 'save [note] (reply to a message) | saved list | saved show <#> | saved delete <#>',
  details: 'Reply to a message with {p}save. Text and media you explicitly choose to save are stored for you only, and removed after your retention period ({p}privacy retention).\nView-once messages are refused.',
  async execute(ctx) {
    const [sub, ...rest] = ctx.args;
    if (sub && (await handleItemSubcommand(ctx, 'saved', sub.toLowerCase(), rest))) return;

    const { items, mediaStore, client, config } = ctx.deps;
    const q = ctx.quoted;
    if (!q) throw new UserError(`Reply to the message you want to save, then send ${ctx.prefix}save [note].`);
    if (q.info.viewOnce) throw new UserError('View-once messages cannot be saved. This bot honours WhatsApp\'s view-once protection.');
    if (q.info.kind === 'other' || q.info.kind === 'protocol') throw new UserError('That kind of message cannot be saved.');
    if ((await items.count(ctx.sender.jid)) >= config.media.maxItemsPerUser) throw new UserError('You reached the item limit. Delete something first.');

    let media = null;
    if (q.info.hasMedia) {
      if (q.info.size && q.info.size > config.media.maxBytes) {
        throw new UserError(`That file is ${formatBytes(q.info.size)}; the limit is ${formatBytes(config.media.maxBytes)}.`);
      }
      let buffer;
      try {
        buffer = await client.downloadMedia({ key: { remoteJid: ctx.chatJid, id: q.id, participant: q.participant ?? undefined, fromMe: false }, message: q.message });
      } catch (err) {
        ctx.log.warn({ err: err.message }, 'media download failed');
        throw new UserError('I could not download that media. It may have expired; ask for it to be sent again.');
      }
      if (buffer.length > config.media.maxBytes) throw new UserError(`That file is larger than ${formatBytes(config.media.maxBytes)}.`);
      const stored = await mediaStore.save(ctx.sender.jid, buffer);
      media = { kind: q.info.kind, mimetype: q.info.mimetype, fileName: q.info.fileName, size: stored.size, path: stored.path };
    }

    const note = ctx.argText.slice(0, 500);
    const item = await items.create(ctx.sender.jid, {
      type: 'saved',
      text: q.info.text,
      note,
      tags: extractTags(`${q.info.text} ${note}`),
      ref: { chatJid: ctx.chatJid, msgId: q.id, senderJid: q.participant ?? null, kind: q.info.kind, excerpt: '' },
      media,
      retentionDays: ctx.user.prefs.retentionDays,
    });
    await ctx.reply(`💾 Saved as *#${item.seq}* (${q.info.kind}${media ? `, ${formatBytes(media.size)}` : ''}).`);
  },
};
