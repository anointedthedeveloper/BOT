import { KIND_ICON } from '../utils/message.js';
import { formatDate, formatBytes } from '../utils/text.js';
import { maskJid, normalizeJid } from '../utils/jid.js';

export const REVOKE_STUB_TYPE = 1; // proto.WebMessageInfo.StubType.REVOKE (asserted in tests)

export function isRevokeUpdate(u) {
  return u?.update?.messageStubType === REVOKE_STUB_TYPE;
}

/**
 * Turns "message revoked" events into notifications. Three distinct outcomes, never conflated:
 *   - 'original-available'  the bot had stored the text while the chat was archived
 *   - 'metadata-only'       the bot saw the message but did not (or may not) keep its content
 *   - 'unknown-original'    the bot never received/stored the message: only the event is known
 * Chats that are not archived produce no notification at all.
 */
export class DeletionNotifier {
  constructor({ repos, client, logger, ttlHours }) {
    this.repos = repos;
    this.client = client;
    this.logger = logger;
    this.ttlHours = ttlHours;
  }

  async handleUpdates(updates) {
    const results = [];
    for (const u of updates) if (isRevokeUpdate(u)) results.push(await this.#handleOne(u));
    return results.filter(Boolean);
  }

  async #handleOne(u) {
    const key = u.key ?? {};
    const chatJids = [normalizeJid(key.remoteJid), normalizeJid(key.remoteJidAlt)].filter(Boolean);
    if (!chatJids.length || !key.id) return null;

    const chat = await this.repos.chats.get(chatJids[0]) ?? (chatJids[1] ? await this.repos.chats.get(chatJids[1]) : null);
    if (!chat?.archive || chat.archive.mode === 'off') return null; // no consent -> no notification
    if (key.fromMe) return { outcome: 'self-deleted', notified: false }; // the account holder deleted it themself

    const target = chat.archive.notifyJid ?? chatJids[0];
    const enabler = await this.repos.users.get(chat.archive.enabledBy);
    if (enabler && enabler.prefs.notifyDeletes === false) return { outcome: 'notifications-off', notified: false };

    const cached = await this.repos.messageCache.find(chatJids, key.id);
    const outcome = !cached ? 'unknown-original' : cached.contentStored ? 'original-available' : 'metadata-only';
    const tz = enabler?.prefs.timezone ?? 'UTC';
    const text = this.#format(outcome, cached, key, chatJids[0], tz);

    try {
      await this.client.sendText(target, text);
    } catch (err) {
      this.logger.warn({ err: err.message, outcome }, 'failed to send deletion notification');
      return { outcome, notified: false, error: err.message };
    }
    if (cached) await this.repos.messageCache.remove(chatJids, key.id); // delivered once; don't keep deleted content around
    this.logger.info({ outcome, chat: maskJid(chatJids[0]) }, 'deletion notification sent');
    return { outcome, notified: true };
  }

  #format(outcome, c, key, chatJid, tz) {
    const where = chatJid.endsWith('@g.us') ? 'a group chat' : `chat with ${this.#label(chatJid)}`;
    const deletedBy = key.participant ? this.#label(key.participant) : null;
    if (outcome === 'unknown-original') {
      return [
        '🗑️ *Deleted message detected* — original NOT available',
        `A message was deleted in ${where}.`,
        'The bot has no record of it (it was sent before archiving was enabled, was not received, or has expired), so its content cannot be shown.',
        deletedBy ? `Deleted by: ${deletedBy}` : null,
      ].filter(Boolean).join('\n');
    }
    const head = [
      outcome === 'original-available' ? '🗑️ *Deleted message* — original content available' : '🗑️ *Deleted message detected* — content not stored',
      `Chat: ${where}`,
      `From: ${this.#label(c.senderJid)}${c.fromMe ? ' (you)' : ''}`,
      `Sent: ${formatDate(c.timestamp * 1000, tz)}`,
      `Type: ${KIND_ICON[c.kind] ?? ''} ${c.kind}${c.mediaMeta?.size ? ` (${formatBytes(c.mediaMeta.size)})` : ''}`,
      deletedBy && deletedBy !== this.#label(c.senderJid) ? `Deleted by: ${deletedBy}` : null,
    ].filter(Boolean);
    if (outcome === 'original-available') return [...head, '', 'Original text (captured while this chat was archived):', c.text].join('\n');
    return [...head, `Why no content: ${c.reason ?? 'not captured'}.`].join('\n');
  }

  #label(jid) {
    const n = normalizeJid(jid);
    const user = n.split('@')[0];
    return n.endsWith('@s.whatsapp.net') ? `+${user}` : n.endsWith('@lid') ? `contact …${user.slice(-4)}` : user;
  }
}
