import { randomUUID } from 'node:crypto';

/** Minimal stand-in for the Baileys module + socket, enough to drive the whole bot in tests. */
export class FakeEmitter {
  constructor() {
    this.map = new Map();
  }
  on(evt, fn) {
    if (!this.map.has(evt)) this.map.set(evt, []);
    this.map.get(evt).push(fn);
  }
  removeAllListeners(evt) {
    if (evt) this.map.delete(evt);
    else this.map.clear();
  }
  /** Like emit(), but resolves when every (async) listener has finished. */
  async emitAsync(evt, payload) {
    await Promise.all((this.map.get(evt) ?? []).map((fn) => fn(payload)));
  }
}

export class FakeSock {
  constructor(config) {
    this.config = config;
    this.ev = new FakeEmitter();
    this.user = { id: '15550009999:7@s.whatsapp.net' };
    this.sent = [];
    this.ended = false;
    this.pairingRequests = [];
  }
  async sendMessage(jid, content, opts) {
    const sent = { jid, content, opts, key: { id: `BOT${randomUUID().slice(0, 8)}`, remoteJid: jid, fromMe: true } };
    this.sent.push(sent);
    return sent;
  }
  async requestPairingCode(phone) {
    this.pairingRequests.push(phone);
    return 'ABCD-1234';
  }
  updateMediaMessage() {}
  end() {
    this.ended = true;
  }
  texts(jid) {
    return this.sent.filter((s) => s.content.text && (!jid || s.jid === jid)).map((s) => s.content.text);
  }
}

export function createFakeBaileys({ downloadResult = Buffer.from('FAKE-MEDIA-BYTES'), downloadError = null } = {}) {
  const sockets = [];
  const module = {
    default: (config) => {
      const s = new FakeSock(config);
      sockets.push(s);
      return s;
    },
    Browsers: { appropriate: () => ['Linux', 'Chrome', '1.0'] },
    useMultiFileAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => {} }),
    downloadMediaMessage: async () => {
      if (downloadError) throw downloadError;
      return downloadResult;
    },
  };
  return { module, sockets, get sock() { return sockets.at(-1); } };
}
