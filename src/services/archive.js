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
  constructor({ config, repos, logger, client, mediaStore, settings, ownerJid }) {
    this.client = client;
    this.mediaStore = mediaStore;
    this.config = config;
    this.repos = repos;
    this.logger = logger;
    this.settings = settings;
    this.ownerJid = ownerJid ?? null; // used only when defaultArchiveTarget is 'dm'
  }

  async record({ msg, chatJids, senderJid }) {
    // The same chat can be addressed by phone-number JID or LID: honour whichever form was configured.
    let chatJid = null;
    let mode = 'off';
    let explicit = true;
    for (const candidate of chatJids) {
      const raw = await this.repos.chats.archiveMode(candidate);
      const effective = raw ?? this.settings.defaultArchiveMode; // the live, runtime-toggleable default (see /delete)
      if (effective !== 'off') {
        chatJid = candidate;
        mode = effective;
        explicit = raw !== null;
        break;
      }
    }
    if (!chatJid) return { stored: false, reason: 'chat-not-archived' };
    const chatAlt = chatJids.find((j) => j !== chatJid) ?? null;

    // First message in a chat that is archiving only because of the live default (DEFAULT_ARCHIVE_MODE
    // or /delete on), not an explicit per-chat setting: persist an explicit record (so this only
    // happens once) and post the same visible notice a manual /privacy archive command would —
    // nothing here is ever silent to the chat, regardless of where recovered content ends up.
    if (!explicit) {
      const isGroup = isGroupJid(chatJid);
      const toDm = this.settings.defaultArchiveTarget === 'dm' && this.ownerJid;
      const notifyJid = toDm ? this.ownerJid : chatJid;
      const where = toDm ? 'sent privately to the bot owner, not shown in this chat' : 'shown back here, in this chat';
      await this.repos.chats.setArchive(chatJid, { mode, enabledBy: null, notifyJid, isGroup });
      try {
        await this.client.sendText(chatJid, `${this.noticeFor(mode, this.config.privacy.cacheTtlHours)}\n\n_(turned on automatically — deleted messages will be ${where})_`);
      } catch (err) {
        this.logger.warn({ err: err.message }, 'failed to post default-archiving notice');
      }
    }

    const info = describeMessage(msg.message);
    if (['protocol', 'reaction'].includes(info.kind)) return { stored: false, reason: 'not-a-message' };

    let contentStored = false;
    let reason = null;
    let optedOut = false;
    if (info.viewOnce) reason = 'view-once content is never stored';
    else if (mode === 'meta') reason = 'chat archive mode is metadata-only';
    else if (!this.config.privacy.allowContentLogging) reason = 'content logging disabled by operator';
    else {
      const sender = await this.repos.users.get(senderJid);
      optedOut = sender?.prefs.contentLogging === false;
      if (optedOut) reason = 'sender opted out of content logging';
      else contentStored = Boolean(info.text);
    }

    let mediaFile = null;
    if (info.hasMedia && !reason) {
      if (mode !== 'media') reason = 'media files are not retained in this archive mode';
      else if (!this.config.privacy.allowMediaCaching) reason = 'media caching disabled by operator';
      else if (!info.size || info.size > this.config.media.maxBytes) reason = 'media is larger than the size limit';
      else {
        try {
          const buffer = await this.client.downloadMedia(msg);
          if (buffer.length > this.config.media.maxBytes) reason = 'media is larger than the size limit';
          else {
            const saved = await this.mediaStore.save(`cache:${chatJid}`, buffer);
            mediaFile = { path: saved.path, kind: info.kind, mimetype: info.mimetype, fileName: info.fileName, size: saved.size };
          }
        } catch (err) {
          this.logger.warn({ err: err.message }, 'could not cache media of archived chat');
          reason = 'media could not be downloaded';
        }
      }
    } else if (info.hasMedia && reason === 'chat archive mode is metadata-only') {
      reason = 'media files are not retained in this archive mode';
    }
    if (!reason && !contentStored && !mediaFile) reason = 'no text content';

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
      mediaFile,
    });
    return { stored: true, contentStored, mediaStored: Boolean(mediaFile), reason };
  }

  /** Enables/disables archiving. Turning it off wipes the chat's cache, including cached files. */
  async setMode({ chatJid, mode, enabledBy, notifyJid }) {
    const isGroup = isGroupJid(chatJid);
    await this.repos.chats.setArchive(chatJid, { mode, enabledBy, notifyJid, isGroup });
    if (mode === 'off') {
      const files = await this.repos.messageCache.mediaPathsForChat(chatJid);
      const removed = await this.repos.messageCache.deleteForChat(chatJid);
      await this.mediaStore.removeMany(files);
      return { removed };
    }
    return { removed: 0 };
  }

  noticeFor(mode, ttlHours) {
    if (mode === 'off') return '🛑 Message archiving is now *OFF* for this chat. Cached messages and files were deleted.';
    const what = {
      meta: 'only basic details (sender, time, type) — no message text and no files',
      full: 'message *text* and basic details (sender, time, type) — no files',
      media: 'message *text*, basic details, and *photos, videos, stickers, audio and documents* (size-limited, encrypted)',
    }[mode];
    return [
      `📦 Message archiving is now *ON (${mode})* for this chat.`,
      `The bot keeps ${what} of messages it receives here for ${ttlHours}h, solely to recover a deleted message's content.`,
      'View-once content is never stored.',
      'Anyone can opt out of capture with the "logging off" option of the privacy command, or turn the chat off with "archive off".',
    ].join('\n');
  }
}
