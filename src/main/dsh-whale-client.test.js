'use strict';

// Contract test for vendor/dsh-whale/client/client.js at the plugin module
// boundary: exports.inject, the slot registrations' inject face, and the
// window.__dshWhaleOpen pet bridge. The harness 0.1.6 client removed
// sessions.open() — view selection moved to uiWorkspace.openSession — so every
// "open her session" path must route through a unified helper that prefers
// uiWorkspace and falls back to sessions.open on pre-0.1.6 hosts.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CLIENT_FILE = path.join(__dirname, '..', '..', 'vendor', 'dsh-whale', 'client', 'client.js');
const PACKAGE_FILE = path.join(__dirname, '..', '..', 'vendor', 'dsh-whale', 'package.json');

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

function loadPlugin() {
  const spec = { current: null };
  const window = {
    __ModuleLoader__: { load: (entry) => { spec.current = entry; } },
    confirm: () => false,
  };
  const document = {
    getElementById: () => null,
    createElement: () => ({}),
    head: { appendChild() {} },
  };
  vm.runInNewContext(fs.readFileSync(CLIENT_FILE, 'utf8'), { window, document }, { filename: CLIENT_FILE });
  assert.ok(spec.current, 'client.js must register itself with __ModuleLoader__');

  const stateWrites = [];
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (init) => [init, (value) => stateWrites.push(value)],
    useEffect: (fn) => fn(),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
    Fragment: Symbol('Fragment'),
  };
  const require = (name) => {
    if (name === 'react') return react;
    return {};
  };
  const exports = spec.current.factory(require);
  return { exports, window, stateWrites };
}

// Builds the host ctx. `sessionsShape: '0.1.6'` carries catalog methods only
// (no open); `'0.1.5'` adds open(). `uiWorkspace` may be provided as a direct
// ctx property or only through ctx.get.
function makeCtx({ sessionsShape = '0.1.6', uiWorkspace = undefined, viaGet = false, specs = [] } = {}) {
  const calls = { openSession: [], sessionsOpen: [], selectPanel: [] };
  const sessions = {
    retain() {}, create() {}, search() {},
    ...(sessionsShape === '0.1.5' ? { open: async (id) => { calls.sessionsOpen.push(id); } } : {}),
  };
  const workspace = uiWorkspace === false
    ? undefined
    : { openSession: (id) => calls.openSession.push(id) };
  const declared = specs.length ? new Set(specs) : new Set(['sidebar.panellist', 'main', 'sidebar.footer.action', 'conversation.session.header.actions']);
  const registrations = [];
  const rpcCalls = [];
  const disposers = [];
  const services = { sessions, uiWorkspace: workspace };

  const ctx = {
    effect: (fn) => { disposers.push(fn()); },
    locale: { register: () => () => {}, bind: () => (key) => key },
    connection: {
      rpc: {
        call: async (_prefix, endpoint) => {
          rpcCalls.push(endpoint);
          if (endpoint === 'assistant/ensure') return { result: { value: { sessionId: 'session-whale-1' } } };
          return { result: { value: { name: '鲸鱼娘' } } };
        },
      },
    },
    layout: { selectPanel: (id) => calls.selectPanel.push(id) },
    slots: {
      inject: (_name, fn) => { fn(); },
      register: (decl, component) => { registrations.push({ decl, component }); return () => {}; },
      spec: (name) => (declared.has(name) ? {} : undefined),
      subscribe: () => () => {},
    },
    get: (name) => services[name],
  };
  if (!viaGet) {
    ctx.sessions = sessions;
    if (workspace) ctx.uiWorkspace = workspace;
  }
  return { ctx, calls, registrations, rpcCalls };
}

const faceOf = (registrations, slotName) => {
  const hit = registrations.find((entry) => entry.decl.name === slotName);
  assert.ok(hit, `expected a ${slotName} registration`);
  return hit.decl.inject();
};

test('client declares the uiWorkspace service dependency', () => {
  const { exports } = loadPlugin();
  assert.ok(exports.inject.includes('uiWorkspace'), 'exports.inject must include uiWorkspace');
  const manifest = JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8'));
  assert.ok(
    manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-workspace'),
    'dsh.client.inject must include @deepseek-ai/dsh-client-ui-workspace',
  );
});

test('__dshWhaleOpen opens her session through uiWorkspace on a 0.1.6 host', async () => {
  const { exports, window } = loadPlugin();
  const { ctx, calls } = makeCtx();
  exports.apply(ctx);
  assert.equal(typeof window.__dshWhaleOpen, 'function');
  const sessionId = await window.__dshWhaleOpen();
  assert.equal(sessionId, 'session-whale-1');
  assert.deepEqual(calls.openSession, ['session-whale-1']);
  assert.deepEqual(calls.selectPanel, [null]);
  assert.deepEqual(calls.sessionsOpen, []);
});

test('__dshWhaleOpen falls back to sessions.open on a 0.1.5 host', async () => {
  const { exports, window } = loadPlugin();
  const { ctx, calls } = makeCtx({ sessionsShape: '0.1.5', uiWorkspace: false });
  exports.apply(ctx);
  const sessionId = await window.__dshWhaleOpen();
  assert.equal(sessionId, 'session-whale-1');
  assert.deepEqual(calls.sessionsOpen, ['session-whale-1']);
  assert.deepEqual(calls.selectPanel, [null]);
});

test('inject face openSession prefers uiWorkspace and resolves uiWorkspace via ctx.get', async () => {
  const { exports } = loadPlugin();
  const { ctx, calls, registrations } = makeCtx({ viaGet: true });
  exports.apply(ctx);
  const face = faceOf(registrations, 'main');
  assert.equal(typeof face.openSession, 'function');
  await face.openSession('session-whale-1');
  assert.deepEqual(calls.openSession, ['session-whale-1']);
  await assert.rejects(() => face.openSession('   '), /no-session/);
});

test('main-panel redirect opens her session through uiWorkspace on a 0.1.6 host', async () => {
  const { exports } = loadPlugin();
  const { ctx, calls, registrations } = makeCtx({ specs: ['sidebar.panellist', 'main'] });
  exports.apply(ctx);
  const redirect = registrations.find((entry) => entry.decl.name === 'main');
  redirect.component(faceOf(registrations, 'main'));
  await settle();
  assert.deepEqual(calls.openSession, ['session-whale-1']);
  assert.deepEqual(calls.selectPanel, [null]);
});

test('main-panel redirect surfaces the service-unavailable error when neither API exists', async () => {
  const { exports, stateWrites } = loadPlugin();
  const { ctx, registrations } = makeCtx({ uiWorkspace: false, specs: ['sidebar.panellist', 'main'] });
  exports.apply(ctx);
  const redirect = registrations.find((entry) => entry.decl.name === 'main');
  redirect.component(faceOf(registrations, 'main'));
  await settle();
  assert.ok(stateWrites.includes('sessions service unavailable'));
});

test('sidebar footer fallback opens her session through uiWorkspace on a 0.1.6 host', async () => {
  const { exports } = loadPlugin();
  const { ctx, calls, registrations } = makeCtx({ specs: ['sidebar.footer.action'] });
  exports.apply(ctx);
  const footer = registrations.find((entry) => entry.decl.name === 'sidebar.footer.action');
  const button = footer.component(faceOf(registrations, 'sidebar.footer.action'));
  await button.props.onClick();
  await settle();
  assert.deepEqual(calls.openSession, ['session-whale-1']);
});
