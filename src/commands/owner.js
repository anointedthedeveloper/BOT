export default {
  name: 'owner',
  aliases: ['creator'],
  category: 'General',
  description: 'Show owner information',
  usage: 'owner',
  async execute(ctx) {
    const { config } = ctx.deps;
    const { ownerName, ownerContact } = config.bot;
    if (!ownerName && !ownerContact) return ctx.reply('The owner has not published contact details.');
    await ctx.reply(['👤 *Bot owner*', ownerName && `Name: ${ownerName}`, ownerContact && `Contact: ${ownerContact}`].filter(Boolean).join('\n'));
  },
};
