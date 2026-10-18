export default {
  name: 'join',
  description: 'Join a word game in progress',
  usage: 'join',
  role: 'user',
  async execute(ctx) {
    const { wordGame } = ctx.deps;
    if (!wordGame) return;
    return ctx.reply(wordGame.joinGame(ctx.chatJid, ctx.sender.jid));
  },
};
