import { UserError } from '../utils/errors.js';

export default {
  name: 'settings',
  category: 'Settings',
  description: 'Manage bot features',
  usage: 'settings [subcommand] [on|off]',
  role: 'owner',
  async execute(ctx) {
    const { settings, config, archive, users } = ctx.deps;
    const p = ctx.prefix;
    const [sub, arg] = ctx.args.map((a) => a.toLowerCase());

    // ── No subcommand: show full settings panel ───────────────────────────
    if (!sub || sub === 'status') {
      const delMode = settings.defaultArchiveMode;
      const botMode = settings.botMode ?? config.bot.mode;

      // Fetch statusreact pref for this owner
      const ownerUser = await users.get(ctx.sender.jid).catch(() => null);
      const statusReact = ownerUser?.prefs?.autoStatusReact === true;

      return ctx.reply([
        `╭─「 ⚙️ *Bot Settings* 」`,
        `│`,
        `│ 🗑️ *Deleted Messages*`,
        `│   • status: *${delMode === 'off' ? 'OFF' : `ON (${delMode})`}*`,
        `│   ${p}settings delete on|off`,
        `│`,
        `│ 🎨 *Sticker*`,
        `│   • status: *${settings.stickerEnabled ? 'ENABLED' : 'DISABLED'}*`,
        `│   ${p}settings sticker on|off`,
        `│`,
        `│ 👁️ *Auto View Status*`,
        `│   • status: *${settings.autoViewStatus ? 'ON' : 'OFF'}*`,
        `│   ${p}settings autoviewstatus on|off`,
        `│`,
        `│ ⌨️ *Typing Indicator*`,
        `│   • status: *${settings.typingIndicator ? 'ON' : 'OFF'}*`,
        `│   ${p}settings typing on|off`,
        `│`,
        `│ 💬 *Auto Status React*`,
        `│   • status: *${statusReact ? 'ON' : 'OFF'}*`,
        `│   ${p}settings statusreact on|off`,
        `│`,
        `│ 🔒 *Bot Mode*`,
        `│   • status: *${botMode}*`,
        `│   ${p}publ — public  |  ${p}priv — private`,
        `╰────────────────────`,
      ].join('\n'));
    }

    // ── Subcommands ───────────────────────────────────────────────────────
    if (sub === 'delete') {
      if (!['on', 'off'].includes(arg)) throw new UserError(`Usage: ${p}settings delete on|off`);
      if (arg === 'on') {
        if (!config.privacy.allowMediaCaching && !config.privacy.allowContentLogging) {
          throw new UserError('The operator has disabled both content and media logging.');
        }
        const mode = config.privacy.allowMediaCaching ? 'media' : 'full';
        try { await settings.setDefaultArchiveMode(mode); } catch (e) { throw new UserError(e.message); }
        return ctx.reply(`✅ Deleted message monitoring: *ON (${mode})*`);
      }
      await settings.setDefaultArchiveMode('off');
      await archive.disableAndWipe();
      return ctx.reply('✅ Deleted message monitoring: *OFF*. Cached data wiped.');
    }

    if (sub === 'sticker') {
      if (!['on', 'off'].includes(arg)) throw new UserError(`Usage: ${p}settings sticker on|off`);
      await settings.setStickerEnabled(arg === 'on');
      return ctx.reply(`✅ Sticker: *${arg === 'on' ? 'ENABLED' : 'DISABLED'}*`);
    }

    if (sub === 'autoviewstatus') {
      if (!['on', 'off'].includes(arg)) throw new UserError(`Usage: ${p}settings autoviewstatus on|off`);
      await settings.setAutoViewStatus(arg === 'on');
      return ctx.reply(`✅ Auto view status: *${arg === 'on' ? 'ON' : 'OFF'}*`);
    }

    if (sub === 'typing') {
      if (!['on', 'off'].includes(arg)) throw new UserError(`Usage: ${p}settings typing on|off`);
      await settings.setTypingIndicator(arg === 'on');
      return ctx.reply(`✅ Typing indicator: *${arg === 'on' ? 'ON' : 'OFF'}*`);
    }

    if (sub === 'statusreact') {
      if (!['on', 'off'].includes(arg)) throw new UserError(`Usage: ${p}settings statusreact on|off`);
      await users.setPref(ctx.sender.jid, 'autoStatusReact', arg === 'on');
      return ctx.reply(`✅ Auto status react: *${arg === 'on' ? 'ON' : 'OFF'}*`);
    }

    throw new UserError(`Usage: ${p}settings [delete|sticker|autoviewstatus|typing|statusreact] on|off`);
  },
};
