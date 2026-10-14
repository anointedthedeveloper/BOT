import { UserError } from '../utils/errors.js';

export default {
  name: 'delete',
  aliases: ['deletewatch'],
  category: 'Administration',
  description: 'Owner-only: turn deleted-message recovery on/off for every chat',
  usage: 'delete on [inchat|dm] | off | status',
  role: 'owner',
  details: [
    'A convenience switch over the same archiving system as {p}privacy archive, but applied everywhere at once:',
    '• *on* — every chat (existing and new) starts recovering deleted text and media, without you running a command in each one.',
    '• *on dm* — same, but the recovered content is sent to you privately instead of posted back in the chat.',
    '• *off* — turns that default back off. Chats you (or anyone) configured explicitly with {p}privacy archive are not touched either way.',
    'Whichever target you pick, the first message in any newly-covered chat still gets the same visible "archiving is ON" notice, exactly like enabling it by hand would — that notice is not optional and does not change based on where the content ends up.',
  ].join('\n'),
  async execute(ctx) {
    const { settings, config } = ctx.deps;
    const sub = (ctx.args[0] ?? '').toLowerCase();

    if (!sub || sub === 'status') {
      const mode = settings.defaultArchiveMode;
      const target = settings.defaultArchiveTarget;
      return ctx.reply(`Deleted-message recovery default: *${mode}*${mode === 'off' ? '' : ` (${target === 'dm' ? 'sent to you privately' : 'shown in each chat'}; applies to every chat not configured individually)`}.`);
    }
    if (sub === 'on') {
      const targetArg = (ctx.args[1] ?? '').toLowerCase();
      if (targetArg && !['inchat', 'dm'].includes(targetArg)) throw new UserError(`Usage: ${ctx.prefix}delete on [inchat|dm]`);
      if (!config.privacy.allowMediaCaching && !config.privacy.allowContentLogging) {
        throw new UserError('The operator has disabled both content and media logging, so there is nothing this can turn on.');
      }
      const mode = config.privacy.allowMediaCaching ? 'media' : 'full';
      try {
        await settings.setDefaultArchiveMode(mode);
        if (targetArg) await settings.setDefaultArchiveTarget(targetArg);
      } catch (e) {
        throw new UserError(e.message);
      }
      const dm = settings.defaultArchiveTarget === 'dm';
      return ctx.reply(`✅ Deleted-message recovery (${mode}) is now ON for every chat by default. New chats will still show the usual archiving notice the first time it applies; the recovered content itself will be ${dm ? 'sent to you privately' : 'shown back in the chat it happened in'}.`);
    }
    if (sub === 'off') {
      await settings.setDefaultArchiveMode('off');
      return ctx.reply('✅ Deleted-message recovery default is OFF. Chats configured explicitly via /privacy archive are unaffected.');
    }
    throw new UserError(`Usage: ${ctx.prefix}${this.usage}`);
  },
};
