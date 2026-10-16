export default {
  name: 'info',
  description: 'Show bot info and uptime',
  usage: 'info',
  async execute(ctx) {
    const { settings, client } = ctx.deps;
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = Math.floor(uptime % 60);
    const uptimeStr = `${h}h ${m}m ${s}s`;
    const num = client.selfJid?.split('@')[0] ?? 'unknown';
    await ctx.reply([
      `╭─「 *${settings.botName}* 」`,
      `│ 📱 Number: +${num}`,
      `│ ⏱️ Uptime: ${uptimeStr}`,
      `│ 🟢 Status: Online`,
      `╰────────────────`,
    ].join('\n'));
  },
};
