'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  DSHBOT_PACKAGE,
  DSHBOT_ALIASES,
  DSHBOT_INSERT_ID,
  DSHBOT_OVERLAY_FILENAME,
  withoutDshbotAliases,
  ensureDesktopDshbot,
} = require('./dshbot-desktop');
const { DSHBOT_BEGIN, DSHBOT_END } = require('./legacy-dshbot-preset');

function makeSource(root) {
  const dir = path.join(root, 'source');
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'client'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: DSHBOT_PACKAGE,
    version: '0.2.0',
    main: './lib/index.js',
    exports: {
      '.': './lib/index.js',
      './client': './client/client.js',
      './cordis.patch.yml': './cordis.patch.yml',
    },
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'export const name = "dshbot"\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'client', 'client.js'), 'export function apply() {}\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), `- insert:\n    - id: ${DSHBOT_INSERT_ID}\n      name: "dshbot"\n`, 'utf8');
  return dir;
}

function overlayPath(profileDir) {
  return path.join(profileDir, 'desktop-plugins', 'dshbot', DSHBOT_OVERLAY_FILENAME);
}

test('ensureDesktopDshbot writes the desktop overlay and junctions node_modules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-bot-'));
  try {
    const source = makeSource(root);
    const profileDir = path.join(root, 'profile');
    // Retired preset residue (old copy + symlink pointing at it) must go.
    const legacyCopy = path.join(profileDir, 'desktop-plugins', 'dshbot');
    fs.mkdirSync(legacyCopy, { recursive: true });
    fs.writeFileSync(path.join(legacyCopy, 'package.json'), '{"name":"stale"}\n', 'utf8');
    fs.mkdirSync(path.join(profileDir, 'node_modules'), { recursive: true });
    fs.symlinkSync(legacyCopy, path.join(profileDir, 'node_modules', 'dshbot'), 'junction');

    const result = ensureDesktopDshbot({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.added, true);
    assert.equal(result.href, pathToFileURL(source).href);
    assert.equal(result.overlayFile, overlayPath(profileDir));

    const linked = path.join(profileDir, 'node_modules', 'dshbot');
    assert.equal(fs.existsSync(path.join(linked, 'package.json')), true);
    assert.equal(
      fs.readFileSync(path.join(linked, 'lib', 'index.js'), 'utf8'),
      'export const name = "dshbot"\n',
    );
    // The junction resolves to vendor, never to the retired preset copy.
    const resolved = fs.realpathSync(linked);
    assert.equal(resolved, fs.realpathSync(source));
    // The desktop-plugins dir holds only the overlay now.
    assert.deepEqual(fs.readdirSync(legacyCopy), [DSHBOT_OVERLAY_FILENAME]);

    const overlay = fs.readFileSync(result.overlayFile, 'utf8');
    assert.match(overlay, new RegExp(`id: ${DSHBOT_INSERT_ID}`));
    assert.match(overlay, /name: "dshbot"/);
    assert.doesNotMatch(overlay, /file:\/\//);

    // The user-owned cordis.patch.yml is never written.
    assert.equal(fs.existsSync(path.join(profileDir, 'cordis.patch.yml')), false);

    const again = ensureDesktopDshbot({ sourceDir: source, profileDir });
    assert.equal(again.ok, true);
    assert.equal(again.added, false);
    // Regression: the retired preset copy shares the overlay directory, so
    // each run deletes the dir before rewriting — a second run must still
    // leave the overlay on disk (a skipped rewrite used to produce a
    // missing --patch file and the CLI died with ENOENT).
    assert.equal(fs.existsSync(again.overlayFile), true);
    assert.match(fs.readFileSync(again.overlayFile, 'utf8'), new RegExp(`id: ${DSHBOT_INSERT_ID}`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshbot migrates the legacy managed block out of cordis.patch.yml', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-bot-mig-'));
  try {
    const source = makeSource(root);
    const profileDir = path.join(root, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const patchFile = path.join(profileDir, 'cordis.patch.yml');
    fs.writeFileSync(patchFile, [
      '- insert:',
      '    - id: user-canary-row',
      '      name: "user-canary-row"',
      DSHBOT_BEGIN,
      '- insert:',
      `    - id: ${DSHBOT_INSERT_ID}`,
      `      name: ${JSON.stringify(DSHBOT_PACKAGE)}`,
      DSHBOT_END,
      '',
    ].join('\n'), 'utf8');

    const result = ensureDesktopDshbot({ sourceDir: source, profileDir });
    assert.equal(result.ok, true);
    assert.equal(result.patchChanged, true);
    const patch = fs.readFileSync(patchFile, 'utf8');
    assert.doesNotMatch(patch, new RegExp(DSHBOT_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(patch, new RegExp(DSHBOT_INSERT_ID));
    assert.match(patch, /user-canary-row/);
    assert.equal(fs.existsSync(result.overlayFile), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshbot with enabled:false drops the overlay and skips vendor checks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-bot-off-'));
  try {
    const profileDir = path.join(root, 'profile');
    const patchFile = path.join(profileDir, 'cordis.patch.yml');
    fs.mkdirSync(profileDir, { recursive: true });
    // A stale managed block must still be stripped while disabled.
    fs.writeFileSync(patchFile, [
      '- insert:',
      '    - id: user-canary-row',
      '      name: "user-canary-row"',
      DSHBOT_BEGIN,
      '- insert:',
      `    - id: ${DSHBOT_INSERT_ID}`,
      `      name: ${JSON.stringify(DSHBOT_PACKAGE)}`,
      DSHBOT_END,
      '',
    ].join('\n'), 'utf8');
    // A previously written overlay must be removed.
    const overlay = overlayPath(profileDir);
    fs.mkdirSync(path.dirname(overlay), { recursive: true });
    fs.writeFileSync(overlay, '- insert:\n    - id: dsh-bot\n      name: "dshbot"\n', 'utf8');

    // No vendor source at all — disabled ensure must not fail on it.
    const result = ensureDesktopDshbot({
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
    assert.doesNotMatch(patch, new RegExp(DSHBOT_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(patch, /user-canary-row/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshbot fails closed when the bundled package is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-bot-miss-'));
  try {
    const profileDir = path.join(root, 'profile');
    const result = ensureDesktopDshbot({
      sourceDir: path.join(root, 'missing'),
      profileDir,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /missing-source/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshbot fails closed on missing declared entries (start must fail)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-bot-entries-'));
  try {
    const source = path.join(root, 'source');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
      name: DSHBOT_PACKAGE,
      version: '0.2.0',
      main: './lib/index.js',
      exports: { '.': './lib/index.js', './client': './client/client.js' },
    }), 'utf8');
    const profileDir = path.join(root, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const result = ensureDesktopDshbot({ sourceDir: source, profileDir });
    assert.equal(result.ok, false);
    assert.match(result.error, /missing-source/);
    // No overlay is produced on failure (the controller fails the start and
    // never passes a stale overlay path).
    assert.equal(fs.existsSync(overlayPath(profileDir)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureDesktopDshbot fails closed on missing runtime dependencies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-bot-deps-'));
  try {
    const source = path.join(root, 'source');
    fs.mkdirSync(path.join(source, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(source, 'lib', 'index.js'), 'export {};\n', 'utf8');
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
      name: DSHBOT_PACKAGE,
      version: '0.2.0',
      type: 'module',
      main: './lib/index.js',
      exports: { '.': './lib/index.js' },
      dependencies: { 'definitely-not-installed-dshd-test': '^1.0.0' },
    }), 'utf8');
    const profileDir = path.join(root, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });
    const result = ensureDesktopDshbot({ sourceDir: source, profileDir });
    assert.equal(result.ok, false);
    assert.match(result.error, /definitely-not-installed-dshd-test/);
    assert.equal(fs.existsSync(overlayPath(profileDir)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('gitignore does not ignore vendored dshbot runtime dependencies', () => {
  const { spawnSync } = require('node:child_process');
  const root = path.join(__dirname, '..', '..');
  for (const file of [
    'vendor/dshbot/node_modules/@deepseek-ai/schemastery/package.json',
    'vendor/dshbot/node_modules/@deepseek-ai/dsh-tools/package.json',
  ]) {
    const result = spawnSync('git', ['check-ignore', '-q', file], { cwd: root, windowsHide: true });
    assert.equal(result.status, 1, `${file} must not match the repo node_modules/ ignore`);
  }
});

test('dshbot aliases strip from the disable list (desktop built-in)', () => {
  assert.deepEqual(DSHBOT_ALIASES, ['dshbot', 'dsh-bot']);
  assert.deepEqual(withoutDshbotAliases(['dshbot', 'dsh-bot', 'other-plugin', 'dsh-im']), ['other-plugin', 'dsh-im']);
  assert.deepEqual(withoutDshbotAliases([]), []);
});
