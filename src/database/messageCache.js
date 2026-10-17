/**
 * Short-lived store of messages received in archived chats, used to describe deleted messages.
 * Documents expire automatically via a TTL index. Media bytes are never stored here.
 */
export class MessageCacheRepository {
  constructor(db, { cipher, ttlHours, now = () => new Date() }, collection = 'message_cache') {
    this.col = db.collection(collection);
    this.cipher = cipher;
    this.ttlMs = ttlHours * 3_600_000;
    this.now = now;
  }

  async record({ chatJid, chatAlt, msgId, senderJid, fromMe, timestamp, kind, text, contentStored, reason, mediaMeta, mediaFile, pushName }) {
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
          pushName: pushName ?? null,
          createdAt,
          mediaFile: mediaFile ?? null,
          // Documents with a file on disk are swept by the retention job (so the file goes too);
          // all others expire through the MongoDB TTL index on `expiresAt`.
          ...(mediaFile ? { sweepAt: new Date(createdAt.getTime() + this.ttlMs) } : { expiresAt: new Date(createdAt.getTime() + this.ttlMs) }),
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

  /** Removes cached messages whose media file is past its lifetime; returns the file paths to delete. */
  async deleteExpiredMedia(now = this.now()) {
    const docs = await this.col.find({ sweepAt: { $lte: now } }, { projection: { mediaFile: 1 } }).toArray();
    if (!docs.length) return { removed: 0, mediaPaths: [] };
    await this.col.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
    return { removed: docs.length, mediaPaths: docs.map((d) => d.mediaFile?.path).filter(Boolean) };
  }

  /** Wipes every cached message (used when monitoring is turned off entirely); returns media file paths to delete. */
  async clearAll() {
    const docs = await this.col.find({ mediaFile: { $ne: null } }, { projection: { mediaFile: 1 } }).toArray();
    const removed = await this.col.deleteMany({});
    return { removed: removed.deletedCount, mediaPaths: docs.map((d) => d.mediaFile?.path).filter(Boolean) };
  }

  count() {
    return this.col.estimatedDocumentCount();
  }
}
