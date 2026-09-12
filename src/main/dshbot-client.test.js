'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CLIENT_BUNDLE = path.join(__dirname, '..', '..', 'vendor', 'dshbot', 'client', 'client.js');

// Executes the shipped ModuleLoader bundle and returns its plugin exports.
function loadClientModule() {
  let captured = null;
  const sandbox = {
    window: { __ModuleLoader__: { load: (registration) => { captured = registration; } } },
    console,
  };
  vm.runInNewContext(fs.readFileSync(CLIENT_BUNDLE, 'utf8'), sandbox, { filename: CLIENT_BUNDLE });
  assert.ok(captured && captured.id === 'dshbot', 'client bundle must register itself as "dshbot"');
  const requireStub = (spec) => {
    if (spec === 'react') {
      return {
        createElement: () => null,
        useState: (init) => [init, () => {}],
        useEffect: () => {},
        useMemo: (fn) => fn(),
        useRef: (init) => ({ current: init }),
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
    // A children table commits every sibling spec before the first
    // notification (SlotCore contract), so sibling seats land atomically.
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
  return {
    slots,
    connection: undefined,
    sessions: {
      list: {
        getSnapshot: () => ({ current: null, byId: {} }),
        subscribe: () => () => {},
      },
    },
    inputTriggers: undefined,
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
    },
    settingsScope: {
      bind: () => ({
        getSnapshot: () => ({}),
        subscribe: () => () => {},
        set: async () => {},
      }),
      describe: () => ({ acceptView: () => {} }),
    },
    effect: (fn) => fn(),
    get: () => undefined,
  };
}

function applyWith(slots) {
  const mod = loadClientModule();
  assert.deepEqual(mod.name, 'dsh-bot');
  mod.apply(makeCtx(slots));
  return mod;
}

function registeredNames(slots) {
  return slots.registrations.map((entry) => `${entry.options.name}:${entry.options.id ?? entry.options.key}`);
}

test('dshbot client registers region tab + page when declarations land after apply', () => {
  const slots = makeSlots();
  applyWith(slots);
  assert.deepEqual(registeredNames(slots), [], 'must not register before the seats declare');
  slots.declareAll(['sidebar.nav.tab', 'sidebar.page']);
  assert.deepEqual(registeredNames(slots).sort(), [
    'sidebar.nav.tab:bots',
    'sidebar.page:bots',
  ]);
});

test('dshbot client falls back to sidebar.footer.action when no region seats exist', () => {
  const slots = makeSlots();
  applyWith(slots);
  slots.declare('sidebar.footer.action');
  assert.deepEqual(registeredNames(slots), ['sidebar.footer.action:dshbot-bots']);
});

test('dshbot client prefers region tabs over the footer fallback on the desktop fork', () => {
  const slots = makeSlots();
  applyWith(slots);
  slots.declareAll(['sidebar.nav.tab', 'sidebar.page']);
  slots.declare('sidebar.footer.action');
  assert.deepEqual(registeredNames(slots).sort(), [
    'sidebar.nav.tab:bots',
    'sidebar.page:bots',
  ], 'footer seat must yield once both region seats are declared');
});

test('dshbot client registers immediately when the region seats predate apply', () => {
  const slots = makeSlots();
  slots.declare('sidebar.nav.tab');
  slots.declare('sidebar.page');
  slots.declare('sidebar.footer.action');
  applyWith(slots);
  assert.deepEqual(registeredNames(slots).sort(), [
    'sidebar.nav.tab:bots',
    'sidebar.page:bots',
  ]);
});
