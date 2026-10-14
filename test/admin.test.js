import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, ALICE, BOB, OWNER_JID, GROUP } from './helpers/harness.js';

const harnesses = [];
const boot = async (opts) => { const h = await startHarness(opts); harnesses.push(h); return h; };
after(async () => { for (const h of harnesses) await h.stop(); });

test('role-based authorisation: non-owners cannot run ,delete or ,settings', async () => {
  const h = await boot();
  for (const cmd of [',delete on', ',delete off', ',delete status', ',settings', ',settings status', ',settings delete on', ',settings sticker on']) {
    await h.say(ALICE, cmd);
    assert.match(h.lastText(ALICE), /not allowed/, cmd);
  }
});

test('owner is recognised by number, by fromMe, and not by lookalike ids', async () => {
  const h = await boot();
  await h.say(OWNER_JID, ',delete status');
  assert.match(h.lastText(OWNER_JID), /OFF/);
  // linked account itself (fromMe) is the owner
  await h.say('15559998888@s.whatsapp.net', ',delete status', { fromMe: true });
  assert.match(h.lastText('15559998888@s.whatsapp.net'), /OFF/);
  // a different number that merely contains the owner's digits is not the owner
  await h.say('9915550001111@s.whatsapp.net', ',delete status');
  assert.match(h.lastText('9915550001111@s.whatsapp.net'), /not allowed/);
  // LID sender resolved through participantAlt
  await h.sock.ev.emitAsync('messages.upsert', { type: 'notify', messages: [{
    key: { remoteJid: '5551@lid', remoteJidAlt: OWNER_JID, id: 'LIDMSG1', fromMe: false },
    message: { conversation: ',delete status' }, messageTimestamp: Math.floor(Date.now() / 1000),
  }] });
  assert.match(h.sock.texts('5551@lid').at(-1), /OFF/);
});

test('a banned user is silently ignored for every command, and works again once unbanned', async () => {
  const h = await boot();
  await h.deps.users.setBanned(ALICE, true, 'spam');
  h.clearSent();
  await h.say(ALICE, ',menu');
  await h.say(ALICE, ',sticker');
  assert.equal(h.sock.sent.length, 0);
  await h.deps.users.setBanned(ALICE, false);
  await h.say(ALICE, ',menu');
  assert.ok(h.lastText(ALICE));
});

test('private mode: strangers get no reply at all, even to ,menu; the owner still works', async () => {
  const h = await boot({ env: { BOT_MODE: 'private' } });
  h.clearSent();
  await h.say(ALICE, ',menu');
  await h.say(ALICE, ',sticker');
  await h.say(ALICE, ',nonsense');
  assert.equal(h.sock.sent.length, 0, 'strangers get no reply at all');
  await h.say(OWNER_JID, ',menu');
  assert.ok(h.lastText(OWNER_JID));
});

test('owner gets a welcome message only on a genuinely new pairing, never on an ordinary reconnect', async () => {
  const h = await boot();
  h.clearSent();
  await h.sock.ev.emitAsync('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 408 } } } });
  await new Promise((r) => setTimeout(r, 1500));
  await h.sock.ev.emitAsync('connection.update', { connection: 'open' });
  assert.equal(h.sock.texts(OWNER_JID).length, 0, 'plain reconnect sends no welcome');

  h.clearSent();
  await h.linkAsNew();
  const texts = h.sock.texts(OWNER_JID);
  assert.equal(texts.length, 1);
  assert.match(texts[0], /Linked successfully/);
  assert.match(texts[0], /UtilityBot/);
  assert.match(texts[0], /,delete/);
});

test('welcome message is sent to every configured owner', async () => {
  const h = await boot({ env: { OWNER_NUMBERS: '15550001111,15559990000' } });
  h.clearSent();
  await h.linkAsNew();
  assert.equal(h.sock.texts(OWNER_JID).length, 1);
  assert.equal(h.sock.texts('15559990000@s.whatsapp.net').length, 1);
});

test('rate limiting warns once, then stays silent; owner exempt', async () => {
  const h = await boot({ env: { RATE_LIMIT_MAX: '3', RATE_LIMIT_COOLDOWN_MS: '60000', RATE_LIMIT_STRIKES: '5' } });
  for (let i = 0; i < 3; i++) await h.say(ALICE, ',menu');
  assert.equal(h.sock.texts(ALICE).length, 3);
  await h.say(ALICE, ',menu');
  assert.match(h.lastText(ALICE), /Slow down/);
  await h.say(ALICE, ',menu');
  await h.say(ALICE, ',menu');
  assert.equal(h.sock.texts(ALICE).length, 4, 'no more replies while blocked');
  for (let i = 0; i < 10; i++) await h.say(OWNER_JID, ',delete status');
  assert.equal(h.sock.texts(OWNER_JID).filter((t) => /OFF/.test(t)).length, 10);
});

test('persistent spammers are muted', async () => {
  const h = await boot({ env: { RATE_LIMIT_MAX: '2', RATE_LIMIT_STRIKES: '1', RATE_LIMIT_MUTE_MS: '60000' } });
  await h.say(BOB, ',menu');
  await h.say(BOB, ',menu');
  await h.say(BOB, ',menu');
  assert.match(h.lastText(BOB), /muted/);
});

test('group commands can be disabled for non-owners', async () => {
  const h = await boot({ env: { ALLOW_GROUP_COMMANDS: 'false' } });
  await h.say(ALICE, ',menu', { group: true });
  assert.equal(h.sock.sent.length, 0);
  await h.say(OWNER_JID, ',menu', { group: true });
  assert.ok(h.sock.texts(GROUP).length > 0);
});
