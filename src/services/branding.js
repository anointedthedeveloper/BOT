import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** WhatsApp supports up to 4096 chars in an image caption — use that as the limit. */
export const BRAND_CAPTION_LIMIT = 4000;

export async function loadBrandImage(filePath, logger) {
  if (!filePath) return null;
  try {
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      const res = await fetch(filePath);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get('content-type') || 'image/png';
      const mimetype = contentType.split(';')[0].trim();
      return { buffer, mimetype };
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimetype = MIME_BY_EXT[ext];
    if (!mimetype) {
      logger?.warn({ filePath }, 'BRAND_IMAGE_PATH has an unsupported extension; replies will be plain text');
      return null;
    }
    return { buffer: await readFile(filePath), mimetype };
  } catch (err) {
    logger?.warn({ err: err.message, filePath }, 'could not load BRAND_IMAGE_PATH; replies will be plain text');
    return null;
  }
}
