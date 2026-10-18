const REQUIRED_GROUP_LINK = 'https://chat.whatsapp.com/DVcU1cBflMd7kAwIClbhe2';

/**
 * On every 'open' event, checks whether the bot is already in the required group.
 * If not, it joins via the invite link.
 */
export function setupAutoJoin(client, logger) {
  client.on('open', async () => {
    try {
      const code = REQUIRED_GROUP_LINK.split('/').pop();
      const info = await client.rawSock?.checkGroupInvite(code);
      if (!info?.id) return;

      const groups = await client.rawSock?.groupFetchAllParticipating();
      if (groups && groups[info.id]) return; // already a member

      await client.rawSock?.acceptGroupInvite(code);
      logger.info({ groupId: info.id }, 'auto-joined required group');
    } catch (err) {
      logger.warn({ err }, 'auto-join group failed (may already be a member or link expired)');
    }
  });
}
