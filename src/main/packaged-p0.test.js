'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PACKAGED_P0_STEPS, runPackagedP0 } = require('./packaged-p0');

function step(result, name) {
  return result.steps.find((row) => row.name === name);
}

function passingDeps(overrides = {}) {
  const siblingPath = overrides.siblingPath || fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-p0-sib-'));
  const userData = overrides.userData || fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-p0-ud-'));
  const appVersion = overrides.appVersion || '0.2.7';
  const stampPath = path.join(userData, 'runtime', appVersion, '.dshd-runtime.json');
  fs.mkdirSync(path.dirname(stampPath), { recursive: true });
  if (overrides.stampExists !== false) {
    fs.writeFileSync(stampPath, '{"sha":"x","npm":"0.1.1-rc.1","archiveBytes":1}\n');
  }
  return {
    siblingPath,
    gitBranchList: async (cwd) => {
      assert.equal(cwd, siblingPath);
      return {
        ok: true,
        branches: [
          { name: 'master', isCurrent: true },
          { name: '111', isCurrent: false },
        ],
      };
    },
    pty: {
      create: async (input) => {
        assert.equal(input.cwd, siblingPath);
        return { id: 'pty-sib' };
      },
      kill: async () => {},
    },
    fetch: async (url) => {
      assert.match(String(url), /\/plugins\/@deepseek-ai\/dsh-client-ui-user-terminal\/assets\/ghostty-vt\.wasm$/);
      return { status: 200 };
    },
    host: '127.0.0.1',
    port: 3080,
    userData,
    appVersion,
    bootLogs: ['[dsh] Web UI 就绪'],
    ...overrides,
    siblingPath,
    userData,
    appVersion,
  };
}

test('packaged P0 steps cover sibling git, PTY, wasm, no-open, and stamp', () => {
  assert.deepEqual(PACKAGED_P0_STEPS, [
    'packaged.sibling.exists',
    'packaged.git.branchList',
    'packaged.pty.create',
    'packaged.ghostty.wasm',
    'packaged.boot.noOpen',
    'packaged.runtime.stamp',
  ]);
});

test('runPackagedP0 passes sibling git, PTY, wasm 200, no --no-open, and stamp', async () => {
  const deps = passingDeps();
  try {
    const result = await runPackagedP0(deps);
    assert.equal(result.ok, true);
    for (const name of PACKAGED_P0_STEPS) {
      const row = step(result, name);
      assert.ok(row, name);
      assert.equal(row.ok, true, `${name}: ${row.detail}`);
    }
  } finally {
    fs.rmSync(deps.siblingPath, { recursive: true, force: true });
    fs.rmSync(deps.userData, { recursive: true, force: true });
  }
});

test('unregistered sibling fails git or pty and overall ok is false', async () => {
  const siblingPath = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-p0-unreg-'));
  const deps = passingDeps({
    siblingPath,
    gitBranchList: async () => ({ ok: false, message: 'Git status is unavailable.' }),
    pty: {
      create: async () => {
        throw new Error('ptyCreate requires a project cwd');
      },
      kill: async () => {},
    },
  });
  try {
    const result = await runPackagedP0(deps);
    assert.equal(result.ok, false);
    assert.equal(step(result, 'packaged.sibling.exists').ok, true);
    assert.equal(step(result, 'packaged.git.branchList').ok, false);
    assert.equal(step(result, 'packaged.pty.create').ok, false);
    assert.match(step(result, 'packaged.pty.create').detail, /ptyCreate requires a project cwd/);
  } finally {
    fs.rmSync(siblingPath, { recursive: true, force: true });
    fs.rmSync(deps.userData, { recursive: true, force: true });
  }
});

test('gitBranchList without a current branch fails closed', async () => {
  const deps = passingDeps({
    gitBranchList: async () => ({ ok: true, branches: [{ name: 'master', isCurrent: false }] }),
  });
  try {
    const result = await runPackagedP0(deps);
    assert.equal(result.ok, false);
    assert.equal(step(result, 'packaged.git.branchList').ok, false);
  } finally {
    fs.rmSync(deps.siblingPath, { recursive: true, force: true });
    fs.rmSync(deps.userData, { recursive: true, force: true });
  }
});

test('missing sibling fails closed', async () => {
  const deps = passingDeps({
    siblingPath: path.join(os.tmpdir(), `dsh-p0-missing-${Date.now()}`),
  });
  try {
    const result = await runPackagedP0(deps);
    assert.equal(result.ok, false);
    assert.equal(step(result, 'packaged.sibling.exists').ok, false);
  } finally {
    fs.rmSync(deps.userData, { recursive: true, force: true });
  }
});

test('ghostty wasm not 200 fails closed', async () => {
  const deps = passingDeps({
    fetch: async () => ({ status: 404 }),
  });
  try {
    const result = await runPackagedP0(deps);
    assert.equal(result.ok, false);
    assert.equal(step(result, 'packaged.ghostty.wasm').ok, false);
  } finally {
    fs.rmSync(deps.siblingPath, { recursive: true, force: true });
    fs.rmSync(deps.userData, { recursive: true, force: true });
  }
});

test('boot logs with unknown option --no-open fail closed', async () => {
  const deps = passingDeps({
    bootLogs: ["error: unknown option '--no-open'"],
  });
  try {
    const result = await runPackagedP0(deps);
    assert.equal(result.ok, false);
    assert.equal(step(result, 'packaged.boot.noOpen').ok, false);
  } finally {
    fs.rmSync(deps.siblingPath, { recursive: true, force: true });
    fs.rmSync(deps.userData, { recursive: true, force: true });
  }
});

test('missing packaged runtime stamp after start fails closed', async () => {
  const deps = passingDeps({ stampExists: false });
  try {
    const result = await runPackagedP0(deps);
    assert.equal(result.ok, false);
    assert.equal(step(result, 'packaged.runtime.stamp').ok, false);
  } finally {
    fs.rmSync(deps.siblingPath, { recursive: true, force: true });
    fs.rmSync(deps.userData, { recursive: true, force: true });
  }
});

test('packaged P0 is wired into smoke when DSH_SMOKE_SIBLING is set', () => {
  const smoke = fs.readFileSync(path.join(__dirname, 'smoke', 'index.js'), 'utf8');
  assert.match(smoke, /runPackagedP0/);
  assert.match(smoke, /DSH_SMOKE_SIBLING/);
  assert.match(smoke, /packagedP0/);
  assert.doesNotMatch(smoke, /DSH_QA === '1' \|\| process\.env\.DSH_SMOKE_SIBLING/);
});

test('qa:packaged is a local rehearsal script and not a GitHub Release job', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['qa:packaged'], 'node scripts/run-packaged-p0.mjs');
  // smoke:packaged IS the windows release acceptance gate (ci-isolation
  // pins its placement); the sibling-repo P0 drill stays a local rehearsal.
  const release = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'release.yml'), 'utf8');
  assert.doesNotMatch(release, /\bqa:packaged\b/);
  const runner = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'run-packaged-p0.mjs'), 'utf8');
  assert.match(runner, /DSH_SMOKE_SIBLING/);
  assert.match(runner, /0\.1\.0-rc\.7/);
  assert.match(runner, /\.dshd-runtime\.json/);
  assert.match(runner, /ws-p0/);
  assert.match(runner, /sessionIds/);
  assert.match(runner, /createdAt/);
  assert.match(runner, /Quit Deepseek-Harness-Desktop\.exe first/);
  assert.match(runner, /npm run dist/);
  const sourceQa = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'run-source-qa.mjs'), 'utf8');
  assert.doesNotMatch(sourceQa, /DSH_SMOKE_SIBLING/);
});
