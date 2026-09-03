'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const electronStub = { app: {} };
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'electron') {
    return electronStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};
const {
  tarCommand,
  hasBuiltHarness,
  canReuseExtractedHarness,
  packagedRuntimeIdentity,
  writeRuntimeStamp,
  ensurePackagedHarness,
  retireStaleExtract,
  sweepStaleExtracts,
  settleBackgroundWork,
  STALE_SUFFIX,
} = require('./harness-extract');
Module._load = originalLoad;

/**
 * Point the module at a temp packaged layout: `resources/vendor` for the
 * archive + pin, `userData/runtime/<version>` for the extract.
 * @param {import('node:test').TestContext} t
 * @returns {{ root: string, resources: string, userData: string, dest: string, loose: string, logs: string[] }}
 */
function packagedFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-extract-'));
  const resources = path.join(root, 'resources');
  const userData = path.join(root, 'userData');
  fs.mkdirSync(path.join(resources, 'vendor'), { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  const previousResourcesPath = process.resourcesPath;
  Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true });
  // harness-extract captured electronStub.app by reference at require time,
  // so the fixture mutates that object instead of replacing it.
  Object.assign(electronStub.app, {
    isPackaged: true,
    getPath: () => userData,
    getVersion: () => '9.9.9',
  });
  t.after(async () => {
    Object.defineProperty(process, 'resourcesPath', { value: previousResourcesPath, configurable: true });
    for (const key of Object.keys(electronStub.app)) delete electronStub.app[key];
    await settleBackgroundWork();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    resources,
    userData,
    dest: path.join(userData, 'runtime', '9.9.9'),
    loose: path.join(resources, 'vendor', 'deepseek-harness'),
    logs: [],
  };
}

function seedBuiltHarness(root) {
  fs.mkdirSync(path.join(root, 'apps', 'cli', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps', 'web', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'cli', 'lib', 'bin.js'), 'export {}\n');
  fs.writeFileSync(path.join(root, 'apps', 'web', 'dist', 'index.html'), '<html></html>\n');
  const pkg = path.join(root, 'packages', 'client', 'ui-user-terminal', 'lib');
  fs.mkdirSync(path.join(pkg, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'client.js'), 'export {}\n');
  for (const name of ['ghostty-vt.wasm', 'ghostty-write-pty.wasm', 'SymbolsNerdFontMono-Regular.woff2']) {
    fs.writeFileSync(path.join(pkg, 'assets', name), 'x');
  }
}

test('tarCommand uses PATH tar outside Windows', () => {
  assert.equal(tarCommand('linux'), 'tar');
  assert.equal(tarCommand('darwin'), 'tar');
});

test('tarCommand prefers the Windows system tar for local absolute paths', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'system-tar-test-'));
  const system32 = path.join(root, 'System32');
  const executable = path.join(system32, 'tar.exe');
  fs.mkdirSync(system32, { recursive: true });
  fs.writeFileSync(executable, '');
  const previousSystemRoot = process.env.SystemRoot;
  const previousWindir = process.env.WINDIR;
  process.env.SystemRoot = root;
  delete process.env.WINDIR;
  t.after(() => {
    if (previousSystemRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = previousSystemRoot;
    if (previousWindir === undefined) delete process.env.WINDIR;
    else process.env.WINDIR = previousWindir;
    fs.rmSync(root, { recursive: true, force: true });
  });

  assert.equal(tarCommand('win32'), executable);
});

test('tarCommand falls back to PATH when system tar is unavailable', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'missing-system-tar-'));
  const previousSystemRoot = process.env.SystemRoot;
  const previousWindir = process.env.WINDIR;
  process.env.SystemRoot = root;
  delete process.env.WINDIR;
  t.after(() => {
    if (previousSystemRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = previousSystemRoot;
    if (previousWindir === undefined) delete process.env.WINDIR;
    else process.env.WINDIR = previousWindir;
    fs.rmSync(root, { recursive: true, force: true });
  });

  assert.equal(tarCommand('win32'), 'tar');
});

test('hasBuiltHarness requires Ghostty assets beside terminal client.js', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'built-harness-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'apps', 'cli', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps', 'web', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'cli', 'lib', 'bin.js'), 'export {}\n');
  fs.writeFileSync(path.join(root, 'apps', 'web', 'dist', 'index.html'), '<html></html>\n');
  assert.equal(hasBuiltHarness(root), false);

  seedBuiltHarness(root);
  assert.equal(hasBuiltHarness(root), true);
});

test('a built extract without a stamp is not reused across same-version overlays', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedBuiltHarness(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"0.1.0-rc.7"}\n');
  const identity = packagedRuntimeIdentity(
    { sha: '528c682e061696f5a160f363f236ecbf53cbd006', npm: '0.1.1-rc.1' },
    1509949440,
  );
  assert.equal(hasBuiltHarness(root), true);
  assert.equal(canReuseExtractedHarness(root, identity), false);
});

test('an extract matching the packaged pin and archive size is reused', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'current-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedBuiltHarness(root);
  const identity = packagedRuntimeIdentity(
    { sha: '528c682e061696f5a160f363f236ecbf53cbd006', npm: '0.1.1-rc.1' },
    1509949440,
  );
  writeRuntimeStamp(root, identity);
  assert.equal(canReuseExtractedHarness(root, identity), true);
});

test('an extract is refreshed when the packaged archive size changes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resized-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedBuiltHarness(root);
  writeRuntimeStamp(root, packagedRuntimeIdentity(
    { sha: '528c682e061696f5a160f363f236ecbf53cbd006', npm: '0.1.1-rc.1' },
    1509949440,
  ));
  const next = packagedRuntimeIdentity(
    { sha: '528c682e061696f5a160f363f236ecbf53cbd006', npm: '0.1.1-rc.1' },
    1509949441,
  );
  assert.equal(canReuseExtractedHarness(root, next), false);
});

test('ensurePackagedHarness reuses only a stamped matching extract', () => {
  const source = fs.readFileSync(path.join(__dirname, 'harness-extract.js'), 'utf8');
  assert.match(source, /canReuseExtractedHarness\(dest,/);
  assert.doesNotMatch(
    source,
    /if \(hasBuiltHarness\(dest\)\) \{\s*return dest;\s*\}\s*const loose/,
  );
});

test('ensurePackagedHarness keeps and reuses a bootable extract when the archive is missing', async (t) => {
  const fixture = packagedFixture(t);
  seedBuiltHarness(fixture.dest);
  const logs = [];
  const resolved = await ensurePackagedHarness((line) => logs.push(line));
  assert.equal(resolved, fixture.dest);
  assert.equal(hasBuiltHarness(fixture.dest), true);
  assert.match(logs.join('\n'), /降级复用/);
});

test('ensurePackagedHarness prefers the loose runtime when the archive is missing', async (t) => {
  const fixture = packagedFixture(t);
  seedBuiltHarness(fixture.loose);
  const resolved = await ensurePackagedHarness(() => {});
  assert.equal(resolved, fixture.loose);
});

test('ensurePackagedHarness throws without deleting a partial extract when the archive is missing', async (t) => {
  const fixture = packagedFixture(t);
  // Partial extract: bin.js only, not a bootable runtime.
  fs.mkdirSync(path.join(fixture.dest, 'apps', 'cli', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(fixture.dest, 'apps', 'cli', 'lib', 'bin.js'), 'export {}\n');
  await assert.rejects(
    () => ensurePackagedHarness(() => {}),
    /缺少运行时归档/,
  );
  assert.equal(fs.existsSync(path.join(fixture.dest, 'apps', 'cli', 'lib', 'bin.js')), true);
});

test('ensurePackagedHarness throws before touching the extract when the pin is missing', async (t) => {
  const fixture = packagedFixture(t);
  seedBuiltHarness(fixture.dest);
  fs.writeFileSync(path.join(fixture.resources, 'vendor', 'deepseek-harness.tar'), 'not-a-real-archive');
  await assert.rejects(
    () => ensurePackagedHarness(() => {}),
    /harness-upstream\.json/,
  );
  assert.equal(hasBuiltHarness(fixture.dest), true);
});

test('ensurePackagedHarness re-extracts a stale extract only when the archive exists', async (t) => {
  const { spawnSync } = require('node:child_process');
  const fixture = packagedFixture(t);
  const tree = path.join(fixture.root, 'archive-tree');
  seedBuiltHarness(tree);
  const archive = path.join(fixture.resources, 'vendor', 'deepseek-harness.tar');
  const packed = spawnSync(tarCommand(), ['-cf', archive, '-C', tree, '.'], { windowsHide: true });
  if (packed.status !== 0) {
    t.skip('tar unavailable for archive fixture');
    return;
  }
  fs.writeFileSync(
    path.join(fixture.resources, 'vendor', 'harness-upstream.json'),
    JSON.stringify({ sha: '528c682e061696f5a160f363f236ecbf53cbd006', npm: '0.1.1-rc.1' }),
  );
  // Stale extract: bootable but with no stamp, so it must be replaced.
  seedBuiltHarness(fixture.dest);
  fs.writeFileSync(path.join(fixture.dest, 'stale-marker.txt'), 'old');
  const resolved = await ensurePackagedHarness(() => {});
  assert.equal(resolved, fixture.dest);
  assert.equal(hasBuiltHarness(fixture.dest), true);
  assert.equal(fs.existsSync(path.join(fixture.dest, 'stale-marker.txt')), false);
  const identity = packagedRuntimeIdentity(
    { sha: '528c682e061696f5a160f363f236ecbf53cbd006', npm: '0.1.1-rc.1' },
    fs.statSync(archive).size,
  );
  assert.equal(canReuseExtractedHarness(fixture.dest, identity), true);
  // The stale tree was retired by rename and deleted in the background, so
  // nothing but the fresh extract remains once that work settles.
  await settleBackgroundWork();
  assert.deepEqual(fs.readdirSync(path.join(fixture.userData, 'runtime')), ['9.9.9']);
});

test('ensurePackagedHarness never deletes a stale extract synchronously', () => {
  // fs.rmSync of a ~57k-file runtime blocked the Electron main thread 16–46 s
  // and Windows reported the window 未响应 (WER AppHangTransient).
  const source = fs.readFileSync(path.join(__dirname, 'harness-extract.js'), 'utf8');
  assert.doesNotMatch(source, /\brmSync\(/);
  assert.match(source, /await retireStaleExtract\(dest/);
});

test('retireStaleExtract renames first and removes the retired tree off the caller path', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-runtime-'));
  t.after(async () => {
    await settleBackgroundWork();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const dest = path.join(root, 'runtime', '1.0.0');
  seedBuiltHarness(dest);
  const logs = [];
  const retired = await retireStaleExtract(dest, (line) => logs.push(line));
  assert.equal(fs.existsSync(dest), false, 'dest is free for the fresh extract immediately');
  assert.ok(retired && retired.startsWith(`${dest}${STALE_SUFFIX}`));
  await settleBackgroundWork();
  assert.equal(fs.existsSync(retired), false);
  assert.deepEqual(logs, []);
});

test('sweepStaleExtracts removes retired trees left behind by an interrupted run', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-runtime-'));
  t.after(async () => {
    await settleBackgroundWork();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const runtime = path.join(root, 'runtime');
  const keep = path.join(runtime, '1.0.0');
  const leftover = path.join(runtime, `1.0.0${STALE_SUFFIX}abc-123`);
  seedBuiltHarness(keep);
  seedBuiltHarness(leftover);
  fs.writeFileSync(path.join(runtime, 'notes.stale-file.txt'), 'file, not a dir');
  const swept = await sweepStaleExtracts(runtime, () => {});
  assert.deepEqual(swept, [leftover]);
  await settleBackgroundWork();
  assert.equal(fs.existsSync(leftover), false);
  assert.equal(hasBuiltHarness(keep), true);
  assert.equal(fs.existsSync(path.join(runtime, 'notes.stale-file.txt')), true);
  assert.deepEqual(await sweepStaleExtracts(path.join(root, 'missing'), () => {}), []);
});
