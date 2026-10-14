import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as baileys from '@whiskeysockets/baileys';
import { connectDatabase, createRepositories, useMongoAuthState } from '../src/database/index.js';
import { loadConfig } from '../src/config/index.js';
import { createCipherBox } from '../src/utils/crypto.js';

let mongod, database, repos, config;
const cipher = createCipherBox(Buffer.alloc(32, 9));
const U = '15552220001@s.whatsapp.net';
const V = '15552220002@s.whatsapp.net';

before(async () => {
  mongod = await MongoMemoryServer.create();
  config = loadConfig({ MONGODB_URI: mongod.getUri(), OWNER_NUMBERS: '15550001111', CACHE_TTL_HOURS: '2' });
  database = await connectDatabase({ uri: mongod.getUri(), dbName: 'dbtest' }, null);
  repos = await createRepositories(database.db, config, cipher);
});
after(async () => {
  await database?.close();
  await mongod?.stop();
});

test('connectDatabase fails with a clear error when the server is unreachable', async () => {
  await assert.rejects(
    () => connectDatabase({ uri: 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=300', dbName: 'x' }, null, { retries: 2, delayMs: 10 }),
    /Could not connect to MongoDB after 2 attempts/,
  );
});

test('users: ensure creates defaults, prefs merge, bans and roles', async () => {
  const u = await repos.users.ensure(U);
  assert.equal(u.role, 'user');
  assert.equal(u.prefs.retentionDays, 30);
  assert.equal(u.prefs.contentLogging, true);
  await repos.users.setPref(U, 'timezone', 'Africa/Lagos');
  assert.equal((await repos.users.get(U)).prefs.timezone, 'Africa/Lagos');
  await repos.users.resetPrefs(U);
  assert.equal((await repos.users.get(U)).prefs.timezone, 'UTC');
  await repos.users.setBanned(U, true, 'spam');
  assert.equal((await repos.users.get(U)).banned, true);
  assert.equal((await repos.users.get(U)).banReason, 'spam');
  await repos.users.setBanned(U, false);
  assert.equal((await repos.users.get(U)).banned, false);
  await repos.users.setRole(V, 'admin');
  assert.equal((await repos.users.get(V)).role, 'admin');
  assert.equal(await repos.users.get('nobody@s.whatsapp.net'), null);
});

test('items: sequence numbers are unique under concurrency', async () => {
  const jid = '15553330000@s.whatsapp.net';
  const created = await Promise.all(Array.from({ length: 25 }, (_, i) => repos.items.create(jid, { type: 'note', text: `n${i}` })));
  const seqs = created.map((c) => c.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, Array.from({ length: 25 }, (_, i) => i + 1));
});

test('items: encrypted at rest, decrypted on read, searchable', async () => {
  const jid = '15553330001@s.whatsapp.net';
  const note = await repos.items.create(jid, { type: 'note', text: 'Buy oat MILK tomorrow #shopping', tags: ['shopping'] });
  await repos.items.create(jid, { type: 'bookmark', note: 'receipt', ref: { chatJid: 'c', msgId: 'm', kind: 'image', excerpt: 'Invoice 42 from ACME' } });
  const raw = await database.db.collection('items').findOne({ userJid: jid, seq: note.seq });
  assert.ok(raw.text.startsWith('enc:v1:'));
  assert.ok(!JSON.stringify(raw).includes('oat'));

  assert.equal((await repos.items.get(jid, note.seq)).text, 'Buy oat MILK tomorrow #shopping');
  assert.equal((await repos.items.get(jid, note.seq, 'bookmark')), null, 'type filter');

  const hit = await repos.items.search(jid, { terms: ['milk', 'oat'] });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].item.seq, note.seq);
  assert.equal((await repos.items.search(jid, { terms: ['milk', 'banana'] })).length, 0);
  assert.equal((await repos.items.search(jid, { terms: ['acme'] })).length, 1, 'searches bookmark excerpts');
  assert.equal((await repos.items.search(jid, { tag: 'Shopping' })).length, 1);
  assert.equal((await repos.items.search(jid, { terms: ['receipt'], type: 'note' })).length, 0);
});

test('items: users cannot see or delete each other\'s items', async () => {
  const a = '15554440001@s.whatsapp.net';
  const b = '15554440002@s.whatsapp.net';
  const item = await repos.items.create(a, { type: 'note', text: 'private to a' });
  assert.equal(await repos.items.get(b, item.seq), null);
  assert.equal(await repos.items.delete(b, item.seq), null);
  assert.equal((await repos.items.search(b, { terms: ['private'] })).length, 0);
  assert.ok(await repos.items.get(a, item.seq));
});

test('items: retention sweep removes only expired items and reports media paths', async () => {
  const jid = '15555550001@s.whatsapp.net';
  const now = new Date('2030-01-01T00:00:00Z');
  const old = await repos.items.create(jid, { type: 'saved', text: 'old', media: { path: 'x/y', kind: 'image', size: 1 }, retentionDays: 1 });
  const keep = await repos.items.create(jid, { type: 'note', text: 'forever', retentionDays: 0 });
  const later = await repos.items.create(jid, { type: 'note', text: 'later', retentionDays: 5000 });
  const res = await repos.items.deleteExpired(now);
  assert.equal(res.removed >= 1, true);
  assert.ok(res.mediaPaths.includes('x/y'));
  assert.equal(await repos.items.get(jid, old.seq), null);
  assert.ok(await repos.items.get(jid, keep.seq));
  assert.ok(await repos.items.get(jid, later.seq));
});

test('items: deleteAllForUser and exportAll', async () => {
  const jid = '15556660001@s.whatsapp.net';
  await repos.items.create(jid, { type: 'note', text: 'a' });
  await repos.items.create(jid, { type: 'saved', text: 'b', media: { path: 'm/1', kind: 'image', size: 3, fileName: 'f.png' } });
  const exp = await repos.items.exportAll(jid);
  assert.equal(exp.length, 2);
  assert.equal(exp[1].media.fileName, 'f.png');
  assert.ok(!('path' in exp[1].media), 'export never leaks storage paths');
  assert.deepEqual(await repos.items.deleteAllForUser(jid), ['m/1']);
  assert.equal(await repos.items.count(jid), 0);
});

test('chats: archive mode defaults to off, validates, caches and invalidates', async () => {
  const chat = '120363111@g.us';
  assert.equal(await repos.chats.archiveMode(chat), 'off');
  await repos.chats.setArchive(chat, { mode: 'full', enabledBy: U, isGroup: true });
  assert.equal(await repos.chats.archiveMode(chat), 'full');
  assert.equal((await repos.chats.get(chat)).archive.notifyJid, chat);
  assert.equal((await repos.chats.listArchivedBy(U)).length >= 1, true);
  await assert.rejects(() => repos.chats.setArchive(chat, { mode: 'everything', enabledBy: U }), /Invalid archive mode/);
  await repos.chats.setArchive(chat, { mode: 'off' });
  assert.equal(await repos.chats.archiveMode(chat), 'off');
});

test('message cache: TTL index, encryption, lookup by alt jid, removal', async () => {
  const idx = await database.db.collection('message_cache').indexes();
  const ttl = idx.find((i) => i.key.expiresAt);
  assert.equal(ttl.expireAfterSeconds, 0);

  await repos.messageCache.record({ chatJid: '99@lid', chatAlt: '1555@s.whatsapp.net', msgId: 'M1', senderJid: U, timestamp: 1700000000, kind: 'text', text: 'top secret', contentStored: true });
  const raw = await database.db.collection('message_cache').findOne({ msgId: 'M1' });
  assert.ok(raw.text.startsWith('enc:v1:'));
  assert.equal(raw.expiresAt.getTime() - raw.createdAt.getTime(), 2 * 3_600_000);

  assert.equal((await repos.messageCache.find(['1555@s.whatsapp.net'], 'M1')).text, 'top secret');
  assert.equal((await repos.messageCache.find(['99@lid'], 'M1')).text, 'top secret');
  assert.equal(await repos.messageCache.find(['99@lid'], 'NOPE'), null);

  await repos.messageCache.record({ chatJid: 'c', msgId: 'M2', senderJid: U, timestamp: 1, kind: 'text', text: 'ignored', contentStored: false, reason: 'meta' });
  const meta = await repos.messageCache.find(['c'], 'M2');
  assert.equal(meta.text, null);
  assert.equal(meta.contentStored, false);
  assert.equal((await database.db.collection('message_cache').findOne({ msgId: 'M2' })).text, null);

  await repos.messageCache.remove(['99@lid'], 'M1');
  assert.equal(await repos.messageCache.find(['99@lid'], 'M1'), null);
  assert.equal(await repos.messageCache.deleteForSender(U), 1);
});

test('bot config overrides persist', async () => {
  assert.deepEqual(await repos.botConfig.get(), {});
  await repos.botConfig.set({ prefix: '!' });
  assert.equal((await repos.botConfig.get()).prefix, '!');
  await repos.botConfig.unset('prefix');
  assert.equal((await repos.botConfig.get()).prefix, undefined);
});

test('mongo auth state: creds and keys survive a reload and are encrypted at rest', async () => {
  const a = await useMongoAuthState(database.db, { baileys, cipher, collection: 'auth_a' });
  const originalNoise = Buffer.from(a.state.creds.noiseKey.private);
  await a.saveCreds();
  await a.state.keys.set({ 'pre-key': { 1: { private: Buffer.from('priv'), public: Buffer.from('pub') } }, session: { 'abc.0': Buffer.from('sess') } });

  const raw = await database.db.collection('auth_a').find().toArray();
  assert.ok(raw.length >= 3);
  assert.ok(raw.every((d) => d.value.startsWith('enc:v1:')), 'every record is encrypted');

  const b = await useMongoAuthState(database.db, { baileys, cipher, collection: 'auth_a' });
  assert.deepEqual(Buffer.from(b.state.creds.noiseKey.private), originalNoise);
  const keys = await b.state.keys.get('pre-key', ['1', '2']);
  assert.equal(Buffer.from(keys['1'].private).toString(), 'priv');
  assert.equal(keys['2'], null);
  assert.equal(Buffer.from((await b.state.keys.get('session', ['abc.0']))['abc.0']).toString(), 'sess');

  await b.state.keys.set({ 'pre-key': { 1: null } });
  assert.equal((await b.state.keys.get('pre-key', ['1']))['1'], null);
  await b.clear();
  assert.equal(await database.db.collection('auth_a').countDocuments(), 0);
});
