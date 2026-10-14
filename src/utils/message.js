/**
 * Pure helpers that interpret Baileys/WhatsApp message payloads (proto objects or plain JSON).
 * No network or library calls, so they are trivially unit-testable.
 */

const WRAPPERS = [
  'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension',
  'documentWithCaptionMessage', 'editedMessage',
];
const VIEW_ONCE_WRAPPERS = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];
const MEDIA = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  stickerMessage: 'sticker',
};

/** Unwraps ephemeral / view-once / edited containers, reporting whether a view-once wrapper was crossed. */
export function unwrapMessage(message) {
  let content = message;
  let viewOnce = false;
  for (let i = 0; i < 5 && content; i++) {
    const wrapper = WRAPPERS.find((w) => content[w]?.message);
    if (!wrapper) break;
    if (VIEW_ONCE_WRAPPERS.includes(wrapper)) viewOnce = true;
    content = content[wrapper].message;
  }
  return { content: content ?? null, viewOnce };
}

/**
 * Describes a message: kind, text/caption and media metadata (never the media itself).
 * `viewOnce` is true for any view-once container or media flagged viewOnce.
 */
export function describeMessage(message) {
  const { content, viewOnce: wrapped } = unwrapMessage(message);
  if (!content) return { kind: 'other', text: '', viewOnce: wrapped, hasMedia: false };

  const mediaKey = Object.keys(MEDIA).find((k) => content[k]);
  if (mediaKey) {
    const m = content[mediaKey];
    return {
      kind: MEDIA[mediaKey],
      text: m.caption ?? '',
      mimetype: m.mimetype ?? null,
      fileName: m.fileName ?? null,
      size: Number(m.fileLength?.toString?.() ?? m.fileLength ?? 0) || null,
      viewOnce: wrapped || Boolean(m.viewOnce),
      hasMedia: true,
      mediaKey,
    };
  }
  const text = content.conversation ?? content.extendedTextMessage?.text ?? '';
  if (text || content.conversation === '' || content.extendedTextMessage) {
    return { kind: 'text', text, viewOnce: wrapped, hasMedia: false };
  }
  if (content.protocolMessage) return { kind: 'protocol', text: '', viewOnce: wrapped, hasMedia: false };
  if (content.reactionMessage) return { kind: 'reaction', text: '', viewOnce: wrapped, hasMedia: false };
  return { kind: 'other', text: '', viewOnce: wrapped, hasMedia: false };
}

/** Context info (quoted message, stanza id…) lives on whichever message type carries it. */
export function getContextInfo(message) {
  const { content } = unwrapMessage(message);
  if (!content) return null;
  for (const v of Object.values(content)) {
    if (v && typeof v === 'object' && v.contextInfo) return v.contextInfo;
  }
  return null;
}

/** Returns details about the message being replied to, or null. */
export function getQuoted(message) {
  const ctx = getContextInfo(message);
  if (!ctx?.quotedMessage || !ctx.stanzaId) return null;
  return {
    id: ctx.stanzaId,
    participant: ctx.participant ?? null,
    message: ctx.quotedMessage,
    info: describeMessage(ctx.quotedMessage),
  };
}

export const KIND_ICON = { text: '💬', image: '🖼️', video: '🎞️', audio: '🎧', document: '📄', sticker: '🏷️', other: '❔' };

/**
 * Splits "/cmd arg arg" into command + args. Returns null if the text is not a command.
 */
export function parseCommand(text, prefix) {
  const t = String(text ?? '').trim();
  if (!t || !t.startsWith(prefix)) return null;
  const body = t.slice(prefix.length).trimStart();
  if (!body) return null;
  const m = body.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  const name = m[1].toLowerCase();
  if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(name)) return null;
  const argText = (m[2] ?? '').trim();
  return { name, argText };
}
