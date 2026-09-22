const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { watchWorkspaceRegistrations, WORKSPACE_REGISTRY_FILE } = require('./git-workspace-watch');

function makeStoragesDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ws-watch-'));
}

function waitFor(check, { timeoutMs = 5_000, stepMs = 25 } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      if (check()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('waitFor timed out'));
        return;
      }
      setTimeout(poll, stepMs);
    };
    poll();
  });
}

function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

test('fires once (debounced) when workspace.json is created', async () => {
  const dir = makeStoragesDir();
  let fired = 0;
  const stop = watchWorkspaceRegistrations(() => { fired += 1; }, {
    storagesDir: dir,
    debounceMs: 20,
  });
  try {
    fs.writeFileSync(path.join(dir, WORKSPACE_REGISTRY_FILE), '{"a":1}');
    await waitFor(() => fired >= 1);
    assert.equal(fired, 1);
  } finally {
    stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fires again when the registry is rewritten via temp-file rename', async () => {
  const dir = makeStoragesDir();
  fs.writeFileSync(path.join(dir, WORKSPACE_REGISTRY_FILE), '{"a":1}');
  let fired = 0;
  const stop = watchWorkspaceRegistrations(() => { fired += 1; }, {
    storagesDir: dir,
    debounceMs: 20,
  });
  try {
    // dsh-workspace persists through write-temp-then-rename; the directory
    // watch must survive the registry file's inode changing.
    const temp = path.join(dir, `${WORKSPACE_REGISTRY_FILE}.tmp`);
    fs.writeFileSync(temp, '{"a":2}');
    fs.renameSync(temp, path.join(dir, WORKSPACE_REGISTRY_FILE));
    await waitFor(() => fired >= 1);
    fired = 0;
    fs.writeFileSync(path.join(dir, WORKSPACE_REGISTRY_FILE), '{"a":3}');
    await waitFor(() => fired >= 1);
  } finally {
    stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores writes to other files in storages', async () => {
  const dir = makeStoragesDir();
  let fired = 0;
  const stop = watchWorkspaceRegistrations(() => { fired += 1; }, {
    storagesDir: dir,
    debounceMs: 10,
  });
  try {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{}');
    await delay(120);
    assert.equal(fired, 0);
  } finally {
    stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('retries until the storages directory exists, then signals', async () => {
  const parent = makeStoragesDir();
  const dir = path.join(parent, 'storages');
  let fired = 0;
  const stop = watchWorkspaceRegistrations(() => { fired += 1; }, {
    storagesDir: dir,
    retryMs: 30,
    debounceMs: 10,
  });
  try {
    await delay(60);
    assert.equal(fired, 0);
    fs.mkdirSync(dir);
    await waitFor(() => {
      // Keep touching the registry until a re-armed watch observes it: the
      // mkdir can land between two retry ticks.
      fs.writeFileSync(path.join(dir, WORKSPACE_REGISTRY_FILE), `{"t":${Date.now()}}`);
      return fired >= 1;
    });
  } finally {
    stop();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('a single registry write inside the unwatched retry gap still signals after arming', async () => {
  const parent = makeStoragesDir();
  const dir = path.join(parent, 'storages');
  let fired = 0;
  const stop = watchWorkspaceRegistrations(() => { fired += 1; }, {
    storagesDir: dir,
    retryMs: 80,
    debounceMs: 10,
  });
  try {
    // Directory and the ONLY registry write both land while the watcher is
    // still in its retry loop; the arm itself must recover the signal.
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, WORKSPACE_REGISTRY_FILE), '{"a":1}');
    await waitFor(() => fired >= 1);
  } finally {
    stop();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('arming with an already-existing registry fires the initial signal and settles', async () => {
  const dir = makeStoragesDir();
  fs.writeFileSync(path.join(dir, WORKSPACE_REGISTRY_FILE), '{"a":1}');
  let fired = 0;
  const stop = watchWorkspaceRegistrations(() => { fired += 1; }, {
    storagesDir: dir,
    debounceMs: 10,
  });
  try {
    await waitFor(() => fired >= 1);
    // macOS FSEvents (libuv's shared stream) may replay the pre-arm write as
    // one real watch event after this test's tiny debounce already fired; the
    // production 200ms debounce coalesces that replay. The contract here is
    // recovery-plus-quiescence, not an exact count under a 10ms debounce.
    await delay(200);
    const settled = fired;
    assert.ok(settled <= 2, `expected initial signal plus at most one platform replay, got ${settled}`);
    await delay(150);
    assert.equal(fired, settled);
  } finally {
    stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a null storages dir (no desktop home) never arms and stop() is safe', async () => {
  let fired = 0;
  const stop = watchWorkspaceRegistrations(() => { fired += 1; }, {
    storagesDir: null,
    retryMs: 10,
    debounceMs: 10,
  });
  await delay(40);
  assert.equal(fired, 0);
  stop();
});

test('stop() suppresses a change that was still inside the debounce window', async () => {
  const dir = makeStoragesDir();
  let fired = 0;
  const stop = watchWorkspaceRegistrations(() => { fired += 1; }, {
    storagesDir: dir,
    debounceMs: 100,
  });
  try {
    fs.writeFileSync(path.join(dir, WORKSPACE_REGISTRY_FILE), '{"a":1}');
    await delay(20);
    stop();
    await delay(150);
    assert.equal(fired, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
