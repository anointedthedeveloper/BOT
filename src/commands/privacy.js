import { UserError } from '../utils/errors.js';
import { parseBool, parseRetentionDays } from '../utils/prefs.js';
import { canConfigureArchive } from '../services/archive.js';

export default {
  name: 'privacy',
  aliases: ['data'],
  category: 'Privacy & settings',
  description: 'Configure data retention and logging',
  usage: 'privacy [logging on|off | retention <days> | archive off|meta|full|media | export | purge]',
  open: true, // opt-outs must stay reachable even when the bot is in private mode
  details: [
    '*logging on|off* – allow or refuse capture of *your* message text in chats that someone archived.',
    '*retention <days>* – how long your saved items are kept (0 = until you delete them).',
    '*archive off|meta|full|media* – for THIS chat. meta = sender/time/type only; full = also text; media = also photos, videos, stickers, audio and documents (encrypted, size-limited, short-lived). Needed for deleted-message notices. Posts a visible notice. Owner only in groups; in a private chat only you or the owner can change it.',
    '*export* – send your saved data as a JSON file.',
    '*purge* – permanently delete everything stored about you ({p}privacy purge confirm).',
  ].join('\n'),
  async execute(ctx) {
    const [sub, arg] = ctx.args.map((a) => a.toLowerCase());
    const { users, items, chats, messageCache, mediaStore, archive, config, settings } = ctx.deps;
    const jid = ctx.sender.jid;
    const p = ctx.prefix;
    const chatKey = ctx.chatJids[0] ?? ctx.chatJid;

    if (!sub || sub === 'status') {
      const explicitMode = await chats.archiveMode(chatKey);
      const mode = explicitMode ?? settings.defaultArchiveMode;
      const counts = await Promise.all(['note', 'bookmark', 'saved'].map((t) => items.count(jid, t)));
      const prefs = ctx.user.prefs;
      return ctx.reply([
        '*Privacy status*',
        `• This chat archive: *${mode}*${mode === 'off' ? ' (nothing is recorded here)' : explicitMode === null ? ' (via the bot\'s current default)' : ''}`,
        `• Capture of my message text in archived chats: *${prefs.contentLogging && config.privacy.allowContentLogging ? 'allowed' : 'refused'}*${config.privacy.allowContentLogging ? '' : ' (disabled by the operator)'}`,
        `• Retention of my saved items: *${prefs.retentionDays ? `${prefs.retentionDays} days` : 'until I delete them'}*`,
        `• Stored: ${counts[0]} notes, ${counts[1]} bookmarks, ${counts[2]} saved messages`,
        `• Deleted-message cache lifetime: ${config.privacy.cacheTtlHours}h · Encryption at rest: ${ctx.deps.cipher.enabled ? 'on' : 'off'}`,
        '',
        `Options: ${p}help privacy`,
      ].join('\n'));
    }

    if (sub === 'logging') {
      if (!arg) throw new UserError(`Usage: ${p}privacy logging on|off`);
      const on = parseBool('logging', arg);
      await users.ensure(jid);
      await users.setPref(jid, 'contentLogging', on);
      return ctx.reply(on ? '✅ Your message text may be captured in chats where archiving is on.' : '🔒 Your message text will not be captured anymore. Only basic details can be recorded in archived chats.');
    }

    if (sub === 'retention') {
      if (!arg) throw new UserError(`Usage: ${p}privacy retention <days>`);
      const days = parseRetentionDays(arg, config.privacy.maxRetentionDays);
      await users.setPref(jid, 'retentionDays', days);
      return ctx.reply(days ? `✅ New saved items will be deleted after ${days} days. (Existing items keep their original schedule.)` : '✅ New saved items are kept until you delete them.');
    }

    if (sub === 'archive') {
      if (!['off', 'meta', 'full', 'media'].includes(arg)) throw new UserError(`Usage: ${p}privacy archive off|meta|full|media`);
      if (ctx.role === 'none') throw new UserError('Ask the bot owner to allow you before enabling archiving.');
      if (!canConfigureArchive({ isOwner: ctx.role === 'owner', isGroup: ctx.isGroup, senderCandidates: ctx.sender.candidates, chatJids: ctx.chatJids })) {
        throw new UserError(ctx.isGroup ? 'Only the bot owner can change archiving in a group.' : 'You can only change archiving for your own private chat with the bot.');
      }
      if ((arg === 'full' || arg === 'media') && !config.privacy.allowContentLogging) throw new UserError('Content logging is disabled by the operator; use "meta".');
      if (arg === 'media' && !config.privacy.allowMediaCaching) throw new UserError('Media caching is disabled by the operator; use "full" or "meta".');
      const notifyJid = ctx.isGroup || ctx.fromMe ? ctx.sender.jid : ctx.chatJid;
      const { removed } = await archive.setMode({ chatJid: chatKey, mode: arg, enabledBy: ctx.sender.jid, notifyJid });
      ctx.log.info({ mode: arg, removed }, 'archive mode changed');
      return ctx.reply(archive.noticeFor(arg, config.privacy.cacheTtlHours));
    }

    if (sub === 'export') {
      const data = { exportedAt: new Date().toISOString(), settings: ctx.user.prefs, items: await items.exportAll(jid) };
      return ctx.deps.client.sendMedia(ctx.chatJid, { kind: 'document', buffer: Buffer.from(JSON.stringify(data, null, 2)), mimetype: 'application/json', fileName: 'my-bot-data.json' }, { quoted: ctx.msg });
    }

    if (sub === 'purge') {
      if (arg !== 'confirm') return ctx.reply(`⚠️ This permanently deletes all your notes, bookmarks, saved messages and files, cached messages from you, and turns off archives you enabled.\nSend *${p}privacy purge confirm* to proceed.`);
      const mediaPaths = await items.deleteAllForUser(jid);
      await mediaStore.removeMany(mediaPaths);
      const cachedFiles = await messageCache.mediaPathsForSender(jid);
      const cached = await messageCache.deleteForSender(jid);
      await mediaStore.removeMany(cachedFiles);
      for (const chat of await chats.listArchivedBy(jid)) await archive.setMode({ chatJid: chat._id, mode: 'off', enabledBy: jid });
      await users.resetPrefs(jid);
      return ctx.reply(`🧹 Done. Removed ${mediaPaths.length} files and ${cached} cached messages along with your saved items.`);
    }

    throw new UserError(`Unknown option. Try ${p}help privacy`);
  },
};
