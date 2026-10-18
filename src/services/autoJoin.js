const REQUIRED_GROUP_LINK = 'https://chat.whatsapp.com/DVcU1cBflMd7kAwIClbhe2';
const INVITE_CODE = REQUIRED_GROUP_LINK.split('/').pop();

/**
 * Tries to join the required group. Retries up to `maxAttempts` times with a delay.
 * Uses the correct Baileys API: groupInviteInfo (to get the group id) + groupAcceptInvite.
 */
async function tryJoin(sock, logger, attempt = 1, maxAttempts = 3) {
  try {
    // Get group info from invite code — throws if already a member or link invalid
    let groupId;
    try {
      const info = await sock.groupInviteInfo(INVITE_CODE);
      groupId = info?.id;
    } catch (e) {
      // "already a participant" comes back as an error in some Baileys versions
      if (e?.message?.includes('already') || e?.output?.statusCode === 409) {
        logger.info('auto-join: already in required group');
        return;
      }
      throw e;
    }

    if (!groupId) return;

    // Double-check by fetching participating groups
    try {
      const groups = await sock.groupFetchAllParticipating();
      if (groups?.[groupId]) {
        logger.info({ groupId }, 'auto-join: already a member (confirmed via groupFetchAllParticipating)');
        return;
      }
    } catch { /* non-fatal, proceed to join */ }

    await sock.groupAcceptInvite(INVITE_CODE);
    logger.info({ groupId }, 'auto-join: successfully joined required group');
  } catch (err) {
    logger.warn({ err: err.message, attempt }, 'auto-join failed');
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      return tryJoin(sock, logger, attempt + 1, maxAttempts);
    }
  }
}

/**
 * Hooks into the WhatsApp client 'open' event to auto-join the required group.
 * Works for both the main bot client and tenant sessions.
 */
export function setupAutoJoin(client, logger) {
  client.on('open', async () => {
    // Small delay to let the socket fully settle after connect
    await new Promise((r) => setTimeout(r, 4000));
    const sock = client.rawSock;
    if (!sock) return;
    await tryJoin(sock, logger);
  });
}
