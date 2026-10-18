import { isIgnoredJid, normalizeJid, resolveSender } from '../utils/jid.js';
import { buildContext } from './context.js';
import { describeMessage, getQuoted } from '../utils/message.js';
import { handleTagAllAbuse } from '../services/tagAllGuard.js';

const MAX_COMMAND_AGE_S = 120;

/**
 * `messages.upsert` handler. Two independent, consent-gated steps per message:
 *   1. archive.record(): no-op unless the chat was switched on by an authorised person
 *   2. command routing: only when the text starts with the configured prefix
 * Only live ("notify") messages are processed; history syncs and our own echoes are ignored.
 */
export function createMessageHandler(deps) {
  const { client, archive, viewOnce, router, errorReporter } = deps;

  return async function onUpsert({ messages, type }) {
    // auto-read WhatsApp statuses
    if (deps.settings?.autoViewStatus) {
      const statusKeys = messages
        .filter(m => m.key?.remoteJid === 'status@broadcast' && !m.key.fromMe)
        .map(m => m.key);
      if (statusKeys.length) {
        try { await client.rawSock?.readMessages(statusKeys); } catch { /* non-fatal */ }
      }
    }
    // view-once arrives as 'append' in newer Baileys — handle it before the notify-only gate
    if (type === 'append') {
      for (const msg of messages) {
        try {
          if (!msg.message || !msg.key?.id || !msg.key.remoteJid) continue;
          if (client.isOwnOutbound(msg.key.id)) continue;
          deps.logger.info({ msgTypes: Object.keys(msg.message).join(','), raw: JSON.stringify(msg.message).slice(0, 600) }, 'append:raw');
          await viewOnce.handle(msg);
          const ts = Number(msg.messageTimestamp?.toString?.() ?? msg.messageTimestamp ?? 0);
          if (ts && Date.now() / 1000 - ts > MAX_COMMAND_AGE_S) continue;
          const ctx = buildContext(msg, deps);
          if (ctx) await router.handle(ctx);
        } catch (err) {
          errorReporter.report(err, { scope: 'viewonce.handle' });
        }
      }
      return;
    }

    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        const key = msg.key;
        if (!msg.message || !key?.id || !key.remoteJid || isIgnoredJid(key.remoteJid)) continue;
        if (client.isOwnOutbound(key.id)) continue;

        const chatJids = [normalizeJid(key.remoteJid), normalizeJid(key.remoteJidAlt)].filter(Boolean);
        const sender = resolveSender(key, { selfJid: client.selfJid });

        try {
          await viewOnce.handle(msg);
        } catch (err) {
          errorReporter.report(err, { scope: 'viewonce.handle' });
        }

        try {
          await archive.record({ msg, chatJids, senderJid: sender.jid });
        } catch (err) {
          errorReporter.report(err, { scope: 'archive.record' });
        }

        // Track message counts
        try {
          const col = deps.db?.db?.collection('msg_counts');
          if (col) await col.insertOne({ chatJid: key.remoteJid, senderJid: sender.jid, ts: new Date() });
        } catch { /* non-fatal */ }

        // Warn/kick non-admins who use @all
        try {
          await handleTagAllAbuse(msg, client, deps.logger);
        } catch (err) {
          errorReporter.report(err, { scope: 'tagAllGuard' });
        }

        const ts = Number(msg.messageTimestamp?.toString?.() ?? msg.messageTimestamp ?? 0);
        if (ts && Date.now() / 1000 - ts > MAX_COMMAND_AGE_S) continue;
        const ctx = buildContext(msg, deps);
        if (ctx) {
          await router.handle(ctx);
        } else {
          // if replying to a view-once with any text, invoke vv automatically
          await maybeHandleViewOnceReply(msg, deps);
        }
      } catch (err) {
        errorReporter.report(err, { scope: 'messages.upsert' });
      }
    }
  };
}

async function maybeHandleViewOnceReply(msg, deps) {
  const quoted = getQuoted(msg.message);
  if (!quoted) return;
  const info = describeMessage(quoted.message);
  if (!info.viewOnce || !info.hasMedia) return;
  const { client, ownerJids, permissions, registry } = deps;
  const isOwner = msg.key.fromMe || permissions.isOwner({ candidates: [normalizeJid(msg.key.participant ?? msg.key.remoteJid)], fromMe: false });
  if (!isOwner) return;
  const vvCmd = registry.get('vv');
  if (!vvCmd) return;
  await vvCmd.execute({
    deps,
    msg,
    chatJid: msg.key.remoteJid,
    quoted,
    args: [],
    argText: '',
    reply: (text) => client.sendText(ownerJids[0], text),
  });
}
