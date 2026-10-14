import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipherBox } from '../src/utils/crypto.js';
import { normalizeJid, resolveSender, parseUserInput, maskJid, isGroupJid, isIgnoredJid, jidNumber } from '../src/utils/jid.js';
import { describeMessage, parseCommand, getQuoted, unwrapMessage } from '../src/utils/message.js';
import { splitArgs, extractTags, scoreMatch } from '../src/utils/text.js';
import { chunkText } from '../src/services/whatsapp.js';

test('jid helpers', () => {
  assert.equal(normalizeJid('1555:12@s.whatsapp.net'), '1555@s.whatsapp.net');
  assert.equal(jidNumber('1555:12@s.whatsapp.net'), '1555');
  assert.equal(jidNumber('9@lid'), '');
  assert.ok(isGroupJid('1@g.us'));
  assert.ok(isIgnoredJid('status@broadcast'));
  assert.ok(isIgnoredJid('1@newsletter'));
  assert.equal(parseUserInput('+1 (555) 222-0001'), '15552220001@s.whatsapp.net');
  assert.equal(parseUserInput('abc'), null);
  assert.equal(parseUserInput('1@g.us'), null);
  assert.equal(maskJid('15552220001@s.whatsapp.net'), 'user:…0001');
  assert.ok(!maskJid('15552220001@s.whatsapp.net').includes('1555222'));
});

test('resolveSender prefers phone JID over LID, handles groups and fromMe', () => {
  const dm = resolveSender({ remoteJid: '99@lid', remoteJidAlt: '1555:3@s.whatsapp.net' });
  assert.equal(dm.jid, '1555@s.whatsapp.net');
  assert.deepEqual(dm.candidates.sort(), ['1555@s.whatsapp.net', '99@lid']);
  const grp = resolveSender({ remoteJid: '1@g.us', participant: '77@lid', participantAlt: '1666@s.whatsapp.net' });
  assert.equal(grp.jid, '1666@s.whatsapp.net');
  assert.equal(resolveSender({ remoteJid: '5@s.whatsapp.net', fromMe: true }, { selfJid: '1999:4@s.whatsapp.net' }).jid, '1999@s.whatsapp.net');
  assert.equal(resolveSender({ remoteJid: '99@lid' }).jid, '99@lid');
});

test('describeMessage: kinds, captions, view-once detection', () => {
  assert.deepEqual(describeMessage({ conversation: 'hi' }), { kind: 'text', text: 'hi', viewOnce: false, hasMedia: false });
  const img = describeMessage({ imageMessage: { caption: 'cap', mimetype: 'image/jpeg', fileLength: 1234 } });
  assert.equal(img.kind, 'image');
  assert.equal(img.text, 'cap');
  assert.equal(img.size, 1234);
  assert.equal(describeMessage({ ephemeralMessage: { message: { conversation: 'x' } } }).text, 'x');
  assert.equal(describeMessage({ viewOnceMessageV2: { message: { imageMessage: {} } } }).viewOnce, true);
  assert.equal(describeMessage({ imageMessage: { viewOnce: true } }).viewOnce, true);
  assert.equal(describeMessage({ imageMessage: {} }).viewOnce, false);
  assert.equal(describeMessage({ protocolMessage: {} }).kind, 'protocol');
  assert.equal(describeMessage(null).kind, 'other');
  assert.equal(unwrapMessage({ viewOnceMessage: { message: { conversation: 'a' } } }).viewOnce, true);
});

test('getQuoted extracts the replied-to message', () => {
  const q = getQuoted({ extendedTextMessage: { text: '/save', contextInfo: { stanzaId: 'ID1', participant: '1@s.whatsapp.net', quotedMessage: { conversation: 'orig' } } } });
  assert.equal(q.id, 'ID1');
  assert.equal(q.info.text, 'orig');
  assert.equal(getQuoted({ conversation: 'x' }), null);
});

test('parseCommand', () => {
  assert.deepEqual(parseCommand('/Ping  a b ', '/'), { name: 'ping', argText: 'a b' });
  assert.deepEqual(parseCommand('!menu', '!'), { name: 'menu', argText: '' });
  assert.equal(parseCommand('hello /ping', '/'), null);
  assert.equal(parseCommand('/', '/'), null);
  assert.equal(parseCommand('/ ping', '/')?.name, 'ping');
  assert.equal(parseCommand('//etc/passwd', '/'), null);
  assert.equal(parseCommand('', '/'), null);
});

test('text helpers', () => {
  assert.deepEqual(splitArgs('a "b c" \'d e\' f'), ['a', 'b c', 'd e', 'f']);
  assert.deepEqual(extractTags('buy #Milk and #eggs #milk'), ['milk', 'eggs']);
  assert.ok(scoreMatch('Hello World', ['hello', 'world']) > 0);
  assert.equal(scoreMatch('Hello World', ['hello', 'mars']), 0);
});

test('chunkText splits long messages without losing content', () => {
  const text = Array.from({ length: 400 }, (_, i) => `line ${i} ${'x'.repeat(20)}`).join('\n');
  const parts = chunkText(text, 1000);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 1000));
  assert.equal(parts.join('\n'), text);
  assert.equal(chunkText('x'.repeat(2500), 1000).join(''), 'x'.repeat(2500));
});


test('cipher: round trip, tamper detection, passthrough without key', () => {
  const c = createCipherBox(Buffer.alloc(32, 1));
  const enc = c.encryptText('secret ✓');
  assert.ok(enc.startsWith('enc:v1:'));
  assert.ok(!enc.includes('secret'));
  assert.equal(c.decryptText(enc), 'secret ✓');
  assert.notEqual(c.encryptText('same'), c.encryptText('same'), 'random IV');
  const buf = c.encryptBuffer(Buffer.from('bytes'));
  assert.equal(c.decryptBuffer(buf).toString(), 'bytes');
  buf[buf.length - 1] ^= 1;
  assert.throws(() => c.decryptBuffer(buf));
  assert.throws(() => createCipherBox(Buffer.alloc(5)));

  const plain = createCipherBox(null);
  assert.equal(plain.enabled, false);
  assert.equal(plain.encryptText('a'), 'a');
  assert.equal(plain.decryptText(null), null);
  assert.throws(() => plain.decryptText(enc), /DATA_ENCRYPTION_KEY/);
  assert.equal(c.decryptText('legacy plain text'), 'legacy plain text');
});

test('loadBrandImage: reads a supported file, rejects bad extensions, degrades on missing file', async (t) => {
  const { loadBrandImage } = await import('../src/services/branding.js');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'brand-test-'));
  const pngPath = path.join(dir, 'x.png');
  await writeFile(pngPath, Buffer.from('fakepng'));
  const img = await loadBrandImage(pngPath, null);
  assert.deepEqual(img, { buffer: Buffer.from('fakepng'), mimetype: 'image/png' });

  assert.equal(await loadBrandImage(null, null), null);
  assert.equal(await loadBrandImage(path.join(dir, 'missing.png'), { warn() {} }), null);
  assert.equal(await loadBrandImage(path.join(dir, 'x.gif'), { warn() {} }), null);
  await rm(dir, { recursive: true, force: true });
});
