import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ATTRIBUTION_RULE,
  MODES,
  RESULT_PREFIX,
  USER_FUNCTION_CATEGORY,
  VERDICTS,
  classifyFrame,
  decideAttribution,
  evaluateExecution,
  finalizeReport,
  inclusiveByFunction,
  median,
  parseArgs,
  parseProfile,
  profilerOverhead,
  runProfileWorker,
  summarizeSeries,
  validateProfileStructure,
  validateProfileRun,
} from './profile-import-scan.mjs';
import worker from './lib/import-scan-profile-worker.cjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dshd-c2-test-'));
}

/**
 * A synthetic V8 CPU profile. `spec` entries are
 * `{ id, parent, functionName, url, selfMicros }`, so a test can state exactly
 * how much sampled time lands on which frame and verify the arithmetic without
 * depending on a real profiler run.
 */
function buildProfile(spec, { endTime = 1000, startTime = 0 } = {}) {
  const nodes = [];
  const samples = [];
  const timeDeltas = [];
  const childrenOf = new Map();
  for (const row of spec) {
    if (row.parent === undefined || row.parent === null) continue;
    if (!childrenOf.has(row.parent)) childrenOf.set(row.parent, []);
  }
  for (const row of spec) {
    nodes.push({
      id: row.id,
      callFrame: {
        functionName: row.functionName || '',
        url: row.url === undefined ? `file://${REPO_ROOT.replace(/\\/g, '/')}/src/main/data-import.js` : row.url,
        lineNumber: row.lineNumber === undefined ? 0 : row.lineNumber,
        columnNumber: 0,
      },
      hitCount: 0,
      children: [],
    });
    if (row.parent !== undefined && row.parent !== null) {
      childrenOf.get(row.parent).push(row.id);
    }
  }
  for (const node of nodes) node.children = childrenOf.get(node.id) || [];

  // Round-robin the sample budget over each frame's declared self time in
  // 1 ms units, so the totals are exact and the test is deterministic.
  let deltaMicros = 1000;
  let id = 1;
  for (const row of spec) {
    const samplesForFrame = Math.round((row.selfMicros || 0) / 1000);
    for (let index = 0; index < samplesForFrame; index += 1) {
      samples.push(row.id);
      timeDeltas.push(deltaMicros);
      id += 1;
    }
  }
  return { nodes, samples, timeDeltas, startTime, endTime };
}

function nodeSpec(overrides) {
  return { id: 1, parent: null, functionName: '', selfMicros: 0, ...overrides };
}

test('the predeclared attribution rule is fixed and never adjusted afterwards', () => {
  assert.equal(ATTRIBUTION_RULE.minCategoryShare, 0.20);
  assert.equal(ATTRIBUTION_RULE.minCategoryMsPerScan, 20);
  assert.equal(ATTRIBUTION_RULE.maxProfilerOverhead, 0.20);
});

test('the two worker modes are exactly control and profiled', () => {
  assert.deepEqual(MODES, ['control', 'profiled']);
  assert.deepEqual(worker.MODES, MODES);
});

test('every named production function maps to a declared category', () => {
  for (const [fn, category] of Object.entries(USER_FUNCTION_CATEGORY)) {
    assert.equal(typeof fn, 'string');
    assert.equal(typeof category, 'string');
    assert.ok(category.length > 0);
  }
  assert.equal(USER_FUNCTION_CATEGORY.walkSessionDirs, 'session-walk');
  assert.equal(USER_FUNCTION_CATEGORY.readSessionDisplayMeta, 'session-meta-read');
  assert.equal(USER_FUNCTION_CATEGORY.destHasSession, 'dest-existence');
  assert.equal(USER_FUNCTION_CATEGORY.scanImport, 'scan-orchestration');
});

test('the CLI refuses an unparseable scan count instead of silently using the default', () => {
  assert.throws(
    () => parseArgs(['--source-root', REPO_ROOT, '--out', path.join(tempRoot(), 'out'), '--scans', 'zero']),
    /--scans must be a positive integer/,
  );
  assert.throws(() => parseArgs(['--out', path.join(tempRoot(), 'out')]), /--source-root is required/);
  assert.throws(() => parseArgs(['--source-root', REPO_ROOT]), /--out is required/);
});

test('classification separates GC, user code, dependencies and everything else', () => {
  const userUrl = `file://${REPO_ROOT.replace(/\\/g, '/')}/src/main/data-import.js`;
  const depUrl = `file://${REPO_ROOT.replace(/\\/g, '/')}/node_modules/js-yaml/index.js`;
  assert.equal(classifyFrame({ callFrame: { functionName: '(garbage collector)', url: '' } }, REPO_ROOT), 'gc');
  assert.equal(classifyFrame({ callFrame: { functionName: 'walkSessionDirs', url: userUrl } }, REPO_ROOT), 'user');
  assert.equal(classifyFrame({ callFrame: { functionName: 'parse', url: depUrl } }, REPO_ROOT), 'dependency');
  assert.equal(classifyFrame({ callFrame: { functionName: '', url: '' } }, REPO_ROOT), 'other');
  assert.equal(classifyFrame({ callFrame: { functionName: 'readFileSync', url: 'node:fs' } }, REPO_ROOT), 'other');
  assert.equal(classifyFrame({ callFrame: { functionName: 'foo', url: 'file:///C:/elsewhere/x.js' } }, REPO_ROOT), 'other');
});

test('a frame outside both roots is never counted as user code', () => {
  const otherUrl = 'file:///C:/somewhere-else/not-ours.js';
  assert.equal(classifyFrame({ callFrame: { functionName: 'walkSessionDirs', url: otherUrl } }, REPO_ROOT), 'other');
});

test('category shares are self-time based and sum to the attributed total', () => {
  const profile = buildProfile([
    nodeSpec({ id: 1, functionName: 'scanImport', selfMicros: 4000 }),
    nodeSpec({ id: 2, parent: 1, functionName: 'walkSessionDirs', selfMicros: 6000 }),
  ]);
  const parsed = parseProfile(profile, REPO_ROOT);
  const total = parsed.byCategory.reduce((sum, row) => sum + row.totalMs, 0);
  assert.ok(Math.abs(total - parsed.attributedTotalMs) < 1e-6);
  const shares = parsed.byCategory.reduce((sum, row) => sum + (row.share || 0), 0);
  assert.ok(Math.abs(shares - 1) < 1e-6, `shares sum to ${shares}`);
  assert.equal(parsed.attributedTotalMs, 10);
  const walk = parsed.byCategory.find((row) => row.category === 'session-walk');
  assert.equal(walk.totalMs, 6);
  assert.equal(walk.share, 0.6);
});

test('the GC bucket is published separately and never merged into a user category', () => {
  const profile = buildProfile([
    nodeSpec({ id: 1, functionName: '(garbage collector)', url: '', selfMicros: 3000 }),
    nodeSpec({ id: 2, functionName: 'walkSessionDirs', selfMicros: 7000 }),
  ]);
  const parsed = parseProfile(profile, REPO_ROOT);
  assert.equal(parsed.gcMs, 3);
  assert.equal(parsed.gcShare, 0.3);
  const walk = parsed.byCategory.find((row) => row.category === 'session-walk');
  assert.equal(walk.totalMs, 7);
  assert.equal(parsed.byCategory.some((row) => row.category === 'gc'), true);
  assert.equal(
    parsed.byCategory.reduce((sum, row) => sum + row.totalMs, 0),
    parsed.attributedTotalMs,
  );
});

test('an unattributable sample lands in the unclassified bucket, not in a named category', () => {
  const profile = buildProfile([
    nodeSpec({ id: 1, functionName: '', url: 'file:///C:/not-ours.dll', selfMicros: 5000 }),
    nodeSpec({ id: 2, functionName: 'walkSessionDirs', selfMicros: 5000 }),
  ]);
  const parsed = parseProfile(profile, REPO_ROOT);
  assert.equal(parsed.unclassifiedMs, 5);
  assert.equal(parsed.unclassifiedShare, 0.5);
  assert.equal(parsed.byCategory.find((row) => row.category === 'unclassified').totalMs, 5);
});

test('a native or builtin frame nested under a production function is charged to that function', () => {
  const profile = buildProfile([
    nodeSpec({ id: 1, functionName: 'readSessionDisplayMeta', selfMicros: 1000 }),
    nodeSpec({ id: 2, parent: 1, functionName: 'readFileSync', url: 'node:fs', selfMicros: 4000 }),
  ]);
  const parsed = parseProfile(profile, REPO_ROOT);
  const meta = parsed.byCategory.find((row) => row.category === 'session-meta-read');
  assert.equal(meta.totalMs, 5);
  assert.equal(parsed.unclassifiedMs, 0);
});

test('a builtin frame with no production ancestor stays unclassified', () => {
  const profile = buildProfile([
    nodeSpec({ id: 1, functionName: 'readFileSync', url: 'node:fs', selfMicros: 4000 }),
  ]);
  const parsed = parseProfile(profile, REPO_ROOT);
  assert.equal(parsed.unclassifiedMs, 4);
  assert.equal(parsed.unclassifiedShare, 1);
});

test('negative and non-finite time deltas are rejected by the structure gate, not dropped sample by sample', () => {
  const profile = buildProfile([
    nodeSpec({ id: 1, functionName: 'walkSessionDirs', selfMicros: 3000 }),
  ]);
  // Control: the untouched profile is acceptable.
  assert.deepEqual(validateProfileStructure(profile), []);
  profile.timeDeltas[0] = -500;
  assert.deepEqual(validateProfileStructure(profile), ['PROFILE_DELTA_INVALID']);
  const nonFinite = buildProfile([
    nodeSpec({ id: 1, functionName: 'walkSessionDirs', selfMicros: 3000 }),
  ]);
  nonFinite.timeDeltas[0] = NaN;
  assert.deepEqual(validateProfileStructure(nonFinite), ['PROFILE_DELTA_INVALID']);
  const notANumber = buildProfile([
    nodeSpec({ id: 1, functionName: 'walkSessionDirs', selfMicros: 3000 }),
  ]);
  notANumber.timeDeltas[0] = '500';
  assert.deepEqual(validateProfileStructure(notANumber), ['PROFILE_DELTA_INVALID']);
});

test('a profile whose timing series has no positive elapsed time is unusable', () => {
  const allZero = buildProfile([
    nodeSpec({ id: 1, parent: null, functionName: 'walkSessionDirs', selfMicros: 3000 }),
  ]);
  // Keep the sample series: an empty profile is rejected for missing samples
  // long before "no elapsed time" is a meaningful statement.
  assert.equal(allZero.timeDeltas.length, 3);
  allZero.timeDeltas = allZero.timeDeltas.map(() => 0);
  assert.deepEqual(validateProfileStructure(allZero), ['PROFILE_TIMING_UNUSABLE']);

  // A single zero-length delta inside an otherwise usable series is fine.
  const oneZero = buildProfile([
    nodeSpec({ id: 1, parent: null, functionName: 'walkSessionDirs', selfMicros: 3000 }),
  ]);
  oneZero.timeDeltas[1] = 0;
  assert.deepEqual(validateProfileStructure(oneZero), []);
});

test('self-cycles and multi-node cycles are rejected before ancestor traversal', () => {
  const selfCycle = buildProfile([
    nodeSpec({ id: 1, functionName: 'scanImport', selfMicros: 1000 }),
  ]);
  selfCycle.nodes[0].children = [1];
  assert.equal(validateProfileStructure(selfCycle).includes('PROFILE_GRAPH_CYCLIC'), true);

  const multiCycle = buildProfile([
    nodeSpec({ id: 1, functionName: '', url: 'node:fs', selfMicros: 1000 }),
    nodeSpec({ id: 2, functionName: '', url: 'node:fs', selfMicros: 1000 }),
  ]);
  multiCycle.nodes[0].children = [2];
  multiCycle.nodes[1].children = [1];
  assert.equal(validateProfileStructure(multiCycle).includes('PROFILE_GRAPH_CYCLIC'), true);

  const conflictingParent = buildProfile([
    nodeSpec({ id: 1, functionName: 'walkSessionDirs', selfMicros: 1000 }),
    nodeSpec({ id: 2, functionName: 'scanImport', selfMicros: 1000 }),
    nodeSpec({ id: 3, functionName: '', url: 'node:fs', selfMicros: 1000 }),
  ]);
  conflictingParent.nodes[0].children = [3];
  conflictingParent.nodes[1].children = [3];
  assert.equal(validateProfileStructure(conflictingParent).includes('PROFILE_GRAPH_CYCLIC'), true);
});

test('defensive ancestor traversal terminates even on an unvalidated cyclic graph', () => {
  const profile = buildProfile([
    nodeSpec({ id: 1, functionName: '', url: 'node:fs', selfMicros: 1000 }),
  ]);
  profile.nodes[0].children = [1];
  const parsed = parseProfile(profile, REPO_ROOT);
  assert.equal(parsed.attributedTotalMs, 1);
  assert.equal(parsed.unclassifiedMs, 1);
});

test('a sample pointing at a node that is not in the tree is recorded, not guessed', () => {
  const profile = buildProfile([
    nodeSpec({ id: 1, functionName: 'walkSessionDirs', selfMicros: 1000 }),
  ]);
  profile.samples.push(999);
  profile.timeDeltas.push(1000);
  const parsed = parseProfile(profile, REPO_ROOT);
  assert.equal(parsed.orphanSamples, 1);
  assert.equal(parsed.sampleCount, 2);
});

test('inclusive diagnostics accumulate over ancestors and are not disjoint shares', () => {
  const profile = buildProfile([
    nodeSpec({ id: 1, functionName: 'scanImport', selfMicros: 1000 }),
    nodeSpec({ id: 2, parent: 1, functionName: 'walkSessionDirs', selfMicros: 2000 }),
    nodeSpec({ id: 3, parent: 2, functionName: '', url: 'node:fs', selfMicros: 3000 }),
  ]);
  const parsed = parseProfile(profile, REPO_ROOT);
  const rows = inclusiveByFunction(profile, parsed);
  const walk = rows.find((row) => row.functionName === 'walkSessionDirs');
  assert.equal(walk.selfMs, 2);
  assert.equal(walk.inclusiveMs, 5);
  const scan = rows.find((row) => row.functionName === 'scanImport');
  assert.equal(scan.inclusiveMs, 6);
});

test('median and summary statistics over an empty series are null, never zero', () => {
  assert.equal(median([]), null);
  assert.equal(median([undefined, NaN]), null);
  const summary = summarizeSeries([]);
  assert.equal(summary.median, null);
  assert.equal(summary.count, 0);
});

test('profiler overhead is a ratio against the unprofiled control process', () => {
  assert.equal(profilerOverhead(100, 110), 0.1);
  assert.equal(profilerOverhead(100, 80), -0.2);
  assert.equal(profilerOverhead(0, 10), null);
  assert.equal(profilerOverhead(null, 10), null);
});

/**
 * A supportable candidate must clear BOTH the share floor and the ms-per-scan
 * floor in BOTH rounds. Anything less is not a recommendation.
 */
function roundRow({ round, controlMedian, profiledMedian, categories, scans = 10 }) {
  return {
    round,
    control: { ok: true, result: { wallDurationMs: { median: controlMedian, samples: [controlMedian] } } },
    profiled: {
      ok: true,
      result: { wallDurationMs: { median: profiledMedian, samples: [profiledMedian] } },
      scans,
      attribution: {
        byCategory: categories,
        unclassifiedShare: 0.05,
      },
    },
  };
}

/**
 * A category row exactly as the parser publishes it: `share` is the category's
 * fraction of the DISJOINT attributed total (the sum of every category row), so
 * each case must state that denominator instead of implying it from the scan
 * count.
 */
function category(name, totalMs, attributedTotalMs) {
  return { category: name, totalMs, share: totalMs / attributedTotalMs, samples: 1 };
}

test('a category that clears both floors in both rounds is reported as a supportable proposal', () => {
  const total = 1200;
  const rounds = [
    roundRow({
      round: 1,
      controlMedian: 150,
      profiledMedian: 155,
      categories: [
        category('session-meta-read', 620, total),
        category('session-walk', 420, total),
      ],
    }),
    roundRow({
      round: 2,
      controlMedian: 148,
      profiledMedian: 150,
      categories: [
        category('session-meta-read', 600, total),
        category('session-walk', 400, total),
      ],
    }),
  ];
  const decision = decideAttribution(rounds);
  assert.equal(decision.verdict, 'PROPOSAL_SUPPORTABLE');
  // Both categories clear both floors in both rounds; the largest share leads.
  assert.deepEqual(decision.candidates.map((row) => row.category), ['session-meta-read', 'session-walk']);
  assert.equal(decision.candidates[0].perRound[1].msPerScan, 62);
  assert.equal(decision.candidates[0].perRound[2].msPerScan, 60);
  assert.equal(decision.productionOptimizationAuthorized, false);
});

test('a category that fails the per-scan floor in one round is not a candidate', () => {
  const total = 1200;
  const rounds = [
    roundRow({
      round: 1,
      controlMedian: 150,
      profiledMedian: 155,
      categories: [category('session-meta-read', 600, total)],
    }),
    roundRow({
      round: 2,
      controlMedian: 148,
      profiledMedian: 150,
      // 150 ms over ten scans is 15 ms per scan: clears neither floor.
      categories: [
        category('session-meta-read', 150, total),
        category('gc', 900, total),
      ],
    }),
  ];
  const decision = decideAttribution(rounds);
  assert.notEqual(decision.verdict, 'PROPOSAL_SUPPORTABLE');
  assert.equal(decision.candidates.some((row) => row.category === 'session-meta-read'), false);
});

test('a category below the share floor but above 20 ms per scan is not a candidate', () => {
  const total = 1000;
  const rounds = [
    roundRow({
      round: 1,
      controlMedian: 150,
      profiledMedian: 155,
      // 150 ms is 15% of the attributed total but 15 ms/scan: both below.
      categories: [
        category('gc', 700, total),
        category('session-walk', 150, total),
      ],
    }),
    roundRow({
      round: 2,
      controlMedian: 150,
      profiledMedian: 153,
      categories: [
        category('gc', 700, total),
        category('session-walk', 150, total),
      ],
    }),
  ];
  const decision = decideAttribution(rounds);
  // gc clears both floors (70 ms/scan, 70% share); session-walk does not.
  assert.equal(decision.candidates.some((row) => row.category === 'gc'), true);
  assert.equal(decision.candidates.some((row) => row.category === 'session-walk'), false);
});

test('no qualifying category yields the standing negative conclusion with a stable statement', () => {
  const total = 1000;
  const rounds = [
    roundRow({
      round: 1,
      controlMedian: 150,
      profiledMedian: 152,
      categories: [
        category('gc', 100, total),
        category('session-walk', 150, total),
      ],
    }),
    roundRow({
      round: 2,
      controlMedian: 148,
      profiledMedian: 149,
      categories: [
        category('gc', 100, total),
        category('session-walk', 150, total),
      ],
    }),
  ];
  const decision = decideAttribution(rounds);
  assert.equal(decision.verdict, 'NO_CANDIDATE_CATEGORY');
  assert.equal(decision.statement, 'Attribution remains inconclusive; no optimization is justified.');
  assert.equal(decision.productionOptimizationAuthorized, false);
});

test('profiler overhead above the declared ceiling downgrades the verdict to a limitation', () => {
  const total = 1000;
  const rounds = [
    roundRow({
      round: 1,
      controlMedian: 150,
      profiledMedian: 200,
      categories: [category('session-meta-read', 800, total)],
    }),
    roundRow({
      round: 2,
      controlMedian: 150,
      profiledMedian: 210,
      categories: [category('session-meta-read', 800, total)],
    }),
  ];
  const decision = decideAttribution(rounds);
  assert.equal(decision.verdict, 'LIMITATION_PROFILER_OVERHEAD');
  assert.equal(decision.candidates.length, 0);
  assert.ok(decision.limitations.includes('PROFILER_OVERHEAD_ROUND_1'));
  assert.ok(decision.limitations.includes('PROFILER_OVERHEAD_ROUND_2'));
});

test('unattributed time dominating a round downgrades the verdict to a limitation', () => {
  const total = 1000;
  const rounds = [
    roundRow({
      round: 1,
      controlMedian: 150,
      profiledMedian: 155,
      categories: [category('session-walk', 400, total)],
    }),
    roundRow({
      round: 2,
      controlMedian: 148,
      profiledMedian: 150,
      categories: [category('session-walk', 400, total)],
    }),
  ];
  rounds[1].profiled.attribution.unclassifiedShare = 0.7;
  const decision = decideAttribution(rounds);
  assert.equal(decision.verdict, 'LIMITATION_UNCLASSIFIED_DOMINATES');
  assert.ok(decision.limitations.includes('UNCLASSIFIED_DOMINATES_ROUND_2'));
  assert.equal(decision.candidates.length, 0);
});

test('a material ranking disagreement is recorded instead of silently averaged', () => {
  const total = 1000;
  const rounds = [
    roundRow({
      round: 1,
      controlMedian: 150,
      profiledMedian: 155,
      categories: [
        category('session-meta-read', 600, total),
        category('gc', 200, total),
      ],
    }),
    roundRow({
      round: 2,
      controlMedian: 150,
      profiledMedian: 155,
      categories: [
        category('gc', 600, total),
        category('session-meta-read', 200, total),
      ],
    }),
  ];
  const decision = decideAttribution(rounds);
  assert.equal(decision.rankingsAgree, false);
  assert.equal(decision.verdict, 'LIMITATION_RANKING_INSTABILITY');
  assert.equal(decision.statement, null);
});

test('an unmeasurable overhead or unclassified share is INCONCLUSIVE, not a negative conclusion', () => {
  const total = 1000;
  const rounds = [
    roundRow({
      round: 1,
      controlMedian: 0,
      profiledMedian: 155,
      categories: [category('session-walk', 400, total)],
    }),
    roundRow({
      round: 2,
      controlMedian: 150,
      profiledMedian: 155,
      categories: [category('session-walk', 400, total)],
    }),
  ];
  const decision = decideAttribution(rounds);
  assert.equal(decision.verdict, 'INCONCLUSIVE');
  assert.equal(decision.statement, 'Attribution remains inconclusive; no optimization is justified.');
});

test('the published verdict vocabulary is exactly the declared set', () => {
  assert.deepEqual(VERDICTS, [
    'NO_CANDIDATE_CATEGORY',
    'LIMITATION_PROFILER_OVERHEAD',
    'LIMITATION_UNCLASSIFIED_DOMINATES',
    'LIMITATION_RANKING_INSTABILITY',
    'PROPOSAL_SUPPORTABLE',
    'CORRECTNESS_FAILURE',
    'INCONCLUSIVE',
  ]);
});

/**
 * A complete, self-consistent worker payload. Everything the raw-evidence gate
 * checks is derived from these fields, so a test only has to state the one
 * property it is breaking.
 */
function validPayload({
  mode = 'control',
  scans = 10,
  warmups = 2,
  digest = 'sha256:good',
  wallSeries = null,
  schemaVersion = 1,
} = {}) {
  const series = wallSeries || Array.from({ length: scans }, (_, index) => 150 + index);
  const warmupSeries = Array.from({ length: warmups }, (_, index) => 90 + index);
  return {
    schemaVersion,
    mode,
    ok: true,
    case: 'S1',
    scansRequested: scans,
    warmupsRequested: warmups,
    result: {
      ok: true,
      case: 'S1',
      projectionDigest: digest,
      warmupCount: warmupSeries.length,
      warmupDurationMs: summarizeSeries(warmupSeries),
      scans: series.length,
      wallDurationMs: summarizeSeries(series),
      perScan: series.map((value, index) => ({ index: index + 1, rawDurationMs: value })),
      // One non-empty entry keeps the shape check satisfied without a source
      // root; the on-disk hash check only runs when a root is supplied.
      resolvedModules: [{ file: 'src/main/data-import.js', sha256: 'sha256:not-checked-without-root' }],
      profile: null,
    },
  };
}

function validOutcome(options = {}) {
  return { ok: true, payload: validPayload(options) };
}

test('a payload with a digest that does not match the fixture oracle is invalid', () => {
  const validation = validateProfileRun(validOutcome({ digest: 'sha256:bad' }), 'control', 'sha256:good', 10, 2);
  assert.equal(validation.ok, false);
  assert.equal(validation.reason, 'DIGEST_MISMATCH');
});

test('a payload missing samples or with a non-finite duration is invalid', () => {
  const base = validOutcome();
  assert.equal(validateProfileRun(base, 'control', 'sha256:good', 10, 2).ok, true);
  const shortSamples = structuredClone(base);
  shortSamples.payload.result.wallDurationMs.samples.pop();
  assert.equal(validateProfileRun(shortSamples, 'control', 'sha256:good', 10, 2).reason, 'MISSING_SAMPLES');
  const nonFinite = structuredClone(base);
  nonFinite.payload.result.wallDurationMs.samples[3] = null;
  assert.equal(validateProfileRun(nonFinite, 'control', 'sha256:good', 10, 2).reason, 'MISSING_SAMPLES');
  const wrongWarmups = structuredClone(base);
  wrongWarmups.payload.result.warmupCount = 1;
  assert.equal(validateProfileRun(wrongWarmups, 'control', 'sha256:good', 10, 2).reason, 'WRONG_WARMUP_COUNT');
  const noDeps = structuredClone(base);
  noDeps.payload.result.resolvedModules = [];
  assert.equal(validateProfileRun(noDeps, 'control', 'sha256:good', 10, 2).reason, 'RESOLVED_DEPENDENCIES_MISSING');
});

test('a profiled payload without a retained, cleanly stopped profile is invalid', () => {
  const base = validOutcome({ mode: 'profiled' });
  base.payload.result.profile = null;
  assert.equal(validateProfileRun(base, 'profiled', 'sha256:good', 10, 2).reason, 'MISSING_PROFILE');
  const dirtyStop = structuredClone(base);
  dirtyStop.payload.result.profile = {
    path: path.join(tempRoot(), 'x.cpuprofile'),
    sha256: 'sha256:x',
    stoppedCleanly: false,
  };
  assert.equal(validateProfileRun(dirtyStop, 'profiled', 'sha256:good', 10, 2).reason, 'PROFILER_STOP_FAILED');
  const missingFile = structuredClone(base);
  missingFile.payload.result.profile = {
    path: path.join(tempRoot(), 'absent.cpuprofile'),
    sha256: 'sha256:x',
    stoppedCleanly: true,
  };
  assert.equal(validateProfileRun(missingFile, 'profiled', 'sha256:good', 10, 2).reason, 'PROFILE_FILE_MISSING');
});

test('a failed worker outcome is never accepted as a result', () => {
  assert.equal(validateProfileRun({ ok: false, failure: 'WORKER_TIMEOUT' }, 'control', 'sha256:good', 10, 2).reason, 'WORKER_TIMEOUT');
  assert.equal(validateProfileRun(null, 'control', 'sha256:good', 10, 2).reason, 'WORKER_FAILED');
});

/**
 * Worker-completion tests with an injected spawn handle: no real process is
 * created, so these stay fast and cannot disturb an unrelated PID.
 */
function fakeSpawnHandle({ pid = 4321, closeWith = { code: 0, signal: null } } = {}) {
  const handlers = new Map();
  const stdoutHandlers = [];
  const stderrHandlers = [];
  const handle = {
    pid,
    killed: [],
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
      return handle;
    },
    kill(signal) {
      handle.killed.push(signal);
      return true;
    },
    stdout: {
      on(_event, handler) { stdoutHandlers.push(handler); },
    },
    stderr: {
      on(_event, handler) { stderrHandlers.push(handler); },
    },
  };
  return {
    handle,
    emitStdout(text) { for (const fn of stdoutHandlers) fn(Buffer.from(text)); },
    emitClose() {
      for (const fn of handlers.get('close') || []) fn(closeWith.code, closeWith.signal);
    },
    emitError(error) { for (const fn of handlers.get('error') || []) fn(error); },
  };
}

function payloadText(overrides = {}) {
  return `${RESULT_PREFIX}${JSON.stringify({
    schemaVersion: 1,
    mode: 'control',
    ok: true,
    result: { ok: true },
    ...overrides,
  })}\n`;
}

test('runProfileWorker accepts only a zero-exit worker that printed a success payload', async () => {
  const fake = fakeSpawnHandle();
  const promise = runProfileWorker({
    nodePath: 'node',
    workerPath: 'worker.cjs',
    mode: 'control',
    fixtureRoot: 'C:/fixture',
    sourceRoot: 'C:/src',
    jsonOut: 'C:/out.json',
    cpuProfileOut: '',
    timeoutMs: 5_000,
  }, { spawnWorker: () => fake.handle, probeAsync: () => 'absent' });
  fake.emitStdout(payloadText());
  fake.emitClose();
  const outcome = await promise;
  assert.equal(outcome.ok, true);
  assert.equal(outcome.terminationConfirmed, true);
});

test('a success-shaped payload with a nonzero exit code is rejected', async () => {
  const fake = fakeSpawnHandle({ closeWith: { code: 1, signal: null } });
  const promise = runProfileWorker({
    nodePath: 'node',
    workerPath: 'worker.cjs',
    mode: 'control',
    fixtureRoot: 'C:/fixture',
    sourceRoot: 'C:/src',
    jsonOut: 'C:/out.json',
    cpuProfileOut: '',
    timeoutMs: 5_000,
  }, { spawnWorker: () => fake.handle, probeAsync: () => 'absent' });
  fake.emitStdout(payloadText());
  fake.emitClose();
  const outcome = await promise;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failure, 'NONZERO_EXIT');
});

test('a mode mismatch between the requested and reported mode is rejected', async () => {
  const fake = fakeSpawnHandle();
  const promise = runProfileWorker({
    nodePath: 'node',
    workerPath: 'worker.cjs',
    mode: 'control',
    fixtureRoot: 'C:/fixture',
    sourceRoot: 'C:/src',
    jsonOut: 'C:/out.json',
    cpuProfileOut: '',
    timeoutMs: 5_000,
  }, { spawnWorker: () => fake.handle, probeAsync: () => 'absent' });
  fake.emitStdout(payloadText({ mode: 'profiled' }));
  fake.emitClose();
  const outcome = await promise;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failure, 'MODE_MISMATCH');
});

test('a timeout whose worker exit is observed is an explicit WORKER_TIMEOUT, never a success payload', async () => {
  const fake = fakeSpawnHandle();
  const promise = runProfileWorker({
    nodePath: 'node',
    workerPath: 'worker.cjs',
    mode: 'control',
    fixtureRoot: 'C:/fixture',
    sourceRoot: 'C:/src',
    jsonOut: 'C:/out.json',
    cpuProfileOut: '',
    timeoutMs: 10,
  }, { spawnWorker: () => fake.handle, probeAsync: () => 'absent' });
  // The timeout kills the worker; the exit is only accepted once the spawn
  // handle's own close event is observed.
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  fake.emitClose();
  const outcome = await promise;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failure, 'WORKER_TIMEOUT');
  assert.equal(outcome.timedOut, true);
  assert.deepEqual(fake.handle.killed, ['SIGKILL']);
});

test('a timeout whose worker exit is never observed stays UNRESOLVED_PROCESS', async () => {
  const fake = fakeSpawnHandle();
  const outcome = await runProfileWorker({
    nodePath: 'node',
    workerPath: 'worker.cjs',
    mode: 'control',
    fixtureRoot: 'C:/fixture',
    sourceRoot: 'C:/src',
    jsonOut: 'C:/out.json',
    cpuProfileOut: '',
    timeoutMs: 10,
  }, { spawnWorker: () => fake.handle, probeAsync: () => 'absent' });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.failure, 'UNRESOLVED_PROCESS');
  assert.equal(outcome.terminationConfirmed, false);
  assert.equal(outcome.requestedFailure, 'WORKER_TIMEOUT');
  assert.deepEqual(outcome.unresolvedWorker, [4321]);
});

test('a spawn failure with no PID is a bounded SPAWN_ERROR with no termination claim', async () => {
  const fake = fakeSpawnHandle({ pid: null });
  const promise = runProfileWorker({
    nodePath: 'node',
    workerPath: 'worker.cjs',
    mode: 'control',
    fixtureRoot: 'C:/fixture',
    sourceRoot: 'C:/src',
    jsonOut: 'C:/out.json',
    cpuProfileOut: '',
    timeoutMs: 5_000,
  }, { spawnWorker: () => fake.handle, probeAsync: () => 'absent' });
  fake.emitError(Object.assign(new Error('nope'), { code: 'ENOENT' }));
  const outcome = await promise;
  assert.equal(outcome.failure, 'SPAWN_ERROR');
  assert.equal(outcome.terminationConfirmed, false);
  assert.equal(outcome.workerPid, null);
});

test('the profiled mode passes the cpuprofile path through to the worker', async () => {
  const fake = fakeSpawnHandle();
  let argvSeen = null;
  const promise = runProfileWorker({
    nodePath: 'node',
    workerPath: 'worker.cjs',
    mode: 'profiled',
    fixtureRoot: 'C:/fixture',
    sourceRoot: 'C:/src',
    jsonOut: 'C:/out.json',
    cpuProfileOut: 'C:/out.cpuprofile',
    timeoutMs: 5_000,
  }, {
    spawnWorker: (_node, argv) => { argvSeen = argv; return fake.handle; },
    probeAsync: () => 'absent',
  });
  fake.emitStdout(payloadText({ mode: 'profiled' }));
  fake.emitClose();
  await promise;
  assert.equal(argvSeen.includes('--cpuprofile-out'), true);
  assert.equal(argvSeen.includes('C:/out.cpuprofile'), true);
});

test('the control mode never passes a cpuprofile path', async () => {
  const fake = fakeSpawnHandle();
  let argvSeen = null;
  const promise = runProfileWorker({
    nodePath: 'node',
    workerPath: 'worker.cjs',
    mode: 'control',
    fixtureRoot: 'C:/fixture',
    sourceRoot: 'C:/src',
    jsonOut: 'C:/out.json',
    cpuProfileOut: 'C:/should-not-be-used.cpuprofile',
    timeoutMs: 5_000,
  }, {
    spawnWorker: (_node, argv) => { argvSeen = argv; return fake.handle; },
    probeAsync: () => 'absent',
  });
  fake.emitStdout(payloadText());
  fake.emitClose();
  await promise;
  assert.equal(argvSeen.includes('--cpuprofile-out'), false);
});

test('the worker script itself declares the profiled mode requires a profile path', () => {
  assert.throws(
    () => worker.parseArgs(['--mode', 'profiled', '--fixture', 'x']),
    /--cpuprofile-out is required/,
  );
  assert.throws(() => worker.parseArgs(['--mode', 'nonsense', '--fixture', 'x']), /--mode must be one of/);
  assert.throws(() => worker.parseArgs(['--fixture', 'x', '--sampling-interval-micros', 'zero']), /positive integer/);
});

test('a payload whose declared schema, mode or requested counts drift is refused', () => {
  const good = () => validOutcome();
  assert.equal(validateProfileRun(good(), 'control', 'sha256:good', 10, 2).ok, true);
  assert.equal(validateProfileRun(validOutcome({ schemaVersion: 2 }), 'control', 'sha256:good', 10, 2).reason, 'PAYLOAD_SCHEMA_MISMATCH');
  assert.equal(validateProfileRun(validOutcome({ mode: 'profiled' }), 'control', 'sha256:good', 10, 2).reason, 'MODE_MISMATCH');
  assert.equal(validateProfileRun(validOutcome({ scans: 9 }), 'control', 'sha256:good', 10, 2).reason, 'WRONG_SCAN_COUNT');
  assert.equal(validateProfileRun(validOutcome({ warmups: 1 }), 'control', 'sha256:good', 10, 2).reason, 'WRONG_WARMUP_COUNT');
  assert.equal(validateProfileRun({ ok: true, payload: null }, 'control', 'sha256:good', 10, 2).reason, 'MALFORMED_PAYLOAD');
});

test('a timing summary that does not recompute from its own samples is refused', () => {
  const wallTampered = validOutcome();
  wallTampered.payload.result.wallDurationMs.median = 1;
  assert.equal(
    validateProfileRun(wallTampered, 'control', 'sha256:good', 10, 2).reason,
    'WALL_SUMMARY_MISMATCH',
  );
  const warmupTampered = validOutcome();
  warmupTampered.payload.result.warmupDurationMs.mad = 999;
  assert.equal(
    validateProfileRun(warmupTampered, 'control', 'sha256:good', 10, 2).reason,
    'WARMUP_SUMMARY_MISMATCH',
  );
  const perScanDrift = validOutcome();
  perScanDrift.payload.result.perScan[4].rawDurationMs += 5;
  assert.equal(
    validateProfileRun(perScanDrift, 'control', 'sha256:good', 10, 2).reason,
    'PER_SCAN_MISMATCH',
  );
});

test('a resolved production dependency is re-hashed against the live source root', () => {
  const root = tempRoot();
  const relative = 'src/main/data-import.js';
  const absolute = path.join(root, 'src', 'main', 'data-import.js');
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, 'module.exports = 1;\n');
  const actualHash = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')}`;

  const matched = validOutcome();
  matched.payload.result.resolvedModules = [{ file: relative, sha256: actualHash }];
  assert.equal(
    validateProfileRun(matched, 'control', 'sha256:good', 10, 2, { sourceRoot: root }).ok,
    true,
  );

  const drifted = validOutcome();
  // A well-formed but wrong digest is a real hash mismatch. A malformed digest
  // is a different failure and must not be reported as drift.
  drifted.payload.result.resolvedModules = [{ file: relative, sha256: `sha256:${'0'.repeat(64)}` }];
  assert.equal(
    validateProfileRun(drifted, 'control', 'sha256:good', 10, 2, { sourceRoot: root }).reason,
    'RESOLVED_DEPENDENCY_HASH_MISMATCH',
  );

  const malformed = validOutcome();
  malformed.payload.result.resolvedModules = [{ file: relative, sha256: 'sha256:stale' }];
  assert.equal(
    validateProfileRun(malformed, 'control', 'sha256:good', 10, 2, { sourceRoot: root }).reason,
    'RESOLVED_DEPENDENCY_HASH_INVALID',
  );

  const nullHash = validOutcome();
  nullHash.payload.result.resolvedModules = [{ file: relative, sha256: null }];
  assert.equal(
    validateProfileRun(nullHash, 'control', 'sha256:good', 10, 2, { sourceRoot: root }).reason,
    'RESOLVED_DEPENDENCY_HASH_INVALID',
  );

  // The recorded digest and the digest re-read from disk are both required to
  // be real: a missing file can no longer be "proven" stable by recording a
  // null on both sides.
  const relocated = validOutcome();
  relocated.payload.result.resolvedModules = [{ file: 'src/main/absent.js', sha256: actualHash }];
  assert.equal(
    validateProfileRun(relocated, 'control', 'sha256:good', 10, 2, { sourceRoot: root }).reason,
    'RESOLVED_DEPENDENCY_HASH_UNAVAILABLE',
  );

  const contradictory = validOutcome();
  contradictory.payload.result.resolvedModules = [
    { file: relative, sha256: actualHash },
    { file: relative, sha256: `sha256:${'1'.repeat(64)}` },
  ];
  assert.equal(
    validateProfileRun(contradictory, 'control', 'sha256:good', 10, 2, { sourceRoot: root }).reason,
    'RESOLVED_DEPENDENCY_CONFLICT',
  );

  const escapee = validOutcome();
  escapee.payload.result.resolvedModules = [{ file: '../outside.js', sha256: actualHash }];
  assert.equal(
    validateProfileRun(escapee, 'control', 'sha256:good', 10, 2, { sourceRoot: root }).reason,
    'RESOLVED_DEPENDENCY_ESCAPES_ROOT',
  );
});

test('the retained profile must match its expected path, hash, interval and structure', () => {
  const root = tempRoot();
  const profilePath = path.join(root, 'round-1-profiled.cpuprofile');
  const profile = buildProfile([
    nodeSpec({ id: 1, parent: null, functionName: 'scanImport', selfMicros: 10_000 }),
  ], { startTime: 0, endTime: 1000 });
  fs.writeFileSync(profilePath, `${JSON.stringify(profile)}\n`);
  const hash = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(profilePath)).digest('hex')}`;

  const good = () => {
    const outcome = validOutcome({ mode: 'profiled' });
    outcome.payload.result.profile = {
      path: profilePath,
      sha256: hash,
      stoppedCleanly: true,
      sampleIntervalMicros: 250,
      sampleCount: profile.samples.length,
      timeDeltaCount: profile.timeDeltas.length,
    };
    return outcome;
  };
  const options = { expectedProfilePath: profilePath, samplingIntervalMicros: 250 };
  assert.equal(validateProfileRun(good(), 'profiled', 'sha256:good', 10, 2, options).ok, true);
  assert.equal(
    validateProfileRun(good(), 'profiled', 'sha256:good', 10, 2, { ...options, samplingIntervalMicros: 500 }).reason,
    'PROFILE_INTERVAL_MISMATCH',
  );
  assert.equal(
    validateProfileRun(good(), 'profiled', 'sha256:good', 10, 2, { ...options, expectedProfilePath: path.join(root, 'other.cpuprofile') }).reason,
    'PROFILE_PATH_UNEXPECTED',
  );

  const staleHash = good();
  staleHash.payload.result.profile.sha256 = 'sha256:stale';
  assert.equal(
    validateProfileRun(staleHash, 'profiled', 'sha256:good', 10, 2, options).reason,
    'PROFILE_HASH_MISMATCH',
  );

  const emptyProfilePath = path.join(root, 'empty.cpuprofile');
  fs.writeFileSync(emptyProfilePath, `${JSON.stringify({ nodes: [], samples: [], timeDeltas: [] })}\n`);
  const empty = good();
  empty.payload.result.profile = {
    path: emptyProfilePath,
    sha256: `sha256:${crypto.createHash('sha256').update(fs.readFileSync(emptyProfilePath)).digest('hex')}`,
    stoppedCleanly: true,
    sampleIntervalMicros: 250,
    sampleCount: 0,
    timeDeltaCount: 0,
  };
  assert.equal(
    validateProfileRun(empty, 'profiled', 'sha256:good', 10, 2, { expectedProfilePath: emptyProfilePath, samplingIntervalMicros: 250 }).reason,
    'PROFILE_NODES_MISSING',
  );
});

test('structurally inconsistent profiles are rejected before any attribution', () => {
  assert.deepEqual(validateProfileStructure(null), ['PROFILE_NOT_OBJECT']);
  assert.deepEqual(validateProfileStructure({ nodes: [], samples: [], timeDeltas: [] }), [
    'PROFILE_NODES_MISSING',
    'PROFILE_SAMPLES_MISSING',
    'PROFILE_TIME_RANGE_INVALID',
  ]);

  const mismatched = buildProfile([nodeSpec({ id: 1, parent: null, selfMicros: 2000 })]);
  mismatched.timeDeltas.pop();
  assert.equal(validateProfileStructure(mismatched).includes('PROFILE_SAMPLE_DELTA_LENGTH_MISMATCH'), true);

  const orphan = buildProfile([nodeSpec({ id: 1, parent: null, selfMicros: 2000 })]);
  orphan.samples[0] = 99;
  assert.equal(validateProfileStructure(orphan).includes('PROFILE_ORPHAN_SAMPLES'), true);

  const dangling = buildProfile([nodeSpec({ id: 1, parent: null, selfMicros: 2000 })]);
  dangling.nodes[0].children = [4242];
  assert.equal(validateProfileStructure(dangling).includes('PROFILE_DANGLING_CHILD_REF'), true);

  const duplicate = buildProfile([nodeSpec({ id: 1, parent: null, selfMicros: 2000 })]);
  duplicate.nodes.push({ ...duplicate.nodes[0], children: [] });
  assert.equal(validateProfileStructure(duplicate).includes('PROFILE_DUPLICATE_NODE_ID'), true);

  const badRange = buildProfile([nodeSpec({ id: 1, parent: null, selfMicros: 2000 })], { startTime: 500, endTime: 500 });
  assert.equal(validateProfileStructure(badRange).includes('PROFILE_TIME_RANGE_INVALID'), true);
});

/**
 * The structure gate is only load-bearing if the raw-evidence validator and the
 * execution calculation actually consume it. These cases drive the same broken
 * profiles through both entry points and require the same rejection.
 */
test('unusable timing and cyclic graphs invalidate a run and clear the candidate', () => {
  const root = tempRoot();
  const cases = [
    ['a non-finite delta', (profile) => { profile.timeDeltas[0] = NaN; }, 'PROFILE_DELTA_INVALID'],
    ['a negative delta', (profile) => { profile.timeDeltas[0] = -500; }, 'PROFILE_DELTA_INVALID'],
    ['an all-zero series', (profile) => { profile.timeDeltas = profile.timeDeltas.map(() => 0); }, 'PROFILE_TIMING_UNUSABLE'],
    ['a self-cycle', (profile) => { profile.nodes[0].children = [profile.nodes[0].id]; }, 'PROFILE_GRAPH_CYCLIC'],
    ['a multi-node cycle', (profile) => {
      profile.nodes[0].children = [profile.nodes[1].id];
      profile.nodes[1].children = [profile.nodes[0].id];
    }, 'PROFILE_GRAPH_CYCLIC'],
  ];
  for (const [label, breakIt, reason] of cases) {
    const profilePath = path.join(root, `${reason}-${Math.abs(label.length)}.cpuprofile`);
    const profile = buildProfile([
      nodeSpec({ id: 1, parent: null, functionName: 'scanImport', selfMicros: 4000 }),
      nodeSpec({ id: 2, parent: 1, functionName: 'walkSessionDirs', selfMicros: 4000 }),
    ]);
    breakIt(profile);
    fs.writeFileSync(profilePath, `${JSON.stringify(profile)}\n`);
    const outcome = validOutcome({ mode: 'profiled' });
    outcome.payload.result.profile = {
      path: profilePath,
      sha256: `sha256:${crypto.createHash('sha256').update(fs.readFileSync(profilePath)).digest('hex')}`,
      stoppedCleanly: true,
      sampleIntervalMicros: 250,
      sampleCount: profile.samples.length,
      timeDeltaCount: profile.timeDeltas.length,
    };
    const validation = validateProfileRun(
      outcome, 'profiled', 'sha256:good', 10, 2,
      { expectedProfilePath: profilePath, samplingIntervalMicros: 250 },
    );
    assert.equal(validation.ok, false, `${label} must invalidate the run`);
    assert.equal(validation.reason, reason, `${label} must name ${reason}`);

    // The same row reaching the report is what the exit status is derived from.
    const report = validReport({
      invalidRows: [{ round: 1, mode: 'profiled', reason: validation.reason }],
      verdict: 'PROPOSAL_SUPPORTABLE',
    });
    const execution = finalizeReport(report);
    assert.equal(execution.ok, false, `${label} must fail execution`);
    assert.equal(execution.exitCode, 1);
    assert.deepEqual(report.decision.candidates, []);
  }
});

test('a dependency that changes between two individually valid rounds is not a stable identity', () => {
  const report = validReport({ verdict: 'PROPOSAL_SUPPORTABLE' });
  report.rounds[1].control.resolvedModules = [
    { file: 'src/main/data-import.js', sha256: `sha256:${'f'.repeat(64)}` },
  ];
  const execution = finalizeReport(report);
  assert.equal(execution.ok, false);
  assert.equal(execution.exitCode, 1);
  assert.equal(execution.reasons.includes('RESOLVED_DEPENDENCY_IDENTITY_UNSTABLE'), true);
  assert.deepEqual(report.decision.candidates, []);
});

test('a null-vs-null dependency record and a reused helper that changed both invalidate the verdict', () => {
  // Both sides null used to compare equal and read as "unchanged".
  const nulls = validReport({ verdict: 'PROPOSAL_SUPPORTABLE' });
  for (const row of nulls.rounds) {
    for (const mode of ['control', 'profiled']) {
      row[mode].resolvedModules = [{ file: 'src/main/data-import.js', sha256: null }];
    }
  }
  nulls.provenance.resolvedProductionDependencies = ['src/main/data-import.js=null'];
  const nullExecution = finalizeReport(nulls);
  assert.equal(nullExecution.ok, false);
  assert.equal(nullExecution.exitCode, 1);
  assert.equal(nullExecution.reasons.includes('RESOLVED_DEPENDENCY_HASH_INVALID'), true);
  assert.deepEqual(nulls.decision.candidates, []);

  // The C1 worker changed after the provenance hash was captured. Every other
  // identity stays complete, so the drift is the only thing left to report.
  const changedHelper = validReport({ verdict: 'PROPOSAL_SUPPORTABLE' });
  changedHelper.inputIdentity.hashesBefore = {
    ...PROVENANCE_MODULE_HASHES,
    production: `sha256:${HEX_A}`,
  };
  changedHelper.inputIdentity.hashesAfter = {
    ...PROVENANCE_MODULE_HASHES,
    c1Worker: `sha256:${'1'.repeat(64)}`,
    production: `sha256:${HEX_A}`,
  };
  const changedExecution = finalizeReport(changedHelper);
  assert.equal(changedExecution.ok, false);
  assert.equal(changedExecution.exitCode, 1);
  assert.equal(changedExecution.reasons.includes('PROVENANCE_MODULE_IDENTITY_UNSTABLE'), true);
  assert.equal(changedExecution.reasons.includes('PROVENANCE_MODULE_HASH_MISSING'), false);
  assert.deepEqual(changedHelper.decision.candidates, []);
});

test('provenance must be present and complete before a verdict can exit 0', () => {
  const missing = validReport();
  delete missing.provenance;
  const missingExecution = finalizeReport(missing);
  assert.equal(missingExecution.ok, false);
  assert.equal(missingExecution.reasons.includes('PROVENANCE_MODULES_MISSING'), true);
  assert.deepEqual(missing.decision.candidates, []);

  const invalid = validReport();
  invalid.provenance.executedProfilingModules.profileWorker.sha256 = 'sha256:short';
  const invalidExecution = finalizeReport(invalid);
  assert.equal(invalidExecution.ok, false);
  assert.equal(invalidExecution.reasons.includes('PROVENANCE_HASH_INVALID'), true);

  const incomplete = validReport();
  incomplete.provenance.resolvedProductionDependencies = [];
  const incompleteExecution = finalizeReport(incomplete);
  assert.equal(incompleteExecution.ok, false);
  assert.equal(incompleteExecution.reasons.includes('PROVENANCE_DEPENDENCIES_INCOMPLETE'), true);

  // The unbroken skeleton must still exit 0.
  const intact = validReport();
  const intactExecution = finalizeReport(intact);
  assert.equal(intactExecution.ok, true);
  assert.deepEqual(intactExecution.reasons, []);
});

test('a partial provenance record is incomplete even when the entries it has are valid', () => {
  const partial = validReport();
  delete partial.provenance.executedProfilingModules.c1Worker;
  const execution = finalizeReport(partial);
  assert.equal(execution.ok, false);
  assert.equal(execution.reasons.includes('PROVENANCE_MODULES_MISSING'), true);
  assert.deepEqual(partial.decision.candidates, []);
});

test('the final dependency recheck voiding an otherwise valid run is not silently accepted', () => {
  const report = validReport({ verdict: 'PROPOSAL_SUPPORTABLE' });
  report.inputIdentity.dependencyRecheck = [
    { file: 'src/main/data-import.js', recorded: `sha256:${HEX_A}`, current: null, matches: false },
  ];
  const execution = finalizeReport(report);
  assert.equal(execution.ok, false);
  assert.equal(execution.exitCode, 1);
  assert.equal(execution.reasons.includes('RESOLVED_DEPENDENCY_RECHECK_FAILED'), true);
  assert.deepEqual(report.decision.candidates, []);

  const matched = validReport({ verdict: 'PROPOSAL_SUPPORTABLE' });
  matched.inputIdentity.dependencyRecheck = [
    { file: 'src/main/data-import.js', recorded: `sha256:${HEX_A}`, current: `sha256:${HEX_A}`, matches: true },
  ];
  const matchedExecution = finalizeReport(matched);
  assert.equal(matchedExecution.ok, true);
  assert.equal(matched.decision.candidates.length, 1);
});

/**
 * The execution gate reads the actual before/after/provenance maps, so missing
 * evidence has to invalidate the run instead of quietly passing. Each case
 * below removes or breaks exactly one piece of the identity and then goes
 * through `finalizeReport()` — the same path the CLI's exit status uses.
 */
function assertInvalidated(report, expectedReason, label) {
  const execution = finalizeReport(report);
  assert.equal(execution.ok, false, `${label} must invalidate execution`);
  assert.equal(execution.exitCode, 1, `${label} must exit 1`);
  assert.equal(execution.reasons.includes(expectedReason), true,
    `${label} must name ${expectedReason}, got ${JSON.stringify(execution.reasons)}`);
  assert.equal(report.decision.verdict, 'INCONCLUSIVE', `${label} must downgrade the verdict`);
  assert.deepEqual(report.decision.candidates, [], `${label} must clear the candidates`);
  assert.equal(report.decision.productionOptimizationAuthorized, false,
    `${label} must not authorize production work`);
  return execution;
}

test('a missing before-hash map is missing evidence, not a pass', () => {
  const report = validReport({ verdict: 'PROPOSAL_SUPPORTABLE' });
  delete report.inputIdentity.hashesBefore;
  assertInvalidated(report, 'PROVENANCE_MODULE_HASH_MISSING', 'no hashesBefore');

  const noAfter = validReport({ verdict: 'PROPOSAL_SUPPORTABLE' });
  delete noAfter.inputIdentity.hashesAfter;
  assertInvalidated(noAfter, 'PROVENANCE_MODULE_HASH_MISSING', 'no hashesAfter');
});

test('a required module missing from any one of the three identities invalidates the run', () => {
  const positions = [
    ['before map', (report) => { delete report.inputIdentity.hashesBefore.c1Harness; }],
    ['after map', (report) => { delete report.inputIdentity.hashesAfter.c1Harness; }],
    ['provenance entry', (report) => {
      delete report.provenance.executedProfilingModules.c1Harness;
    }],
  ];
  for (const [label, breakIt] of positions) {
    const report = validReport({ verdict: 'PROPOSAL_SUPPORTABLE' });
    breakIt(report);
    const execution = assertInvalidated(report, 'PROVENANCE_MODULE_HASH_MISSING', label);
    // A deleted provenance entry is also an incomplete module list.
    if (label === 'provenance entry') {
      assert.equal(execution.reasons.includes('PROVENANCE_MODULES_MISSING'), true);
    }
  }
});

test('null or malformed hashes invalidate the run even when the two maps agree', () => {
  const nullBefore = validReport({ verdict: 'PROPOSAL_SUPPORTABLE' });
  nullBefore.inputIdentity.hashesBefore.profileWorker = null;
  nullBefore.inputIdentity.hashesAfter.profileWorker = null;
  const nullExecution = assertInvalidated(nullBefore, 'PROVENANCE_MODULE_HASH_MISSING', 'null before and after');
  // The before/after maps still compare equal, so nothing but the completeness
  // check can be what fails.
  assert.equal(nullBefore.inputIdentity.unchanged, true);
  assert.equal(nullExecution.reasons.includes('PROVENANCE_HASH_INVALID'), false);

  const malformedAfter = validReport({ verdict: 'PROPOSAL_SUPPORTABLE' });
  malformedAfter.inputIdentity.hashesAfter.c1Worker = 'sha256:not-a-digest';
  assertInvalidated(malformedAfter, 'PROVENANCE_MODULE_HASH_MISSING', 'malformed after hash');

  const malformedProduction = validReport({ verdict: 'PROPOSAL_SUPPORTABLE' });
  malformedProduction.inputIdentity.hashesBefore.production = `sha256:${'A'.repeat(64)}`;
  malformedProduction.inputIdentity.hashesAfter.production = `sha256:${'A'.repeat(64)}`;
  assertInvalidated(malformedProduction, 'PROVENANCE_MODULE_HASH_MISSING', 'uppercase production digest');
});

test('an unchanged flag cannot hide an after-hash that disagrees with the recorded identity', () => {
  const report = validReport({ verdict: 'PROPOSAL_SUPPORTABLE' });
  report.inputIdentity.hashesAfter.c1Harness = `sha256:${'9'.repeat(64)}`;
  assert.equal(report.inputIdentity.unchanged, true);
  assertInvalidated(report, 'PROVENANCE_MODULE_IDENTITY_UNSTABLE', 'drifted after hash');

  // A helper that changed between the two observations is not the identity of
  // the run either, even when the drift is only in the before map.
  const beforeDrift = validReport({ verdict: 'PROPOSAL_SUPPORTABLE' });
  beforeDrift.inputIdentity.hashesBefore.attributionHarness = `sha256:${'8'.repeat(64)}`;
  assertInvalidated(beforeDrift, 'PROVENANCE_MODULE_IDENTITY_UNSTABLE', 'drifted before hash');
});

test('the final dependency recheck must exist and cover exactly the canonical dependency set', () => {
  const missing = validReport({ verdict: 'PROPOSAL_SUPPORTABLE' });
  delete missing.inputIdentity.dependencyRecheck;
  assertInvalidated(missing, 'RESOLVED_DEPENDENCY_RECHECK_MISSING', 'no recheck');

  // Two canonical dependencies, one recheck row: partial coverage.
  const twoDependencies = [
    { file: 'src/main/data-import.js', sha256: `sha256:${HEX_A}` },
    { file: 'src/main/workspace-fs.js', sha256: `sha256:${'b'.repeat(64)}` },
  ];
  const partialRow = {
    file: twoDependencies[0].file,
    recorded: twoDependencies[0].sha256,
    current: twoDependencies[0].sha256,
    matches: true,
  };
  const partial = validReport({
    verdict: 'PROPOSAL_SUPPORTABLE',
    dependencies: twoDependencies,
    dependencyRecheck: [partialRow],
  });
  assertInvalidated(partial, 'RESOLVED_DEPENDENCY_RECHECK_MISSING', 'partial recheck');

  // An extra row for a file no run resolved is unverifiable coverage, not more
  // evidence.
  const extra = validReport({
    verdict: 'PROPOSAL_SUPPORTABLE',
    dependencyRecheck: [
      { file: 'src/main/data-import.js', recorded: `sha256:${HEX_A}`, current: `sha256:${HEX_A}`, matches: true },
      { file: 'src/main/unrelated.js', recorded: `sha256:${'7'.repeat(64)}`, current: `sha256:${'7'.repeat(64)}`, matches: true },
    ],
  });
  assertInvalidated(extra, 'RESOLVED_DEPENDENCY_RECHECK_FAILED', 'unrelated recheck row');
});

test('duplicated, conflicting or cross-run-disagreeing recheck rows invalidate the run', () => {
  const duplicate = validReport({
    verdict: 'PROPOSAL_SUPPORTABLE',
    dependencyRecheck: [
      { file: 'src/main/data-import.js', recorded: `sha256:${HEX_A}`, current: `sha256:${HEX_A}`, matches: true },
      { file: 'src/main/data-import.js', recorded: `sha256:${HEX_A}`, current: `sha256:${HEX_A}`, matches: true },
    ],
  });
  assertInvalidated(duplicate, 'RESOLVED_DEPENDENCY_RECHECK_FAILED', 'duplicated recheck row');

  const conflicting = validReport({
    verdict: 'PROPOSAL_SUPPORTABLE',
    dependencyRecheck: [
      { file: 'src/main/data-import.js', recorded: `sha256:${HEX_A}`, current: `sha256:${HEX_A}`, matches: true },
      { file: 'src/main/data-import.js', recorded: `sha256:${'6'.repeat(64)}`, current: `sha256:${'6'.repeat(64)}`, matches: true },
    ],
  });
  assertInvalidated(conflicting, 'RESOLVED_DEPENDENCY_RECHECK_FAILED', 'conflicting recheck rows');

  // Recorded and current agree with each other but not with the identity the
  // runs actually observed.
  const wrongIdentity = validReport({
    verdict: 'PROPOSAL_SUPPORTABLE',
    dependencyRecheck: [
      { file: 'src/main/data-import.js', recorded: `sha256:${'5'.repeat(64)}`, current: `sha256:${'5'.repeat(64)}`, matches: true },
    ],
  });
  assertInvalidated(wrongIdentity, 'RESOLVED_DEPENDENCY_RECHECK_FAILED', 'recheck disagrees with cross-run identity');

  const driftedOnDisk = validReport({
    verdict: 'PROPOSAL_SUPPORTABLE',
    dependencyRecheck: [
      { file: 'src/main/data-import.js', recorded: `sha256:${HEX_A}`, current: `sha256:${'4'.repeat(64)}`, matches: false },
    ],
  });
  assertInvalidated(driftedOnDisk, 'RESOLVED_DEPENDENCY_RECHECK_FAILED', 'recorded/current digest drift');
});

test('a complete multi-dependency report with full evidence still exits 0', () => {
  const dependencies = [
    { file: 'src/main/data-import.js', sha256: `sha256:${HEX_A}` },
    { file: 'src/main/workspace-fs.js', sha256: `sha256:${'b'.repeat(64)}` },
  ];
  const report = validReport({ verdict: 'PROPOSAL_SUPPORTABLE', dependencies });
  const execution = finalizeReport(report);
  assert.deepEqual(execution.reasons, []);
  assert.equal(execution.ok, true);
  assert.equal(execution.exitCode, 0);
  assert.equal(report.decision.verdict, 'PROPOSAL_SUPPORTABLE');
  assert.equal(report.decision.candidates.length, 1);
  assert.equal(report.decision.productionOptimizationAuthorized, false);
});

/**
 * Dependency identity is per-run, not a union: the canonical set is the first
 * valid required run's, and every other required round/mode has to carry exactly
 * that file set with exactly those hashes. These cases go through
 * `finalizeReport()` so the exit status and the decision downgrade are exercised
 * together with the calculation itself.
 */
test('a required run with no resolvedModules at all invalidates the execution', () => {
  const report = validReport({ verdict: 'PROPOSAL_SUPPORTABLE', dependencies: TWO_DEPENDENCIES });
  delete report.rounds[1].control.resolvedModules;
  assertInvalidated(report, 'RESOLVED_DEPENDENCY_SET_INCOMPLETE', 'missing resolvedModules');
});

test('a required run with an empty resolvedModules list invalidates the execution', () => {
  const report = validReport({ verdict: 'PROPOSAL_SUPPORTABLE', dependencies: TWO_DEPENDENCIES });
  report.rounds[1].profiled.resolvedModules = [];
  assertInvalidated(report, 'RESOLVED_DEPENDENCY_SET_INCOMPLETE', 'empty resolvedModules');
});

test('a run that omits a canonical dependency invalidates the execution', () => {
  // The reviewer's counterexample: R2/control resolves only A while every other
  // run resolves A and B. The union is {A,B} and every hash agrees, so a
  // union-only rule publishes a report in which R2/control never proved B.
  const report = validReport({ verdict: 'PROPOSAL_SUPPORTABLE', dependencies: TWO_DEPENDENCIES });
  report.rounds[1].control.resolvedModules = [TWO_DEPENDENCIES[0]];
  const execution = assertInvalidated(report, 'RESOLVED_DEPENDENCY_SET_MISMATCH', 'one run omits B');
  assert.equal(execution.reasons.includes('RESOLVED_DEPENDENCY_RECHECK_MISSING'), false);
});

test('a run that adds an unexpected dependency invalidates the execution', () => {
  const report = validReport({ verdict: 'PROPOSAL_SUPPORTABLE', dependencies: TWO_DEPENDENCIES });
  report.rounds[1].control.resolvedModules = [
    ...TWO_DEPENDENCIES,
    { file: 'src/main/extra.js', sha256: `sha256:${'c'.repeat(64)}` },
  ];
  assertInvalidated(report, 'RESOLVED_DEPENDENCY_SET_MISMATCH', 'one run adds dependency C');
});

test('a same-hash duplicate dependency record inside one run invalidates the execution', () => {
  const report = validReport({ verdict: 'PROPOSAL_SUPPORTABLE', dependencies: TWO_DEPENDENCIES });
  report.rounds[0].control.resolvedModules = [TWO_DEPENDENCIES[0], ...TWO_DEPENDENCIES];
  assertInvalidated(report, 'RESOLVED_DEPENDENCY_SET_MISMATCH', 'same-hash duplicate in a run');
});

test('a same-hash duplicate row in the published provenance invalidates the execution', () => {
  const report = validReport({ verdict: 'PROPOSAL_SUPPORTABLE', dependencies: TWO_DEPENDENCIES });
  report.provenance.resolvedProductionDependencies = [
    ...report.provenance.resolvedProductionDependencies,
    `${TWO_DEPENDENCIES[0].file}=${TWO_DEPENDENCIES[0].sha256}`,
  ];
  assertInvalidated(report, 'PROVENANCE_DEPENDENCIES_INCOMPLETE', 'duplicate provenance row');
});

test('a complete two-dependency four-run report stays valid', () => {
  const report = validReport({ verdict: 'PROPOSAL_SUPPORTABLE', dependencies: TWO_DEPENDENCIES });
  // The rule is set equality, not record order: a run that reports the same two
  // dependencies in the other order is still the same identity.
  report.rounds[1].profiled.resolvedModules = [...TWO_DEPENDENCIES].reverse();
  const execution = finalizeReport(report);
  assert.deepEqual(execution.reasons, []);
  assert.equal(execution.ok, true);
  assert.equal(execution.exitCode, 0);
  assert.equal(report.decision.verdict, 'PROPOSAL_SUPPORTABLE');
  assert.equal(report.decision.candidates.length, 1);
  assert.equal(report.decision.productionOptimizationAuthorized, false);
});

/**
 * A fully-populated report skeleton for the execution calculation. Only the
 * fields that calculation reads are stated here; every test then breaks exactly
 * one of them.
 *
 * The baseline has to be genuinely complete, not merely present: the before and
 * after maps carry a well-formed agreeing digest for every required provenance
 * module plus the measured production input, and the final recheck covers the
 * canonical dependency set with recorded, current and cross-run digests all
 * equal. A skeleton that reaches `evaluateExecution()` without that evidence is
 * exactly the fail-open path these tests guard.
 */
const HEX_A = 'a'.repeat(64);

const PROVENANCE_MODULE_HASHES = {
  attributionHarness: `sha256:${'b'.repeat(64)}`,
  profileWorker: `sha256:${'c'.repeat(64)}`,
  c1Worker: `sha256:${'d'.repeat(64)}`,
  c1Harness: `sha256:${'e'.repeat(64)}`,
};

const TWO_DEPENDENCIES = [
  { file: 'src/main/data-import.js', sha256: `sha256:${HEX_A}` },
  { file: 'src/main/workspace-fs.js', sha256: `sha256:${'b'.repeat(64)}` },
];

function validReport({
  invalidRows = [],
  unresolvedProcess = null,
  unchanged = true,
  fixtureContentUnchanged = true,
  verdict = 'NO_CANDIDATE_CATEGORY',
  provenance = null,
  dependencyHash = `sha256:${HEX_A}`,
  dependencyFile = 'src/main/data-import.js',
  dependencies = null,
  publishDependencies = true,
  hashesBefore = null,
  hashesAfter = null,
  dependencyRecheck = null,
} = {}) {
  const dependencySet = dependencies || [{ file: dependencyFile, sha256: dependencyHash }];
  const beforeMap = hashesBefore || {
    ...PROVENANCE_MODULE_HASHES,
    production: dependencyHash,
  };
  const afterMap = hashesAfter || { ...beforeMap };
  const recheck = dependencyRecheck || dependencySet.map(({ file, sha256 }) => ({
    file,
    recorded: sha256,
    current: sha256,
    matches: true,
  }));
  return {
    protocol: { rounds: 2, modes: ['control', 'profiled'], scansPerProcess: 10, warmupsPerProcess: 2 },
    inputIdentity: {
      unchanged,
      fixtureContentUnchanged,
      hashesBefore: beforeMap,
      hashesAfter: afterMap,
      dependencyRecheck: recheck,
      dependenciesStable: recheck.length > 0 && recheck.every((row) => row.matches === true),
    },
    provenance: provenance || {
      executedProfilingModules: {
        attributionHarness: {
          path: 'scripts/profile-import-scan.mjs',
          sha256: PROVENANCE_MODULE_HASHES.attributionHarness,
        },
        profileWorker: {
          path: 'scripts/lib/import-scan-profile-worker.cjs',
          sha256: PROVENANCE_MODULE_HASHES.profileWorker,
        },
        c1Worker: {
          path: 'scripts/lib/desktop-perf-worker.cjs',
          sha256: PROVENANCE_MODULE_HASHES.c1Worker,
        },
        c1Harness: {
          path: 'scripts/measure-desktop-lifecycle.mjs',
          sha256: PROVENANCE_MODULE_HASHES.c1Harness,
        },
      },
      resolvedProductionDependencies: publishDependencies
        ? dependencySet.map(({ file, sha256 }) => `${file}=${sha256}`)
        : [],
      reusedC1Worker: 'scripts/lib/desktop-perf-worker.cjs',
    },
    invalidRows,
    unresolvedProcess,
    rounds: [1, 2].map((round) => ({
      round,
      control: {
        scans: 10,
        wallDurationMs: { median: 150 },
        resolvedModules: dependencySet.map(({ file, sha256 }) => ({ file, sha256 })),
      },
      profiled: {
        scans: 10,
        wallDurationMs: { median: 160 },
        attribution: { unclassifiedShare: 0.1, byCategory: [] },
        resolvedModules: dependencySet.map(({ file, sha256 }) => ({ file, sha256 })),
      },
    })),
    decision: {
      verdict,
      candidates: verdict === 'PROPOSAL_SUPPORTABLE' ? [{ category: 'session-meta-read' }] : [],
      candidatesQualifyingNumerically: [{ category: 'session-meta-read' }],
      limitations: [],
      productionOptimizationAuthorized: false,
      statement: null,
    },
  };
}

test('an all-invalid run fails execution, names the reason and never publishes a recommendation', () => {
  const report = validReport({
    invalidRows: [
      { round: 1, mode: 'control', reason: 'SPAWN_ERROR' },
      { round: 1, mode: 'profiled', reason: 'PROFILE_FILE_MISSING' },
      { round: 2, mode: 'control', reason: 'SPAWN_ERROR' },
      { round: 2, mode: 'profiled', reason: 'PROFILE_FILE_MISSING' },
    ],
    verdict: 'PROPOSAL_SUPPORTABLE',
  });
  const execution = finalizeReport(report);
  assert.equal(execution.ok, false);
  assert.equal(execution.exitCode, 1);
  assert.equal(execution.reasons.includes('INVALID_RUN'), true);
  assert.equal(execution.reasons.includes('INVALID_SPAWN_ERROR_R1_control'), true);
  assert.equal(execution.invalidRuns.length, 4);
  assert.equal(report.decision.verdict, 'INCONCLUSIVE');
  assert.deepEqual(report.decision.candidates, []);
  assert.equal(report.decision.productionOptimizationAuthorized, false);
  assert.equal(
    report.decision.limitations.includes('INVALID_PROFILE_FILE_MISSING_R2_profiled'),
    true,
  );
});

test('each invalid-run category maps to a coarse execution reason', () => {
  const cases = [
    ['DIGEST_MISMATCH', 'CORRECTNESS_FAILURE'],
    ['WORKER_TIMEOUT', 'TIMEOUT'],
    ['RUN_TIMEOUT', 'TIMEOUT'],
    ['UNRESOLVED_PROCESS', 'UNRESOLVED_PROCESS'],
    ['NONZERO_EXIT', 'INVALID_RUN'],
    ['MISSING_SAMPLES', 'INVALID_RUN'],
    ['MISSING_PROFILE', 'INVALID_RUN'],
    ['PROFILER_STOP_FAILED', 'INVALID_RUN'],
    ['WRONG_WARMUP_COUNT', 'INVALID_RUN'],
    ['WALL_SUMMARY_MISMATCH', 'INVALID_RUN'],
    ['RESOLVED_DEPENDENCY_HASH_MISMATCH', 'INVALID_RUN'],
    ['PROFILE_ORPHAN_SAMPLES', 'INVALID_RUN'],
  ];
  for (const [detail, coarse] of cases) {
    const execution = evaluateExecution(validReport({
      invalidRows: [{ round: 1, mode: 'profiled', reason: detail }],
    }));
    assert.equal(execution.ok, false, `${detail} must fail execution`);
    assert.equal(execution.reasons.includes(coarse), true, `${detail} must map to ${coarse}`);
  }
});

test('a missing required round or mode is invalid even when no row reported an error', () => {
  const report = validReport();
  report.rounds = [report.rounds[0]];
  const execution = finalizeReport(report);
  assert.equal(execution.ok, false);
  assert.equal(execution.missingRuns.length, 2);
  assert.equal(execution.reasons.includes('MISSING_REQUIRED_RUN_R2_control'), true);
  assert.equal(report.decision.verdict, 'INCONCLUSIVE');
});

test('a nonzero exit, missing samples or a failed profiler stop all fail execution', () => {
  for (const reason of ['NONZERO_EXIT', 'MISSING_SAMPLES', 'MISSING_PROFILE', 'PROFILER_STOP_FAILED']) {
    const report = validReport({ invalidRows: [{ round: 2, mode: 'profiled', reason }] });
    const execution = finalizeReport(report);
    assert.equal(execution.ok, false, `${reason} must not exit 0`);
    assert.equal(execution.exitCode, 1);
    assert.equal(report.decision.verdict, 'INCONCLUSIVE');
  }
});

test('input drift discovered after a provisional positive still fails execution', () => {
  const report = validReport({ verdict: 'PROPOSAL_SUPPORTABLE', unchanged: false });
  const execution = finalizeReport(report);
  assert.equal(execution.ok, false);
  assert.equal(execution.reasons.includes('INPUT_CHANGED'), true);
  assert.deepEqual(report.decision.candidates, []);
  assert.equal(report.decision.verdict, 'INCONCLUSIVE');

  const fixtureDrift = validReport({ verdict: 'PROPOSAL_SUPPORTABLE', fixtureContentUnchanged: false });
  const drifted = finalizeReport(fixtureDrift);
  assert.equal(drifted.reasons.includes('FIXTURE_CONTENT_CHANGED'), true);
  assert.deepEqual(fixtureDrift.decision.candidates, []);
});

test('a valid run limited by profiler overhead still exits 0 with no recommendation', () => {
  const report = validReport({ verdict: 'LIMITATION_PROFILER_OVERHEAD' });
  report.decision.limitations = ['PROFILER_OVERHEAD_ROUND_1', 'PROFILER_OVERHEAD_ROUND_2'];
  report.decision.candidates = [];
  report.decision.statement = 'Profiler overhead exceeded the declared ceiling.';
  const execution = finalizeReport(report);
  assert.equal(execution.ok, true);
  assert.equal(execution.exitCode, 0);
  assert.deepEqual(execution.reasons, []);
  assert.equal(report.decision.verdict, 'LIMITATION_PROFILER_OVERHEAD');
  assert.deepEqual(report.decision.candidates, []);
  assert.equal(report.decision.productionOptimizationAuthorized, false);
});

test('a fully valid positive run keeps its candidate and exits 0', () => {
  const report = validReport({ verdict: 'PROPOSAL_SUPPORTABLE' });
  const execution = finalizeReport(report);
  assert.equal(execution.ok, true);
  assert.equal(execution.exitCode, 0);
  assert.equal(report.decision.verdict, 'PROPOSAL_SUPPORTABLE');
  assert.equal(report.decision.candidates.length, 1);
  // Even a supportable proposal is never authorization inside this slice.
  assert.equal(report.decision.productionOptimizationAuthorized, false);
});

test('the published execution block is the object the exit status is derived from', () => {
  const report = validReport({ invalidRows: [{ round: 1, mode: 'control', reason: 'MALFORMED_OUTPUT' }] });
  const execution = finalizeReport(report);
  assert.equal(report.execution, execution);
  assert.equal(typeof report.execution.note, 'string');
  assert.equal(report.execution.ok, false);
});

/**
 * Inspector-lifetime tests.
 *
 * `measure()` owns the profiler session, so every failure mode inside its
 * protected region must still `disconnect()` a connected session. These use an
 * injected fake session: no real inspector is attached, so the tests are
 * deterministic and cannot perturb the process running them.
 */
function fakeInspectorSession({ failOn = null, stopResult = { profile: { nodes: [], samples: [], timeDeltas: [] } } } = {}) {
  const calls = [];
  const session = {
    calls,
    connected: false,
    disconnected: false,
    connect() {
      calls.push('connect');
      session.connected = true;
    },
    disconnect() {
      calls.push('disconnect');
      session.disconnected = true;
      session.connected = false;
    },
    post(method, _params, callback) {
      calls.push(method);
      if (failOn === method) {
        callback(new Error(`injected ${method} failure`), null);
        return;
      }
      if (method === 'Profiler.stop') {
        callback(null, stopResult);
        return;
      }
      callback(null, {});
    },
  };
  return session;
}

function measureHarness({ failScanAt = null, scanError = null } = {}) {
  let scanIndex = 0;
  const testCase = {
    call() {
      scanIndex += 1;
      if (failScanAt !== null && scanIndex >= failScanAt) {
        throw scanError || new Error('injected scan failure');
      }
      return { value: 'ok' };
    },
    project: (result) => ({ value: result.value }),
    oracle: () => true,
  };
  return { testCase, scansRun: () => scanIndex };
}

test('an enable, interval or start failure still disconnects the attached session', async () => {
  for (const method of ['Profiler.enable', 'Profiler.setSamplingInterval', 'Profiler.start']) {
    const session = fakeInspectorSession({ failOn: method });
    const { testCase } = measureHarness();
    await assert.rejects(
      () => worker.measure(testCase, {
        mode: 'profiled', warmups: 1, scans: 3, samplingIntervalMicros: 250,
      }, { createSession: () => session }),
      new RegExp(`injected ${method.replace('.', '\\.')} failure`),
    );
    assert.equal(session.disconnected, true, `${method} failure must still disconnect`);
    assert.equal(session.calls.includes('disconnect'), true);
  }
});

test('a scan failure disconnects the session and reports the cleanup outcome separately', async () => {
  const session = fakeInspectorSession();
  // One warm-up consumes call #1, so failing at call #3 is measured scan 2.
  const { testCase } = measureHarness({ failScanAt: 3 });
  await assert.rejects(
    () => worker.measure(testCase, {
      mode: 'profiled', warmups: 1, scans: 3, samplingIntervalMicros: 250,
    }, { createSession: () => session }),
    /measured scan 2 failed: injected scan failure/,
  );
  assert.equal(session.disconnected, true);
});

test('a profiler stop failure is reported as PROFILER_CLEANUP_FAILED and still disconnects', async () => {
  const session = fakeInspectorSession({ failOn: 'Profiler.stop' });
  const { testCase } = measureHarness();
  await assert.rejects(
    () => worker.measure(testCase, {
      mode: 'profiled', warmups: 1, scans: 2, samplingIntervalMicros: 250,
    }, { createSession: () => session }),
    (error) => {
      assert.equal(error.failure, 'PROFILER_CLEANUP_FAILED');
      assert.equal(error.sessionDisconnected, true);
      return true;
    },
  );
  assert.equal(session.disconnected, true);
});

test('a disconnected-fault during cleanup is surfaced instead of hidden behind scan success', async () => {
  const session = fakeInspectorSession();
  session.disconnect = () => {
    session.calls.push('disconnect');
    throw new Error('injected disconnect failure');
  };
  const { testCase } = measureHarness();
  let error = null;
  try {
    await worker.measure(testCase, {
      mode: 'profiled', warmups: 1, scans: 2, samplingIntervalMicros: 250,
    }, { createSession: () => session });
    assert.fail('a failed disconnect must not resolve as a successful measurement');
  } catch (caught) {
    error = caught;
  }
  assert.match(error.message, /profiler cleanup failed: injected disconnect failure/);
  // The connection succeeded, but the detach did not. `sessionDisconnected`
  // must describe the DISCONNECT OPERATION rather than the connect, otherwise a
  // session that is still attached would be reported as cleanly released.
  assert.equal(error.sessionDisconnected, false);
  assert.equal(error.profileStopError, 'injected disconnect failure');
});

test('the control mode never creates an inspector session at all', async () => {
  let created = 0;
  const { testCase } = measureHarness();
  const run = await worker.measure(testCase, {
    mode: 'control', warmups: 1, scans: 3, samplingIntervalMicros: 250,
  }, {
    createSession: () => {
      created += 1;
      return fakeInspectorSession();
    },
  });
  assert.equal(created, 0);
  assert.equal(run.measured.length, 3);
  assert.equal(run.rawProfile, null);
  assert.equal(run.profileStopError, null);
});
