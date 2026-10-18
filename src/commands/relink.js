export default {
  name: 'relink',
  description: 'Relink sessions (restart timed-out/inactive sessions)',
  usage: 'relink [phone]',
  role: 'owner',
  ownerOnly: true,
  async execute(ctx) {
    const { sessionManager, tenants } = ctx.deps;
    if (!sessionManager) return ctx.reply('❌ Session manager not available.');

    const target = ctx.args[0]?.replace(/\D/g, '');

    if (target) {
      // Relink a specific session
      await sessionManager.stopSession(target).catch(() => {});
      await sessionManager.startSession(target).catch((err) => {
        ctx.deps.logger.warn({ err, phone: target }, 'relink failed');
      });
      return ctx.reply(`🔄 Relinking *${target}*...`);
    }

    // Relink all non-open sessions
    const all = await tenants.list();
    const stale = all.filter((t) => t.status !== 'open');
    if (!stale.length) return ctx.reply('✅ All sessions are already open.');

    for (const t of stale) {
      await sessionManager.stopSession(t.phone).catch(() => {});
      sessionManager.startSession(t.phone).catch((err) => {
        ctx.deps.logger.warn({ err, phone: t.phone }, 'relink failed');
      });
    }
    return ctx.reply(`🔄 Relinking *${stale.length}* session(s): ${stale.map((t) => t.phone).join(', ')}`);
  },
};
