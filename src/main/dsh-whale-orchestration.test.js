'use strict';

// Coverage for the whale assistant's orchestration layer — the vendor
// package ships no test runner of its own, so these exercise the ESM
// modules (observe/session-tools/desktop-tools) through dynamic import
// against stub controllers, a stub ctx, and a stubbed fetch.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const whaleLib = (name) => pathToFileURL(
  path.join(__dirname, '..', '..', 'vendor', 'dsh-whale', 'lib', name),
).href;

let observe;
let sessionTools;
let desktopTools;

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-pulse-'));

function stubCtx(controller) {
  const tools = new Map();
  const listeners = [];
  const effects = [];
  const ctx = {
    tools: { register: (tool) => tools.set(tool.name, tool) },
    get: (name) => (name === 'sessionController' ? controller : undefined),
    on: (event, handler, _opts) => {
      listeners.push({ event, handler });
      return () => {};
    },
    effect: (fn, _name) => {
      effects.push(fn);
      return () => {};
    },
  };
  return { ctx, tools, listeners, effects };
}

function makeController(overrides = {}) {
  return {
    list: async () => ({ sessions: [] }),
    ...overrides,
  };
}

/** Async-iterable yielding the given frames, as follow/control return. */
function frameStream(frames) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          return i < frames.length
            ? { value: frames[i++], done: false }
            : { value: undefined, done: true };
        },
      };
    },
  };
}

test.before(async () => {
  observe = await import(whaleLib('observe.js'));
  sessionTools = await import(whaleLib('session-tools.js'));
  desktopTools = await import(whaleLib('desktop-tools.js'));
});

// ── observe: watches / event buffer / schedules ────────────────

test('pulse buffers notable events and fires once-watches on turn/end', async () => {
  const wakes = [];
  const { ctx, listeners } = stubCtx();
  observe.startPulse(ctx, {
    home: tmpHome,
    getSelfId: () => 'self-session',
    wake: async (text) => { wakes.push(text); },
    logger: { warn: () => {} },
  });
  const emit = listeners.find((l) => l.event === 'session/event')?.handler;
  assert.equal(typeof emit, 'function', 'pulse subscribes to session/event');

  observe.addWatch({ sessionId: 's-watch', note: '看看结果', once: true });
  emit({ id: 's-watch' }, {
    type: 'assistant/message',
    time: 1,
    data: { message: { content: [{ type: 'text', text: '做到了一半' }] } },
  });
  assert.equal(wakes.length, 0, 'mid-turn messages never fire a watch');
  emit({ id: 's-watch' }, {
    type: 'turn/end',
    time: 2,
    data: { turn: 4, reason: { kind: 'completed' } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(wakes.length, 1);
  assert.match(wakes[0], /s-watch/);
  assert.match(wakes[0], /看看结果/);

  // once:true consumed itself — a second turn/end does not wake again.
  emit({ id: 's-watch' }, { type: 'turn/end', time: 3, data: { turn: 5, reason: { kind: 'completed' } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(wakes.length, 1);
  assert.equal(observe.listWatches().some((w) => w.sessionId === 's-watch'), false);

  // Her own session's turn/end never fires a watch on itself.
  observe.addWatch({ sessionId: 'self-session', once: true });
  emit({ id: 'self-session' }, { type: 'turn/end', time: 4, data: { turn: 1, reason: { kind: 'completed' } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(wakes.length, 1, 'self-session events do not wake her');

  // The ring buffer kept the notable frames for whale_recent_events.
  const events = observe.recentEvents({ sessionId: 's-watch' });
  assert.ok(events.some((e) => e.type === 'turn/end'));
  assert.ok(events.some((e) => e.type === 'assistant/message'));

  // Watches persisted under the whale home.
  const disk = JSON.parse(fs.readFileSync(path.join(tmpHome, 'watches.json'), 'utf8'));
  assert.equal(disk.some((w) => w.sessionId === 'self-session'), true);
});

test('schedule kinds validate inputs and due entries wake her via tick', async () => {
  const wakes = [];
  const { ctx } = stubCtx();
  observe.startPulse(ctx, {
    home: tmpHome,
    getSelfId: () => 'self-session',
    wake: async (text) => { wakes.push(text); },
    logger: { warn: () => {} },
  });

  assert.equal(observe.addSchedule({ text: '' }).error, 'missing-text');
  assert.equal(observe.addSchedule({ text: 'hi' }).error, 'need inMinutes / everyMinutes / daily(HH:MM)');

  // Pick a daily time ~12h out so the fired tick below can never reach it.
  const far = new Date(Date.now() + 12 * 3600_000);
  const daily = observe.addSchedule({
    text: '日报',
    daily: `${String(far.getHours()).padStart(2, '0')}:${String(far.getMinutes()).padStart(2, '0')}`,
  });
  assert.equal(daily.ok, true);
  assert.equal(daily.schedule.kind, 'daily');
  assert.ok(daily.schedule.nextRunAt > Date.now());

  const interval = observe.addSchedule({ text: '巡检', everyMinutes: 1, maxRuns: 1 });
  assert.equal(interval.schedule.kind, 'interval');
  assert.equal(interval.schedule.everyMinutes, 1);

  const once = observe.addSchedule({ text: '回来看看', inMinutes: 0.000001 });
  assert.equal(once.schedule.kind, 'once');

  // One tick just past the interval's due time fires once + interval, not daily.
  observe.tick(Math.max(once.schedule.nextRunAt, interval.schedule.nextRunAt) + 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(wakes.length, 1);
  assert.match(wakes[0], /回来看看/);
  assert.match(wakes[0], /巡检/);
  assert.doesNotMatch(wakes[0], /日报/);

  // once fired → disabled; interval with maxRuns:1 → disabled too.
  const listed = observe.listSchedules();
  assert.equal(listed.find((s) => s.id === once.schedule.id).enabled, false);
  assert.equal(listed.find((s) => s.id === interval.schedule.id).enabled, false);
  assert.equal(listed.find((s) => s.id === daily.schedule.id).enabled, true);

  // Removal persists to disk.
  assert.equal(observe.removeSchedule(daily.schedule.id).ok, true);
  const disk = JSON.parse(fs.readFileSync(path.join(tmpHome, 'schedules.json'), 'utf8'));
  assert.equal(disk.some((s) => s.id === daily.schedule.id), false);
});

// ── session-tools: read + control wrappers ─────────────────────

test('whale_read_session renders history pages and pages back with beforeSeq', async () => {
  const controller = makeController({
    follow: () => frameStream([{
      type: 'snapshot',
      cursor: 'c1',
      hasMore: true,
      records: [
        { event: { seq: 8, type: 'user/message', data: { source: { kind: 'user' }, message: { content: [{ type: 'text', text: '写个脚本' }] } } } },
        { event: { seq: 9, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '写好了' }] } } } },
        { event: { seq: 10, type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } } },
      ],
    }]),
    page: async (request) => {
      assert.equal(request.address.sessionId, 's-1');
      assert.equal(request.beforeSeq, 8);
      return {
        hasMore: false,
        records: [
          { event: { seq: 3, type: 'user/message', data: { message: { content: [{ type: 'text', text: '第一条' }] } } } },
        ],
      };
    },
  });
  const { ctx, tools } = stubCtx(controller);
  sessionTools.registerSessionTools(ctx);

  const read = tools.get('whale_read_session');
  const latest = await read.execute({ sessionId: 's-1' });
  assert.equal(latest.ok, true);
  assert.equal(latest.hasMore, true);
  assert.equal(latest.oldestSeq, 8);
  assert.ok(latest.lines.some((l) => l.includes('写个脚本')));
  assert.ok(latest.lines.some((l) => l.includes('回合 #2 结束')));

  const earlier = await read.execute({ sessionId: 's-1', beforeSeq: 8 });
  assert.equal(earlier.ok, true);
  assert.equal(earlier.hasMore, false);
  assert.ok(earlier.lines.some((l) => l.includes('第一条')));
});

test('whale_search_sessions maps controller hits', async () => {
  const controller = makeController({
    search: async (request) => {
      assert.equal(request.query, '部署');
      return { items: [{ sessionId: 's-9', snippet: '…部署脚本…' }], hasMore: false };
    },
  });
  const { ctx, tools } = stubCtx(controller);
  sessionTools.registerSessionTools(ctx);
  const result = await tools.get('whale_search_sessions').execute({ query: '部署' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, [{ sessionId: 's-9', snippet: '…部署脚本…' }]);
});

test('whale_session_queue reads the control baseline and update_queue maps actions', async () => {
  const seen = [];
  const controller = makeController({
    control: () => frameStream([{
      type: 'baseline',
      value: {
        queues: {
          's-1': [{ id: 'q-1', placement: 'queued', message: { content: [{ type: 'text', text: '接着做' }] } }],
        },
        jobs: { 's-1': [{ kind: 'command', status: 'running' }] },
      },
    }]),
    updateQueue: async (request) => { seen.push(request); return { ok: true }; },
  });
  const { ctx, tools } = stubCtx(controller);
  sessionTools.registerSessionTools(ctx);

  const queue = await tools.get('whale_session_queue').execute({});
  assert.equal(queue.ok, true);
  assert.equal(queue.queues.length, 1);
  assert.deepEqual(queue.queues[0].items, [{ id: 'q-1', placement: 'queued', text: '接着做' }]);
  assert.deepEqual(queue.queues[0].jobs, ['command running']);

  const update = tools.get('whale_update_queue');
  assert.equal((await update.execute({ sessionId: 's-1', itemId: 'q-1', action: 'steer' })).ok, true);
  assert.equal((await update.execute({ sessionId: 's-1', itemId: 'q-1', action: 'edit', text: '换个方向' })).ok, true);
  assert.equal((await update.execute({ sessionId: 's-1', itemId: 'q-1', action: 'remove' })).ok, true);
  assert.deepEqual(seen.map((r) => r.action), [
    { kind: 'steer' },
    { kind: 'edit', content: [{ type: 'text', text: '换个方向' }] },
    { kind: 'remove' },
  ]);
  assert.equal((await update.execute({ sessionId: 's-1', itemId: 'q-1', action: 'explode' })).ok, false);
  assert.equal((await update.execute({ sessionId: 's-1', itemId: 'q-1', action: 'edit' })).ok, false);
});

test('whale control tools call through with the right request shapes', async () => {
  const seen = [];
  const controller = makeController({
    cancel: async (r) => { seen.push(['cancel', r]); return { ok: true }; },
    rename: async (r) => { seen.push(['rename', r]); return { title: r.title }; },
    fork: async (r) => { seen.push(['fork', r]); return { sessionId: 's-fork' }; },
    delete: async (r) => { seen.push(['delete', r]); return { deletedSessionIds: [r.sessionId, 'child-1'] }; },
    selectModel: async (r) => { seen.push(['selectModel', r]); return { selected: { provider: r.provider, model: r.model } }; },
  });
  const { ctx, tools } = stubCtx(controller);
  sessionTools.registerSessionTools(ctx);

  assert.equal((await tools.get('whale_cancel_session').execute({ sessionId: 's-1' })).ok, true);
  const renamed = await tools.get('whale_rename_session').execute({ sessionId: 's-1', title: '新名字' });
  assert.match(renamed.detail, /新名字/);
  const forked = await tools.get('whale_fork_session').execute({ sessionId: 's-1', atSeq: 12 });
  assert.equal(forked.sessionId, 's-fork');
  const deleted = await tools.get('whale_delete_session').execute({ sessionId: 's-arch' });
  assert.match(deleted.detail, /Deleted 2 session/);
  await tools.get('whale_select_model').execute({ sessionId: 's-1', provider: 'deepseek', model: 'deepseek-chat' });

  assert.deepEqual(seen[0], ['cancel', { sessionId: 's-1' }]);
  assert.deepEqual(seen[1], ['rename', { sessionId: 's-1', title: '新名字' }]);
  assert.deepEqual(seen[2], ['fork', { sessionId: 's-1', atSeq: 12 }]);
  assert.deepEqual(seen[3], ['delete', { sessionId: 's-arch' }]);
  assert.equal(seen[4][0], 'selectModel');
  // Session-local only — a whale model pick must never become the app default.
  assert.equal(seen[4][1].saveAsDefault, false);
});

test('whale tools degrade cleanly when the controller is unavailable', async () => {
  const { ctx, tools } = stubCtx(makeController());
  sessionTools.registerSessionTools(ctx);
  const read = await tools.get('whale_read_session').execute({ sessionId: 's-x' });
  assert.equal(read.ok, false);
  assert.match(read.detail, /unavailable/);
  const cancel = await tools.get('whale_cancel_session').execute({ sessionId: 's-x' });
  assert.equal(cancel.ok, false);
});

test('whale_watch / whale_schedule tools drive the pulse stores', async () => {
  const { ctx, tools } = stubCtx(makeController());
  sessionTools.registerSessionTools(ctx);
  const watch = tools.get('whale_watch');
  const schedule = tools.get('whale_schedule');

  assert.match((await watch.execute({ action: 'add', sessionId: 's-tool', note: 'n' })).detail, /Watching s-tool/);
  assert.match((await watch.execute({ action: 'list' })).detail, /s-tool/);
  assert.match((await watch.execute({ action: 'remove', sessionId: 's-tool' })).detail, /removed/);
  assert.match((await watch.execute({ action: 'remove', sessionId: 's-tool' })).detail, /No watch/);
  assert.equal((await watch.execute({ action: 'bogus' })).ok, false);

  const added = await schedule.execute({ action: 'add', text: '起身喝水', inMinutes: 30 });
  assert.match(added.detail, /Scheduled sch-/);
  const id = /Scheduled (sch-\w+)/.exec(added.detail)[1];
  assert.match((await schedule.execute({ action: 'list' })).detail, new RegExp(id));
  assert.equal((await schedule.execute({ action: 'remove', id })).ok, true);
  assert.equal((await schedule.execute({ action: 'add', text: 'x' })).ok, false);
});

// ── desktop-tools: loopback control channel ────────────────────

test('desktop tools report unavailable without the control env pair', async () => {
  const saved = { url: process.env.DSH_DESKTOP_INSTALL_URL, token: process.env.DSH_DESKTOP_INSTALL_TOKEN };
  delete process.env.DSH_DESKTOP_INSTALL_URL;
  delete process.env.DSH_DESKTOP_INSTALL_TOKEN;
  try {
    const { ctx, tools } = stubCtx(makeController());
    desktopTools.registerDesktopTools(ctx);
    const state = await tools.get('whale_desktop_state').execute({});
    assert.equal(state.ok, false);
    assert.match(state.detail, /desktop-unavailable/);
    const plugin = await tools.get('whale_desktop_plugin').execute({ action: 'list' });
    assert.equal(plugin.ok, false);
  } finally {
    if (saved.url !== undefined) process.env.DSH_DESKTOP_INSTALL_URL = saved.url;
    if (saved.token !== undefined) process.env.DSH_DESKTOP_INSTALL_TOKEN = saved.token;
  }
});

test('desktop tools send the bearer token and map response bodies', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  process.env.DSH_DESKTOP_INSTALL_URL = 'http://127.0.0.1:9';
  process.env.DSH_DESKTOP_INSTALL_TOKEN = 'tok-1';
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), auth: init.headers?.authorization, body: init.body ? JSON.parse(init.body) : null });
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (String(url).endsWith('/desktop/state')) {
      return json({ ok: true, version: '1.0.0', kernel: 'ready', plugins: ['a'], disabledPlugins: ['b'], config: { theme: 'dark' } });
    }
    if (String(url).endsWith('/desktop/plugin')) {
      return json({ ok: true, restarting: true });
    }
    if (String(url).endsWith('/desktop/config')) {
      return json({ ok: true, config: {} });
    }
    return json({ ok: false, error: 'not found' }, 404);
  };
  try {
    const { ctx, tools } = stubCtx(makeController());
    desktopTools.registerDesktopTools(ctx);

    const state = await tools.get('whale_desktop_state').execute({});
    assert.equal(state.ok, true);
    assert.match(state.detail, /ready/);
    assert.match(state.detail, /a/);
    assert.equal(calls[0].auth, 'Bearer tok-1');

    const toggled = await tools.get('whale_desktop_plugin').execute({ action: 'disable', name: 'a-pack' });
    assert.equal(toggled.ok, true);
    assert.match(toggled.detail, /Harness 正在重启/);
    assert.deepEqual(calls[1].body, { action: 'disable', name: 'a-pack' });

    const conf = await tools.get('whale_desktop_config').execute({ patch: { theme: 'ocean' } });
    assert.equal(conf.ok, true);
    assert.deepEqual(calls[2].body, { patch: { theme: 'ocean' } });
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.DSH_DESKTOP_INSTALL_URL;
    delete process.env.DSH_DESKTOP_INSTALL_TOKEN;
  }
});

test('whale_desktop_plugin surfaces needsAllowBuilds guidance', async () => {
  const realFetch = globalThis.fetch;
  process.env.DSH_DESKTOP_INSTALL_URL = 'http://127.0.0.1:9';
  process.env.DSH_DESKTOP_INSTALL_TOKEN = 'tok-1';
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false, needsAllowBuilds: true, allowBuilds: ['pkg-a'],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const { ctx, tools } = stubCtx(makeController());
    desktopTools.registerDesktopTools(ctx);
    const res = await tools.get('whale_desktop_plugin').execute({ action: 'install', spec: 'github:o/r' });
    assert.equal(res.ok, false);
    assert.match(res.detail, /allowBuilds=\[pkg-a\]/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.DSH_DESKTOP_INSTALL_URL;
    delete process.env.DSH_DESKTOP_INSTALL_TOKEN;
  }
});
