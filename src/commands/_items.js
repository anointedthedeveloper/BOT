import { UserError } from '../utils/errors.js';
import { KIND_ICON } from '../utils/message.js';
import { formatBytes, formatDate, truncate } from '../utils/text.js';

export const TYPE_LABEL = { note: 'Note', bookmark: 'Bookmark', saved: 'Saved message' };
const PAGE_SIZE = 8;

export function parseSeq(raw) {
  const m = String(raw ?? '').match(/^#?(\d{1,9})$/);
  if (!m) throw new UserError('Give the item number, for example #12.');
  return Number(m[1]);
}

export function formatItemLine(item, tz) {
  const icon = item.type === 'note' ? '📝' : item.type === 'bookmark' ? '🔖' : (KIND_ICON[item.media?.kind ?? item.ref?.kind] ?? '💾');
  const body = truncate((item.text || item.note || item.ref?.excerpt || item.media?.fileName || '(no text)').replace(/\s+/g, ' '), 70);
  return `${icon} *#${item.seq}* ${body} _(${formatDate(item.createdAt, tz)})_`;
}

export function formatItemDetail(item, tz) {
  const lines = [`*${TYPE_LABEL[item.type]} #${item.seq}* — ${formatDate(item.createdAt, tz)}`];
  if (item.type === 'bookmark') {
    lines.push(`Chat reference: ${item.ref.msgId} (${item.ref.kind})`);
    if (item.ref.excerpt) lines.push(`Excerpt: ${item.ref.excerpt}`);
    if (item.note) lines.push(`Note: ${item.note}`);
  } else {
    if (item.text) lines.push(item.text);
    if (item.note) lines.push(`Note: ${item.note}`);
    if (item.media) lines.push(`Attachment: ${item.media.kind}${item.media.fileName ? ` “${item.media.fileName}”` : ''} (${formatBytes(item.media.size)})`);
  }
  if (item.tags?.length) lines.push(`Tags: ${item.tags.map((t) => `#${t}`).join(' ')}`);
  if (item.expiresAt) lines.push(`Auto-deletes: ${formatDate(item.expiresAt, tz)}`);
  return lines.join('\n');
}

/**
 * Shared list / show / delete handling for notes, bookmarks and saved messages.
 * Returns true if the sub-command was handled.
 */
export async function handleItemSubcommand(ctx, type, sub, rest) {
  const { items, mediaStore, client } = ctx.deps;
  const jid = ctx.sender.jid;
  const tz = ctx.user.prefs.timezone;

  if (sub === 'list' || sub === 'ls') {
    const page = Math.max(1, Number(rest[0]) || 1);
    const [list, total] = await Promise.all([items.list(jid, { type, limit: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }), items.count(jid, type)]);
    if (!list.length) return void (await ctx.reply(total ? `No items on page ${page}.` : `You have no ${TYPE_LABEL[type].toLowerCase()}s yet.`));
    const pages = Math.ceil(total / PAGE_SIZE);
    await ctx.reply([`*Your ${TYPE_LABEL[type].toLowerCase()}s* (page ${page}/${pages}, ${total} total)`, ...list.map((i) => formatItemLine(i, tz))].join('\n'));
    return true;
  }
  if (['show', 'get', 'view'].includes(sub)) {
    const item = await items.get(jid, parseSeq(rest[0]), type);
    if (!item) throw new UserError('No such item.');
    await ctx.reply(formatItemDetail(item, tz));
    if (item.media) {
      let buffer;
      try {
        buffer = await mediaStore.read(item.media.path);
      } catch {
        throw new UserError('The stored file is no longer available.');
      }
      await client.sendMedia(ctx.chatJid, { kind: item.media.kind, buffer, mimetype: item.media.mimetype, fileName: item.media.fileName, caption: item.text || undefined }, { quoted: ctx.msg });
    }
    return true;
  }
  if (['delete', 'del', 'rm', 'remove'].includes(sub)) {
    const removed = await items.delete(jid, parseSeq(rest[0]), type);
    if (!removed) throw new UserError('No such item.');
    if (removed.media) await mediaStore.remove(removed.media.path);
    await ctx.reply(`🗑️ ${TYPE_LABEL[type]} #${removed.seq} deleted.`);
    return true;
  }
  return false;
}
