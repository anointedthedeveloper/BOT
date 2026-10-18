export default {
  name: 'adu',
  description: 'Toggle whether the global admin can use all user bots',
  usage: 'adu on|off',
  role: 'owner',
  ownerOnly: true,
  async execute(ctx) {
    const { sessionManager } = ctx.deps;
    const arg = ctx.args[0]?.toLowerCase();
    if (!['on', 'off'].includes(arg)) {
      const current = await sessionManager.getGlobalAdminUse();
      return ctx.reply(`ℹ️ Global admin use is currently *${current ? 'ON' : 'OFF'}*.\nUsage: ${ctx.prefix}adu on|off`);
    }
    await sessionManager.setGlobalAdminUse(arg === 'on');
    return ctx.reply(`✅ Global admin use: *${arg.toUpperCase()}*. ${arg === 'on' ? 'Admin can now use all user bots.' : 'Admin is now blocked from all user bots.'}`);
  },
};
