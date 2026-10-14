import { describeMessage } from '../utils/message.js';
import { isGroupJid, isPnJid } from '../utils/jid.js';

/**
 * Captures messages while deleted-message monitoring (RuntimeSettings#defaultArchiveMode, toggled
 * with ,delete) is on, so a later deletion can be described. Monitoring is a single global switch;
 * a chat still gets a one-time visible notice the first time a message is captured there — nothing
 * is ever recorded from a chat that was not told monitoring is happening. Message bodies are only
 * kept in `full`/`media` mode and when ALLOW_CONTENT_LOGGING allows it; view-once content and
 * media bytes outside `media` mode are never stored.
 */
export class ArchiveService {
  constructor({ config, repos, logger, client, mediaStore, settings }) {
    this.client = client;
    this.mediaStore = mediaStore;
    this.config = config;
    this.repos = repos;
    this.logger = logger;
    this.settings = settings;
  }

  async record({ msg, chatJids, senderJid }) {
    const mode = this.settings.defaultArchiveMode; // single global switch, live (see ,delete)
    if (mode === 'off') return { stored: false, reason: 'monitoring-off' };

    if (!chatJids.length) return { stored: false, reason: 'no-chat' };
    // Prefer the phone-number form as the canonical/displayed chat id when both are known (a LID
    // like "9988@lid" is far less readable in a notification than "+15551234567").
    const chatJid = chatJids.find(isPnJid) ?? chatJids[0];
    const chatAlt = chatJids.find((j) => j !== chatJid) ?? null;

    // First message captured in this chat since monitoring last turned on: tell the chat, once.
    const alreadyMonitored = (await Promise.all(chatJids.map((j) => this.repos.chats.isMonitored(j)))).some(Boolean);
    if (!alreadyMonitored) {
      await this.repos.chats.markMonitored(chatJid, { isGroup: isGroupJid(chatJid) });
    }

    const info = describeMessage(msg.message);
    if (['protocol', 'reaction'].includes(info.kind)) return { stored: false, reason: 'not-a-message' };

    let contentStored = false;
    let reason = null;
    if (info.viewOnce) reason = 'view-once content is never stored';
    else if (mode === 'meta') reason = 'monitoring mode is metadata-only';
    else if (!this.config.privacy.allowContentLogging) reason = 'content logging disabled by operator';
    else contentStored = Boolean(info.text);

    let mediaFile = null;
    if (info.hasMedia && !reason) {
      if (mode !== 'media') reason = 'media files are not retained in this mode';
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
          this.logger.warn({ err: err.message }, 'could not cache media for deletion recovery');
          reason = 'media could not be downloaded';
        }
      }
    } else if (info.hasMedia && reason === 'monitoring mode is metadata-only') {
      reason = 'media files are not retained in this mode';
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

  /** Turns monitoring fully off: no chat stays "monitored", and every cached message/file is wiped. */
  async disableAndWipe() {
    const { mediaPaths } = await this.repos.messageCache.clearAll();
    await this.mediaStore.removeMany(mediaPaths);
    await this.repos.chats.clearAll();
  }

  noticeFor(mode, ttlHours) {
    const what = {
      meta: 'only basic details (sender, time, type) — no message text and no files',
      full: 'message *text* and basic details (sender, time, type) — no files',
      media: 'message *text*, basic details, and *photos, videos, stickers, audio and documents* (size-limited, encrypted)',
    }[mode];
    return [
      `📦 Deleted-message monitoring is now *ON (${mode})* for this chat.`,
      `The bot keeps ${what} of messages it receives here for ${ttlHours}h, solely to recover a deleted message's content. It notifies the bot owner privately when a message here is deleted.`,
      'View-once content is never stored.',
    ].join('\n');
  }
}
