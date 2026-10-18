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
    const isOwner = ctx.role === 'owner';

    const lines = [
      `╭━━━━━━━━━━━━━━━━━━━━━╮`,
      `┃   🤖 *${settings.botName}*`,
      `┃   📱 +${num}`,
      `┃   ⏱️ Uptime: ${h}h ${m}m`,
      `╰━━━━━━━━━━━━━━━━━━━━━╯`,
      ``,
      `╭─「 👁️ *VIEW ONCE* 」`,
      `│ ${p}vv — Reveal a view-once (reply to it)`,
      `╰────────────────────`,
      ``,
      `╭─「 🎨 *STICKERS* 」`,
      `│ ${p}sticker / ${p}s — Create sticker from media`,
      `╰────────────────────`,
      ``,
      `╭─「 ⚙️ *GENERAL* 」`,
      `│ ${p}alive — Check if bot is online`,
      `│ ${p}ping — Check response time`,
      `│ ${p}info — Bot info & uptime`,
      `│ ${p}owner — Show owner contact`,
      `│ ${p}calc <expr> — Calculator`,
      `│ ${p}quote — Random motivational quote`,
      `│ ${p}weather <city> — Current weather`,
      `╰────────────────────`,
      ``,
      `╭─「 👥 *GROUP TOOLS* 」`,
      `│ ${p}tagall / ${p}tga [msg] — Tag all members`,
      `│ ${p}tagguard / ${p}tg on|off — @all protection`,
      `│ ${p}msgcount / ${p}mc [@user|reply] [day|week]`,
      `╰────────────────────`,
      ``,
      `╭─「 🎮 *WORD GAME* 」`,
      `│ ${p}wdg [players] — Start a word game (default 5)`,
      `│ ${p}join — Join a game lobby`,
      `│ ${p}wdg start — Force-start (host only)`,
      `│ ${p}wdg stop — Stop the game`,
      `│ ${p}wdg lb — Leaderboard`,
      `╰────────────────────`,
    ];

    if (isOwner) {
      const mode = settings.botMode ?? 'public';
      lines.push(
        ``,
        `╭─「 👑 *OWNER COMMANDS* 」`,
        `│ ${p}delete on|off — Deleted message monitoring`,
        `│ ${p}stats — Bot statistics`,
        `│ ${p}settings — Manage bot settings`,
        `│ ${p}publ — Make bot public`,
        `│ ${p}priv — Make bot private`,
        `│ ${p}relink [phone] — Relink sessions`,
        `│ 🔒 Mode: *${mode}*`,
        `╰────────────────────`,
      );
    }

    await ctx.reply(lines.join('\n'));
  },
};
