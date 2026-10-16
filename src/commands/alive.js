export default {
  name: 'alive',
  description: 'Check if the bot is running',
  usage: 'alive',
  async execute(ctx) {
    const { settings } = ctx.deps;
    await ctx.reply(`✅ *${settings.botName}* is alive and running!`);
  },
};
