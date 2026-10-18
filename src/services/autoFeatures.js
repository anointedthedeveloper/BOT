const STATUS_REACTIONS = ['❤️', '🔥', '👍', '😍', '🎉', '💯'];

/**
 * Hooks into the WhatsApp client to:
 *  1. React to every incoming status update with a random emoji.
 *  2. Send a "composing" typing indicator before the bot sends a reply.
 */
export function setupAutoFeatures(client, logger) {
  // Auto-react to statuses
  client.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key?.remoteJid !== 'status@broadcast' || msg.key?.fromMe) continue;
      const emoji = STATUS_REACTIONS[Math.floor(Math.random() * STATUS_REACTIONS.length)];
      try {
        await client.rawSock?.sendMessage('status@broadcast', {
          react: { text: emoji, key: msg.key },
        });
      } catch (err) {
        logger.debug({ err }, 'auto-status react failed');
      }
    }
  });

  // Patch sendBranded / sendText to show typing first
  const origSendBranded = client.sendBranded.bind(client);
  client.sendBranded = async (jid, text, opts) => {
    try {
      await client.rawSock?.sendPresenceUpdate('composing', jid);
      await new Promise((r) => setTimeout(r, 600));
      await client.rawSock?.sendPresenceUpdate('paused', jid);
    } catch { /* non-fatal */ }
    return origSendBranded(jid, text, opts);
  };

  const origSendText = client.sendText.bind(client);
  client.sendText = async (jid, text, opts) => {
    try {
      await client.rawSock?.sendPresenceUpdate('composing', jid);
      await new Promise((r) => setTimeout(r, 600));
      await client.rawSock?.sendPresenceUpdate('paused', jid);
    } catch { /* non-fatal */ }
    return origSendText(jid, text, opts);
  };
}
