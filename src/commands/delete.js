import { UserError } from '../utils/errors.js';

export default {
  name: 'delete',
  aliases: ['deletewatch'],
  category: 'Administration',
  description: 'Owner-only: turn deleted-message recovery on/off for every chat',
  usage: 'delete on|off|status',
  role: 'owner',
  details: [
    'A convenience switch over the same archiving system as {p}privacy archive, but applied everywhere at once:',
    '• *on* — every chat (existing and new) starts recovering deleted text and media, without you running a command in each one.',
    '• *off* — turns that default back off. Chats you (or anyone) configured explicitly with {p}privacy archive are not touched either way.',
    'A deleted message is shown back IN the chat it was deleted from — never sent to you privately — and the first message in any newly-covered chat still gets a visible "archiving is ON" notice, exactly like enabling it by hand would.',
  ].join('\n'),
  async execute(ctx) {
    const { settings, config } = ctx.deps;
    const sub = (ctx.args[0] ?? '').toLowerCase();

    if (!sub || sub === 'status') {
      return ctx.reply(`Deleted-message recovery default: *${settings.defaultArchiveMode}*${settings.defaultArchiveMode === 'off' ? '' : ' (applies to every chat that has not been configured individually)'}.`);
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
      return ctx.reply(`✅ Deleted-message recovery (${mode}) is now ON for every chat by default. New chats will show the usual archiving notice the first time it applies, and deletions are shown back in the chat they happened in.`);
    }
    if (sub === 'off') {
      await settings.setDefaultArchiveMode('off');
      return ctx.reply('✅ Deleted-message recovery default is OFF. Chats configured explicitly via /privacy archive are unaffected.');
    }
    throw new UserError(`Usage: ${ctx.prefix}${this.usage}`);
  },
};
