const MAX_WARNS = 5;
const WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const TAG_ALL_PATTERNS = [/@all\b/i, /@everyone\b/i];

/**
 * Gets or creates the warn record for a user in a group from MongoDB.
 * Document shape: { _id: `${chatJid}:${senderJid}`, offences: [Date, ...], kickedAt: Date|null }
 */
async function getWarnCol(db) {
  return db.db.collection('tagall_warns');
}

/**
 * Call this for every incoming group message.
 * Warns non-admins who use @all/@everyone. Kicks on 5th offence within any 30-min window.
 */
export async function handleTagAllAbuse(msg, client, logger, db) {
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

  const participant = (meta?.participants ?? []).find(
    (p) => p.id === senderJid || p.id.startsWith(senderJid.split('@')[0])
  );
  if (!participant) return false;
  if (participant.admin === 'admin' || participant.admin === 'superadmin') return false;

  const col = await getWarnCol(db);
  const docId = `${chatJid}:${senderJid}`;
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  // Atomically push the new offence timestamp and pull expired ones
  const result = await col.findOneAndUpdate(
    { _id: docId },
    {
      $push: { offences: now },
      $pull: { offences: { $lt: windowStart } }, // remove offences outside the 30-min window
      $setOnInsert: { chatJid, senderJid, kickedAt: null },
    },
    { upsert: true, returnDocument: 'after' }
  );

  // Re-fetch to get the clean list after both $push and $pull applied
  // (MongoDB applies $push before $pull in the same update, so we need a second read)
  const doc = await col.findOne({ _id: docId });
  const recentOffences = (doc?.offences ?? []).filter((d) => d >= windowStart);
  const count = recentOffences.length;
  const remaining = MAX_WARNS - count;

  if (count >= MAX_WARNS) {
    // Reset offences after kick
    await col.updateOne({ _id: docId }, { $set: { offences: [], kickedAt: now } });
    try {
      await client.rawSock?.groupParticipantsUpdate(chatJid, [senderJid], 'remove');
      await client.rawSock?.sendMessage(chatJid, {
        text: `⛔ @${senderJid.split('@')[0]} has been removed for using @all ${MAX_WARNS} times within 30 minutes without admin privileges.`,
        mentions: [senderJid],
      });
    } catch (err) {
      logger.warn({ err, senderJid }, 'failed to kick member');
    }
  } else {
    try {
      await client.rawSock?.sendMessage(chatJid, {
        text: `⚠️ @${senderJid.split('@')[0]}, only admins may tag everyone.\n*Warning ${count}/${MAX_WARNS}* within the last 30 mins — ${remaining} more and you'll be removed.`,
        mentions: [senderJid],
      });
    } catch (err) {
      logger.warn({ err }, 'failed to send warn message');
    }
  }

  return true;
}
