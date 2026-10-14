import { UserError } from '../utils/errors.js';
import { formatBytes } from '../utils/text.js';
import { canStickerKind, makeSticker, addStickerMetadata } from '../services/sticker.js';

export default {
  name: 'sticker',
  aliases: ['s', 'stiker'],
  category: 'General',
  description: 'Turn a replied-to image, GIF/video or sticker into a sticker',
  usage: 'sticker (reply to a photo, GIF/video or sticker)',
  details: 'Reply to the media with {p}sticker. Video/GIF clips are capped at 10 seconds. View-once media is refused, same as {p}save.',
  async execute(ctx) {
    const { client, config, settings } = ctx.deps;
    const q = ctx.quoted;
    if (!q) throw new UserError(`Reply to a photo, GIF/video or sticker, then send ${ctx.prefix}sticker.`);
    if (q.info.viewOnce) throw new UserError('View-once messages cannot be turned into a sticker. This bot honours WhatsApp\'s view-once protection.');
    if (!canStickerKind(q.info.kind)) throw new UserError('Only images, GIFs/videos and existing stickers can be turned into a sticker.');
    if (q.info.size && q.info.size > config.media.maxBytes) {
      throw new UserError(`That file is ${formatBytes(q.info.size)}; the limit is ${formatBytes(config.media.maxBytes)}.`);
    }

    let buffer;
    try {
      buffer = await client.downloadMedia({ key: { remoteJid: ctx.chatJid, id: q.id, participant: q.participant ?? undefined, fromMe: false }, message: q.message });
    } catch (err) {
      ctx.log.warn({ err: err.message }, 'media download failed');
      throw new UserError('I could not download that media. It may have expired; ask for it to be sent again.');
    }
    if (buffer.length > config.media.maxBytes) throw new UserError(`That file is larger than ${formatBytes(config.media.maxBytes)}.`);

    let webp;
    try {
      webp = await makeSticker(buffer, q.info.kind);
    } catch (err) {
      if (err instanceof UserError) throw err;
      ctx.log.error({ err: err.message }, 'sticker conversion failed');
      throw new Error(`sticker conversion failed: ${err.message}`); // not a UserError: surfaced as a reported bug (likely a missing/broken ffmpeg)
    }

    const packName = config.bot.stickerPackName || settings.botName;
    const author = config.bot.stickerPackAuthor || settings.botName;
    try {
      webp = await addStickerMetadata(webp, { packName, author });
    } catch (err) {
      // The pack name/author is cosmetic: never fail the whole command over it, just note it.
      ctx.log.warn({ err: err.message }, 'could not embed sticker pack metadata');
    }

    await client.sendMedia(ctx.chatJid, { kind: 'sticker', buffer: webp }, { quoted: ctx.msg });
  },
};
