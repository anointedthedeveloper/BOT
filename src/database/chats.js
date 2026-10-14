const ARCHIVE_MODES = ['off', 'meta', 'full', 'media'];

/**
 * Per-chat consent state. A chat is archived ONLY after an authorised person switched it on.
 * `meta` records ids/sender/type (enough to say "a message was deleted"); `full` also keeps text;
 * `media` additionally keeps the (encrypted, short-lived) file of photos/videos/stickers/audio/documents.
 */
export class ChatsRepository {
  constructor(db, { cacheMs = 15_000, now = () => Date.now() } = {}) {
    this.col = db.collection('chats');
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

  /**
   * The chat's EXPLICITLY configured archive mode, or null if it has never been set (meaning
   * the live default — RuntimeSettings#defaultArchiveMode — applies; callers resolve that, since
   * it can change at runtime without touching every chat's own record).
   */
  async archiveMode(chatJid) {
    return (await this.get(chatJid))?.archive?.mode ?? null;
  }

  /** True once someone (or the default-activation flow) has written an explicit archive setting for this chat. */
  async isExplicitlyConfigured(chatJid) {
    return Boolean((await this.get(chatJid))?.archive);
  }

  async setArchive(chatJid, { mode, enabledBy, notifyJid, isGroup }) {
    if (!ARCHIVE_MODES.includes(mode)) throw new Error(`Invalid archive mode: ${mode}`);
    const archive = mode === 'off' ? { mode } : { mode, enabledBy, notifyJid: notifyJid ?? chatJid, enabledAt: new Date() };
    await this.col.updateOne({ _id: chatJid }, { $set: { archive, isGroup: Boolean(isGroup), updatedAt: new Date() } }, { upsert: true });
    this.cache.delete(chatJid);
  }

  async countArchived() {
    return this.col.countDocuments({ 'archive.mode': { $in: ['meta', 'full', 'media'] } });
  }

  async listArchivedBy(jid) {
    return this.col.find({ 'archive.enabledBy': jid, 'archive.mode': { $in: ['meta', 'full', 'media'] } }).toArray();
  }
}

export { ARCHIVE_MODES };
