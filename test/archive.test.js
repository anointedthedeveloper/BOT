import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, ALICE, BOB, OWNER_JID, GROUP, nextId } from './helpers/harness.js';
import { canConfigureArchive } from '../src/services/archive.js';

let h;
before(async () => { h = await startHarness(); });
after(async () => { await h.stop(); });
beforeEach(async () => {
  await h.deps.chats.setArchive(GROUP, { mode: 'off' });
  await h.deps.chats.setArchive(ALICE, { mode: 'off' });
  await h.deps.messageCache.col.deleteMany({});
  await h.deps.users.setPref(OWNER_JID, 'notifyDeletes', true);
  await h.deps.users.setPref(BOB, 'contentLogging', true);
  h.clearSent();
});

const enableGroup = async (mode = 'full') => {
  await h.say(OWNER_JID, `/privacy archive ${mode}`, { group: true });
};
const cached = (id) => h.deps.messageCache.col.findOne({ msgId: id });

test('canConfigureArchive: pure authorisation rule', () => {
  const dm = { isGroup: false, senderCandidates: ['a@s.whatsapp.net'], chatJids: ['a@s.whatsapp.net'] };
  assert.equal(canConfigureArchive({ isOwner: false, ...dm }), true, 'own DM with the bot');
  assert.equal(canConfigureArchive({ isOwner: false, ...dm, chatJids: ['b@s.whatsapp.net'] }), false, 'someone else\'s chat');
  assert.equal(canConfigureArchive({ isOwner: false, isGroup: true, senderCandidates: ['a@s.whatsapp.net'], chatJids: ['g@g.us'] }), false, 'groups are owner-only');
  assert.equal(canConfigureArchive({ isOwner: true, isGroup: true, senderCandidates: [], chatJids: ['g@g.us'] }), true);
});

test('nothing is recorded or announced for chats that were never switched on', async () => {
  const msg = await h.say(ALICE, 'hello there', { group: true, chat: GROUP });
  assert.equal(await cached(msg.key.id), null);
  assert.equal(await h.deps.messageCache.count(), 0);
  await h.revoke(GROUP, msg.key.id, { participant: ALICE });
  assert.equal(h.sock.sent.length, 0, 'no deletion notice without consent');
});

test('only the owner can enable archiving in a group; members are refused', async () => {
  await h.say(BOB, '/privacy archive full', { group: true });
  assert.match(h.lastText(GROUP), /Only the bot owner/);
  assert.equal(await h.deps.chats.archiveMode(GROUP), 'off');
});

test('enabling posts a visible notice in the chat', async () => {
  await enableGroup('full');
  assert.equal(await h.deps.chats.archiveMode(GROUP), 'full');
  const notice = h.lastText(GROUP);
  assert.match(notice, /archiving is now \*ON \(full\)\*/);
  assert.match(notice, /View-once content is never stored/);
  assert.match(notice, /24h/);
});

test('a user can enable archiving only in their own private chat', async () => {
  await h.say(ALICE, '/privacy archive meta');
  assert.equal(await h.deps.chats.archiveMode(ALICE), 'meta');
  assert.equal((await h.deps.chats.get(ALICE)).archive.notifyJid, ALICE);
  assert.equal((await h.deps.chats.get(ALICE)).archive.enabledBy, ALICE);
});

test('deleted message with stored text: original content is shown and labelled as available', async () => {
  await enableGroup('full');
  h.clearSent();
  const msg = await h.say(ALICE, 'meet me at 9pm, bring the documents', { group: true });
  const doc = await cached(msg.key.id);
  assert.equal(doc.contentStored, true);
  assert.ok(doc.text.startsWith('enc:v1:'), 'stored encrypted');

  await h.revoke(GROUP, msg.key.id, { participant: ALICE });
  const note = h.lastText(OWNER_JID);
  assert.match(note, /original content available/);
  assert.match(note, /meet me at 9pm, bring the documents/);
  assert.match(note, /From: \+15552220001/);
  assert.equal(await cached(msg.key.id), null, 'cache entry removed after delivery');
});

test('deleted message in meta mode: says content was not stored (and why)', async () => {
  await enableGroup('meta');
  const msg = await h.say(ALICE, 'this text must not be kept', { group: true });
  const doc = await cached(msg.key.id);
  assert.equal(doc.contentStored, false);
  assert.equal(doc.text, null);
  await h.revoke(GROUP, msg.key.id, { participant: ALICE });
  const note = h.lastText(OWNER_JID);
  assert.match(note, /content not stored/);
  assert.match(note, /metadata-only/);
  assert.doesNotMatch(note, /must not be kept/);
});

test('deleted message the bot never received: explicitly says the original is NOT available', async () => {
  await enableGroup('full');
  h.clearSent();
  await h.revoke(GROUP, 'NEVER-SEEN-ID', { participant: ALICE });
  const note = h.lastText(OWNER_JID);
  assert.match(note, /original NOT available/);
  assert.match(note, /no record of it/);
});

test('sender opt-out downgrades capture to metadata', async () => {
  await enableGroup('full');
  await h.say(BOB, '/privacy logging off', { group: true });
  const msg = await h.say(BOB, 'i opted out of logging', { group: true });
  const doc = await cached(msg.key.id);
  assert.equal(doc.contentStored, false);
  assert.match(doc.reason, /opted out/);
  await h.revoke(GROUP, msg.key.id, { participant: BOB });
  assert.match(h.lastText(OWNER_JID), /sender opted out/);
});

test('operator switch ALLOW_CONTENT_LOGGING=false blocks full mode and content capture', async () => {
  const h2 = await startHarness({ env: { ALLOW_CONTENT_LOGGING: 'false' } });
  try {
    await h2.say(OWNER_JID, '/privacy archive full', { group: true });
    assert.match(h2.lastText(GROUP), /disabled by the operator/);
    assert.equal(await h2.deps.chats.archiveMode(GROUP), 'off');
    // even if the DB says "full", content is not captured
    await h2.deps.chats.setArchive(GROUP, { mode: 'full', enabledBy: OWNER_JID });
    const msg = await h2.say(ALICE, 'hello', { group: true });
    assert.equal((await h2.deps.messageCache.col.findOne({ msgId: msg.key.id })).contentStored, false);
  } finally {
    await h2.stop();
  }
});

test('view-once content is never stored, even in full mode', async () => {
  await enableGroup('full');
  const id = nextId();
  await h.say(ALICE, '', { group: true, id, raw: { viewOnceMessageV2: { message: { imageMessage: { caption: 'one-time secret', mediaKey: 'k', mimetype: 'image/jpeg' } } } } });
  const doc = await cached(id);
  assert.equal(doc.kind, 'view-once');
  assert.equal(doc.contentStored, false);
  assert.equal(doc.text, null);
  assert.match(doc.reason, /view-once/);
  assert.ok(!JSON.stringify(doc).includes('one-time secret'));
  await h.revoke(GROUP, id, { participant: ALICE });
  assert.doesNotMatch(h.lastText(OWNER_JID), /one-time secret/);
});

test('media messages: only metadata and caption-free record, never the file', async () => {
  await enableGroup('full');
  const id = nextId();
  await h.say(ALICE, '', { group: true, id, raw: { imageMessage: { mimetype: 'image/png', fileLength: 2048, mediaKey: 'k' } } });
  const doc = await cached(id);
  assert.equal(doc.kind, 'image');
  assert.equal(doc.contentStored, false);
  assert.deepEqual(doc.mediaMeta, { mimetype: 'image/png', fileName: null, size: 2048 });
  await h.revoke(GROUP, id, { participant: ALICE });
  assert.match(h.lastText(OWNER_JID), /image \(2\.0 KB\)/);
});

test('notifications respect the notifyDeletes preference', async () => {
  await enableGroup('full');
  await h.deps.users.setPref(OWNER_JID, 'notifyDeletes', false);
  h.clearSent();
  const msg = await h.say(ALICE, 'quiet please', { group: true });
  await h.revoke(GROUP, msg.key.id, { participant: ALICE });
  assert.equal(h.sock.sent.length, 0);
});

test('messages the account holder deleted themself do not trigger notices', async () => {
  await enableGroup('full');
  h.clearSent();
  const msg = await h.say(ALICE, 'x', { group: true });
  await h.revoke(GROUP, msg.key.id, { fromMe: true });
  assert.equal(h.sock.sent.length, 0);
});

test('deletion by someone other than the sender (admin delete) is attributed', async () => {
  await enableGroup('full');
  const msg = await h.say(ALICE, 'rule-breaking text', { group: true });
  await h.revoke(GROUP, msg.key.id, { participant: BOB });
  const note = h.lastText(OWNER_JID);
  assert.match(note, /From: \+15552220001/);
  assert.match(note, /Deleted by: \+15552220002/);
});

test('turning archiving off wipes the chat cache and stops recording', async () => {
  await enableGroup('full');
  const msg = await h.say(ALICE, 'remember me', { group: true });
  assert.ok(await cached(msg.key.id));
  await h.say(OWNER_JID, '/privacy archive off', { group: true });
  assert.match(h.lastText(GROUP), /archiving is now \*OFF\*/);
  assert.equal(await cached(msg.key.id), null);
  const later = await h.say(ALICE, 'after off', { group: true });
  assert.equal(await cached(later.key.id), null);
});

test('/privacy purge turns off archives the user enabled and drops their cached messages', async () => {
  await h.say(ALICE, '/privacy archive full');
  const msg = await h.say(ALICE, 'my own words');
  assert.ok(await cached(msg.key.id));
  await h.say(ALICE, '/privacy purge confirm');
  assert.equal(await cached(msg.key.id), null);
  assert.equal(await h.deps.chats.archiveMode(ALICE), 'off');
});

test('non-revoke message updates and history syncs are ignored', async () => {
  await enableGroup('full');
  h.clearSent();
  await h.sock.ev.emitAsync('messages.update', [{ key: { remoteJid: GROUP, id: 'X' }, update: { status: 3 } }]);
  const msg = await h.say(ALICE, 'from history', { group: true, type: 'append' });
  assert.equal(await cached(msg.key.id), null);
  assert.equal(h.sock.sent.length, 0);
});

test('a chat configured under its phone JID is still archived when WhatsApp addresses it by LID', async () => {
  await h.say(ALICE, '/privacy archive full');
  const id = nextId();
  await h.sock.ev.emitAsync('messages.upsert', { type: 'notify', messages: [{
    key: { remoteJid: '9988@lid', remoteJidAlt: ALICE, id, fromMe: false },
    message: { conversation: 'sent via lid addressing' }, messageTimestamp: Math.floor(Date.now() / 1000),
  }] });
  const doc = await cached(id);
  assert.equal(doc.chatJid, ALICE);
  assert.equal(doc.chatAlt, '9988@lid');
  assert.equal(doc.contentStored, true);
  h.clearSent();
  await h.sock.ev.emitAsync('messages.update', [{ key: { remoteJid: '9988@lid', remoteJidAlt: ALICE, id }, update: { messageStubType: 1 } }]);
  assert.match(h.lastText(ALICE), /sent via lid addressing/);
});

test('strangers in private mode cannot enable archiving', async () => {
  const h2 = await startHarness({ env: { BOT_MODE: 'private' } });
  try {
    await h2.say(ALICE, '/privacy archive full');
    assert.match(h2.lastText(ALICE), /Ask the bot owner/);
    assert.equal(await h2.deps.chats.archiveMode(ALICE), 'off');
    await h2.say(OWNER_JID, `/admin allow ${ALICE.split('@')[0]}`);
    await h2.say(ALICE, '/privacy archive full');
    assert.equal(await h2.deps.chats.archiveMode(ALICE), 'full');
  } finally {
    await h2.stop();
  }
});

// ── media archive mode ────────────────────────────────────────────────────────
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const mediaFiles = async () => (await readdir(h.config.media.dir, { recursive: true, withFileTypes: true }).catch(() => [])).filter((d) => d.isFile());
const enableMedia = () => h.say(OWNER_JID, '/privacy archive media', { group: true });
const media = (kind, extra = {}) => ({ [`${kind}Message`]: { mimetype: 'x/y', fileLength: 16, mediaKey: 'k', ...extra } });

test('media mode: notice lists files; photo is cached encrypted and re-sent when deleted', async () => {
  await enableMedia();
  assert.match(h.lastText(GROUP), /ON \(media\)/);
  assert.match(h.lastText(GROUP), /photos, videos, stickers, audio and documents/);
  h.clearSent();

  const id = nextId();
  await h.say(ALICE, '', { group: true, id, raw: media('image', { caption: 'look at this', mimetype: 'image/jpeg' }) });
  const doc = await cached(id);
  assert.equal(doc.mediaFile.kind, 'image');
  assert.equal(doc.expiresAt, undefined, 'media docs are swept by the job, not the TTL index');
  assert.ok(doc.sweepAt);
  const files = await mediaFiles();
  assert.equal(files.length, 1);
  const onDisk = await readFile(path.join(files[0].parentPath ?? files[0].path, files[0].name));
  assert.ok(!onDisk.includes('FAKE-MEDIA-BYTES'), 'encrypted at rest');

  await h.revoke(GROUP, id, { participant: ALICE });
  const note = h.lastText(OWNER_JID);
  assert.match(note, /original content available/);
  assert.match(note, /look at this/);
  assert.match(note, /sent below/);
  const resent = h.sock.sent.findLast((s) => s.jid === OWNER_JID && s.content.image);
  assert.equal(resent.content.image.toString(), 'FAKE-MEDIA-BYTES');
  assert.equal(resent.content.caption, 'look at this');
  assert.equal(await cached(id), null);
  assert.equal((await mediaFiles()).length, 0, 'file deleted after delivery');
});

test('media mode covers video, sticker, audio and document', async () => {
  await enableMedia();
  for (const [kind, key] of [['video', 'video'], ['sticker', 'sticker'], ['audio', 'audio'], ['document', 'document']]) {
    h.clearSent();
    const id = nextId();
    await h.say(ALICE, '', { group: true, id, raw: media(key, key === 'document' ? { fileName: 'a.pdf' } : {}) });
    await h.revoke(GROUP, id, { participant: ALICE });
    const resent = h.sock.sent.findLast((s) => s.jid === OWNER_JID && s.content[kind]);
    assert.ok(resent, `${kind} re-sent`);
  }
  assert.equal((await mediaFiles()).length, 0);
});

test('full mode never downloads files; sender opt-out and view-once are respected in media mode', async () => {
  await enableGroup('full');
  const a = nextId();
  await h.say(ALICE, '', { group: true, id: a, raw: media('image') });
  assert.equal((await cached(a)).mediaFile, null);
  assert.match((await cached(a)).reason, /not retained/);

  await enableMedia();
  await h.say(BOB, '/privacy logging off', { group: true });
  const b = nextId();
  await h.say(BOB, '', { group: true, id: b, raw: media('image') });
  assert.equal((await cached(b)).mediaFile, null);
  assert.match((await cached(b)).reason, /opted out/);

  const v = nextId();
  await h.say(ALICE, '', { group: true, id: v, raw: { viewOnceMessageV2: { message: media('image') } } });
  assert.equal((await cached(v)).mediaFile, null);
  assert.match((await cached(v)).reason, /view-once/);
  assert.equal((await mediaFiles()).length, 0, 'no files written in any of these cases');
});

test('media over the size limit is not downloaded', async () => {
  await enableMedia();
  const id = nextId();
  await h.say(ALICE, '', { group: true, id, raw: media('video', { fileLength: 500 * 1024 * 1024 }) });
  assert.equal((await cached(id)).mediaFile, null);
  assert.match((await cached(id)).reason, /size limit/);
});

test('turning archiving off, or purging, deletes cached files', async () => {
  await enableMedia();
  await h.say(ALICE, '', { group: true, id: nextId(), raw: media('image') });
  assert.equal((await mediaFiles()).length, 1);
  await h.say(OWNER_JID, '/privacy archive off', { group: true });
  assert.equal((await mediaFiles()).length, 0);

  await h.say(ALICE, '/privacy archive media');
  await h.say(ALICE, '', { id: nextId(), raw: media('image') });
  assert.equal((await mediaFiles()).length, 1);
  await h.say(ALICE, '/privacy purge confirm');
  assert.equal((await mediaFiles()).length, 0);
});

test('retention sweep removes expired cached media with its file', async () => {
  await enableMedia();
  const id = nextId();
  await h.say(ALICE, '', { group: true, id, raw: media('image') });
  await h.deps.messageCache.col.updateOne({ msgId: id }, { $set: { sweepAt: new Date(Date.now() - 1000) } });
  const { startRetentionJob } = await import('../src/services/retention.js');
  const job = startRetentionJob({ items: h.deps.items, messageCache: h.deps.messageCache, mediaStore: h.deps.mediaStore, logger: { info() {}, warn() {} }, intervalMs: 3_600_000 });
  await job.runOnce();
  job.stop();
  assert.equal(await cached(id), null);
  assert.equal((await mediaFiles()).length, 0);
});

test('operator switch ALLOW_MEDIA_CACHING=false blocks media mode', async () => {
  const h2 = await startHarness({ env: { ALLOW_MEDIA_CACHING: 'false' } });
  try {
    await h2.say(OWNER_JID, '/privacy archive media', { group: true });
    assert.match(h2.lastText(GROUP), /Media caching is disabled by the operator/);
    assert.equal(await h2.deps.chats.archiveMode(GROUP), 'off');
  } finally {
    await h2.stop();
  }
});

test('a failed media download is recorded as metadata with a reason', async () => {
  const h2 = await startHarness({ baileysOptions: { downloadError: new Error('expired') } });
  try {
    await h2.say(OWNER_JID, '/privacy archive media', { group: true });
    const id = nextId();
    await h2.say(ALICE, '', { group: true, id, raw: media('image') });
    const doc = await h2.deps.messageCache.col.findOne({ msgId: id });
    assert.equal(doc.mediaFile, null);
    assert.match(doc.reason, /could not be downloaded/);
  } finally {
    await h2.stop();
  }
});
