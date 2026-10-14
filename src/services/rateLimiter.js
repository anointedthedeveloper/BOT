/**
 * Sliding-window rate limiter with escalation:
 *   exceeding `max` hits per window -> cooldown (warn once)
 *   `strikesBeforeMute` cooldowns within a mute window -> temporary mute (silent)
 * State is in memory; it resets on restart, which is acceptable for spam protection.
 */
export class RateLimiter {
  constructor({ max, windowMs, cooldownMs, strikesBeforeMute, muteMs, now = () => Date.now() }) {
    Object.assign(this, { max, windowMs, cooldownMs, strikesBeforeMute, muteMs, now });
    this.state = new Map();
  }

  check(key) {
    const t = this.now();
    let s = this.state.get(key);
    if (!s) this.state.set(key, (s = { hits: [], blockedUntil: 0, mutedUntil: 0, strikes: 0, strikeSince: t }));

    if (s.mutedUntil > t) return { allowed: false, reason: 'muted', retryAfterMs: s.mutedUntil - t, notify: false };
    if (s.blockedUntil > t) return { allowed: false, reason: 'rate', retryAfterMs: s.blockedUntil - t, notify: false };

    s.hits = s.hits.filter((h) => t - h < this.windowMs);
    if (s.hits.length >= this.max) {
      if (t - s.strikeSince > this.muteMs) {
        s.strikes = 0;
        s.strikeSince = t;
      }
      s.strikes += 1;
      if (s.strikes >= this.strikesBeforeMute) {
        s.mutedUntil = t + this.muteMs;
        s.strikes = 0;
        s.hits = [];
        return { allowed: false, reason: 'muted', retryAfterMs: this.muteMs, notify: true };
      }
      s.blockedUntil = t + this.cooldownMs;
      return { allowed: false, reason: 'rate', retryAfterMs: this.cooldownMs, notify: true };
    }
    s.hits.push(t);
    return { allowed: true };
  }

  /** Drops idle entries; call periodically to bound memory. */
  sweep() {
    const t = this.now();
    for (const [k, s] of this.state) {
      const idle = s.hits.every((h) => t - h >= this.windowMs) && s.blockedUntil <= t && s.mutedUntil <= t && t - s.strikeSince > this.muteMs;
      if (idle) this.state.delete(k);
    }
  }

  get size() {
    return this.state.size;
  }
}
