export default {
  name: 'publ',
  aliases: ['priv'],
  description: 'Set bot public or private',
  usage: 'publ | priv',
  role: 'owner',
  ownerOnly: true,
  async execute(ctx) {
    const { settings, permissions } = ctx.deps;
    const mode = ctx.name === 'publ' ? 'public' : 'private';
    await settings.setBotMode(mode);
    permissions._cache?.clear();
    await ctx.reply(`✅ Bot is now *${mode}*. ${mode === 'public' ? 'Anyone can use it.' : 'Only allowed users can use it.'}`);
  },
};
