import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { sha256 } from '../utils/crypto.js';

/** Stores user-saved media on disk (AES-256-GCM encrypted when a key is configured). */
export class MediaStore {
  constructor({ dir, cipher, logger }) {
    this.dir = path.resolve(dir);
    this.cipher = cipher;
    this.logger = logger;
  }

  #resolve(rel) {
    const full = path.resolve(this.dir, rel);
    if (full !== this.dir && !full.startsWith(this.dir + path.sep)) throw new Error('Path escapes media directory');
    return full;
  }

  async save(userJid, buffer) {
    const rel = path.join(sha256(userJid).slice(0, 16), randomUUID());
    const full = this.#resolve(rel);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    await writeFile(full, this.cipher.encryptBuffer(buffer), { mode: 0o600 });
    return { path: rel, size: buffer.length };
  }

  async read(rel) {
    return this.cipher.decryptBuffer(await readFile(this.#resolve(rel)));
  }

  async remove(rel) {
    try {
      await rm(this.#resolve(rel), { force: true });
    } catch (err) {
      this.logger?.warn({ err: err.message }, 'failed to remove media file');
    }
  }

  async removeMany(paths) {
    await Promise.all(paths.map((p) => this.remove(p)));
  }
}
