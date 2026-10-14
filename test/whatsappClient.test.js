import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppClient, decideReconnect, DISCONNECT } from '../src/services/whatsapp.js';
import { loadConfig } from '../src/config/index.js';
import { createFakeBaileys } from './helpers/fakeBaileys.js';
import { WAMessageStubType } from '@whiskeysockets/baileys';
import { REVOKE_STUB_TYPE } from '../src/services/deletions.js';
import * as baileys from '@whiskeysockets/baileys';

const baseEnv = { MONGODB_URI: 'mongodb://localhost', OWNER_NUMBERS: '15550001111' };

function setup(env = {}) {
  const fb = createFakeBaileys();
  const timers = { pending: [], setTimeout(fn, ms) { const t = { fn, ms }; this.pending.push(t); return t; }, clearTimeout(t) { this.pending = this.pending.filter((p) => p !== t); } };
  const logs = [];
  const logger = { child: () => logger, info: (...a) => logs.push(a), warn: (...a) => logs.push(a), error: (...a) => logs.push(a), fatal: (...a) => logs.push(a) };
  const errors = [];
  const out = { text: '', write(s) { this.text += s; } };
  let clears = 0;
  const client = new WhatsAppClient({
    config: loadConfig({ ...baseEnv, ...env }), logger, baileys: fb.module, onError: (e, c) => errors.push([e, c]), output: out, timers,
    authProvider: async () => ({ state: {}, saveCreds: async () => {}, clear: async () => { clears++; } }),
  });
  return { client, fb, timers, logs, errors, out, clears: () => clears };
}
const close = (code) => ({ connection: 'close', lastDisconnect: { error: { output: { statusCode: code } } } });

test('Baileys REVOKE stub type matches our constant (guards against library drift)', () => {
  assert.equal(WAMessageStubType.REVOKE, REVOKE_STUB_TYPE);
  assert.equal(baileys.DisconnectReason.loggedOut, DISCONNECT.loggedOut);
  assert.equal(baileys.DisconnectReason.restartRequired, DISCONNECT.restartRequired);
  assert.equal(baileys.DisconnectReason.connectionReplaced, DISCONNECT.connectionReplaced);
  assert.equal(baileys.DisconnectReason.forbidden, DISCONNECT.forbidden);
});

test('decideReconnect policy', () => {
  assert.deepEqual(decideReconnect(401, 0), { reconnect: false, resetSession: true, reason: 'logged_out' });
  assert.equal(decideReconnect(440, 0).reconnect, false);
  assert.equal(decideReconnect(403, 0).reconnect, false);
  assert.deepEqual(decideReconnect(515, 5), { reconnect: true, delayMs: 0, reason: 'restart_required' });
  const d = [0, 1, 2, 3, 10].map((a) => decideReconnect(408, a, () => 0.5).delayMs);
  assert.deepEqual(d, [1000, 2000, 4000, 8000, 60000]);
});

test('open, then transient close reconnects with backoff and resets on success', async () => {
  const { client, fb, timers } = setup();
  let opened = 0;
  client.on('open', () => opened++);
  await client.start();
  await fb.sock.ev.emitAsync('connection.update', { connection: 'open' });
  assert.equal(client.status, 'open');
  assert.equal(client.selfJid, '15550009999@s.whatsapp.net');
  assert.equal(opened, 1);

  const first = fb.sock;
  await first.ev.emitAsync('connection.update', close(408));
  assert.equal(client.status, 'closed');
  assert.equal(timers.pending.length, 1);
  assert.equal(client.attempt, 1);
  await timers.pending[0].fn();
  assert.equal(fb.sockets.length, 2);
  assert.ok(first.ended, 'old socket was ended');

  await fb.sock.ev.emitAsync('connection.update', { connection: 'open' });
  assert.equal(client.attempt, 0);
});

test('restartRequired (after QR pairing) reconnects immediately without counting as failure', async () => {
  const { client, fb, timers } = setup();
  await client.start();
  await fb.sock.ev.emitAsync('connection.update', close(515));
  assert.equal(timers.pending[0].ms, 0);
  assert.equal(client.attempt, 0);
});

test('logged out: credentials cleared, fresh session started, event emitted', async () => {
  const t = setup();
  let loggedOut = 0;
  t.client.on('logged-out', () => loggedOut++);
  await t.client.start();
  await t.fb.sock.ev.emitAsync('connection.update', close(401));
  assert.equal(t.client.status, 'logged_out');
  assert.equal(t.clears(), 1);
  assert.equal(loggedOut, 1);
  await t.timers.pending[0].fn();
  assert.equal(t.fb.sockets.length, 2);
});

test('connection replaced: no reconnect, fatal emitted', async () => {
  const t = setup();
  const fatal = [];
  t.client.on('fatal', (e) => fatal.push(e.reason));
  await t.client.start();
  await t.fb.sock.ev.emitAsync('connection.update', close(440));
  assert.deepEqual(fatal, ['connection_replaced']);
  assert.equal(t.timers.pending.length, 0);
  assert.equal(t.client.status, 'stopped');
});

test('gives up after too many consecutive failures', async () => {
  const t = setup();
  const fatal = [];
  t.client.on('fatal', (e) => fatal.push(e.reason));
  await t.client.start();
  for (let i = 0; i < 25 && !fatal.length; i++) {
    await t.fb.sock.ev.emitAsync('connection.update', close(408));
    if (t.timers.pending[0]) await t.timers.pending[0].fn();
  }
  assert.deepEqual(fatal, ['too_many_failures']);
});

test('QR goes to the terminal only, never to the logger', async () => {
  const t = setup();
  await t.client.start();
  const qr = 'QR-SECRET-PAYLOAD-1234567890';
  await t.fb.sock.ev.emitAsync('connection.update', { qr });
  assert.equal(t.client.status, 'qr');
  assert.ok(t.out.text.length > 50, 'QR art written to output');
  assert.ok(!JSON.stringify(t.logs).includes(qr));
});

test('pairing-code mode requests the code once and prints it only to the terminal', async () => {
  const t = setup({ PAIRING_PHONE_NUMBER: '+1 555 000 1111' });
  await t.client.start();
  await t.fb.sock.ev.emitAsync('connection.update', { qr: 'x' });
  await t.fb.sock.ev.emitAsync('connection.update', { qr: 'y' });
  assert.deepEqual(t.fb.sock.pairingRequests, ['15550001111']);
  assert.match(t.out.text, /ABCD-1234/);
  assert.ok(!JSON.stringify(t.logs).includes('ABCD-1234'));
});

test('handler errors are reported and do not break the connection', async () => {
  const t = setup();
  t.client.on('messages.upsert', () => { throw new Error('handler bug'); });
  let second = 0;
  t.client.on('messages.upsert', () => second++);
  await t.client.start();
  await t.fb.sock.ev.emitAsync('messages.upsert', { messages: [], type: 'notify' });
  assert.equal(t.errors.length, 1);
  assert.equal(t.errors[0][1].scope, 'event:messages.upsert');
  assert.equal(second, 1, 'later handlers still run');
});

test('events from a replaced socket are ignored', async () => {
  const t = setup();
  let seen = 0;
  t.client.on('messages.upsert', () => seen++);
  await t.client.start();
  const old = t.fb.sock;
  await t.client.restart();
  assert.equal(t.fb.sockets.length, 2);
  await old.ev.emitAsync('messages.upsert', { messages: [], type: 'notify' }); // listeners were removed
  assert.equal(seen, 0);
  await t.fb.sock.ev.emitAsync('messages.upsert', { messages: [], type: 'notify' });
  assert.equal(seen, 1);
});

test('send methods refuse when not connected, track own message ids, chunk long text', async () => {
  const t = setup();
  await assert.rejects(() => t.client.sendText('1@s.whatsapp.net', 'x'), /not open/);
  await t.client.start();
  await t.fb.sock.ev.emitAsync('connection.update', { connection: 'open' });
  const sent = await t.client.sendText('1@s.whatsapp.net', 'hello');
  assert.ok(t.client.isOwnOutbound(sent.key.id));
  assert.ok(!t.client.isOwnOutbound('someone-else'));
  await t.client.sendText('1@s.whatsapp.net', 'y'.repeat(9000));
  assert.ok(t.fb.sock.sent.length >= 4);
  await t.client.stop();
  assert.equal(t.client.status, 'stopped');
  assert.equal(t.timers.pending.length, 0);
});

test('stop() prevents any further reconnects', async () => {
  const t = setup();
  await t.client.start();
  await t.client.stop();
  await t.fb.sock?.ev.emitAsync?.('connection.update', close(408));
  assert.equal(t.timers.pending.length, 0);
});

test('QR_IMAGE_PATH writes a scannable PNG alongside the terminal art', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'qr-test-'));
  const imagePath = path.join(dir, 'qr.png');
  const t = setup({ QR_IMAGE_PATH: imagePath });
  await t.client.start();
  await t.fb.sock.ev.emitAsync('connection.update', { qr: 'test-qr-payload' });
  const png = await readFile(imagePath);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'valid PNG signature');
  assert.ok(!JSON.stringify(t.logs).includes('test-qr-payload'), 'raw QR payload never logged, only the path');
  await rm(dir, { recursive: true, force: true });
});

test('a new pairing (isNewLogin) is reported on the open event; a plain reconnect is not', async () => {
  const t = setup();
  const opens = [];
  t.client.on('open', (e) => opens.push(e.justLinked));
  await t.client.start();
  await t.fb.sock.ev.emitAsync('connection.update', { qr: 'x' });
  await t.fb.sock.ev.emitAsync('connection.update', { isNewLogin: true, qr: undefined });
  await t.fb.sock.ev.emitAsync('connection.update', close(515)); // restart required right after pairing
  await t.timers.pending[0].fn();
  await t.fb.sock.ev.emitAsync('connection.update', { connection: 'open' });
  assert.deepEqual(opens, [true]);

  // a later, ordinary reconnect is NOT a new login
  await t.fb.sock.ev.emitAsync('connection.update', close(408));
  await t.timers.pending[0].fn();
  await t.fb.sock.ev.emitAsync('connection.update', { connection: 'open' });
  assert.deepEqual(opens, [true, false]);
});
