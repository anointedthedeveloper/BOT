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
  constructor({ client, logger, ownerJid }) {
    this.client = client;
    this.logger = logger;
    this.ownerJid = ownerJid;
    // Cache: msgId -> { buffer, info, from, chatJid }
    this._cache = new Map();
  }

  getCache(msgId) {
    return this._cache.get(msgId) ?? null;
  }

  async handle(msg) {
    if (!this.ownerJid) return;

    const info = describeMessage(msg.message);
    if (!info.viewOnce || !info.hasMedia) return;

    const inner = unwrapInner(msg.message);
    if (!inner) return;
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
      this._cache.set(msg.key.id, { buffer, info, from, chatJid });
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
