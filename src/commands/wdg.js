export default {
  name: 'wdg',
  description: 'Word chain game',
  usage: 'wdg [maxPlayers|stop|leaderboard]',
  role: 'user',
  async execute(ctx) {
    const { wordGame } = ctx.deps;
    if (!wordGame) return ctx.reply('❌ Word game service not available.');

    const sub = ctx.args[0]?.toLowerCase();

    if (sub === 'stop') {
      const msg = wordGame.stopGame(ctx.chatJid, ctx.sender.jid, ctx.role === 'owner');
      if (msg) return ctx.reply(msg);
      return;
    }

    if (sub === 'leaderboard' || sub === 'lb') {
      return ctx.reply(await wordGame.getLeaderboard(ctx.chatJid));
    }

    if (sub === 'start') {
      return ctx.reply(wordGame.forceStart(ctx.chatJid, ctx.sender.jid));
    }

    // ,wdg [number] — start a lobby
    const maxPlayers = sub ? parseInt(sub, 10) : 5;
    const sendFn = (text) => ctx.deps.client.sendText(ctx.chatJid, text);
    return ctx.reply(wordGame.startLobby(ctx.chatJid, ctx.sender.jid, maxPlayers, sendFn));
  },
};
