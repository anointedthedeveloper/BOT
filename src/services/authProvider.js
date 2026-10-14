import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { useMongoAuthState } from '../database/authState.js';

/**
 * Chooses where the WhatsApp session lives:
 *  - file:  Baileys' multi-file state in AUTH_DIR (mount a volume to persist it)
 *  - mongo: encrypted-at-rest (if DATA_ENCRYPTION_KEY is set) in the `wa_auth` collection
 * Returns a factory so the client can create a fresh state after a logout.
 */
export function createAuthProvider({ config, db, cipher, baileys }) {
  if (config.auth.store === 'mongo') {
    return async () => useMongoAuthState(db, { baileys, cipher });
  }
  const dir = path.resolve(config.auth.dir);
  return async () => {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const { state, saveCreds } = await baileys.useMultiFileAuthState(dir);
    return { state, saveCreds, clear: () => rm(dir, { recursive: true, force: true }) };
  };
}
