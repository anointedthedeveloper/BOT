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

        // Track message counts (fire-and-forget)
        const col = deps.db?.db?.collection('msg_counts');
        if (col) col.insertOne({ chatJid: key.remoteJid, senderJid: sender.jid, ts: new Date() }).catch(() => {});

        // Warn/kick non-admins who use @all — skip bot's own messages
        try {
          if (!client.isOwnOutbound(key.id) && sender.jid !== normalizeJid(client.selfJid)) {
            await handleTagAllAbuse(msg, client, deps.logger, deps.db);
          }
        } catch (err) {
          errorReporter.report(err, { scope: 'tagAllGuard' });
        }

        const ts = Number(msg.messageTimestamp?.toString?.() ?? msg.messageTimestamp ?? 0);
        if (ts && Date.now() / 1000 - ts > MAX_COMMAND_AGE_S) continue;
        const ctx = buildContext(msg, deps);
        if (ctx) {
          await router.handle(ctx);
        } else {
          // Feed plain text to word game if one is active
          const { wordGame } = deps;
          if (wordGame?.hasGame(key.remoteJid)) {
            const info = describeMessage(msg.message);
            if (info.kind === 'text' && info.text) {
              await wordGame.handleMessage(key.remoteJid, sender.jid, info.text);
            }
          }
          // Forward plain DMs (non-commands) from non-owners to the owner
          await maybeForwardToOwner(msg, deps);
          // If owner replied to a forwarded DM, send reply back to original user
          await maybeSudoReply(msg, deps);
          // if replying to a view-once with any text, invoke vv automatically
          await maybeHandleViewOnceReply(msg, deps);
        }
      } catch (err) {
        errorReporter.report(err, { scope: 'messages.upsert' });
      }
    }
  };
}

// Maps forwarded message IDs to the original sender JID so owner replies can be routed back.
const _forwardedMsgMap = new Map(); // msgId -> senderJid (capped at 500 entries)

async function maybeForwardToOwner(msg, deps) {
  const key = msg.key;
  if (!key?.remoteJid || key.remoteJid.endsWith('@g.us') || key.remoteJid === 'status@broadcast') return;
  if (key.fromMe) return;
  if (!deps.settings?.dmForward) return;

  const { client, ownerJids, permissions } = deps;
  const sender = resolveSender(key, { selfJid: client.selfJid });

  // Don't forward owner's own messages back to themselves
  if (permissions.isOwner({ candidates: sender.candidates, fromMe: false })) return;

  const info = describeMessage(msg.message);
  if (!info.text && !info.hasMedia) return; // nothing to forward

  const senderNum = sender.jid.split('@')[0];
  const header = `📩 *Message from +${senderNum}*`;

  try {
    let sent;
    if (info.text) {
      sent = await client.sendText(ownerJids[0], `${header}\n${info.text}`);
    } else {
      // Forward the raw message so media comes through
      await client.rawSock?.forwardMessage(ownerJids[0], msg, { forceForward: true });
      sent = await client.sendText(ownerJids[0], header);
    }
    // Track so owner can reply back
    if (sent?.key?.id) {
      if (_forwardedMsgMap.size >= 500) _forwardedMsgMap.delete(_forwardedMsgMap.keys().next().value);
      _forwardedMsgMap.set(sent.key.id, sender.jid);
    }
  } catch { /* non-fatal */ }
}

/** If the owner replies to a forwarded DM, send the reply back to the original user. */
async function maybeSudoReply(msg, deps) {
  const key = msg.key;
  if (!key?.fromMe) return; // only owner's own messages
  if (!key.remoteJid || key.remoteJid.endsWith('@g.us')) return;

  const quoted = getQuoted(msg.message);
  if (!quoted?.id) return;

  const targetJid = _forwardedMsgMap.get(quoted.id);
  if (!targetJid) return;

  const { client } = deps;
  const info = describeMessage(msg.message);
  if (!info.text) return;

  try {
    await client.sendText(targetJid, info.text);
  } catch { /* non-fatal */ }
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
