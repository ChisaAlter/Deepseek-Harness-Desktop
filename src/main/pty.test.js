const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkspaceAuthority } = require('./workspace-authority');
const {
  BACKEND_UNAVAILABLE,
  createPtyController,
  registerPtyIpc,
  setWorkspaceAuthority,
  defaultShell,
  defaultShellArgs,
  ptySpawnOptions,
  createTerminalSpawnEnv,
  resolveShellCandidates,
} = require('./pty.js');
const { setDesktopDshHome, clearDesktopDshHome } = require('../shared/dsh-home');

// One shared workspace root for the whole suite; cwd checks resolve inside it.
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pty-ws-'));
setWorkspaceAuthority(createWorkspaceAuthority({ workspace: ws }));

function fakeSpawn() {
  return ({ onData, onExit }) => ({
    write(data) {
      onData(data);
    },
    resize() {},
    kill() {
      onExit(0);
    },
  });
}

test('ptyCreate write echoes through onPtyData then ptyKill emits exit', async () => {
  const events = [];
  const pty = createPtyController({
    spawn: fakeSpawn(),
    emit(channel, payload) {
      events.push({ channel, payload });
    },
  });

  const created = await pty.create({ cwd: ws });
  assert.equal(typeof created.id, 'string');
  assert.ok(created.id.length > 0);

  await pty.write(created.id, 'echo');
  assert.deepEqual(
    events.filter((event) => event.channel === 'shell:pty-data'),
    [{ channel: 'shell:pty-data', payload: { id: created.id, data: 'echo' } }],
  );

  await pty.kill(created.id);
  assert.deepEqual(
    events.filter((event) => event.channel === 'shell:pty-exit'),
    [{ channel: 'shell:pty-exit', payload: { id: created.id, code: 0 } }],
  );
});

test('ptyCreate accepts a second authorized root and rejects an outsider', async () => {
  const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pty-extra-'));
  const outsider = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pty-out-'));
  setWorkspaceAuthority(createWorkspaceAuthority({
    workspace: ws,
    extraWorkspaces: [extra],
  }));
  try {
    const pty = createPtyController({ spawn: fakeSpawn(), emit() {} });
    const created = await pty.create({ cwd: extra });
    assert.equal(typeof created.id, 'string');
    await assert.rejects(() => pty.create({ cwd: outsider }), /cwd/);
  } finally {
    setWorkspaceAuthority(createWorkspaceAuthority({ workspace: ws }));
    fs.rmSync(extra, { recursive: true, force: true });
    fs.rmSync(outsider, { recursive: true, force: true });
  }
});

test('ptyCreate rejects a missing project cwd', async () => {
  const pty = createPtyController({ spawn: fakeSpawn(), emit() {} });
  await assert.rejects(() => pty.create({ cwd: '' }), /cwd/);
  await assert.rejects(() => pty.create({}), /cwd/);
});

test('Windows PTY spawn uses pwsh without the login banner', () => {
  if (process.platform !== 'win32') return;
  assert.equal(defaultShell(), 'pwsh.exe');
  assert.deepEqual(defaultShellArgs(), ['-NoLogo']);
});

test('createPtyController does not load node-pty until create', () => {
  assert.doesNotThrow(() => createPtyController({ emit() {} }));
});

test('registerPtyIpc succeeds when the PTY backend is unavailable', async () => {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, fn) {
      handlers.set(channel, fn);
    },
  };
  const pty = createPtyController({ spawn: null, emit() {} });
  assert.doesNotThrow(() => registerPtyIpc(ipcMain, pty));
  assert.equal(typeof handlers.get('shell:pty-create'), 'function');
  assert.equal(typeof handlers.get('shell:pty-write'), 'function');
  assert.equal(typeof handlers.get('shell:pty-resize'), 'function');
  assert.equal(typeof handlers.get('shell:pty-kill'), 'function');
  await assert.rejects(
    () => pty.create({ cwd: ws }),
    { message: BACKEND_UNAVAILABLE },
  );
});

test('ptyCreate maps a throwing spawn factory to the stable unavailable result', async () => {
  const pty = createPtyController({
    spawn() {
      throw new Error('node-pty is not available');
    },
    emit() {},
  });
  await assert.rejects(
    () => pty.create({ cwd: ws }),
    { message: BACKEND_UNAVAILABLE },
  );
});

test('killAll tears down every session and clears the table', async () => {
  const pty = createPtyController({ spawn: fakeSpawn(), emit() {} });
  const a = await pty.create({ cwd: ws });
  const b = await pty.create({ cwd: ws });
  pty.killAll();
  await assert.rejects(() => pty.write(a.id, 'x'), /unknown pty id/);
  await assert.rejects(() => pty.write(b.id, 'x'), /unknown pty id/);
});

test('registerPtyIpc returns the live controller for lifecycle wiring', () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const pty = createPtyController({ spawn: fakeSpawn(), emit() {} });
  const returned = registerPtyIpc(ipcMain, pty);
  assert.equal(returned, pty);
});

test('PTY event observers receive output and can unsubscribe', async () => {
  const observed = [];
  const pty = createPtyController({ spawn: fakeSpawn(), emit() {} });
  const unsubscribe = pty.onEvent((channel, payload) => {
    observed.push({ channel, payload });
  });
  const created = await pty.create({ cwd: ws });
  await pty.write(created.id, 'marker');
  unsubscribe();
  await pty.write(created.id, 'ignored');
  await pty.kill(created.id);

  assert.deepEqual(observed, [
    { channel: 'shell:pty-data', payload: { id: created.id, data: 'marker' } },
  ]);
});

test('Windows PTY spawn matches NodePtyAdapter (name, no useConpty, no TERM overwrite)', () => {
  const leftoverEnvKey = ['T', '3CODE_BAR'].join('');
  const options = ptySpawnOptions({ cwd: ws, cols: 100, rows: 30 }, 'win32', {
    TERM: 'from-host',
    PORT: '3080',
    ELECTRON_RUN_AS_NODE: '1',
    VITE_FOO: 'x',
    [leftoverEnvKey]: 'y',
    Path: 'C:\\Windows',
  });
  assert.equal(options.name, 'xterm-color');
  assert.equal('useConpty' in options, false);
  assert.equal('useConptyDll' in options, false);
  assert.equal(options.cols, 100);
  assert.equal(options.rows, 30);
  assert.equal(options.env.TERM, 'from-host');
  assert.equal('PORT' in options.env, false);
  assert.equal('ELECTRON_RUN_AS_NODE' in options.env, false);
  assert.equal('VITE_FOO' in options.env, false);
  assert.equal(leftoverEnvKey in options.env, false);
  assert.equal(options.env.Path, 'C:\\Windows');
  const unix = ptySpawnOptions({ cwd: ws, cols: 80, rows: 24 }, 'linux', { TERM: 'xterm' });
  assert.equal(unix.name, 'xterm-256color');
  assert.equal(unix.env.TERM, 'xterm');
  assert.equal('useConpty' in unix, false);
  const defaults = ptySpawnOptions({ cwd: ws }, 'win32', {});
  assert.equal(defaults.cols, 120);
  assert.equal(defaults.rows, 30);
  assert.equal('TERM' in defaults.env, false);
  const electronWin = ptySpawnOptions({ cwd: ws }, 'win32', { TERM: 'dumb', Path: 'C:\\Windows' });
  assert.equal('TERM' in electronWin.env, false);
});

test('createTerminalSpawnEnv copies overlay env and AppImage scrub', () => {
  const env = createTerminalSpawnEnv(
    {
      PATH: '/tmp/.mount_App/usr/bin:/usr/bin',
      APPIMAGE: '/tmp/App.AppImage',
      APPDIR: '/tmp/.mount_App',
      ARGV0: 'App',
      KEEP: 'yes',
    },
    { EXTRA: '1' },
  );
  assert.equal(env.KEEP, 'yes');
  assert.equal(env.EXTRA, '1');
  assert.equal(env.PATH, '/usr/bin');
  assert.equal('APPIMAGE' in env, false);
  assert.equal('APPDIR' in env, false);
  assert.equal('ARGV0' in env, false);
});

test('terminal spawn env does not inject the desktop DSH_HOME', () => {
  const desktopHome = path.join(os.tmpdir(), 'desktop-dsh-home');
  setDesktopDshHome(desktopHome);
  try {
    const env = createTerminalSpawnEnv({ PATH: '/usr/bin', KEEP: 'yes' });
    assert.equal(env.KEEP, 'yes');
    assert.equal('DSH_HOME' in env, false);
  } finally {
    clearDesktopDshHome();
  }
});

test('resolveShellCandidates copies Windows and Unix lists', () => {
  const win = resolveShellCandidates(() => 'pwsh.exe', 'win32', {
    SystemRoot: 'C:\\Windows',
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
  });
  assert.deepEqual(win.map((candidate) => candidate.shell), [
    'pwsh.exe',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    'powershell.exe',
    'C:\\Windows\\System32\\cmd.exe',
    'cmd.exe',
  ]);
  assert.deepEqual(win[0].args, ['-NoLogo']);
  const unix = resolveShellCandidates(() => '/bin/zsh', 'linux', { SHELL: '/bin/zsh' });
  assert.deepEqual(unix.map((candidate) => candidate.shell), [
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
    'zsh',
    'bash',
    'sh',
  ]);
  assert.deepEqual(unix[0].args, ['-o', 'nopromptsp']);
});

test('a renderer reload or crash reaps the PTYs that sender created', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const pty = createPtyController({ spawn: fakeSpawn(), emit() {} });
  registerPtyIpc(ipcMain, pty);
  function makeSender(id) {
    const listeners = new Map();
    return {
      sender: {
        id,
        isDestroyed: () => false,
        send() {},
        on(eventName, fn) { listeners.set(eventName, fn); },
        once(eventName, fn) { listeners.set(eventName, fn); },
      },
      fire(eventName) { listeners.get(eventName)(); },
    };
  }
  const harness = makeSender(1);
  const other = makeSender(2);
  const a = await handlers.get('shell:pty-create')({ sender: harness.sender }, { cwd: ws });
  const b = await handlers.get('shell:pty-create')({ sender: harness.sender }, { cwd: ws });
  const keep = await handlers.get('shell:pty-create')({ sender: other.sender }, { cwd: ws });
  harness.fire('did-navigate');
  await assert.rejects(() => pty.write(a.id, 'x'), /unknown pty id/);
  await assert.rejects(() => pty.write(b.id, 'x'), /unknown pty id/);
  // Another sender's sessions survive the reload.
  await pty.write(keep.id, 'still-alive');
  const c = await handlers.get('shell:pty-create')({ sender: other.sender }, { cwd: ws });
  other.fire('render-process-gone');
  await assert.rejects(() => pty.write(c.id, 'x'), /unknown pty id/);
  await assert.rejects(() => pty.write(keep.id, 'x'), /unknown pty id/);
});

test('a normally exited PTY does not linger in the reap table', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  const killed = [];
  const controller = createPtyController({ spawn: fakeSpawn(), emit() {} });
  const originalKill = controller.kill.bind(controller);
  controller.kill = (id) => { killed.push(id); return originalKill(id); };
  registerPtyIpc(ipcMain, controller);
  const listeners = new Map();
  const sender = {
    id: 3,
    isDestroyed: () => false,
    send() {},
    on(eventName, fn) { listeners.set(eventName, fn); },
    once(eventName, fn) { listeners.set(eventName, fn); },
  };
  const created = await handlers.get('shell:pty-create')({ sender }, { cwd: ws });
  await controller.kill(created.id);
  killed.length = 0;
  listeners.get('did-navigate')();
  assert.deepEqual(killed, []);
});

test('registerPtyIpc authorizes every renderer request before dispatch', async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, fn) { handlers.set(channel, fn); } };
  let authorized = 0;
  const controller = {
    create() {},
    write() {},
    resize() {},
    kill() { return 'killed'; },
  };
  registerPtyIpc(ipcMain, controller, {
    authorize(event) {
      assert.equal(event.sender.id, 7);
      authorized += 1;
    },
  });
  const sender = { id: 7, once() {}, isDestroyed: () => false };
  assert.equal(await handlers.get('shell:pty-kill')({ sender }, 'missing'), 'killed');
  assert.equal(authorized, 1);
});
