export default {
  name: 'msgcount',
  aliases: ['mc'],
  description: 'Show message count for a user or the whole group',
  usage: 'msgcount [@user|reply] [day|week]',
  role: 'user',
  async execute(ctx) {
    const { db } = ctx.deps;
    if (!ctx.isGroup) return ctx.reply('❌ Group only.');

    const col = db.db.collection('msg_counts');

    // Resolve target JID: quoted reply > @mention > whole group
    let targetJid = null;
    if (ctx.quoted?.key?.participant) {
      targetJid = ctx.quoted.key.participant.split(':')[0] + '@s.whatsapp.net';
    } else if (ctx.msg.message) {
      const raw = ctx.argText ?? '';
      const mentionedJids =
        ctx.msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ??
        ctx.msg.message?.conversation?.contextInfo?.mentionedJid ?? [];
      if (mentionedJids.length) targetJid = mentionedJids[0];
    }

    // Period: last arg 'week' or default 'day'
    const args = ctx.args;
    const period = args[args.length - 1]?.toLowerCase() === 'week' ? 'week' : 'day';
    const now = new Date();
    const since = new Date(now);
    if (period === 'week') since.setDate(since.getDate() - 7);
    else since.setHours(0, 0, 0, 0);

    const query = { chatJid: ctx.chatJid, ts: { $gte: since } };
    if (targetJid) query.senderJid = targetJid;

    const count = await col.countDocuments(query);
    const who = targetJid ? `@${targetJid.split('@')[0]}` : 'this group';
    const label = period === 'week' ? 'this week' : 'today';
    await ctx.reply(`📊 *${who}* sent *${count}* message${count !== 1 ? 's' : ''} ${label}.`);
  },
};
