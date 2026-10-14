import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHealthServer } from '../src/services/health.js';

test('health endpoints', async () => {
  const state = { whatsapp: 'connecting', mongo: true };
  const hs = createHealthServer({ getStatus: async () => ({ ...state, uptimeSec: 1, version: 'x' }) });
  const { port } = await hs.start(0, '127.0.0.1');
  const get = (p, method = 'GET') => fetch(`http://127.0.0.1:${port}${p}`, { method });
  try {
    assert.equal((await get('/healthz')).status, 200);
    let r = await get('/readyz');
    assert.equal(r.status, 503);
    assert.equal((await r.json()).status, 'not_ready');
    state.whatsapp = 'open';
    r = await get('/readyz');
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.status, 'ready');
    assert.deepEqual(Object.keys(body).sort(), ['mongo', 'status', 'uptimeSec', 'version', 'whatsapp']);
    state.mongo = false;
    assert.equal((await get('/readyz')).status, 503);
    assert.equal((await get('/nope')).status, 404);
    assert.equal((await get('/healthz', 'POST')).status, 405);
  } finally {
    await hs.stop();
  }
});

test('health reports 500 when the status probe throws', async () => {
  const hs = createHealthServer({ getStatus: async () => { throw new Error('db down'); } });
  const { port } = await hs.start(0, '127.0.0.1');
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/readyz`)).status, 500);
  } finally {
    await hs.stop();
  }
});
