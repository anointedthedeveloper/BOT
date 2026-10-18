export default {
  name: 'adu',
  description: 'Toggle whether the global admin can use this bot',
  usage: 'adu on|off',
  role: 'owner',
  ownerOnly: true,
  async execute(ctx) {
    const { settings, permissions } = ctx.deps;
    const arg = ctx.args[0]?.toLowerCase();
    if (!['on', 'off'].includes(arg)) {
      const current = settings.adminUse ?? true;
      return ctx.reply(`ℹ️ Admin use is currently *${current ? 'ON' : 'OFF'}*.\nUsage: ${ctx.prefix}adu on|off`);
    }
    await settings.setAdminUse(arg === 'on');
    permissions._cache.clear();
    const botNum = ctx.deps.config.owners[0];
    return ctx.reply(`✅ Admin use: *${arg === 'on' ? 'ON' : 'OFF'}* for this bot (+${botNum}).\n${arg === 'on' ? 'Global admin can use this bot.' : 'Global admin is now blocked from using this bot.'}`);
  },
};
