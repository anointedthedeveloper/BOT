import { UserError } from '../utils/errors.js';

export default {
  name: 'delete',
  category: 'Deleted messages',
  description: 'Enable or disable deleted-message monitoring',
  usage: 'delete on|off',
  role: 'owner',
  async execute(ctx) {
    const { settings, config, archive } = ctx.deps;
    const sub = (ctx.args[0] ?? '').toLowerCase();

    if (sub === 'on') {
      const mode = config.privacy.allowMediaCaching ? 'media' : 'full';
      try {
        await settings.setDefaultArchiveMode(mode);
      } catch (e) {
        throw new UserError(e.message);
      }
      return ctx.reply('✅ Deleted-message monitoring is now ON.');
    }
    if (sub === 'off') {
      await settings.setDefaultArchiveMode('off');
      await archive.disableAndWipe();
      return ctx.reply('✅ Deleted-message monitoring is now OFF.');
    }
    throw new UserError(`Usage: ${ctx.prefix}${this.usage}`);
  },
};
