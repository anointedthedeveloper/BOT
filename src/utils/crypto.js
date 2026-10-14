import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

/**
 * Optional AES-256-GCM encryption-at-rest helper. With no key it is a transparent pass-through,
 * so features keep working while operators are warned (see README) that data is stored in clear text.
 */
export function createCipherBox(key) {
  if (key && key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  const enabled = Boolean(key);

  function encryptBuffer(buf) {
    if (!enabled) return buf;
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update(buf), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
  }

  function decryptBuffer(buf) {
    if (!enabled) return buf;
    if (buf.length < 28) throw new Error('Ciphertext too short');
    const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
  }

  function encryptText(text) {
    if (text == null) return text;
    if (!enabled) return text;
    return PREFIX + encryptBuffer(Buffer.from(String(text), 'utf8')).toString('base64');
  }

  function decryptText(value) {
    if (value == null) return value;
    if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value; // legacy / plain
    if (!enabled) throw new Error('Data is encrypted but DATA_ENCRYPTION_KEY is not set');
    return decryptBuffer(Buffer.from(value.slice(PREFIX.length), 'base64')).toString('utf8');
  }

  return { enabled, encryptBuffer, decryptBuffer, encryptText, decryptText };
}

export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
