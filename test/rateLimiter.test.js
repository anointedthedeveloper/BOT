import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../src/services/rateLimiter.js';

function make(overrides = {}) {
  const clock = { t: 1_000_000 };
  const rl = new RateLimiter({ max: 3, windowMs: 10_000, cooldownMs: 30_000, strikesBeforeMute: 2, muteMs: 600_000, now: () => clock.t, ...overrides });
  return { rl, clock };
}

test('allows up to max per window then blocks with a single notification', () => {
  const { rl } = make();
  for (let i = 0; i < 3; i++) assert.equal(rl.check('u').allowed, true);
  const first = rl.check('u');
  assert.deepEqual([first.allowed, first.reason, first.notify], [false, 'rate', true]);
  const second = rl.check('u');
  assert.deepEqual([second.allowed, second.notify], [false, false]);
});

test('window slides and cooldown expires', () => {
  const { rl, clock } = make();
  for (let i = 0; i < 4; i++) rl.check('u');
  clock.t += 31_000;
  assert.equal(rl.check('u').allowed, true);
});

test('keys are independent', () => {
  const { rl } = make();
  for (let i = 0; i < 4; i++) rl.check('a');
  assert.equal(rl.check('b').allowed, true);
});

test('repeat offenders get muted, then recover', () => {
  const { rl, clock } = make();
  for (let i = 0; i < 4; i++) rl.check('u'); // strike 1 -> cooldown
  clock.t += 31_000;
  for (let i = 0; i < 3; i++) rl.check('u');
  const v = rl.check('u'); // strike 2 -> mute
  assert.deepEqual([v.allowed, v.reason, v.notify], [false, 'muted', true]);
  clock.t += 100_000;
  const still = rl.check('u');
  assert.deepEqual([still.allowed, still.reason, still.notify], [false, 'muted', false]);
  clock.t += 600_000;
  assert.equal(rl.check('u').allowed, true);
});

test('sweep drops idle entries', () => {
  const { rl, clock } = make();
  rl.check('a');
  rl.check('b');
  assert.equal(rl.size, 2);
  clock.t += 1_000_000;
  rl.sweep();
  assert.equal(rl.size, 0);
});
