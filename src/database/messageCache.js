/**
 * Short-lived store of messages received in archived chats, used to describe deleted messages.
 * Documents expire automatically via a TTL index. Media bytes are never stored here.
 */
export class MessageCacheRepository {
  constructor(db, { cipher, ttlHours, now = () => new Date() }) {
    this.col = db.collection('message_cache');
    this.cipher = cipher;
    this.ttlMs = ttlHours * 3_600_000;
    this.now = now;
  }

  async record({ chatJid, chatAlt, msgId, senderJid, fromMe, timestamp, kind, text, contentStored, reason, mediaMeta }) {
    const createdAt = this.now();
    await this.col.updateOne(
      { chatJid, msgId },
      {
        $setOnInsert: {
          chatJid, chatAlt: chatAlt ?? null, msgId, senderJid, fromMe: Boolean(fromMe), timestamp, kind,
          text: contentStored ? this.cipher.encryptText(text ?? '') : null,
          contentStored: Boolean(contentStored),
          reason: reason ?? null,
          mediaMeta: mediaMeta ?? null,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + this.ttlMs),
        },
      },
      { upsert: true },
    );
  }

  async find(chatJids, msgId) {
    const ids = [...new Set(chatJids.filter(Boolean))];
    const doc = await this.col.findOne({ msgId, $or: [{ chatJid: { $in: ids } }, { chatAlt: { $in: ids } }] });
    if (!doc) return null;
    return { ...doc, text: doc.contentStored ? this.cipher.decryptText(doc.text) : null };
  }

  async remove(chatJids, msgId) {
    const ids = [...new Set(chatJids.filter(Boolean))];
    await this.col.deleteOne({ msgId, $or: [{ chatJid: { $in: ids } }, { chatAlt: { $in: ids } }] });
  }

  async deleteForChat(chatJid) {
    return (await this.col.deleteMany({ $or: [{ chatJid }, { chatAlt: chatJid }] })).deletedCount;
  }

  /** Removes everything cached for messages sent by one person (used by /privacy purge). */
  async deleteForSender(senderJid) {
    return (await this.col.deleteMany({ senderJid })).deletedCount;
  }

  count() {
    return this.col.estimatedDocumentCount();
  }
}
