// In-memory warn store: `${chatJid}:${senderJid}` -> count
const warnMap = new Map();
const MAX_WARNS = 3;

const TAG_ALL_PATTERNS = [/@all\b/i, /@everyone\b/i];

/**
 * Call this for every incoming group message.
 * If a non-admin uses @all / @everyone, warn them. On the 3rd offence, kick them.
 * Returns true if the message was handled (caller can skip further processing if desired).
 */
export async function handleTagAllAbuse(msg, client, logger) {
  const key = msg.key;
  if (!key?.remoteJid?.endsWith('@g.us')) return false;
  if (key.fromMe) return false;

  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || '';

  if (!TAG_ALL_PATTERNS.some((p) => p.test(text))) return false;

  const chatJid = key.remoteJid;
  const senderJid = key.participant ?? key.remoteJid;

  // Check if sender is admin
  let meta;
  try {
    meta = await client.rawSock?.groupMetadata(chatJid);
  } catch {
    return false;
  }

  const participant = (meta?.participants ?? []).find((p) => p.id === senderJid || p.id.startsWith(senderJid.split('@')[0]));
  if (!participant) return false;
  if (participant.admin === 'admin' || participant.admin === 'superadmin') return false;

  const mapKey = `${chatJid}:${senderJid}`;
  const count = (warnMap.get(mapKey) ?? 0) + 1;
  warnMap.set(mapKey, count);

  const remaining = MAX_WARNS - count;

  if (count >= MAX_WARNS) {
    warnMap.delete(mapKey);
    try {
      await client.rawSock?.groupParticipantsUpdate(chatJid, [senderJid], 'remove');
      await client.rawSock?.sendMessage(chatJid, {
        text: `⛔ @${senderJid.split('@')[0]} has been kicked for repeatedly using @all without admin privileges.`,
        mentions: [senderJid],
      });
    } catch (err) {
      logger.warn({ err, senderJid }, 'failed to kick member');
    }
  } else {
    try {
      await client.rawSock?.sendMessage(chatJid, {
        text: `⚠️ @${senderJid.split('@')[0]}, only admins can tag everyone. *Warning ${count}/${MAX_WARNS}* — ${remaining} more and you'll be removed.`,
        mentions: [senderJid],
      });
    } catch (err) {
      logger.warn({ err }, 'failed to send warn message');
    }
  }

  return true;
}
