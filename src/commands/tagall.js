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
    // argText becomes the message body; zero-width space if no message given (silent ping)
    const text = ctx.argText || '\u200b';

    const sent = await client.rawSock.sendMessage(ctx.chatJid, { text, mentions });
    // Track so the bot doesn't process its own message as a command
    if (sent?.key?.id) client.sentIds?.add(sent.key.id);
  },
};
