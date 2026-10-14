import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { canStickerKind, makeSticker, STICKER_SIZE } from '../src/services/sticker.js';
import { UserError } from '../src/utils/errors.js';

const run = promisify(execFile);
const samplePng = () => sharp({ create: { width: 300, height: 150, channels: 4, background: { r: 200, g: 50, b: 50, alpha: 1 } } }).png().toBuffer();
const sampleVideo = async () => (await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=120x80:rate=10', '-t', '1', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1024 * 1024 * 20 })).stdout;

test('canStickerKind', () => {
  assert.ok(canStickerKind('image'));
  assert.ok(canStickerKind('video'));
  assert.ok(canStickerKind('sticker'));
  assert.ok(!canStickerKind('audio'));
  assert.ok(!canStickerKind('document'));
  assert.ok(!canStickerKind('text'));
});

test('makeSticker: converts a real image to a square transparent-padded WebP', async () => {
  const webp = await makeSticker(await samplePng(), 'image');
  assert.equal(webp.subarray(0, 4).toString(), 'RIFF');
  assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
  const meta = await sharp(webp).metadata();
  assert.equal(meta.width, STICKER_SIZE);
  assert.equal(meta.height, STICKER_SIZE);
});

test('makeSticker: converts a real video to an animated WebP', async () => {
  const webp = await makeSticker(await sampleVideo(), 'video');
  assert.equal(webp.subarray(0, 4).toString(), 'RIFF');
  const meta = await sharp(webp).metadata();
  assert.equal(meta.format, 'webp');
  assert.ok(meta.pages > 1, 'has multiple frames (animated)');
  assert.equal(meta.width, STICKER_SIZE);
});

test('makeSticker: rejects unsupported kinds with a UserError', async () => {
  await assert.rejects(() => makeSticker(Buffer.from('x'), 'audio'), UserError);
  await assert.rejects(() => makeSticker(Buffer.from('x'), 'document'), UserError);
});

test('makeSticker: a corrupt image is a UserError, not a crash', async () => {
  await assert.rejects(() => makeSticker(Buffer.from('not an image'), 'image'), UserError);
});

test('makeSticker: a corrupt video is a UserError, not a crash', async () => {
  await assert.rejects(() => makeSticker(Buffer.from('not a video'), 'video'), UserError);
});

test('makeSticker: re-stickers an existing static sticker to the standard size', async () => {
  const original = await makeSticker(await samplePng(), 'image');
  const resticker = await makeSticker(original, 'sticker');
  const meta = await sharp(resticker).metadata();
  assert.equal(meta.width, STICKER_SIZE);
});

test('makeSticker: a missing ffmpeg binary surfaces as an operational error, not a UserError', async () => {
  await assert.rejects(
    () => makeSticker(Buffer.from('whatever'), 'video', { ffmpegPath: '/no/such/ffmpeg-binary' }),
    (err) => {
      assert.ok(!(err instanceof UserError), 'must not be treated as the user\'s mistake');
      assert.match(err.message, /ffmpeg is not installed/);
      return true;
    },
  );
});
