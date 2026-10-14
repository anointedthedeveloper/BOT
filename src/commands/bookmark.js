import { UserError } from '../utils/errors.js';
import { extractTags, truncate } from '../utils/text.js';
import { handleItemSubcommand } from './_items.js';

export default {
  name: 'bookmark',
  aliases: ['bm'],
  category: 'Saved content',
  description: 'Save a message reference',
  usage: 'bookmark [note] (reply to a message) | bookmark list | bookmark delete <#>',
  details: 'Reply to a message with {p}bookmark to store a reference plus a short excerpt (max 200 characters of text) and an optional note.\nUse {p}save instead to keep the full content or media.',
  async execute(ctx) {
    const [sub, ...rest] = ctx.args;
    if (sub && (await handleItemSubcommand(ctx, 'bookmark', sub.toLowerCase(), rest))) return;

    const { items, config } = ctx.deps;
    const q = ctx.quoted;
    if (!q) throw new UserError(`Reply to the message you want to bookmark, then send ${ctx.prefix}bookmark [note].`);
    if (q.info.viewOnce) throw new UserError('View-once messages cannot be bookmarked or saved.');
    if ((await items.count(ctx.sender.jid)) >= config.media.maxItemsPerUser) throw new UserError('You reached the item limit. Delete something first.');

    const note = ctx.argText.slice(0, 500);
    const item = await items.create(ctx.sender.jid, {
      type: 'bookmark',
      note,
      tags: extractTags(note),
      ref: { chatJid: ctx.chatJid, msgId: q.id, senderJid: q.participant ?? null, kind: q.info.kind, excerpt: truncate(q.info.text, 200) },
      retentionDays: ctx.user.prefs.retentionDays,
    });
    await ctx.reply(`🔖 Bookmarked as *#${item.seq}*.`);
  },
};
