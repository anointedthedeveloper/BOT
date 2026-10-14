import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, ALICE, BOB, OWNER_JID, GROUP, nextId } from './helpers/harness.js';

let h;
before(async () => { h = await startHarness(); });
after(async () => { await h.stop(); });
beforeEach(async () => {
  await h.deps.chats.clearAll();
  await h.deps.messageCache.col.deleteMany({});
  await h.deps.settings.setDefaultArchiveMode('off');
  h.clearSent();
});

const cached = (id) => h.deps.messageCache.col.findOne({ msgId: id });
const enable = () => h.say(OWNER_JID, ',delete on');
const media = (kind, extra = {}) => ({ [`${kind}Message`]: { mimetype: 'x/y', fileLength: 16, mediaKey: 'k', ...extra } });

test('nothing is recorded or notified while monitoring is off', async () => {
  const msg = await h.say(ALICE, 'hello there', { group: true, chat: GROUP });
  assert.equal(await cached(msg.key.id), null);
  assert.equal(await h.deps.messageCache.count(), 0);
  await h.revoke(GROUP, msg.key.id, { participant: ALICE });
  assert.equal(h.sock.sent.length, 0, 'no notice without monitoring on');
});

test('enabling posts a visible notice in the chat the first time it captures a message there, once', async () => {
  await enable();
  h.clearSent();
  await h.say(ALICE, 'first message', { group: true });
  const notice = h.sock.texts(GROUP).at(-1);
  assert.match(notice, /Deleted-message monitoring is now \*ON \(media\)\*/);
  assert.match(notice, /View-once content is never stored/);

  h.clearSent();
  await h.say(BOB, 'second message, no repeat notice', { group: true });
  assert.equal(h.sock.texts(GROUP).length, 0, 'the notice is posted only once per chat');
});

test('deleted message with stored text: owner is notified privately with the original content', async () => {
  await enable();
  h.clearSent();
  const msg = await h.say(ALICE, 'meet me at 9pm, bring the documents', { group: true });
  const doc = await cached(msg.key.id);
  assert.equal(doc.contentStored, true);
  assert.ok(doc.text.startsWith('enc:v1:'), 'stored encrypted');

  h.clearSent();
  await h.revoke(GROUP, msg.key.id, { participant: ALICE });
  assert.equal(h.sock.texts(GROUP).length, 0, 'never posted back in the chat');
  const note = h.lastText(OWNER_JID);
  assert.match(note, /original content available/);
  assert.match(note, /meet me at 9pm, bring the documents/);
  assert.match(note, /From: \+15552220001/);
  assert.equal(await cached(msg.key.id), null, 'cache entry removed after delivery');
});

test('deleted message the bot never captured: explicitly says the original is NOT available', async () => {
  await enable();
  await h.say(ALICE, 'establishes monitoring for this chat', { group: true });
  h.clearSent();
  await h.revoke(GROUP, 'NEVER-SEEN-ID', { participant: ALICE });
  const note = h.lastText(OWNER_JID);
  assert.match(note, /original NOT available/);
  assert.match(note, /no record of it/);
});

test('a chat that was never monitored produces no notification even if a message is deleted there', async () => {
  await enable(); // monitoring is on globally, but this chat has not yet had a message captured
  h.clearSent();
  await h.revoke(ALICE, 'SOME-ID', {});
  assert.equal(h.sock.sent.length, 0);
});

test('media is captured and re-sent privately to the owner on deletion', async () => {
  await enable();
  h.clearSent();
  const id = nextId();
  await h.say(ALICE, '', { group: true, id, raw: media('image', { caption: 'look at this', mimetype: 'image/jpeg' }) });
  const doc = await cached(id);
  assert.equal(doc.mediaFile.kind, 'image');

  h.clearSent();
  await h.revoke(GROUP, id, { participant: ALICE });
  const note = h.lastText(OWNER_JID);
  assert.match(note, /original content available/);
  assert.match(note, /look at this/);
  assert.match(note, /sent below/);
  const resent = h.sock.sent.findLast((s) => s.jid === OWNER_JID && s.content.image);
  assert.equal(resent.content.image.toString(), 'FAKE-MEDIA-BYTES');
});

test('view-once content is never stored, even while monitoring is on', async () => {
  await enable();
  const id = nextId();
  await h.say(ALICE, '', { group: true, id, raw: { viewOnceMessageV2: { message: { imageMessage: { caption: 'one-time secret', mediaKey: 'k', mimetype: 'image/jpeg' } } } } });
  const doc = await cached(id);
  assert.equal(doc.kind, 'view-once');
  assert.equal(doc.contentStored, false);
  assert.equal(doc.text, null);
  assert.match(doc.reason, /view-once/);
  assert.ok(!JSON.stringify(doc).includes('one-time secret'));
  h.clearSent();
  await h.revoke(GROUP, id, { participant: ALICE });
  assert.doesNotMatch(h.lastText(OWNER_JID), /one-time secret/);
});

test('operator switch ALLOW_CONTENT_LOGGING=false forces full down to meta and refuses ,delete on content', async () => {
  const h2 = await startHarness({ env: { ALLOW_CONTENT_LOGGING: 'false' } });
  try {
    await h2.say(OWNER_JID, ',delete on');
    assert.match(h2.lastText(OWNER_JID), /\(media\) is now ON/, 'media still allowed; only content logging is off');
    const msg = await h2.say(ALICE, 'hello', { group: true });
    assert.equal((await h2.deps.messageCache.col.findOne({ msgId: msg.key.id })).contentStored, false);
  } finally {
    await h2.stop();
  }
});

test('operator switch ALLOW_MEDIA_CACHING=false falls back to full (text only)', async () => {
  const h2 = await startHarness({ env: { ALLOW_MEDIA_CACHING: 'false' } });
  try {
    await h2.say(OWNER_JID, ',delete on');
    assert.match(h2.lastText(OWNER_JID), /\(full\) is now ON/);
    const id = nextId();
    await h2.say(ALICE, '', { group: true, id, raw: media('image') });
    assert.equal((await h2.deps.messageCache.col.findOne({ msgId: id })).mediaFile, null);
  } finally {
    await h2.stop();
  }
});

test('both logging kill switches off: ,delete on is refused entirely', async () => {
  const h2 = await startHarness({ env: { ALLOW_CONTENT_LOGGING: 'false', ALLOW_MEDIA_CACHING: 'false' } });
  try {
    await h2.say(OWNER_JID, ',delete on');
    assert.match(h2.lastText(OWNER_JID), /nothing this can turn on/);
    assert.equal(h2.deps.settings.defaultArchiveMode, 'off');
  } finally {
    await h2.stop();
  }
});

test('a chat addressed by LID is still correctly tracked as the same monitored chat', async () => {
  await enable();
  const id = nextId();
  await h.sock.ev.emitAsync('messages.upsert', { type: 'notify', messages: [{
    key: { remoteJid: '9988@lid', remoteJidAlt: ALICE, id, fromMe: false },
    message: { conversation: 'sent via lid addressing' }, messageTimestamp: Math.floor(Date.now() / 1000),
  }] });
  const doc = await cached(id);
  assert.equal(doc.chatJid, ALICE);
  assert.equal(doc.chatAlt, '9988@lid');
  h.clearSent();
  await h.sock.ev.emitAsync('messages.update', [{ key: { remoteJid: '9988@lid', remoteJidAlt: ALICE, id }, update: { messageStubType: 1 } }]);
  assert.match(h.lastText(OWNER_JID), /sent via lid addressing/);
});

test('messages the account holder deleted themself do not trigger a notification', async () => {
  await enable();
  const msg = await h.say(ALICE, 'x', { group: true });
  h.clearSent();
  await h.revoke(GROUP, msg.key.id, { fromMe: true });
  assert.equal(h.sock.sent.length, 0);
});

test('deletion by someone other than the sender is attributed to the deleter', async () => {
  await enable();
  const msg = await h.say(ALICE, 'rule-breaking text', { group: true });
  h.clearSent();
  await h.revoke(GROUP, msg.key.id, { participant: BOB });
  const note = h.lastText(OWNER_JID);
  assert.match(note, /From: \+15552220001/);
  assert.match(note, /Deleted by: \+15552220002/);
});

test('non-revoke message updates and history syncs are ignored', async () => {
  await enable();
  h.clearSent();
  await h.sock.ev.emitAsync('messages.update', [{ key: { remoteJid: GROUP, id: 'X' }, update: { status: 3 } }]);
  const msg = await h.say(ALICE, 'from history', { group: true, type: 'append' });
  assert.equal(await cached(msg.key.id), null);
  assert.equal(h.sock.sent.length, 0);
});

test('a deletion notice cannot be sent when there is no configured owner JID', async () => {
  const { DeletionNotifier } = await import('../src/services/deletions.js');
  const dn = new DeletionNotifier({ repos: h.deps, client: h.deps.client, logger: h.deps.logger, mediaStore: h.deps.mediaStore, ttlHours: 24, ownerJid: null });
  const results = await dn.handleUpdates([{ key: { remoteJid: GROUP, id: 'X' }, update: { messageStubType: 1 } }]);
  assert.deepEqual(results, []);
});
