import { scoreMatch, snippet } from '../utils/text.js';

export const ITEM_TYPES = ['note', 'bookmark', 'saved'];
const SEARCH_SCAN_LIMIT = 2000;

/**
 * Notes, bookmarks and saved messages share one collection. User-visible text is encrypted at rest
 * when DATA_ENCRYPTION_KEY is configured, so search is performed in memory over the owner's own
 * (bounded) item set rather than via a database text index.
 */
export class ItemsRepository {
  constructor(db, { users, cipher, now = () => new Date() }) {
    this.col = db.collection('items');
    this.users = users;
    this.cipher = cipher;
    this.now = now;
  }

  #hydrate(d) {
    if (!d) return null;
    return {
      ...d,
      text: this.cipher.decryptText(d.text) ?? '',
      note: this.cipher.decryptText(d.note) ?? '',
      ref: d.ref ? { ...d.ref, excerpt: this.cipher.decryptText(d.ref.excerpt) ?? '' } : null,
    };
  }

  async create(userJid, { type, text = '', note = '', tags = [], ref = null, media = null, retentionDays = 0 }) {
    if (!ITEM_TYPES.includes(type)) throw new Error(`Unknown item type ${type}`);
    const seq = await this.users.nextSeq(userJid);
    const createdAt = this.now();
    const doc = {
      userJid, seq, type, tags,
      text: this.cipher.encryptText(text),
      note: this.cipher.encryptText(note),
      ref: ref ? { ...ref, excerpt: this.cipher.encryptText(ref.excerpt ?? '') } : null,
      media,
      createdAt,
      expiresAt: retentionDays > 0 ? new Date(createdAt.getTime() + retentionDays * 86_400_000) : null,
    };
    await this.col.insertOne(doc);
    return this.#hydrate(doc);
  }

  count(userJid, type) {
    return this.col.countDocuments({ userJid, ...(type ? { type } : {}) });
  }

  async list(userJid, { type, limit = 10, skip = 0 } = {}) {
    const docs = await this.col.find({ userJid, ...(type ? { type } : {}) }).sort({ seq: -1 }).skip(skip).limit(limit).toArray();
    return docs.map((d) => this.#hydrate(d));
  }

  async get(userJid, seq, type) {
    return this.#hydrate(await this.col.findOne({ userJid, seq, ...(type ? { type } : {}) }));
  }

  /** Deletes one item; returns the removed document so callers can clean up media files. */
  async delete(userJid, seq, type) {
    const doc = await this.col.findOneAndDelete({ userJid, seq, ...(type ? { type } : {}) });
    return this.#hydrate(doc);
  }

  async search(userJid, { terms = [], type, tag, limit = 10 }) {
    const filter = { userJid, ...(type ? { type } : {}), ...(tag ? { tags: tag.toLowerCase() } : {}) };
    const docs = await this.col.find(filter).sort({ seq: -1 }).limit(SEARCH_SCAN_LIMIT).toArray();
    const results = [];
    for (const raw of docs) {
      const d = this.#hydrate(raw);
      const hay = [d.text, d.note, d.ref?.excerpt, d.media?.fileName, d.tags.join(' ')].filter(Boolean).join('\n');
      const score = terms.length ? scoreMatch(hay, terms) : 1;
      if (score > 0) results.push({ item: d, score, snippet: snippet(d.text || d.note || d.ref?.excerpt || d.media?.fileName || '', terms) });
    }
    results.sort((a, b) => b.score - a.score || b.item.seq - a.item.seq);
    return results.slice(0, limit);
  }

  /** Removes all of a user's items; returns media file paths to delete from disk. */
  async deleteAllForUser(userJid) {
    const docs = await this.col.find({ userJid }, { projection: { media: 1 } }).toArray();
    await this.col.deleteMany({ userJid });
    return docs.map((d) => d.media?.path).filter(Boolean);
  }

  /** Removes items past their retention date; returns media file paths to delete from disk. */
  async deleteExpired(now = this.now()) {
    const filter = { expiresAt: { $ne: null, $lte: now } };
    const docs = await this.col.find(filter, { projection: { media: 1 } }).toArray();
    if (!docs.length) return { removed: 0, mediaPaths: [] };
    await this.col.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
    return { removed: docs.length, mediaPaths: docs.map((d) => d.media?.path).filter(Boolean) };
  }

  async exportAll(userJid) {
    return (await this.col.find({ userJid }).sort({ seq: 1 }).toArray()).map((d) => {
      const h = this.#hydrate(d);
      return { id: h.seq, type: h.type, text: h.text, note: h.note, tags: h.tags, reference: h.ref, media: h.media ? { kind: h.media.kind, fileName: h.media.fileName, size: h.media.size } : null, createdAt: h.createdAt, expiresAt: h.expiresAt };
    });
  }
}
