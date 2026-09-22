'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  emptyInstallResult,
  isValidGithubSpec,
  isValidPackageName,
  normalizeAllowBuilds,
  normalizeInstallResult,
  renderInstall,
  executeInstallDshPlugin,
} = require('./install-dsh-plugin-client');

test('github install specs use a bounded owner/repo/ref whitelist', () => {
  assert.equal(isValidGithubSpec('github:owner/repo'), true);
  assert.equal(isValidGithubSpec('github:owner/repo#feature/one'), true);
  for (const value of [
    'github:owner/repo#../../main',
    'github:owner/repo#main@{1}',
    'github:-owner/repo',
    'github:owner/repo.',
    'github:owner/repo#main;calc',
  ]) {
    assert.equal(isValidGithubSpec(value), false, value);
  }
});

test('allowBuilds accepts package, github.com/owner/repo, and name@git+https keys', () => {
  assert.deepEqual(normalizeAllowBuilds([
    '@scope/package',
    'github.com/owner/repo',
    '@scope/package',
    'dsh-loop@git+https://github.com/owner/dsh-loop.git',
  ]), ['@scope/package', 'github.com/owner/repo', 'dsh-loop@git+https://github.com/owner/dsh-loop.git']);
  for (const value of [
    ['../prepare'],
    ['https://github.com/owner/repo'],
    ['good-package\nmalicious: true'],
    [{ package: 'good-package' }],
  ]) {
    assert.equal(normalizeAllowBuilds(value), null);
  }
});

test('package names reject shell syntax, paths, URLs, and extra arguments', () => {
  assert.equal(isValidPackageName('@dsh-external/dsh-loop'), true);
  assert.equal(isValidPackageName('plain-package'), true);
  for (const value of [
    'pkg;calc',
    'pkg && calc',
    '--global',
    '../package',
    'https://example.com/package',
  ]) {
    assert.equal(isValidPackageName(value), false, value);
  }
});

test('empty spec fails before contacting the control endpoint', async () => {
  const request = async () => {
    throw new Error('should not fetch');
  };
  const result = await executeInstallDshPlugin({ url: 'http://127.0.0.1:1', token: 't' }, '  ', [], request);
  assert.deepEqual(result, emptyInstallResult('missing install spec'));
});

test('non-github specs fail client-side before contacting the control endpoint', async () => {
  const request = async () => {
    throw new Error('should not fetch');
  };
  const invalid = ['lodash', 'file:../local', 'https://git.example/x.git', 'github:owner', 'github:owner/repo#sha#extra'];
  for (const spec of invalid) {
    const result = await executeInstallDshPlugin({ url: 'http://127.0.0.1:1', token: 't' }, spec, [], request);
    assert.equal(result.ok, false, spec);
    assert.equal(result.restarting, false, spec);
    assert.match(result.error, /github:owner\/repo/, spec);
  }
});

test('invalid allowBuilds fails before contacting the control endpoint', async () => {
  let requested = false;
  const result = await executeInstallDshPlugin(
    { url: 'http://127.0.0.1:1', token: 't' },
    'github:owner/repo',
    ['../prepare'],
    async () => {
      requested = true;
      return { ok: true };
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /allowBuilds/);
  assert.equal(requested, false);
});

test('needsAllowBuilds is a canonical result and does not mark restarting', async () => {
  const result = await executeInstallDshPlugin(
    { url: 'http://127.0.0.1:1', token: 't' },
    'github:owner/repo#abc',
    ['github.com/owner/repo'],
    async (_url, _token, spec, allowBuilds) => ({
      ok: false,
      needsAllowBuilds: true,
      allowBuilds,
      spec,
      error: '需要允许该插件在本机执行构建脚本',
      log: 'Ignored build scripts',
    }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.needsAllowBuilds, true);
  assert.deepEqual(result.allowBuilds, ['github.com/owner/repo']);
  assert.equal(result.restarting, false);
  assert.match(renderInstall(result), /retry install_dsh_plugin with allowBuilds: github.com\/owner\/repo/);
});

test('a successful install reports restarting and keeps the pinned spec', async () => {
  const result = normalizeInstallResult({
    ok: true,
    spec: 'github:owner/repo#deadbeef',
    log: 'added',
  }, 'github:owner/repo');
  assert.equal(result.ok, true);
  assert.equal(result.spec, 'github:owner/repo#deadbeef');
  assert.equal(result.restarting, true);
  assert.match(renderInstall(result), /Installed github:owner\/repo#deadbeef/);
});

test('a dropped-plugin error stays a failure without restart', () => {
  const result = normalizeInstallResult({
    ok: false,
    error: '该插件已退役，不再提供安装',
    spec: 'github:x/dsh-genui',
  }, 'github:x/dsh-genui');
  assert.equal(result.restarting, false);
  assert.match(renderInstall(result), /Install failed/);
});
