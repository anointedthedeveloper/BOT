import { UserError } from '../utils/errors.js';

export default {
  name: 'delete',
  category: 'Deleted messages',
  description: 'Enable, disable, or check deleted-message monitoring',
  usage: 'delete on|off|status',
  role: 'owner',
  details: [
    'Turns deleted-message monitoring on or off for every chat the bot is in.',
    'A chat still gets a one-time notice the first message it captures ("monitoring is ON") — that notice is not optional.',
    'When a monitored message is deleted, you are notified privately with the original content if it was captured, or told plainly that it was deleted with no content available.',
    '{p}delete off wipes everything currently cached, so nothing lingers once monitoring is off.',
  ].join('\n'),
  async execute(ctx) {
    const { settings, config, archive } = ctx.deps;
    const sub = (ctx.args[0] ?? '').toLowerCase();

    if (!sub || sub === 'status') {
      const mode = settings.defaultArchiveMode;
      return ctx.reply(`Deleted-message monitoring: *${mode === 'off' ? 'OFF' : 'ON'}*${mode === 'off' ? '' : ` (${mode})`}.`);
    }
    if (sub === 'on') {
      if (!config.privacy.allowMediaCaching && !config.privacy.allowContentLogging) {
        throw new UserError('The operator has disabled both content and media logging, so there is nothing this can turn on.');
      }
      const mode = config.privacy.allowMediaCaching ? 'media' : 'full';
      try {
        await settings.setDefaultArchiveMode(mode);
      } catch (e) {
        throw new UserError(e.message);
      }
      return ctx.reply(`✅ Deleted-message monitoring (${mode}) is now ON. Each chat still gets the usual notice the first time it applies.`);
    }
    if (sub === 'off') {
      await settings.setDefaultArchiveMode('off');
      await archive.disableAndWipe();
      return ctx.reply('✅ Deleted-message monitoring is OFF, and everything cached for it has been deleted.');
    }
    throw new UserError(`Usage: ${ctx.prefix}${this.usage}`);
  },
};
