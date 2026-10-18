export default {
  name: 'owner',
  description: 'Show bot owner contact',
  usage: 'owner',
  open: true, // visible to all users
  async execute(ctx) {
    const { config } = ctx.deps;
    const owners = config.owners.map((o) => {
      const num = o.includes('@') ? o.split('@')[0] : o;
      return `📱 wa.me/${num}`;
    });
    await ctx.reply([
      `╭─「 👑 *Bot Owner* 」`,
      ...owners.map((o) => `│ ${o}`),
      `╰────────────────`,
    ].join('\n'));
  },
};
