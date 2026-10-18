import { createHash } from 'node:crypto';
import { errorRef } from '../utils/errors.js';

/**
 * Central error sink: structured log + bounded history + de-duplicated owner notification.
 * Stack traces go to logs only; the owner message carries just the reference and the error message.
 */
export class ErrorReporter {
  constructor({ logger, notifyOwner = false, now = () => Date.now(), dedupeMs = 600_000, maxPerHour = 5 }) {
    this.logger = logger;
    this.enabled = notifyOwner;
    this.now = now;
    this.dedupeMs = dedupeMs;
    this.maxPerHour = maxPerHour;
    this.recent = [];
    this.lastSent = new Map();
    this.sentTimes = [];
    this.notifier = null;
    this.total = 0;
  }

  setNotifier(fn) {
    this.notifier = fn;
  }

  report(err, context = {}) {
    const error = err instanceof Error ? err : new Error(String(err));
    const ref = errorRef();
    const fingerprint = createHash('sha1').update(`${error.name}:${error.message}:${context.scope ?? ''}`).digest('hex').slice(0, 10);
    this.total++;
    this.logger.error({ err: error, ref, fingerprint, ...context }, 'unhandled error');
    this.recent.push({ ref, at: new Date(this.now()).toISOString(), scope: context.scope ?? 'unknown', message: error.message.slice(0, 200) });
    if (this.recent.length > 20) this.recent.shift();
    this.#maybeNotify(ref, fingerprint, error, context);
    return ref;
  }

  #maybeNotify(ref, fingerprint, error, context) {
    if (!this.enabled || !this.notifier) return;
    const t = this.now();
    this.sentTimes = this.sentTimes.filter((x) => t - x < 3_600_000);
    if (this.sentTimes.length >= this.maxPerHour) return;
    if (t - (this.lastSent.get(fingerprint) ?? -Infinity) < this.dedupeMs) return;
    this.lastSent.set(fingerprint, t);
    this.sentTimes.push(t);
    const text = `🚨 *Bot Error* [ref: ${ref}]
⏰ ${new Date().toISOString()}
📍 Scope: ${context.scope ?? 'unknown'}
❌ ${error.name}: ${error.message.slice(0, 300)}${error.stack ? '\n\n```\n' + error.stack.slice(0, 400) + '\n```' : ''}`;
    Promise.resolve(this.notifier(text)).catch((e) => this.logger.warn({ err: e.message }, 'failed to notify owner of error'));
  }
}
