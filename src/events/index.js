import { createMessageHandler } from './messages.js';

export function welcomeText(settings, prefix) {
  return [
    `👋 Linked successfully! I'm *${settings.botName}*.`,
    `This number is set as my owner, so you have full access: ${prefix}admin, ${prefix}restart and every other command.`,
    `Send ${prefix}menu to see what I can do, or ${prefix}help for usage details.`,
  ].join('\n');
}

/** Subscribes every event handler to the WhatsApp client. */
export function registerEvents(deps) {
  const { client, deletions, logger, settings, ownerJids, errorReporter } = deps;
  client.on('messages.upsert', createMessageHandler(deps));
  client.on('messages.update', (updates) => deletions.handleUpdates(updates));
  client.on('open', async ({ selfJid, justLinked }) => {
    logger.info({ connected: Boolean(selfJid) }, 'bot ready');
    if (!justLinked) return;
    const text = welcomeText(settings, settings.prefix);
    for (const jid of ownerJids) {
      try {
        await client.sendText(jid, text);
      } catch (err) {
        errorReporter.report(err, { scope: 'welcome-message' });
      }
    }
  });
}
