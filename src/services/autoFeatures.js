const STATUS_REACTIONS = ['❤️', '🔥', '👍', '😍', '🎉', '💯'];

/**
 * Hooks into the WhatsApp client to:
 *  1. Auto-react to incoming status updates (respects per-user `autoStatusReact` pref in MongoDB).
 *  2. Send a "composing" typing indicator before every bot reply.
 *
 * `deps` is optional — when provided, status-react prefs are read/written to MongoDB.
 */
export function setupAutoFeatures(client, logger, deps = null) {
  // Auto-react to statuses
  client.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key?.remoteJid !== 'status@broadcast' || msg.key?.fromMe) continue;

      // Check per-poster pref if we have db access (default: react = true)
      if (deps?.users) {
        try {
          const posterJid = msg.key.participant ?? msg.key.remoteJid;
          const user = await deps.users.get(posterJid);
          if (user?.prefs?.autoStatusReact === false) continue;
          // First time — store default pref in background, don't await
          if (!user || user.prefs?.autoStatusReact === undefined) {
            deps.users.setPref(posterJid, 'autoStatusReact', true).catch(() => {});
          }
        } catch { /* non-fatal */ }
      }

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

  // Patch sendBranded / sendText to show typing first (fire-and-forget, don't await)
  const origSendBranded = client.sendBranded.bind(client);
  client.sendBranded = async (jid, text, opts) => {
    client.rawSock?.sendPresenceUpdate('composing', jid).catch(() => {});
    return origSendBranded(jid, text, opts);
  };

  const origSendText = client.sendText.bind(client);
  client.sendText = async (jid, text, opts) => {
    client.rawSock?.sendPresenceUpdate('composing', jid).catch(() => {});
    return origSendText(jid, text, opts);
  };
}
