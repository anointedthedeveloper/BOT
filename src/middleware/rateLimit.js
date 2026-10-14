import { formatDuration } from '../utils/text.js';

/** Per-sender rate limiting; the owner is exempt. Warns once per cooldown, then stays silent. */
export function rateLimit({ limiter }) {
  return async (ctx, next) => {
    if (ctx.role === 'owner') return next();
    const verdict = limiter.check(ctx.sender.jid);
    if (verdict.allowed) return next();
    ctx.log.warn({ reason: verdict.reason }, 'rate limited');
    if (verdict.notify) {
      await ctx.reply(
        verdict.reason === 'muted'
          ? `🔇 Too many requests. You are muted for ${formatDuration(verdict.retryAfterMs)}.`
          : `⏳ Slow down! Try again in ${formatDuration(verdict.retryAfterMs)}.`,
      );
    }
  };
}
