/**
 * Tracks, per chat, whether deleted-message monitoring has already been announced there.
 * Monitoring itself is a single global switch (RuntimeSettings#defaultArchiveMode, via ,delete);
 * this repository only remembers which chats have already been told about it, so the activation
 * notice fires once per chat per "on" period rather than on every message, and so deletion
 * notifications are never sent for a chat that was never actually told monitoring was happening.
 */
export class ChatsRepository {
  constructor(db, collection = 'chats', { cacheMs = 15_000, now = () => Date.now() } = {}) {
    this.col = db.collection(collection);
    this.cacheMs = cacheMs;
    this.now = now;
    this.cache = new Map();
  }

  async get(chatJid) {
    const hit = this.cache.get(chatJid);
    if (hit && hit.until > this.now()) return hit.doc;
    const doc = await this.col.findOne({ _id: chatJid });
    this.cache.set(chatJid, { doc, until: this.now() + this.cacheMs });
    return doc;
  }

  /** True once this chat has been told monitoring is active (and so may have cached messages). */
  async isMonitored(chatJid) {
    return Boolean((await this.get(chatJid))?.monitored);
  }

  async markMonitored(chatJid, { isGroup } = {}) {
    await this.col.updateOne({ _id: chatJid }, { $set: { monitored: true, isGroup: Boolean(isGroup), updatedAt: new Date() } }, { upsert: true });
    this.cache.delete(chatJid);
  }

  async countMonitored() {
    return this.col.countDocuments({ monitored: true });
  }

  /** Wipes all per-chat monitoring state (used when monitoring is turned off globally). */
  async clearAll() {
    await this.col.deleteMany({});
    this.cache.clear();
  }
}
