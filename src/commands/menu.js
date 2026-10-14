export default {
  name: 'menu',
  category: 'Deleted messages', // placed first; menu text itself is hardcoded to the required layout below
  description: 'Show available commands',
  usage: 'menu',
  async execute(ctx) {
    const { settings } = ctx.deps;
    const p = ctx.prefix;
    const lines = [
      `*${settings.botName}*`,
      '',
      '*DELETED MESSAGES*',
      `${p}delete on — Enable monitoring`,
      `${p}delete off — Disable monitoring`,
      `${p}delete status — Check monitoring status`,
      '',
      '*STICKERS*',
      `${p}sticker — Create a sticker from supported media`,
      '',
      '*SETTINGS*',
      `${p}settings — Manage bot features`,
      `${p}settings status — View current settings`,
    ];
    await ctx.reply(lines.join('\n'));
  },
};
