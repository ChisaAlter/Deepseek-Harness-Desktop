'use strict';

/**
 * C2 S1 attribution worker: one mode per process.
 *
 * Measurement-only. The worker loads the selected candidate's real
 * `scanImport` (never a copy of the algorithm), points every home/skill path at
 * a synthetic fixture, and records two untimed warm-ups plus ten measured
 * scans. The profiled mode wraps ONLY that measured scan block in an in-process
 * `node:inspector` CPU profile: the profiler is started after the warm-ups,
 * stopped before any projection/digest/oracle/serialization work, and
 * `disconnect()`ed in a `finally` block so a failed scan cannot leave the
 * inspector attached.
 *
 * The raw `.cpuprofile` is written to disk and its SHA256 is reported; the
 * attribution arithmetic lives in the parent harness, which recomputes every
 * published statistic from that raw file instead of trusting this worker's
 * summary.
 *
 * Run as a script:
 *   node import-scan-profile-worker.cjs --mode profiled --fixture <dir> \
 *     --source-root <root> --json-out <file> --cpuprofile-out <file>
 * It prints exactly one JSON line prefixed with `PERF_PROFILE_RESULT ` and exits
 * 1 when the run is invalid or the result digest does not match the fixture
 * oracle.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const inspector = require('node:inspector');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const perfWorker = require('./desktop-perf-worker.cjs');

const {
  MEASURED_INVOCATIONS,
  WARMUP_INVOCATIONS,
  collectResolvedModules,
  cpuDeltaMicros,
  createCase,
  memoryBytes,
  resolveCasePaths,
  summarizeSeries,
} = perfWorker;

const RESULT_PREFIX = 'PERF_PROFILE_RESULT ';
const SCHEMA_VERSION = 1;
const CASE_ID = 'S1';
/**
 * Sampling interval is part of the declared protocol: 250 us keeps the sample
 * population large enough for category shares on a ~1.5 s workload while
 * staying coarse enough that the profiler's own overhead stays measurable
 * against the unprofiled control process.
 */
const DEFAULT_SAMPLING_INTERVAL_MICROS = 250;
const MODES = ['control', 'profiled'];

function parseIntOption(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`expected a positive integer, received ${value}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = {
    fixture: '',
    sourceRoot: '',
    jsonOut: '',
    cpuProfileOut: '',
    mode: 'control',
    samplingIntervalMicros: DEFAULT_SAMPLING_INTERVAL_MICROS,
    scans: MEASURED_INVOCATIONS,
    warmups: WARMUP_INVOCATIONS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--fixture') args.fixture = value || '';
    else if (key === '--source-root') args.sourceRoot = value || '';
    else if (key === '--json-out') args.jsonOut = value || '';
    else if (key === '--cpuprofile-out') args.cpuProfileOut = value || '';
    else if (key === '--mode') args.mode = value || '';
    else if (key === '--sampling-interval-micros') args.samplingIntervalMicros = parseIntOption(value, DEFAULT_SAMPLING_INTERVAL_MICROS);
    else if (key === '--scans') args.scans = parseIntOption(value, MEASURED_INVOCATIONS);
    else if (key === '--warmups') args.warmups = parseIntOption(value, WARMUP_INVOCATIONS);
  }
  if (!args.fixture) throw new Error('--fixture is required');
  if (!MODES.includes(args.mode)) throw new Error(`--mode must be one of ${MODES.join(', ')}`);
  if (args.mode === 'profiled' && !args.cpuProfileOut) {
    throw new Error('--cpuprofile-out is required in profiled mode');
  }
  return args;
}

/** Wrap a `Session.post` call in a promise; the callback form is the only one. */
function post(session, method, params) {
  return new Promise((resolve, reject) => {
    session.post(method, params || {}, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

/**
 * One timed scan. The window starts immediately before the production call and
 * stops when it settles. Nothing else (projection, digest, oracle, file IO) is
 * inside the window, and the raw elapsed time is what the parent consumes.
 */
async function timeScan(testCase) {
  const cpuBefore = process.cpuUsage();
  const startedAt = performance.now();
  let result = null;
  let error = null;
  try {
    result = await testCase.call();
  } catch (thrown) {
    error = thrown;
  }
  const rawDurationMs = performance.now() - startedAt;
  return {
    error,
    rawDurationMs,
    cpu: cpuDeltaMicros(cpuBefore, process.cpuUsage()),
    result,
  };
}

function sha256File(file) {
  try {
    return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
  } catch {
    return null;
  }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

async function measure(testCase, args, hooks = {}) {
  const createSession = typeof hooks.createSession === 'function'
    ? hooks.createSession
    : () => new inspector.Session();
  const warmups = [];
  for (let index = 0; index < args.warmups; index += 1) {
    const sample = await timeScan(testCase);
    if (sample.error) {
      throw new Error(`warm-up ${index + 1} failed: ${sample.error.message}`);
    }
    if (!testCase.oracle(testCase.project(sample.result), sample.result)) {
      throw new Error(`warm-up ${index + 1} produced a result that does not match the fixture oracle`);
    }
    warmups.push(sample.rawDurationMs);
    sample.result = null;
  }

  let session = null;
  let sessionConnected = false;
  let sessionDisconnected = false;
  let rawProfile = null;
  let profileStopError = null;
  let profilerEnabled = false;
  const measured = [];

  // Profiler setup is INSIDE the protected lifetime: a failure at enable,
  // interval configuration or start must still disconnect a connected session.
  let primaryError = null;
  try {
    if (args.mode === 'profiled') {
      session = createSession();
      session.connect();
      sessionConnected = true;
      await post(session, 'Profiler.enable');
      await post(session, 'Profiler.setSamplingInterval', { interval: args.samplingIntervalMicros });
      await post(session, 'Profiler.start');
      profilerEnabled = true;
    }
    for (let index = 0; index < args.scans; index += 1) {
      const sample = await timeScan(testCase);
      if (sample.error) {
        throw new Error(`measured scan ${index + 1} failed: ${sample.error.message}`);
      }
      measured.push(sample);
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (session) {
      if (profilerEnabled) {
        try {
          const stopped = await post(session, 'Profiler.stop');
          rawProfile = stopped && stopped.profile ? stopped.profile : null;
        } catch (error) {
          profileStopError = error && error.message ? error.message : String(error);
        }
      }
      // Always detach: an attached inspector session changes the process it is
      // measuring and must never outlive this function.
      if (sessionConnected) {
        try {
          session.disconnect();
          sessionDisconnected = true;
        } catch (error) {
          if (!profileStopError) {
            profileStopError = error && error.message ? error.message : String(error);
          }
        }
      }
    }
  }

  // A failed run keeps its primary error; the cleanup outcome is reported
  // separately so a cleanup fault can never be mistaken for scan success.
  if (primaryError) {
    primaryError.profileStopError = profileStopError;
    // `sessionDisconnected` must describe the DISCONNECT OPERATION, not a
    // successful connection. A throwing disconnect() therefore reports false.
    primaryError.sessionDisconnected = session ? sessionDisconnected : true;
    throw primaryError;
  }
  if (args.mode === 'profiled' && profileStopError) {
    const cleanupError = new Error(`profiler cleanup failed: ${profileStopError}`);
    cleanupError.failure = 'PROFILER_CLEANUP_FAILED';
    cleanupError.profileStopError = profileStopError;
    // Same contract as the primary-error path: the flag describes whether the
    // detach actually succeeded, and a throwing disconnect leaves it false.
    cleanupError.sessionDisconnected = session ? sessionDisconnected : true;
    throw cleanupError;
  }

  // Correctness is judged AFTER the profiler is gone, so oracle/digest work is
  // never attributed to the production scan.
  let projectionDigest = null;
  for (let index = 0; index < measured.length; index += 1) {
    const projection = testCase.project(measured[index].result);
    if (!testCase.oracle(projection, measured[index].result)) {
      throw new Error(`measured scan ${index + 1} produced a result that does not match the fixture oracle`);
    }
    if (projectionDigest === null) projectionDigest = perfWorker.digestOf(projection);
    measured[index].result = null;
  }

  return {
    warmups,
    measured,
    projectionDigest,
    rawProfile,
    profileStopError,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtureRoot = path.resolve(args.fixture);
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8'));
  const sourceRoot = path.resolve(args.sourceRoot || manifest.sourceRoot);
  const expectedDigest = manifest.expectedDigests && manifest.expectedDigests[CASE_ID];
  if (typeof expectedDigest !== 'string') {
    throw new Error(`fixture manifest has no expected digest for ${CASE_ID}`);
  }
  const context = {
    fixtureRoot,
    sourceRoot,
    gitDir: manifest.gitDir || null,
    expectedDigests: manifest.expectedDigests,
  };

  const cacheBefore = new Set(Object.keys(require.cache));
  const testCase = createCase(CASE_ID, resolveCasePaths(CASE_ID, fixtureRoot), context);
  const resolvedModules = collectResolvedModules(sourceRoot, cacheBefore);
  const memoryBeforeBytes = memoryBytes();

  const run = await measure(testCase, args);

  const memoryAfterBytes = memoryBytes();
  let profile = null;
  if (args.mode === 'profiled') {
    if (!run.rawProfile) {
      throw new Error(`the CPU profiler produced no profile${run.profileStopError ? `: ${run.profileStopError}` : ''}`);
    }
    writeJson(args.cpuProfileOut, run.rawProfile);
    const samples = Array.isArray(run.rawProfile.samples) ? run.rawProfile.samples : [];
    const deltas = Array.isArray(run.rawProfile.timeDeltas) ? run.rawProfile.timeDeltas : [];
    let deltaTotalMicros = 0;
    for (const delta of deltas) {
      if (Number.isFinite(delta) && delta > 0) deltaTotalMicros += delta;
    }
    profile = {
      path: path.resolve(args.cpuProfileOut),
      sha256: sha256File(path.resolve(args.cpuProfileOut)),
      sampleIntervalMicros: args.samplingIntervalMicros,
      sampleCount: samples.length,
      timeDeltaCount: deltas.length,
      timeDeltaTotalMs: deltaTotalMicros / 1000,
      startTime: Number.isFinite(run.rawProfile.startTime) ? run.rawProfile.startTime : null,
      endTime: Number.isFinite(run.rawProfile.endTime) ? run.rawProfile.endTime : null,
      stoppedCleanly: run.profileStopError === null,
      stopError: run.profileStopError,
      profiledScans: run.measured.length,
    };
  }

  const wallSeries = run.measured.map((row) => row.rawDurationMs);
  const result = {
    ok: true,
    case: CASE_ID,
    expectedDigest,
    projectionDigest: run.projectionDigest,
    digestMatchesOracle: run.projectionDigest === expectedDigest,
    warmupCount: run.warmups.length,
    warmupDurationMs: summarizeSeries(run.warmups),
    scans: run.measured.length,
    wallDurationMs: summarizeSeries(wallSeries),
    cpuUserMs: summarizeSeries(run.measured.map((row) => row.cpu.userMs)),
    cpuSystemMs: summarizeSeries(run.measured.map((row) => row.cpu.systemMs)),
    cpuTotalMs: summarizeSeries(run.measured.map((row) => row.cpu.totalMs)),
    perScan: run.measured.map((row, index) => ({
      index: index + 1,
      rawDurationMs: row.rawDurationMs,
      cpuUserMs: row.cpu.userMs,
      cpuSystemMs: row.cpu.systemMs,
      cpuTotalMs: row.cpu.totalMs,
    })),
    memoryBeforeBytes,
    memoryAfterBytes,
    resolvedModules,
    profile,
  };
  if (!result.digestMatchesOracle) {
    result.ok = false;
    result.failure = 'DIGEST_MISMATCH';
  }
  // The wrapper's own outcome flag: `result.ok` describes the measurement,
  // `payload.ok` is what the parent's completion check consumes. Both must
  // agree, so a digest failure can never be accepted as a success payload.
  const ok = result.ok === true;

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    mode: args.mode,
    case: CASE_ID,
    ok,
    fixtureRoot,
    sourceRoot,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    scansRequested: args.scans,
    warmupsRequested: args.warmups,
    result,
  };
  if (args.jsonOut) writeJson(args.jsonOut, payload);
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(payload)}\n`);
  if (!result.ok) process.exitCode = 1;
}

module.exports = {
  CASE_ID,
  DEFAULT_SAMPLING_INTERVAL_MICROS,
  MODES,
  RESULT_PREFIX,
  SCHEMA_VERSION,
  measure,
  parseArgs,
  post,
  timeScan,
};

if (require.main === module) {
  main().catch((error) => {
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      fatal: error && error.message ? error.message : String(error),
    })}\n`);
    process.exitCode = 1;
  });
}
