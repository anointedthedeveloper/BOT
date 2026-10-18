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
    // Clear entire permissions cache so the change takes effect immediately
    permissions._cache.clear();
    return ctx.reply(`✅ Admin use: *${arg === 'on' ? 'ON' : 'OFF'}*. ${arg === 'on' ? 'Global admin can use this bot.' : 'Global admin access disabled for this bot.'}`);
  },
};
