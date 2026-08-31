'use strict';

// Locks the publishable manifest of the standalone dshbot plugin
// (vendor/dshbot). The publish workflow (.github/workflows/publish-dshbot.yml)
// runs scripts/check-dshbot-publish.mjs with the same rules right before
// `npm publish`; this suite keeps a broken manifest from reaching the tag.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const os = require('os');

const repoRoot = path.join(__dirname, '..', '..');
const pkgDir = path.join(repoRoot, 'vendor', 'dshbot');
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));

test('dshbot is publishable: public, MIT, semver, no private flag', () => {
  assert.equal(Boolean(pkg.private), false);
  assert.equal(pkg.publishConfig && pkg.publishConfig.access, 'public');
  assert.equal(pkg.license, 'MIT');
  assert.match(String(pkg.version), /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  assert.equal(fs.existsSync(path.join(pkgDir, 'LICENSE')), true);
  assert.equal(fs.existsSync(path.join(pkgDir, 'README.md')), true);
});

test('every dshbot export target exists and is covered by the files manifest', () => {
  const filesList = pkg.files;
  assert.ok(Array.isArray(filesList) && filesList.length > 0);
  const alwaysPacked = new Set(['package.json', 'README.md', 'LICENSE']);
  const covered = (relPath) =>
    alwaysPacked.has(relPath)
    || filesList.some((entry) => relPath === entry || relPath.startsWith(`${entry}/`));

  for (const [key, target] of Object.entries(pkg.exports)) {
    assert.equal(typeof target, 'string', `exports[${key}] must be a path string`);
    const relPath = target.replace(/^\.\//, '');
    assert.equal(
      fs.existsSync(path.join(pkgDir, relPath)),
      true,
      `exports[${key}] -> ${target} must exist`,
    );
    assert.equal(covered(relPath), true, `exports[${key}] -> ${target} must be packed`);
  }

  const mainPath = pkg.main.replace(/^\.\//, '');
  assert.equal(fs.existsSync(path.join(pkgDir, mainPath)), true);
  assert.equal(fs.existsSync(path.join(pkgDir, 'presets', 'dshbot-room')), true);
});

test('the publish preflight script passes and enforces the dshbot-v tag shape', () => {
  const script = path.join(repoRoot, 'scripts', 'check-dshbot-publish.mjs');

  const ok = spawnSync(process.execPath, [script, `dshbot-v${pkg.version}`], {
    encoding: 'utf8',
  });
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);

  const badTag = spawnSync(process.execPath, [script, 'v0.0.0'], { encoding: 'utf8' });
  assert.equal(badTag.status, 1);
  assert.match(badTag.stderr, /does not match vendor\/dshbot version/);
});

test('the standalone-repo export passes its own preflight (repo split stays shippable)', () => {
  // The ChisaAlter/dshbot repository is generated from vendor/dshbot by
  // scripts/export-dshbot-standalone.mjs; this keeps the exported tree
  // (root layout, ChisaAlter/dshbot repository metadata, v<semver> tags)
  // publishable whenever vendor/dshbot changes.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshbot-standalone-'));
  fs.rmdirSync(outDir); // the export script refuses an existing dir
  try {
    const exported = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts', 'export-dshbot-standalone.mjs'), outDir],
      { encoding: 'utf8' },
    );
    assert.equal(exported.status, 0, exported.stderr || exported.stdout);

    const standalonePkg = JSON.parse(
      fs.readFileSync(path.join(outDir, 'package.json'), 'utf8'),
    );
    assert.equal(standalonePkg.version, pkg.version);
    assert.equal(standalonePkg.repository.url, 'git+https://github.com/ChisaAlter/dshbot.git');
    assert.equal(standalonePkg.repository.directory, undefined);
    assert.equal(fs.existsSync(path.join(outDir, '.github', 'workflows', 'publish.yml')), true);

    const preflight = spawnSync(
      process.execPath,
      [path.join(outDir, 'scripts', 'check-publish.mjs'), `v${pkg.version}`],
      { encoding: 'utf8' },
    );
    assert.equal(preflight.status, 0, preflight.stderr || preflight.stdout);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});
