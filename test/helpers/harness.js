import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { loadConfig } from '../../src/config/index.js';
import { createApp } from '../../src/app.js';
import { createSilentLogger } from '../../src/utils/logger.js';
import { createFakeBaileys } from './fakeBaileys.js';

export const OWNER = '15550001111';
export const OWNER_JID = `${OWNER}@s.whatsapp.net`;
export const ALICE = '15552220001@s.whatsapp.net';
export const BOB = '15552220002@s.whatsapp.net';
export const GROUP = '120363000000000001@g.us';

let counter = 0;
export const nextId = () => `MSG${++counter}`;

export function baseEnv(overrides = {}) {
  return {
    OWNER_NUMBERS: OWNER,
    LOG_LEVEL: 'silent',
    HEALTH_PORT: '0',
    BOT_MODE: 'public',
    RATE_LIMIT_MAX: '100',
    ...overrides,
  };
}

/** Builds a Baileys-shaped incoming message. */
export function buildMessage({ chat, sender, text, fromMe = false, id = nextId(), quoted, ts = Math.floor(Date.now() / 1000), raw }) {
  const group = chat.endsWith('@g.us');
  const message = raw ?? (quoted
    ? { extendedTextMessage: { text, contextInfo: { stanzaId: quoted.id, participant: quoted.participant, quotedMessage: quoted.message } } }
    : { conversation: text });
  return {
    key: { remoteJid: chat, id, fromMe, ...(group ? { participant: sender } : {}) },
    message,
    messageTimestamp: ts,
  };
}

/**
 * Starts the full application against a real (in-memory) MongoDB and a fake WhatsApp socket.
 */
export async function startHarness({ env = {}, baileysOptions } = {}) {
  const mongod = await MongoMemoryServer.create();
  const dir = await mkdtemp(path.join(tmpdir(), 'wabot-test-'));
  const config = loadConfig(baseEnv({
    MONGODB_URI: mongod.getUri(),
    MONGODB_DB: `t${Date.now()}${Math.floor(Math.random() * 1e6)}`,
    MEDIA_DIR: path.join(dir, 'media'),
    AUTH_DIR: path.join(dir, 'auth'),
    DATA_ENCRYPTION_KEY: 'a'.repeat(64),
    ...env,
  }));
  const fb = createFakeBaileys(baileysOptions);
  const exits = [];
  const app = await createApp(config, { logger: createSilentLogger(), baileys: fb.module, exit: (c) => exits.push(c) });
  await app.start();
  await fb.sock.ev.emitAsync('connection.update', { connection: 'open' });

  const h = {
    app, config, get sock() { return fb.sock; }, fb, exits, deps: app.deps, dir,
    /** Sends a message from `sender` in `chat` and waits until the bot finished handling it. */
    async say(sender, text, opts = {}) {
      const chat = opts.chat ?? (opts.group ? GROUP : sender);
      const msg = buildMessage({ chat, sender, text, ...opts });
      await fb.sock.ev.emitAsync('messages.upsert', { messages: [msg], type: opts.type ?? 'notify' });
      return msg;
    },
    async linkAsNew() {
      await fb.sock.ev.emitAsync('connection.update', { connection: 'open', isNewLogin: true });
    },
    async revoke(chat, id, { fromMe = false, participant } = {}) {
      await fb.sock.ev.emitAsync('messages.update', [{ key: { remoteJid: chat, id, fromMe, participant }, update: { message: null, messageStubType: 1 } }]);
    },
    lastText(jid) {
      return fb.sock.texts(jid).at(-1);
    },
    clearSent() {
      fb.sock.sent.length = 0;
    },
    async stop() {
      await app.shutdown(0, 'test');
      await mongod.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
  return h;
}
