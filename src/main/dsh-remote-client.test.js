'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CLIENT_BUNDLE = path.join(__dirname, '..', '..', 'vendor', 'dsh-remote', 'lib', 'client.js');

// Executes the shipped ModuleLoader bundle and returns its plugin exports.
function loadClientModule() {
  let captured = null;
  const sandbox = {
    window: { __ModuleLoader__: { load: (registration) => { captured = registration; } } },
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, remove() {} }),
      head: { appendChild() {} },
    },
    URL,
    console,
  };
  vm.runInNewContext(fs.readFileSync(CLIENT_BUNDLE, 'utf8'), sandbox, { filename: CLIENT_BUNDLE });
  assert.ok(captured && captured.id === 'dsh-remote', 'client bundle must register itself as "dsh-remote"');
  const requireStub = (spec) => {
    if (spec === 'react') {
      return {
        createElement: () => null,
        useState: (init) => [init, () => {}],
        useEffect: () => {},
        useMemo: (fn) => fn(),
        useRef: (init) => ({ current: init }),
        useCallback: (fn) => fn,
        Fragment: Symbol('Fragment'),
      };
    }
    return new Proxy({}, { get: () => () => null });
  };
  return captured.factory(requireStub);
}

// Minimal slots service honouring the real contract: inject() runs the
// callback synchronously when the slot is declared, otherwise parks it until
// declaration; declare() commits a spec and then notifies parked waiters.
// subscribe() mirrors SlotCore: listeners fire whenever the key mutates,
// including declaration commits and collapses.
function makeSlots() {
  const specs = new Map();
  const waiters = new Map();
  const subscribers = new Map();
  const registrations = [];
  const notify = (key) => {
    for (const fn of [...(subscribers.get(key) ?? [])]) fn();
  };
  return {
    registrations,
    spec: (key) => specs.get(key),
    subscribe(key, fn) {
      const list = subscribers.get(key) ?? new Set();
      list.add(fn);
      subscribers.set(key, list);
      return () => list.delete(fn);
    },
    register(options, component) {
      const entry = { options, component };
      registrations.push(entry);
      return () => {
        const at = registrations.indexOf(entry);
        if (at !== -1) registrations.splice(at, 1);
      };
    },
    inject(key, callback) {
      if (specs.has(key)) {
        callback();
        return () => {};
      }
      const list = waiters.get(key) ?? [];
      list.push(callback);
      waiters.set(key, list);
      return () => {};
    },
    declareAll(keys) {
      for (const key of keys) specs.set(key, { kind: 'list', scope: 'root' });
      for (const key of keys) notify(key);
      for (const key of keys) {
        const list = waiters.get(key) ?? [];
        waiters.delete(key);
        for (const callback of list) callback();
      }
    },
    declare(key) {
      this.declareAll([key]);
    },
  };
}

function makeCtx(slots) {
  const services = new Map([['slots', slots]]);
  const injectWaiters = [];
  const locales = new Map();
  const rootCtx = {
    slots,
    locale: {
      register: (ns, dicts) => { locales.set(ns, dicts); return () => locales.delete(ns); },
      bind: () => (key) => key,
    },
    effect: (fn) => fn(),
    get: (name) => services.get(name),
    provide(name, service) {
      services.set(name, service);
      for (const waiter of injectWaiters.splice(0)) waiter();
      return () => services.delete(name);
    },
    inject(names, fn) {
      const ready = names.every((name) => services.has(name));
      if (!ready) {
        injectWaiters.push(() => { if (names.every((name) => services.has(name))) fn(rootCtx); });
        return () => {};
      }
      fn(rootCtx);
      return () => {};
    },
    _locales: locales,
  };
  return rootCtx;
}

function applyWith(slots) {
  const mod = loadClientModule();
  assert.equal(mod.name, 'dsh-remote');
  assert.deepEqual([...mod.inject], ['slots', 'locale']);
  const ctx = makeCtx(slots);
  mod.apply(ctx);
  return { mod, ctx };
}

function registeredSeats(slots) {
  return slots.registrations.map((entry) => `${entry.options.name}#${entry.options.id ?? entry.options.key ?? ''}`);
}

const REMOTE_FLOW_SLOTS = [
  'conversation.hero.workspace.directoryFlow.remote',
  'sidebar.workspaces.directoryFlow.remote',
];

test('dsh-remote registers bilingual dictionaries with key parity', () => {
  const slots = makeSlots();
  const { ctx } = applyWith(slots);
  const dicts = ctx._locales.get('dsh-remote');
  assert.ok(dicts && dicts.zh && dicts.en, 'dsh-remote dict must ship zh and en');
  assert.deepEqual(Object.keys(dicts.zh).sort(), Object.keys(dicts.en).sort(), 'zh/en key parity');
});

test('dsh-remote registers the settings section and remote-flow occupants when seats declare', () => {
  const slots = makeSlots();
  applyWith(slots);
  assert.deepEqual(registeredSeats(slots), [], 'must not register before the seats declare');
  slots.declare('settings.section');
  assert.deepEqual(registeredSeats(slots), ['settings.section#remote-workspace']);
  for (const key of REMOTE_FLOW_SLOTS) slots.declare(key);
  assert.deepEqual(registeredSeats(slots).sort(), [
    'conversation.hero.workspace.directoryFlow.remote#',
    'settings.section#remote-workspace',
    'sidebar.workspaces.directoryFlow.remote#',
  ]);
});

test('dsh-remote defers sidebar registrations until sidebarRightTabs is provided', () => {
  const slots = makeSlots();
  const { ctx } = applyWith(slots);
  slots.declareAll(['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title']);
  assert.deepEqual(registeredSeats(slots), [], 'sidebar seats must wait for sidebarRightTabs');
  const tabTypes = [];
  ctx.provide('sidebarRightTabs', { register: (def) => { tabTypes.push(def); return () => {}; } });
  assert.deepEqual(tabTypes.map((def) => def.id).sort(), ['dsh-remote/explorer', 'dsh-remote/file']);
  const fileDef = tabTypes.find((def) => def.id === 'dsh-remote/file');
  assert.deepEqual([...fileDef.patterns], ['dsh-resource://dsh-remote/**']);
  assert.deepEqual(registeredSeats(slots).sort(), [
    'sidebar.right.pane.tab.title#dsh-remote/explorer',
    'sidebar.right.pane.tab.title#dsh-remote/file',
    'sidebar.right.pane.tab#dsh-remote/explorer',
    'sidebar.right.pane.tab#dsh-remote/file',
  ].sort());
});

test('dsh-remote survives a composition with no sidebar-right bundle at all', () => {
  const slots = makeSlots();
  applyWith(slots);
  slots.declareAll(['settings.section', ...REMOTE_FLOW_SLOTS]);
  const seats = registeredSeats(slots);
  assert.equal(seats.filter((seat) => seat.startsWith('sidebar.right.')).length, 0);
  assert.ok(seats.includes('settings.section#remote-workspace'));
});

test('dsh-remote file tab title resolves the remote path from the resource address', () => {
  const slots = makeSlots();
  const { ctx } = applyWith(slots);
  const tabTypes = [];
  ctx.provide('sidebarRightTabs', { register: (def) => { tabTypes.push(def); return () => {}; } });
  const fileDef = tabTypes.find((def) => def.id === 'dsh-remote/file');
  const address = 'dsh-resource://dsh-remote/' + encodeURIComponent('sess-1') + '/' + encodeURIComponent('/srv/app/README.md');
  assert.equal(fileDef.title(address), 'README.md');
  assert.equal(typeof fileDef.title('not-a-resource'), 'string');
});
