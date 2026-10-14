import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError } from '../src/config/index.js';

const ok = { MONGODB_URI: 'mongodb://localhost:27017', OWNER_NUMBERS: '+1 (555) 000-1111, 2348012345678' };

test('loads defaults and normalises owners', () => {
  const c = loadConfig(ok);
  assert.deepEqual(c.owners, ['15550001111', '2348012345678']);
  assert.equal(c.bot.prefix, '/');
  assert.equal(c.bot.mode, 'private');
  assert.equal(c.auth.store, 'file');
  assert.equal(c.privacy.allowContentLogging, true);
  assert.equal(c.privacy.encryptionKey, null);
  assert.throws(() => { c.bot.prefix = '!'; }, TypeError, 'config is frozen');
});

test('reports every problem at once', () => {
  assert.throws(() => loadConfig({ MONGODB_URI: 'http://nope', OWNER_NUMBERS: '12', BOT_PREFIX: 'toolong', RATE_LIMIT_MAX: 'x', BOT_MODE: 'weird' }), (e) => {
    assert.ok(e instanceof ConfigError);
    assert.ok(e.problems.length >= 5, e.message);
    assert.match(e.message, /MONGODB_URI/);
    assert.match(e.message, /OWNER_NUMBERS/);
    assert.match(e.message, /BOT_PREFIX/);
    assert.match(e.message, /RATE_LIMIT_MAX/);
    assert.match(e.message, /BOT_MODE/);
    return true;
  });
});

test('prefix must be symbols only', () => {
  for (const bad of ['a', '7', 'ab', '/ /', 'toolong']) assert.throws(() => loadConfig({ ...ok, BOT_PREFIX: bad }), /BOT_PREFIX/, bad);
  for (const good of ['/', '!', '.', '#', '!!', '¡']) assert.equal(loadConfig({ ...ok, BOT_PREFIX: good }).bot.prefix, good);
});

test('requires MONGODB_URI and owners', () => {
  assert.throws(() => loadConfig({}), /MONGODB_URI is required[\s\S]*OWNER_NUMBERS is required/);
});

test('accepts owner JIDs (LID) alongside numbers', () => {
  const c = loadConfig({ ...ok, OWNER_NUMBERS: '15550001111,98765@LID' });
  assert.deepEqual(c.owners, ['15550001111', '98765@lid']);
});

test('encryption key: hex and base64 accepted, junk rejected', () => {
  assert.equal(loadConfig({ ...ok, DATA_ENCRYPTION_KEY: 'ab'.repeat(32) }).privacy.encryptionKey.length, 32);
  assert.equal(loadConfig({ ...ok, DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }).privacy.encryptionKey.length, 32);
  assert.throws(() => loadConfig({ ...ok, DATA_ENCRYPTION_KEY: 'short' }), /DATA_ENCRYPTION_KEY/);
});

test('booleans and ranges are validated', () => {
  assert.equal(loadConfig({ ...ok, ALLOW_CONTENT_LOGGING: 'off' }).privacy.allowContentLogging, false);
  assert.throws(() => loadConfig({ ...ok, ALLOW_CONTENT_LOGGING: 'maybe' }), /ALLOW_CONTENT_LOGGING/);
  assert.throws(() => loadConfig({ ...ok, CACHE_TTL_HOURS: '9999' }), /CACHE_TTL_HOURS/);
});

test('DEFAULT_ARCHIVE_MODE: validated and cross-checked against the content/media kill switches', () => {
  assert.equal(loadConfig(ok).privacy.defaultArchiveMode, 'off');
  assert.equal(loadConfig({ ...ok, DEFAULT_ARCHIVE_MODE: 'media' }).privacy.defaultArchiveMode, 'media');
  assert.throws(() => loadConfig({ ...ok, DEFAULT_ARCHIVE_MODE: 'nonsense' }), /DEFAULT_ARCHIVE_MODE/);
  assert.throws(() => loadConfig({ ...ok, DEFAULT_ARCHIVE_MODE: 'full', ALLOW_CONTENT_LOGGING: 'false' }), /DEFAULT_ARCHIVE_MODE=full requires ALLOW_CONTENT_LOGGING/);
  assert.throws(() => loadConfig({ ...ok, DEFAULT_ARCHIVE_MODE: 'media', ALLOW_MEDIA_CACHING: 'false' }), /DEFAULT_ARCHIVE_MODE=media requires ALLOW_MEDIA_CACHING/);
  assert.equal(loadConfig({ ...ok, DEFAULT_ARCHIVE_MODE: 'meta', ALLOW_CONTENT_LOGGING: 'false', ALLOW_MEDIA_CACHING: 'false' }).privacy.defaultArchiveMode, 'meta');
});
