'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  GHOSTTY_ASSET_FILES,
  copyGhosttyAssetsInto,
  ghosttyAssetsComplete,
  harnessHasGhosttyAssets,
  ensureGhosttyAssetsInHarness,
} = require('../shared/ghostty-assets');

test('copyGhosttyAssetsInto writes lib/assets from package sources', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostty-copy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vendor = path.join(root, 'src', 'client', 'ghostty', 'vendor');
  const fonts = path.join(root, 'src', 'client', 'ghostty', 'fonts');
  fs.mkdirSync(vendor, { recursive: true });
  fs.mkdirSync(fonts, { recursive: true });
  fs.writeFileSync(path.join(vendor, 'ghostty-vt.wasm'), 'vt');
  fs.writeFileSync(path.join(vendor, 'ghostty-write-pty.wasm'), 'pty');
  fs.writeFileSync(path.join(fonts, 'SymbolsNerdFontMono-Regular.woff2'), 'font');
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'client.js'), 'export {}\n');

  assert.equal(ghosttyAssetsComplete(root), false);
  assert.deepEqual(copyGhosttyAssetsInto(root), { copied: true });
  assert.equal(ghosttyAssetsComplete(root), true);
  for (const name of GHOSTTY_ASSET_FILES) {
    assert.ok(fs.existsSync(path.join(root, 'lib', 'assets', name)));
  }
});

test('harnessHasGhosttyAssets accepts packages/ or node_modules layout', (t) => {
  const harness = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostty-harness-'));
  t.after(() => fs.rmSync(harness, { recursive: true, force: true }));
  assert.equal(harnessHasGhosttyAssets(harness), false);

  const pkg = path.join(harness, 'packages', 'client', 'ui-user-terminal');
  fs.mkdirSync(path.join(pkg, 'lib', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'lib', 'client.js'), 'export {}\n');
  for (const name of GHOSTTY_ASSET_FILES) {
    fs.writeFileSync(path.join(pkg, 'lib', 'assets', name), 'x');
  }
  assert.equal(harnessHasGhosttyAssets(harness), true);
});

test('ensureGhosttyAssetsInHarness copies into node_modules package when sources exist', (t) => {
  const harness = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostty-ensure-'));
  t.after(() => fs.rmSync(harness, { recursive: true, force: true }));
  const pkg = path.join(harness, 'node_modules', '@deepseek-ai', 'dsh-client-ui-user-terminal');
  const vendor = path.join(pkg, 'src', 'client', 'ghostty', 'vendor');
  const fonts = path.join(pkg, 'src', 'client', 'ghostty', 'fonts');
  fs.mkdirSync(vendor, { recursive: true });
  fs.mkdirSync(fonts, { recursive: true });
  fs.mkdirSync(path.join(pkg, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'lib', 'client.js'), 'export {}\n');
  fs.writeFileSync(path.join(vendor, 'ghostty-vt.wasm'), 'vt');
  fs.writeFileSync(path.join(vendor, 'ghostty-write-pty.wasm'), 'pty');
  fs.writeFileSync(path.join(fonts, 'SymbolsNerdFontMono-Regular.woff2'), 'font');

  const result = ensureGhosttyAssetsInHarness(harness);
  assert.equal(result.ok, true);
  assert.equal(ghosttyAssetsComplete(pkg), true);
});

test('ensureGhosttyAssetsInHarness mirrors assets from packages/ into node_modules/', (t) => {
  const harness = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostty-mirror-'));
  t.after(() => fs.rmSync(harness, { recursive: true, force: true }));
  const packagesRoot = path.join(harness, 'packages', 'client', 'ui-user-terminal');
  const nmRoot = path.join(harness, 'node_modules', '@deepseek-ai', 'dsh-client-ui-user-terminal');
  fs.mkdirSync(path.join(packagesRoot, 'lib', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(nmRoot, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(packagesRoot, 'lib', 'client.js'), 'export {}\n');
  fs.writeFileSync(path.join(nmRoot, 'lib', 'client.js'), 'export {}\n');
  for (const name of GHOSTTY_ASSET_FILES) {
    fs.writeFileSync(path.join(packagesRoot, 'lib', 'assets', name), 'x');
  }

  const result = ensureGhosttyAssetsInHarness(harness);
  assert.equal(result.ok, true);
  assert.equal(ghosttyAssetsComplete(nmRoot), true);
});
