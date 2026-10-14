import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHarness, ALICE, BOB, OWNER_JID, GROUP } from './helpers/harness.js';

const harnesses = [];
const boot = async (opts) => { const h = await startHarness(opts); harnesses.push(h); return h; };
after(async () => { for (const h of harnesses) await h.stop(); });

const CAROL = '15552220003@s.whatsapp.net';

test('role-based authorisation: users cannot run admin/owner commands', async () => {
  const h = await boot();
  for (const cmd of ['/admin stats', '/admin ban 15552220009', '/restart', '/restart confirm', '/admin prefix !']) {
    await h.say(ALICE, cmd);
    assert.match(h.lastText(ALICE), /not allowed/, cmd);
  }
  assert.equal(h.exits.length, 0);
  assert.equal(h.fb.sockets.length, 1, 'no restart happened');
  assert.equal((await h.deps.users.get(BOB))?.banned ?? false, false);
});

test('owner is recognised by number, by fromMe, and not by lookalike ids', async () => {
  const h = await boot();
  await h.say(OWNER_JID, '/admin stats');
  assert.match(h.lastText(OWNER_JID), /Stats/);
  // linked account itself (fromMe) is the owner
  await h.say('15559998888@s.whatsapp.net', '/admin stats', { fromMe: true });
  assert.match(h.lastText('15559998888@s.whatsapp.net'), /Stats/);
  // a different number that merely contains the owner's digits is not the owner
  await h.say('9915550001111@s.whatsapp.net', '/admin stats');
  assert.match(h.lastText('9915550001111@s.whatsapp.net'), /not allowed/);
  // LID sender resolved through participantAlt
  await h.sock.ev.emitAsync('messages.upsert', { type: 'notify', messages: [{
    key: { remoteJid: '5551@lid', remoteJidAlt: OWNER_JID, id: 'LIDMSG1', fromMe: false },
    message: { conversation: '/admin stats' }, messageTimestamp: Math.floor(Date.now() / 1000),
  }] });
  assert.match(h.sock.texts('5551@lid').at(-1), /Stats/);
});

test('promote/demote are owner-only; admins can ban but not touch owner or other admins', async () => {
  const h = await boot();
  await h.say(OWNER_JID, `/admin promote ${BOB.split('@')[0]}`);
  assert.equal((await h.deps.users.get(BOB)).role, 'admin');

  await h.say(BOB, `/admin promote ${CAROL.split('@')[0]}`);
  assert.match(h.lastText(BOB), /Only the bot owner/);
  assert.equal((await h.deps.users.get(CAROL))?.role ?? 'user', 'user');

  await h.say(BOB, `/admin ban ${ALICE.split('@')[0]} spamming`);
  assert.match(h.lastText(BOB), /is banned/);
  assert.equal((await h.deps.users.get(ALICE)).banReason, 'spamming');

  await h.say(BOB, '/admin ban 15550001111');
  assert.match(h.lastText(BOB), /owner cannot be modified/);

  await h.say(OWNER_JID, `/admin promote ${CAROL.split('@')[0]}`);
  await h.say(BOB, `/admin ban ${CAROL.split('@')[0]}`);
  assert.match(h.lastText(BOB), /Only the owner can ban an admin/);

  await h.say(BOB, '/admin list');
  assert.match(h.lastText(BOB), /banned \(spamming\)/);

  await h.say(OWNER_JID, `/admin demote ${BOB.split('@')[0]}`);
  assert.equal((await h.deps.users.get(BOB)).role, 'user');
  await h.say(BOB, '/admin stats');
  assert.match(h.lastText(BOB), /not allowed/);
});

test('banned users are silently ignored, and can be unbanned', async () => {
  const h = await boot();
  await h.say(OWNER_JID, `/admin ban ${ALICE.split('@')[0]}`);
  h.clearSent();
  await h.say(ALICE, '/ping');
  await h.say(ALICE, '/privacy');
  assert.equal(h.sock.sent.length, 0);
  await h.say(OWNER_JID, `/admin unban ${ALICE.split('@')[0]}`);
  await h.say(ALICE, '/ping');
  assert.match(h.lastText(ALICE), /Pong/);
});

test('private mode: unknown users are ignored, allowed users work, privacy opt-outs stay reachable', async () => {
  const h = await boot({ env: { BOT_MODE: 'private' } });
  h.clearSent();
  await h.say(ALICE, '/ping');
  await h.say(ALICE, '/menu');
  await h.say(ALICE, '/nonsense');
  assert.equal(h.sock.sent.length, 0, 'strangers get no reply at all');

  await h.say(ALICE, '/privacy logging off');
  assert.match(h.lastText(ALICE), /will not be captured/);
  assert.equal((await h.deps.users.get(ALICE)).prefs.contentLogging, false);

  await h.say(OWNER_JID, `/admin allow +${ALICE.split('@')[0]}`);
  await h.say(ALICE, '/ping');
  assert.match(h.lastText(ALICE), /Pong/);
  await h.say(OWNER_JID, `/admin disallow ${ALICE.split('@')[0]}`);
  h.clearSent();
  await h.say(ALICE, '/ping');
  assert.equal(h.sock.sent.length, 0);
});

test('admin allow via @mention', async () => {
  const h = await boot({ env: { BOT_MODE: 'private' } });
  await h.sock.ev.emitAsync('messages.upsert', { type: 'notify', messages: [{
    key: { remoteJid: GROUP, participant: OWNER_JID, id: 'MENTION1' },
    message: { extendedTextMessage: { text: '/admin allow @someone', contextInfo: { mentionedJid: [BOB] } } },
    messageTimestamp: Math.floor(Date.now() / 1000),
  }] });
  assert.equal((await h.deps.users.get(BOB)).allowed, true);
});

test('restart is owner-only, needs confirmation within the window (reconnect mode)', async () => {
  const h = await boot();
  await h.say(OWNER_JID, '/restart confirm');
  assert.match(h.lastText(OWNER_JID), /No pending request/);
  assert.equal(h.fb.sockets.length, 1);

  await h.say(OWNER_JID, '/restart');
  assert.match(h.lastText(OWNER_JID), /restart confirm/);
  assert.equal(h.fb.sockets.length, 1, 'requesting alone does nothing');

  await h.say(OWNER_JID, '/restart confirm');
  assert.match(h.lastText(OWNER_JID), /Restarting \(reconnect\)/);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(h.fb.sockets.length, 2, 'connection was recycled');
  assert.deepEqual(h.exits, [], 'process was not exited in reconnect mode');
  await h.sock.ev.emitAsync('connection.update', { connection: 'open' });

  await h.say(OWNER_JID, '/restart confirm');
  assert.match(h.lastText(OWNER_JID), /No pending request/, 'confirmation is single-use');
});

test('restart confirmation expires', async () => {
  const h = await boot();
  await h.say(OWNER_JID, '/restart');
  h.deps.pendingRestarts.set(OWNER_JID, Date.now() - 1);
  await h.say(OWNER_JID, '/restart confirm');
  assert.match(h.lastText(OWNER_JID), /No pending request/);
  assert.equal(h.fb.sockets.length, 1);
});

test('restart in exit mode shuts down gracefully for a supervisor to relaunch', async () => {
  const h = await boot({ env: { RESTART_MODE: 'exit' } });
  await h.say(OWNER_JID, '/restart');
  await h.say(OWNER_JID, '/restart confirm');
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(h.exits, [0]);
  assert.equal(h.deps.client.status, 'stopped');
});

test('owner can change prefix and bot name at runtime; persisted and reversible', async () => {
  const h = await boot();
  await h.say(OWNER_JID, '/admin prefix !');
  assert.match(h.lastText(OWNER_JID), /Prefix is now !/);
  h.clearSent();
  await h.say(ALICE, '/ping');
  assert.equal(h.sock.sent.length, 0, 'old prefix no longer triggers');
  await h.say(ALICE, '!ping');
  assert.match(h.lastText(ALICE), /Pong/);
  assert.equal((await h.deps.botConfig.get()).prefix, '!');

  await h.say(OWNER_JID, '!admin botname Jarvis');
  await h.say(ALICE, '!menu');
  assert.match(h.lastText(ALICE), /Jarvis/);

  await h.say(OWNER_JID, '!admin prefix abc');
  assert.match(h.lastText(OWNER_JID), /Prefix must be/);
  await h.say(OWNER_JID, '!admin prefix 7');
  assert.match(h.lastText(OWNER_JID), /Prefix must be/);
  await h.say(OWNER_JID, '!admin identity-reset');
  await h.say(ALICE, '/ping');
  assert.match(h.lastText(ALICE), /Pong/);
});

test('rate limiting warns once, then stays silent; owner exempt', async () => {
  const h = await boot({ env: { RATE_LIMIT_MAX: '3', RATE_LIMIT_COOLDOWN_MS: '60000', RATE_LIMIT_STRIKES: '5' } });
  for (let i = 0; i < 3; i++) await h.say(ALICE, '/ping');
  assert.equal(h.sock.texts(ALICE).length, 3);
  await h.say(ALICE, '/ping');
  assert.match(h.lastText(ALICE), /Slow down/);
  await h.say(ALICE, '/ping');
  await h.say(ALICE, '/ping');
  assert.equal(h.sock.texts(ALICE).length, 4, 'no more replies while blocked');
  for (let i = 0; i < 10; i++) await h.say(OWNER_JID, '/ping');
  assert.equal(h.sock.texts(OWNER_JID).filter((t) => /Pong/.test(t)).length, 10);
});

test('persistent spammers are muted', async () => {
  const h = await boot({ env: { RATE_LIMIT_MAX: '2', RATE_LIMIT_STRIKES: '1', RATE_LIMIT_MUTE_MS: '60000' } });
  await h.say(BOB, '/ping');
  await h.say(BOB, '/ping');
  await h.say(BOB, '/ping');
  assert.match(h.lastText(BOB), /muted/);
});

test('group commands can be disabled for non-owners', async () => {
  const h = await boot({ env: { ALLOW_GROUP_COMMANDS: 'false' } });
  await h.say(ALICE, '/ping', { group: true });
  assert.equal(h.sock.sent.length, 0);
  await h.say(OWNER_JID, '/ping', { group: true });
  assert.match(h.lastText(GROUP), /Pong/);
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
  assert.match(texts[0], /\/admin/);
});

test('welcome message is sent to every configured owner', async () => {
  const h = await boot({ env: { OWNER_NUMBERS: '15550001111,15559990000' } });
  h.clearSent();
  await h.linkAsNew();
  assert.equal(h.sock.texts(OWNER_JID).length, 1);
  assert.equal(h.sock.texts('15559990000@s.whatsapp.net').length, 1);
});

test('/delete: owner-only, toggles the live default for every chat without touching per-chat settings', async () => {
  const h = await boot();
  await h.say(ALICE, '/delete on');
  assert.match(h.lastText(ALICE), /not allowed/);

  await h.say(OWNER_JID, '/delete status');
  assert.match(h.lastText(OWNER_JID), /default: \*off\*/);

  await h.say(OWNER_JID, '/delete on');
  assert.match(h.lastText(OWNER_JID), /✅.*\(media\) is now ON for every chat/);
  assert.equal(h.deps.settings.defaultArchiveMode, 'media');

  // takes effect immediately, live, without a restart
  const msg = await h.say(ALICE, 'caught by the live default', { group: true });
  assert.match(h.sock.texts(GROUP).at(-1), /archiving is now \*ON \(media\)\*/);
  await h.revoke(GROUP, msg.key.id, { participant: ALICE });
  assert.match(h.sock.texts(GROUP).at(-1), /caught by the live default/);

  await h.say(OWNER_JID, '/delete off');
  assert.match(h.lastText(OWNER_JID), /default is OFF/);
  assert.equal(h.deps.settings.defaultArchiveMode, 'off');

  // an explicitly-configured chat is untouched by the global toggle either way
  await h.say(OWNER_JID, '/privacy archive meta', { group: true });
  await h.say(OWNER_JID, '/delete on');
  assert.equal(await h.deps.chats.archiveMode(GROUP), 'meta', 'explicit setting still wins over the new default');
});

test('/delete: on is refused when the operator disabled both content and media logging', async () => {
  const h = await boot({ env: { ALLOW_CONTENT_LOGGING: 'false', ALLOW_MEDIA_CACHING: 'false' } });
  await h.say(OWNER_JID, '/delete on');
  assert.match(h.lastText(OWNER_JID), /nothing this can turn on/);
});

test('/delete: on falls back to full (text only) when media caching is operator-disabled', async () => {
  const h = await boot({ env: { ALLOW_MEDIA_CACHING: 'false' } });
  await h.say(OWNER_JID, '/delete on');
  assert.match(h.lastText(OWNER_JID), /\(full\) is now ON/);
  assert.equal(h.deps.settings.defaultArchiveMode, 'full');
});

test('/delete: unknown argument is rejected', async () => {
  const h = await boot();
  await h.say(OWNER_JID, '/delete bogus');
  assert.match(h.lastText(OWNER_JID), /Usage:/);
});
