import { describeMessage } from '../utils/message.js';
import { normalizeJid } from '../utils/jid.js';

export class ViewOnceService {
  constructor({ client, logger, ownerJid }) {
    this.client = client;
    this.logger = logger;
    this.ownerJid = ownerJid;
  }

  async handle(msg) {
    if (!this.ownerJid) return;
    const info = describeMessage(msg.message);
    if (!info.viewOnce || !info.hasMedia) return;

    const senderJid = normalizeJid(msg.key.participant ?? msg.key.remoteJid);
    const chatJid = normalizeJid(msg.key.remoteJid);

    let buffer;
    try {
      buffer = await this.client.downloadMedia(msg);
    } catch (err) {
      this.logger.warn({ err: err.message }, 'view-once: failed to download media');
      return;
    }

    const caption = `👁️ View-once from +${senderJid.split('@')[0]} in ${chatJid.endsWith('@g.us') ? 'a group' : 'DM'}`;
    try {
      await this.client.sendMedia(this.ownerJid, {
        kind: info.kind,
        buffer,
        mimetype: info.mimetype,
        fileName: info.fileName,
        caption,
      });
    } catch (err) {
      this.logger.warn({ err: err.message }, 'view-once: failed to forward media');
    }
  }
}
