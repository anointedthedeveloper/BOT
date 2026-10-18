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
    // Use zero-width space so mentions are silent (no visible @number text)
    const text = ctx.argText || '\u200b';

    await client.rawSock.sendMessage(ctx.chatJid, { text, mentions });
  },
};
