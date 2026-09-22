'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  atlasForSize,
  codexPetsRoot,
  discoverCodexPets,
  loadCodexPet,
  resolveSpritesheetPath,
  webpSize,
} = require('./desktop-pets');

function fakeWebp(width, height, tag = 'VP8L') {
  const buf = Buffer.alloc(64);
  buf.write('RIFF', 0, 'latin1');
  buf.writeUInt32LE(56, 4);
  buf.write('WEBP', 8, 'latin1');
  buf.write(tag, 12, 'latin1');
  buf.writeUInt32LE(52, 16);
  if (tag === 'VP8L') {
    buf[20] = 0x2f;
    buf.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 21);
  } else if (tag === 'VP8X') {
    buf.writeUIntLE(width - 1, 24, 3);
    buf.writeUIntLE(height - 1, 27, 3);
  } else if (tag === 'VP8 ') {
    buf.writeUIntLE(0x2a019d, 23, 3);
    buf.writeUInt16LE(width & 0x3fff, 26);
    buf.writeUInt16LE(height & 0x3fff, 28);
  }
  return buf;
}

function tmpRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pets-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writePet(root, id, manifest, sheet) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  if (manifest !== null) {
    fs.writeFileSync(path.join(dir, 'pet.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  }
  if (sheet) {
    fs.writeFileSync(path.join(dir, 'spritesheet.webp'), sheet);
  }
  return dir;
}

test('webpSize reads VP8L, VP8X, and VP8 headers', () => {
  assert.deepEqual(webpSize(fakeWebp(1536, 1872)), { width: 1536, height: 1872 });
  assert.deepEqual(webpSize(fakeWebp(1536, 2288, 'VP8X')), { width: 1536, height: 2288 });
  assert.deepEqual(webpSize(fakeWebp(1536, 1872, 'VP8 ')), { width: 1536, height: 1872 });
  assert.equal(webpSize(Buffer.alloc(20)), null);
  assert.equal(webpSize(Buffer.from('not a webp file at all........')), null);
  assert.equal(webpSize(fakeWebp(1536, 1872, 'AV1 ')), null);
});

test('atlasForSize accepts only the two Codex atlas layouts', () => {
  assert.equal(atlasForSize({ width: 1536, height: 1872 })?.version, 1);
  assert.equal(atlasForSize({ width: 1536, height: 2288 })?.version, 2);
  assert.equal(atlasForSize({ width: 1536, height: 2000 }), null);
  assert.equal(atlasForSize(null), null);
});

test('resolveSpritesheetPath rejects absolute paths and traversal', (t) => {
  const dir = fs.realpathSync(tmpRoot(t));
  const inside = path.join(dir, 'spritesheet.webp');
  fs.writeFileSync(inside, fakeWebp(1536, 1872));
  assert.equal(fs.realpathSync(resolveSpritesheetPath(dir, 'spritesheet.webp')), inside);
  assert.equal(resolveSpritesheetPath(dir, inside), null);
  assert.equal(resolveSpritesheetPath(dir, '../outside.webp'), null);
  assert.equal(resolveSpritesheetPath(dir, 'missing.webp'), null);
  assert.equal(resolveSpritesheetPath(dir, ''), null);
  assert.equal(resolveSpritesheetPath(dir, null), null);
});

test('codexPetsRoot honors CODEX_HOME then falls back to ~/.codex/pets', () => {
  assert.equal(codexPetsRoot({ CODEX_HOME: 'D:/codex' }, '/home/u'), path.join('D:/codex', 'pets'));
  assert.equal(codexPetsRoot({ CODEX_HOME: '  ' }, '/home/u'), path.join('/home/u', '.codex', 'pets'));
});

test('discoverCodexPets loads valid bundles and ignores invalid ones', (t) => {
  const root = tmpRoot(t);
  writePet(root, 'good-v1', { id: 'good-v1', displayName: 'Good V1', spritesheetPath: 'spritesheet.webp' }, fakeWebp(1536, 1872));
  writePet(root, 'good-v2', { id: 'good-v2', displayName: 'Good V2', spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 2 }, fakeWebp(1536, 2288, 'VP8X'));
  writePet(root, 'no-manifest', null, fakeWebp(1536, 1872));
  writePet(root, 'bad-json', '{nope', fakeWebp(1536, 1872));
  writePet(root, 'no-sheet', { id: 'no-sheet', spritesheetPath: 'spritesheet.webp' }, null);
  writePet(root, 'bad-size', { id: 'bad-size', spritesheetPath: 'spritesheet.webp' }, fakeWebp(640, 480));
  writePet(root, 'escape', { id: 'escape', spritesheetPath: '../good-v1/spritesheet.webp' }, null);
  fs.writeFileSync(path.join(root, 'stray.webp'), fakeWebp(1536, 1872));

  const pets = discoverCodexPets({ root });
  assert.deepEqual(pets.map((pet) => pet.id), ['good-v1', 'good-v2']);
  assert.equal(pets[0].rows, 9);
  assert.equal(pets[0].cellWidth, 192);
  assert.equal(pets[0].cellHeight, 208);
  assert.equal(pets[1].rows, 11);
  assert.equal(loadCodexPet(path.join(root, 'no-manifest')), null);
});

test('discoverCodexPets returns an empty list for a missing root', (t) => {
  assert.deepEqual(discoverCodexPets({ root: path.join(os.tmpdir(), `no-such-${Date.now()}`) }), []);
});
