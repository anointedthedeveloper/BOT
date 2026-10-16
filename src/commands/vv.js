import { UserError } from '../utils/errors.js';
import { describeMessage, unwrapMessage } from '../utils/message.js';
import { normalizeJid } from '../utils/jid.js';

export default {
  name: 'vv',
  description: 'Reveal a view-once message you reply to',
  usage: 'vv',
  role: 'owner',
  async execute(ctx) {
    const { client, ownerJids } = ctx.deps;
    const quoted = ctx.quoted;

    if (!quoted) throw new UserError('Reply to a view-once message with ,vv');

    const { viewOnce, hasMedia, kind, mimetype, fileName } = describeMessage(quoted.message);
    if (!viewOnce || !hasMedia) throw new UserError('The replied message is not a view-once media message');

    // Mutate viewOnce flag so Baileys downloads it as normal media
    const inner = unwrapInner(quoted.message);
    if (!inner) throw new UserError('Could not read the view-once message content');
    inner.viewOnce = false;

    // Build a fake msg object downloadMedia expects
    const fakeMsgForDownload = {
      key: { remoteJid: ctx.chatJid, id: quoted.id, fromMe: false },
      message: quoted.message,
    };

    let buffer;
    try {
      buffer = await client.downloadMedia(fakeMsgForDownload);
    } catch {
      throw new UserError('Failed to download the view-once media — it may have expired');
    }

    const ownerJid = ownerJids[0];
    const from = normalizeJid(quoted.participant ?? ctx.chatJid).split('@')[0];
    await client.sendMedia(ownerJid, {
      kind,
      buffer,
      mimetype,
      fileName,
      caption: `👁️ View-once from +${from}`,
    });
  },
};

function unwrapInner(message) {
  const VIEW_ONCE_KEYS = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];
  const MEDIA_KEYS = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];
  let content = message;
  for (let i = 0; i < 5 && content; i++) {
    const wrapper = VIEW_ONCE_KEYS.find((k) => content[k]);
    if (wrapper) { content = content[wrapper].message ?? content[wrapper]; continue; }
    const mediaKey = MEDIA_KEYS.find((k) => content[k]);
    if (mediaKey) return content[mediaKey];
    break;
  }
  return null;
}
