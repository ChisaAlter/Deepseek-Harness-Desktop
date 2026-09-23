'use strict';

/**
 * C1 measurement worker: exactly one case per process.
 *
 * The worker loads the selected candidate's real production modules (never a
 * copy of the algorithm), points every home/skill path at synthetic fixtures,
 * then records controls, one first invocation, two untimed warm-ups and ten
 * measured invocations of the production function alone.
 *
 * Timed window: monotonic start immediately before the production call, stop
 * when its result settles. Fixture work, digesting, oracle checks, memory
 * sampling and serialization all happen outside that window.
 *
 * Protocol invariants this revision enforces:
 * - The first invocation is the ACTUAL first call of the production function.
 *   Its correctness is judged afterwards against the fixture oracle; there is
 *   no untimed control call that would make "first invocation" a misnomer.
 * - Memory growth is DERIVED from the published endpoints: each measured
 *   invocation records one endpoint immediately after the call returns, before
 *   projection/digest/oracle work, and one after the declared settle sleep.
 *   All ten observations are published alongside the derived medians.
 * - `createHeartbeat().arm()` cancels the warm-up timer and re-arms the timer
 *   and its expectation together, so lateness is measured against the deadline
 *   the pending timer actually fires at.
 * - Task-owned children announce their identity on stdout as soon as they are
 *   spawned, so a parent that kills this worker on timeout still knows which
 *   processes the worker owned.
 *
 * Run as a script:
 *   node desktop-perf-worker.cjs --case S1 --fixture <dir> [--json-out <file>]
 * It prints exactly one JSON line prefixed with `PERF_RESULT ` and exits 1 when
 * the case is invalid, the result digest is wrong, or an invocation throws.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const RESULT_PREFIX = 'PERF_RESULT ';
const CHILD_PREFIX = 'PERF_CHILD ';
const SCHEMA_VERSION = 2;
const MEASURED_INVOCATIONS = 10;
const WARMUP_INVOCATIONS = 2;
const MEMORY_SETTLE_MS = 100;
const HEARTBEAT_INTERVAL_MS = 10;
const CALIBRATION_BLOCK_MS = 40;
const CASE_IDS = ['P1', 'P2', 'S1', 'S2', 'F1', 'F2'];

function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianAbsoluteDeviation(values, center) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const reference = center === undefined ? median(values) : center;
  if (reference === null) return null;
  return median(values.map((value) => Math.abs(value - reference)));
}

/**
 * Sample summary. An empty series yields null statistics rather than zeros:
 * a missing sample must never be reported as a fast one.
 */
function summarizeSeries(values) {
  const series = Array.isArray(values) ? values.filter((row) => Number.isFinite(row)) : [];
  const center = median(series);
  return {
    samples: series,
    count: series.length,
    median: center,
    min: series.length ? Math.min(...series) : null,
    max: series.length ? Math.max(...series) : null,
    mad: medianAbsoluteDeviation(series, center),
  };
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Event-loop obstruction probe.
 *
 * A 10 ms heartbeat is re-armed relative to each actual firing, so delays do
 * not accumulate artificially. `arm()` reaches steady state, then cancels the
 * pending warm-up timer and arms a fresh timer AND its expectation together, so
 * the deadline used for lateness is exactly the deadline that timer fires at.
 * A fully synchronous production call cannot be observed by its own pending
 * timer, so the post-return tick carries the blocking time. A window with no
 * observation is reported as unobserved and never folded into a series as zero.
 *
 * `hooks` lets tests drive a deterministic clock/scheduler. Production callers
 * pass nothing.
 */
function createHeartbeat(intervalMs = HEARTBEAT_INTERVAL_MS, hooks = {}) {
  const now = typeof hooks.now === 'function' ? hooks.now : () => performance.now();
  const schedule = typeof hooks.setTimeout === 'function' ? hooks.setTimeout : setTimeout;
  const cancel = typeof hooks.clearTimeout === 'function' ? hooks.clearTimeout : clearTimeout;
  const wait = typeof hooks.sleep === 'function' ? hooks.sleep : sleep;

  let lateness = [];
  let ticks = 0;
  let expected = 0;
  let timer = null;
  let armed = false;

  function tick() {
    const at = now();
    lateness.push(Math.max(0, at - expected));
    ticks += 1;
    expected = now() + intervalMs;
    timer = schedule(tick, intervalMs);
  }

  function disarm() {
    armed = false;
    if (timer !== null) cancel(timer);
    timer = null;
  }

  function stats() {
    const center = median(lateness);
    return {
      intervalMs,
      ticks,
      observations: lateness.length,
      observed: lateness.length > 0,
      maxLatenessMs: lateness.length ? Math.max(...lateness) : null,
      medianLatenessMs: center,
      madLatenessMs: medianAbsoluteDeviation(lateness, center),
      pendingDeadlineMs: timer === null ? null : expected,
      latenessMs: [...lateness],
    };
  }

  return {
    async arm() {
      disarm();
      ticks = 0;
      lateness = [];
      armed = true;
      expected = now() + intervalMs;
      timer = schedule(tick, intervalMs);
      // Steady state first, then discard the warm-up ticks.
      await wait(Math.max(intervalMs * 3, 30));
      if (timer !== null) {
        cancel(timer);
        timer = null;
      }
      ticks = 0;
      lateness = [];
      expected = now() + intervalMs;
      timer = schedule(tick, intervalMs);
      return this;
    },
    ticks() {
      return ticks;
    },
    deadlineMs() {
      return timer === null ? null : expected;
    },
    async settle(ticksAtReturn) {
      const waitUntil = now() + Math.max(intervalMs * 25, 250);
      while (armed && ticks <= ticksAtReturn && now() < waitUntil) {
        await wait(2);
      }
      return this.stop();
    },
    stop() {
      const snapshot = stats();
      disarm();
      return snapshot;
    },
  };
}

/** Deliberate synchronous block: calibration only, never inside a timed window. */
function busyWait(ms) {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // Intentional busy loop.
  }
}

/**
 * Matched no-work control plus a deliberate-block calibration, so the reported
 * obstruction numbers carry their own detection evidence.
 *
 * The matched control and the workload use the SAME statistic: the per-window
 * maximum lateness. Raw observations and the calibration outcome are kept.
 */
async function probeControls() {
  const idle = createHeartbeat();
  await idle.arm();
  const idleTicks = idle.ticks();
  const noWork = await idle.settle(idleTicks);

  const calibration = createHeartbeat();
  await calibration.arm();
  const calibrationTicks = calibration.ticks();
  busyWait(CALIBRATION_BLOCK_MS);
  const blocked = await calibration.settle(calibrationTicks);
  const detected = blocked.maxLatenessMs !== null
    && blocked.maxLatenessMs >= CALIBRATION_BLOCK_MS / 2;
  return {
    statistic: 'per-window-max-lateness-ms',
    blockMs: CALIBRATION_BLOCK_MS,
    detected,
    detectedMs: blocked.maxLatenessMs,
    // Kept so existing readers keep working; both names mean the same outcome.
    calibrationBlockMs: CALIBRATION_BLOCK_MS,
    calibrationDetected: detected,
    calibrationDetectedMs: blocked.maxLatenessMs,
    noWork,
    blocked,
    outcomes: [
      {
        probe: 'no-work-control',
        statistic: 'per-window-max-lateness-ms',
        valueMs: noWork.maxLatenessMs,
        observationsMs: noWork.latenessMs,
      },
      {
        probe: 'deliberate-block-calibration',
        statistic: 'per-window-max-lateness-ms',
        blockMs: CALIBRATION_BLOCK_MS,
        valueMs: blocked.maxLatenessMs,
        observationsMs: blocked.latenessMs,
        detected,
      },
    ],
  };
}

/**
 * Memory samples are endpoint observations in bytes. `process.memoryUsage()`
 * is deliberately not called inside a timed window; Node documents that
 * gathering it can itself be costly.
 */
function memoryBytes() {
  const usage = process.memoryUsage();
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external,
  };
}

/**
 * process.cpuUsage() reports microseconds. Everything this worker publishes is
 * milliseconds, converted once, here, so the two units are never combined raw.
 */
function cpuDeltaMicros(before, after) {
  const userMicros = Math.max(0, after.user - before.user);
  const systemMicros = Math.max(0, after.system - before.system);
  return {
    userMs: userMicros / 1000,
    systemMs: systemMicros / 1000,
    totalMs: (userMicros + systemMicros) / 1000,
  };
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function digestOf(projection) {
  return `sha256:${crypto.createHash('sha256').update(stableStringify(projection)).digest('hex')}`;
}

function sha256File(file) {
  try {
    return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
  } catch {
    return null;
  }
}

/**
 * Deterministic projection of a production result. This is the single shared
 * definition used both to precompute the expected digest in the fixture builder
 * and to digest the observed result here, so the two can never drift.
 */
function projectResult(caseId, result) {
  switch (caseId) {
    case 'P1':
    case 'P2':
      return {
        destEmpty: Boolean(result && result.destEmpty),
        sourceHasData: Boolean(result && result.sourceHasData),
        hold: Boolean(result && result.hold),
      };
    case 'S1':
    case 'S2': {
      const sessions = Array.isArray(result && result.sessions) ? result.sessions : [];
      return {
        count: sessions.length,
        sessions: sessions.map((row) => ({
          id: String(row && row.id),
          cwd: String(row && row.cwd),
          title: String(row && row.title),
          createdAt: String(row && row.createdAt),
          compressedLog: Boolean(row && row.compressedLog),
        })),
      };
    }
    case 'F1':
    case 'F2': {
      const entries = Array.isArray(result && result.entries) ? result.entries : [];
      return {
        ok: Boolean(result && result.ok),
        entries: entries.map((row) => ({ name: String(row && row.name), kind: String(row && row.kind) })),
      };
    }
    default:
      throw new Error(`unknown case ${caseId}`);
  }
}

function resolveCasePaths(caseId, fixtureDir) {
  const sharedSource = path.join(fixtureDir, 'homes', 'source-many-small');
  switch (caseId) {
    case 'P1':
      return {
        sourceHome: sharedSource,
        destHome: path.join(fixtureDir, 'homes', 'dest-empty'),
      };
    case 'P2':
      return {
        sourceHome: sharedSource,
        destHome: path.join(fixtureDir, 'homes', 'dest-populated'),
      };
    case 'S1':
      return {
        sourceHome: sharedSource,
        destHome: path.join(fixtureDir, 'homes', 'dest-scan-many-small'),
      };
    case 'S2':
      return {
        sourceHome: path.join(fixtureDir, 'homes', 'source-one-long'),
        destHome: path.join(fixtureDir, 'homes', 'dest-scan-one-long'),
      };
    case 'F1':
      return { workspaceRoot: path.join(fixtureDir, 'listings', 'files-small') };
    case 'F2':
      return { workspaceRoot: path.join(fixtureDir, 'listings', 'files-large') };
    default:
      throw new Error(`unknown case ${caseId}`);
  }
}

function moduleLoadRecorder(sourceRoot) {
  const entries = [];
  const started = performance.now();
  return {
    load(relativePath) {
      const before = performance.now();
      const loaded = require(path.join(sourceRoot, relativePath));
      entries.push({ module: relativePath, loadMs: performance.now() - before });
      return loaded;
    },
    finish() {
      return { entries, totalMs: performance.now() - started };
    },
  };
}

/**
 * Task-owned child-process accounting.
 *
 * F cases call the production `listDir`, which spawns `git check-ignore` as a
 * child of this worker. Nothing else can see grandchildren from the parent, so
 * the worker installs a thin observer around `node:child_process.spawn` BEFORE
 * the production modules are required (they destructure `spawn` at load time).
 *
 * The observer records the child's pid, its exit code and its duration, and
 * accumulates only the bookkeeping time it adds outside the real `spawn` call
 * (`overheadMs`), so the extra cost it injects into a timed window is measured
 * and reported rather than assumed to be zero.
 */
function installSpawnRecorder() {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  const records = [];
  let overheadMs = 0;
  if (typeof originalSpawn !== 'function') {
    return { records, overheadMs: () => overheadMs, instrumented: false };
  }
  childProcess.spawn = function observedSpawn(...args) {
    const startedAt = performance.now();
    const child = originalSpawn.apply(this, args);
    const beforeBookkeeping = performance.now();
    const record = {
      pid: child && typeof child.pid === 'number' ? child.pid : null,
      command: typeof args[0] === 'string' ? args[0] : null,
      startedAt,
      exitCode: null,
      signal: null,
      durationMs: null,
    };
    records.push(record);
    // Announce the child identity before any workload can block, so a parent
    // that terminates this worker on timeout can still account for it.
    try {
      process.stdout.write(`${CHILD_PREFIX}${JSON.stringify({
        pid: record.pid,
        command: record.command,
      })}\n`);
    } catch {
      // A closed stdout must not break the production call.
    }
    try {
      child.once('close', (code, signal) => {
        const endedAt = performance.now();
        record.exitCode = code;
        record.signal = signal || null;
        record.durationMs = round(endedAt - record.startedAt, 3);
        try {
          process.stdout.write(`${CHILD_PREFIX}${JSON.stringify({
            pid: record.pid,
            command: record.command,
            exitCode: record.exitCode,
            signal: record.signal,
            durationMs: record.durationMs,
          })}\n`);
        } catch {
          // See above.
        }
      });
    } catch {
      // A child object that cannot take listeners is still recorded.
    }
    // Strictly the bookkeeping this observer adds to the caller's frame; the
    // real `spawn` call is excluded because the caller would pay it anyway.
    overheadMs += performance.now() - beforeBookkeeping;
    return child;
  };
  return {
    records,
    instrumented: true,
    overheadMs: () => overheadMs,
    summary: () => ({
      instrumented: true,
      spawnCount: records.length,
      children: records.map((row) => ({
        pid: row.pid,
        command: row.command,
        exitCode: row.exitCode,
        signal: row.signal,
        durationMs: row.durationMs,
      })),
      bookkeepingOverheadMs: round(overheadMs, 6),
    }),
  };
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Resolved production dependencies actually pulled in by this worker. The
 * require-cache delta includes local transitive dependencies (for example the
 * import scanner module), not just the entry modules named in the plan.
 */
function collectResolvedModules(sourceRoot, cacheBefore) {
  const root = path.resolve(sourceRoot);
  const rows = [];
  for (const key of Object.keys(require.cache)) {
    if (cacheBefore && cacheBefore.has(key)) continue;
    const resolved = path.resolve(key);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) continue;
    rows.push({
      file: path.relative(root, resolved).split(path.sep).join('/'),
      sha256: sha256File(resolved),
    });
  }
  rows.sort((left, right) => (left.file < right.file ? -1 : 1));
  return rows;
}

/**
 * Wire one case to the real production functions. Nothing here reimplements a
 * production algorithm; every call goes through the selected candidate.
 */
function createCase(caseId, paths, context) {
  const { sourceRoot, fixtureRoot } = context;
  const modules = moduleLoadRecorder(sourceRoot);
  // Install before requiring the production modules: `workspace-fs.js`
  // destructures `spawn` at load time.
  const spawnRecorder = caseId === 'F1' || caseId === 'F2'
    ? installSpawnRecorder()
    : null;
  const homeModule = modules.load('src/shared/dsh-home.js');
  const fixtureHome = path.join(fixtureRoot, 'dsh-home');
  process.env.DSHD_HOME = fixtureHome;
  homeModule.setDesktopDshHome(fixtureHome);

  const skills = {
    agentsSkillsRoot: path.join(fixtureRoot, 'skills', 'agents'),
    extraSkillDirs: [path.join(fixtureRoot, 'skills', 'extra')],
  };

  if (caseId === 'P1' || caseId === 'P2' || caseId === 'S1' || caseId === 'S2') {
    const dataImport = modules.load('src/main/data-import.js');
    const callArgs = {
      sourceHome: paths.sourceHome,
      destHome: paths.destHome,
      agentsSkillsRoot: skills.agentsSkillsRoot,
      extraSkillDirs: skills.extraSkillDirs,
    };
    const fn = caseId === 'S1' || caseId === 'S2' ? dataImport.scanImport : dataImport.probeImportHold;
    return {
      call: () => fn(callArgs),
      oracle: (projected, result) => (
        result !== undefined && digestOf(projected) === context.expectedDigests[caseId]
      ),
      project: (result) => projectResult(caseId, result),
      detail: { case: caseId, callArgs },
      modules,
    };
  }

  const workspaceFs = modules.load('src/main/workspace-fs.js');
  const authority = modules.load('src/main/workspace-authority.js');
  // F cases exercise the production Git-ignore path. Point Git at the isolated
  // fixture work tree and the source checkout's read-only Git scaffolding so
  // `git check-ignore` resolves the fixture's own .gitignore without creating a
  // repository, branch, ref or commit anywhere.
  if (!context.gitDir) {
    throw new Error('fixture manifest has no gitDir; the F cases cannot run');
  }
  process.env.GIT_DIR = context.gitDir;
  process.env.GIT_WORK_TREE = paths.workspaceRoot;
  workspaceFs.setWorkspaceAuthority(
    authority.createWorkspaceAuthority({ workspace: paths.workspaceRoot }),
  );
  return {
    call: () => workspaceFs.listDir(paths.workspaceRoot, '.'),
    oracle: (projected, result) => (
      result !== undefined && digestOf(projected) === context.expectedDigests[caseId]
    ),
    project: (result) => projectResult(caseId, result),
    detail: { case: caseId, workspaceRoot: paths.workspaceRoot },
    modules,
    spawnRecorder,
  };
}

async function timeOneCall(testCase) {
  const heartbeat = createHeartbeat();
  await heartbeat.arm();
  const ticksAtStart = heartbeat.ticks();
  const cpuBefore = process.cpuUsage();
  // The spawn observer's own bookkeeping is measured so its injected cost can
  // be removed from the timed window instead of silently inflating it.
  const recorder = testCase.spawnRecorder;
  const overheadBefore = recorder ? recorder.overheadMs() : 0;
  const startedAt = performance.now();
  let result;
  let error = null;
  try {
    result = await testCase.call();
  } catch (thrown) {
    error = thrown;
  }
  const durationMs = performance.now() - startedAt;
  const instrumentationOverheadMs = recorder ? Math.max(0, recorder.overheadMs() - overheadBefore) : 0;
  const cpuAfter = process.cpuUsage();
  // First endpoint BEFORE projection/digest/oracle allocations, so published
  // growth belongs to the production call rather than the harness around it.
  const memoryAfterInvocationBytes = memoryBytes();
  const ticksAtReturn = heartbeat.ticks();
  const observation = await heartbeat.settle(Math.max(ticksAtReturn, ticksAtStart));
  if (error) {
    return {
      ok: false,
      error: error.message,
      durationMs,
      rawDurationMs: durationMs,
      instrumentationOverheadMs,
      cpu: cpuDeltaMicros(cpuBefore, cpuAfter),
      heartbeat: observation,
      memoryAfterInvocationBytes,
    };
  }
  let projected = testCase.project(result);
  const verified = testCase.oracle(projected, result);
  const projectionDigest = digestOf(projected);
  // Drop this frame's references before the caller's settle sleep.
  projected = null;
  result = null;
  return {
    ok: verified,
    projectionDigest,
    durationMs: Math.max(0, durationMs - instrumentationOverheadMs),
    rawDurationMs: durationMs,
    instrumentationOverheadMs,
    cpu: cpuDeltaMicros(cpuBefore, cpuAfter),
    heartbeat: observation,
    memoryAfterInvocationBytes,
  };
}

/**
 * One case, one process.
 *
 * `dependencies` is the test seam: ordinary tests inject a workload so the call
 * count/order and the memory protocol can be asserted deterministically without
 * running the real benchmark.
 */
async function measureCase(caseId, context, dependencies = {}) {
  const buildCase = typeof dependencies.createCase === 'function' ? dependencies.createCase : createCase;
  const resolvePaths = typeof dependencies.resolveCasePaths === 'function'
    ? dependencies.resolveCasePaths
    : resolveCasePaths;
  const settle = typeof dependencies.sleep === 'function' ? dependencies.sleep : sleep;
  const runControls = typeof dependencies.probeControls === 'function'
    ? dependencies.probeControls
    : probeControls;
  const paths = resolvePaths(caseId, context.fixtureRoot);
  const cacheBefore = new Set(Object.keys(require.cache));
  const testCase = buildCase(caseId, paths, context);
  const moduleLoad = testCase.modules.finish();
  const resolvedModules = collectResolvedModules(context.sourceRoot, cacheBefore);
  const afterLoadBytes = memoryBytes();
  const controls = await runControls();

  const fail = (phase, extra = {}) => ({
    case: caseId,
    ok: false,
    failure: 'CORRECTNESS_FAILURE',
    failurePhase: phase,
    ...extra,
    detail: testCase.detail || null,
    moduleLoad,
    resolvedModules,
    controls,
    afterLoadBytes,
  });

  // The ACTUAL first invocation. It is timed like every other sample and its
  // correctness is judged afterwards against the precomputed fixture oracle.
  const firstInvocation = await timeOneCall(testCase);
  if (!firstInvocation.ok) {
    return fail('first invocation', {
      expectedDigest: context.expectedDigests[caseId],
      observedDigest: firstInvocation.projectionDigest || null,
      error: firstInvocation.error || null,
      firstInvocation,
    });
  }

  const warmups = [];
  for (let index = 0; index < WARMUP_INVOCATIONS; index += 1) {
    const sample = await timeOneCall(testCase);
    if (!sample.ok) {
      return fail(`warmup ${index + 1}`, {
        expectedDigest: context.expectedDigests[caseId],
        observedDigest: sample.projectionDigest || null,
        error: sample.error || null,
      });
    }
    warmups.push(sample);
  }

  const measured = [];
  const memoryObservations = [];
  for (let index = 0; index < MEASURED_INVOCATIONS; index += 1) {
    const sample = await timeOneCall(testCase);
    if (!sample.ok) {
      return fail(`measured ${index + 1}`, {
        expectedDigest: context.expectedDigests[caseId],
        observedDigest: sample.projectionDigest || null,
        error: sample.error || null,
      });
    }
    measured.push(sample);
    // The invocation's result is released by `timeOneCall`; wait the declared
    // settle window before taking this invocation's second endpoint.
    await settle(MEMORY_SETTLE_MS);
    memoryObservations.push({
      index: index + 1,
      settleMs: MEMORY_SETTLE_MS,
      afterInvocationBytes: sample.memoryAfterInvocationBytes,
      postYieldBytes: memoryBytes(),
    });
  }

  const rssGrowth = memoryObservations.map(
    (row) => row.postYieldBytes.rssBytes - afterLoadBytes.rssBytes,
  );
  const heapGrowth = memoryObservations.map(
    (row) => row.postYieldBytes.heapUsedBytes - afterLoadBytes.heapUsedBytes,
  );
  return {
    case: caseId,
    ok: true,
    expectedDigest: context.expectedDigests[caseId],
    projectionDigest: firstInvocation.projectionDigest,
    detail: testCase.detail || null,
    moduleLoad,
    resolvedModules,
    controls,
    ownedChildProcess: {
      note: 'F cases run `git check-ignore` as a task-owned child of this worker',
      ...(testCase.spawnRecorder
        ? testCase.spawnRecorder.summary()
        : { instrumented: false, spawnCount: 0, children: [], bookkeepingOverheadMs: 0 }),
    },
    firstInvocation,
    warmupCount: warmups.length,
    warmupDurationMs: summarizeSeries(warmups.map((row) => row.durationMs)),
    measured: {
      count: measured.length,
      // RAW elapsed time is the authoritative duration series. The
      // instrumentation-adjusted value is published separately as an estimate
      // and is never used for threshold decisions.
      durationMs: summarizeSeries(measured.map((row) => row.rawDurationMs)),
      adjustedDurationEstimateMs: summarizeSeries(measured.map((row) => row.durationMs)),
      authoritativeDurationSeries: 'rawDurationMs',
      cpuUserMs: summarizeSeries(measured.map((row) => row.cpu.userMs)),
      cpuSystemMs: summarizeSeries(measured.map((row) => row.cpu.systemMs)),
      cpuTotalMs: summarizeSeries(measured.map((row) => row.cpu.totalMs)),
      heartbeatMaxLatenessMs: summarizeSeries(measured.map((row) => row.heartbeat.maxLatenessMs)),
      heartbeatMedianLatenessMs: summarizeSeries(measured.map((row) => row.heartbeat.medianLatenessMs)),
      heartbeatUnobserved: measured.filter((row) => !row.heartbeat.observed).length,
      instrumentationOverheadMs: summarizeSeries(measured.map((row) => row.instrumentationOverheadMs)),
    },
    memory: {
      protocol: 'per-invocation-post-yield-growth',
      settleMs: MEMORY_SETTLE_MS,
      baseline: 'after-load',
      immediateEndpointTakenBeforeProjection: true,
      afterLoadBytes,
      observations: memoryObservations,
      rssGrowthBytes: summarizeSeries(rssGrowth),
      heapGrowthBytes: summarizeSeries(heapGrowth),
    },
    perInvocation: measured.map((row) => ({
      durationMs: row.durationMs,
      rawDurationMs: row.rawDurationMs,
      instrumentationOverheadMs: row.instrumentationOverheadMs,
      cpuUserMs: row.cpu.userMs,
      cpuSystemMs: row.cpu.systemMs,
      cpuTotalMs: row.cpu.totalMs,
      heartbeatMaxLatenessMs: row.heartbeat.maxLatenessMs,
      heartbeatMedianLatenessMs: row.heartbeat.medianLatenessMs,
      heartbeatObserved: row.heartbeat.observed,
    })),
  };
}

function parseArgs(argv) {
  const args = { case: '', fixture: '', jsonOut: '', sourceRoot: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--case') args.case = value || '';
    else if (key === '--fixture') args.fixture = value || '';
    else if (key === '--json-out') args.jsonOut = value || '';
    else if (key === '--source-root') args.sourceRoot = value || '';
  }
  if (!args.case) throw new Error('--case is required');
  if (!args.fixture) throw new Error('--fixture is required');
  if (!CASE_IDS.includes(args.case)) throw new Error(`--case must be one of ${CASE_IDS.join(', ')}`);
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtureRoot = path.resolve(args.fixture);
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'));
  const sourceRoot = path.resolve(args.sourceRoot || manifest.sourceRoot);
  const context = {
    fixtureRoot,
    sourceRoot,
    gitDir: manifest.gitDir || null,
    expectedDigests: manifest.expectedDigests,
  };
  if (!context.expectedDigests || typeof context.expectedDigests[args.case] !== 'string') {
    throw new Error(`fixture manifest has no expected digest for ${args.case}`);
  }
  const result = await measureCase(args.case, context);
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    case: args.case,
    fixtureRoot,
    sourceRoot,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    result,
  };
  if (args.jsonOut) {
    const target = path.resolve(args.jsonOut);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
  }
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(payload)}\n`);
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  CASE_IDS,
  CALIBRATION_BLOCK_MS,
  CHILD_PREFIX,
  HEARTBEAT_INTERVAL_MS,
  MEASURED_INVOCATIONS,
  MEMORY_SETTLE_MS,
  RESULT_PREFIX,
  SCHEMA_VERSION,
  WARMUP_INVOCATIONS,
  busyWait,
  collectResolvedModules,
  cpuDeltaMicros,
  createCase,
  createHeartbeat,
  digestOf,
  installSpawnRecorder,
  measureCase,
  median,
  medianAbsoluteDeviation,
  memoryBytes,
  probeControls,
  projectResult,
  resolveCasePaths,
  sha256File,
  stableStringify,
  summarizeSeries,
  timeOneCall,
};

if (require.main === module) {
  main().catch((error) => {
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      fatal: error.message,
    })}\n`);
    process.exitCode = 1;
  });
}
