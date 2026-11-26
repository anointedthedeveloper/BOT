export default {
  name: 'ping',
  description: 'Check bot response time',
  usage: 'ping',
  async execute(ctx) {
    const start = Date.now();
    await ctx.deps.client.sendText(ctx.chatJid, '\u200b'); // dummy send to measure RTT
    await ctx.reply(`🏓 Pong! ⚡ *${Date.now() - start}ms*`);
  },
};
