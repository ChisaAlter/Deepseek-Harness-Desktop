import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as harness from './measure-desktop-lifecycle.mjs';
import worker from './lib/desktop-perf-worker.cjs';

const {
  CASE_IDS,
  MEASURED_INVOCATIONS,
  MEMORY_SETTLE_MS,
  WARMUP_INVOCATIONS,
  cpuDeltaMicros,
  createHeartbeat,
  digestOf,
  installSpawnRecorder,
  measureCase,
  median,
  medianAbsoluteDeviation,
  projectResult,
  stableStringify,
  summarizeSeries,
} = worker;

const {
  BLOCKING_THRESHOLD,
  CASE_IDS: HARNESS_CASE_IDS,
  MEMORY_THRESHOLD,
  REPEATABILITY,
  TERMINATION_GRACE_MS,
  THRESHOLDS,
  applyInputGate,
  caseOrderForBatch,
  createChildLedger,
  decide,
  executionStatus,
  hashFiles,
  inventoryFixture,
  mustNotBeInsideRepo,
  persistedCaseRow,
  prepareFixture,
  probeProcess,
  round,
  runWorker,
  processAlive,
  runControlAfter,
  signalOpenChildren,
  stopReasonFor,
  survivingChildren,
  thresholdForCase,
  validateWorkerResult,
  workerIdentityFor,
} = harness;

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-c1-test-'));
}

/** A fixture root that does not exist yet: prepareFixture owns its location. */
function newFixtureRoot() {
  return path.join(tempRoot(), 'fixtures');
}

const TINY_SIZES = {
  manySmallSessions: 12,
  oneLongTargetBytes: 16 * 1024,
  filesSmall: 20,
  filesLarge: 40,
  ignoredEvery: 5,
};

test('the six fixed case ids are exactly the declared set', () => {
  assert.deepEqual(CASE_IDS, ['P1', 'P2', 'S1', 'S2', 'F1', 'F2']);
  assert.deepEqual(HARNESS_CASE_IDS, CASE_IDS);
  assert.equal(new Set(CASE_IDS).size, CASE_IDS.length);
});

test('sample accounting constants match the predeclared protocol', () => {
  assert.equal(MEASURED_INVOCATIONS, 10);
  assert.equal(WARMUP_INVOCATIONS, 2);
  assert.equal(MEMORY_SETTLE_MS, 100);
});

test('thresholds are fixed values recorded before measurement', () => {
  assert.equal(THRESHOLDS.probeImportHold.limitMs, 25);
  assert.equal(THRESHOLDS.scanImport.limitMs, 250);
  assert.equal(THRESHOLDS.listDirSmall.limitMs, 100);
  assert.equal(THRESHOLDS.listDirLarge.limitMs, 250);
  assert.equal(BLOCKING_THRESHOLD.absoluteMs, 50);
  assert.equal(BLOCKING_THRESHOLD.aboveControlMs, 30);
  assert.equal(REPEATABILITY.absoluteMs, 5);
});

test('median and MAD are computed on the samples, not on a fitted model', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(medianAbsoluteDeviation([1, 2, 3, 4], 2.5), 1);
});

test('an empty series reports null statistics, never zero', () => {
  const summary = summarizeSeries([]);
  assert.equal(summary.count, 0);
  assert.equal(summary.median, null);
  assert.equal(summary.min, null);
  assert.equal(summary.max, null);
  assert.equal(summary.mad, null);
});

test('non-finite and missing samples are dropped, not coerced to zero', () => {
  const summary = summarizeSeries([10, undefined, null, Number.NaN, 20]);
  assert.deepEqual(summary.samples, [10, 20]);
  assert.equal(summary.count, 2);
  assert.equal(summary.median, 15);
  assert.equal(summary.min, 10);
  assert.equal(summary.max, 20);
});

test('cpuUsage microseconds convert to milliseconds with the correct unit', () => {
  const delta = cpuDeltaMicros({ user: 1_000_000, system: 2_500_000 }, { user: 4_000_000, system: 4_000_000 });
  assert.equal(delta.userMs, 3000);
  assert.equal(delta.systemMs, 1500);
  assert.equal(delta.totalMs, 4500);
});

test('a clock that reports a smaller after value cannot yield negative CPU time', () => {
  const delta = cpuDeltaMicros({ user: 5_000, system: 5_000 }, { user: 1_000, system: 2_000 });
  assert.equal(delta.userMs, 0);
  assert.equal(delta.systemMs, 0);
  assert.equal(delta.totalMs, 0);
});

test('projectResult is deterministic and key-order independent', () => {
  const a = projectResult('P1', { hold: true, sourceHasData: true, destEmpty: true });
  const b = projectResult('P1', { destEmpty: true, hold: true, sourceHasData: true });
  assert.deepEqual(a, b);
  assert.equal(stableStringify(a), stableStringify(b));
  assert.equal(digestOf(a), digestOf(b));
});

test('a wrong result digest is distinguishable from the expected digest', () => {
  const expected = digestOf({ destEmpty: true, sourceHasData: true, hold: true });
  const wrong = digestOf({ destEmpty: true, sourceHasData: false, hold: false });
  assert.notEqual(expected, wrong);
  assert.match(expected, /^sha256:[0-9a-f]{64}$/);
});

test('projectResult projects the S2 final title, not the early one', () => {
  const projected = projectResult('S2', {
    sessions: [{
      id: 'long-session',
      cwd: 'C:/fixture/long',
      title: 'final title',
      createdAt: '1700000000002',
      compressedLog: false,
    }],
  });
  assert.equal(projected.count, 1);
  assert.equal(projected.sessions[0].title, 'final title');
  assert.notEqual(projected.sessions[0].title, 'early title');
});

test('projectResult exposes only display fields, never file bodies or hosts', () => {
  const projected = projectResult('S1', {
    sessions: [{
      id: 'a',
      cwd: 'C:/x',
      title: 't',
      createdAt: '1',
      compressedLog: false,
      abs: 'C:/secret/abs/path',
      logs: ['session.jsonl'],
      conflict: true,
    }],
    sourceHome: 'C:/secret/source',
    homeDir: 'C:/Users/someone',
  });
  const serialized = JSON.stringify(projected);
  assert.ok(!serialized.includes('session.jsonl'));
  assert.ok(!serialized.includes('C:/secret'));
  assert.ok(!serialized.includes('C:/Users/someone'));
  assert.equal(projected.sessions[0].id, 'a');
});

test('a listing projection preserves production ordering and drops ignored entries', () => {
  const projected = projectResult('F1', {
    ok: true,
    entries: [
      { name: 'kept_000.txt', kind: 'file' },
      { name: 'kept_001.txt', kind: 'file' },
    ],
  });
  assert.deepEqual(projected.entries.map((row) => row.name), ['kept_000.txt', 'kept_001.txt']);
  assert.ok(!projected.entries.some((row) => row.name.startsWith('ignored_')));
});

test('the projection rejects an unknown case instead of returning undefined', () => {
  assert.throws(() => projectResult('ZZ', {}), /unknown case ZZ/);
});

test('thresholdForCase maps every case to its predeclared threshold', () => {
  assert.equal(thresholdForCase('P1').limitMs, 25);
  assert.equal(thresholdForCase('P2').limitMs, 25);
  assert.equal(thresholdForCase('S1').limitMs, 250);
  assert.equal(thresholdForCase('S2').limitMs, 250);
  assert.equal(thresholdForCase('F1').limitMs, 100);
  assert.equal(thresholdForCase('F2').limitMs, 250);
});

test('batch two reverses case order to expose ordering effects', () => {
  assert.deepEqual(caseOrderForBatch(0), [...CASE_IDS]);
  assert.deepEqual(caseOrderForBatch(1), [...CASE_IDS].reverse());
});

test('round keeps a stable, bounded precision for reported metrics', () => {
  assert.equal(round(1.23456, 3), 1.235);
  assert.equal(round(0.1 + 0.2, 3), 0.3);
  assert.equal(round(null), null);
  assert.equal(round(Number.NaN), null);
});

/* ------------------------------------------------------------------ */
/* Fixture preparation                                                 */
/* ------------------------------------------------------------------ */

test('fixture preparation writes deterministic sizes and precomputed digests', () => {
  const root = newFixtureRoot();
  try {
    const manifest = prepareFixture(root, process.cwd(), TINY_SIZES);
    assert.ok(manifest.expectedDigests, 'manifest carries expected digests');
    for (const caseId of CASE_IDS) {
      assert.match(manifest.expectedDigests[caseId], /^sha256:[0-9a-f]{64}$/);
    }
    assert.ok(manifest.byteCounts.manySmallTotalBytes > 0);
    assert.ok(manifest.byteCounts.oneLongBytes > 16 * 1024);
    assert.equal(manifest.cases.S1.sessions, 12);
    // 20 numbered files + .gitignore + ignore-me-too.txt
    assert.equal(manifest.cases.F1.files, 22);
    // .gitignore is visible; every 5th numbered file plus ignore-me-too.txt is not.
    assert.equal(manifest.listings['files-small'].visibleCount, 17);
  } finally {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  }
});

test('prepareFixture refuses to reuse an existing fixture root', () => {
  const root = newFixtureRoot();
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'operator-data.txt'), 'do not delete\n');
    assert.throws(
      () => prepareFixture(root, process.cwd(), TINY_SIZES),
      /refusing to reuse an existing fixture root/,
    );
    assert.equal(fs.readFileSync(path.join(root, 'operator-data.txt'), 'utf8'), 'do not delete\n');
  } finally {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  }
});

test('the fixture builder refuses to write inside the source checkout', () => {
  assert.throws(
    () => mustNotBeInsideRepo(path.join(process.cwd(), 'nested-fixture')),
    /refusing to write inside the source checkout/,
  );
});

test('fixture inventory records entries, sizes and JSONL record counts', () => {
  const root = newFixtureRoot();
  try {
    const manifest = prepareFixture(root, process.cwd(), TINY_SIZES);
    const inventory = inventoryFixture(root, manifest);
    assert.equal(inventory.observed.sourceManySmallEntries, 12);
    assert.equal(inventory.observed.filesSmallEntries, 22);
    assert.equal(inventory.observed.oneLongRecordCount, 4);
    assert.equal(inventory.observed.oneLongBytes, manifest.byteCounts.oneLongBytes);
    assert.equal(inventory.rows.filesSmall.entries, 22);
    assert.equal(inventory.rows.sourceManySmall.files[0].recordCount, 3);
    // Expected record count is the SUM across sessions, not the per-log count;
    // a mismatch here was the first thing the hardened input gate caught.
    assert.equal(inventory.expected.manySmallRecordCount, 12 * 3);
    assert.equal(inventory.observed.manySmallRecordCount, 12 * 3);
    assert.equal(inventory.digest, inventoryFixture(root, manifest).digest);
  } finally {
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* First-invocation and memory protocol (deterministic, injected)      */
/* ------------------------------------------------------------------ */

function injectedCase() {
  let calls = 0;
  return {
    call: async () => {
      calls += 1;
      return { value: calls };
    },
    project: () => ({ ok: true }),
    oracle: () => true,
    detail: { case: 'P1' },
    modules: { finish: () => ({ entries: [], totalMs: 0 }) },
    calls: () => calls,
  };
}

function quietControls() {
  return {
    statistic: 'per-window-max-lateness-ms',
    blockMs: 40,
    detected: true,
    detectedMs: 45,
    calibrationBlockMs: 40,
    calibrationDetected: true,
    calibrationDetectedMs: 45,
    noWork: { maxLatenessMs: 1, medianLatenessMs: 0.5, latenessMs: [0.5, 1] },
    blocked: { maxLatenessMs: 45, medianLatenessMs: 40, latenessMs: [40, 45] },
    outcomes: [
      { probe: 'no-work-control', statistic: 'per-window-max-lateness-ms', valueMs: 1, observationsMs: [1] },
      { probe: 'deliberate-block-calibration', statistic: 'per-window-max-lateness-ms', valueMs: 45, observationsMs: [45] },
    ],
  };
}

function injectedContext() {
  return {
    fixtureRoot: path.join(os.tmpdir(), 'dshd-injected-fixture'),
    sourceRoot: path.resolve('.'),
    gitDir: null,
    expectedDigests: { P1: digestOf({ ok: true }) },
  };
}

async function measureInjected() {
  const testCase = injectedCase();
  const result = await measureCase('P1', injectedContext(), {
    createCase: () => testCase,
    resolveCasePaths: () => ({}),
    probeControls: quietControls,
    sleep: async () => {},
  });
  return { result, calls: testCase.calls() };
}

test('the first timed sample is the ACTUAL first production call', async () => {
  const { result, calls } = await measureInjected();
  assert.equal(result.ok, true);
  // 1 first invocation + 2 warmups + 10 measured, no untimed control call.
  assert.equal(calls, 1 + WARMUP_INVOCATIONS + MEASURED_INVOCATIONS);
  assert.ok(Number.isFinite(result.firstInvocation.durationMs));
  assert.equal(result.firstInvocation.ok, true);
});

test('a first-invocation failure is reported without any extra control call', async () => {
  const testCase = injectedCase();
  testCase.oracle = () => false;
  const result = await measureCase('P1', injectedContext(), {
    createCase: () => testCase,
    resolveCasePaths: () => ({}),
    probeControls: quietControls,
    sleep: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure, 'CORRECTNESS_FAILURE');
  assert.equal(result.failurePhase, 'first invocation');
  assert.equal(testCase.calls(), 1, 'a bad first call stops immediately');
});

test('memory is published as ten per-invocation post-yield observations', async () => {
  const { result } = await measureInjected();
  assert.equal(result.memory.protocol, 'per-invocation-post-yield-growth');
  assert.equal(result.memory.settleMs, MEMORY_SETTLE_MS);
  assert.equal(result.memory.observations.length, MEASURED_INVOCATIONS);
  assert.deepEqual(
    result.memory.observations.map((row) => row.index),
    Array.from({ length: MEASURED_INVOCATIONS }, (_, index) => index + 1),
  );
  for (const row of result.memory.observations) {
    assert.equal(row.settleMs, MEMORY_SETTLE_MS);
    assert.ok(Number.isFinite(row.afterInvocationBytes.rssBytes));
    assert.ok(Number.isFinite(row.postYieldBytes.rssBytes));
  }
  assert.equal(result.memory.rssGrowthBytes.count, MEASURED_INVOCATIONS);
  assert.equal(result.memory.heapGrowthBytes.count, MEASURED_INVOCATIONS);
});

/* ------------------------------------------------------------------ */
/* Heartbeat scheduling correctness (deterministic scheduler)          */
/* ------------------------------------------------------------------ */

function makeDeterministicClock() {
  let currentTime = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    hooks: {
      now: () => currentTime,
      setTimeout: (callback, delay) => {
        const id = nextId;
        nextId += 1;
        timers.set(id, { callback, at: currentTime + delay });
        return id;
      },
      clearTimeout: (id) => { timers.delete(id); },
      sleep: async (ms) => { currentTime += ms; },
    },
    /** Advance the clock without letting any timer run: the "blocked loop". */
    jump(ms) {
      currentTime += ms;
    },
    /**
     * Let every timer whose deadline has passed fire now. A timer that was due
     * while the clock was jumped observes the CURRENT time, which is how a real
     * blocked event loop reports lateness.
     */
    advance(ms) {
      const target = currentTime + ms;
      currentTime = target;
      let progressed = true;
      while (progressed) {
        progressed = false;
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= currentTime)
          .sort((left, right) => left[1].at - right[1].at);
        if (due.length > 0) {
          progressed = true;
          const [id, timer] = due[0];
          timers.delete(id);
          timer.callback();
        }
      }
    },
    pendingTimers: () => timers.size,
  };
}

test('arm() re-arms the timer and its deadline together', async () => {
  const clock = makeDeterministicClock();
  const heartbeat = createHeartbeat(10, clock.hooks);
  await heartbeat.arm();
  assert.equal(clock.pendingTimers(), 1);
  assert.equal(heartbeat.deadlineMs(), 40, 'deadline re-armed with its own timer');

  clock.advance(10);
  assert.deepEqual(heartbeat.stop().latenessMs, [0]);
});

test('the spawn observer records each task-owned child and its bookkeeping cost', async () => {
  const recorder = installSpawnRecorder();
  assert.equal(recorder.instrumented, true);
  // Read the CJS property at call time: production modules destructure
  // `spawn` at load, which is exactly why the observer is installed first.
  const childProcess = createRequire(import.meta.url)('node:child_process');
  const child = childProcess.spawn(process.execPath, ['-e', 'process.exit(0)'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  await new Promise((resolve) => { child.on('close', resolve); });
  const summary = recorder.summary();
  assert.equal(summary.spawnCount, 1);
  assert.equal(summary.children.length, 1);
  assert.equal(summary.children[0].pid, child.pid);
  assert.equal(summary.children[0].exitCode, 0);
  assert.ok(Number.isFinite(summary.children[0].durationMs));
  assert.ok(summary.bookkeepingOverheadMs >= 0);
});

test('a delayed tick is attributed to the deadline the timer actually had', async () => {
  const clock = makeDeterministicClock();
  const heartbeat = createHeartbeat(10, clock.hooks);
  await heartbeat.arm();
  clock.jump(35);
  clock.advance(0);
  const stats = heartbeat.stop();
  assert.ok(stats.latenessMs.length >= 1);
  assert.ok(stats.latenessMs[0] >= 25, `expected blocking lateness, saw ${stats.latenessMs[0]}`);
});

/* ------------------------------------------------------------------ */
/* Worker output validation (real function)                            */
/* ------------------------------------------------------------------ */

function successPayload(caseId = 'P1') {
  const samples = Array.from({ length: MEASURED_INVOCATIONS }, (_, index) => 5 + index * 0.1);
  return {
    schemaVersion: worker.SCHEMA_VERSION,
    case: caseId,
    result: {
      case: caseId,
      ok: true,
      projectionDigest: digestOf({ ok: true }),
      expectedDigest: digestOf({ ok: true }),
      measured: {
        count: MEASURED_INVOCATIONS,
        durationMs: { samples },
        authoritativeDurationSeries: 'rawDurationMs',
        heartbeatMaxLatenessMs: { samples: samples.map(() => 2) },
      },
      controls: quietControls(),
      memory: {
        protocol: 'per-invocation-post-yield-growth',
        observations: samples.map((_, index) => ({
          index: index + 1,
          afterInvocationBytes: { rssBytes: 100, heapUsedBytes: 50 },
          postYieldBytes: { rssBytes: 101, heapUsedBytes: 51 },
        })),
      },
    },
  };
}

test('a success-shaped payload with a nonzero exit code is rejected', () => {
  const payload = successPayload();
  const validation = validateWorkerResult({ payload, exitCode: 1 }, 'P1', payload.result.projectionDigest);
  assert.equal(validation.ok, false);
  assert.equal(validation.failure, 'NONZERO_EXIT');
});

test('case identity, schema and digest mismatches are all rejected', () => {
  const payload = successPayload();
  assert.equal(validateWorkerResult({ payload, exitCode: 0 }, 'P2', null).failure, 'CASE_MISMATCH');
  const wrongSchema = JSON.parse(JSON.stringify(payload));
  wrongSchema.schemaVersion = 1;
  assert.equal(
    validateWorkerResult({ payload: wrongSchema, exitCode: 0 }, 'P1', null).failure,
    'SCHEMA_MISMATCH',
  );
  assert.equal(
    validateWorkerResult({ payload, exitCode: 0 }, 'P1', digestOf({ tampered: true })).failure,
    'DIGEST_MISMATCH',
  );
});

test('missing samples, calibration or memory observations are rejected', () => {
  const shortSamples = successPayload();
  shortSamples.result.measured.durationMs.samples.pop();
  assert.equal(
    validateWorkerResult({ payload: shortSamples, exitCode: 0 }, 'P1', null).failure,
    'MISSING_SAMPLES',
  );

  const noCalibration = successPayload();
  noCalibration.result.controls = { detected: true };
  assert.equal(
    validateWorkerResult({ payload: noCalibration, exitCode: 0 }, 'P1', null).failure,
    'MISSING_CALIBRATION',
  );

  const noMemory = successPayload();
  noMemory.result.memory.observations.pop();
  assert.equal(
    validateWorkerResult({ payload: noMemory, exitCode: 0 }, 'P1', null).failure,
    'MISSING_MEMORY',
  );
});

test('runWorker refuses a worker that prints success JSON but exits nonzero', async () => {
  const dir = tempRoot();
  try {
    const fake = path.join(dir, 'fake-worker.cjs');
    const payload = successPayload();
    fs.writeFileSync(fake, [
      "'use strict';",
      `const payload = ${JSON.stringify(payload)};`,
      "process.stdout.write('PERF_RESULT ' + JSON.stringify(payload) + '\\n');",
      'process.exitCode = 3;',
    ].join('\n'));
    const outcome = await runWorker({
      nodePath: process.execPath,
      workerPath: fake,
      caseId: 'P1',
      fixtureRoot: dir,
      sourceRoot: dir,
      jsonOut: path.join(dir, 'out.json'),
      timeoutMs: 10_000,
      expectedDigest: payload.result.projectionDigest,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.failure, 'NONZERO_EXIT');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runWorker reports malformed output instead of treating it as success', async () => {
  const dir = tempRoot();
  try {
    const fake = path.join(dir, 'malformed.cjs');
    fs.writeFileSync(fake, "process.stdout.write('not a result\\n');\n");
    const outcome = await runWorker({
      nodePath: process.execPath,
      workerPath: fake,
      caseId: 'P1',
      fixtureRoot: dir,
      sourceRoot: dir,
      jsonOut: path.join(dir, 'out.json'),
      timeoutMs: 10_000,
      expectedDigest: null,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.failure, 'MALFORMED_OUTPUT');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a timeout is explicit, stops expansion, and never becomes a success payload', async () => {
  const dir = tempRoot();
  let childPid = null;
  try {
    const fake = path.join(dir, 'stalling.cjs');
    // The fake worker announces a task-owned child exactly like the real spawn
    // observer, prints a success-shaped payload, then blocks forever.
    fs.writeFileSync(fake, [
      "'use strict';",
      "const { spawn } = require('node:child_process');",
      `const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true });`,
      "process.stdout.write('PERF_CHILD ' + JSON.stringify({ pid: child.pid, command: 'node' }) + '\\n');",
      "process.stdout.write('PERF_RESULT ' + JSON.stringify({ schemaVersion: 2, case: 'P1', result: { ok: true } }) + '\\n');",
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    const outcome = await runWorker({
      nodePath: process.execPath,
      workerPath: fake,
      caseId: 'P1',
      fixtureRoot: dir,
      sourceRoot: dir,
      jsonOut: path.join(dir, 'out.json'),
      timeoutMs: 400,
      expectedDigest: null,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.failure, 'WORKER_TIMEOUT', 'timeout is retained, not rewritten');
    assert.equal(outcome.timedOut, true);
    assert.ok(Array.isArray(outcome.children) && outcome.children.length >= 1);
    childPid = outcome.children[0].pid;
    assert.ok(Number.isFinite(childPid), 'child identity survives the kill');
    assert.equal(stopReasonFor(outcome), 'WORKER_TIMEOUT');
    // Termination of the announced child is confirmed rather than assumed.
    await new Promise((resolve) => { setTimeout(resolve, 250); });
    assert.throws(() => process.kill(childPid, 0), /ESRCH|kill/);
  } finally {
    if (Number.isFinite(childPid)) {
      try { process.kill(childPid, 'SIGKILL'); } catch { /* already gone */ }
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an ordinary worker failure does not stop the run', () => {
  assert.equal(stopReasonFor({ failure: 'MALFORMED_OUTPUT' }), null);
  assert.equal(stopReasonFor({ failure: 'NONZERO_EXIT' }), null);
});

test('an unconfirmed termination is fatal and launches nothing after it', () => {
  // Drive the same control decision the orchestrator uses, with a synthetic
  // outcome stream. The unresolved case must end the loop before any later
  // case is launched.
  const cases = ['P1', 'S1', 'S2', 'F1'];
  const outcomes = {
    P1: { ok: true, failure: null },
    S1: { ok: false, failure: 'UNRESOLVED_PROCESS' },
  };
  const launched = [];
  const invalid = [];
  let fatal = null;
  for (const caseId of cases) {
    if (fatal) {
      invalid.push({ caseId, reason: fatal.reason });
      continue;
    }
    launched.push(caseId);
    const control = runControlAfter(outcomes[caseId]);
    if (control.fatal) fatal = control;
  }
  assert.deepEqual(launched, ['P1', 'S1'], 'no case is launched after an unresolved child');
  assert.deepEqual(invalid, [
    { caseId: 'S2', reason: 'UNRESOLVED_PROCESS' },
    { caseId: 'F1', reason: 'UNRESOLVED_PROCESS' },
  ]);
  assert.equal(fatal.reason, 'UNRESOLVED_PROCESS');
  assert.equal(runControlAfter({ failure: 'WORKER_TIMEOUT' }).fatal, false);
  assert.equal(runControlAfter({ failure: 'WORKER_TIMEOUT' }).reason, 'WORKER_TIMEOUT');
  assert.equal(runControlAfter({ failure: 'MALFORMED_OUTPUT' }).stop, false);
});

/* ------------------------------------------------------------------ */
/* runWorker termination interleavings (injected spawn/probe/timers)    */
/* ------------------------------------------------------------------ */

/**
 * A fake spawn handle that never touches the OS. Each test decides exactly when
 * the worker "closes", whether its kill is delivered, and whether a tracked
 * child is still alive, so every interleaving is deterministic.
 */
function fakeSpawnHandle({ killResult = true, killThrows = false, killEmitsError = null, pid = 424242 } = {}) {
  const listeners = { close: [], error: [] };
  const handle = {
    pid,
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    on(event, handler) {
      if (listeners[event]) listeners[event].push(handler);
      return handle;
    },
    kill(signal) {
      handle.killCalls = (handle.killCalls || 0) + 1;
      handle.killedWith = signal;
      if (killThrows) throw Object.assign(new Error('kill failed'), { code: 'EPERM' });
      // Node can emit `error` from kill() itself (for example when the signal
      // cannot be delivered) even though the worker was created successfully.
      if (killEmitsError) {
        const error = Object.assign(new Error(killEmitsError.message), { code: killEmitsError.code });
        for (const handler of listeners.error) handler(error);
      }
      return killResult;
    },
    listenerCount(event) { return (listeners[event] || []).length; },
    emit(event, ...args) {
      for (const handler of listeners[event] || []) handler(...args);
    },
  };
  return handle;
}

/** A controllable clock: grace periods expire without real waiting. */
function fakeClock(start = 0) {
  const timers = [];
  const state = { time: start };
  return {
    now: () => state.time,
    setTimeout: (fn, ms) => {
      const entry = { fn, at: state.time + ms, cancelled: false, fired: false };
      timers.push(entry);
      return entry;
    },
    clearTimeout: (entry) => { if (entry) entry.cancelled = true; },
    advance(ms) {
      state.time += ms;
      for (let guard = 0; guard < 500; guard += 1) {
        const due = timers.find((entry) => !entry.cancelled && !entry.fired && entry.at <= state.time);
        if (!due) return;
        due.fired = true;
        due.fn();
      }
      throw new Error('timer loop did not settle');
    },
  };
}

/** Wire a fake handle that announces one tracked child as soon as we ask. */
function announcingHandle(pid) {
  const handle = fakeSpawnHandle({ killResult: true });
  handle.stdout = {
    on(event, handler) {
      if (event === 'data') handler(`${CHILD}${JSON.stringify({ pid, command: 'node' })}\n`);
    },
  };
  return handle;
}

const RUN_WORKER_ARGS = {
  nodePath: 'node',
  workerPath: 'worker.cjs',
  fixtureRoot: 'fixture',
  sourceRoot: 'source',
  jsonOut: 'out.json',
  expectedDigest: null,
};

test('a failed worker kill is never confirmed as a clean exit', async () => {
  const handle = fakeSpawnHandle({ killResult: false });
  const clock = fakeClock();
  const outcome = runWorker({ ...RUN_WORKER_ARGS, caseId: 'P1', timeoutMs: 50 }, {
    spawnWorker: () => handle,
    probeAsync: () => ({ status: 'absent' }),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    signal: () => {},
  });
  clock.advance(50);
  // The timeout fired, but the worker was never observed exiting and its kill
  // reported false: no confirmation may be claimed.
  clock.advance(TERMINATION_GRACE_MS);
  const result = await outcome;
  assert.equal(result.failure, 'UNRESOLVED_PROCESS');
  assert.equal(result.terminationConfirmed, false);
  assert.equal(result.workerExitConfirmed, false);
  assert.deepEqual(result.unresolvedWorker, [424242]);
  assert.equal(result.requestedFailure, 'WORKER_TIMEOUT');
  assert.equal(result.workerKill.signaled, false);
});

test('a timed-out worker whose close arrives later is not confirmed early', async () => {
  const handle = fakeSpawnHandle({ killResult: true });
  const clock = fakeClock();
  const outcome = runWorker({ ...RUN_WORKER_ARGS, caseId: 'P1', timeoutMs: 50 }, {
    spawnWorker: () => handle,
    probeAsync: () => ({ status: 'absent' }),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    signal: () => {},
  });
  clock.advance(50);
  clock.advance(100);
  let settledEarly = false;
  outcome.then(() => { settledEarly = true; });
  await Promise.resolve();
  assert.equal(settledEarly, false, 'no resolution before the worker exit is observed');
  handle.emit('close', null, 'SIGKILL');
  const result = await outcome;
  assert.equal(result.failure, 'WORKER_TIMEOUT');
  assert.equal(result.terminationConfirmed, true);
  assert.equal(result.workerExitConfirmed, true);
});

test('a worker close does not bypass child polling during a timeout', async () => {
  const handle = announcingHandle(515151);
  const clock = fakeClock();
  let childAlive = true;
  const outcome = runWorker({ ...RUN_WORKER_ARGS, caseId: 'F1', timeoutMs: 50 }, {
    spawnWorker: () => handle,
    probeAsync: () => (childAlive ? { status: 'alive' } : { status: 'absent' }),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    signal: () => {},
  });
  clock.advance(50);
  handle.emit('close', null, 'SIGKILL');
  clock.advance(100);
  let resolved = false;
  outcome.then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false, 'a surviving child keeps the case unresolved');
  childAlive = false;
  clock.advance(25);
  const result = await outcome;
  assert.equal(result.failure, 'WORKER_TIMEOUT');
  assert.equal(result.terminationConfirmed, true);
  assert.deepEqual(result.unresolvedChildren, []);
});

test('an unexpected existence-probe error stays unresolved, never absence', async () => {
  const handle = announcingHandle(525252);
  const clock = fakeClock();
  const outcome = runWorker({ ...RUN_WORKER_ARGS, caseId: 'F1', timeoutMs: 50 }, {
    spawnWorker: () => handle,
    probeAsync: () => ({ status: 'unknown', error: 'EINVAL' }),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    signal: () => {},
  });
  clock.advance(50);
  handle.emit('close', null, 'SIGKILL');
  clock.advance(TERMINATION_GRACE_MS);
  const result = await outcome;
  assert.equal(result.failure, 'UNRESOLVED_PROCESS');
  assert.equal(result.terminationConfirmed, false);
  assert.deepEqual(result.unresolvedChildren, [525252]);
});

test('probeProcess distinguishes alive, absent and unknown', () => {
  assert.equal(probeProcess(0).status, 'absent');
  assert.equal(probeProcess(-1).status, 'absent');
  assert.equal(probeProcess(1.5).status, 'absent');
  assert.equal(probeProcess(process.pid).status, 'alive');
  assert.equal(probeProcess(2147483647).status, 'absent');
  // The boolean view never turns an unknown answer into "gone".
  assert.equal(processAlive(process.pid), true);
  assert.equal(processAlive(2147483647), false);
});

test('a post-spawn kill error never becomes an early SPAWN_ERROR', async () => {
  const handle = fakeSpawnHandle({
    killResult: false,
    killEmitsError: { code: 'EPERM', message: 'kill EPERM' },
  });
  const clock = fakeClock();
  const outcome = runWorker({ ...RUN_WORKER_ARGS, caseId: 'P1', timeoutMs: 50 }, {
    spawnWorker: () => handle,
    probeAsync: () => ({ status: 'absent' }),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    signal: () => {},
  });
  clock.advance(50);
  // The error arrived, but the worker was never observed exiting: no early
  // SPAWN_ERROR may be produced, and the grace observer must stay alive.
  clock.advance(100);
  let settledEarly = false;
  outcome.then(() => { settledEarly = true; });
  await Promise.resolve();
  assert.equal(settledEarly, false, 'a post-spawn error must not finish the case');
  clock.advance(TERMINATION_GRACE_MS);
  const result = await outcome;
  assert.equal(result.failure, 'UNRESOLVED_PROCESS');
  assert.equal(result.terminationConfirmed, false);
  assert.equal(result.workerPid, 424242, 'the spawned PID is preserved through the error path');
  assert.deepEqual(result.unresolvedWorker, [424242]);
  assert.equal(result.requestedFailure, 'WORKER_TIMEOUT');
  assert.equal(result.workerKill.attempted, true);
  assert.equal(result.workerKill.signaled, false);
  assert.equal(result.workerKill.error, 'EPERM', 'the kill error is evidence, not an outcome');
  assert.equal(result.workerError.code, 'EPERM');
  assert.equal(handle.killCalls, 1, 'an error emitted by kill() must not recurse into a second kill');

  // The actual returned outcome must survive the production report path and
  // still stop the run with a nonzero execution status.
  const identity = workerIdentityFor(result, 'C:/tmp/desktop-perf-worker.cjs', 'sha256:abc');
  assert.equal(identity.pid, 424242);
  assert.equal(identity.terminated, false);
  assert.equal(identity.workerError.code, 'EPERM');
  const row = persistedCaseRow({ ...result, worker: identity });
  assert.equal(row.worker.pid, 424242);
  assert.deepEqual(row.unresolvedWorker, [424242]);
  assert.equal(row.requestedFailure, 'WORKER_TIMEOUT');
  const control = runControlAfter(result);
  assert.equal(control.fatal, true);
  assert.equal(control.reason, 'UNRESOLVED_PROCESS');
  const status = executionStatus({
    decision: { verdict: 'INCONCLUSIVE' },
    invalidExecution: false,
    inputGateViolations: [],
    unresolvedProcess: { batch: 1, case: 'P1' },
  });
  assert.equal(status.ok, false);
  assert.notEqual(status.exitCode, 0);
});

test('a post-spawn kill error followed by a late close still confirms termination', async () => {
  const handle = fakeSpawnHandle({
    killResult: false,
    killEmitsError: { code: 'EPERM', message: 'kill EPERM' },
  });
  const clock = fakeClock();
  const outcome = runWorker({ ...RUN_WORKER_ARGS, caseId: 'P1', timeoutMs: 50 }, {
    spawnWorker: () => handle,
    probeAsync: () => ({ status: 'absent' }),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    signal: () => {},
  });
  clock.advance(50);
  clock.advance(200);
  handle.emit('close', null, 'SIGKILL');
  const result = await outcome;
  assert.equal(result.failure, 'WORKER_TIMEOUT');
  assert.equal(result.terminationConfirmed, true);
  assert.equal(result.workerExitConfirmed, true);
  // The error remains visible even though cleanup was eventually confirmed.
  assert.equal(result.workerError.code, 'EPERM');
  assert.equal(result.workerKill.error, 'EPERM');
});

test('a genuine spawn failure with no PID stays a bounded SPAWN_ERROR', async () => {
  const handle = fakeSpawnHandle({ pid: null });
  const clock = fakeClock();
  const outcome = runWorker({ ...RUN_WORKER_ARGS, caseId: 'P1', timeoutMs: 50 }, {
    spawnWorker: () => handle,
    probeAsync: () => ({ status: 'absent' }),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    now: clock.now,
    signal: () => {},
  });
  handle.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
  clock.advance(50);
  clock.advance(TERMINATION_GRACE_MS);
  const result = await outcome;
  assert.equal(result.failure, 'SPAWN_ERROR');
  assert.equal(result.workerPid, null);
  assert.equal(result.terminationConfirmed, false);
  assert.equal(result.workerError.code, 'ENOENT');
  assert.equal(result.workerKill, null, 'no process exists to signal');
  assert.equal(runControlAfter(result).fatal, false, 'a creation failure is not an unresolved process');
});

test('report serialization keeps the spawned PID and termination evidence without a payload', () => {
  const failedOutcome = {
    case: 'F1',
    ok: false,
    failure: 'UNRESOLVED_PROCESS',
    requestedFailure: 'WORKER_TIMEOUT',
    workerPid: 777001,
    exitCode: null,
    signal: 'SIGKILL',
    timedOut: true,
    terminationConfirmed: false,
    workerExitConfirmed: true,
    workerKill: { attempted: true, signaled: true, error: null },
    signalAttempts: [{ pid: 777002, command: 'node', signaled: true, error: null }],
    unresolvedChildren: [777002],
    unresolvedWorker: [],
    children: [{ pid: 777002, command: 'node', state: 'open' }],
    stdout: 'partial output',
    stderr: '',
  };
  const identity = workerIdentityFor(failedOutcome, 'C:/tmp/desktop-perf-worker.cjs', 'sha256:abc');
  assert.equal(identity.pid, 777001, 'the spawned worker PID survives without a final payload');
  assert.equal(identity.terminated, false, 'termination is not inferred from the failure name');
  assert.equal(identity.requestedFailure, 'WORKER_TIMEOUT');
  assert.deepEqual(identity.unresolvedChildren, [777002]);
  const row = persistedCaseRow({ ...failedOutcome, worker: identity });
  assert.equal(row.worker.pid, 777001);
  assert.equal(row.terminationConfirmed, false);
  assert.deepEqual(row.unresolvedChildren, [777002]);
  assert.equal(row.requestedFailure, 'WORKER_TIMEOUT');
  assert.equal(row.workerKill.signaled, true);
  const status = executionStatus({
    decision: { verdict: 'INCONCLUSIVE' },
    invalidExecution: false,
    inputGateViolations: [],
    unresolvedProcess: { batch: 1, case: 'F1' },
  });
  assert.equal(status.ok, false);
  assert.notEqual(status.exitCode, 0);
  assert.ok(status.reasons.includes('UNRESOLVED_PROCESS'));
});

/* ------------------------------------------------------------------ */
/* Child-process lifecycle ledger (no real unrelated processes)        */
/* ------------------------------------------------------------------ */

const CHILD = 'PERF_CHILD ';

test('a closed child is never exposed as actionable ownership', () => {
  const ledger = createChildLedger();
  ledger.consume(`${CHILD}${JSON.stringify({ pid: 9001, command: 'node' })}\n`);
  assert.deepEqual(ledger.openChildren().map((row) => row.pid), [9001]);
  ledger.consume(`${CHILD}${JSON.stringify({ pid: 9001, command: 'node', exitCode: 0, durationMs: 3 })}\n`);
  assert.deepEqual(ledger.openChildren(), [], 'a known-closed PID is history, not ownership');
  assert.equal(ledger.closedChildren().length, 1);
  assert.equal(ledger.closedChildren()[0].state, 'closed');
});

test('a reused PID is only actionable after a fresh spawn announcement', () => {
  const ledger = createChildLedger();
  ledger.consume(`${CHILD}${JSON.stringify({ pid: 9002, command: 'node' })}\n`);
  ledger.consume(`${CHILD}${JSON.stringify({ pid: 9002, command: 'node', signal: 'SIGKILL' })}\n`);
  assert.equal(ledger.openChildren().length, 0);
  // The same numeric PID announced as a new process becomes open again, but
  // only because the worker declared a new spawn rather than mere history.
  ledger.consume(`${CHILD}${JSON.stringify({ pid: 9002, command: 'node' })}\n`);
  assert.deepEqual(ledger.openChildren().map((row) => row.pid), [9002]);
  assert.equal(ledger.snapshot()[0].spawnAnnouncements, 2);
});

test('non-positive and non-integer PIDs are never actionable', () => {
  const ledger = createChildLedger();
  for (const pid of [0, -1, 1.5, '9003', null, undefined]) {
    ledger.consume(`${CHILD}${JSON.stringify({ pid, command: 'node' })}\n`);
  }
  assert.deepEqual(ledger.openChildren(), []);
});

test('torn and malformed announcements are dropped, not guessed at', () => {
  const ledger = createChildLedger();
  // A line split across chunks is buffered until the newline arrives, so the
  // reassembled announcement is accepted rather than discarded.
  ledger.consume(`${CHILD}{"pid":9004,"comm`);
  assert.deepEqual(ledger.openChildren(), [], 'an incomplete line is not actionable yet');
  ledger.consume('and":"node"}\n');
  assert.deepEqual(ledger.openChildren().map((row) => row.pid), [9004]);
  // A complete but malformed announcement is dropped.
  ledger.consume(`${CHILD}{"pid":9006,"command":\n`);
  assert.deepEqual(ledger.openChildren().map((row) => row.pid), [9004]);
  // A complete line that is not JSON at all is dropped.
  ledger.consume(`${CHILD}not-json\n`);
  assert.deepEqual(ledger.openChildren().map((row) => row.pid), [9004]);
});

test('a malformed record never displaces a known-good child', () => {
  const ledger = createChildLedger();
  ledger.consume(`${CHILD}${JSON.stringify({ pid: 9007, command: 'node' })}\n`);
  ledger.consume(`${CHILD}${JSON.stringify({ pid: null, command: 'node' })}\n`);
  ledger.consume(`${CHILD}{"pid":0}\n`);
  assert.deepEqual(ledger.openChildren().map((row) => row.pid), [9007]);
});

test('abruptly truncated announcements do not leak a partial PID', () => {
  const ledger = createChildLedger();
  ledger.consume(`${CHILD}{"pid":9008`);
  assert.deepEqual(ledger.openChildren(), []);
});

test('deduplicates repeated close announcements for one child', () => {
  const ledger = createChildLedger();
  ledger.consume(`${CHILD}${JSON.stringify({ pid: 9005, command: 'node' })}\n`);
  ledger.consume(`${CHILD}${JSON.stringify({ pid: 9005, exitCode: 0, durationMs: 2 })}\n`);
  ledger.consume(`${CHILD}${JSON.stringify({ pid: 9005, exitCode: 0, durationMs: 2 })}\n`);
  const entry = ledger.snapshot()[0];
  assert.equal(entry.state, 'closed');
  assert.equal(entry.closeAnnouncements, 2);
  assert.deepEqual(ledger.openChildren(), []);
});

test('the ownership probe reports our own live process as alive', () => {
  assert.equal(processAlive(process.pid), true);
  // A PID that cannot exist in practice: never signal it, only probe.
  assert.equal(processAlive(2147483647), false);
  assert.equal(processAlive(0), false);
});

test('closed and reused PIDs are never signaled, even when they are open now', () => {
  const ledger = createChildLedger();
  // 9101 completed normally: its numeric PID may already belong to a stranger.
  ledger.consume(`${CHILD}${JSON.stringify({ pid: 9101, command: 'node' })}\n`);
  ledger.consume(`${CHILD}${JSON.stringify({ pid: 9101, exitCode: 0, durationMs: 5 })}\n`);
  // 9102 was killed by the worker and must not be re-signaled either.
  ledger.consume(`${CHILD}${JSON.stringify({ pid: 9102, command: 'node' })}\n`);
  ledger.consume(`${CHILD}${JSON.stringify({ pid: 9102, signal: 'SIGKILL' })}\n`);
  // 9103 is the only currently owned, still-open child.
  ledger.consume(`${CHILD}${JSON.stringify({ pid: 9103, command: 'git' })}\n`);

  const signaled = [];
  const attempts = signalOpenChildren(ledger, (pid, signal) => {
    signaled.push({ pid, signal });
  });
  assert.deepEqual(signaled, [{ pid: 9103, signal: 'SIGKILL' }]);
  assert.deepEqual(attempts.map((row) => row.pid), [9103]);
  assert.equal(attempts[0].signaled, true);
  assert.equal(attempts[0].command, 'git');
});

test('a signal error is recorded as an attempt, not as termination confirmation', () => {
  const ledger = createChildLedger();
  ledger.consume(`${CHILD}${JSON.stringify({ pid: 9104, command: 'node' })}\n`);
  const attempts = signalOpenChildren(ledger, () => {
    const error = new Error('operation not permitted');
    error.code = 'EPERM';
    throw error;
  });
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].signaled, false);
  assert.equal(attempts[0].error, 'EPERM');
  // The PID is still open and still reported alive: termination is unconfirmed.
  assert.deepEqual(survivingChildren(ledger, () => true), [9104]);
  // Only a probe that reports it gone lets the run claim confirmed cleanup.
  assert.deepEqual(survivingChildren(ledger, () => false), []);
});

/* ------------------------------------------------------------------ */
/* Decision gate (real decide(), synthetic raw samples)                */
/* ------------------------------------------------------------------ */

function sampleSeries(value, count = MEASURED_INVOCATIONS) {
  return Array.from({ length: Math.max(0, count) }, () => value);
}

function decisionResult(caseId, {
  durationMs,
  blockingMs = 2,
  blockingSamples = null,
  controlMs = 1,
  rssGrowthBytes = 0,
  heapGrowthBytes = 0,
  endpointRssGrowthBytes = rssGrowthBytes,
  endpointHeapGrowthBytes = heapGrowthBytes,
  calibrationDetected = true,
  digest = digestOf({ ok: true }),
  extraSamples = 0,
  postYieldRssBase = 0,
  postYieldHeapBase = 0,
} = {}) {
  const sampleCount = Math.max(0, MEASURED_INVOCATIONS + extraSamples);
  const durationSamples = sampleSeries(durationMs, sampleCount);
  const blockingSamplesFinal = blockingSamples
    ? sampleSeries(0, sampleCount).map((_, index) => blockingSamples[index])
    : sampleSeries(blockingMs, sampleCount);
  return {
    case: caseId,
    ok: true,
    expectedDigest: digest,
    projectionDigest: digest,
    measured: {
      count: durationSamples.length,
      durationMs: { samples: durationSamples },
      authoritativeDurationSeries: 'rawDurationMs',
      heartbeatMaxLatenessMs: { samples: blockingSamplesFinal },
    },
    controls: {
      statistic: 'per-window-max-lateness-ms',
      blockMs: 40,
      detected: calibrationDetected,
      detectedMs: calibrationDetected ? 45 : 1,
      noWork: { maxLatenessMs: controlMs, latenessMs: [controlMs] },
      blocked: { maxLatenessMs: calibrationDetected ? 45 : 1, latenessMs: [45] },
      outcomes: [
        { probe: 'no-work-control', statistic: 'per-window-max-lateness-ms', valueMs: controlMs, observationsMs: [controlMs] },
        { probe: 'deliberate-block-calibration', statistic: 'per-window-max-lateness-ms', valueMs: calibrationDetected ? 45 : 1, observationsMs: [45] },
      ],
    },
    memory: {
      protocol: 'per-invocation-post-yield-growth',
      settleMs: MEMORY_SETTLE_MS,
      baseline: 'after-load',
      afterLoadBytes: { rssBytes: 0, heapUsedBytes: 0 },
      observations: sampleSeries(0, sampleCount).map((_, index) => ({
        index: index + 1,
        afterInvocationBytes: { rssBytes: 0, heapUsedBytes: 0 },
        postYieldBytes: {
          rssBytes: postYieldRssBase + endpointRssGrowthBytes,
          heapUsedBytes: postYieldHeapBase + endpointHeapGrowthBytes,
        },
      })),
      rssGrowthBytes: { samples: sampleSeries(rssGrowthBytes, sampleCount) },
      heapGrowthBytes: { samples: sampleSeries(heapGrowthBytes, sampleCount) },
    },
  };
}

function decisionBatch(batchIndex, overrides = {}) {
  return CASE_IDS.map((caseId) => {
    const result = decisionResult(caseId, overrides[caseId] || {});
    return {
      case: caseId,
      ok: true,
      exitCode: 0,
      payload: { schemaVersion: worker.SCHEMA_VERSION, case: caseId, result },
      batch: batchIndex,
    };
  });
}

/** Build both batches; `overrides` is a per-case map or a batchIndex -> map fn. */
function bothBatches(overrides = {}) {
  const forBatch = (batchIndex) => (
    typeof overrides === 'function' ? overrides(batchIndex) : overrides
  );
  return [decisionBatch(0, forBatch(0)), decisionBatch(1, forBatch(1))];
}

function quietCaseMap(extra = {}) {
  return CASE_IDS.reduce((acc, caseId) => {
    acc[caseId] = { durationMs: 5, blockingMs: 2, ...(extra[caseId] || {}) };
    return acc;
  }, {});
}

/** Nine low window maxima and one isolated outlier must not breach the gate. */
function isolatedOutlierSamples(outlier) {
  return Array.from(
    { length: MEASURED_INVOCATIONS },
    (_, index) => (index === 0 ? outlier : 1),
  );
}

test('no repeated breach yields NO_OPTIMIZATION_JUSTIFIED', () => {
  const decision = decide(bothBatches(quietCaseMap()), { allDetected: true });
  assert.equal(decision.verdict, 'NO_OPTIMIZATION_JUSTIFIED');
  assert.equal(decision.selectedProfileCandidate, null);
});

test('a breach in only one batch is not a repeated breach', () => {
  const decision = decide(bothBatches((batchIndex) => quietCaseMap(
    batchIndex === 0 ? { S1: { durationMs: 900, blockingMs: 2 } } : {},
  )), { allDetected: true });
  assert.notEqual(decision.verdict, 'PROFILE_ONE_HOT_PATH');
});

test('a valid blocking-only breach selects S1 with a blocking focus', () => {
  const decision = decide(bothBatches((batchIndex) => quietCaseMap({
    S1: {
      durationMs: batchIndex === 0 ? 140 : 138,
      blockingMs: batchIndex === 0 ? 130 : 128,
      controlMs: 1,
    },
  })), { allDetected: true });
  assert.equal(decision.verdict, 'PROFILE_ONE_HOT_PATH');
  assert.equal(decision.selectedProfileCandidate, 'S1');
  assert.equal(decision.selectedProfileFocus, 'blocking');
  const row = decision.table.find((entry) => entry.caseId === 'S1');
  assert.equal(row.blockingBreach, true);
  assert.equal(row.breachedBothBatches, false, 'duration does not breach 250 ms');
});

test('an isolated blocking outlier does not breach the median gate', () => {
  const decision = decide(bothBatches(quietCaseMap({
    S1: {
      durationMs: 5,
      // Nine ~1 ms windows and one 100 ms outlier: the preregistered statistic
      // is the median of the ten window maxima, so this must NOT be a breach.
      blockingSamples: isolatedOutlierSamples(100),
      controlMs: 1,
    },
  })), { allDetected: true });
  const row = decision.table.find((entry) => entry.caseId === 'S1');
  assert.equal(row.blockingMedianLatenessMs[0], 1);
  assert.equal(row.blockingMaxLatenessMs[0], 100, 'the maximum stays as a diagnostic');
  assert.equal(row.blockingBreach, false);
  assert.equal(decision.selectedProfileCandidate, null);
});

test('a genuine repeated blocking-median breach is required to recommend', () => {
  const decision = decide(bothBatches((batchIndex) => quietCaseMap({
    S1: {
      durationMs: 5,
      // Every window blocks: median and maximum are both above the gate.
      blockingSamples: sampleSeries(batchIndex === 0 ? 130 : 128),
      controlMs: 1,
    },
  })), { allDetected: true });
  assert.equal(decision.verdict, 'PROFILE_ONE_HOT_PATH');
  assert.equal(decision.selectedProfileCandidate, 'S1');
  assert.equal(decision.selectedProfileFocus, 'blocking');
});

test('disagreeing blocking medians across batches are not repeatable', () => {
  const decision = decide(bothBatches((batchIndex) => quietCaseMap({
    S1: {
      durationMs: 5,
      blockingSamples: sampleSeries(batchIndex === 0 ? 130 : 400),
      controlMs: 1,
    },
  })), { allDetected: true });
  assert.equal(decision.verdict, 'INCONCLUSIVE');
  assert.equal(decision.selectedProfileCandidate, null);
});

test('a non-repeatable blocking breach cannot drive the recommendation', () => {
  const decision = decide(bothBatches((batchIndex) => quietCaseMap({
    S1: {
      durationMs: 5,
      blockingMs: batchIndex === 0 ? 130 : 300,
      controlMs: 1,
    },
  })), { allDetected: true });
  assert.equal(decision.verdict, 'INCONCLUSIVE');
  assert.equal(decision.selectedProfileCandidate, null);
});

test('an idle case whose blocking maximum happens to jitter stays a pass', () => {
  const decision = decide(bothBatches((batchIndex) => quietCaseMap({
    P2: {
      durationMs: batchIndex === 0 ? 0.6 : 0.62,
      // Well below the absolute blocking threshold and never a signal; a
      // repeatability gate applied to it would manufacture an INCONCLUSIVE.
      blockingMs: batchIndex === 0 ? 6 : 31,
      controlMs: 5,
    },
  })), { allDetected: true });
  assert.equal(decision.table.find((row) => row.caseId === 'P2').blockingBreach, false);
  assert.equal(decision.verdict, 'NO_OPTIMIZATION_JUSTIFIED');
});

test('a duration breach still wins when only idle blocking jitters', () => {
  const decision = decide(bothBatches((batchIndex) => quietCaseMap({
    S1: {
      durationMs: batchIndex === 0 ? 300 : 298,
      blockingMs: batchIndex === 0 ? 2 : 40,
      controlMs: 1,
    },
  })), { allDetected: true });
  assert.equal(decision.verdict, 'PROFILE_ONE_HOT_PATH');
  assert.equal(decision.selectedProfileCandidate, 'S1');
  assert.equal(decision.selectedProfileFocus, 'latency');
});

test('excessive between-batch duration drift is INCONCLUSIVE even when both breach', () => {
  const decision = decide(bothBatches((batchIndex) => quietCaseMap({
    P1: { durationMs: batchIndex === 0 ? 900 : 2000, blockingMs: 2 },
  })), { allDetected: true });
  assert.equal(decision.verdict, 'INCONCLUSIVE');
});

test('a contaminated control marks the timing environment inconclusive', () => {
  const decision = decide(bothBatches(quietCaseMap({
    P1: { durationMs: 5, blockingMs: 2, controlMs: 80 },
  })), { allDetected: true });
  assert.equal(decision.timingContaminated, true);
  assert.equal(decision.verdict, 'INCONCLUSIVE');
});

test('a repeated memory-only breach triggers memory profiling, never a latency claim', () => {
  const decision = decide(bothBatches(quietCaseMap({
    P1: { rssGrowthBytes: MEMORY_THRESHOLD.rssGrowthBytes + 1 },
  })), { allDetected: true });
  assert.equal(decision.verdict, 'PROFILE_ONE_HOT_PATH');
  assert.equal(decision.selectedProfileFocus, 'memory');
  assert.equal(decision.table.find((row) => row.profileFocus === 'memory').memoryBreach, true);
});

test('a memory breach in only one batch is unstable noise, not a finding', () => {
  const decision = decide(bothBatches((batchIndex) => quietCaseMap({
    P1: {
      rssGrowthBytes: batchIndex === 0 ? MEMORY_THRESHOLD.rssGrowthBytes + 1 : 1024,
    },
  })), { allDetected: true });
  assert.equal(decision.verdict, 'NO_OPTIMIZATION_JUSTIFIED');
  assert.ok(decision.table.some((row) => row.memoryUnstable));
});

test('the duration gate follows raw elapsed time, not the adjusted estimate', () => {
  // Raw elapsed time crosses the S1 threshold (300 ms) while the hypothetical
  // instrumentation-adjusted estimate stays far below it. The gate must use
  // raw time, so both batches breach and the focus is latency.
  const decision = decide(bothBatches((batchIndex) => quietCaseMap({
    S1: {
      durationMs: batchIndex === 0 ? 300 : 298,
      blockingMs: 2,
      controlMs: 1,
    },
  })), { allDetected: true });
  const row = decision.table.find((entry) => entry.caseId === 'S1');
  assert.equal(row.batchMediansMs[0], 300);
  assert.equal(row.durationThresholdBreach, true);
  assert.equal(decision.selectedProfileFocus, 'latency');
});

test('a payload that mislabels its authoritative duration series is rejected', () => {
  const payload = successPayload();
  payload.result.measured.authoritativeDurationSeries = 'durationMs';
  const validation = validateWorkerResult({ payload, exitCode: 0 }, 'P1', null);
  assert.equal(validation.ok, false);
  assert.equal(validation.failure, 'DURATION_SERIES_MISLABELED');
});

test('a failed calibration invalidates the measurement even if a later one succeeds', () => {
  const decision = decide(bothBatches((batchIndex) => quietCaseMap({
    P1: { calibrationDetected: batchIndex !== 0 },
  })), { allDetected: false });
  assert.equal(decision.verdict, 'CORRECTNESS_FAILURE');
  assert.ok(decision.integrity.invalidCalibrations.length > 0);
});

test('an incomplete sample set cannot produce a recommendation', () => {
  const decision = decide(bothBatches((batchIndex) => quietCaseMap({
    S1: {
      durationMs: 900,
      blockingMs: 130,
      extraSamples: batchIndex === 0 ? -1 : 0,
    },
  })), { allDetected: true });
  assert.equal(decision.verdict, 'CORRECTNESS_FAILURE');
  assert.equal(decision.selectedProfileCandidate, null);
  assert.ok(decision.integrity.invalidRows.some((row) => row.reason === 'INCOMPLETE_SAMPLES'));
});

test('a changed input suppresses candidate selection without changing the base decision', () => {
  const decision = decide(bothBatches(quietCaseMap({
    P1: { durationMs: 90, blockingMs: 90 },
  })), { allDetected: true });
  assert.equal(decision.verdict, 'PROFILE_ONE_HOT_PATH');
  const report = {
    inputIdentity: {
      productionFiles: { 'a.js': 'sha256:aaa' },
      productionFilesAfter: { 'a.js': 'sha256:bbb' },
      productionFilesUnchanged: false,
      sourceFiles: {},
      sourceFilesAfter: {},
      sourceFilesUnchanged: true,
      workerSha256: 'sha256:ccc',
      workerSha256After: 'sha256:ccc',
    },
    fixtureInventory: { unchanged: true, matchesExpected: true },
    decision,
  };
  const violations = applyInputGate(report);
  assert.ok(violations.includes('PRODUCTION_FILES_CHANGED'));
  assert.equal(report.decision.verdict, 'INCONCLUSIVE');
  assert.equal(report.decision.selectedProfileCandidate, null);
});

test('missing hashes and fixture drift are gate violations', () => {
  const decision = decide(bothBatches(quietCaseMap()), { allDetected: true });
  const report = {
    inputIdentity: {
      productionFiles: {},
      productionFilesAfter: {},
      productionFilesUnchanged: true,
      sourceFiles: {},
      sourceFilesAfter: {},
      sourceFilesUnchanged: true,
      workerSha256: null,
      workerSha256After: null,
    },
    fixtureInventory: { unchanged: false, matchesExpected: false },
    decision,
  };
  const violations = applyInputGate(report);
  assert.ok(violations.includes('WORKER_HASH_MISSING'));
  assert.ok(violations.includes('FIXTURE_UNCHANGED_CHECK_FAILED'));
  assert.ok(violations.includes('FIXTURE_MANIFEST_MISMATCH'));
});

test('a changed input voids a NEGATIVE conclusion, not only a recommendation', () => {
  const decision = decide(bothBatches(quietCaseMap()), { allDetected: true });
  assert.equal(decision.verdict, 'NO_OPTIMIZATION_JUSTIFIED');
  const report = {
    inputIdentity: {
      productionFiles: { 'a.js': 'sha256:aaa' },
      productionFilesAfter: { 'a.js': 'sha256:bbb' },
      productionFilesUnchanged: false,
      sourceFiles: { 'worker.cjs': 'sha256:ddd' },
      sourceFilesAfter: { 'worker.cjs': 'sha256:ddd' },
      sourceFilesUnchanged: true,
      workerSha256: 'sha256:ccc',
      workerSha256After: 'sha256:ccc',
      resolvedModules: [`src/main/data-import.js sha256:${'a'.repeat(64)}`],
      resolvedModulesAfter: { 'src/main/data-import.js': `sha256:${'a'.repeat(64)}` },
      resolvedModulesUnchanged: true,
    },
    fixtureInventory: {
      unchanged: true,
      matchesExpected: true,
      contentUnchanged: true,
    },
    decision,
  };
  const violations = applyInputGate(report);
  assert.ok(violations.includes('PRODUCTION_FILES_CHANGED'));
  assert.equal(report.decision.verdict, 'INCONCLUSIVE');
  assert.equal(report.decision.selectedProfileCandidate, null);
});

test('two missing hash maps are not mistaken for an unchanged input', () => {
  const decision = decide(bothBatches(quietCaseMap()), { allDetected: true });
  const report = {
    inputIdentity: {
      // The same missing key yields null before AND after; equality alone must
      // not be read as completeness.
      productionFiles: { 'a.js': null },
      productionFilesAfter: { 'a.js': null },
      productionFilesUnchanged: true,
      sourceFiles: {},
      sourceFilesAfter: {},
      sourceFilesUnchanged: true,
      workerSha256: 'sha256:ccc',
      workerSha256After: 'sha256:ccc',
      resolvedModules: null,
      resolvedModulesAfter: {},
      resolvedModulesUnchanged: true,
    },
    fixtureInventory: { unchanged: true, matchesExpected: true, contentUnchanged: true },
    decision,
  };
  const violations = applyInputGate(report);
  assert.ok(violations.includes('PRODUCTION_HASH_MISSING'));
  assert.ok(violations.includes('WORKER_SOURCE_HASH_MISSING'));
  assert.ok(violations.includes('RESOLVED_DEPENDENCIES_MISSING'));
  assert.equal(report.decision.verdict, 'INCONCLUSIVE');
});

test('contradictory memory endpoints and growth series invalidate a row', () => {
  const decision = decide(bothBatches(quietCaseMap({
    P1: {
      // Endpoints say "no growth", the redundant published series says the
      // threshold was breached. Endpoints are authoritative; the row fails.
      rssGrowthBytes: MEMORY_THRESHOLD.rssGrowthBytes + 1,
      endpointRssGrowthBytes: 0,
      postYieldRssBase: 0,
    },
  })), { allDetected: true });
  assert.equal(decision.verdict, 'CORRECTNESS_FAILURE');
  assert.ok(decision.integrity.invalidRows.some(
    (row) => row.reason === 'INCONSISTENT_MEMORY_SERIES',
  ));
});

test('a missing control maximum invalidates the measurement', () => {
  const decision = decide(bothBatches(quietCaseMap({
    P1: { controlMs: null },
  })), { allDetected: true });
  assert.equal(decision.verdict, 'CORRECTNESS_FAILURE');
  assert.ok(decision.integrity.invalidRows.some(
    (row) => row.reason === 'MISSING_CONTROL_MAXIMUM',
  ));
});

test('a changed resolved dependency hash voids the run', () => {
  const decision = decide(bothBatches(quietCaseMap()), { allDetected: true });
  const report = {
    inputIdentity: {
      productionFiles: { 'a.js': `sha256:${'a'.repeat(64)}` },
      productionFilesAfter: { 'a.js': `sha256:${'a'.repeat(64)}` },
      productionFilesUnchanged: true,
      sourceFiles: { 'worker.cjs': `sha256:${'b'.repeat(64)}` },
      sourceFilesAfter: { 'worker.cjs': `sha256:${'b'.repeat(64)}` },
      sourceFilesUnchanged: true,
      workerSha256: `sha256:${'c'.repeat(64)}`,
      workerSha256After: `sha256:${'c'.repeat(64)}`,
      resolvedModules: [`src/main/data-import.js sha256:${'d'.repeat(64)}`],
      resolvedModulesAfter: { 'src/main/data-import.js': `sha256:${'e'.repeat(64)}` },
      resolvedModulesUnchanged: false,
    },
    fixtureInventory: { unchanged: true, matchesExpected: true, contentUnchanged: true },
    decision,
  };
  const violations = applyInputGate(report);
  assert.ok(violations.includes('RESOLVED_DEPENDENCIES_CHANGED'));
  assert.equal(report.decision.verdict, 'INCONCLUSIVE');
});

/* ------------------------------------------------------------------ */
/* Execution validity vs analytical verdict (CLI status axis)          */
/* ------------------------------------------------------------------ */

function baseReport(verdict = 'NO_OPTIMIZATION_JUSTIFIED') {
  return {
    inputIdentity: {},
    fixtureInventory: {},
    unresolvedProcess: null,
    decision: {
      verdict,
      invalidExecution: false,
      inputGateViolations: [],
      selectedProfileCandidate: null,
      selectedProfileFocus: null,
    },
  };
}

test('a valid run whose verdict is INCONCLUSIVE still succeeds', () => {
  const report = baseReport('INCONCLUSIVE');
  const status = executionStatus(report);
  assert.equal(status.ok, true, 'variability is an analytical outcome, not a run failure');
  assert.equal(status.exitCode, 0);
  assert.deepEqual(status.reasons, []);
});

test('a negative conclusion invalidated by changed inputs yields CLI failure', () => {
  const report = baseReport('NO_OPTIMIZATION_JUSTIFIED');
  report.decision.inputGateViolations = ['PRODUCTION_FILES_CHANGED'];
  const status = executionStatus(report);
  assert.equal(status.ok, false);
  assert.equal(status.exitCode, 1);
  assert.deepEqual(status.reasons, ['PRODUCTION_FILES_CHANGED']);
});

test('a valid recommendation is reported as a successful run', () => {
  const report = baseReport('PROFILE_ONE_HOT_PATH');
  report.decision.selectedProfileCandidate = 'S1';
  report.decision.selectedProfileFocus = 'blocking';
  const status = executionStatus(report);
  assert.equal(status.ok, true);
  assert.equal(status.exitCode, 0);
});

test('invalid execution and unresolved process each fail the run', () => {
  const invalid = baseReport('NO_OPTIMIZATION_JUSTIFIED');
  invalid.decision.invalidExecution = true;
  assert.equal(executionStatus(invalid).ok, false);
  assert.ok(executionStatus(invalid).reasons.includes('INVALID_EXECUTION'));
  const unresolved = baseReport('NO_OPTIMIZATION_JUSTIFIED');
  unresolved.unresolvedProcess = { batch: 1, case: 'F1' };
  const status = executionStatus(unresolved);
  assert.equal(status.ok, false);
  assert.ok(status.reasons.includes('UNRESOLVED_PROCESS'));
});

test('CORRECTNESS_FAILURE is a run failure even with no input violations', () => {
  const report = baseReport('CORRECTNESS_FAILURE');
  const status = executionStatus(report);
  assert.equal(status.ok, false);
  assert.ok(status.reasons.includes('CORRECTNESS_FAILURE'));
});

test('only the plan vocabulary appears in any disposition', () => {
  const allowed = new Set([
    'NO_OPTIMIZATION_JUSTIFIED',
    'PROFILE_ONE_HOT_PATH',
    'INCONCLUSIVE',
    'CORRECTNESS_FAILURE',
  ]);
  const decision = decide(bothBatches(quietCaseMap()), { allDetected: true });
  assert.ok(allowed.has(decision.verdict));
  for (const row of decision.table) assert.ok(allowed.has(row.disposition));
});

test('hashFiles reports null for a missing file instead of a fake digest', () => {
  const dir = tempRoot();
  try {
    assert.equal(hashFiles(dir, ['missing.js'])['missing.js'], null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
