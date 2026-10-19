import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import webpmux from 'node-webpmux';
import { UserError } from '../utils/errors.js';

const { Image } = webpmux;

const STATIC_KINDS = new Set(['image']);
const ANIMATED_KINDS = new Set(['video']);
export const STICKER_SIZE = 512;
const MAX_ANIMATED_SECONDS = 10;
const ANIMATED_FPS = 12;
// WhatsApp clients can refuse to display oversized stickers; keep well under that ceiling.
const MAX_STICKER_BYTES = 1024 * 1024;

/** True for the message kinds `/sticker` can turn into a sticker. */
export const canStickerKind = (kind) => STATIC_KINDS.has(kind) || ANIMATED_KINDS.has(kind) || kind === 'sticker';

/** Converts an image buffer into a square, transparent-padded WebP sticker. */
async function stickerFromImage(buffer) {
  try {
    return await sharp(buffer, { animated: true })
      .resize(STICKER_SIZE, STICKER_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 85 })
      .toBuffer();
  } catch (err) {
    throw new UserError(`That image could not be converted to a sticker (${err.message.slice(0, 120)}).`);
  }
}

/** Converts a video/GIF buffer into an animated, square WebP sticker via ffmpeg. */
async function stickerFromVideo(buffer, { ffmpegPath = 'ffmpeg' } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sticker-'));
  const inPath = path.join(dir, 'in');
  const outPath = path.join(dir, 'out.webp');
  try {
    await writeFile(inPath, buffer);
    await new Promise((resolve, reject) => {
      const args = [
        '-y', '-i', inPath,
        '-t', String(MAX_ANIMATED_SECONDS),
        '-vf', `scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease,fps=${ANIMATED_FPS},pad=${STICKER_SIZE}:${STICKER_SIZE}:-1:-1:color=0x00000000`,
        '-vcodec', 'libwebp', '-loop', '0', '-an', '-vsync', '0', '-preset', 'default',
        outPath,
      ];
      const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d; });
      proc.on('error', (err) => reject(err.code === 'ENOENT' ? new Error('ffmpeg is not installed') : err));
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-300) || `ffmpeg exited with code ${code}`))));
    });
    return await readFile(outPath);
  } catch (err) {
    if (/ffmpeg is not installed/.test(err.message)) throw err; // surfaced as an operator/config problem, not a user mistake
    throw new UserError('That video could not be converted to a sticker. It may be corrupt, too long, or an unsupported codec.');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Embeds WhatsApp's sticker EXIF metadata (pack/"collection" name, author/"brand", emoji tags)
 * into a WebP. WhatsApp clients read this to show the pack name and publisher under the sticker.
 */
export async function addStickerMetadata(webp, { packName = '', author = '', emojis = ['✨'] } = {}) {
  if (!packName && !author) return webp;
  const img = new Image();
  await img.load(webp);
  const payload = Buffer.from(JSON.stringify({
    'sticker-pack-id': `bot.${randomUUID()}`,
    'sticker-pack-name': packName.slice(0, 128),
    'sticker-pack-publisher': author.slice(0, 128),
    emojis,
  }), 'utf-8');
  // Fixed 22-byte EXIF/TIFF header WhatsApp expects ahead of the JSON payload (little-endian "II").
  const header = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
  header.writeUIntLE(payload.length, 14, 4);
  img.exif = Buffer.concat([header, payload]);
  return img.save(null);
}

/**
 * Builds a sticker WebP from a downloaded media buffer. `kind` is the message's own kind
 * (image/video/sticker — see describeMessage). Existing stickers are passed through, resized to
 * the standard square if needed.
 */
export async function makeSticker(buffer, kind, { ffmpegPath } = {}) {
  let webp;
  if (kind === 'sticker') {
    // Existing sticker — could be static or animated WebP.
    // Try sharp first (handles static WebP and images); if it fails (e.g. animated WebP that
    // sharp's build can't decode, or a premium sticker with unsupported encoding), fall back to
    // ffmpeg which handles all WebP variants including animated/premium ones.
    try {
      webp = await stickerFromImage(buffer);
    } catch {
      // sharp couldn't handle it — treat as animated/video via ffmpeg
      try {
        webp = await stickerFromVideo(buffer, { ffmpegPath });
      } catch {
        // ffmpeg also failed — last resort: pass the original WebP through as-is
        // (it's already a sticker so WhatsApp will accept it directly)
        // Skip the size check since we can't compress it further.
        return buffer;
      }
    }
  } else if (STATIC_KINDS.has(kind)) {
    webp = await stickerFromImage(buffer);
  } else if (ANIMATED_KINDS.has(kind)) {
    webp = await stickerFromVideo(buffer, { ffmpegPath });
  } else {
    throw new UserError('Only images, GIFs/videos and existing stickers can be turned into a sticker.');
  }
  if (webp.length > MAX_STICKER_BYTES) throw new UserError('The sticker came out too large. Try a shorter clip or a smaller image.');
  return webp;
}
