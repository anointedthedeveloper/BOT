const STATUS_REACTIONS = ['❤️', '🔥', '👍', '😍', '🎉', '💯'];

export function setupAutoFeatures(client, logger, deps = null) {
  // Auto-react to statuses — check the BOT OWNER's pref, not the poster's
  client.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key?.remoteJid !== 'status@broadcast' || msg.key?.fromMe) continue;
      if (!deps?.users || !deps?.ownerJids?.[0]) continue;
      try {
        const ownerUser = await deps.users.get(deps.ownerJids[0]);
        if (ownerUser?.prefs?.autoStatusReact !== true) continue;
      } catch { continue; }

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

  // Patch sendBranded / sendText to show typing indicator before replying
  const origSendBranded = client.sendBranded.bind(client);
  client.sendBranded = async (jid, text, opts) => {
    if (deps?.settings?.typingIndicator) {
      try {
        await client.rawSock?.sendPresenceUpdate('composing', jid);
        await new Promise(r => setTimeout(r, 600));
      } catch { /* non-fatal */ }
    }
    return origSendBranded(jid, text, opts);
  };

  const origSendText = client.sendText.bind(client);
  client.sendText = async (jid, text, opts) => {
    if (deps?.settings?.typingIndicator) {
      try {
        await client.rawSock?.sendPresenceUpdate('composing', jid);
        await new Promise(r => setTimeout(r, 600));
      } catch { /* non-fatal */ }
    }
    return origSendText(jid, text, opts);
  };
}
