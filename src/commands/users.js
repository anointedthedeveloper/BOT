export default {
  name: 'users',
  aliases: ['listusers', 'allusers'],
  description: 'List all users who have interacted with the bot',
  usage: 'users',
  role: 'owner',
  async execute(ctx) {
    const { db, config } = ctx.deps;
    const database = db.db;

    const ownerNumbers = new Set(
      config.owners.map((o) => (o.includes('@') ? o.split('@')[0] : o))
    );

    // Pull distinct senders from msg_counts (most active first)
    const raw = await database
      .collection('msg_counts')
      .aggregate([
        { $group: { _id: '$senderJid', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 200 },
      ])
      .toArray()
      .catch(() => []);

    const numbers = raw
      .map((r) => r._id?.split('@')[0])
      .filter((n) => n && !ownerNumbers.has(n));

    if (!numbers.length) return ctx.reply('📭 No users found yet.');

    const lines = [
      `╭─「 👥 *All Users (${numbers.length})* 」`,
      ...numbers.map((n, i) => `│ ${i + 1}. +${n}`),
      `╰────────────────────`,
    ];

    await ctx.reply(lines.join('\n'));
  },
};
