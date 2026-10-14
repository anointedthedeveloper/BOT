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

test('users: ensure creates defaults, bans and roles', async () => {
  const u = await repos.users.ensure(U);
  assert.equal(u.role, 'user');
  await repos.users.setBanned(U, true, 'spam');
  assert.equal((await repos.users.get(U)).banned, true);
  assert.equal((await repos.users.get(U)).banReason, 'spam');
  await repos.users.setBanned(U, false);
  assert.equal((await repos.users.get(U)).banned, false);
  await repos.users.setRole(V, 'admin');
  assert.equal((await repos.users.get(V)).role, 'admin');
  assert.equal(await repos.users.get('nobody@s.whatsapp.net'), null);
});

test('chats: isMonitored is false until markMonitored, true after, cleared by clearAll', async () => {
  const chat = '120363111@g.us';
  assert.equal(await repos.chats.isMonitored(chat), false);
  await repos.chats.markMonitored(chat, { isGroup: true });
  assert.equal(await repos.chats.isMonitored(chat), true);
  assert.equal((await repos.chats.get(chat)).isGroup, true);
  assert.equal(await repos.chats.countMonitored(), 1);

  const dm = '15559990000@s.whatsapp.net';
  await repos.chats.markMonitored(dm, { isGroup: false });
  assert.equal(await repos.chats.countMonitored(), 2);

  await repos.chats.clearAll();
  assert.equal(await repos.chats.isMonitored(chat), false);
  assert.equal(await repos.chats.isMonitored(dm), false);
  assert.equal(await repos.chats.countMonitored(), 0);
});

test('chats: get() caches briefly, and markMonitored invalidates the cache', async () => {
  const chat = '120363333@g.us';
  assert.equal(await repos.chats.isMonitored(chat), false);
  await repos.chats.markMonitored(chat, { isGroup: true });
  // Without cache invalidation this would still read the stale (pre-mark) cached doc.
  assert.equal(await repos.chats.isMonitored(chat), true);
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
});

test('message cache: clearAll wipes everything and returns media file paths to delete', async () => {
  await repos.messageCache.record({ chatJid: 'wipe1', msgId: 'W1', senderJid: U, timestamp: 1, kind: 'text', text: 'a', contentStored: true });
  await repos.messageCache.record({ chatJid: 'wipe2', msgId: 'W2', senderJid: U, timestamp: 1, kind: 'image', contentStored: false, mediaFile: { path: 'p/1', kind: 'image', size: 3 } });
  const { removed, mediaPaths } = await repos.messageCache.clearAll();
  assert.ok(removed >= 2);
  assert.deepEqual(mediaPaths, ['p/1']);
  assert.equal(await repos.messageCache.find(['wipe1'], 'W1'), null);
  assert.equal(await repos.messageCache.find(['wipe2'], 'W2'), null);
});

test('message cache: deleteExpiredMedia only sweeps media docs past their sweepAt', async () => {
  const now = new Date('2030-01-01T00:00:00Z');
  await database.db.collection('message_cache').insertOne({ chatJid: 'c1', msgId: 'E1', mediaFile: { path: 'old/1' }, sweepAt: new Date(now.getTime() - 1000) });
  await database.db.collection('message_cache').insertOne({ chatJid: 'c1', msgId: 'E2', mediaFile: { path: 'fresh/1' }, sweepAt: new Date(now.getTime() + 1_000_000) });
  const res = await repos.messageCache.deleteExpiredMedia(now);
  assert.equal(res.removed, 1);
  assert.deepEqual(res.mediaPaths, ['old/1']);
  assert.ok(await database.db.collection('message_cache').findOne({ msgId: 'E2' }));
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
