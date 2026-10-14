import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { startHarness, ALICE, OWNER_JID } from './helpers/harness.js';
import { UserError } from '../src/utils/errors.js';
import { ErrorReporter } from '../src/services/errorReporter.js';
import { startRetentionJob } from '../src/services/retention.js';

const harnesses = [];
const boot = async (opts) => { const h = await startHarness(opts); harnesses.push(h); return h; };
after(async () => { for (const h of harnesses) await h.stop(); });

const register = (h, name, execute) => h.deps.registry.register({ name, description: 'test', execute });

test('unexpected command errors: friendly reply with reference, logged, owner notified once', async () => {
  const h = await boot();
  register(h, 'boom', () => { throw new Error('database exploded: secret-detail'); });
  await h.say(ALICE, ',boom');
  const reply = h.lastText(ALICE);
  assert.match(reply, /Something went wrong\. Reference: [a-z0-9]{4,}/);
  assert.doesNotMatch(reply, /exploded|secret-detail/, 'internal details never reach the user');
  assert.equal(h.deps.errorReporter.total, 1);

  const ownerMsgs = h.sock.texts(OWNER_JID);
  assert.equal(ownerMsgs.length, 1);
  const ref = reply.match(/Reference: (\w+)/)[1];
  assert.ok(ownerMsgs[0].includes(ref));
  assert.match(ownerMsgs[0], /command:boom/);

  await h.say(ALICE, ',boom');
  assert.equal(h.sock.texts(OWNER_JID).length, 1, 'same error is de-duplicated');
  assert.equal(h.deps.errorReporter.total, 2);
});

test('UserError is shown to the user and is not reported as a bug', async () => {
  const h = await boot();
  register(h, 'strict', () => { throw new UserError('Please provide a thing.'); });
  await h.say(ALICE, ',strict');
  assert.equal(h.lastText(ALICE), '⚠️ Please provide a thing.');
  assert.equal(h.deps.errorReporter.total, 0);
  assert.equal(h.sock.texts(OWNER_JID).length, 0);
});

test('a failing reply does not crash the pipeline; later messages still work', async () => {
  const h = await boot();
  register(h, 'boom2', () => { throw new Error('x'); });
  register(h, 'pingtest', (ctx) => ctx.reply('Pong'));
  const original = h.sock.sendMessage.bind(h.sock);
  h.sock.sendMessage = async () => { throw new Error('socket closed'); };
  await h.say(ALICE, ',boom2'); // must not throw
  h.sock.sendMessage = original;
  await h.say(ALICE, ',pingtest');
  assert.match(h.lastText(ALICE), /Pong/);
});

test('archive failures are reported but do not block commands', async () => {
  const h = await boot();
  register(h, 'pingtest', (ctx) => ctx.reply('Pong'));
  h.deps.archive.record = async () => { throw new Error('mongo hiccup'); };
  await h.say(ALICE, ',pingtest');
  assert.match(h.lastText(ALICE), /Pong/);
  assert.equal(h.deps.errorReporter.total, 1);
});

test('malformed events never throw out of the handler', async () => {
  const h = await boot();
  await h.sock.ev.emitAsync('messages.upsert', { type: 'notify', messages: [null, {}, { key: {} }, { key: { id: 'a', remoteJid: 'x@s.whatsapp.net' } }, { key: { id: 'b', remoteJid: 'x@s.whatsapp.net' }, message: {} }] });
  await h.sock.ev.emitAsync('messages.update', [null, {}, { key: { id: 'z' }, update: { messageStubType: 1 } }]);
  assert.equal(h.deps.errorReporter.total >= 0, true);
});

test('a deletion notice that cannot be sent is logged, not thrown', async () => {
  const h = await boot();
  await h.say(OWNER_JID, ',delete on');
  await h.say(ALICE, 'hello', { group: true }); // activates monitoring for the group
  h.sock.sendMessage = async () => { throw new Error('offline'); };
  const results = await h.deps.deletions.handleUpdates([{ key: { remoteJid: '120363000000000001@g.us', id: 'GONE' }, update: { messageStubType: 1 } }]);
  assert.equal(results[0].notified, false);
  assert.match(results[0].error, /offline/);
});

test('ErrorReporter limits notifications per hour and per fingerprint', async () => {
  const sent = [];
  const logs = [];
  let t = 0;
  const logger = { error: (...a) => logs.push(a), warn: () => {} };
  const r = new ErrorReporter({ logger, notifyOwner: true, now: () => t, maxPerHour: 2, dedupeMs: 1000 });
  r.setNotifier(async (m) => sent.push(m));
  r.report(new Error('a'), { scope: 's1' });
  r.report(new Error('a'), { scope: 's1' }); // duplicate
  r.report(new Error('b'), { scope: 's1' });
  r.report(new Error('c'), { scope: 's1' }); // over the hourly cap
  assert.equal(sent.length, 2);
  t = 3_700_000;
  r.report(new Error('c'), { scope: 's1' });
  assert.equal(sent.length, 3);
  assert.equal(r.total, 5);
  assert.ok(r.recent.length <= 20);
  assert.ok(sent.every((m) => !m.includes('at ')), 'no stack traces in notifications');
});

test('ErrorReporter survives a failing notifier and honours the disable flag', async () => {
  const logger = { error: () => {}, warn: () => {} };
  const r = new ErrorReporter({ logger, notifyOwner: true });
  r.setNotifier(async () => { throw new Error('cannot send'); });
  assert.doesNotThrow(() => r.report(new Error('x')));
  const off = new ErrorReporter({ logger, notifyOwner: false });
  let called = false;
  off.setNotifier(async () => { called = true; });
  off.report('string error');
  assert.equal(called, false);
  assert.equal(off.recent[0].message, 'string error');
});

test('retention job deletes cached media past its lifetime, and reports errors', async () => {
  const h = await boot();
  const stored = await h.deps.mediaStore.save('cache:x', Buffer.from('file'));
  await h.deps.messageCache.record({ chatJid: 'c1', msgId: 'EXP1', senderJid: ALICE, timestamp: 1, kind: 'image', contentStored: false, mediaFile: { path: stored.path, kind: 'image', size: stored.size } });
  await h.deps.messageCache.col.updateOne({ msgId: 'EXP1' }, { $set: { sweepAt: new Date(Date.now() - 1000) } });

  const job = startRetentionJob({ messageCache: h.deps.messageCache, mediaStore: h.deps.mediaStore, logger: { info() {}, warn() {} }, intervalMs: 3_600_000 });
  const res = await job.runOnce();
  job.stop();
  assert.equal(res.removed, 1);
  assert.equal(await h.deps.messageCache.find(['c1'], 'EXP1'), null);
  await assert.rejects(() => access(path.join(h.config.media.dir, stored.path)));

  const errors = [];
  const bad = startRetentionJob({ messageCache: { deleteExpiredMedia: async () => { throw new Error('db down'); } }, mediaStore: h.deps.mediaStore, logger: { info() {} }, intervalMs: 3_600_000, onError: (e, c) => errors.push([e.message, c.scope]) });
  await bad.runOnce();
  bad.stop();
  assert.deepEqual(errors, [['db down', 'retention']]);
});

test('MediaStore refuses paths outside its directory', async () => {
  const h = await boot();
  await assert.rejects(() => h.deps.mediaStore.read('../../etc/passwd'), /escapes media directory/);
});

test('graceful shutdown stops the client, closes services and exits once', async () => {
  const h = await startHarness();
  await h.app.shutdown(0, 'test-a');
  await h.app.shutdown(0, 'test-b');
  assert.deepEqual(h.exits, [0], 'idempotent');
  assert.equal(h.deps.client.status, 'stopped');
  assert.ok(h.sock.ended);
  // db handle is closed: pings now fail
  assert.equal(await h.deps.db.ping(), false);
  await h.stop().catch(() => {});
});

test('fatal connection state (session replaced) triggers shutdown with a non-zero exit code', async () => {
  const h = await boot();
  await h.sock.ev.emitAsync('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 440 } } } });
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(h.exits, [1]);
});
