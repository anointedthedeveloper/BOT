export default {
  name: 'ping',
  description: 'Check bot response time',
  usage: 'ping',
  async execute(ctx) {
    const start = Date.now();
    await ctx.reply('🏓 Pong!');
    const ms = Date.now() - start;
    await ctx.reply(`⚡ *${ms}ms*`);
  },
};
