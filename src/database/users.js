export const DEFAULT_PREFS = Object.freeze({
  notifyDeletes: true,
  ackReactions: false,
  timezone: 'UTC',
  contentLogging: true, // sender-level opt-out of content capture in archived chats
});

export class UsersRepository {
  constructor(db, { defaultRetentionDays = 30 } = {}) {
    this.col = db.collection('users');
    this.defaultRetentionDays = defaultRetentionDays;
  }

  defaults() {
    return { ...DEFAULT_PREFS, retentionDays: this.defaultRetentionDays };
  }

  /** Returns the user, creating a row with default preferences on first contact. */
  async ensure(jid) {
    const now = new Date();
    const doc = await this.col.findOneAndUpdate(
      { _id: jid },
      {
        $setOnInsert: { role: 'user', allowed: false, banned: false, seq: 0, prefs: {}, createdAt: now },
        $set: { lastSeenAt: now },
      },
      { upsert: true, returnDocument: 'after' },
    );
    return this.#hydrate(doc);
  }

  async get(jid) {
    const doc = await this.col.findOne({ _id: jid });
    return doc ? this.#hydrate(doc) : null;
  }

  #hydrate(doc) {
    return { ...doc, jid: doc._id, prefs: { ...this.defaults(), ...(doc.prefs ?? {}) } };
  }

  async setPref(jid, key, value) {
    await this.ensure(jid);
    await this.col.updateOne({ _id: jid }, { $set: { [`prefs.${key}`]: value } });
  }

  async resetPrefs(jid) {
    await this.col.updateOne({ _id: jid }, { $set: { prefs: {} } });
  }

  async setRole(jid, role) {
    await this.ensure(jid);
    await this.col.updateOne({ _id: jid }, { $set: { role } });
  }

  async setAllowed(jid, allowed) {
    await this.ensure(jid);
    await this.col.updateOne({ _id: jid }, { $set: { allowed } });
  }

  async setBanned(jid, banned, reason = null) {
    await this.ensure(jid);
    await this.col.updateOne(
      { _id: jid },
      banned ? { $set: { banned: true, banReason: reason, bannedAt: new Date() } } : { $set: { banned: false }, $unset: { banReason: '', bannedAt: '' } },
    );
  }

  /** Atomic per-user counter used to number saved items (#1, #2…). */
  async nextSeq(jid) {
    const doc = await this.col.findOneAndUpdate(
      { _id: jid },
      { $inc: { seq: 1 }, $setOnInsert: { role: 'user', allowed: false, banned: false, prefs: {}, createdAt: new Date() } },
      { upsert: true, returnDocument: 'after' },
    );
    return doc.seq;
  }

  async listPrivileged() {
    return (await this.col.find({ $or: [{ role: 'admin' }, { banned: true }, { allowed: true }] }).sort({ _id: 1 }).limit(200).toArray()).map((d) => this.#hydrate(d));
  }

  count() {
    return this.col.estimatedDocumentCount();
  }

  async delete(jid) {
    await this.col.deleteOne({ _id: jid });
  }
}
