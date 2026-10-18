import { MongoClient } from 'mongodb';

/**
 * Connects to MongoDB and returns the handle used by every repository.
 * `retries` covers the common "database container still starting" case.
 */
export async function connectDatabase({ uri, dbName }, logger, { retries = 5, delayMs = 2000 } = {}) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000, appName: 'whatsapp-utility-bot' });
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await client.connect();
      const db = client.db(dbName);
      await db.command({ ping: 1 });
      logger?.info({ db: dbName }, 'mongodb connected');
      return {
        client,
        db,
        ping: async () => {
          try {
            await db.command({ ping: 1 });
            return true;
          } catch {
            return false;
          }
        },
        close: () => client.close(),
      };
    } catch (err) {
      lastErr = err;
      logger?.warn({ attempt, retries, err: err.message }, 'mongodb connection failed');
      if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  await client.close().catch(() => {});
  throw new Error(`Could not connect to MongoDB after ${retries} attempts: ${lastErr?.message}`);
}

export async function ensureIndexes(db, prefix = '') {
  await Promise.all([
    db.collection(`${prefix}message_cache`).createIndexes([
      { key: { chatJid: 1, msgId: 1 }, unique: true },
      { key: { expiresAt: 1 }, expireAfterSeconds: 0 },
    ]),
    db.collection(`${prefix}users`).createIndexes([{ key: { role: 1 } }, { key: { banned: 1 }, sparse: true }]),
    // msg_counts: auto-expire after 8 days (covers weekly queries with buffer)
    db.collection(`${prefix}msg_counts`).createIndexes([
      { key: { chatJid: 1, senderJid: 1, ts: 1 } },
      { key: { ts: 1 }, expireAfterSeconds: 8 * 24 * 3600 },
    ]),
    // tagall_warns: expire offence timestamps handled in-app; index for fast lookup
    db.collection(`${prefix}tagall_warns`).createIndexes([
      { key: { chatJid: 1, senderJid: 1 } },
    ]),
  ]);
}
