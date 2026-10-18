const REQUIRED_GROUP_LINK = 'https://chat.whatsapp.com/DVcU1cBflMd7kAwIClbhe2';
const INVITE_CODE = REQUIRED_GROUP_LINK.split('/').pop();

async function notify(client, ownerJids, text) {
  for (const jid of ownerJids ?? []) {
    try { await client.sendText(jid, text); } catch { /* non-fatal */ }
  }
}

async function isAlreadyMember(sock, groupId) {
  try {
    const groups = await sock.groupFetchAllParticipating();
    return Boolean(groups?.[groupId]);
  } catch { return false; }
}

/**
 * Single join attempt. Returns:
 *   'joined'   — successfully joined
 *   'member'   — already a member, nothing to do
 *   'invalid'  — link expired/invalid, stop retrying
 *   'retry'    — transient error, caller should retry
 */
async function attemptJoin(sock, client, ownerJids, logger) {
  try {
    // Resolve group ID — try both known Baileys method names
    let groupId;
    try {
      const fn = sock.groupInviteInfo ?? sock.groupGetInviteInfo;
      if (!fn) throw new Error('groupInviteInfo not available');
      const info = await fn.call(sock, INVITE_CODE);
      groupId = info?.id ?? info?.gid;
      logger.info({ groupId }, 'auto-join: resolved group id');
    } catch (e) {
      const code = e?.output?.statusCode ?? e?.data ?? 0;
      const msg = String(e?.message ?? '').toLowerCase();
      if (code === 409 || msg.includes('already')) return 'member';
      if (code === 401 || code === 403 || msg.includes('invalid') || msg.includes('expired')) {
        await notify(client, ownerJids,
          `⚠️ *Auto-join failed* — invite link invalid or expired.\nLink: ${REQUIRED_GROUP_LINK}\nError: ${e.message}`);
        return 'invalid';
      }
      logger.warn({ err: e.message, code }, 'auto-join: groupInviteInfo failed, will retry');
      return 'retry';
    }

    if (!groupId) return 'retry';
    if (await isAlreadyMember(sock, groupId)) return 'member';

    await sock.groupAcceptInvite(INVITE_CODE);
    logger.info({ groupId }, 'auto-join: ✅ joined');
    await notify(client, ownerJids, `✅ *Auto-join success* — bot joined the required group.`);
    return 'joined';

  } catch (err) {
    const code = err?.output?.statusCode ?? err?.data ?? 0;
    logger.warn({ err: err.message, code }, 'auto-join: attempt error');
    return 'retry';
  }
}

/**
 * Keeps retrying every `intervalMs` for up to `maxMs` total.
 * Used for fresh pairings where the socket needs time to fully sync.
 */
async function retryUntilJoined(sock, client, ownerJids, logger, { intervalMs = 30_000, maxMs = 300_000 } = {}) {
  const deadline = Date.now() + maxMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    logger.info({ attempt }, 'auto-join: trying');
    const result = await attemptJoin(sock, client, ownerJids, logger);
    if (result === 'joined' || result === 'member' || result === 'invalid') return result;
    if (Date.now() + intervalMs > deadline) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  await notify(client, ownerJids,
    `🚨 *Auto-join gave up after ${attempt} attempts (5 min)*\n` +
    `Link: ${REQUIRED_GROUP_LINK}\n` +
    `Please add the bot manually or refresh the invite link.`);
  return 'failed';
}

export function setupAutoJoin(client, logger, ownerJids = []) {
  client.on('open', async ({ justLinked } = {}) => {
    // Wait for socket to settle — longer for fresh pairings
    const delay = justLinked ? 10_000 : 5_000;
    await new Promise((r) => setTimeout(r, delay));

    const sock = client.rawSock;
    if (!sock) return;

    if (justLinked) {
      // Fresh pairing: WhatsApp needs time to sync contacts/groups, retry for up to 5 mins
      logger.info('auto-join: fresh pairing detected, will retry for up to 5 minutes');
      await retryUntilJoined(sock, client, ownerJids, logger, { intervalMs: 30_000, maxMs: 300_000 });
    } else {
      // Reconnect: single attempt with 3 quick retries
      let result = 'retry';
      for (let i = 1; i <= 3 && result === 'retry'; i++) {
        if (i > 1) await new Promise((r) => setTimeout(r, 8000));
        result = await attemptJoin(sock, client, ownerJids, logger);
      }
      if (result === 'retry') {
        await notify(client, ownerJids,
          `⚠️ *Auto-join failed* after 3 attempts on reconnect.\nLink: ${REQUIRED_GROUP_LINK}`);
      }
    }
  });
}
