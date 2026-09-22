'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  LEVELS,
  levelFor,
  nextLevelAt,
  levelName,
  usageTokens,
  usageSampleOf,
  tokensInLog,
  scanSessionTokens,
  normalizeGrowthState,
  createGrowthTracker,
  createScanWorker,
} = require('./pet-growth');

// ── levels ──

test('levelFor maps cumulative points onto the ten thresholds', () => {
  assert.equal(LEVELS.length, 10);
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(99_999_999), 1);
  assert.equal(levelFor(100_000_000), 2);          // 1亿 → 小鲸
  assert.equal(levelFor(299_999_999), 2);
  assert.equal(levelFor(300_000_000), 3);          // 3亿 → 干饭鲸
  assert.equal(levelFor(599_999_999), 3);
  assert.equal(levelFor(600_000_000), 4);          // 6亿 → 鲸鱼娘
  assert.equal(levelFor(1_199_999_999), 4);
  assert.equal(levelFor(1_200_000_000), 5);        // 12亿 → 大肥鱼
  assert.equal(levelFor(2_199_999_999), 5);
  assert.equal(levelFor(2_200_000_000), 6);        // 22亿 → 干饭大王
  assert.equal(levelFor(3_999_999_999), 6);
  assert.equal(levelFor(4_000_000_000), 7);        // 40亿 → 米饭女帝
  assert.equal(levelFor(7_000_000_000), 8);        // 70亿 → 鲸吞四海
  assert.equal(levelFor(12_000_000_000), 9);       // 120亿 → 星海饭皇
  assert.equal(levelFor(20_000_000_000), 10);      // 200亿 → 干饭真神
  assert.equal(levelFor(9e10), 10);
});

test('nextLevelAt / levelName stay in sync and cap at the final level', () => {
  assert.equal(nextLevelAt(0), 100_000_000);
  assert.equal(nextLevelAt(300_000_000), 600_000_000);
  assert.equal(nextLevelAt(20_000_000_000), null);
  assert.equal(levelName(0), '幼鲸');
  assert.equal(levelName(1_200_000_000), '大肥鱼');
  assert.equal(levelName(20_000_000_000), '干饭真神');
});

// ── usage extraction ──

test('usageTokens sums the four billing buckets and tolerates gaps', () => {
  assert.equal(usageTokens(undefined), 0);
  assert.equal(usageTokens('nope'), 0);
  assert.equal(usageTokens({}), 0);
  assert.equal(usageTokens({
    inputTokens: 10, cacheReadTokens: 3, cacheWriteTokens: 2, outputTokens: 5,
  }), 20);
  assert.equal(usageTokens({ outputTokens: 7 }), 7);
});

test('usageSampleOf reads settlements, usage chunks and compaction only', () => {
  const usage = { inputTokens: 4, outputTokens: 6 };
  assert.deepEqual(
    usageSampleOf({ type: 'assistant/message', data: { turn: 1, step: 2, usage } }),
    { turn: 1, step: 2, usage },
  );
  assert.equal(
    usageSampleOf({ type: 'assistant/message', data: { turn: 1, step: 2 } }),
    undefined,
  );
  assert.deepEqual(
    usageSampleOf({
      type: 'assistant/attempt',
      data: { turn: 3, step: 0, chunk: { type: 'usage', usage } },
    }),
    { turn: 3, step: 0, usage },
  );
  // A stream array resolves to its last usage chunk.
  const older = { inputTokens: 1 };
  assert.deepEqual(
    usageSampleOf({
      type: 'assistant/chunk',
      data: {
        turn: 5, step: 1,
        stream: [
          { type: 'usage', usage: older },
          { type: 'text' },
          { type: 'usage', usage },
        ],
      },
    }),
    { turn: 5, step: 1, usage },
  );
  assert.deepEqual(
    usageSampleOf({ type: 'compaction/summary', seq: 9, data: { usage } }),
    { turn: -1, step: 9, usage },
  );
  // Content-bearing events never leak a sample.
  assert.equal(usageSampleOf({ type: 'user/message', data: { turn: 1 } }), undefined);
  assert.equal(usageSampleOf({ type: 'tool/result', data: {} }), undefined);
  assert.equal(usageSampleOf({}), undefined);
});

// ── log folding ──

test('tokensInLog dedupes per (turn,step) with last-wins semantics', () => {
  const lines = [
    JSON.stringify({ type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 100 } } }),
    // Retried attempt: later settlement replaces the earlier 100.
    JSON.stringify({ type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 130 } } }),
    JSON.stringify({ type: 'assistant/message', data: { turn: 0, step: 1, usage: { outputTokens: 40 } } }),
    JSON.stringify({ type: 'user/message', data: { turn: 0, text: 'secret' } }),
    'not json at all',
    '{broken json',
    '',
    JSON.stringify({ type: 'compaction/summary', seq: 2, data: { usage: { inputTokens: 10, outputTokens: 5 } } }),
  ].join('\n');
  assert.equal(tokensInLog(lines), 130 + 40 + 15);
});

test('tokensInLog on empty input returns zero', () => {
  assert.equal(tokensInLog(''), 0);
  assert.equal(tokensInLog('\n\n'), 0);
});

// ── filesystem scan ──

function writeLog(root, sessionId, name, events) {
  const dir = path.join(root, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const body = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, name), zlib.zstdCompressSync(Buffer.from(body, 'utf8')));
}

test('scanSessionTokens aggregates session*.jsonl.zstd across nested dirs', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 50, outputTokens: 50 } } },
  ]);
  writeLog(root, 'b', 'session.v2.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 1, step: 0, usage: { outputTokens: 30 } } },
  ]);
  // Unrelated files and corrupt archives are skipped, not fatal.
  writeLog(root, 'c', 'session.jsonl.zstd', []);
  fs.writeFileSync(path.join(root, 'b', 'session.extra.jsonl.zstd'),
    zlib.zstdCompressSync(Buffer.from('{"type":"assistant/message","data":{"usage":{"inputTokens":999}}}')));
  fs.writeFileSync(path.join(root, 'b', 'notes.txt'), 'hello');
  fs.writeFileSync(path.join(root, 'b', 'session.jsonl.zstd'), Buffer.from([1, 2, 3]));
  // Real desktop sessions use versioned names (v2, v3…) and multi-frame
  // archives (one zstd frame per appended event batch).
  const dirD = path.join(root, 'd');
  fs.mkdirSync(dirD);
  const frameA = zlib.zstdCompressSync(Buffer.from(
    JSON.stringify({ type: 'session' }) + '\n'
    + JSON.stringify({ type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 7 } } }) + '\n'));
  const frameB = zlib.zstdCompressSync(Buffer.from(
    JSON.stringify({ type: 'assistant/message', data: { turn: 0, step: 1, usage: { inputTokens: 8 } } }) + '\n'));
  fs.writeFileSync(path.join(dirD, 'session.v3.jsonl.zstd'), Buffer.concat([frameA, frameB]));
  const res = scanSessionTokens(root);
  assert.equal(res.total, 100 + 30 + 15);
  assert.equal(res.sessions, 4); // a + b/v2 + c (empty) + d/v3; corrupt b log skipped
});

test('migrated v1+v2 logs in one session dir dedupe on (turn,step)', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const shared = { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 800 } } };
  writeLog(root, 'migrated', 'session.jsonl.zstd', [
    shared,
    { type: 'assistant/message', data: { turn: 1, step: 2, usage: { inputTokens: 200 } } },
  ]);
  // The v2 copy re-states step 1 and adds a migrated-only step 3.
  writeLog(root, 'migrated', 'session.v2.jsonl.zstd', [
    shared,
    { type: 'assistant/message', data: { turn: 1, step: 3, usage: { inputTokens: 100 } } },
  ]);
  const res = scanSessionTokens(root);
  assert.equal(res.sessions, 1);
  assert.equal(res.total, 800 + 200 + 100, 'overlapping slot counted once');
});

test('scanSessionTokens on a missing dir returns zeros', () => {
  const res = scanSessionTokens(path.join(os.tmpdir(), 'definitely-not-here-pet-growth'));
  assert.deepEqual(res, { total: 0, sessions: 0 });
});

test('scanSessionTokens cache replays unchanged files and tracks changes', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cache = new Map();
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 100 } } },
  ]);
  let res = scanSessionTokens(root, cache);
  assert.equal(res.total, 100);
  assert.equal(cache.size, 1);
  // Unchanged file replays its folded usage without a re-decode.
  res = scanSessionTokens(root, cache);
  assert.equal(res.total, 100);
  assert.equal(cache.size, 1);
  // A new sibling log decodes once and joins the cache.
  writeLog(root, 'a', 'session.v2.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 1, step: 0, usage: { inputTokens: 50 } } },
  ]);
  res = scanSessionTokens(root, cache);
  assert.equal(res.total, 150);
  assert.equal(cache.size, 2);
  // A deleted file is evicted and leaves the total.
  fs.rmSync(path.join(root, 'a', 'session.jsonl.zstd'));
  res = scanSessionTokens(root, cache);
  assert.equal(res.total, 50);
  assert.equal(cache.size, 1);
  // A torn write decodes as "nothing clean yet" and contributes zero; once the
  // tail heals the size key changes and the healed frames join the total.
  const good = zlib.zstdCompressSync(Buffer.from('{"type":"assistant/message","data":{"usage":{"inputTokens":7}}}\n'));
  fs.writeFileSync(path.join(root, 'a', 'session.jsonl.zstd'), good.subarray(0, good.length - 2));
  res = scanSessionTokens(root, cache);
  assert.equal(res.total, 50);
  fs.writeFileSync(path.join(root, 'a', 'session.jsonl.zstd'), good);
  res = scanSessionTokens(root, cache);
  assert.equal(res.total, 57);
});


// ── state normalization ──

test('normalizeGrowthState floors values and rejects negatives/NaN', () => {
  const base = { points: 0, tokensFed: 0, tokensSeen: 0, baseline: null, today: null };
  assert.deepEqual(normalizeGrowthState(undefined), base);
  assert.deepEqual(normalizeGrowthState(null), base);
  assert.deepEqual(normalizeGrowthState({ points: 12.9, tokensFed: -3, tokensSeen: 'x' }),
    { ...base, points: 12 });
  assert.deepEqual(normalizeGrowthState({ baseline: 1234.9 }),
    { ...base, baseline: 1234 });
});

// ── tracker ──

function trackerWith(root, initial, scanTokens) {
  let stored = initial;
  const writes = [];
  const scanCache = new Map();
  const tracker = createGrowthTracker({
    sessionsDir: root,
    getGrowth: () => stored,
    saveGrowth: (next) => { writes.push(next); stored = next; },
    // Bookkeeping tests inject the in-process scan so no worker spawns;
    // the default worker path has its own coverage below.
    scanTokens: scanTokens || ((dir) => scanSessionTokens(dir, scanCache)),
  });
  return { tracker, writes, read: () => stored };
}

test('refresh folds cumulative scan totals into state monotonically', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 700 } } },
  ]);
  const { tracker, read } = trackerWith(root, undefined);
  let g = await tracker.refresh();
  assert.equal(g.tokensSeen, 700);
  assert.equal(g.points, 0);
  // Rescanning the same corpus is a no-op — no double counting.
  g = await tracker.refresh();
  assert.equal(g.tokensSeen, 700);
  assert.equal(read().tokensSeen, 700);
  // Corpus growth lifts the ceiling.
  writeLog(root, 'a', 'session.v2.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 1, step: 0, usage: { inputTokens: 300 } } },
  ]);
  g = await tracker.refresh();
  assert.equal(g.tokensSeen, 1000);
});

test('refresh keeps the fed credit when the corpus shrank', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 500 } } },
  ]);
  const { tracker } = trackerWith(root, { points: 400, tokensFed: 400, tokensSeen: 0 });
  await tracker.refresh();
  // Delete the corpus → feedable can never go negative.
  fs.rmSync(path.join(root, 'a'), { recursive: true });
  const g = await tracker.refresh();
  assert.equal(g.tokensSeen, 0);
  assert.equal(g.tokensFed, 400); // credit kept — a restored corpus can't re-feed
  assert.equal(g.points, 400); // earned growth is never revoked
  assert.equal(tracker.feedable(g), 0);
  // Restore the corpus → only the truly-new 100 is feedable.
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 500 } } },
  ]);
  const back = await tracker.refresh();
  assert.equal(back.tokensSeen, 500);
  assert.equal(tracker.feedable(back), 100);
});

test('feed consumes feedable tokens idempotently and detects level-ups', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 250_000_000 } } },
  ]);
  const { tracker } = trackerWith(root, { points: 0, tokensFed: 0, tokensSeen: 0, baseline: 0 });
  await tracker.refresh();
  // One meal fills at most the current level — 2.5亿 feedable caps at the
  // 小鲸 threshold (1亿), leaving 1.5亿 for the next feeding.
  const res = tracker.feed();
  assert.equal(res.fed, 100_000_000);
  assert.equal(res.points, 100_000_000);
  assert.equal(res.level, 2);
  assert.equal(res.levelName, '小鲸');
  assert.equal(res.leveledUp, true);
  assert.equal(res.feedable, 150_000_000);
  assert.equal(res.nextFeed, 150_000_000);
  const again = tracker.feed();
  assert.equal(again.fed, 150_000_000);
  assert.equal(again.points, 250_000_000);
  assert.equal(again.level, 2); // still short of 干饭鲸 at 3亿
  assert.equal(again.leveledUp, false);
  assert.equal(tracker.feed().fed, 0); // bowl empty
});

test('feed(amount) clamps to what is actually feedable', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 100 } } },
  ]);
  const { tracker, read } = trackerWith(root, { baseline: 0 });
  await tracker.refresh();
  const res = tracker.feed(5000);
  assert.equal(res.fed, 100);
  assert.equal(read().tokensFed, 100);
  assert.equal(tracker.feed(0).fed, 0);
  assert.equal(tracker.feed(-5).fed, 0);
});

test('a mid-level feed reports progress without a level-up', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 500 } } },
  ]);
  const { tracker } = trackerWith(root, { points: 100, tokensFed: 0, tokensSeen: 0, baseline: 0 });
  await tracker.refresh();
  const res = tracker.feed();
  assert.equal(res.fed, 500);
  assert.equal(res.level, 1);
  assert.equal(res.leveledUp, false);
  assert.equal(res.nextAt, 100_000_000);
});

test('first scan plants the watermark — backlog is never food', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 12000 } } },
  ]);
  const { tracker } = trackerWith(root, { points: 0, tokensFed: 0, tokensSeen: 0 });
  const g = await tracker.refresh();
  assert.equal(g.baseline, 12000);
  assert.equal(tracker.feedable(g), 0);
  assert.equal(tracker.feed().fed, 0);
  // Tokens burned AFTER the watermark are real food.
  writeLog(root, 'b', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 3000 } } },
  ]);
  const g2 = await tracker.refresh();
  assert.equal(g2.tokensSeen, 15000);
  assert.equal(tracker.feedable(g2), 3000);
  assert.equal(tracker.feed().fed, 3000);
});

test('upgrade: pre-watermark fed credit folds into baseline, no food debt', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 500 } } },
  ]);
  // Backlog-era state: she already ate 400 of the 500-token corpus.
  const { tracker } = trackerWith(root, { points: 400, tokensFed: 400, tokensSeen: 0 });
  const g = await tracker.refresh();
  assert.equal(g.baseline, 100); // corpus 500 − eaten 400
  assert.equal(tracker.feedable(g), 0);
  // Her old fed credit does NOT bill against tokens burned post-upgrade.
  writeLog(root, 'b', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 200 } } },
  ]);
  const g2 = await tracker.refresh();
  assert.equal(tracker.feedable(g2), 200);
});

// ── off-thread scan (regression: 60s rescan used to decode whole logs on
// the Electron main thread — every changed session log froze all windows) ──

test('the scan worker reports the same totals as scanSessionTokens', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 50, outputTokens: 50 } } },
  ]);
  writeLog(root, 'b', 'session.v2.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 1, step: 0, usage: { outputTokens: 30 } } },
  ]);
  const worker = createScanWorker();
  t.after(() => worker.close());
  const expected = scanSessionTokens(root);
  assert.deepEqual(await worker.scan(root), expected);
  // The unchanged-file cache lives inside the worker across scans.
  assert.deepEqual(await worker.scan(root), expected);
  // A grown file re-decodes and re-totals.
  writeLog(root, 'b', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 2, step: 0, usage: { inputTokens: 5 } } },
  ]);
  assert.deepEqual(await worker.scan(root), scanSessionTokens(root));
});

test('a closed scan worker rejects instead of hanging', async (t) => {
  const worker = createScanWorker();
  await worker.close();
  await assert.rejects(worker.scan(os.tmpdir()), /closed/);
  // close() is idempotent and safe on an already-dead worker.
  await worker.close();
});

test('refresh runs the corpus scan off the main thread', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeLog(root, 'a', 'session.jsonl.zstd', [
    { type: 'assistant/message', data: { turn: 0, step: 0, usage: { inputTokens: 42 } } },
  ]);
  let stored;
  const tracker = createGrowthTracker({
    sessionsDir: root,
    getGrowth: () => stored,
    saveGrowth: (next) => { stored = next; },
  });
  t.after(() => tracker.close());
  // A synchronous main-thread scan starves the event loop for the whole
  // decode — this pump can only tick while the main thread is free. One
  // worker round-trip always crosses at least one loop turn, so >0 proves
  // the scan did not block here.
  let pumped = 0;
  let done = false;
  const pump = (async () => {
    while (!done) {
      await new Promise((resolve) => setImmediate(resolve));
      pumped += 1;
    }
  })();
  const g = await tracker.refresh();
  done = true;
  await pump;
  assert.equal(g.tokensSeen, 42);
  assert.ok(pumped > 0, 'main thread stayed responsive while the log decoded');
});

test('concurrent refreshes share one scan', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  const scanTokens = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { total: 7, sessions: 1 };
  };
  const { tracker } = trackerWith(root, { baseline: 0 }, scanTokens);
  const [a, b] = await Promise.all([tracker.refresh(), tracker.refresh()]);
  assert.equal(calls, 1, 'overlapping refresh calls coalesce');
  assert.equal(a.tokensSeen, 7);
  assert.equal(b.tokensSeen, 7);
});

test('a failed scan rejects refresh and the tracker recovers', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-growth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let fail = true;
  const scanTokens = async () => {
    if (fail) {
      throw new Error('disk gone');
    }
    return { total: 3, sessions: 1 };
  };
  const { tracker, read } = trackerWith(root, { baseline: 0 }, scanTokens);
  await assert.rejects(tracker.refresh(), /disk gone/);
  assert.equal(read()?.tokensSeen ?? 0, 0, 'a failed scan writes no state');
  fail = false;
  const g = await tracker.refresh();
  assert.equal(g.tokensSeen, 3);
});

test('asarUnpack ships the whole scan worker import chain', () => {
  // The worker thread reads its entry through real fs — anything left inside
  // app.asar makes the packaged scan die silently and growth goes stale.
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const unpacked = new Set(pkg.build.asarUnpack);
  const root = path.join(__dirname, '..', '..');
  const seen = new Set();
  const queue = [path.join(__dirname, 'pet-growth-scan-worker.js')];
  while (queue.length) {
    let file = queue.pop();
    if (!fs.existsSync(file) && fs.existsSync(`${file}.js`)) {
      file = `${file}.js`; // require('./pet-growth') resolves the extension
    }
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (seen.has(rel) || !fs.existsSync(file)) {
      continue;
    }
    seen.add(rel);
    for (const match of fs.readFileSync(file, 'utf8')
      .matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      queue.push(path.resolve(path.dirname(file), match[1]));
    }
  }
  assert.ok(seen.has('src/main/pet-growth.js'));
  for (const rel of seen) {
    assert.ok(unpacked.has(rel), `${rel} is imported by the pet scan worker but missing from build.asarUnpack`);
  }
});
