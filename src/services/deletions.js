import { KIND_ICON } from '../utils/message.js';
import { formatDate, formatBytes } from '../utils/text.js';
import { normalizeJid } from '../utils/jid.js';

export const REVOKE_STUB_TYPE = 1; // proto.WebMessageInfo.StubType.REVOKE (asserted in tests)

export function isRevokeUpdate(u) {
  return u?.update?.messageStubType === REVOKE_STUB_TYPE;
}

/**
 * Turns "message revoked" events into a private notification to the bot owner. Three distinct
 * outcomes, never conflated:
 *   - 'original-available'  the bot had stored the content while monitoring was on
 *   - 'metadata-only'       the bot saw the message but did not (or may not) keep its content
 *   - 'unknown-original'    the bot never received/stored the message: only the event is known
 * A chat that was never told monitoring is on produces no notification at all.
 */
export class DeletionNotifier {
  constructor({ repos, client, logger, mediaStore, ttlHours, ownerJid }) {
    this.mediaStore = mediaStore;
    this.repos = repos;
    this.client = client;
    this.logger = logger;
    this.ttlHours = ttlHours;
    this.ownerJid = ownerJid;
  }

  async handleUpdates(updates) {
    const results = [];
    for (const u of updates) if (isRevokeUpdate(u)) results.push(await this.#handleOne(u));
    return results.filter(Boolean);
  }

  async #handleOne(u) {
    const key = u.key ?? {};
    const chatJids = [normalizeJid(key.remoteJid), normalizeJid(key.remoteJidAlt)].filter(Boolean);
    if (!chatJids.length || !key.id || !this.ownerJid) return null;

    const monitored = (await Promise.all(chatJids.map((j) => this.repos.chats.isMonitored(j)))).some(Boolean);
    if (!monitored) return null; // this chat was never told monitoring is happening -> no notification
    if (key.fromMe) return { outcome: 'self-deleted', notified: false }; // the account holder deleted it themself

    const cached = await this.repos.messageCache.find(chatJids, key.id);
    const outcome = !cached ? 'unknown-original' : cached.contentStored || cached.mediaFile ? 'original-available' : 'metadata-only';
    const text = this.#format(outcome, cached, key, chatJids[0], u.pushName);

    try {
      await this.client.sendText(this.ownerJid, text);
    } catch (err) {
      this.logger.warn({ err: err.message, outcome }, 'failed to send deletion notification');
      return { outcome, notified: false, error: err.message };
    }
    if (cached?.mediaFile) await this.#resendMedia(this.ownerJid, cached);
    if (cached) {
      await this.repos.messageCache.remove(chatJids, key.id); // delivered once; don't keep deleted content around
      if (cached.mediaFile) await this.mediaStore.remove(cached.mediaFile.path);
    }
    this.logger.info({ outcome }, 'deletion notification sent');
    return { outcome, notified: true };
  }

  async #resendMedia(target, c) {
    try {
      const buffer = await this.mediaStore.read(c.mediaFile.path);
      await this.client.sendMedia(target, { kind: c.mediaFile.kind, buffer, mimetype: c.mediaFile.mimetype, fileName: c.mediaFile.fileName, caption: c.text || undefined });
    } catch (err) {
      this.logger.warn({ err: err.message }, 'failed to re-send cached media');
      await this.client.sendText(target, '⚠️ The deleted file was captured but could not be re-sent.').catch(() => {});
    }
  }

  #format(outcome, c, key, chatJid, pushName) {
    const where = chatJid.endsWith('@g.us') ? 'a group chat' : `chat with ${this.#label(chatJid)}`;
    const deletedBy = key.participant ? this.#label(key.participant) : null;
    if (outcome === 'unknown-original') {
      return [
        '🗑️ *Deleted message detected* — original NOT available',
        `A message was deleted in ${where}.`,
        'The bot has no record of it (it was sent before monitoring was enabled, was not received, or has expired), so its content cannot be shown.',
        deletedBy ? `Deleted by: ${deletedBy}` : null,
      ].filter(Boolean).join('\n');
    }
    const head = [
      outcome === 'original-available' ? '🗑️ *Deleted message* — original content available' : '🗑️ *Deleted message detected* — content not stored',
      `Chat: ${where}`,
      `From: ${this.#label(c.senderJid, c.pushName ?? pushName)}${c.fromMe ? ' (you)' : ''}`,
      `Sent: ${formatDate(c.timestamp * 1000, 'UTC')}`,
      `Type: ${KIND_ICON[c.kind] ?? ''} ${c.kind}${c.mediaMeta?.size ? ` (${formatBytes(c.mediaMeta.size)})` : ''}`,
      deletedBy && deletedBy !== this.#label(c.senderJid) ? `Deleted by: ${deletedBy}` : null,
    ].filter(Boolean);
    if (outcome === 'original-available') {
      const lines = [...head, ''];
      if (c.text) lines.push('Original text (captured while monitored):', c.text);
      if (c.mediaFile) lines.push(`Original ${c.mediaFile.kind} captured while monitored — sent below.`);
      return lines.join('\n');
    }
    return [...head, `Why no content: ${c.reason ?? 'not captured'}.`].join('\n');
  }

  #label(jid, name) {
    const n = normalizeJid(jid);
    const user = n.split('@')[0];
    const number = n.endsWith('@s.whatsapp.net') ? `+${user}` : n.endsWith('@lid') ? `contact …${user.slice(-4)}` : user;
    return name ? `${name} (${number})` : number;
  }
}
