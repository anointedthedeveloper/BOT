import { describeMessage } from '../utils/message.js';
import { isGroupJid } from '../utils/jid.js';

/**
 * Pure authorisation rule for switching archiving on/off in a chat.
 *  - The owner may configure any chat (a visible notice is always posted in the chat).
 *  - Anyone else may only configure their own one-to-one chat with the bot account.
 *  - Nobody but the owner can enable archiving in a group.
 */
export function canConfigureArchive({ isOwner, isGroup, senderCandidates, chatJids }) {
  if (isOwner) return true;
  if (isGroup) return false;
  return senderCandidates.some((c) => chatJids.includes(c));
}

/**
 * Records messages from archived chats so deletions can be described later.
 * Nothing is recorded unless a chat was explicitly switched on; message bodies are only kept in
 * `full` mode, when the sender has not opted out, and when ALLOW_CONTENT_LOGGING is true.
 * View-once content and media bytes are never stored.
 */
export class ArchiveService {
  constructor({ config, repos, logger }) {
    this.config = config;
    this.repos = repos;
    this.logger = logger;
  }

  async record({ msg, chatJids, senderJid }) {
    // The same chat can be addressed by phone-number JID or LID: honour whichever form was configured.
    let chatJid = null;
    let mode = 'off';
    for (const candidate of chatJids) {
      mode = await this.repos.chats.archiveMode(candidate);
      if (mode !== 'off') {
        chatJid = candidate;
        break;
      }
    }
    if (!chatJid) return { stored: false, reason: 'chat-not-archived' };
    const chatAlt = chatJids.find((j) => j !== chatJid) ?? null;

    const info = describeMessage(msg.message);
    if (['protocol', 'reaction'].includes(info.kind)) return { stored: false, reason: 'not-a-message' };

    let contentStored = false;
    let reason = null;
    if (info.viewOnce) reason = 'view-once content is never stored';
    else if (mode !== 'full') reason = 'chat archive mode is metadata-only';
    else if (!this.config.privacy.allowContentLogging) reason = 'content logging disabled by operator';
    else {
      const sender = await this.repos.users.get(senderJid);
      if (sender && sender.prefs.contentLogging === false) reason = 'sender opted out of content logging';
      else contentStored = Boolean(info.text);
      if (!reason && !info.text) reason = info.hasMedia ? 'media files are not retained' : 'no text content';
    }

    await this.repos.messageCache.record({
      chatJid,
      chatAlt,
      msgId: msg.key.id,
      senderJid,
      fromMe: msg.key.fromMe,
      timestamp: Number(msg.messageTimestamp?.toString?.() ?? msg.messageTimestamp ?? Math.floor(Date.now() / 1000)),
      kind: info.viewOnce ? 'view-once' : info.kind,
      text: contentStored ? info.text : null,
      contentStored,
      reason,
      mediaMeta: info.hasMedia ? { mimetype: info.mimetype, fileName: info.fileName, size: info.size } : null,
    });
    return { stored: true, contentStored, reason };
  }

  /** Enables/disables archiving. Returns the notice text to post in the chat. */
  async setMode({ chatJid, mode, enabledBy, notifyJid }) {
    const isGroup = isGroupJid(chatJid);
    await this.repos.chats.setArchive(chatJid, { mode, enabledBy, notifyJid, isGroup });
    if (mode === 'off') {
      const removed = await this.repos.messageCache.deleteForChat(chatJid);
      return { removed };
    }
    return { removed: 0 };
  }

  noticeFor(mode, ttlHours) {
    if (mode === 'off') return '🛑 Message archiving is now *OFF* for this chat. Cached messages were deleted.';
    const what = mode === 'full'
      ? 'message *text* and basic details (sender, time, type)'
      : 'only basic details (sender, time, type) — no message text';
    return [
      `📦 Message archiving is now *ON (${mode})* for this chat.`,
      `The bot keeps ${what} of messages it receives here for ${ttlHours}h, solely to describe deletions to the person who enabled it.`,
      'Media files and view-once content are never stored.',
      'Anyone can opt out of text capture with the "logging off" option of the privacy command, or turn the chat off with "archive off".',
    ].join('\n');
  }
}
