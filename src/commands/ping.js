export default {
  name: 'ping',
  description: 'Check bot response time',
  usage: 'ping',
  async execute(ctx) {
    // The round-trip must be measured around an actual send: the time can't be known
    // before the message goes out, so send "Pong!" first, then report how long it took.
    const start = Date.now();
    await ctx.reply('🏓 Pong!');
    await ctx.reply(`⚡ *${Date.now() - start}ms*`);
  },
};
