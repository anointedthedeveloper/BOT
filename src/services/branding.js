import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** WhatsApp media captions are much shorter than text messages; past this, send the image and the full text separately. */
export const BRAND_CAPTION_LIMIT = 1000;

/**
 * Loads an optional "brand" image (BRAND_IMAGE_PATH) attached to every command reply.
 * Missing/unreadable files degrade to plain-text replies rather than failing startup.
 */
export async function loadBrandImage(filePath, logger) {
  if (!filePath) return null;
  const ext = path.extname(filePath).toLowerCase();
  const mimetype = MIME_BY_EXT[ext];
  if (!mimetype) {
    logger?.warn({ filePath }, 'BRAND_IMAGE_PATH has an unsupported extension (use .png, .jpg/.jpeg or .webp); replies will be plain text');
    return null;
  }
  try {
    return { buffer: await readFile(filePath), mimetype };
  } catch (err) {
    logger?.warn({ err: err.message, filePath }, 'could not read BRAND_IMAGE_PATH; replies will be plain text');
    return null;
  }
}
