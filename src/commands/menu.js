export default {
  name: 'menu',
  description: 'Show available commands',
  usage: 'menu',
  async execute(ctx) {
    const { settings, client } = ctx.deps;
    const p = ctx.prefix;
    const num = client.selfJid?.split('@')[0] ?? '';
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);

    const lines = [
      `╭━━━━━━━━━━━━━━━━━━━━━╮`,
      `┃   🤖 *${settings.botName}*`,
      `┃   📱 +${num}`,
      `┃   ⏱️ Uptime: ${h}h ${m}m`,
      `╰━━━━━━━━━━━━━━━━━━━━━╯`,
      ``,
      `╭─「 🗑️ *DELETED MESSAGES* 」`,
      `│ ${p}delete on — Enable monitoring`,
      `│ ${p}delete off — Disable monitoring`,
      `╰────────────────────`,
      ``,
      `╭─「 👁️ *VIEW ONCE* 」`,
      `│ ${p}vv — Reveal a view-once (reply to it)`,
      `╰────────────────────`,
      ``,
      `╭─「 🎨 *STICKERS* 」`,
      `│ ${p}sticker — Create sticker from media`,
      `╰────────────────────`,
      ``,
      `╭─「 ⚙️ *GENERAL* 」`,
      `│ ${p}alive — Check if bot is online`,
      `│ ${p}ping — Check response time`,
      `│ ${p}info — Bot info & uptime`,
      `│ ${p}settings — Manage bot settings`,
      `╰────────────────────`,
    ];
    await ctx.reply(lines.join('\n'));
  },
};
