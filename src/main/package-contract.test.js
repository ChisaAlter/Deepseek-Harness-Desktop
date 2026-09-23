'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/**
 * Structural gate for the desktop manifest. The 2026-09-19 audit found the
 * working tree carrying a manifest stripped down to name/version/engines: every
 * documented npm entry point, the runtime dependency, and the whole electron-builder
 * config were gone, and `installer-branding.test.js` died during module load. Unit
 * tests cannot give signal in that state, so this file fails first and loudly.
 */
test('manifest keeps the documented npm entry points', () => {
  const required = [
    'start',
    'test',
    'setup:harness',
    'sync:harness',
    'prepare:dshd-remote',
    'pack',
    'installer:assets',
    'smoke:source',
    'smoke:packaged',
    'qa:source',
    'qa:packaged',
    'check:governance',
    'doc-sync',
    'dist',
  ];
  assert.equal(typeof pkg.scripts, 'object', 'scripts block is missing');
  for (const name of required) {
    assert.equal(
      typeof pkg.scripts[name],
      'string',
      `scripts.${name} is missing — documented entry point lost`,
    );
  }
});

test('manifest keeps the runtime and build-tool dependencies', () => {
  assert.equal(pkg.dependencies?.['electron-updater'], '6.8.9');
  for (const name of ['electron', 'electron-builder', 'semver', 'pnpm']) {
    assert.equal(typeof pkg.devDependencies?.[name], 'string', `devDependencies.${name} is missing`);
  }
  assert.equal(pkg.optionalDependencies?.['node-pty'], '1.2.0-beta.15');
  assert.equal(pkg.engines?.node, '^22.19.0 || >=24.0.0');
});

test('manifest keeps the packaging contract after-pack depends on', () => {
  const build = pkg.build;
  assert.equal(typeof build, 'object', 'build block is missing');
  assert.equal(build.appId, 'ai.deepseek.harness.gui');
  assert.equal(build.afterPack, './scripts/after-pack.js');
  assert.equal(build.electronDist, 'node_modules/electron/dist');
  assert.equal(build.extraMetadata?.main, 'src/main/index.js');
  assert.equal(Array.isArray(build.files), true);
  for (const unpack of [
    'src/main/dshd-daemon-runner.mjs',
    'src/main/dshd-daemon-hooks.mjs',
    'src/shared/dshd-host-tunnel.js',
    'src/shared/dshd-mux-sse.js',
    'src/main/pet-growth.js',
    'src/main/pet-growth-scan-worker.js',
  ]) {
    assert.equal(
      build.asarUnpack?.includes(unpack),
      true,
      `build.asarUnpack lost ${unpack}`,
    );
  }
  assert.equal(build.publish?.[0]?.owner, 'ChisaAlter');
  assert.equal(build.publish?.[0]?.repo, 'Deepseek-Harness-Desktop');
});

test('manifest packages the built-in dsh-remote vendor tree', () => {
  // scripts/after-pack.js asserts resources/vendor/dsh-remote at package time;
  // without this filter the built-in SSH remote workspace is missing from the
  // installer even though the assertion still runs.
  const vendorFilter = pkg.build?.extraResources
    ?.find((entry) => entry.from === 'vendor' && entry.to === 'vendor')
    ?.filter;
  assert.equal(Array.isArray(vendorFilter), true, 'vendor extraResources entry is missing');
  for (const pattern of ['dsh-usage-panel/**', 'dsh-im/**', 'dshbot/**', 'dsh-whale/**', 'dsh-remote/**']) {
    assert.equal(vendorFilter.includes(pattern), true, `vendor filter lost ${pattern}`);
  }
  const remoteRuntime = pkg.build.extraResources.find((entry) => entry.to === 'vendor/dshd-remote/node_modules');
  assert.equal(remoteRuntime?.from, 'vendor/chisacode-remote/.tmp/desktop-runtime/node_modules');
});

test('manifest keeps the NSIS installer branding contract', () => {
  const nsis = pkg.build?.nsis;
  assert.equal(nsis?.oneClick, false);
  assert.equal(nsis?.allowToChangeInstallationDirectory, true);
  assert.equal(nsis?.artifactName, 'Deepseek-Harness-Desktop-Setup-${version}.${ext}');
  assert.equal(nsis?.include, 'build/installer.nsh');
  assert.deepEqual(nsis?.installerLanguages, ['zh_CN', 'en_US']);
  assert.equal(pkg.version, '0.3.2');
});
