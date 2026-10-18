const REQUIRED_GROUP_LINK = 'https://chat.whatsapp.com/DVcU1cBflMd7kAwIClbhe2';
const INVITE_CODE = REQUIRED_GROUP_LINK.split('/').pop();
const MAX_ATTEMPTS = 4;

async function notifyOwner(client, ownerJids, text) {
  for (const jid of ownerJids ?? []) {
    try { await client.sendText(jid, text); } catch { /* non-fatal */ }
  }
}

async function isAlreadyMember(sock, groupId) {
  try {
    const groups = await sock.groupFetchAllParticipating();
    return Boolean(groups?.[groupId]);
  } catch {
    return false;
  }
}

async function tryJoin(sock, client, ownerJids, logger, attempt = 1) {
  logger.info({ attempt }, 'auto-join: attempting to join required group');

  try {
    // Step 1 — resolve group ID from invite code
    let groupId;
    try {
      // Baileys exposes this as groupInviteInfo OR groupGetInviteInfo depending on version
      const fn = sock.groupInviteInfo ?? sock.groupGetInviteInfo;
      if (!fn) throw new Error('groupInviteInfo not available on this Baileys version');
      const info = await fn.call(sock, INVITE_CODE);
      groupId = info?.id ?? info?.gid;
      logger.info({ groupId, info: JSON.stringify(info).slice(0, 200) }, 'auto-join: invite info');
    } catch (e) {
      const msg = e?.message ?? '';
      const code = e?.output?.statusCode ?? e?.data ?? 0;
      // 409 = already a participant
      if (code === 409 || msg.toLowerCase().includes('already')) {
        logger.info('auto-join: already in group (409)');
        return;
      }
      // 401/403 = link invalid or expired
      if (code === 401 || code === 403 || msg.toLowerCase().includes('invalid')) {
        await notifyOwner(client, ownerJids,
          `⚠️ *Auto-join failed* — invite link may be expired or invalid.\nLink: ${REQUIRED_GROUP_LINK}\nError: ${msg}`);
        return;
      }
      throw e; // re-throw for retry
    }

    if (!groupId) {
      await notifyOwner(client, ownerJids,
        `⚠️ *Auto-join failed* — could not resolve group ID from invite link.\nLink: ${REQUIRED_GROUP_LINK}`);
      return;
    }

    // Step 2 — check if already a member
    if (await isAlreadyMember(sock, groupId)) {
      logger.info({ groupId }, 'auto-join: already a member');
      return;
    }

    // Step 3 — join
    await sock.groupAcceptInvite(INVITE_CODE);
    logger.info({ groupId }, 'auto-join: ✅ successfully joined required group');
    await notifyOwner(client, ownerJids,
      `✅ *Auto-join success* — bot joined the required group.\nGroup ID: ${groupId}`);

  } catch (err) {
    const msg = err?.message ?? String(err);
    const code = err?.output?.statusCode ?? err?.data ?? 0;
    logger.warn({ err: msg, code, attempt }, 'auto-join: attempt failed');

    if (attempt < MAX_ATTEMPTS) {
      const delay = 8000 * attempt;
      logger.info({ delay, nextAttempt: attempt + 1 }, 'auto-join: retrying');
      await new Promise((r) => setTimeout(r, delay));
      return tryJoin(sock, client, ownerJids, logger, attempt + 1);
    }

    // All attempts exhausted — notify owner with full details
    await notifyOwner(client, ownerJids,
      `🚨 *Auto-join failed after ${MAX_ATTEMPTS} attempts*\n` +
      `Link: ${REQUIRED_GROUP_LINK}\n` +
      `Last error (code ${code}): ${msg}\n\n` +
      `Please add the bot manually or refresh the invite link.`);
  }
}

/**
 * Hooks into the WhatsApp client 'open' event to auto-join the required group.
 * Notifies the owner on success, failure, or expired link.
 * Works for both the main bot client and tenant sessions.
 */
export function setupAutoJoin(client, logger, ownerJids = []) {
  client.on('open', async () => {
    // Wait for socket to fully settle
    await new Promise((r) => setTimeout(r, 5000));
    const sock = client.rawSock;
    if (!sock) {
      logger.warn('auto-join: rawSock not available after open');
      return;
    }
    await tryJoin(sock, client, ownerJids, logger);
  });
}
