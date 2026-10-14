const PN = 's.whatsapp.net';
const LID = 'lid';

export function jidServer(jid) {
  const i = typeof jid === 'string' ? jid.lastIndexOf('@') : -1;
  return i < 0 ? '' : jid.slice(i + 1);
}

/** "123:45@s.whatsapp.net" -> "123@s.whatsapp.net" (strips device suffix). */
export function normalizeJid(jid) {
  if (typeof jid !== 'string' || !jid.includes('@')) return '';
  const [user, server] = jid.split('@');
  return `${user.split(':')[0]}@${server}`.toLowerCase();
}

export const isGroupJid = (jid) => jidServer(jid) === 'g.us';
export const isPnJid = (jid) => jidServer(jid) === PN;
export const isLidJid = (jid) => jidServer(jid) === LID;
export const isIgnoredJid = (jid) =>
  jid === 'status@broadcast' || jidServer(jid) === 'broadcast' || jidServer(jid) === 'newsletter';

/** Phone number (digits) for a PN jid, otherwise ''. */
export function jidNumber(jid) {
  return isPnJid(jid) ? normalizeJid(jid).split('@')[0] : '';
}

export const numberToJid = (digits) => `${String(digits).replace(/\D/g, '')}@${PN}`;

/** Accepts "+1 555 123 4567", "15551234567" or a full jid. Returns a canonical jid or null. */
export function parseUserInput(input) {
  const s = String(input ?? '').trim().replace(/^@/, '');
  if (s.includes('@')) {
    const n = normalizeJid(s);
    return n && !isGroupJid(n) ? n : null;
  }
  const digits = s.replace(/[\s\-()+]/g, '');
  return /^\d{7,15}$/.test(digits) ? numberToJid(digits) : null;
}

/** Log-safe label that never reveals a full number. */
export function maskJid(jid) {
  const n = normalizeJid(jid);
  if (!n) return 'unknown';
  const [user, server] = n.split('@');
  if (server === 'g.us') return `group:…${user.slice(-4)}`;
  return `${server === LID ? 'lid' : 'user'}:…${user.slice(-4)}`;
}

/**
 * Work out who sent a message. WhatsApp may identify a sender by phone-number JID or by LID;
 * Baileys 7 exposes the counterpart in `participantAlt` / `remoteJidAlt`.
 * Returns the canonical id (phone JID when known) and every candidate id for owner matching.
 */
export function resolveSender(key, { selfJid } = {}) {
  const group = isGroupJid(key?.remoteJid);
  const raw = group ? [key?.participant, key?.participantAlt] : [key?.remoteJid, key?.remoteJidAlt];
  let candidates = raw.map(normalizeJid).filter(Boolean);
  if (key?.fromMe && selfJid) candidates = [normalizeJid(selfJid)];
  const canonical = candidates.find(isPnJid) ?? candidates[0] ?? '';
  return { jid: canonical, candidates };
}
