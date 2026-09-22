'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DSHMARKET_BEGIN,
  DSHMARKET_END,
  removeDshMarketPreset,
} = require('./dshmarket-preset');

function writePresetResidue(profileDir) {
  const destDir = path.join(profileDir, 'desktop-plugins', 'dshmarket');
  fs.mkdirSync(path.join(destDir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(destDir, 'package.json'), '{"name":"dshmarket"}\n', 'utf8');
  fs.writeFileSync(path.join(destDir, 'lib', 'index.js'), 'export const name = "dsh-market"\n', 'utf8');
  const linked = path.join(profileDir, 'node_modules', 'dshmarket');
  fs.mkdirSync(path.dirname(linked), { recursive: true });
  fs.symlinkSync(destDir, linked, process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), [
    DSHMARKET_BEGIN,
    '- insert:',
    '    - id: dsh-market',
    '      name: "dshmarket"',
    DSHMARKET_END,
    '',
  ].join('\n'), 'utf8');
  return { destDir, linked };
}

test('removeDshMarketPreset strips the managed insert, copy, and preset symlink', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    const { destDir, linked } = writePresetResidue(profileDir);
    const result = removeDshMarketPreset({ profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.stripped, true);
    assert.equal(result.removedCopy, true);
    assert.equal(result.removedLink, true);
    assert.equal(fs.existsSync(destDir), false);
    assert.equal(fs.existsSync(linked), false);
    const patch = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
    assert.equal(patch.includes(DSHMARKET_BEGIN), false);
    assert.equal(patch.includes('id: dsh-market'), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('removeDshMarketPreset leaves a real node_modules/dshmarket install alone', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    const installed = path.join(profileDir, 'node_modules', 'dshmarket');
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, 'package.json'), '{"name":"dshmarket","version":"1.14.0"}\n', 'utf8');
    fs.writeFileSync(path.join(profileDir, 'package.json'), `${JSON.stringify({
      dependencies: { dshmarket: '1.14.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-web-app', 'dshmarket'] } },
    }, null, 2)}\n`, 'utf8');
    const result = removeDshMarketPreset({ profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.changed, false);
    assert.equal(fs.existsSync(path.join(installed, 'package.json')), true);
    const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
    assert.equal(manifest.dependencies.dshmarket, '1.14.0');
    assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-web-app', 'dshmarket']);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('removeDshMarketPreset is a no-op on a clean profile', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    const result = removeDshMarketPreset({ profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.changed, false);
    assert.equal(fs.existsSync(path.join(profileDir, 'cordis.patch.yml')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('dshmarket is dropped from the mounted composition and the catalog', () => {
  const { DROPPED } = require('./plugins');
  assert.ok(DROPPED.includes('dshmarket'));
});

test('packaging no longer ships vendor/dshmarket', () => {
  const extra = require('../../package.json').build.extraResources;
  for (const entry of extra) {
    const filters = Array.isArray(entry?.filter) ? entry.filter : [];
    assert.equal(filters.some((item) => item.includes('dshmarket')), false);
    assert.equal(String(entry?.from || '').includes('dshmarket'), false);
  }
});

test('vendor/dshmarket is an attribution stub, not a live source tree', () => {
  const root = path.join(__dirname, '..', '..', 'vendor', 'dshmarket');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'dshmarket');
  assert.equal(pkg.private, true);
  const marker = fs.readFileSync(path.join(root, 'DESKTOP-FORK.md'), 'utf8');
  assert.ok(marker.includes('ui-settings-market'));
  assert.equal(fs.existsSync(path.join(root, 'LICENSE')), true);
  for (const removed of ['node_modules', 'lib', 'client', 'cordis.patch.yml', 'package-lock.json']) {
    assert.equal(fs.existsSync(path.join(root, removed)), false, `vendor/dshmarket/${removed} should stay deleted`);
  }
});
