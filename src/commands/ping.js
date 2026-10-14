export default {
  name: 'ping',
  category: 'General',
  description: 'Check bot responsiveness',
  usage: 'ping',
  async execute(ctx) {
    const sentAt = Number(ctx.msg.messageTimestamp?.toString?.() ?? ctx.msg.messageTimestamp ?? 0) * 1000;
    const delivery = sentAt ? Math.max(0, ctx.receivedAt - sentAt) : null;
    const processing = Date.now() - ctx.receivedAt;
    await ctx.reply(`🏓 Pong!${delivery !== null ? ` Delivery ~${delivery}ms,` : ''} processing ${processing}ms.`);
  },
};
