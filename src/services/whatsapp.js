import qrcode from 'qrcode';
import { normalizeJid } from '../utils/jid.js';
import { BoundedSet } from '../utils/lru.js';
import { BRAND_CAPTION_LIMIT } from './branding.js';

export { BRAND_CAPTION_LIMIT };

// Mirrors Baileys' DisconnectReason (kept local so decisions are testable without the library).
export const DISCONNECT = Object.freeze({
  loggedOut: 401, forbidden: 403, connectionReplaced: 440, restartRequired: 515, badSession: 500,
});

/** Pure reconnect policy. `attempt` is the number of consecutive failed connections so far. */
export function decideReconnect(statusCode, attempt, random = Math.random) {
  switch (statusCode) {
    case DISCONNECT.loggedOut:
      return { reconnect: false, resetSession: true, reason: 'logged_out' };
    case DISCONNECT.connectionReplaced:
      return { reconnect: false, reason: 'connection_replaced' };
    case DISCONNECT.forbidden:
      return { reconnect: false, reason: 'forbidden' };
    case DISCONNECT.restartRequired:
      return { reconnect: true, delayMs: 0, reason: 'restart_required' }; // normal right after QR pairing
    default: {
      const base = Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6));
      return { reconnect: true, delayMs: Math.round(base * (0.75 + random() * 0.5)), reason: 'connection_lost' };
    }
  }
}

const MAX_TEXT = 3500;

export function chunkText(text, max = MAX_TEXT) {
  if (text.length <= max) return [text];
  const chunks = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (line.length > max) {
      if (cur) chunks.push(cur), (cur = '');
      for (let i = 0; i < line.length; i += max) chunks.push(line.slice(i, i + max));
      continue;
    }
    if ((cur + '\n' + line).length > max) chunks.push(cur), (cur = line);
    else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/**
 * Owns the Baileys socket lifecycle: QR / pairing code, session persistence hooks, reconnection
 * with backoff, and a small send/download API. Event consumers register with `on(name, fn)`;
 * handler errors are routed to `onError` and never crash the connection.
 */
export class WhatsAppClient {
  constructor({ config, logger, authProvider, baileys, onError, output = process.stdout, timers = { setTimeout, clearTimeout } }) {
    this.config = config;
    this.logger = logger;
    this.authProvider = authProvider;
    this.baileys = baileys ?? null;
    this.onError = onError ?? (() => {});
    this.output = output;
    this.timers = timers;

    this.status = 'idle'; // idle | connecting | qr | open | closed | logged_out | stopped
    this.sock = null;
    this.auth = null;
    this.attempt = 0;
    this.reconnectTimer = null;
    this.stopping = false;
    this.pairingRequested = false;
    this.lastConnectedAt = null;
    this.sentIds = new BoundedSet(1000);
    this.handlers = new Map();
    this.selfJid = null;
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
    return this;
  }

  async #emit(event, payload) {
    for (const fn of this.handlers.get(event) ?? []) {
      try {
        await fn(payload);
      } catch (err) {
        this.onError(err, { scope: `event:${event}` });
      }
    }
  }

  async start() {
    this.stopping = false;
    if (!this.baileys) this.baileys = await import('@whiskeysockets/baileys');
    await this.#connect();
  }

  async #connect() {
    if (this.stopping) return;
    this.status = 'connecting';
    this.pairingRequested = false;
    this.auth = await this.authProvider();
    const { Browsers } = this.baileys;
    const makeWASocket = this.baileys.default ?? this.baileys.makeWASocket;
    const msgStore = new Map();
    const sock = makeWASocket({
      auth: this.auth.state,
      logger: this.logger.child({ module: 'baileys' }, { level: this.config.logging.baileysLevel }),
      browser: Browsers.appropriate('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      shouldIgnoreJid: () => false,
      getMessage: async (key) => {
        const id = `${key.remoteJid}:${key.id}`;
        return msgStore.get(id) ?? undefined;
      },
    });
    sock.ev.on('messages.upsert', ({ messages }) => {
      for (const m of messages) {
        if (m.message && m.key?.id && m.key?.remoteJid) {
          msgStore.set(`${m.key.remoteJid}:${m.key.id}`, m.message);
          if (msgStore.size > 500) msgStore.delete(msgStore.keys().next().value);
        }
      }
    });
    this.sock = sock;
    const current = () => this.sock === sock;

    sock.ev.on('creds.update', () => {
      if (current()) Promise.resolve(this.auth.saveCreds()).catch((err) => this.onError(err, { scope: 'saveCreds' }));
    });
    sock.ev.on('connection.update', (u) => current() && this.#onConnection(u));
    sock.ev.on('messages.upsert', (p) => current() && this.#emit('messages.upsert', p));
    sock.ev.on('messages.update', (p) => current() && this.#emit('messages.update', p));
  }

  async #onConnection(update) {
    const { connection, lastDisconnect, qr, isNewLogin } = update;

    if (qr) {
      this.status = 'qr';
      this.lastQr = qr;
      await this.#handleQr(qr);
    }
    // WhatsApp signals a brand-new pairing (vs. a reconnect of an existing session) right after
    // the QR/pairing-code handshake succeeds; the actual 'open' event follows a required restart.
    if (isNewLogin) this.justLinked = true;
    if (connection === 'connecting' && this.status !== 'qr') this.status = 'connecting';

    if (connection === 'open') {
      this.status = 'open';
      this.attempt = 0;
      this.lastConnectedAt = new Date();
      this.selfJid = normalizeJid(this.sock?.user?.id ?? '');
      const justLinked = this.justLinked;
      this.justLinked = false;
      this.logger.info({ justLinked }, 'whatsapp connection open');
      await this.#emit('open', { selfJid: this.selfJid, justLinked });
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode ?? lastDisconnect?.error?.statusCode;
      const decision = decideReconnect(code, this.attempt);
      this.status = 'closed';
      this.logger.warn({ code, reason: decision.reason, reconnect: decision.reconnect }, 'whatsapp connection closed');
      await this.#emit('close', { code, ...decision });
      if (this.stopping) return;
      if (decision.resetSession) return this.#handleLogout();
      if (!decision.reconnect) {
        this.status = 'stopped';
        this.logger.error({ reason: decision.reason }, 'not reconnecting');
        return this.#emit('fatal', { reason: decision.reason });
      }
      this.#scheduleReconnect(decision.delayMs, decision.reason !== 'restart_required');
    }
  }

  async #handleQr(qr) {
    const phone = this.config.auth.pairingPhoneNumber;
    if (phone) {
      // Pairing code: request it once per connection attempt
      if (this.pairingRequested) return;
      this.pairingRequested = true;
      try {
        const code = await this.sock.requestPairingCode(phone);
        const formatted = code.match(/.{1,4}/g)?.join('-') ?? code;
        this.lastPairingCode = formatted;
        await this.#emit('pairing-code', { code: formatted });
        this.output.write(`\n${'─'.repeat(60)}\n  PAIRING CODE: ${formatted}\n  On your phone: Settings > Linked Devices > Link with phone number\n${'─'.repeat(60)}\n\n`);
      } catch (err) {
        this.pairingRequested = false;
        this.logger.warn({ err: err.message }, 'requestPairingCode failed — will retry on next QR');
        this.onError(err, { scope: 'pairing' });
      }
      return;
    }

    // No phone set — fall back to QR in logs
    const art = await qrcode.toString(qr, { type: 'utf8', small: true, errorCorrectionLevel: 'L', scale: 1 });
    this.output.write(`\n${'─'.repeat(60)}\n  SCAN QR CODE: WhatsApp > Linked Devices > Link a Device\n${'─'.repeat(60)}\n${art}${'─'.repeat(60)}\n`);
    this.logger.info('QR code printed above — scan it with WhatsApp > Linked devices');
    const imagePath = this.config.auth.qrImagePath;
    if (imagePath) {
      try {
        await qrcode.toFile(imagePath, qr, { width: 512, margin: 2 });
        this.logger.info({ path: imagePath }, 'QR code also written as an image (not logged: path only)');
      } catch (err) {
        this.onError(err, { scope: 'qr-image' });
      }
    }
  }

  async #handleLogout() {
    this.status = 'logged_out';
    this.logger.error('session logged out from the phone: clearing stored credentials, a new QR code will be shown');
    await this.#emit('logged-out', {});
    try {
      await this.auth.clear?.();
    } catch (err) {
      this.onError(err, { scope: 'clear-auth' });
    }
    this.#scheduleReconnect(1000, false);
  }

  #scheduleReconnect(delayMs, countAttempt) {
    if (this.stopping) return;
    if (countAttempt) this.attempt += 1;
    if (this.attempt > 20) {
      this.status = 'stopped';
      this.logger.fatal({ attempts: this.attempt }, 'too many failed reconnect attempts');
      this.#emit('fatal', { reason: 'too_many_failures' });
      return;
    }
    this.logger.info({ delayMs, attempt: this.attempt }, 'scheduling reconnect');
    this.#teardownSocket();
    this.timers.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.#connect().catch((err) => {
        this.onError(err, { scope: 'reconnect' });
        this.#scheduleReconnect(5000, true);
      });
    }, delayMs);
  }

  #teardownSocket() {
    const sock = this.sock;
    this.sock = null;
    if (!sock) return;
    try {
      sock.ev.removeAllListeners?.('connection.update');
      sock.ev.removeAllListeners?.('messages.upsert');
      sock.ev.removeAllListeners?.('messages.update');
      sock.end?.(undefined);
    } catch {
      /* socket already closed */
    }
  }

  /** Recycles the connection without touching the stored session. */
  async restart() {
    this.logger.info('manual reconnect requested');
    this.timers.clearTimeout(this.reconnectTimer);
    this.#teardownSocket();
    this.attempt = 0;
    await this.#connect();
  }

  async stop() {
    this.stopping = true;
    this.timers.clearTimeout(this.reconnectTimer);
    this.#teardownSocket();
    this.status = 'stopped';
  }

  get isOpen() {
    return this.status === 'open' && Boolean(this.sock);
  }

  /** Exposes the raw Baileys socket for low-level calls (e.g. readMessages). Read-only. */
  get rawSock() {
    return this.sock;
  }

  get currentQr() {
    return this.status === 'open' ? null : (this.lastQr ?? null);
  }

  get currentPairingCode() {
    return this.status === 'open' ? null : (this.lastPairingCode ?? null);
  }

  #requireOpen() {
    if (!this.isOpen) throw new Error('WhatsApp connection is not open');
    return this.sock;
  }

  #track(sent) {
    if (sent?.key?.id) this.sentIds.add(sent.key.id);
    return sent;
  }

  /** True if this message id was produced by the bot itself (prevents command loops). */
  isOwnOutbound(id) {
    return this.sentIds.has(id);
  }

  async sendText(jid, text, { quoted } = {}) {
    const sock = this.#requireOpen();
    let last;
    for (const part of chunkText(String(text))) {
      last = this.#track(await sock.sendMessage(jid, { text: part }, quoted ? { quoted } : undefined));
    }
    return last;
  }

  /**
   * Sends text with an optional brand image attached (BRAND_IMAGE_PATH). Short replies become a
   * single image+caption message; replies too long for a caption get the image, then the full
   * text as normal (so formatting-heavy replies like /menu are never truncated).
   */
  async sendBranded(jid, text, { quoted, brand } = {}) {
    if (!brand) return this.sendText(jid, text, { quoted });
    const str = String(text);
    if (str.length <= BRAND_CAPTION_LIMIT) {
      return this.sendMedia(jid, { kind: 'image', buffer: brand.buffer, mimetype: brand.mimetype, caption: str }, { quoted });
    }
    await this.sendMedia(jid, { kind: 'image', buffer: brand.buffer, mimetype: brand.mimetype }, { quoted });
    return this.sendText(jid, str);
  }

  async sendMedia(jid, { kind, buffer, mimetype, fileName, caption }, { quoted } = {}) {
    const sock = this.#requireOpen();
    const content = {
      image: { image: buffer, caption },
      video: { video: buffer, caption },
      sticker: { sticker: buffer },
      audio: { audio: buffer, mimetype: mimetype || 'audio/ogg; codecs=opus' },
      document: { document: buffer, mimetype: mimetype || 'application/octet-stream', fileName: fileName || 'file', caption },
    }[kind] ?? { document: buffer, mimetype: mimetype || 'application/octet-stream', fileName: fileName || 'file' };
    return this.#track(await sock.sendMessage(jid, content, quoted ? { quoted } : undefined));
  }

  async react(jid, key, emoji) {
    const sock = this.#requireOpen();
    return this.#track(await sock.sendMessage(jid, { react: { text: emoji, key } }));
  }

  /** Downloads media from a message the bot legitimately received (e.g. a message the user replied to). */
  async downloadMedia(messageLike) {
    const sock = this.#requireOpen();
    return this.baileys.downloadMediaMessage(messageLike, 'buffer', {}, { logger: this.logger, reuploadRequest: sock.updateMediaMessage });
  }

  /** Downloads content directly from a media object (used for view-once). */
  async downloadContent(mediaObj, mediaType) {
    this.#requireOpen();
    return this.baileys.downloadContentFromMessage(mediaObj, mediaType);
  }
}
