export default {
  name: 'start',
  description: 'Force-start a word game lobby',
  usage: 'start',
  role: 'user',
  async execute(ctx) {
    const { wordGame } = ctx.deps;
    if (!wordGame?.hasGame(ctx.chatJid)) return; // silently ignore if no game — don't spam
    return ctx.reply(wordGame.forceStart(ctx.chatJid, ctx.sender.jid));
  },
};
