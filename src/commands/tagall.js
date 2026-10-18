export default {
  name: 'tagall',
  aliases: ['tga'],
  description: 'Tag all group members',
  usage: 'tagall [message]',
  role: 'user',
  async execute(ctx) {
    const { client } = ctx.deps;
    if (!ctx.isGroup) return ctx.reply('❌ This command only works in groups.');

    let meta;
    try {
      meta = await client.rawSock.groupMetadata(ctx.chatJid);
    } catch {
      return ctx.reply('❌ Could not fetch group members.');
    }

    const participants = meta.participants ?? [];
    const mentions = participants.map((p) => p.id);
    const tags = participants.map((p) => `@${p.id.split('@')[0]}`).join(' ');
    const text = ctx.argText ? `${ctx.argText}\n\n${tags}` : tags;

    await client.rawSock.sendMessage(ctx.chatJid, { text, mentions });
  },
};
