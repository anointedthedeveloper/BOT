import { UserError } from '../utils/errors.js';

export default {
  name: 'settings',
  category: 'Settings',
  description: 'Manage bot features',
  usage: 'settings [delete on|off | sticker on|off | autoviewstatus on|off | typing on|off | statusreact on|off | status]',
  role: 'owner',
  details: [
    '{p}settings — compact overview of what\'s on.',
    '{p}settings delete on|off — same switch as {p}delete on|off.',
    '{p}settings sticker on|off — enable or disable the {p}sticker command.',
    '{p}settings autoviewstatus on|off — auto-read WhatsApp statuses.',
    '{p}settings typing on|off — show typing indicator before replies.',
    '{p}settings statusreact on|off — auto-react to WhatsApp statuses.',
    '{p}settings status — current values.',
  ].join('\n'),
  async execute(ctx) {
    const { settings, config, archive } = ctx.deps;
    const [sub, arg] = ctx.args.map((a) => a.toLowerCase());

    const summary = () => {
      const mode = settings.defaultArchiveMode;
      return [
        `• delete: *${mode === 'off' ? 'OFF' : `ON (${mode})`}*`,
        `• sticker: *${settings.stickerEnabled ? 'ENABLED' : 'DISABLED'}*`,
        `• autoviewstatus: *${settings.autoViewStatus ? 'ON' : 'OFF'}*`,
        `• typing: *${settings.typingIndicator ? 'ON' : 'OFF'}*`,
        `• statusreact: *${ctx.deps.users ? 'see ,settings statusreact' : 'N/A'}*`,
      ].join('\n');
    };

    if (!sub) {
      return ctx.reply([
        '*Settings*',
        summary(),
        '',
        `${ctx.prefix}settings delete on|off`,
        `${ctx.prefix}settings sticker on|off`,
        `${ctx.prefix}settings status`,
      ].join('\n'));
    }
    if (sub === 'status') {
      return ctx.reply(['*Current settings*', summary()].join('\n'));
    }
    if (sub === 'delete') {
      if (!['on', 'off'].includes(arg)) throw new UserError(`Usage: ${ctx.prefix}settings delete on|off`);
      if (arg === 'on') {
        if (!config.privacy.allowMediaCaching && !config.privacy.allowContentLogging) {
          throw new UserError('The operator has disabled both content and media logging, so there is nothing this can turn on.');
        }
        const mode = config.privacy.allowMediaCaching ? 'media' : 'full';
        try {
          await settings.setDefaultArchiveMode(mode);
        } catch (e) {
          throw new UserError(e.message);
        }
        return ctx.reply(`✅ delete: ON (${mode}).`);
      }
      await settings.setDefaultArchiveMode('off');
      await archive.disableAndWipe();
      return ctx.reply('✅ delete: OFF. Cached data wiped.');
    }
    if (sub === 'sticker') {
      if (!['on', 'off'].includes(arg)) throw new UserError(`Usage: ${ctx.prefix}settings sticker on|off`);
      await settings.setStickerEnabled(arg === 'on');
      return ctx.reply(`✅ sticker: ${arg === 'on' ? 'ENABLED' : 'DISABLED'}.`);
    }
    if (sub === 'autoviewstatus') {
      if (!['on', 'off'].includes(arg)) throw new UserError(`Usage: ${ctx.prefix}settings autoviewstatus on|off`);
      await settings.setAutoViewStatus(arg === 'on');
      return ctx.reply(`✅ autoviewstatus: ${arg === 'on' ? 'ON' : 'OFF'}.`);
    }
    if (sub === 'typing') {
      if (!['on', 'off'].includes(arg)) throw new UserError(`Usage: ${ctx.prefix}settings typing on|off`);
      await settings.setTypingIndicator(arg === 'on');
      return ctx.reply(`✅ typing indicator: ${arg === 'on' ? 'ON' : 'OFF'}.`);
    }
    if (sub === 'statusreact') {
      if (!['on', 'off'].includes(arg)) throw new UserError(`Usage: ${ctx.prefix}settings statusreact on|off`);
      // This is a per-bot setting stored in bot config
      await ctx.deps.users.setPref(ctx.sender.jid, 'autoStatusReact', arg === 'on');
      return ctx.reply(`✅ auto status react: ${arg === 'on' ? 'ON' : 'OFF'}.`);
    }
    throw new UserError(`Usage: ${ctx.prefix}${this.usage}`);
  },
};
