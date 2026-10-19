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
  }

  async handle(msg) {
    if (!this.ownerJid || msg.key.fromMe) return;

    // If the bot IS the owner (same number), auto-forward via this service would send to
    // self-chat (Saved Messages) and the echo could trigger a re-process loop.
    // In this case we skip the auto-forward — the owner can use ,vv manually instead.
    const selfNum = this.client.selfJid ? normalizeJid(this.client.selfJid).split('@')[0] : null;
    const ownerNum = this.ownerJid.split('@')[0];
    if (selfNum && selfNum === ownerNum) return;

    const info = describeMessage(msg.message);
    if (!info.viewOnce || !info.hasMedia) return;

    // same mutation trick that makes vv work
    const inner = unwrapInner(msg.message);
    if (!inner) return;
    inner.viewOnce = false;

    // same fake msg pattern that vv uses
    const fakeMsgForDownload = {
      key: { remoteJid: msg.key.remoteJid, id: msg.key.id, fromMe: false },
      message: msg.message,
    };

    let buffer;
    try {
      buffer = await this.client.downloadMedia(fakeMsgForDownload);
    } catch (err) {
      this.logger.warn({ err: err.message }, 'view-once: download failed');
      return;
    }

    const senderResolved = resolveSender(msg.key, { selfJid: this.client.selfJid });
    // Prefer phone-number JID over LID so the caption shows a real number.
    const senderJid = senderResolved.jid || normalizeJid(msg.key.participant ?? msg.key.remoteJid);
    const senderNum = senderJid.split('@')[0];
    const isLid = senderJid.endsWith('@lid');

    this.logger.info({
      remoteJid: msg.key.remoteJid,
      remoteJidAlt: msg.key.remoteJidAlt ?? '(none)',
      participant: msg.key.participant ?? '(none)',
      participantAlt: msg.key.participantAlt ?? '(none)',
      resolvedJid: senderJid,
      isLid,
      pushName: msg.pushName ?? '(none)',
    }, 'view-once: sender resolution');

    // If we still ended up with a LID and pushName is available, use pushName only
    // to avoid showing a meaningless internal ID in the caption.
    let from;
    if (isLid && msg.pushName) {
      from = msg.pushName;
    } else if (isLid) {
      from = `unknown (LID: ${senderNum})`;
    } else {
      from = msg.pushName ? `${msg.pushName} (+${senderNum})` : `+${senderNum}`;
    }
    const chatJid = normalizeJid(msg.key.remoteJid);

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
