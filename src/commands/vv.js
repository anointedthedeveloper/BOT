import { UserError } from '../utils/errors.js';
import { describeMessage } from '../utils/message.js';
import { normalizeJid, resolveSender } from '../utils/jid.js';

export default {
  name: 'vv',
  description: 'Reveal a view-once message you reply to',
  usage: 'vv',
  open: true,
  async execute(ctx) {
    const { client, ownerJids, viewOnce } = ctx.deps;
    const quoted = ctx.quoted;

    if (!quoted) throw new UserError('Reply to a view-once message with ,vv');

    const { viewOnce: isViewOnce, hasMedia, kind, mimetype, fileName } = describeMessage(quoted.message);
    if (!isViewOnce || !hasMedia) throw new UserError('The replied message is not a view-once media message');

    // The quoted message proto has stripped media fields (no url/directPath/mediaKey).
    // ViewOnceService downloads and caches the buffer when the original message arrives.
    const cached = viewOnce.getCache(quoted.id);
    ctx.deps.logger.info({ quotedId: quoted.id, cacheKeys: [...viewOnce._cache.keys()] }, 'vv: cache lookup');
    if (!cached) throw new UserError('View-once media not in cache — the bot must receive it first before you can use ,vv');

    const { buffer, info: cachedInfo, from } = cached;

    await client.sendMedia(ownerJids[0], {
      kind: cachedInfo.kind,
      buffer,
      mimetype: cachedInfo.mimetype,
      fileName: cachedInfo.fileName,
      caption: `👁️ View-once from ${from}`,
    });
  },
};

