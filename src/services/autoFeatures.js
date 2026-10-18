const STATUS_REACTIONS = ['❤️', '🔥', '👍', '😍', '🎉', '💯'];

/**
 * Hooks into the WhatsApp client to:
 *  1. Auto-react to incoming status updates (only if user has enabled autoStatusReact pref).
 *  2. Send a "composing" typing indicator before every bot reply (only if typing pref enabled).
 *
 * Both features default to OFF. Users enable them via ,prefs commands.
 */
export function setupAutoFeatures(client, logger, deps = null) {
  // Auto-react to statuses — OFF by default, user must opt in
  client.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key?.remoteJid !== 'status@broadcast' || msg.key?.fromMe) continue;

      if (deps?.users) {
        try {
          const posterJid = msg.key.participant ?? msg.key.remoteJid;
          const user = await deps.users.get(posterJid);
          // Default is false — only react if explicitly opted in
          if (user?.prefs?.autoStatusReact !== true) continue;
        } catch { /* non-fatal */ }
      } else {
        continue; // no db, skip
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

  // Patch sendBranded / sendText to show typing first — only if typing pref is enabled
  const origSendBranded = client.sendBranded.bind(client);
  client.sendBranded = async (jid, text, opts) => {
    if (deps?.settings?.typingIndicator) {
      client.rawSock?.sendPresenceUpdate('composing', jid).catch(() => {});
    }
    return origSendBranded(jid, text, opts);
  };

  const origSendText = client.sendText.bind(client);
  client.sendText = async (jid, text, opts) => {
    if (deps?.settings?.typingIndicator) {
      client.rawSock?.sendPresenceUpdate('composing', jid).catch(() => {});
    }
    return origSendText(jid, text, opts);
  };
}
