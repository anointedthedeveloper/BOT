import { UserError } from '../utils/errors.js';
import { formatBytes } from '../utils/text.js';
import { describeMessage } from '../utils/message.js';
import { canStickerKind, makeSticker, addStickerMetadata } from '../services/sticker.js';

export default {
  name: 'sticker',
  aliases: ['s', 'stiker'],
  category: 'Stickers',
  description: 'Turn a photo, GIF/video or sticker into a sticker',
  usage: 'sticker (reply to media, or send/caption media with {p}sticker)',
  details: 'Either reply to the media with {p}sticker, or send the photo/video itself with {p}sticker as its caption. Video/GIF clips are capped at 10 seconds. View-once media is refused — this bot honours WhatsApp\'s view-once protection.',
  async execute(ctx) {
    const { client, config, settings } = ctx.deps;
    if (!settings.stickerEnabled) throw new UserError(`The sticker command is currently disabled. Ask the owner to enable it with ${ctx.prefix}settings sticker on.`);

    // Accept either a reply to media, or the command's own message carrying the media (caption = command).
    // For quoted messages, build the info ourselves — getQuoted may return a stub for premium stickers
    // where WhatsApp strips the full payload from contextInfo. We check both the quoted payload and
    // fall back to inspecting the raw contextInfo for a stickerMessage stub.
    let q = ctx.quoted ? { ...ctx.quoted, info: describeMessage(ctx.quoted.message) } : null;

    // If quoted exists but hasMedia is false, check if it's a sticker stub (has fileEncSha256 or
    // fileSha256 even without full message keys — premium stickers often arrive this way)
    if (q && !q.info.hasMedia) {
      const stub = ctx.quoted.message?.stickerMessage ?? ctx.quoted.message;
      if (stub?.fileSha256 || stub?.fileEncSha256 || stub?.directPath) {
        // It's a sticker stub — treat it as a sticker kind so we can attempt download
        q = { ...ctx.quoted, info: { kind: 'sticker', hasMedia: true, viewOnce: false, mimetype: stub.mimetype ?? 'image/webp', size: null, text: '' } };
      }
    }

    // If still no quoted media, check the command's own message
    if (!q || !q.info.hasMedia) {
      q = { info: describeMessage(ctx.msg.message) };
    }

    // Debug log so we can see exactly what message structure arrived
    ctx.log.info({
      hasQuoted: !!ctx.quoted,
      quotedKeys: ctx.quoted ? Object.keys(ctx.quoted.message ?? {}).join(',') : '(none)',
      ownMsgKeys: Object.keys(ctx.msg.message ?? {}).join(','),
      qInfoKind: q.info?.kind,
      qInfoHasMedia: q.info?.hasMedia,
    }, 'sticker: message inspect');

    if (!q.info.hasMedia) {
      throw new UserError(`Reply to a photo, GIF/video or sticker, or send one with the caption "${ctx.prefix}sticker", then try again.`);
    }
    if (q.info.viewOnce) throw new UserError('View-once messages cannot be turned into a sticker. This bot honours WhatsApp\'s view-once protection.');
    if (!canStickerKind(q.info.kind)) throw new UserError('Only images, GIFs/videos and existing stickers can be turned into a sticker.');
    if (q.info.size && q.info.size > config.media.maxBytes) {
      throw new UserError(`That file is ${formatBytes(q.info.size)}; the limit is ${formatBytes(config.media.maxBytes)}.`);
    }

    let buffer;
    try {
      buffer = (q.id)
        ? await client.downloadMedia({ key: { remoteJid: ctx.chatJid, id: q.id, participant: q.participant ?? undefined, fromMe: false }, message: q.message })
        : await client.downloadMedia(ctx.msg);
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
