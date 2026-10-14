import { createMessageHandler } from './messages.js';

/** Subscribes every event handler to the WhatsApp client. */
export function registerEvents(deps) {
  const { client, deletions, logger } = deps;
  client.on('messages.upsert', createMessageHandler(deps));
  client.on('messages.update', (updates) => deletions.handleUpdates(updates));
  client.on('open', ({ selfJid }) => logger.info({ connected: Boolean(selfJid) }, 'bot ready'));
}
