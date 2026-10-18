const MAX_WARNS = 7;
const WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const TAG_ALL_PATTERNS = [/@all\b/i, /@everyone\b/i];

function groupSettingsCol(db) { return db.db.collection('group_settings'); }
function warnCol(db) { return db.db.collection('tagall_warns'); }

export async function isTagGuardEnabled(chatJid, db) {
  const doc = await groupSettingsCol(db).findOne({ _id: chatJid });
  return doc?.tagGuard === true;
}

export async function setTagGuard(chatJid, enabled, db) {
  await groupSettingsCol(db).updateOne(
    { _id: chatJid },
    { $set: { tagGuard: enabled } },
    { upsert: true }
  );
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

  // Only active if an admin has turned it on for this group
  if (!(await isTagGuardEnabled(chatJid, db))) return false;

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

  const col = warnCol(db);
  const docId = `${chatJid}:${senderJid}`;
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  // Step 1: push new offence
  await col.updateOne(
    { _id: docId },
    {
      $push: { offences: now },
      $setOnInsert: { chatJid, senderJid, kickedAt: null },
    },
    { upsert: true }
  );

  // Step 2: pull expired offences (separate op — MongoDB forbids $push+$pull on same field)
  await col.updateOne({ _id: docId }, { $pull: { offences: { $lt: windowStart } } });

  const doc = await col.findOne({ _id: docId });
  const count = (doc?.offences ?? []).length;
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
