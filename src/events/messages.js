import { isIgnoredJid, normalizeJid, resolveSender } from '../utils/jid.js';
import { buildContext } from './context.js';

const MAX_COMMAND_AGE_S = 120;

/**
 * `messages.upsert` handler. Two independent, consent-gated steps per message:
 *   1. archive.record(): no-op unless the chat was switched on by an authorised person
 *   2. command routing: only when the text starts with the configured prefix
 * Only live ("notify") messages are processed; history syncs and our own echoes are ignored.
 */
export function createMessageHandler(deps) {
  const { client, archive, router, errorReporter } = deps;

  return async function onUpsert({ messages, type }) {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        const key = msg.key;
        if (!msg.message || !key?.id || !key.remoteJid || isIgnoredJid(key.remoteJid)) continue;
        if (client.isOwnOutbound(key.id)) continue;

        const chatJids = [normalizeJid(key.remoteJid), normalizeJid(key.remoteJidAlt)].filter(Boolean);
        const sender = resolveSender(key, { selfJid: client.selfJid });

        try {
          await archive.record({ msg, chatJids, senderJid: sender.jid });
        } catch (err) {
          errorReporter.report(err, { scope: 'archive.record' });
        }

        const ts = Number(msg.messageTimestamp?.toString?.() ?? msg.messageTimestamp ?? 0);
        if (ts && Date.now() / 1000 - ts > MAX_COMMAND_AGE_S) continue; // replayed after a reconnect
        const ctx = buildContext(msg, deps);
        if (ctx) await router.handle(ctx);
      } catch (err) {
        errorReporter.report(err, { scope: 'messages.upsert' });
      }
    }
  };
}
