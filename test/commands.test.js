import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { startHarness, ALICE, BOB, OWNER_JID } from './helpers/harness.js';

let h;
before(async () => { h = await startHarness(); });
after(async () => { await h.stop(); });

const say = (...a) => h.say(...a);
const last = (jid = ALICE) => h.lastText(jid);

test('routes the documented command set', async () => {
  for (const name of ['menu', 'help', 'ping', 'info', 'settings', 'bookmark', 'search', 'privacy', 'owner', 'restart']) {
    assert.ok(h.deps.registry.get(name), `/${name} is registered`);
  }
  await say(ALICE, '/help');
  assert.match(last(), /help/i);
  await say(ALICE, '/help bookmark');
  assert.match(last(), /Usage: \/bookmark/);
  await say(ALICE, '/info');
  assert.match(last(), /\*UtilityBot\* v1\.0\.0/);
  assert.doesNotMatch(last(), /Users:/, 'admin stats hidden from regular users');
  await say(OWNER_JID, '/info');
  assert.match(last(OWNER_JID), /Users:/);
  await say(ALICE, '/owner');
  assert.match(last(), /no(t)? published|Bot owner/);
});

test('aliases resolve, unknown commands get a hint, plain chatter is ignored', async () => {
  await say(ALICE, '/commands');
  assert.match(last(), /command menu/);
  await say(ALICE, '/definitelynotacommand');
  assert.match(last(), /Unknown command/);
  h.clearSent();
  await say(ALICE, 'just chatting, not a command');
  await say(ALICE, 'hey /ping');
  assert.equal(h.sock.sent.length, 0);
});

test('stale (replayed) and non-live messages are ignored', async () => {
  h.clearSent();
  await say(ALICE, '/ping', { ts: Math.floor(Date.now() / 1000) - 3600 });
  await say(ALICE, '/ping', { type: 'append' });
  await say(ALICE, '/ping', { type: 'notify', chat: 'status@broadcast' });
  assert.equal(h.sock.sent.length, 0);
});

test('commands work in groups and reply to the group', async () => {
  await say(BOB, '/ping', { group: true });
  assert.match(h.sock.sent.at(-1).content.text, /Pong/);
  assert.match(h.sock.sent.at(-1).jid, /@g\.us$/);
});

test('settings: view, set, validate, reset', async () => {
  await say(ALICE, '/settings');
  assert.match(last(), /notifyDeletes/);
  await say(ALICE, '/settings set timezone Africa/Lagos');
  assert.match(last(), /Africa\/Lagos/);
  await say(ALICE, '/settings set timezone Mars/Base');
  assert.match(last(), /not a valid IANA timezone/);
  await say(ALICE, '/settings set bogus 1');
  assert.match(last(), /Unknown setting/);
  await say(ALICE, '/settings set notifyDeletes maybe');
  assert.match(last(), /on or off/);
  await say(ALICE, '/settings set notifyDeletes off');
  assert.equal((await h.deps.users.get(ALICE)).prefs.notifyDeletes, false);
  await say(ALICE, '/settings reset');
  assert.equal((await h.deps.users.get(ALICE)).prefs.timezone, 'UTC');
});

test('notes: add, tag search, list, show, delete', async () => {
  await say(ALICE, '/note Pick up the parcel #errands');
  assert.match(last(), /Saved as \*#\d+\*/);
  await say(ALICE, '/note Call mum on Sunday');
  await say(ALICE, '/note list');
  assert.match(last(), /parcel/);
  assert.match(last(), /Call mum/);
  await say(ALICE, '/search parcel');
  assert.match(last(), /1 result/);
  await say(ALICE, '/search #errands');
  assert.match(last(), /parcel/);
  await say(ALICE, '/search mum type:bookmark');
  assert.match(last(), /No matches/);
  await say(ALICE, '/search');
  assert.match(last(), /Usage/);
  await say(ALICE, '/search x type:wrong');
  assert.match(last(), /type must be one of/);

  const [{ seq }] = await h.deps.items.list(ALICE, { type: 'note', limit: 1 });
  await say(ALICE, `/note show #${seq}`);
  assert.match(last(), /Call mum/);
  await say(ALICE, `/note delete ${seq}`);
  assert.match(last(), /deleted/);
  await say(ALICE, `/note show ${seq}`);
  assert.match(last(), /No such item/);
  await say(ALICE, '/note show abc');
  assert.match(last(), /item number/);
});

test('notes are private per user', async () => {
  await say(BOB, '/search parcel');
  assert.match(last(BOB), /No matches/);
  await say(BOB, '/note show 1');
  assert.match(last(BOB), /No such item/);
});

test('bookmark and save need a replied-to message; text is stored for the user', async () => {
  await say(ALICE, '/bookmark');
  assert.match(last(), /Reply to the message/);
  await say(ALICE, '/save');
  assert.match(last(), /Reply to the message/);

  const quoted = { id: 'Q-TEXT', participant: BOB, message: { conversation: 'The wifi password is hunter2 #home' } };
  await say(ALICE, '/bookmark wifi', { quoted });
  assert.match(last(), /Bookmarked as \*#\d+\*/);
  await say(ALICE, '/save keep this', { quoted });
  assert.match(last(), /Saved as \*#\d+\*/);
  await say(ALICE, '/search hunter2');
  assert.match(last(), /2 results/);
  await say(ALICE, '/search #home type:saved');
  assert.match(last(), /1 result/);
  await say(ALICE, '/bookmark list');
  assert.match(last(), /Your bookmarks/);
  await say(ALICE, '/saved list');
  assert.match(last(), /wifi password/);
  const bm = (await h.deps.items.list(ALICE, { type: 'bookmark', limit: 1 }))[0];
  assert.equal(bm.ref.msgId, 'Q-TEXT');
  assert.equal(bm.note, 'wifi');
});

test('saving media downloads, encrypts on disk, and can be re-sent', async () => {
  const quoted = { id: 'Q-IMG', participant: BOB, message: { imageMessage: { caption: 'my cat', mimetype: 'image/jpeg', fileLength: 16, mediaKey: 'k' } } };
  await say(ALICE, '/save', { quoted });
  assert.match(last(), /Saved as \*#\d+\*.*image/);
  const item = (await h.deps.items.list(ALICE, { type: 'saved', limit: 1 }))[0];
  assert.equal(item.media.kind, 'image');

  const dirs = await readdir(h.config.media.dir, { recursive: true, withFileTypes: true });
  const file = dirs.find((d) => d.isFile());
  const onDisk = await readFile(path.join(file.parentPath ?? file.path, file.name));
  assert.ok(!onDisk.includes('FAKE-MEDIA-BYTES'), 'media is encrypted at rest');

  await say(ALICE, `/saved show ${item.seq}`);
  const media = h.sock.sent.findLast((s) => s.content.image);
  assert.equal(media.content.image.toString(), 'FAKE-MEDIA-BYTES');
  assert.equal(media.content.caption, 'my cat');

  await say(ALICE, `/saved delete ${item.seq}`);
  const left = (await readdir(h.config.media.dir, { recursive: true, withFileTypes: true })).filter((d) => d.isFile());
  assert.equal(left.length, 0, 'file removed with the item');
});

test('oversized and failed media are refused politely', async () => {
  const big = { id: 'Q-BIG', message: { videoMessage: { fileLength: 200 * 1024 * 1024, mimetype: 'video/mp4' } } };
  await say(ALICE, '/save', { quoted: big });
  assert.match(last(), /limit is 25\.0 MB/);

  const h2 = await startHarness({ baileysOptions: { downloadError: new Error('410 gone') } });
  try {
    await h2.say(ALICE, '/save', { quoted: { id: 'Q', message: { documentMessage: { fileLength: 10, fileName: 'a.pdf' } } } });
    assert.match(h2.lastText(ALICE), /could not download/);
  } finally {
    await h2.stop();
  }
});

test('view-once messages are never saved or bookmarked', async () => {
  for (const message of [
    { viewOnceMessageV2: { message: { imageMessage: { caption: 'secret', mediaKey: 'k' } } } },
    { imageMessage: { viewOnce: true, mediaKey: 'k' } },
  ]) {
    const before = await h.deps.items.count(ALICE);
    await say(ALICE, '/save', { quoted: { id: 'Q-VO', message } });
    assert.match(last(), /View-once messages cannot be saved/);
    await say(ALICE, '/bookmark', { quoted: { id: 'Q-VO', message } });
    assert.match(last(), /View-once messages cannot be bookmarked/);
    assert.equal(await h.deps.items.count(ALICE), before);
  }
});

test('a command attached to a view-once message is ignored', async () => {
  h.clearSent();
  await say(ALICE, '', { raw: { viewOnceMessage: { message: { imageMessage: { caption: '/ping' } } } } });
  assert.equal(h.sock.sent.length, 0);
});

test('item limit is enforced', async () => {
  const h2 = await startHarness({ env: { MAX_ITEMS_PER_USER: '10' } });
  try {
    for (let i = 0; i < 10; i++) await h2.say(ALICE, `/note n${i}`);
    await h2.say(ALICE, '/note one more');
    assert.match(h2.lastText(ALICE), /item limit/);
  } finally {
    await h2.stop();
  }
});

test('privacy: status, logging opt-out, retention, export, purge', async () => {
  await say(ALICE, '/privacy');
  assert.match(last(), /Privacy status/);
  assert.match(last(), /archive: \*off\*/);
  await say(ALICE, '/privacy logging off');
  assert.equal((await h.deps.users.get(ALICE)).prefs.contentLogging, false);
  await say(ALICE, '/privacy logging on');
  await say(ALICE, '/privacy retention 7');
  assert.equal((await h.deps.users.get(ALICE)).prefs.retentionDays, 7);
  await say(ALICE, '/note expires soon');
  const [n] = await h.deps.items.list(ALICE, { limit: 1 });
  const days = (n.expiresAt - n.createdAt) / 86_400_000;
  assert.equal(Math.round(days), 7);
  await say(ALICE, '/privacy retention 99999');
  assert.match(last(), /whole number of days/);
  await say(ALICE, '/privacy retention off');
  assert.equal((await h.deps.users.get(ALICE)).prefs.retentionDays, 0);

  await say(ALICE, '/privacy export');
  const doc = h.sock.sent.findLast((s) => s.content.document);
  const exported = JSON.parse(doc.content.document.toString());
  assert.ok(exported.items.length > 0);
  assert.ok(!doc.content.document.toString().includes('"path"'));

  await say(ALICE, '/privacy purge');
  assert.match(last(), /privacy purge confirm/);
  assert.ok((await h.deps.items.count(ALICE)) > 0, 'nothing deleted without confirmation');
  await say(ALICE, '/privacy purge confirm');
  assert.match(last(), /Done/);
  assert.equal(await h.deps.items.count(ALICE), 0);
  await say(ALICE, '/privacy bogus');
  assert.match(last(), /Unknown option/);
});

test('ackReactions reacts to successful commands when enabled', async () => {
  await say(BOB, '/settings set ackReactions on');
  h.clearSent();
  await say(BOB, '/ping');
  assert.ok(h.sock.sent.some((s) => s.content.react?.text === '✅'));
});
