export default {
  name: 'stats',
  description: 'Bot statistics (owner only)',
  usage: 'stats',
  role: 'owner',
  async execute(ctx) {
    const { db, client } = ctx.deps;
    const database = db.db;

    const [
      totalUsers,
      totalMsgsToday,
      totalMsgsWeek,
      totalGroups,
      totalWarns,
      tenants,
    ] = await Promise.all([
      database.collection('users').estimatedDocumentCount().catch(() => 0),
      database.collection('msg_counts').countDocuments({ ts: { $gte: new Date(Date.now() - 86_400_000) } }).catch(() => 0),
      database.collection('msg_counts').countDocuments({ ts: { $gte: new Date(Date.now() - 7 * 86_400_000) } }).catch(() => 0),
      database.collection('group_settings').estimatedDocumentCount().catch(() => 0),
      database.collection('tagall_warns').estimatedDocumentCount().catch(() => 0),
      database.collection('tenants').find({}).toArray().catch(() => []),
    ]);

    const activeSessions = tenants.filter((t) => t.status === 'open').length;
    const totalSessions = tenants.length;

    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = Math.floor(uptime % 60);

    const sessionLines = tenants.slice(0, 10).map((t) => {
      const num = t.phone ? t.phone.slice(0, 4) + '****' + t.phone.slice(-2) : '?';
      const icon = t.status === 'open' ? '🟢' : t.status === 'reconnecting' ? '🟡' : '🔴';
      return `│ ${icon} +${num} — ${t.status}`;
    });

    const lines = [
      `╭─「 📊 *Bot Stats* 」`,
      `│ ⏱️ Uptime: ${h}h ${m}m ${s}s`,
      `│ 👥 Total users: ${totalUsers}`,
      `│ 🔗 Sessions: ${activeSessions} active / ${totalSessions} total`,
      `│ 💬 Messages today: ${totalMsgsToday}`,
      `│ 📅 Messages this week: ${totalMsgsWeek}`,
      `│ 🏘️ Groups tracked: ${totalGroups}`,
      `│ ⚠️ Active warn records: ${totalWarns}`,
      `╰────────────────────`,
    ];

    if (sessionLines.length) {
      lines.push(``, `╭─「 🔗 *Sessions* 」`, ...sessionLines, `╰────────────────────`);
    }

    await ctx.reply(lines.join('\n'));
  },
};
