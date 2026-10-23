export default {
  name: 'restart',
  aliases: ['reboot'],
  description: 'Restart your bot session',
  usage: 'restart',
  open: true,
  async execute(ctx) {
    const { sessionManager, client } = ctx.deps;
    const phone = ctx.sender.jid.split('@')[0];

    // If sessionManager exists this is a multi-tenant setup — restart the caller's session
    if (sessionManager) {
      const session = sessionManager.getSession(phone);
      if (!session) return ctx.reply('❌ No active session found for your number.');
      await ctx.reply('🔄 Restarting your session...');
      await client.restart();
      return;
    }

    // Single-session mode
    await ctx.reply('🔄 Restarting bot...');
    await client.restart();
  },
};
