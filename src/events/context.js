import { describeMessage, getQuoted, parseCommand } from '../utils/message.js';
import { isGroupJid, maskJid, normalizeJid, resolveSender } from '../utils/jid.js';
import { splitArgs } from '../utils/text.js';

/**
 * Builds the per-command context from an incoming WhatsApp message.
 * Returns null when the message is not a command. `deps` is the service container.
 */
export function buildContext(msg, deps) {
  const { settings, client, logger, brandImage } = deps;
  const prefix = settings.prefix;
  const info = describeMessage(msg.message);
  if (info.viewOnce) return null; // never act on view-once content
  const parsed = parseCommand(info.text, prefix);
  if (!parsed) return null;

  const key = msg.key;
  const chatJid = key.remoteJid;
  const chatJids = [normalizeJid(key.remoteJid), normalizeJid(key.remoteJidAlt)].filter(Boolean);
  const sender = resolveSender(key, { selfJid: client.selfJid });
  const log = logger.child({ cmd: parsed.name, user: maskJid(sender.jid), chat: maskJid(chatJid) });

  return {
    deps,
    msg,
    prefix,
    name: parsed.name,
    argText: parsed.argText,
    args: splitArgs(parsed.argText),
    chatJid,
    chatJids,
    isGroup: isGroupJid(chatJid),
    fromMe: Boolean(key.fromMe),
    sender,
    quoted: getQuoted(msg.message),
    receivedAt: Date.now(),
    log,
    role: 'none',
    user: null,
    command: null,
    reply: (text) => client.sendBranded(chatJid, text, { quoted: msg, brand: brandImage }),
    react: (emoji) => client.react(chatJid, key, emoji),
  };
}
