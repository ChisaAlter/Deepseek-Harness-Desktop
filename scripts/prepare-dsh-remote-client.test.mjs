import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldBuildDshRemoteClient } from './prepare-dsh-remote-client.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('dsh-remote client build runs for force, missing bundle, or newer source', () => {
  assert.equal(shouldBuildDshRemoteClient({ sourceMtime: 10, outputMtime: 20 }), false);
  assert.equal(shouldBuildDshRemoteClient({ sourceMtime: 600, outputMtime: 20 }), true);
  assert.equal(shouldBuildDshRemoteClient({ sourceMtime: 10, outputMtime: 0 }), true);
  assert.equal(shouldBuildDshRemoteClient({ force: true, sourceMtime: 10, outputMtime: 20 }), true);
});

test('prestart and distributable scripts rebuild dsh-remote from source', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const prestart = fs.readFileSync(path.join(root, 'scripts', 'prestart-ensure.mjs'), 'utf8');
  assert.match(prestart, /prepare-dsh-remote-client\.mjs/);
  assert.match(pkg.scripts['prepare:dsh-remote-client'], /prepare-dsh-remote-client\.mjs/);
  for (const name of ['pack', 'dist', 'dist:mac']) {
    assert.match(pkg.scripts[name], /prepare-dsh-remote-client\.mjs --force/);
    assert.ok(pkg.scripts[name].indexOf('prepare-dsh-remote-client') < pkg.scripts[name].indexOf('run-electron-builder'));
  }
});