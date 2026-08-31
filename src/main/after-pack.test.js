'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  assertHarnessRuntime,
  assertVendoredPluginRuntimeDeps,
  collectFiles,
  collectPnpmFlattenFiles,
  deployCliEntries,
  nodePtyPrebuildRelative,
  repairFlattenedCommanderEsm,
  repairFlattenedVersionIsolation,
  resolveDeployDir,
  resolveResourcesDir,
  restoreVendoredPluginNodeModules,
  installPluginRuntimeDeps,
} = require('../../scripts/after-pack');

const RC7_PIN = { npm: '0.1.0-rc.7' };

function writeRuntimeVersions(root, npm) {
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ version: npm })}\n`);
  fs.mkdirSync(path.join(root, 'apps', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'cli', 'package.json'), `${JSON.stringify({ version: npm })}\n`);
}

function writeNodePtyPrebuild(root, platform = process.platform, arch = process.arch) {
  const relative = nodePtyPrebuildRelative(platform, arch);
  const file = path.join(root, 'node_modules', 'node-pty', relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'node-pty', 'package.json'), '{"name":"node-pty"}\n');
  fs.writeFileSync(file, 'native');
}

function makeFixture(t) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-test-'));
  const source = path.join(workspace, 'source');
  const shared = path.join(workspace, 'shared');
  const destination = path.join(workspace, 'destination');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(shared, { recursive: true });
  fs.writeFileSync(path.join(shared, 'package.json'), '{"name":"shared"}\n');
  fs.writeFileSync(path.join(shared, 'index.js'), 'module.exports = true;\n');
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  return { source, shared, destination };
}

function linkPackage(source, shared, branch) {
  const nodeModules = path.join(source, branch, 'node_modules');
  fs.mkdirSync(nodeModules, { recursive: true });
  fs.symlinkSync(shared, path.join(nodeModules, 'shared'), 'junction');
}

test('deployCliEntries excludes runtime state and separately assembled directories', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-entries-'));
  for (const name of ['.dsh-home', '.cache', 'node_modules', 'vendor', 'config', 'lib']) {
    fs.mkdirSync(path.join(workspace, name), { recursive: true });
  }
  fs.writeFileSync(path.join(workspace, 'package.json'), '{}\n');
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  assert.deepEqual(
    deployCliEntries(workspace).map(({ name }) => name).sort(),
    ['config', 'lib', 'package.json'],
  );
});

test('collectFiles deduplicates a linked package flattened to the same destination', (t) => {
  const fixture = makeFixture(t);
  linkPackage(fixture.source, fixture.shared, 'a');
  linkPackage(fixture.source, fixture.shared, 'b');

  const files = collectFiles(fixture.source, fixture.destination, false, true);
  const destinations = files.map(({ dest }) => path.relative(fixture.destination, dest)).sort();

  assert.deepEqual(
    destinations,
    [path.join('node_modules', 'shared', 'index.js'), path.join('node_modules', 'shared', 'package.json')],
  );
});

test('collectFiles keeps shipped preset SKILL.md while stripping other markdown', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-skills-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const source = path.join(workspace, 'source');
  const destination = path.join(workspace, 'destination');
  const skill = path.join(
    source,
    'apps',
    'cli',
    'config',
    'agent-presets',
    'cordis',
    'skills',
    'editing-cordis-compositions',
    'SKILL.md',
  );
  const readme = path.join(source, 'apps', 'cli', 'README.md');
  const preset = path.join(source, 'apps', 'cli', 'config', 'agent-presets', 'cordis', 'preset.yml');
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.mkdirSync(path.dirname(readme), { recursive: true });
  fs.writeFileSync(skill, '# editing cordis compositions\n');
  fs.writeFileSync(readme, '# cli docs\n');
  fs.writeFileSync(preset, 'id: cordis\n');

  const files = collectFiles(source, destination, false, true);
  const destinations = files.map(({ dest }) => path.relative(destination, dest)).sort();

  assert.deepEqual(
    destinations,
    [
      path.join('apps', 'cli', 'config', 'agent-presets', 'cordis', 'preset.yml'),
      path.join(
        'apps',
        'cli',
        'config',
        'agent-presets',
        'cordis',
        'skills',
        'editing-cordis-compositions',
        'SKILL.md',
      ),
    ],
  );
});

test('collectFiles keeps preset SKILL.md when rooted at the deploy config directory', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-deploy-skills-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const source = path.join(workspace, 'config');
  const destination = path.join(workspace, 'destination');
  const skill = path.join(
    source,
    'agent-presets',
    'cordis',
    'skills',
    'cordis-plugin-development',
    'SKILL.md',
  );
  const readme = path.join(source, 'README.md');
  const preset = path.join(source, 'agent-presets', 'cordis', 'preset.yml');
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, '# cordis plugin development\n');
  fs.writeFileSync(readme, '# config docs\n');
  fs.writeFileSync(preset, 'id: cordis\n');

  const files = collectFiles(source, destination, true, false);
  const destinations = files.map(({ dest }) => path.relative(destination, dest)).sort();

  assert.deepEqual(
    destinations,
    [
      path.join('agent-presets', 'cordis', 'preset.yml'),
      path.join('agent-presets', 'cordis', 'skills', 'cordis-plugin-development', 'SKILL.md'),
    ],
  );
});

test('collectFiles preserves a linked package copied to distinct destinations', (t) => {
  const fixture = makeFixture(t);
  linkPackage(fixture.source, fixture.shared, 'a');
  linkPackage(fixture.source, fixture.shared, 'b');

  const files = collectFiles(fixture.source, fixture.destination, false, false);
  const destinations = files.map(({ dest }) => path.relative(fixture.destination, dest)).sort();

  assert.deepEqual(
    destinations,
    [
      path.join('a', 'node_modules', 'shared', 'index.js'),
      path.join('a', 'node_modules', 'shared', 'package.json'),
      path.join('b', 'node_modules', 'shared', 'index.js'),
      path.join('b', 'node_modules', 'shared', 'package.json'),
    ],
  );
});

test('resolveDeployDir ignores local caches unless a deploy directory is explicit', () => {
  assert.equal(resolveDeployDir(undefined), null);
  assert.equal(resolveDeployDir(''), null);
  assert.equal(resolveDeployDir('off'), null);
  assert.equal(resolveDeployDir('.pack-release'), path.resolve('.pack-release'));
});

const { DESKTOP_PACKAGES } = require('../shared/harness-desktop-forks');

function writeDesktopForkPackages(root) {
  for (const pkg of DESKTOP_PACKAGES) {
    const dir = path.join(root, 'node_modules', ...pkg.name.split('/'));
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      `${JSON.stringify({ name: pkg.name, main: 'lib/index.js' })}\n`,
    );
    fs.writeFileSync(path.join(dir, 'lib', 'index.js'), 'export {}\n');
  }
}

function writeGhosttyTerminalPackage(root) {
  const base = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-user-terminal', 'lib');
  fs.mkdirSync(path.join(base, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(base, 'client.js'), 'export {}\n');
  for (const name of ['ghostty-vt.wasm', 'ghostty-write-pty.wasm', 'SymbolsNerdFontMono-Regular.woff2']) {
    fs.writeFileSync(path.join(base, 'assets', name), 'asset');
  }
}

function writeMcpSdk(root) {
  const sdk = path.join(root, 'node_modules', '@modelcontextprotocol', 'sdk');
  fs.mkdirSync(sdk, { recursive: true });
  fs.writeFileSync(path.join(sdk, 'package.json'), '{"name":"@modelcontextprotocol/sdk","version":"1.29.0"}\n');
}

function writeAjv(dir, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'ajv', version })}\n`);
}

function writePinRuntimeFiles(root) {
  const files = new Map([
    [path.join('apps', 'cli', 'lib', 'bin.js'), 'export {}\n'],
    [path.join('apps', 'web', 'dist', 'index.html'), '<!doctype html>\n'],
    [path.join('node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js'), 'export {}\n'],
    [path.join('node_modules', '@deepseek-ai', 'dsh-client-modules', 'lib', 'index.js'), 'export {}\n'],
    [
      path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-conversation', 'lib', 'client.js'),
      'export {}\n',
    ],
    [
      path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-chat', 'lib', 'client.js'),
      'conversation.chat.user-actions\n',
    ],
    [
      path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-message-edit', 'lib', 'client.js'),
      'conversation.chat.user-actions\n',
    ],
    [
      path.join('node_modules', '@deepseek-ai', 'dsh-api-session-controller', 'lib', 'index.js'),
      'fork accepts atSeq or beforeSeq\n',
    ],
    [path.join('node_modules', '@deepseek-ai', 'dsh-mcp-servers-file', 'lib', 'index.js'), 'export {}\n'],
    [path.join('node_modules', '@deepseek-ai', 'dsh-host-mcp-servers', 'lib', 'index.js'), 'export {}\n'],
    [path.join('node_modules', '@deepseek-ai', 'dsh-host-skill-inventory', 'lib', 'index.js'), 'export {}\n'],
    [path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-mcp', 'lib', 'index.js'), 'export {}\n'],
    [path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-mcp', 'lib', 'client.js'), 'export {}\n'],
    [path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-skills', 'lib', 'index.js'), 'export {}\n'],
    [path.join('node_modules', '@deepseek-ai', 'dsh-client-ui-settings-skills', 'lib', 'client.js'), 'export {}\n'],
  ]);
  for (const [relative, content] of files) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

test('assertHarnessRuntime accepts a complete compatible host', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePinRuntimeFiles(root);
  writeRuntimeVersions(root, RC7_PIN.npm);
  writeNodePtyPrebuild(root);
  writeDesktopForkPackages(root);
  writeGhosttyTerminalPackage(root);
  writeMcpSdk(root);
  writeAjv(path.join(root, 'node_modules', '@modelcontextprotocol', 'sdk', 'node_modules', 'ajv'), '8.17.1');

  assert.doesNotThrow(() => assertHarnessRuntime(root, RC7_PIN));
});

test('assertHarnessRuntime rejects a runtime missing a registered desktop fork package', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-fork-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePinRuntimeFiles(root);
  writeDesktopForkPackages(root);
  // A stale deploy dir from before the desktop-owned market shipped: the
  // package is absent while every older gate file still exists.
  fs.rmSync(
    path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-market'),
    { recursive: true, force: true },
  );
  writeRuntimeVersions(root, RC7_PIN.npm);
  writeNodePtyPrebuild(root);
  writeGhosttyTerminalPackage(root);

  assert.throws(
    () => assertHarnessRuntime(root, RC7_PIN),
    /dsh-client-ui-settings-market/,
  );
});

test('assertHarnessRuntime rejects a fork package whose runtime entry is missing', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-fork-entry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeDesktopForkPackages(root);
  fs.rmSync(
    path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-market', 'lib', 'index.js'),
    { force: true },
  );
  const { assertDesktopForkRuntime } = require('../../scripts/after-pack');
  assert.throws(
    () => assertDesktopForkRuntime(root),
    /dsh-client-ui-settings-market\/lib\/index\.js/,
  );
});

test('assertHarnessRuntime rejects a host missing Ghostty terminal assets', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-ghostty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePinRuntimeFiles(root);
  const terminalClient = path.join(root, 'node_modules', '@deepseek-ai', 'dsh-client-ui-user-terminal', 'lib', 'client.js');
  fs.mkdirSync(path.dirname(terminalClient), { recursive: true });
  fs.writeFileSync(terminalClient, 'export {}\n');
  writeRuntimeVersions(root, RC7_PIN.npm);
  writeNodePtyPrebuild(root);
  writeDesktopForkPackages(root);

  assert.throws(
    () => assertHarnessRuntime(root, RC7_PIN),
    /ghostty-vt\.wasm/,
  );
});

test('assertHarnessRuntime rejects a host missing MCP settings runtime', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-mcp-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePinRuntimeFiles(root);
  fs.rmSync(path.join(root, 'node_modules', '@deepseek-ai', 'dsh-mcp-servers-file'), { recursive: true, force: true });

  assert.throws(
    () => assertHarnessRuntime(root, RC7_PIN),
    /dsh-mcp-servers-file/,
  );
});

test('assertHarnessRuntime rejects stale deploy output before archiving', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-stale-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'apps', 'cli', 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps', 'web', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps', 'cli', 'lib', 'bin.js'), 'export {}\n');
  fs.writeFileSync(path.join(root, 'apps', 'web', 'dist', 'index.html'), '<!doctype html>\n');

  assert.throws(
    () => assertHarnessRuntime(root, RC7_PIN),
    /dsh-app-boot.*index\.js/,
  );
});

test('assertHarnessRuntime rejects pin.npm mismatch', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-pin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePinRuntimeFiles(root);
  writeRuntimeVersions(root, '0.1.0-rc.5');
  writeNodePtyPrebuild(root);
  writeDesktopForkPackages(root);
  writeGhosttyTerminalPackage(root);
  assert.throws(
    () => assertHarnessRuntime(root, { npm: '0.1.0-rc.7' }),
    /0\.1\.0-rc\.7/,
  );
});

test('assertHarnessRuntime rejects a missing node-pty prebuild', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-pty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePinRuntimeFiles(root);
  writeRuntimeVersions(root, RC7_PIN.npm);
  writeDesktopForkPackages(root);
  writeGhosttyTerminalPackage(root);
  assert.throws(
    () => assertHarnessRuntime(root, RC7_PIN),
    /node-pty/,
  );
});

test('resolveResourcesDir uses Contents/Resources inside the macOS .app', () => {
  const darwin = resolveResourcesDir({
    electronPlatformName: 'darwin',
    appOutDir: path.join('dist', 'mac-arm64'),
    packager: { appInfo: { productFilename: 'Deepseek-Harness-Desktop' } },
  });
  assert.equal(
    darwin,
    path.join('dist', 'mac-arm64', 'Deepseek-Harness-Desktop.app', 'Contents', 'Resources'),
  );
});

test('resolveResourcesDir prefers electron-builder getResourcesDir', () => {
  const expected = path.join('out', 'Resources');
  assert.equal(
    resolveResourcesDir({
      electronPlatformName: 'darwin',
      appOutDir: path.join('dist', 'mac'),
      packager: {
        getResourcesDir: (appOutDir) => {
          assert.equal(appOutDir, path.join('dist', 'mac'));
          return expected;
        },
      },
    }),
    expected,
  );
});

test('resolveResourcesDir uses the unpacked resources folder on Windows', () => {
  assert.equal(
    resolveResourcesDir({
      electronPlatformName: 'win32',
      appOutDir: path.join('dist', 'win-unpacked'),
    }),
    path.join('dist', 'win-unpacked', 'resources'),
  );
});

test('restoreVendoredPluginNodeModules copies dropped plugin node_modules', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-nm-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const projectDir = path.join(workspace, 'project');
  const resources = path.join(workspace, 'resources');
  const srcNm = path.join(projectDir, 'vendor', 'dshmarket', 'node_modules', 'undici');
  const destPkg = path.join(resources, 'vendor', 'dshmarket');
  fs.mkdirSync(srcNm, { recursive: true });
  fs.mkdirSync(destPkg, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'vendor', 'dshmarket', 'package.json'),
    `${JSON.stringify({ name: 'dshmarket', dependencies: { undici: '7.29.0' } })}\n`,
  );
  fs.writeFileSync(path.join(srcNm, 'package.json'), '{"name":"undici"}\n');
  fs.writeFileSync(
    path.join(destPkg, 'package.json'),
    `${JSON.stringify({ name: 'dshmarket', dependencies: { undici: '7.29.0' } })}\n`,
  );

  const result = restoreVendoredPluginNodeModules(projectDir, resources, 'dshmarket');
  assert.equal(result.restored, true);
  assertVendoredPluginRuntimeDeps(resources, 'dshmarket');
  assert.equal(
    fs.existsSync(path.join(destPkg, 'node_modules', 'undici', 'package.json')),
    true,
  );
});

test('assertVendoredPluginRuntimeDeps rejects a packaged plugin without its dependencies', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-missing-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dshmarket');
  fs.mkdirSync(destPkg, { recursive: true });
  fs.writeFileSync(
    path.join(destPkg, 'package.json'),
    `${JSON.stringify({ name: 'dshmarket', dependencies: { undici: '7.29.0' } })}\n`,
  );
  assert.throws(
    () => assertVendoredPluginRuntimeDeps(workspace, 'dshmarket'),
    /undici/,
  );
});

test('assertVendoredPluginRuntimeDeps rejects a dependency whose export file is missing', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-export-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dshmarket');
  const yamlDir = path.join(destPkg, 'node_modules', 'js-yaml');
  fs.mkdirSync(yamlDir, { recursive: true });
  fs.writeFileSync(
    path.join(destPkg, 'package.json'),
    `${JSON.stringify({ name: 'dshmarket', dependencies: { 'js-yaml': '4.1.1' } })}\n`,
  );
  fs.writeFileSync(path.join(yamlDir, 'package.json'), `${JSON.stringify({
    name: 'js-yaml',
    exports: { '.': { import: './dist/js-yaml.mjs', require: './index.js' } },
  })}\n`);
  fs.writeFileSync(path.join(yamlDir, 'index.js'), 'module.exports = {}\n');
  assert.throws(
    () => assertVendoredPluginRuntimeDeps(workspace, 'dshmarket'),
    /js-yaml\.mjs/,
  );
});

test('installPluginRuntimeDeps runs npm install when export files are missing', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-npm-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dshmarket');
  const yamlDir = path.join(destPkg, 'node_modules', 'js-yaml');
  fs.mkdirSync(yamlDir, { recursive: true });
  fs.writeFileSync(
    path.join(destPkg, 'package.json'),
    `${JSON.stringify({ name: 'dshmarket', dependencies: { 'js-yaml': '4.1.1' } })}\n`,
  );
  fs.writeFileSync(path.join(yamlDir, 'package.json'), `${JSON.stringify({
    name: 'js-yaml',
    exports: { '.': { import: './dist/js-yaml.mjs' } },
  })}\n`);
  let ran = '';
  const result = installPluginRuntimeDeps(destPkg, {
    skipIfComplete: true,
    run: (dir) => {
      ran = dir;
      fs.mkdirSync(path.join(dir, 'node_modules', 'js-yaml', 'dist'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'node_modules', 'js-yaml', 'dist', 'js-yaml.mjs'),
        'export default {}\n',
      );
    },
  });
  assert.equal(result.installed, true);
  assert.equal(ran, destPkg);
  assertVendoredPluginRuntimeDeps(workspace, 'dshmarket');
});

test('assertVendoredPluginRuntimeDeps accepts a hoisted nested dependency', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-hoist-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dshmarket');
  const yamlDir = path.join(destPkg, 'node_modules', 'js-yaml');
  const argparseDir = path.join(destPkg, 'node_modules', 'argparse');
  fs.mkdirSync(path.join(yamlDir, 'dist'), { recursive: true });
  fs.mkdirSync(argparseDir, { recursive: true });
  fs.writeFileSync(
    path.join(destPkg, 'package.json'),
    `${JSON.stringify({ name: 'dshmarket', dependencies: { 'js-yaml': '4.1.1' } })}\n`,
  );
  fs.writeFileSync(path.join(yamlDir, 'package.json'), `${JSON.stringify({
    name: 'js-yaml',
    exports: { '.': { import: './dist/js-yaml.mjs' } },
    dependencies: { argparse: '2.0.1' },
  })}\n`);
  fs.writeFileSync(path.join(yamlDir, 'dist', 'js-yaml.mjs'), 'export default {}\n');
  fs.writeFileSync(
    path.join(argparseDir, 'package.json'),
    `${JSON.stringify({ name: 'argparse', main: './index.js' })}\n`,
  );
  fs.writeFileSync(path.join(argparseDir, 'index.js'), 'module.exports = {}\n');
  assert.doesNotThrow(() => assertVendoredPluginRuntimeDeps(workspace, 'dshmarket'));
});

test('installPluginRuntimeDeps skipIfComplete does not run npm when export files exist', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-plugin-skip-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const destPkg = path.join(workspace, 'vendor', 'dshmarket');
  const yamlDir = path.join(destPkg, 'node_modules', 'js-yaml', 'dist');
  fs.mkdirSync(yamlDir, { recursive: true });
  fs.writeFileSync(
    path.join(destPkg, 'package.json'),
    `${JSON.stringify({ name: 'dshmarket', dependencies: { 'js-yaml': '4.1.1' } })}\n`,
  );
  fs.writeFileSync(
    path.join(destPkg, 'node_modules', 'js-yaml', 'package.json'),
    `${JSON.stringify({
      name: 'js-yaml',
      exports: { '.': { import: './dist/js-yaml.mjs' } },
    })}\n`,
  );
  fs.writeFileSync(path.join(yamlDir, 'js-yaml.mjs'), 'export default {}\n');
  let ran = false;
  const result = installPluginRuntimeDeps(destPkg, {
    skipIfComplete: true,
    run: () => {
      ran = true;
    },
  });
  assert.equal(result.installed, false);
  assert.equal(ran, false);
});

test('collectPnpmFlattenFiles nests ajv@8 under MCP SDK when top-level is ajv@6', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-ajv-flatten-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const nmDest = path.join(workspace, 'dest', 'node_modules');
  const storeDir = path.join(workspace, 'src', 'node_modules', '.pnpm');
  const sdkEntry = path.join(storeDir, '@modelcontextprotocol+sdk@1.29.0', 'node_modules');
  const sdkDir = path.join(sdkEntry, '@modelcontextprotocol', 'sdk');
  const siblingAjv = path.join(sdkEntry, 'ajv');
  fs.mkdirSync(sdkDir, { recursive: true });
  fs.writeFileSync(path.join(sdkDir, 'package.json'), '{"name":"@modelcontextprotocol/sdk","version":"1.29.0"}\n');
  fs.writeFileSync(path.join(sdkDir, 'index.js'), 'module.exports = {}\n');
  writeAjv(siblingAjv, '8.17.1');
  fs.writeFileSync(path.join(siblingAjv, 'index.js'), 'module.exports = 8\n');
  writeAjv(path.join(nmDest, 'ajv'), '6.15.0');
  fs.writeFileSync(path.join(nmDest, 'ajv', 'index.js'), 'module.exports = 6\n');

  const files = collectPnpmFlattenFiles(storeDir, nmDest);
  for (const item of files) {
    fs.mkdirSync(path.dirname(item.dest), { recursive: true });
    fs.copyFileSync(item.src, item.dest);
  }

  const nested = JSON.parse(fs.readFileSync(path.join(
    nmDest, '@modelcontextprotocol', 'sdk', 'node_modules', 'ajv', 'package.json',
  ), 'utf8'));
  const top = JSON.parse(fs.readFileSync(path.join(nmDest, 'ajv', 'package.json'), 'utf8'));
  assert.equal(nested.version, '8.17.1');
  assert.equal(top.version, '6.15.0');
});

test('repairFlattenedVersionIsolation restores SDK ajv@8 after flat copy', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-ajv-repair-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const harnessSrc = path.join(workspace, 'src');
  const harnessDest = path.join(workspace, 'dest');
  const storeDir = path.join(harnessSrc, 'node_modules', '.pnpm');
  const sdkEntry = path.join(storeDir, '@modelcontextprotocol+sdk@1.29.0', 'node_modules');
  const sdkDir = path.join(sdkEntry, '@modelcontextprotocol', 'sdk');
  const siblingAjv = path.join(sdkEntry, 'ajv');
  fs.mkdirSync(sdkDir, { recursive: true });
  fs.writeFileSync(path.join(sdkDir, 'package.json'), '{"name":"@modelcontextprotocol/sdk","version":"1.29.0"}\n');
  fs.writeFileSync(path.join(sdkDir, 'index.js'), 'module.exports = {}\n');
  writeAjv(siblingAjv, '8.17.1');
  fs.writeFileSync(path.join(siblingAjv, 'index.js'), 'module.exports = 8\n');

  const flatDestNm = path.join(harnessDest, 'node_modules');
  fs.mkdirSync(path.join(flatDestNm, '@modelcontextprotocol', 'sdk'), { recursive: true });
  fs.copyFileSync(path.join(sdkDir, 'package.json'), path.join(flatDestNm, '@modelcontextprotocol', 'sdk', 'package.json'));
  fs.copyFileSync(path.join(sdkDir, 'index.js'), path.join(flatDestNm, '@modelcontextprotocol', 'sdk', 'index.js'));
  writeAjv(path.join(flatDestNm, 'ajv'), '6.15.0');
  fs.writeFileSync(path.join(flatDestNm, 'ajv', 'index.js'), 'module.exports = 6\n');

  await repairFlattenedVersionIsolation(harnessSrc, harnessDest);

  const nested = JSON.parse(fs.readFileSync(path.join(
    flatDestNm, '@modelcontextprotocol', 'sdk', 'node_modules', 'ajv', 'package.json',
  ), 'utf8'));
  assert.equal(nested.version, '8.17.1');
});

test('assertHarnessRuntime rejects MCP SDK resolving ajv major 6', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-ajv6-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writePinRuntimeFiles(root);
  writeRuntimeVersions(root, RC7_PIN.npm);
  writeNodePtyPrebuild(root);
  writeDesktopForkPackages(root);
  writeGhosttyTerminalPackage(root);
  writeMcpSdk(root);
  writeAjv(path.join(root, 'node_modules', 'ajv'), '6.15.0');

  assert.throws(
    () => assertHarnessRuntime(root, RC7_PIN),
    /拍平丢掉了 SDK 嵌套 ajv@8/,
  );
});

function writeCommanderCjs(dir, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: 'commander',
    version,
    main: 'index.js',
  })}\n`);
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = { Command: class Command {} };\n');
}

function writeCommanderEsm(dir, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: 'commander',
    version,
    type: 'module',
    exports: { '.': { import: './index.js', require: './index.js' } },
  })}\n`);
  fs.writeFileSync(path.join(dir, 'index.js'), 'export class Command {}\n');
}

test('repairFlattenedCommanderEsm replaces CJS top-level commander with store ESM', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-commander-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const harnessSrc = path.join(workspace, 'src');
  const harnessDest = path.join(workspace, 'dest');
  const storeDir = path.join(harnessSrc, 'node_modules', '.pnpm');
  writeCommanderCjs(path.join(storeDir, 'commander@2.20.3', 'node_modules', 'commander'), '2.20.3');
  writeCommanderEsm(path.join(storeDir, 'commander@15.0.1', 'node_modules', 'commander'), '15.0.1');
  writeCommanderCjs(path.join(harnessDest, 'node_modules', 'commander'), '2.20.3');

  const copied = await repairFlattenedCommanderEsm(harnessSrc, harnessDest);
  assert.ok(copied > 0);
  const dest = JSON.parse(fs.readFileSync(
    path.join(harnessDest, 'node_modules', 'commander', 'package.json'),
    'utf8',
  ));
  assert.equal(dest.version, '15.0.1');
  assert.equal(dest.type, 'module');
});

test('repairFlattenedCommanderEsm leaves an already-ESM commander in place', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'after-pack-commander-ok-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const harnessSrc = path.join(workspace, 'src');
  const harnessDest = path.join(workspace, 'dest');
  writeCommanderEsm(path.join(harnessSrc, 'node_modules', '.pnpm', 'commander@14.0.0', 'node_modules', 'commander'), '14.0.0');
  writeCommanderEsm(path.join(harnessDest, 'node_modules', 'commander'), '15.0.1');
  fs.writeFileSync(path.join(harnessDest, 'node_modules', 'commander', 'marker.txt'), 'keep\n');

  const copied = await repairFlattenedCommanderEsm(harnessSrc, harnessDest);
  assert.equal(copied, 0);
  const dest = JSON.parse(fs.readFileSync(
    path.join(harnessDest, 'node_modules', 'commander', 'package.json'),
    'utf8',
  ));
  assert.equal(dest.version, '15.0.1');
  assert.equal(
    fs.readFileSync(path.join(harnessDest, 'node_modules', 'commander', 'marker.txt'), 'utf8'),
    'keep\n',
  );
});
