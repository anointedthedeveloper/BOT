export default {
  name: 'users',
  aliases: ['listusers', 'allusers'],
  description: 'List all registered users from the tenants collection',
  usage: 'users',
  role: 'owner',
  async execute(ctx) {
    const { tenants } = ctx.deps;

    const all = await tenants.list();
    if (!all.length) return ctx.reply('📭 No users found yet.');

    const statusIcon = (s) => s === 'open' ? '🟢' : s === 'reconnecting' ? '🟡' : '🔴';

    const lines = [
      `╭─「 👥 *All Users (${all.length})* 」`,
      ...all.map((t, i) => `│ ${i + 1}. ${statusIcon(t.status)} +${t.phone}`),
      `╰────────────────────`,
    ];

    await ctx.reply(lines.join('\n'));
  },
};
