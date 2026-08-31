'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  USAGE_PANEL_BEGIN,
  USAGE_PANEL_END,
  ensureUsagePanelPlugin,
} = require('./usage-panel-preset');

function writeSource(dir) {
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: 'dsh-usage-panel',
    version: '0.2.0',
    type: 'module',
    main: 'lib/index.js',
    exports: { '.': './lib/index.js', './client': './lib/client.js' },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web', inject: [] },
    },
  }, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'export const name = "dsh-usage-panel"\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'client.js'), 'export function apply() {}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: usage-stats',
    "      name: 'dsh-usage-panel'",
    '',
  ].join('\n'), 'utf8');
  return dir;
}

test('ensureUsagePanelPlugin copies the bundled package and writes a desktop overlay', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    const result = ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.added, true);
    const dest = path.join(profileDir, 'desktop-plugins', 'dsh-usage-panel');
    assert.equal(fs.readFileSync(path.join(dest, 'lib', 'index.js'), 'utf8'), 'export const name = "dsh-usage-panel"\n');
    assert.equal(fs.existsSync(path.join(dest, 'lib', 'client.js')), true);
    const linked = path.join(profileDir, 'node_modules', 'dsh-usage-panel');
    assert.equal(fs.existsSync(path.join(linked, 'package.json')), true);
    // The insert lives in the overlay; cordis.patch.yml stays user-owned
    // (never created by the desktop).
    assert.equal(result.overlayFile, path.join(dest, 'desktop-usage-panel.patch.yml'));
    const overlay = fs.readFileSync(result.overlayFile, 'utf8');
    assert.ok(overlay.includes('id: usage-stats'));
    assert.match(overlay, /name: ['"]dsh-usage-panel['"]/);
    assert.equal(fs.existsSync(path.join(profileDir, 'cordis.patch.yml')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin backs off a user-owned real-directory install', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    const userDir = path.join(profileDir, 'node_modules', 'dsh-usage-panel');
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, 'manager.json'), '{"user":true}', 'utf8');
    // A stale overlay from an earlier desktop run must be removed.
    const dest = path.join(profileDir, 'desktop-plugins', 'dsh-usage-panel');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'desktop-usage-panel.patch.yml'), '- insert:\n    - id: usage-stats\n', 'utf8');

    const result = ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.userOwned, true);
    // No desktop copy refresh, no junction replacement.
    assert.equal(fs.existsSync(path.join(dest, 'lib')), false);
    assert.equal(fs.existsSync(path.join(dest, 'package.json')), false);
    assert.equal(fs.existsSync(path.join(dest, 'desktop-usage-panel.patch.yml')), false, 'overlay removed (no double mount)');
    assert.equal(fs.readFileSync(path.join(userDir, 'manager.json'), 'utf8'), '{"user":true}', 'user dir untouched');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin treats a junction to a foreign target as user-owned', { skip: process.platform === 'linux' && !process.getuid ? false : false }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-user-'));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    const linked = path.join(profileDir, 'node_modules', 'dsh-usage-panel');
    fs.mkdirSync(path.dirname(linked), { recursive: true });
    fs.symlinkSync(foreign, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const result = ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    assert.equal(result.userOwned, true);
    // The foreign link survives; its content is untouched.
    assert.equal(fs.readlinkSync(linked), foreign);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(foreign, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin migrates the legacy managed block out of the user patch', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), [
      '- id: message-edit',
      '  disabled: true',
      '',
      USAGE_PANEL_BEGIN,
      '- insert:',
      '    - id: usage-stats',
      '      name: "dsh-usage-panel"',
      USAGE_PANEL_END,
      '',
    ].join('\n'), 'utf8');
    const result = ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    const patch = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
    assert.equal(patch.includes(USAGE_PANEL_BEGIN), false);
    assert.equal(patch.includes('id: usage-stats'), false);
    assert.ok(patch.includes('- id: message-edit'));
    assert.ok(fs.readFileSync(result.overlayFile, 'utf8').includes('id: usage-stats'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin refreshes the bundled copy on later starts', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    const first = ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    const firstOverlay = fs.readFileSync(first.overlayFile, 'utf8');
    fs.writeFileSync(path.join(source, 'lib', 'index.js'), 'export const name = "updated"\n', 'utf8');
    const again = ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    assert.equal(again.ok, true);
    assert.equal(again.added, false);
    const dest = path.join(profileDir, 'desktop-plugins', 'dsh-usage-panel', 'lib', 'index.js');
    assert.equal(fs.readFileSync(dest, 'utf8'), 'export const name = "updated"\n');
    // Idempotent overlay: unchanged content is not rewritten differently.
    assert.equal(fs.readFileSync(again.overlayFile, 'utf8'), firstOverlay);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin removes the overlay when the profile already lists the bundle', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'package.json'), `${JSON.stringify({
      dependencies: { 'dsh-usage-panel': '0.2.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-web-app', 'dsh-usage-panel'] } },
    }, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), [
      USAGE_PANEL_BEGIN,
      '- insert:',
      '    - id: usage-stats',
      '      name: "dsh-usage-panel"',
      USAGE_PANEL_END,
      '',
    ].join('\n'), 'utf8');
    // A stale overlay from a previous non-bundle start must go away too.
    const overlayFile = path.join(profileDir, 'desktop-plugins', 'dsh-usage-panel', 'desktop-usage-panel.patch.yml');
    fs.mkdirSync(path.dirname(overlayFile), { recursive: true });
    fs.writeFileSync(overlayFile, '- insert: []\n', 'utf8');
    const result = ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.added, false);
    assert.equal(result.overlayFile, undefined);
    assert.equal(fs.existsSync(overlayFile), false);
    const patch = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
    assert.equal(patch.includes(USAGE_PANEL_BEGIN), false);
    assert.equal(patch.includes('id: usage-stats'), false);
    assert.equal(fs.existsSync(path.join(profileDir, 'desktop-plugins', 'dsh-usage-panel', 'package.json')), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin replaces a non-junction marketplace install with a junction', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const profileDir = path.join(home, 'profiles', 'web');
    const installed = path.join(profileDir, 'node_modules', 'dsh-usage-panel');
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, 'package.json'), '{"name":"dsh-usage-panel","version":"9.9.9"}\n', 'utf8');
    ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    const dest = path.join(profileDir, 'desktop-plugins', 'dsh-usage-panel');
    assert.equal(JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version, '0.2.0');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8')).version, '0.2.0');
    const st = fs.lstatSync(installed);
    const isLink = st.isSymbolicLink() || (() => {
      try {
        fs.readlinkSync(installed);
        return true;
      } catch {
        return false;
      }
    })();
    assert.equal(isLink, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin fails closed when the bundled package is missing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-missing-'));
  try {
    const result = ensureUsagePanelPlugin({
      sourceDir: source,
      profileDir: path.join(home, 'profiles', 'web'),
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /missing-source/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin copies bundled node_modules with the package', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const pkgFile = path.join(source, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    pkg.dependencies = { zod: '4.4.3' };
    fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    fs.mkdirSync(path.join(source, 'node_modules', 'zod'), { recursive: true });
    fs.writeFileSync(path.join(source, 'node_modules', 'zod', 'package.json'), '{"name":"zod"}\n', 'utf8');
    const profileDir = path.join(home, 'profiles', 'web');
    const result = ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    const dest = path.join(profileDir, 'desktop-plugins', 'dsh-usage-panel', 'node_modules', 'zod', 'package.json');
    assert.equal(fs.existsSync(dest), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin fails closed and strips the insert when zod is missing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const pkgFile = path.join(source, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    pkg.dependencies = { zod: '4.4.3' };
    fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    const profileDir = path.join(home, 'profiles', 'web');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), [
      USAGE_PANEL_BEGIN,
      '- insert:',
      '    - id: usage-stats',
      '      name: "dsh-usage-panel"',
      USAGE_PANEL_END,
      '',
    ].join('\n'), 'utf8');
    const dest = path.join(profileDir, 'desktop-plugins', 'dsh-usage-panel', 'lib');
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'index.js'), 'export const name = "kept"\n', 'utf8');
    const result = ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    assert.equal(result.ok, false);
    assert.match(result.error, /missing-source:node_modules:zod/);
    const patch = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
    assert.equal(patch.includes(USAGE_PANEL_BEGIN), false);
    assert.equal(patch.includes('id: usage-stats'), false);
    assert.equal(fs.readFileSync(path.join(dest, 'index.js'), 'utf8'), 'export const name = "kept"\n');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('ensureUsagePanelPlugin fails closed when a dependency export file is missing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-home-'));
  const source = writeSource(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-panel-src-')));
  try {
    const pkgFile = path.join(source, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    pkg.dependencies = { zod: '4.4.3' };
    fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
    const zodDir = path.join(source, 'node_modules', 'zod');
    fs.mkdirSync(zodDir, { recursive: true });
    fs.writeFileSync(path.join(zodDir, 'package.json'), `${JSON.stringify({
      name: 'zod',
      exports: { '.': { import: './index.js', require: './index.cjs' } },
    })}\n`, 'utf8');
    fs.writeFileSync(path.join(zodDir, 'index.js'), 'export default {}\n', 'utf8');
    const profileDir = path.join(home, 'profiles', 'web');
    const result = ensureUsagePanelPlugin({ sourceDir: source, profileDir });
    assert.equal(result.ok, false);
    assert.match(result.error, /index\.cjs/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('repo vendors the restyled dsh-usage-panel snapshot', () => {
  const root = path.join(__dirname, '..', '..', 'vendor', 'dsh-usage-panel');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'dsh-usage-panel');
  assert.equal(pkg.version, '0.2.0');
  assert.equal(fs.existsSync(path.join(root, 'LICENSE')), true);
  assert.equal(fs.existsSync(path.join(root, 'VENDOR.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'lib', 'client.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'lib', 'index.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'cordis.patch.yml')), true);
  assert.ok(pkg.dependencies && pkg.dependencies.zod);
  const vendor = fs.readFileSync(path.join(root, 'VENDOR.md'), 'utf8');
  assert.match(vendor, /12ac109bc6213bdbca539e3199e7338fcac020ed/);
  const client = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');
  assert.match(client, /require\("@deepseek-ai\/dsh-client-ui-primitives"\)/);
  assert.match(client, /missingPrimitives/);
  assert.doesNotMatch(client, /#4f8cff|#8b5cf6|#eef2f7|#22c55e/);
  assert.doesNotMatch(client, /data-ds-dark-theme/);
  assert.match(client, /Usage stats/);
});

test('gitignore does not ignore usage-panel zod entry files', () => {
  const { spawnSync } = require('node:child_process');
  const root = path.join(__dirname, '..', '..');
  for (const file of ['index.js', 'index.cjs']) {
    const result = spawnSync(
      'git',
      ['check-ignore', '-q', `vendor/dsh-usage-panel/node_modules/zod/${file}`],
      { cwd: root, windowsHide: true },
    );
    assert.equal(result.status, 1, `${file} must not match the repo node_modules/ ignore`);
  }
});

test('usage-panel extraResources is nested under vendor so electron-builder keeps node_modules', () => {
  const extra = require('../../package.json').build.extraResources;
  const usage = extra.find((entry) => (
    entry
    && entry.from === 'vendor'
    && entry.to === 'vendor'
    && Array.isArray(entry.filter)
    && entry.filter.includes('dsh-usage-panel/**')
  ));
  assert.ok(usage, 'usage-panel extraResources must copy from vendor with filter dsh-usage-panel/**');
  assert.equal(extra.some((entry) => entry && entry.from === 'vendor/dsh-usage-panel'), false);
});
