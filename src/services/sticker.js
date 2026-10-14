import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { UserError } from '../utils/errors.js';

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
 * Builds a sticker WebP from a downloaded media buffer. `kind` is the message's own kind
 * (image/video/sticker — see describeMessage). Existing stickers are passed through, resized to
 * the standard square if needed.
 */
export async function makeSticker(buffer, kind, { ffmpegPath } = {}) {
  let webp;
  if (kind === 'sticker') webp = await stickerFromImage(buffer); // re-pad/resize an existing (static) sticker
  else if (STATIC_KINDS.has(kind)) webp = await stickerFromImage(buffer);
  else if (ANIMATED_KINDS.has(kind)) webp = await stickerFromVideo(buffer, { ffmpegPath });
  else throw new UserError('Only images, GIFs/videos and existing stickers can be turned into a sticker.');
  if (webp.length > MAX_STICKER_BYTES) throw new UserError('The sticker came out too large. Try a shorter clip or a smaller image.');
  return webp;
}
