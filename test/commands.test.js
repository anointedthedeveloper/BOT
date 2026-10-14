import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { startHarness, ALICE, BOB, OWNER_JID, GROUP } from './helpers/harness.js';

let h;
before(async () => { h = await startHarness(); });
after(async () => { await h.stop(); });

test('only the four intended commands are registered', () => {
  assert.deepEqual(h.deps.registry.unique.map((c) => c.name).sort(), ['delete', 'menu', 'settings', 'sticker']);
});

test('the default prefix is a comma', async () => {
  assert.equal(h.config.bot.prefix, ',');
  await h.say(ALICE, ',menu');
  assert.ok(h.lastText(ALICE));
  h.clearSent();
  await h.say(ALICE, '/menu'); // the old prefix no longer works
  assert.equal(h.sock.sent.length, 0);
});

test(',menu shows exactly the required sections and nothing else', async () => {
  await h.say(ALICE, ',menu');
  const text = h.lastText(ALICE);
  assert.match(text, /\*DELETED MESSAGES\*/);
  assert.match(text, /,delete on — Enable monitoring/);
  assert.match(text, /,delete off — Disable monitoring/);
  assert.match(text, /,delete status — Check monitoring status/);
  assert.match(text, /\*STICKERS\*/);
  assert.match(text, /,sticker — Create a sticker from supported media/);
  assert.match(text, /\*SETTINGS\*/);
  assert.match(text, /,settings — Manage bot features/);
  assert.match(text, /,settings status — View current settings/);
  for (const gone of ['VIEW ONCE', 'help', 'ping', 'owner', 'bookmark', 'note', 'admin', 'restart', 'privacy']) {
    assert.doesNotMatch(text, new RegExp(gone, 'i'), gone);
  }
});

test('an unknown command gets a hint; plain chatter is ignored', async () => {
  await h.say(ALICE, ',nonsense');
  assert.match(h.lastText(ALICE), /Unknown command/);
  h.clearSent();
  await h.say(ALICE, 'just chatting, not a command');
  assert.equal(h.sock.sent.length, 0);
});

// ── ,delete ──────────────────────────────────────────────────────────────────
test(',delete is owner-only', async () => {
  for (const cmd of [',delete on', ',delete off', ',delete status']) {
    await h.say(ALICE, cmd);
    assert.match(h.lastText(ALICE), /not allowed/, cmd);
  }
});

test(',delete status reports off by default, on with its mode after enabling', async () => {
  const h2 = await startHarness();
  try {
    await h2.say(OWNER_JID, ',delete status');
    assert.match(h2.lastText(OWNER_JID), /OFF/);
    await h2.say(OWNER_JID, ',delete on');
    assert.match(h2.lastText(OWNER_JID), /\(media\) is now ON/);
    await h2.say(OWNER_JID, ',delete status');
    assert.match(h2.lastText(OWNER_JID), /\*ON\* \(media\)/);
    await h2.say(OWNER_JID, ',delete off');
    assert.match(h2.lastText(OWNER_JID), /OFF/);
  } finally {
    await h2.stop();
  }
});

test(',delete off wipes cached data', async () => {
  const h2 = await startHarness();
  try {
    await h2.say(OWNER_JID, ',delete on');
    await h2.say(ALICE, 'this gets cached', { group: true });
    assert.equal(await h2.deps.chats.countMonitored(), 1);
    await h2.say(OWNER_JID, ',delete off');
    assert.equal(await h2.deps.chats.countMonitored(), 0);
    assert.equal(await h2.deps.messageCache.count(), 0);
  } finally {
    await h2.stop();
  }
});

test(',delete unknown argument is rejected', async () => {
  await h.say(OWNER_JID, ',delete bogus');
  assert.match(h.lastText(OWNER_JID), /Usage:/);
});

// ── ,settings ────────────────────────────────────────────────────────────────
test(',settings is owner-only', async () => {
  for (const cmd of [',settings', ',settings status', ',settings delete on', ',settings sticker off']) {
    await h.say(ALICE, cmd);
    assert.match(h.lastText(ALICE), /not allowed/, cmd);
  }
});

test(',settings (bare) and ,settings status show delete + sticker state', async () => {
  const h2 = await startHarness();
  try {
    await h2.say(OWNER_JID, ',settings');
    assert.match(h2.lastText(OWNER_JID), /delete: \*OFF\*/);
    assert.match(h2.lastText(OWNER_JID), /sticker: \*ENABLED\*/);

    await h2.say(OWNER_JID, ',settings delete on');
    await h2.say(OWNER_JID, ',settings sticker off');
    await h2.say(OWNER_JID, ',settings status');
    assert.match(h2.lastText(OWNER_JID), /delete: \*ON \(media\)\*/);
    assert.match(h2.lastText(OWNER_JID), /sticker: \*DISABLED\*/);
  } finally {
    await h2.stop();
  }
});

test(',settings delete on|off mirrors ,delete, including wiping cache on off', async () => {
  const h2 = await startHarness();
  try {
    await h2.say(OWNER_JID, ',settings delete on');
    assert.equal(h2.deps.settings.defaultArchiveMode, 'media');
    await h2.say(ALICE, 'cached', { group: true });
    assert.equal(await h2.deps.chats.countMonitored(), 1);
    await h2.say(OWNER_JID, ',settings delete off');
    assert.equal(h2.deps.settings.defaultArchiveMode, 'off');
    assert.equal(await h2.deps.chats.countMonitored(), 0);
  } finally {
    await h2.stop();
  }
});

test(',settings sticker on|off gates the ,sticker command', async () => {
  const h2 = await startHarness();
  try {
    await h2.say(OWNER_JID, ',settings sticker off');
    await h2.say(ALICE, ',sticker');
    assert.match(h2.lastText(ALICE), /currently disabled/);
    await h2.say(OWNER_JID, ',settings sticker on');
    await h2.say(ALICE, ',sticker');
    assert.match(h2.lastText(ALICE), /Reply to a photo/);
  } finally {
    await h2.stop();
  }
});

test(',settings delete/sticker reject bad arguments', async () => {
  await h.say(OWNER_JID, ',settings delete bogus');
  assert.match(h.lastText(OWNER_JID), /Usage: ,settings delete on\|off/);
  await h.say(OWNER_JID, ',settings sticker bogus');
  assert.match(h.lastText(OWNER_JID), /Usage: ,settings sticker on\|off/);
  await h.say(OWNER_JID, ',settings bogus');
  assert.match(h.lastText(OWNER_JID), /Usage:/);
});

test('settings persist across a restart (stored in MongoDB)', async () => {
  const h2 = await startHarness();
  try {
    await h2.say(OWNER_JID, ',delete on');
    await h2.say(OWNER_JID, ',settings sticker off');
    const stored = await h2.deps.botConfig.get();
    assert.equal(stored.defaultArchiveMode, 'media');
    assert.equal(stored.stickerEnabled, false);

    // Simulate a restart: fresh RuntimeSettings loaded from the same persisted botConfig doc.
    const { RuntimeSettings } = await import('../src/services/settings.js');
    const reloaded = await new RuntimeSettings(h2.config, h2.deps.botConfig).load();
    assert.equal(reloaded.defaultArchiveMode, 'media');
    assert.equal(reloaded.stickerEnabled, false);
  } finally {
    await h2.stop();
  }
});

// ── ,sticker ─────────────────────────────────────────────────────────────────
test(',sticker requires a reply or self-captioned media', async () => {
  await h.say(ALICE, ',sticker');
  assert.match(h.lastText(ALICE), /Reply to a photo.*or send one with the caption/);
});

test(',sticker converts a replied-to image into a real sticker, with pack metadata', async () => {
  const png = await sharp({ create: { width: 300, height: 150, channels: 4, background: { r: 10, g: 200, b: 10, alpha: 1 } } }).png().toBuffer();
  const h2 = await startHarness({ baileysOptions: { downloadResult: png } });
  try {
    const quoted = { id: 'Q-PIC', message: { imageMessage: { mimetype: 'image/jpeg', fileLength: png.length, mediaKey: 'k' } } };
    await h2.say(ALICE, ',sticker', { quoted });
    const sent = h2.sock.sent.findLast((s) => s.content.sticker);
    assert.ok(sent, 'a sticker message was sent');
    assert.equal(sent.content.sticker.subarray(0, 4).toString(), 'RIFF');
    const meta = await sharp(sent.content.sticker).metadata();
    assert.equal(meta.width, 512);
    assert.equal(meta.height, 512);

    const webpmux = (await import('node-webpmux')).default;
    const img = new webpmux.Image();
    await img.load(sent.content.sticker);
    const exif = JSON.parse(img.exif.subarray(22).toString('utf-8'));
    assert.equal(exif['sticker-pack-name'], 'UtilityBot');
  } finally {
    await h2.stop();
  }
});

test(',sticker also works on a self-captioned image (no reply needed)', async () => {
  const png = await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 20, g: 20, b: 200, alpha: 1 } } }).png().toBuffer();
  const h2 = await startHarness({ baileysOptions: { downloadResult: png } });
  try {
    await h2.say(ALICE, '', { raw: { imageMessage: { caption: ',sticker', mimetype: 'image/jpeg', fileLength: png.length, mediaKey: 'k' } } });
    const sent = h2.sock.sent.findLast((s) => s.content.sticker);
    assert.ok(sent, 'a sticker was produced from the self-captioned image, no reply needed');
  } finally {
    await h2.stop();
  }
});

test(',sticker refuses view-once media', async () => {
  await h.say(ALICE, ',sticker', { quoted: { id: 'VO', message: { viewOnceMessageV2: { message: { imageMessage: { mediaKey: 'k' } } } } } });
  assert.match(h.lastText(ALICE), /View-once messages cannot be turned into a sticker/);
});

test(',sticker refuses unsupported media kinds', async () => {
  await h.say(ALICE, ',sticker', { quoted: { id: 'DOC', message: { documentMessage: { fileName: 'a.pdf', fileLength: 10 } } } });
  assert.match(h.lastText(ALICE), /Only images, GIFs\/videos and existing stickers/);
});

test(',sticker refuses oversized media before downloading', async () => {
  await h.say(ALICE, ',sticker', { quoted: { id: 'BIG', message: { videoMessage: { fileLength: 200 * 1024 * 1024, mimetype: 'video/mp4' } } } });
  assert.match(h.lastText(ALICE), /limit is 25\.0 MB/);
});

test(',sticker: a failed media download is reported cleanly, not as a crash', async () => {
  const h2 = await startHarness({ baileysOptions: { downloadError: new Error('410 gone') } });
  try {
    const quoted = { id: 'Q', message: { imageMessage: { mimetype: 'image/jpeg', fileLength: 10, mediaKey: 'k' } } };
    await h2.say(ALICE, ',sticker', { quoted });
    assert.match(h2.lastText(ALICE), /could not download/);
  } finally {
    await h2.stop();
  }
});

test(',sticker: corrupt media gets a friendly error, not a raw crash, and temp files are cleaned up', async () => {
  const { readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const before = (await readdir(tmpdir())).filter((f) => f.startsWith('sticker-'));
  const h2 = await startHarness({ baileysOptions: { downloadResult: Buffer.from('not a real image') } });
  try {
    const quoted = { id: 'Q-BAD', message: { imageMessage: { mimetype: 'image/jpeg', fileLength: 10, mediaKey: 'k' } } };
    await h2.say(ALICE, ',sticker', { quoted });
    assert.match(h2.lastText(ALICE), /⚠️/);
    assert.doesNotMatch(h2.lastText(ALICE), /Something went wrong/, 'bad input is a UserError, not a reported bug');
  } finally {
    await h2.stop();
  }
  const after = (await readdir(tmpdir())).filter((f) => f.startsWith('sticker-'));
  assert.deepEqual(after, before, 'no leftover sticker temp directories');
});

test(',sticker works in groups too', async () => {
  const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 1, g: 1, b: 1, alpha: 1 } } }).png().toBuffer();
  const h2 = await startHarness({ baileysOptions: { downloadResult: png } });
  try {
    const quoted = { id: 'Q-G', participant: BOB, message: { imageMessage: { mimetype: 'image/jpeg', fileLength: png.length, mediaKey: 'k' } } };
    await h2.say(ALICE, ',sticker', { quoted, group: true });
    const sent = h2.sock.sent.findLast((s) => s.content.sticker);
    assert.ok(sent);
    assert.equal(sent.jid, GROUP);
  } finally {
    await h2.stop();
  }
});
