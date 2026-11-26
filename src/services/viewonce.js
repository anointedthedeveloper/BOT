import { describeMessage } from '../utils/message.js';
import { normalizeJid, resolveSender } from '../utils/jid.js';

const VIEW_ONCE_KEYS = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];
const MEDIA_KEYS = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];

function unwrapInner(message) {
  let content = message;
  for (let i = 0; i < 5 && content; i++) {
    const wrapper = VIEW_ONCE_KEYS.find((k) => content[k]);
    if (wrapper) { content = content[wrapper].message ?? content[wrapper]; continue; }
    const mediaKey = MEDIA_KEYS.find((k) => content[k]);
    if (mediaKey) return content[mediaKey];
    break;
  }
  return null;
}

export class ViewOnceService {
  constructor({ client, logger, ownerJid, db = null, cipher = null, ttlHours = 24 }) {
    this.client = client;
    this.logger = logger;
    this.ownerJid = ownerJid;
    // L1 cache: msgId -> { buffer, info, from, chatJid }
    this._cache = new Map();
    // L2 cache: MongoDB (survives restarts/deploys). Expires via TTL index.
    this.col = db ? db.collection('viewonce_cache') : null;
    this.cipher = cipher;
    this.ttlMs = ttlHours * 3_600_000;
    this._indexReady = this.col
      ? this.col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch((err) => {
        this.logger.warn({ err: err.message }, 'view-once: ttl index failed');
      })
      : null;
  }

  #docId(msgId) {
    return `${this.client.selfJid ?? ''}:${msgId}`;
  }

  async getCache(msgId) {
    const hit = this._cache.get(msgId);
    if (hit) return hit;
    if (!this.col) return null;
    try {
      const doc = await this.col.findOne({ _id: this.#docId(msgId) });
      if (!doc) return null;
      const raw = Buffer.from(doc.data.buffer ?? doc.data);
      const buffer = this.cipher ? this.cipher.decryptBuffer(raw) : raw;
      const entry = { buffer, info: doc.info, from: doc.from, chatJid: doc.chatJid };
      this._cache.set(msgId, entry);
      return entry;
    } catch (err) {
      this.logger.warn({ err: err.message, msgId }, 'view-once: db cache read failed');
      return null;
    }
  }

  async #persist(msgId, entry) {
    if (!this.col) return;
    // BSON documents are capped at 16MB; skip persisting anything larger (stays in memory only).
    if (entry.buffer.length > 15 * 1024 * 1024) return;
    try {
      await this._indexReady;
      const data = this.cipher ? this.cipher.encryptBuffer(entry.buffer) : entry.buffer;
      await this.col.replaceOne(
        { _id: this.#docId(msgId) },
        { _id: this.#docId(msgId), data, info: entry.info, from: entry.from, chatJid: entry.chatJid, expiresAt: new Date(Date.now() + this.ttlMs) },
        { upsert: true },
      );
    } catch (err) {
      this.logger.warn({ err: err.message, msgId }, 'view-once: db cache write failed');
    }
  }

  async handle(msg) {
    if (!this.ownerJid) { this.logger.warn('view-once: no ownerJid configured'); return; }

    const info = describeMessage(msg.message);
    if (!info.viewOnce || !info.hasMedia) return;
    this.logger.info({ msgId: msg.key.id, kind: info.kind, keys: Object.keys(msg.message).join(',') }, 'view-once: received');

    const inner = unwrapInner(msg.message);
    if (!inner) { this.logger.warn({ msgId: msg.key.id }, 'view-once: could not unwrap inner media'); return; }
    inner.viewOnce = false;

    // Last known-good path: Baileys downloadMediaMessage on the full message (handles reupload on stale CDN paths)
    let buffer;
    try {
      buffer = await this.client.downloadMedia({
        key: { remoteJid: msg.key.remoteJid, id: msg.key.id, fromMe: false },
        message: msg.message,
      });
    } catch (err) {
      this.logger.warn({ err: err.message }, 'view-once: download failed, trying direct CDN');
      try {
        const stream = await this.client.downloadContent(inner, info.kind);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        buffer = Buffer.concat(chunks);
      } catch (err2) {
        this.logger.warn({ err: err2.message }, 'view-once: direct download failed');
        return;
      }
    }

    const senderResolved = resolveSender(msg.key, { selfJid: this.client.selfJid });
    const senderJid = senderResolved.jid || normalizeJid(msg.key.participant ?? msg.key.remoteJid);
    const senderNum = senderJid.split('@')[0];
    const isLid = senderJid.endsWith('@lid');
    let from;
    if (isLid && msg.pushName) from = msg.pushName;
    else if (isLid) from = `unknown (LID: ${senderNum})`;
    else from = msg.pushName ? `${msg.pushName} (+${senderNum})` : `+${senderNum}`;

    const chatJid = normalizeJid(msg.key.remoteJid);

    // Cache so ,vv can retrieve it by message ID (quoted messages have stripped media fields)
    if (msg.key.id) {
      if (this._cache.size >= 50) this._cache.delete(this._cache.keys().next().value);
      const entry = { buffer, info, from, chatJid };
      this._cache.set(msg.key.id, entry);
      await this.#persist(msg.key.id, entry);
      this.logger.info({ msgId: msg.key.id, kind: info.kind, cacheSize: this._cache.size }, 'view-once: cached');
    }

    try {
      await this.client.sendMedia(this.ownerJid, {
        kind: info.kind,
        buffer,
        mimetype: info.mimetype,
        fileName: info.fileName,
        caption: `👁️ View-once from ${from} in ${chatJid.endsWith('@g.us') ? 'a group' : 'DM'}`,
      });
    } catch (err) {
      this.logger.warn({ err: err.message }, 'view-once: forward failed');
    }
  }
}
