import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { createLogger } from '../src/utils/logger.js';
import { loadConfig } from '../src/config/index.js';

test('logger redacts credentials, URIs and message bodies', () => {
  const chunks = [];
  const dest = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
  const config = loadConfig({ MONGODB_URI: 'mongodb://localhost', OWNER_NUMBERS: '15550001111', LOG_LEVEL: 'info' });
  const log = createLogger(config, dest);
  log.info({
    creds: { noiseKey: 'NOISE-SECRET' },
    authState: { keys: 'KEYS-SECRET' },
    uri: 'mongodb://user:PASSWORD@host',
    qr: 'QR-SECRET',
    nested: { token: 'TOKEN-SECRET', text: 'PRIVATE MESSAGE BODY' },
    text: 'ANOTHER PRIVATE BODY',
    safe: 'visible',
  }, 'event');
  const out = chunks.join('');
  for (const secret of ['NOISE-SECRET', 'KEYS-SECRET', 'PASSWORD', 'QR-SECRET', 'TOKEN-SECRET', 'PRIVATE MESSAGE BODY', 'ANOTHER PRIVATE BODY']) {
    assert.ok(!out.includes(secret), `${secret} leaked into logs`);
  }
  assert.ok(out.includes('visible'));
});
