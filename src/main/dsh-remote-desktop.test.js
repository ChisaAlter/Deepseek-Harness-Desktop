'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  DSH_REMOTE_PACKAGE,
  DSH_REMOTE_ALIASES,
  DSH_REMOTE_INSERT_ID,
  DSH_REMOTE_OVERLAY_FILENAME,
  DSH_REMOTE_BEGIN,
  DSH_REMOTE_END,
  withoutDshRemoteAliases,
  ensureDesktopDshRemote,
} = require('./dsh-remote-desktop');

function makeSource(root) {
  const dir = path.join(root, 'source');
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: DSH_REMOTE_PACKAGE,
    version: '0.8.21',
    type: 'module',
    main: './lib/index.js',
    exports: {
      '.': './lib/index.js',
      './cordis.patch.yml': './cordis.patch.yml',
    },
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'export const name = "dsh-remote"\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), `- insert:\n    - id: ${DSH_REMOTE_INSERT_ID}\n      name: "dsh-remote"\n`, 'utf8');
  return dir;
}

function overlayPath(profileDir) {
  return path.join(profileDir, 'desktop-plugins', 'dsh-remote', DSH_REMOTE_OVERLAY_FILENAME);
}

test('ensureDesktopDshRemote writes the desktop overlay and junctions node_modules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-remote-'));
  try {
    const source = makeSource(root);
    const profileDir = path.join(root, 'profile');
    // A stale desktop-plugins copy (e.g. an earlier soft install) must go.
    const staleCopy = path.join(profileDir, 'desktop-plugins', 'dsh-remote');
    fs.mkdirSync(staleCopy, { recursive: true });
    fs.writeFileSync(path.join(staleCopy, 'package.json'), '{"name":"stale"}\n', 'utf8');
    fs.mkdirSync(path.join(profileDir, 'node_modules'), { recursive: true });
    fs.symlinkSync(staleCopy, path.join(profileDir, 'node_modules', 'dsh-remote'), 'junction');

    const result = ensureDesktopDshRemote({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.added, true);
    assert.equal(result.href, pathToFileURL(source).href);
    assert.equal(result.overlayFile, overlayPath(profileDir));

    const linked = path.join(profileDir, 'node_modules', 'dsh-remote');
    assert.equal(fs.existsSync(path.join(linked, 'package.json')), true);
    assert.equal(
      fs.readFileSync(path.join(linked, 'lib', 'index.js'), 'utf8'),
      'export const name = "dsh-remote"\n',
    );
    // The junction resolves to vendor, never to the stale copy.
    const resolved = fs.realpathSync(linked);
    assert.equal(resolved, fs.realpathSync(source));
    // The desktop-plugins dir holds only the overlay now.
    assert.deepEqual(fs.readdirSync(staleCopy), [DSH_REMOTE_OVERLAY_FILENAME]);

    const overlay = fs.readFileSync(result.overlayFile, 'utf8');
    assert.match(overlay, new RegExp(`id: ${DSH_REMOTE_INSERT_ID}`));
    assert.match(overlay, /name: "dsh-remote"/);
    assert.doesNotMatch(overlay, /file:\/\//);

    // The user-owned cordis.patch.yml is never written.
    assert.equal(fs.existsSync(path.join(profileDir, 'cordis.patch.yml')), false);

    const again = ensureDesktopDshRemote({ sourceDir: source, profileDir });
    assert.equal(again.ok, true);
    assert.equal(again.added, false);
    // Regression: each run reclaims the dir before rewriting — a second run
    // must still leave the overlay on disk.
    assert.equal(fs.existsSync(again.overlayFile), true);
    assert.match(fs.readFileSync(again.overlayFile, 'utf8'), new RegExp(`id: ${DSH_REMOTE_INSERT_ID}`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshRemote strips a managed block out of cordis.patch.yml', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-remote-mig-'));
  try {
    const source = makeSource(root);
    const profileDir = path.join(root, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const patchFile = path.join(profileDir, 'cordis.patch.yml');
    fs.writeFileSync(patchFile, [
      '- insert:',
      '    - id: user-canary-row',
      '      name: "user-canary-row"',
      DSH_REMOTE_BEGIN,
      '- insert:',
      `    - id: ${DSH_REMOTE_INSERT_ID}`,
      `      name: ${JSON.stringify(DSH_REMOTE_PACKAGE)}`,
      DSH_REMOTE_END,
      '',
    ].join('\n'), 'utf8');

    const result = ensureDesktopDshRemote({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.patchChanged, true);
    const patch = fs.readFileSync(patchFile, 'utf8');
    assert.doesNotMatch(patch, new RegExp(DSH_REMOTE_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(patch, new RegExp(DSH_REMOTE_INSERT_ID));
    assert.match(patch, /user-canary-row/);
    assert.equal(fs.existsSync(result.overlayFile), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshRemote with enabled:false drops the overlay and skips vendor checks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-remote-off-'));
  try {
    const profileDir = path.join(root, 'profile');
    const patchFile = path.join(profileDir, 'cordis.patch.yml');
    fs.mkdirSync(profileDir, { recursive: true });
    // A stale managed block must still be stripped while disabled.
    fs.writeFileSync(patchFile, [
      '- insert:',
      '    - id: user-canary-row',
      '      name: "user-canary-row"',
      DSH_REMOTE_BEGIN,
      '- insert:',
      `    - id: ${DSH_REMOTE_INSERT_ID}`,
      `      name: ${JSON.stringify(DSH_REMOTE_PACKAGE)}`,
      DSH_REMOTE_END,
      '',
    ].join('\n'), 'utf8');
    // A previously written overlay must be removed.
    const overlay = overlayPath(profileDir);
    fs.mkdirSync(path.dirname(overlay), { recursive: true });
    fs.writeFileSync(overlay, '- insert:\n    - id: dsh-remote\n      name: "dsh-remote"\n', 'utf8');

    // No vendor source at all — disabled ensure must not fail on it.
    const result = ensureDesktopDshRemote({
      sourceDir: path.join(root, 'missing'),
      profileDir,
      enabled: false,
    });
    assert.equal(result.ok, true);
    assert.equal(result.added, false);
    assert.equal(result.disabled, true);
    assert.equal(result.overlayFile, undefined);
    assert.equal(result.patchChanged, true);
    assert.equal(fs.existsSync(overlay), false);
    const patch = fs.readFileSync(patchFile, 'utf8');
    assert.doesNotMatch(patch, new RegExp(DSH_REMOTE_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(patch, /user-canary-row/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshRemote fails closed when the bundled package is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-remote-miss-'));
  try {
    const profileDir = path.join(root, 'profile');
    const result = ensureDesktopDshRemote({
      sourceDir: path.join(root, 'missing'),
      profileDir,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /missing-source/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshRemote fails closed on missing declared entries (start must fail)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-remote-entries-'));
  try {
    const source = path.join(root, 'source');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
      name: DSH_REMOTE_PACKAGE,
      version: '0.8.21',
      main: './lib/index.js',
      exports: { '.': './lib/index.js', './cordis.patch.yml': './cordis.patch.yml' },
    }), 'utf8');
    const profileDir = path.join(root, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const result = ensureDesktopDshRemote({ sourceDir: source, profileDir });
    assert.equal(result.ok, false);
    assert.match(result.error, /missing-source/);
    // No overlay is produced on failure (the controller fails the start and
    // never passes a stale overlay path).
    assert.equal(fs.existsSync(overlayPath(profileDir)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshRemote fails closed on missing runtime dependencies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-remote-deps-'));
  try {
    const source = path.join(root, 'source');
    fs.mkdirSync(path.join(source, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(source, 'lib', 'index.js'), 'export {};\n', 'utf8');
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
      name: DSH_REMOTE_PACKAGE,
      version: '0.8.21',
      type: 'module',
      main: './lib/index.js',
      exports: { '.': './lib/index.js' },
      dependencies: { 'definitely-not-installed-dshd-test': '^1.0.0' },
    }), 'utf8');
    const profileDir = path.join(root, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const result = ensureDesktopDshRemote({ sourceDir: source, profileDir });
    assert.equal(result.ok, false);
    assert.match(result.error, /definitely-not-installed-dshd-test/);
    assert.equal(fs.existsSync(overlayPath(profileDir)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gitignore does not ignore vendored dsh-remote runtime dependencies', () => {
  const { spawnSync } = require('node:child_process');
  const root = path.join(__dirname, '..', '..');
  for (const file of [
    'vendor/dsh-remote/node_modules/ssh2/package.json',
    'vendor/dsh-remote/node_modules/iconv-lite/package.json',
    'vendor/dsh-remote/node_modules/@deepseek-ai/dsh-tools/package.json',
  ]) {
    const result = spawnSync('git', ['check-ignore', '-q', file], { cwd: root, windowsHide: true });
    assert.equal(result.status, 1, `${file} must not match the repo node_modules/ ignore`);
  }
});

test('vendored dsh-remote declares a complete runtime closure for the ensure validators', () => {
  const { missingDeclaredEntries, missingRuntimeFiles } = require('./plugin-runtime-files');
  const source = path.join(__dirname, '..', '..', 'vendor', 'dsh-remote');
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  assert.deepEqual(missingDeclaredEntries(source, manifest), []);
  assert.deepEqual(missingRuntimeFiles(source), []);
});

test('dsh-remote aliases strip from the disable list (desktop built-in)', () => {
  assert.deepEqual(DSH_REMOTE_ALIASES, ['dsh-remote']);
  assert.deepEqual(withoutDshRemoteAliases(['dsh-remote', 'other-plugin', 'dsh-im']), ['other-plugin', 'dsh-im']);
  assert.deepEqual(withoutDshRemoteAliases([]), []);
});
