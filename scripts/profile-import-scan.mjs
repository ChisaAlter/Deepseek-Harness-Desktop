#!/usr/bin/env node
/**
 * C2 S1 attribution harness: WHERE does the measured `scanImport` blocking time
 * actually go?
 *
 * C1 established that S1 (`scanImport` over 1,000 small sessions) blocks the
 * event loop for ~140-156 ms per call. C2 does not optimize anything and does
 * not re-litigate C1's acceptance. It attributes that time to production
 * functions with an in-process V8 CPU profile, and it publishes a decision rule
 * that can only ever return "no optimization is justified" or "report a
 * limitation" — a positive recommendation requires a category to be both >= 20%
 * of attributed workload time and >= 20 ms per scan in BOTH rounds.
 *
 * Protocol (predeclared):
 *   - Same 1,000-small-session fixture and oracle digest as C1, built by the C1
 *     fixture builder so the two measurements describe the same workload.
 *   - Two rounds. Each round is an unprofiled control process followed by a
 *     profiled process (sequential; never concurrent).
 *   - Two untimed warm-ups, then ten measured scans per process.
 *   - The inspector session is enabled only around the ten measured scans. It is
 *     stopped before projection/digest/oracle work and `disconnect()`ed in a
 *     `finally` block.
 *   - The raw `.cpuprofile` is retained and re-parsed here; the report's
 *     attribution is recomputed from that file, never trusted from a summary.
 *
 * Usage:
 *   node scripts/profile-import-scan.mjs --source-root <candidate> --out <new dir>
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as harness from './measure-desktop-lifecycle.mjs';
import profileWorkerModule from './lib/import-scan-profile-worker.cjs';

const DEFAULT_SAMPLING_INTERVAL_MICROS = profileWorkerModule.DEFAULT_SAMPLING_INTERVAL_MICROS;

const {
  DEFAULT_SIZES,
  createChildLedger,
  inventoryFixture,
  mustNotBeInsideRepo,
  prepareFixture,
  sha256File,
  signalOpenChildren,
  stableStringify,
  survivingChildren,
} = harness;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

const ROUNDS = 2;
const MODES = ['control', 'profiled'];
const RUN_TIMEOUT_MS = 30_000;
const TOTAL_TIMEOUT_MS = 180_000;
const MAX_CAPTURED_OUTPUT = 1_000_000;
const RESULT_PREFIX = 'PERF_PROFILE_RESULT ';
/** Schema of the worker payload this harness accepts. Any other value is refused. */
const PROFILE_SCHEMA_VERSION = 1;
/**
 * The modules whose identity is recorded with a result. A report that cannot
 * name all of them has no complete provenance and must not publish a verdict.
 */
const REQUIRED_PROVENANCE_MODULES = [
  'attributionHarness',
  'profileWorker',
  'c1Worker',
  'c1Harness',
];

/** Categories the predeclared instrumentation names, plus the system buckets. */
const USER_FUNCTION_CATEGORY = {
  walkSessionDirs: 'session-walk',
  readSessionDisplayMeta: 'session-meta-read',
  readPlainSessionMeta: 'session-meta-read',
  readZstdSessionMeta: 'session-meta-read',
  foldSessionJsonlText: 'session-meta-read',
  applySessionJsonlLine: 'session-meta-read',
  destHasSession: 'dest-existence',
  scanImport: 'scan-orchestration',
  pluginCandidates: 'scan-siblings',
  collectSkills: 'scan-siblings',
  readSkillDisplayName: 'scan-siblings',
  readMcpServers: 'scan-siblings',
  settingsCandidates: 'scan-siblings',
  presetCandidates: 'scan-siblings',
  publicMcpRow: 'scan-siblings',
  isHarnessPresetSessionRel: 'scan-siblings',
  hasAnySessionDir: 'scan-siblings',
  hasAnyDbDir: 'scan-siblings',
  reinstallableSpec: 'scan-siblings',
};

const GC_FUNCTION_NAMES = new Set(['(garbage collector)', '(GC)', '(garbage collection)']);
const SYSTEM_FUNCTION_NAMES = new Set(['', '(root)', '(program)', '(idle)', '(native)']);

/**
 * Decision rule constants, recorded BEFORE the measurement. They are the
 * investigation gate, not a service-level objective, and are never adjusted
 * after seeing a result.
 */
const ATTRIBUTION_RULE = {
  minCategoryShare: 0.20,
  minCategoryMsPerScan: 20,
  maxProfilerOverhead: 0.20,
  maxUnclassifiedShare: 0.50,
  rankingShareFloor: 0.05,
};

const VERDICTS = [
  'NO_CANDIDATE_CATEGORY',
  'LIMITATION_PROFILER_OVERHEAD',
  'LIMITATION_UNCLASSIFIED_DOMINATES',
  'LIMITATION_RANKING_INSTABILITY',
  'PROPOSAL_SUPPORTABLE',
  'CORRECTNESS_FAILURE',
  'INCONCLUSIVE',
];

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values) {
  const series = Array.isArray(values) ? values.filter((row) => Number.isFinite(row)) : [];
  if (series.length === 0) return null;
  const sorted = [...series].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarizeSeries(values) {
  const series = Array.isArray(values) ? values.filter((row) => Number.isFinite(row)) : [];
  const center = median(series);
  return {
    samples: series,
    count: series.length,
    median: center,
    min: series.length ? Math.min(...series) : null,
    max: series.length ? Math.max(...series) : null,
    mad: series.length
      ? median(series.map((value) => Math.abs(value - center)))
      : null,
  };
}

/**
 * Frame classification:
 * - `gc`    the V8 collector
 * - `user`  a JS frame whose file lives in the measured source root (or this
 *           checkout when the source root IS this checkout)
 * - `dependency` a JS frame under a `node_modules` directory
 * - `other` anything else: Node's own internal JS, native frames, and empty
 *           URLs. `other` frames are attributed to the nearest NAMED production
 *           ancestor when one exists, because `fs.readFileSync` inside
 *           `readPlainSessionMeta` belongs to that production function; with no
 *           such ancestor they stay unclassified.
 */
function classifyFrame(node, sourceRoot) {
  const frame = (node && node.callFrame) || {};
  const functionName = typeof frame.functionName === 'string' ? frame.functionName : '';
  const rawUrl = typeof frame.url === 'string' ? frame.url : '';
  if (GC_FUNCTION_NAMES.has(functionName)) return 'gc';
  if (rawUrl === '') return 'other';
  if (rawUrl.startsWith('node:') || rawUrl.startsWith('internal/')) return 'other';
  let filePath = rawUrl;
  if (rawUrl.startsWith('file://')) {
    try {
      filePath = fileURLToPath(rawUrl);
    } catch {
      return 'other';
    }
  }
  const resolved = path.resolve(REPO_ROOT, filePath);
  if (resolved.includes(`${path.sep}node_modules${path.sep}`)) return 'dependency';
  const roots = [sourceRoot, REPO_ROOT]
    .filter((root) => typeof root === 'string' && root.length > 0)
    .map((root) => path.resolve(root));
  const inside = roots.some((root) => (
    resolved.startsWith(`${root}${path.sep}`) || resolved === root
  ));
  return inside ? 'user' : 'other';
}

/**
 * Category attribution walks the call tree so an anonymous callback is charged
 * to the nearest named production function that owns it. `selfMs` is the
 * sampled delta charged directly to the frame; the category totals sum exactly
 * to the sum of the positive sample deltas, so the shares are disjoint.
 */
function parseProfile(profile, sourceRoot) {
  const nodes = Array.isArray(profile && profile.nodes) ? profile.nodes : [];
  const samples = Array.isArray(profile && profile.samples) ? profile.samples : [];
  const deltas = Array.isArray(profile && profile.timeDeltas) ? profile.timeDeltas : [];
  const byId = new Map();
  for (const node of nodes) byId.set(node.id, node);

  const parentOf = new Map();
  for (const node of nodes) {
    if (!Array.isArray(node.children)) continue;
    for (const childId of node.children) parentOf.set(childId, node.id);
  }

  const namedAncestorOf = new Map();
  const resolveNamedAncestor = (nodeId) => {
    if (namedAncestorOf.has(nodeId)) return namedAncestorOf.get(nodeId);
    const chain = [];
    // Defensive bound: validateProfileStructure() rejects cyclic graphs before
    // attribution, but traversal must not depend on that gate having run.
    const visited = new Set();
    let current = nodeId;
    let found = null;
    while (current !== undefined && current !== null) {
      if (visited.has(current)) break;
      visited.add(current);
      if (namedAncestorOf.has(current)) {
        found = namedAncestorOf.get(current);
        break;
      }
      const node = byId.get(current);
      const name = node && node.callFrame ? node.callFrame.functionName : '';
      if (name && USER_FUNCTION_CATEGORY[name]) {
        found = name;
        break;
      }
      chain.push(current);
      current = parentOf.get(current);
    }
    for (const visited of chain) namedAncestorOf.set(visited, found);
    namedAncestorOf.set(nodeId, found);
    return found;
  };

  const selfMsByNode = new Map();
  const selfMsByCategory = new Map();
  const timeMsByCategory = new Map();
  const hitsByCategory = new Map();
  let totalMs = 0;
  let negativeDeltas = 0;
  let orphanSamples = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const deltaMicros = deltas[index];
    if (!Number.isFinite(deltaMicros) || deltaMicros <= 0) {
      if (Number.isFinite(deltaMicros) && deltaMicros < 0) negativeDeltas += 1;
      continue;
    }
    const nodeId = samples[index];
    const node = byId.get(nodeId);
    if (!node) {
      orphanSamples += 1;
      continue;
    }
    const milliseconds = deltaMicros / 1000;
    totalMs += milliseconds;
    selfMsByNode.set(nodeId, (selfMsByNode.get(nodeId) || 0) + milliseconds);

    const frameClass = classifyFrame(node, sourceRoot);
    const selfName = (node.callFrame && node.callFrame.functionName) || '';
    const owner = resolveNamedAncestor(nodeId) || (USER_FUNCTION_CATEGORY[selfName] ? selfName : null);
    let category;
    if (frameClass === 'gc') category = 'gc';
    else if (frameClass === 'dependency') category = 'dependency';
    else if (frameClass === 'user') {
      category = USER_FUNCTION_CATEGORY[owner] || `user:${owner || selfName || 'anonymous'}`;
    } else {
      category = owner ? USER_FUNCTION_CATEGORY[owner] || `user:${owner}` : 'unclassified';
    }
    timeMsByCategory.set(category, (timeMsByCategory.get(category) || 0) + milliseconds);
    hitsByCategory.set(category, (hitsByCategory.get(category) || 0) + 1);
  }

  const timeDeltaTotalMicros = deltas.reduce(
    (sum, delta) => (Number.isFinite(delta) && delta > 0 ? sum + delta : sum),
    0,
  );
  const byCategory = [...timeMsByCategory.entries()]
    .map(([category, ms]) => ({
      category,
      totalMs: round(ms, 6),
      share: totalMs > 0 ? round(ms / totalMs, 6) : null,
      samples: hitsByCategory.get(category) || 0,
    }))
    .sort((left, right) => (right.totalMs - left.totalMs) || left.category.localeCompare(right.category));

  const gcMs = timeMsByCategory.get('gc') || 0;
  const unattributedMs = timeMsByCategory.get('unclassified') || 0;
  return {
    sampleCount: samples.length,
    nodesWithSelfTime: selfMsByNode.size,
    timeDeltaCount: deltas.length,
    timeDeltaTotalMs: round(timeDeltaTotalMicros / 1000, 6),
    attributedTotalMs: round(totalMs, 6),
    negativeDeltas,
    orphanSamples,
    gcMs: round(gcMs, 6),
    gcShare: totalMs > 0 ? round(gcMs / totalMs, 6) : null,
    unclassifiedMs: round(unattributedMs, 6),
    unclassifiedShare: totalMs > 0 ? round(unattributedMs / totalMs, 6) : null,
    byCategory,
    selfMsByNode: Object.fromEntries(
      [...selfMsByNode.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 500)
        .map(([nodeId, ms]) => [String(nodeId), round(ms, 6)]),
    ),
    startTime: Number.isFinite(profile && profile.startTime) ? profile.startTime : null,
    endTime: Number.isFinite(profile && profile.endTime) ? profile.endTime : null,
  };
}

/**
 * Inclusive time is published as a diagnostic only: nested inclusive totals
 * overlap and must never be summed into the disjoint shares above.
 */
function inclusiveByFunction(profile, parse) {
  const nodes = Array.isArray(profile && profile.nodes) ? profile.nodes : [];
  const byId = new Map();
  for (const node of nodes) byId.set(node.id, node);
  const parentOf = new Map();
  for (const node of nodes) {
    if (!Array.isArray(node.children)) continue;
    for (const childId of node.children) parentOf.set(childId, node.id);
  }
  const self = parse.selfMsByNode;
  const inclusive = new Map();
  for (const [nodeIdString, selfMs] of Object.entries(self)) {
    let current = Number(nodeIdString);
    const seen = new Set();
    while (current !== undefined && current !== null && !seen.has(current)) {
      seen.add(current);
      inclusive.set(current, (inclusive.get(current) || 0) + selfMs);
      current = parentOf.get(current);
    }
  }
  const rows = [];
  for (const [nodeId, ms] of inclusive) {
    const node = byId.get(nodeId);
    const frame = (node && node.callFrame) || {};
    rows.push({
      nodeId,
      functionName: frame.functionName || '',
      url: frame.url || '',
      line: Number.isFinite(frame.lineNumber) ? frame.lineNumber + 1 : null,
      selfMs: self[String(nodeId)] || 0,
      inclusiveMs: round(ms, 6),
    });
  }
  rows.sort((left, right) => (right.inclusiveMs - left.inclusiveMs) || left.functionName.localeCompare(right.functionName));
  return rows.slice(0, 40);
}

function profilerOverhead(controlMedianMs, profiledMedianMs) {
  if (!Number.isFinite(controlMedianMs) || controlMedianMs <= 0) return null;
  if (!Number.isFinite(profiledMedianMs)) return null;
  return (profiledMedianMs - controlMedianMs) / controlMedianMs;
}

/**
 * The single decision point. A category is a candidate only when it clears both
 * the share floor and the per-scan millisecond floor in BOTH rounds. Anything
 * else yields a limitation or the standing negative conclusion.
 */
function decideAttribution(rounds) {
  const limitations = [];
  // Accept either a `projectRound` row (fields under `run.result`, attribution
  // directly on the row) or a pre-flattened row; both shapes occur in tests and
  // in the CLI, and neither may silently read `undefined` for a threshold.
  const wallMedian = (run) => {
    if (!run) return null;
    if (run.result && run.result.wallDurationMs) return run.result.wallDurationMs.median;
    if (run.wallDurationMs) return run.wallDurationMs.median;
    return null;
  };
  const attributionOf = (run) => (run && run.attribution) || null;
  const scanCountOf = (run) => {
    if (!run) return 0;
    if (run.result && Number.isInteger(run.result.scans)) return run.result.scans;
    if (Number.isInteger(run.scans)) return run.scans;
    return 0;
  };
  const overheads = [];
  for (const roundRow of rounds) {
    const overhead = profilerOverhead(
      wallMedian(roundRow.control),
      wallMedian(roundRow.profiled),
    );
    overheads.push({ round: roundRow.round, overhead });
    if (overhead === null) limitations.push(`OVERHEAD_UNMEASURABLE_ROUND_${roundRow.round}`);
    else if (overhead > ATTRIBUTION_RULE.maxProfilerOverhead) {
      limitations.push(`PROFILER_OVERHEAD_ROUND_${roundRow.round}`);
    }
  }

  const unclassified = rounds
    .map((row) => ({
      round: row.round,
      share: attributionOf(row.profiled) ? attributionOf(row.profiled).unclassifiedShare : null,
    }));
  for (const row of unclassified) {
    if (row.share === null) limitations.push(`UNCLASSIFIED_UNMEASURED_ROUND_${row.round}`);
    else if (row.share > ATTRIBUTION_RULE.maxUnclassifiedShare) {
      limitations.push(`UNCLASSIFIED_DOMINATES_ROUND_${row.round}`);
    }
  }

  // A category must clear both floors in both rounds to be a candidate.
  const scans = rounds.map((row) => scanCountOf(row.profiled));
  const perScanMs = new Map();
  for (const row of rounds) {
    const attribution = attributionOf(row.profiled);
    const count = scans[row.round - 1] || 0;
    if (!attribution || count <= 0) continue;
    for (const entry of attribution.byCategory) {
      const current = perScanMs.get(entry.category) || { perRound: {}, totalMs: 0 };
      current.perRound[row.round] = {
        share: entry.share,
        msPerScan: entry.totalMs / count,
      };
      current.totalMs = Math.max(current.totalMs, entry.totalMs);
      perScanMs.set(entry.category, current);
    }
  }

  const candidates = [];
  for (const [category, row] of perScanMs) {
    const roundsQualifying = [];
    for (const roundRow of rounds) {
      const observed = row.perRound[roundRow.round];
      if (!observed) continue;
      if (observed.share !== null
        && observed.share >= ATTRIBUTION_RULE.minCategoryShare
        && observed.msPerScan >= ATTRIBUTION_RULE.minCategoryMsPerScan) {
        roundsQualifying.push(roundRow.round);
      }
    }
    if (roundsQualifying.length === rounds.length) {
      candidates.push({
        category,
        rounds: roundsQualifying,
        perRound: row.perRound,
      });
    }
  }
  candidates.sort((left, right) => {
    const leftMax = Math.max(...Object.values(left.perRound).map((row) => row.share || 0));
    const rightMax = Math.max(...Object.values(right.perRound).map((row) => row.share || 0));
    return (rightMax - leftMax) || left.category.localeCompare(right.category);
  });

  const rankingOf = (roundNumber) => {
    const row = rounds.find((entry) => entry.round === roundNumber);
    const attribution = row && attributionOf(row.profiled);
    if (!attribution) return [];
    return attribution.byCategory
      .filter((entry) => entry.share !== null && entry.share >= ATTRIBUTION_RULE.rankingShareFloor)
      .map((entry) => entry.category);
  };
  const rankings = rounds.map((row) => ({ round: row.round, ranking: rankingOf(row.round) }));
  const rankingsAgree = rankings.length > 1
    && rankings.every((row) => stableStringify(row.ranking) === stableStringify(rankings[0].ranking));
  if (!rankingsAgree) limitations.push('RANKINGS_DISAGREE');

  let verdict;
  if (limitations.some((row) => row.startsWith('PROFILER_OVERHEAD'))) {
    verdict = 'LIMITATION_PROFILER_OVERHEAD';
  } else if (limitations.some((row) => row.startsWith('UNCLASSIFIED_DOMINATES'))) {
    verdict = 'LIMITATION_UNCLASSIFIED_DOMINATES';
  } else if (limitations.some((row) => row.startsWith('OVERHEAD_UNMEASURABLE')
    || row.startsWith('UNCLASSIFIED_UNMEASURED'))) {
    verdict = 'INCONCLUSIVE';
  } else if (candidates.length === 0) {
    verdict = 'NO_CANDIDATE_CATEGORY';
  } else if (!rankingsAgree) {
    verdict = 'LIMITATION_RANKING_INSTABILITY';
  } else {
    verdict = 'PROPOSAL_SUPPORTABLE';
  }

  // A limitation is a refusal to recommend: any category that happened to clear
  // the numeric floors is withheld together with the verdict, so a downstream
  // reader can never cherry-pick a candidate out of a downgraded run.
  const publishedCandidates = verdict === 'PROPOSAL_SUPPORTABLE' ? candidates : [];

  return {
    rule: ATTRIBUTION_RULE,
    scanCounts: scans,
    profilerOverhead: overheads,
    unclassified,
    rankings,
    rankingsAgree,
    candidatesQualifyingNumerically: candidates,
    candidates: publishedCandidates,
    limitations,
    verdict,
    // Even a supportable proposal is a NEXT-STEP proposal, never authorization
    // to edit production code in this slice.
    productionOptimizationAuthorized: false,
    statement: verdict === 'NO_CANDIDATE_CATEGORY' || verdict === 'INCONCLUSIVE'
      ? 'Attribution remains inconclusive; no optimization is justified.'
      : null,
  };
}

function appendBounded(current, chunk) {
  if (current.length >= MAX_CAPTURED_OUTPUT) return current;
  return `${current}${chunk.toString('utf8')}`.slice(-MAX_CAPTURED_OUTPUT);
}

/**
 * Spawn ONE worker mode and wait for it to be observed gone. Reuses the C1
 * child-ledger/completion rules so a timeout can never be reported as a clean
 * result and no further worker starts while ownership is unresolved.
 */
function runProfileWorker({
  nodePath,
  workerPath,
  mode,
  fixtureRoot,
  sourceRoot,
  jsonOut,
  cpuProfileOut,
  timeoutMs,
  scans,
  warmups,
  samplingIntervalMicros,
}, dependencies = {}) {
  const spawnWorker = dependencies.spawnWorker || spawn;
  const schedule = dependencies.setTimeout || setTimeout;
  const cancel = dependencies.clearTimeout || clearTimeout;
  const now = dependencies.now || Date.now;
  const signalProcess = dependencies.signal || process.kill.bind(process);
  const probeAsync = dependencies.probeAsync || ((pid) => {
    try {
      process.kill(pid, 0);
      return 'alive';
    } catch (error) {
      if (error && error.code === 'ESRCH') return 'absent';
      if (error && error.code === 'EPERM') return 'alive';
      return 'unknown';
    }
  });

  const args = [
    workerPath,
    '--mode', mode,
    '--fixture', fixtureRoot,
    '--source-root', sourceRoot,
    '--json-out', jsonOut,
  ];
  // Sample counts are protocol inputs, so they are passed explicitly: a worker
  // silently using its own defaults would make the parent's validity check
  // compare against numbers nobody requested.
  if (Number.isInteger(scans) && scans > 0) args.push('--scans', String(scans));
  if (Number.isInteger(warmups) && warmups > 0) args.push('--warmups', String(warmups));
  if (mode === 'profiled' && Number.isInteger(samplingIntervalMicros) && samplingIntervalMicros > 0) {
    args.push('--sampling-interval-micros', String(samplingIntervalMicros));
  }
  // The profile path is meaningful only for the profiled mode; a stray path on
  // a control run must never turn that process into an instrumented one.
  if (mode === 'profiled' && cpuProfileOut) args.push('--cpuprofile-out', cpuProfileOut);

  return new Promise((resolve) => {
    const ledger = createChildLedger();
    const workerProcess = { pid: null };
    const child = spawnWorker(nodePath, args, {
      cwd: sourceRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    workerProcess.pid = Number.isInteger(child.pid) ? child.pid : null;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    let killTimer = null;
    let timedOut = false;
    let signalAttempts = null;
    let workerExitConfirmed = false;
    let killAttempt = null;
    let workerError = null;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) cancel(timer);
      if (killTimer !== null) cancel(killTimer);
      resolve(value);
    };

    const base = (extra) => ({
      mode,
      ok: false,
      workerPid: workerProcess.pid,
      workerError,
      signalAttempts,
      workerExitConfirmed,
      workerKill: killAttempt,
      timedOut,
      childProcesses: ledger.snapshot(),
      stdout: stdout.slice(-MAX_CAPTURED_OUTPUT),
      stderr: stderr.slice(-MAX_CAPTURED_OUTPUT),
      ...extra,
    });

    const signalChildren = () => {
      signalAttempts = signalOpenChildren(ledger, signalProcess);
      return signalAttempts;
    };

    const settleWhenTerminated = (failure) => {
      const deadline = now() + 2_000;
      const check = () => {
        const unresolvedChildren = survivingChildren(ledger, probeAsync);
        if (workerExitConfirmed && unresolvedChildren.length === 0) {
          finish(base({ failure, terminationConfirmed: true, unresolvedChildren: [] }));
          return;
        }
        if (now() >= deadline) {
          finish(base({
            failure: 'UNRESOLVED_PROCESS',
            terminationConfirmed: false,
            requestedFailure: failure,
            unresolvedChildren,
            unresolvedWorker: workerExitConfirmed ? [] : [workerProcess.pid],
          }));
          return;
        }
        killTimer = schedule(check, 25);
      };
      check();
    };

    timer = schedule(() => {
      timedOut = true;
      signalChildren();
      killAttempt = { attempted: true, signaled: false, error: null };
      try {
        killAttempt.signaled = child.kill('SIGKILL') === true;
      } catch (error) {
        killAttempt.error = error && error.code ? error.code : String(error);
      }
      settleWhenTerminated('WORKER_TIMEOUT');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk);
      ledger.consume(chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });
    child.on('error', (error) => {
      workerError = {
        code: error && error.code ? error.code : String(error),
        message: error && error.message ? error.message : String(error),
      };
      if (workerProcess.pid === null) {
        finish(base({
          failure: 'SPAWN_ERROR',
          terminationConfirmed: false,
          childProcesses: [],
        }));
        return;
      }
      if (killAttempt && killAttempt.attempted && !killAttempt.error) {
        killAttempt.error = workerError.code;
      }
    });
    child.on('close', (code, signal) => {
      workerExitConfirmed = true;
      if (settled) return;
      const survivors = survivingChildren(ledger, probeAsync);
      if (survivors.length > 0) {
        signalChildren();
        settleWhenTerminated(timedOut ? 'WORKER_TIMEOUT' : 'UNRESOLVED_PROCESS');
        return;
      }
      if (timedOut) {
        settleWhenTerminated('WORKER_TIMEOUT');
        return;
      }
      const line = stdout.split(/\r?\n/).find((row) => row.startsWith(RESULT_PREFIX));
      if (!line) {
        finish(base({
          failure: 'MALFORMED_OUTPUT',
          exitCode: code,
          signal: signal || null,
          terminationConfirmed: true,
        }));
        return;
      }
      let payload;
      try {
        payload = JSON.parse(line.slice(RESULT_PREFIX.length));
      } catch (error) {
        finish(base({
          failure: 'MALFORMED_JSON',
          exitCode: code,
          signal: signal || null,
          terminationConfirmed: true,
          error: error.message,
        }));
        return;
      }
      let failure = null;
      if (code !== 0) failure = 'NONZERO_EXIT';
      else if (payload.ok !== true) failure = 'WORKER_REPORTED_FAILURE';
      else if (payload.mode !== mode) failure = 'MODE_MISMATCH';
      finish(base({
        failure,
        ok: failure === null,
        exitCode: code,
        signal: signal || null,
        terminationConfirmed: true,
        payload,
      }));
    });
  });
}

/**
 * Structural gate for a retained `.cpuprofile`. A profile that parses as JSON
 * but cannot be attributed (no nodes, no samples, sample/node arrays of
 * different lengths, samples pointing at nodes that do not exist, or dangling
 * child references) is not evidence, so it must invalidate the run rather than
 * silently produce an empty attribution.
 *
 * Two further classes are rejected here because they would otherwise be
 * silently absorbed downstream:
 *   - unusable timing data (`timeDeltas` containing non-finite or negative
 *     values, or a series with no positive elapsed time at all), which
 *     `parseProfile` would otherwise drop sample by sample; and
 *   - cyclic or conflicting parent relationships, which make ancestor
 *     traversal unbounded.
 */
function validateProfileStructure(raw) {
  if (!raw || typeof raw !== 'object') return ['PROFILE_NOT_OBJECT'];
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : null;
  const samples = Array.isArray(raw.samples) ? raw.samples : null;
  const deltas = Array.isArray(raw.timeDeltas) ? raw.timeDeltas : null;
  const problems = [];
  if (!nodes || nodes.length === 0) problems.push('PROFILE_NODES_MISSING');
  if (!samples || samples.length === 0) problems.push('PROFILE_SAMPLES_MISSING');
  if (!deltas) problems.push('PROFILE_DELTAS_MISSING');
  if (nodes && samples && deltas) {
    if (samples.length !== deltas.length) problems.push('PROFILE_SAMPLE_DELTA_LENGTH_MISMATCH');
    // Every delta is evidence. A negative or non-finite delta is not a
    // "harmless" entry to skip: dropping it shrinks the attributed total and
    // shifts every published share.
    let invalidDeltas = 0;
    let positiveDeltas = 0;
    for (const delta of deltas) {
      if (typeof delta !== 'number' || !Number.isFinite(delta) || delta < 0) invalidDeltas += 1;
      else if (delta > 0) positiveDeltas += 1;
    }
    if (invalidDeltas > 0) problems.push('PROFILE_DELTA_INVALID');
    // An empty series is already rejected above; only a series that carries
    // entries but no elapsed time at all is separately unusable timing.
    if (deltas.length > 0 && positiveDeltas === 0) problems.push('PROFILE_TIMING_UNUSABLE');
    const byId = new Map();
    let duplicateNodeId = false;
    for (const node of nodes) {
      if (!node || !Number.isInteger(node.id)) {
        problems.push('PROFILE_NODE_ID_MISSING');
        break;
      }
      if (byId.has(node.id)) duplicateNodeId = true;
      byId.set(node.id, node);
    }
    if (duplicateNodeId) problems.push('PROFILE_DUPLICATE_NODE_ID');
    const orphanSamples = samples.filter((id) => !byId.has(id)).length;
    if (orphanSamples > 0) problems.push('PROFILE_ORPHAN_SAMPLES');
    let danglingChildRefs = 0;
    for (const node of nodes) {
      if (!node || !Array.isArray(node.children)) continue;
      for (const childId of node.children) {
        if (!byId.has(childId)) danglingChildRefs += 1;
      }
    }
    if (danglingChildRefs > 0) problems.push('PROFILE_DANGLING_CHILD_REF');
    // One child has at most one parent. A node listed under two parents, or a
    // node listed under itself, gives traversal more than one answer and can
    // make `resolveNamedAncestor` loop forever.
    let cyclicOrConflicting = false;
    const parentOf = new Map();
    for (const node of nodes) {
      if (!node || !Number.isInteger(node.id) || !Array.isArray(node.children)) continue;
      for (const childId of node.children) {
        if (childId === node.id) {
          cyclicOrConflicting = true;
          continue;
        }
        if (parentOf.has(childId) && parentOf.get(childId) !== node.id) {
          cyclicOrConflicting = true;
          continue;
        }
        parentOf.set(childId, node.id);
      }
    }
    // Walk each chain with a visited set: a cycle spanning several nodes has no
    // self-edge and would only be caught here.
    if (!cyclicOrConflicting) {
      for (const nodeId of byId.keys()) {
        const seen = new Set();
        let current = nodeId;
        while (current !== undefined && current !== null) {
          if (seen.has(current)) {
            cyclicOrConflicting = true;
            break;
          }
          seen.add(current);
          current = parentOf.get(current);
        }
        if (cyclicOrConflicting) break;
      }
    }
    if (cyclicOrConflicting) problems.push('PROFILE_GRAPH_CYCLIC');
    if (!Number.isFinite(raw.startTime) || !Number.isFinite(raw.endTime) || raw.endTime <= raw.startTime) {
      problems.push('PROFILE_TIME_RANGE_INVALID');
    }
  }
  return problems;
}

/**
 * Recount a published summary against the raw sample series. The worker's
 * numbers are never trusted on their own: every statistic the report consumes
 * is recomputed here from finite samples, so a tampered or truncated summary
 * fails instead of being averaged into the verdict.
 */
function summaryMatchesSeries(published, series) {
  if (!published || typeof published !== 'object') return false;
  if (!Array.isArray(published.samples)) return false;
  const expected = summarizeSeries(series);
  return stableStringify(published.samples) === stableStringify(expected.samples)
    && published.count === expected.count
    && published.median === expected.median
    && published.min === expected.min
    && published.max === expected.max
    && published.mad === expected.mad;
}

/**
 * Validate one completed worker payload and reduce it to the fields the report
 * consumes.
 *
 * This is the raw-evidence gate, not just a shape check: the payload's declared
 * mode/schema/scan/warm-up counts must match what was requested, every timing
 * summary must recompute from its own finite samples, the retained profile must
 * live at the path this run asked for and hash to the file on disk, that file
 * must be structurally attributable, and the resolved production modules must
 * still hash to what the worker recorded. Any failure returns `ok:false` with a
 * machine-readable reason that the final execution calculation consumes.
 */
function validateProfileRun(outcome, mode, expectedDigest, scans, warmups, options = {}) {
  if (!outcome || outcome.ok !== true) {
    return { ok: false, reason: (outcome && outcome.failure) || 'WORKER_FAILED' };
  }
  const payload = outcome.payload;
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'MALFORMED_PAYLOAD' };
  if (payload.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    return { ok: false, reason: 'PAYLOAD_SCHEMA_MISMATCH' };
  }
  if (payload.mode !== mode) return { ok: false, reason: 'MODE_MISMATCH' };
  const result = payload.result;
  if (!result || result.ok !== true) return { ok: false, reason: 'WORKER_REPORTED_FAILURE' };
  if (payload.scansRequested !== scans) return { ok: false, reason: 'WRONG_SCAN_COUNT' };
  if (payload.warmupsRequested !== warmups) return { ok: false, reason: 'WRONG_WARMUP_COUNT' };
  if (result.projectionDigest !== expectedDigest) {
    return { ok: false, reason: 'DIGEST_MISMATCH' };
  }
  const wall = result.wallDurationMs;
  if (!wall || !Array.isArray(wall.samples) || wall.samples.length !== scans
    || !wall.samples.every((value) => Number.isFinite(value))) {
    return { ok: false, reason: 'MISSING_SAMPLES' };
  }
  if (result.scans !== scans) return { ok: false, reason: 'WRONG_SCAN_COUNT' };
  if (!Number.isInteger(result.warmupCount) || result.warmupCount !== warmups) {
    return { ok: false, reason: 'WRONG_WARMUP_COUNT' };
  }
  if (!summaryMatchesSeries(result.wallDurationMs, result.wallDurationMs.samples)) {
    return { ok: false, reason: 'WALL_SUMMARY_MISMATCH' };
  }
  const warmupSeries = result.warmupDurationMs && result.warmupDurationMs.samples;
  if (!Array.isArray(warmupSeries) || warmupSeries.length !== warmups
    || !warmupSeries.every((value) => Number.isFinite(value))
    || !summaryMatchesSeries(result.warmupDurationMs, warmupSeries)) {
    return { ok: false, reason: 'WARMUP_SUMMARY_MISMATCH' };
  }
  const perScan = result.perScan;
  if (!Array.isArray(perScan) || perScan.length !== scans) {
    return { ok: false, reason: 'PER_SCAN_MISSING' };
  }
  for (let index = 0; index < perScan.length; index += 1) {
    const row = perScan[index];
    if (!row || row.index !== index + 1 || row.rawDurationMs !== wall.samples[index]) {
      return { ok: false, reason: 'PER_SCAN_MISMATCH' };
    }
  }
  if (!Array.isArray(result.resolvedModules) || result.resolvedModules.length === 0) {
    return { ok: false, reason: 'RESOLVED_DEPENDENCIES_MISSING' };
  }
  const sourceRoot = options.sourceRoot;
  if (typeof sourceRoot === 'string' && sourceRoot.length > 0) {
    const seenDependencies = new Map();
    for (const row of result.resolvedModules) {
      if (!row || typeof row.file !== 'string' || row.file.length === 0) {
        return { ok: false, reason: 'RESOLVED_DEPENDENCY_INVALID' };
      }
      // A missing or unreadable file yields `null` from sha256File. Comparing
      // null to a recorded `sha256: null` would pass, so both sides are
      // required to be real hashes before any comparison happens.
      if (typeof row.sha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(row.sha256)) {
        return { ok: false, reason: 'RESOLVED_DEPENDENCY_HASH_INVALID' };
      }
      const previous = seenDependencies.get(row.file);
      if (previous !== undefined && previous !== row.sha256) {
        return { ok: false, reason: 'RESOLVED_DEPENDENCY_CONFLICT' };
      }
      seenDependencies.set(row.file, row.sha256);
      const absolute = path.resolve(sourceRoot, ...row.file.split('/'));
      if (!absolute.startsWith(`${path.resolve(sourceRoot)}${path.sep}`)) {
        return { ok: false, reason: 'RESOLVED_DEPENDENCY_ESCAPES_ROOT' };
      }
      const currentHash = sha256File(absolute);
      if (typeof currentHash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(currentHash)) {
        return { ok: false, reason: 'RESOLVED_DEPENDENCY_HASH_UNAVAILABLE' };
      }
      if (currentHash !== row.sha256) {
        return { ok: false, reason: 'RESOLVED_DEPENDENCY_HASH_MISMATCH' };
      }
    }
  }
  if (mode === 'profiled') {
    const profile = result.profile;
    if (!profile || !profile.path || !profile.sha256) {
      return { ok: false, reason: 'MISSING_PROFILE' };
    }
    if (profile.stoppedCleanly !== true) return { ok: false, reason: 'PROFILER_STOP_FAILED' };
    if (typeof options.expectedProfilePath === 'string' && options.expectedProfilePath.length > 0
      && path.resolve(profile.path) !== path.resolve(options.expectedProfilePath)) {
      return { ok: false, reason: 'PROFILE_PATH_UNEXPECTED' };
    }
    if (!fs.existsSync(profile.path)) return { ok: false, reason: 'PROFILE_FILE_MISSING' };
    if (sha256File(profile.path) !== profile.sha256) {
      return { ok: false, reason: 'PROFILE_HASH_MISMATCH' };
    }
    if (Number.isInteger(options.samplingIntervalMicros)
      && profile.sampleIntervalMicros !== options.samplingIntervalMicros) {
      return { ok: false, reason: 'PROFILE_INTERVAL_MISMATCH' };
    }
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(profile.path, 'utf8'));
    } catch {
      return { ok: false, reason: 'PROFILE_UNREADABLE' };
    }
    const problems = validateProfileStructure(raw);
    if (problems.length > 0) return { ok: false, reason: problems[0] };
    if (profile.sampleCount !== raw.samples.length) {
      return { ok: false, reason: 'PROFILE_SAMPLE_COUNT_MISMATCH' };
    }
    if (profile.timeDeltaCount !== raw.timeDeltas.length) {
      return { ok: false, reason: 'PROFILE_DELTA_COUNT_MISMATCH' };
    }
  }
  return { ok: true, result };
}

/**
 * Coarse execution reason for one rejected row. Kept deliberately small: the
 * detailed reason stays on the row and in the decision limitations, while this
 * code is what a reader scans first.
 */
function executionReasonForInvalidRun(reason) {
  if (reason === 'DIGEST_MISMATCH' || reason === 'CORRECTNESS_FAILURE') return 'CORRECTNESS_FAILURE';
  if (reason === 'WORKER_TIMEOUT' || reason === 'RUN_TIMEOUT') return 'TIMEOUT';
  if (reason === 'UNRESOLVED_PROCESS') return 'UNRESOLVED_PROCESS';
  return 'INVALID_RUN';
}

/**
 * The production input whose identity travels in the before/after maps next to
 * the profiling modules. It executes no attribution module of its own, so it
 * has no `executedProfilingModules` entry; its three-way agreement is the before
 * map, the after map and their cross-map equality, which is applied here with
 * the same completeness rule as the required modules.
 */
const REQUIRED_PRODUCTION_INPUTS = ['production'];

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function isRealHash(value) {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

/**
 * Every required provenance module must carry a well-formed sha256 in the
 * before map, the after map and the recorded provenance entry, and all three
 * have to be the same digest. Missing maps, missing keys, nulls and malformed
 * values are all invalid: `inputIdentity.unchanged` is only a readable summary,
 * never the authorization flag, because equality of two maps proves nothing
 * when both sides of a key are null.
 */
function findIncompleteProvenanceModuleHashes(provenanceModules, beforeHashes, afterHashes) {
  const missing = [];
  const disagreeing = [];
  const hashIn = (map, name) => (map && typeof map === 'object' ? map[name] : undefined);
  for (const name of REQUIRED_PROVENANCE_MODULES) {
    const entry = provenanceModules[name];
    const recorded = entry && typeof entry === 'object' ? entry.sha256 : undefined;
    const before = hashIn(beforeHashes, name);
    const after = hashIn(afterHashes, name);
    if (!isRealHash(recorded) || !isRealHash(before) || !isRealHash(after)) {
      missing.push(name);
      continue;
    }
    // All three are real digests, so a disagreement is an identity problem
    // rather than an absent-hash problem.
    if (before !== recorded || after !== recorded || before !== after) disagreeing.push(name);
  }
  for (const name of REQUIRED_PRODUCTION_INPUTS) {
    const before = hashIn(beforeHashes, name);
    const after = hashIn(afterHashes, name);
    if (!isRealHash(before) || !isRealHash(after)) {
      missing.push(name);
      continue;
    }
    if (before !== after) disagreeing.push(name);
  }
  return { missing, disagreeing };
}

/**
 * THE single validity calculation.
 *
 * Every required round/mode must be present exactly once, every row must be
 * valid, and every required run must report exactly the same dependency set with
 * exactly the same hashes. This is computed once, from the assembled report, and
 * consumed by both the exit status and the decision downgrade — so no code path
 * can exit 0 with an invalid row, and no invalid row can leave a published
 * recommendation behind.
 *
 * "Invalid" (the run did not happen or its evidence does not hold) is
 * deliberately separate from "valid but limited" (e.g. profiler overhead above
 * the declared ceiling): a limited-but-valid measurement still exits 0 with a
 * limitation and no recommendation.
 */
function evaluateExecution(report) {
  const reasons = [];
  const invalidRuns = [];
  const inputIdentity = report.inputIdentity || {};
  const protocol = report.protocol || {};
  const requiredRounds = Number.isInteger(protocol.rounds) ? protocol.rounds : ROUNDS;
  const modes = Array.isArray(protocol.modes) && protocol.modes.length > 0 ? protocol.modes : MODES;

  if (inputIdentity.unchanged !== true) reasons.push('INPUT_CHANGED');
  if (inputIdentity.fixtureContentUnchanged !== true) reasons.push('FIXTURE_CONTENT_CHANGED');
  if (report.unresolvedProcess) reasons.push('UNRESOLVED_PROCESS');

  // Input identity must be COMPLETE and STABLE, not merely equal at two
  // instants. Every required run has to report the same hash for the same
  // canonical dependency, and the recorded provenance modules have to carry
  // real hashes. Equality of two before/after maps proves nothing when both
  // sides of a key are null, or when two workers each re-checked a file that
  // changed between them.
  const provenance = report.provenance || {};
  const provenanceModules = provenance.executedProfilingModules
    && typeof provenance.executedProfilingModules === 'object'
    ? provenance.executedProfilingModules
    : null;
  const provenanceEntries = provenanceModules ? Object.values(provenanceModules) : [];
  // "Present" is not enough: provenance is the identity of what ran, so every
  // declared module has to be accounted for, not just one of them.
  const missingModules = REQUIRED_PROVENANCE_MODULES
    .filter((name) => !provenanceModules || !Object.prototype.hasOwnProperty.call(provenanceModules, name));
  if (provenanceEntries.length === 0 || missingModules.length > 0) {
    reasons.push('PROVENANCE_MODULES_MISSING');
  }
  // Missing evidence INVALIDATES the run: the module identity is only proven
  // when the before map, the after map and the recorded provenance entry all
  // exist, are well-formed and agree.
  const { missing: missingModuleHashes, disagreeing: disagreeingModuleHashes } = findIncompleteProvenanceModuleHashes(
    provenanceModules || {},
    inputIdentity.hashesBefore,
    inputIdentity.hashesAfter,
  );
  if (missingModuleHashes.length > 0) reasons.push('PROVENANCE_MODULE_HASH_MISSING');
  if (disagreeingModuleHashes.length > 0) reasons.push('PROVENANCE_MODULE_IDENTITY_UNSTABLE');
  let provenanceHashInvalid = false;
  for (const entry of provenanceEntries) {
    if (!entry || !isRealHash(entry.sha256)) {
      provenanceHashInvalid = true;
    }
  }
  if (provenanceHashInvalid) reasons.push('PROVENANCE_HASH_INVALID');

  // Dependency identity is the identity of the measured input, so it is derived
  // from ONE canonical run (the first valid required round/mode in round order,
  // then mode order), and every required run then has to report EXACTLY that file
  // set with EXACTLY those hashes. A union across runs proves nothing: a run that
  // silently stopped resolving a dependency would just drop out of the union
  // while still "agreeing" with it, and a report could then be published from a
  // round that never proved the dependency at all.
  const rounds = Array.isArray(report.rounds) ? report.rounds : [];
  const runDependencies = [];
  let dependencyHashInvalid = false;
  let dependencyIdentityUnstable = false;
  let dependencyRecordCount = 0;
  for (let roundNumber = 1; roundNumber <= requiredRounds; roundNumber += 1) {
    const roundRow = rounds.find((row) => row && row.round === roundNumber);
    for (const mode of modes) {
      const run = roundRow && typeof roundRow === 'object' ? roundRow[mode] : null;
      const modules = run && typeof run === 'object' ? run.resolvedModules : undefined;
      if (!Array.isArray(modules) || modules.length === 0) {
        runDependencies.push(null);
        continue;
      }
      const files = new Map();
      let complete = true;
      for (const entry of modules) {
        if (!entry || typeof entry.file !== 'string' || entry.file.length === 0) {
          complete = false;
          continue;
        }
        dependencyRecordCount += 1;
        // A repeated file is not a second piece of evidence: even a same-hash
        // duplicate means this run does not carry the canonical set exactly once.
        // A repeated file whose digest differs is additionally an unstable
        // identity, because one run cannot describe the same file two ways.
        if (files.has(entry.file)) {
          complete = false;
          if (isRealHash(entry.sha256) && files.get(entry.file) !== entry.sha256) {
            dependencyIdentityUnstable = true;
          }
          continue;
        }
        if (!isRealHash(entry.sha256)) dependencyHashInvalid = true;
        files.set(entry.file, entry.sha256);
      }
      runDependencies.push({ files, complete });
    }
  }
  if (dependencyHashInvalid) reasons.push('RESOLVED_DEPENDENCY_HASH_INVALID');
  const canonicalRun = runDependencies.find(
    (row) => row && row.complete && row.files.size > 0
      && [...row.files.values()].every((hash) => isRealHash(hash)),
  ) || null;
  const dependencyIdentity = new Map(canonicalRun ? canonicalRun.files : []);
  let dependencySetIncomplete = canonicalRun === null;
  let dependencySetMismatch = false;
  for (const row of runDependencies) {
    if (!row || row.files.size === 0) {
      dependencySetIncomplete = true;
      continue;
    }
    if (!row.complete || row.files.size !== dependencyIdentity.size) {
      dependencySetMismatch = true;
      continue;
    }
    for (const [file, hash] of row.files) {
      const canonicalHash = dependencyIdentity.get(file);
      if (canonicalHash === undefined) {
        dependencySetMismatch = true;
        continue;
      }
      // Only a real-but-different digest is an instability; an invalid one is
      // already reported as RESOLVED_DEPENDENCY_HASH_INVALID above.
      if (isRealHash(hash) && canonicalHash !== hash) {
        dependencyIdentityUnstable = true;
      }
    }
  }
  if (dependencyIdentityUnstable) reasons.push('RESOLVED_DEPENDENCY_IDENTITY_UNSTABLE');
  if (dependencySetMismatch) reasons.push('RESOLVED_DEPENDENCY_SET_MISMATCH');
  if (dependencySetIncomplete) reasons.push('RESOLVED_DEPENDENCY_SET_INCOMPLETE');

  /**
   * The per-run checks prove each worker saw the recorded bytes. This final
   * recheck proves those bytes are still the ones on disk when the report is
   * written, and it has to cover EXACTLY the canonical dependency set: a
   * partial recheck, a duplicated or conflicting row, an extra unrelated row,
   * a row that does not agree with the cross-run identity, and a row whose
   * recorded and current digests disagree all invalidate the run. A missing
   * recheck can never be read as "nothing to verify": exact coverage means
   * exactly one row per canonical dependency and nothing else.
   */
  const recheckRows = Array.isArray(inputIdentity.dependencyRecheck)
    ? inputIdentity.dependencyRecheck
    : null;
  if (recheckRows === null) {
    reasons.push('RESOLVED_DEPENDENCY_RECHECK_MISSING');
  } else {
    const recheckedHashes = new Map();
    let recheckFailed = false;
    for (const row of recheckRows) {
      if (!row || typeof row !== 'object') {
        recheckFailed = true;
        continue;
      }
      const file = row.file;
      if (!isRealHash(row.recorded) || !isRealHash(row.current)
        || row.recorded !== row.current || row.matches !== true) {
        recheckFailed = true;
        continue;
      }
      const canonical = dependencyIdentity.get(file);
      if (canonical === undefined || canonical !== row.recorded) {
        recheckFailed = true;
        continue;
      }
      if (recheckedHashes.has(file)) {
        recheckFailed = true;
        continue;
      }
      recheckedHashes.set(file, row.recorded);
    }
    if (recheckFailed) reasons.push('RESOLVED_DEPENDENCY_RECHECK_FAILED');
    if (recheckedHashes.size !== dependencyIdentity.size
      || [...dependencyIdentity].some(([file, hash]) => recheckedHashes.get(file) !== hash)) {
      reasons.push('RESOLVED_DEPENDENCY_RECHECK_MISSING');
    }
  }
  // Provenance must describe what actually ran, so the identity it publishes
  // has to agree with the per-run records it was derived from.
  const publishedRows = provenance.resolvedProductionDependencies;
  const publishedDependencies = Array.isArray(publishedRows) ? publishedRows : [];
  const publishedIdentity = new Map();
  let publishedRowInvalid = false;
  for (const row of publishedDependencies) {
    if (typeof row !== 'string') continue;
    const separator = row.lastIndexOf('=');
    if (separator <= 0) {
      publishedRowInvalid = true;
      continue;
    }
    const file = row.slice(0, separator);
    const hash = row.slice(separator + 1);
    if (!isRealHash(hash)) {
      publishedRowInvalid = true;
      continue;
    }
    // One row per canonical dependency: a repeated file is not extra evidence,
    // even when it repeats the same digest.
    if (publishedIdentity.has(file)) publishedRowInvalid = true;
    else publishedIdentity.set(file, hash);
  }
  if (dependencyRecordCount === 0 || publishedRowInvalid
    || publishedIdentity.size !== dependencyIdentity.size) {
    reasons.push('PROVENANCE_DEPENDENCIES_INCOMPLETE');
  } else {
    for (const [file, hash] of dependencyIdentity) {
      if (publishedIdentity.get(file) !== hash) {
        reasons.push('PROVENANCE_DEPENDENCIES_INCOMPLETE');
        break;
      }
    }
  }

  for (const row of report.invalidRows || []) {
    const detail = `INVALID_${row.reason}_R${row.round}_${row.mode}`;
    invalidRuns.push({ round: row.round, mode: row.mode, reason: row.reason, detail });
    reasons.push(detail);
    reasons.push(executionReasonForInvalidRun(row.reason));
  }

  const missingRuns = [];
  for (let roundNumber = 1; roundNumber <= requiredRounds; roundNumber += 1) {
    const roundRow = rounds.find((row) => row && row.round === roundNumber);
    for (const mode of modes) {
      const run = roundRow ? roundRow[mode] : null;
      if (!run || run.scans === undefined || run.scans === null) {
        missingRuns.push({ round: roundNumber, mode, reason: 'MISSING_REQUIRED_RUN' });
        reasons.push(`MISSING_REQUIRED_RUN_R${roundNumber}_${mode}`);
        reasons.push('INVALID_RUN');
      }
    }
  }

  if (report.decision && report.decision.verdict === 'CORRECTNESS_FAILURE') {
    reasons.push('CORRECTNESS_FAILURE');
  }

  const unique = [...new Set(reasons)];
  return {
    ok: unique.length === 0,
    exitCode: unique.length === 0 ? 0 : 1,
    reasons: unique,
    invalidRuns,
    missingRuns,
    note: 'A valid-but-negative attribution verdict still exits 0; only invalid execution fails.',
  };
}

/**
 * Apply the validity verdict to the decision and stamp `report.execution`. A run
 * that is not fully valid can never publish a candidate or authorize work: the
 * verdict is downgraded and the candidate list is emptied, while the
 * numerically-qualifying list stays as a labelled diagnostic.
 */
function finalizeReport(report) {
  const execution = evaluateExecution(report);
  const decision = report.decision;
  if (!execution.ok && decision) {
    if (decision.verdict !== 'CORRECTNESS_FAILURE') decision.verdict = 'INCONCLUSIVE';
    decision.candidates = [];
    decision.productionOptimizationAuthorized = false;
    decision.statement = 'Attribution remains inconclusive; no optimization is justified.';
    decision.limitations = [...new Set([...decision.limitations, ...execution.reasons])];
  }
  report.execution = execution;
  return execution;
}

function markdownReport(report) {
  const lines = [];
  lines.push('# C2 S1 attribution (measurement only)');
  lines.push('');
  lines.push(`- Source root: \`${report.sourceRoot}\``);
  lines.push(`- Node: \`${report.node}\` (${report.platform}/${report.arch})`);
  lines.push(`- Started: ${report.startedAt}`);
  lines.push(`- Finished: ${report.finishedAt}`);
  lines.push(`- Verdict: **${report.decision.verdict}**`);
  lines.push(`- Production optimization authorized: ${report.decision.productionOptimizationAuthorized}`);
  if (report.decision.statement) lines.push(`- Statement: ${report.decision.statement}`);
  lines.push('');
  lines.push('## Wall duration and profiler overhead');
  lines.push('');
  lines.push('| Round | Mode | Scans | Median wall (ms) | CPU total median (ms) |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const roundRow of report.rounds) {
    for (const mode of MODES) {
      const run = roundRow[mode];
      lines.push(`| ${roundRow.round} | ${mode} | ${run ? run.scans : 0} | ${run ? run.wallDurationMs.median : 'n/a'} | ${run ? run.cpuTotalMs.median : 'n/a'} |`);
    }
  }
  lines.push('');
  lines.push('| Round | Profiler overhead |');
  lines.push('| --- | --- |');
  for (const row of report.decision.profilerOverhead) {
    lines.push(`| ${row.round} | ${row.overhead === null ? 'n/a' : `${round(row.overhead * 100, 2)}%`} |`);
  }
  lines.push('');
  lines.push('## Disjoint category shares (self time, profiled processes only)');
  lines.push('');
  for (const roundRow of report.rounds) {
    const attribution = roundRow.profiled && roundRow.profiled.attribution;
    lines.push(`### Round ${roundRow.round}`);
    lines.push('');
    if (!attribution) {
      lines.push('Not measured.');
      lines.push('');
      continue;
    }
    lines.push(`- Samples: ${attribution.sampleCount}, attributed ${attribution.attributedTotalMs} ms`);
    lines.push(`- GC ${attribution.gcMs} ms (${attribution.gcShare}); unclassified ${attribution.unclassifiedMs} ms (${attribution.unclassifiedShare})`);
    lines.push('');
    lines.push('| Category | Total ms | Share | Samples | ms/scan |');
    lines.push('| --- | --- | --- | --- | --- |');
    const scans = (roundRow.profiled && roundRow.profiled.scans) || 0;
    for (const entry of attribution.byCategory) {
      lines.push(`| ${entry.category} | ${entry.totalMs} | ${entry.share === null ? 'n/a' : `${round(entry.share * 100, 2)}%`} | ${entry.samples} | ${scans ? round(entry.totalMs / scans, 3) : 'n/a'} |`);
    }
    lines.push('');
  }
  lines.push('## Candidates clearing both floors in both rounds');
  lines.push('');
  if (report.decision.candidates.length === 0) {
    lines.push('None.');
  } else {
    lines.push('| Category | ' + report.rounds.map((row) => `R${row.round} share / ms per scan`).join(' | ') + ' |');
    lines.push('| --- |' + report.rounds.map(() => ' --- |').join(''));
    for (const candidate of report.decision.candidates) {
      const cells = report.rounds.map((row) => {
        const observed = candidate.perRound[row.round];
        return observed
          ? `${round(observed.share * 100, 2)}% / ${round(observed.msPerScan, 3)}`
          : 'n/a';
      });
      lines.push(`| ${candidate.category} | ${cells.join(' | ')} |`);
    }
  }
  lines.push('');
  lines.push('## Limitations recorded');
  lines.push('');
  if (report.decision.limitations.length === 0) lines.push('None.');
  else for (const row of report.decision.limitations) lines.push(`- ${row}`);
  lines.push('');
  lines.push('Inclusive (nested) totals below are diagnostics and must not be summed.');
  lines.push('');
  lines.push('## Invalid rows');
  lines.push('');
  if (!report.invalidRows || report.invalidRows.length === 0) lines.push('None.');
  else {
    lines.push('| Round | Mode | Reason |');
    lines.push('| --- | --- | --- |');
    for (const row of report.invalidRows) lines.push(`| ${row.round} | ${row.mode} | ${row.reason} |`);
  }
  lines.push('');
  lines.push('## Provenance');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.provenance || {}, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Input identity');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.inputIdentity, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Execution');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.execution, null, 2));
  lines.push('```');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const args = {
    sourceRoot: '',
    out: '',
    scans: 10,
    warmups: 2,
    rounds: ROUNDS,
    samplingIntervalMicros: DEFAULT_SAMPLING_INTERVAL_MICROS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--source-root') args.sourceRoot = path.resolve(value || '');
    else if (key === '--out') args.out = path.resolve(value || '');
    else if (key === '--scans') args.scans = Number.parseInt(value, 10);
    else if (key === '--warmups') args.warmups = Number.parseInt(value, 10);
    else if (key === '--rounds') args.rounds = Number.parseInt(value, 10);
    else if (key === '--sampling-interval-micros') args.samplingIntervalMicros = Number.parseInt(value, 10);
  }
  if (!args.sourceRoot) throw new Error('--source-root is required');
  if (!args.out) throw new Error('--out is required');
  for (const key of ['scans', 'warmups', 'rounds', 'samplingIntervalMicros']) {
    if (!Number.isInteger(args[key]) || args[key] <= 0) {
      throw new Error(`--${key} must be a positive integer`);
    }
  }
  return args;
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function projectRound(run) {
  if (!run || run.ok !== true || !run.result) return null;
  return {
    scans: run.result.scans,
    projectionDigest: run.result.projectionDigest,
    warmupCount: run.result.warmupCount,
    warmupDurationMs: run.result.warmupDurationMs,
    wallDurationMs: run.result.wallDurationMs,
    cpuUserMs: run.result.cpuUserMs,
    cpuSystemMs: run.result.cpuSystemMs,
    cpuTotalMs: run.result.cpuTotalMs,
    perScan: run.result.perScan,
    profile: run.result.profile,
    attribution: run.attribution || null,
    inclusiveDiagnostic: run.inclusiveDiagnostic || null,
    resolvedModules: run.result.resolvedModules,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mustNotBeInsideRepo(args.out);
  if (fs.existsSync(args.out)) {
    throw new Error(`refusing to overwrite an existing report directory: ${args.out}`);
  }
  const workerPath = path.join(args.sourceRoot, 'scripts', 'lib', 'import-scan-profile-worker.cjs');
  if (!fs.existsSync(workerPath)) {
    throw new Error(`worker not found in the source root (sync it first): ${workerPath}`);
  }
  const harnessPath = path.join(args.sourceRoot, 'scripts', 'measure-desktop-lifecycle.mjs');
  if (!fs.existsSync(harnessPath)) {
    throw new Error(`C1 fixture harness not found in the source root: ${harnessPath}`);
  }

  const startedAt = new Date().toISOString();
  const fixtureRoot = path.join(args.out, 'fixtures');
  const manifest = prepareFixture(fixtureRoot, args.sourceRoot, DEFAULT_SIZES);
  const inventoryBefore = inventoryFixture(fixtureRoot, manifest);
  const expectedDigest = manifest.expectedDigests.S1;
  if (typeof expectedDigest !== 'string') throw new Error('fixture manifest has no S1 digest');

  const rawDir = ensureDir(path.join(args.out, 'raw'));
  // The identity of everything that participates in producing these numbers,
  // captured before the measurement window and re-checked after it. Keyed by
  // the same names the published provenance uses so the two can be compared
  // without a translation table.
  const productionEntryPath = path.join(args.sourceRoot, 'src', 'main', 'data-import.js');
  const provenancePaths = {
    attributionHarness: fileURLToPath(import.meta.url),
    profileWorker: workerPath,
    c1Worker: path.join(args.sourceRoot, 'scripts', 'lib', 'desktop-perf-worker.cjs'),
    c1Harness: harnessPath,
  };
  const hashAll = (paths) => Object.fromEntries(
    Object.entries(paths).map(([name, absolute]) => [name, sha256File(absolute)]),
  );
  const workerHashBefore = sha256File(workerPath);
  const sourceHashesBefore = {
    ...hashAll(provenancePaths),
    production: sha256File(productionEntryPath),
  };
  const provenanceHashesBefore = Object.fromEntries(
    Object.keys(provenancePaths).map((name) => [name, sourceHashesBefore[name]]),
  );

  const runStarted = Date.now();
  const rounds = [];
  const invalidRows = [];
  let stopRun = null;
  let unresolvedProcess = null;

  for (let roundNumber = 1; roundNumber <= args.rounds; roundNumber += 1) {
    const roundRow = { round: roundNumber, control: null, profiled: null };
    for (const mode of MODES) {
      if (stopRun) {
        invalidRows.push({ round: roundNumber, mode, reason: stopRun });
        continue;
      }
      if (Date.now() - runStarted > TOTAL_TIMEOUT_MS) {
        stopRun = 'RUN_TIMEOUT';
        invalidRows.push({ round: roundNumber, mode, reason: stopRun });
        continue;
      }
      const remaining = TOTAL_TIMEOUT_MS - (Date.now() - runStarted);
      const jsonOut = path.join(rawDir, `round-${roundNumber}-${mode}.json`);
      const cpuProfileOut = mode === 'profiled'
        ? path.join(rawDir, `round-${roundNumber}-${mode}.cpuprofile`)
        : '';
      const outcome = await runProfileWorker({
        nodePath: process.execPath,
        workerPath,
        mode,
        fixtureRoot,
        sourceRoot: args.sourceRoot,
        jsonOut,
        cpuProfileOut,
        timeoutMs: Math.min(RUN_TIMEOUT_MS, Math.max(1, remaining)),
        scans: args.scans,
        warmups: args.warmups,
        samplingIntervalMicros: args.samplingIntervalMicros,
      });
      if (outcome.failure === 'UNRESOLVED_PROCESS') {
        unresolvedProcess = { round: roundNumber, mode, workerPid: outcome.workerPid };
        stopRun = 'UNRESOLVED_PROCESS';
        invalidRows.push({ round: roundNumber, mode, reason: stopRun });
        continue;
      }
      const validation = validateProfileRun(outcome, mode, expectedDigest, args.scans, args.warmups, {
        sourceRoot: args.sourceRoot,
        expectedProfilePath: cpuProfileOut,
        samplingIntervalMicros: args.samplingIntervalMicros,
      });
      if (!validation.ok) {
        invalidRows.push({ round: roundNumber, mode, reason: validation.reason });
        if (outcome.failure === 'WORKER_TIMEOUT') stopRun = 'WORKER_TIMEOUT';
        continue;
      }
      const projected = {
        ok: true,
        result: validation.result,
        workerPid: outcome.workerPid,
        terminationConfirmed: outcome.terminationConfirmed === true,
        exitCode: outcome.exitCode,
      };
      if (mode === 'profiled') {
        const raw = JSON.parse(fs.readFileSync(validation.result.profile.path, 'utf8'));
        projected.attribution = parseProfile(raw, args.sourceRoot);
        projected.inclusiveDiagnostic = inclusiveByFunction(raw, projected.attribution);
      }
      roundRow[mode] = projected;
    }
    rounds.push(roundRow);
    if (stopRun === 'UNRESOLVED_PROCESS') break;
  }

  const inventoryAfter = inventoryFixture(fixtureRoot, manifest);
  // Provenance: which profiling modules actually executed, which C1 worker was
  // reused, and which resolved production dependencies were observed. Recorded
  // as hashes captured BEFORE the measurement window, so a module that changed
  // while the run was in flight cannot be published as the one that produced
  // these numbers.
  const executedProfilingModules = Object.fromEntries(
    Object.entries(provenancePaths).map(([name, absolute]) => [
      name,
      { path: absolute, sha256: provenanceHashesBefore[name] },
    ]),
  );
  const resolvedProductionDependencies = [...new Set(
    rounds.flatMap((row) => MODES.flatMap((mode) => (
      (row[mode] && row[mode].result && Array.isArray(row[mode].result.resolvedModules))
        ? row[mode].result.resolvedModules.map((entry) => `${entry.file}=${entry.sha256}`)
        : []
    ))),
  )].sort();
  const sourceHashesAfter = {
    ...hashAll(provenancePaths),
    production: sha256File(productionEntryPath),
  };
  // Final recheck of every dependency named across the required runs. A
  // per-run check proves the file matched at that instant; this proves the
  // identity the report publishes is still the identity on disk.
  const dependencyRecheck = resolvedProductionDependencies.map((record) => {
    const separator = record.lastIndexOf('=');
    const file = separator > 0 ? record.slice(0, separator) : record;
    const recorded = separator > 0 ? record.slice(separator + 1) : null;
    const absolute = path.resolve(args.sourceRoot, ...file.split('/'));
    const insideRoot = absolute.startsWith(`${path.resolve(args.sourceRoot)}${path.sep}`);
    const current = insideRoot ? sha256File(absolute) : null;
    return { file, recorded, current, matches: current !== null && current === recorded };
  });

  const decision = unresolvedProcess
    ? {
      rule: ATTRIBUTION_RULE,
      scanCounts: [],
      profilerOverhead: [],
      unclassified: [],
      rankings: [],
      rankingsAgree: false,
      candidates: [],
      limitations: ['UNRESOLVED_PROCESS'],
      verdict: 'INCONCLUSIVE',
      productionOptimizationAuthorized: false,
      statement: 'Attribution remains inconclusive; no optimization is justified.',
    }
    : decideAttribution(rounds);
  const inputIdentity = {
    executable: process.execPath,
    node: process.version,
    cwd: process.cwd(),
    sourceRoot: args.sourceRoot,
    workerPath,
    hashesBefore: sourceHashesBefore,
    hashesAfter: sourceHashesAfter,
    unchanged: stableStringify(sourceHashesBefore) === stableStringify(sourceHashesAfter),
    fixtureDigestBefore: inventoryBefore.digest,
    fixtureDigestAfter: inventoryAfter.digest,
    fixtureContentUnchanged: inventoryBefore.digest === inventoryAfter.digest,
    dependencyRecheck,
    dependenciesStable: dependencyRecheck.length > 0
      && dependencyRecheck.every((row) => row.matches),
  };

  const report = {
    schemaVersion: 1,
    profile: 'c2-attribution',
    mode: 'MEASUREMENT_ONLY',
    provenance: {
      executedProfilingModules,
      resolvedProductionDependencies,
      reusedC1Worker: 'scripts/lib/desktop-perf-worker.cjs',
      reuseNote: 'The profiled process reuses the C1 fixture builder and case wiring; no production algorithm is reimplemented here.',
    },
    sourceRoot: args.sourceRoot,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    startedAt,
    finishedAt: new Date().toISOString(),
    protocol: {
      rounds: args.rounds,
      modes: MODES,
      warmupsPerProcess: args.warmups,
      scansPerProcess: args.scans,
      samplingIntervalMicros: args.samplingIntervalMicros,
      order: 'control then profiled, sequential, never concurrent',
      profilerWindow: 'ten measured scans only; stopped before projection/digest/oracle/serialization',
      disjointness: 'category shares are self-time based and sum to the attributed total',
    },
    fixture: {
      root: fixtureRoot,
      byteCounts: manifest.byteCounts,
      expectedDigest,
      expectedInventory: inventoryBefore.expected,
      observedInventory: inventoryBefore.observed,
      observedInventoryAfter: inventoryAfter.observed,
    },
    inputIdentity,
    rounds: rounds.map((row) => ({
      round: row.round,
      control: projectRound(row.control),
      profiled: projectRound(row.profiled),
    })),
    invalidRows,
    unresolvedProcess,
    decision,
  };

  const execution = finalizeReport(report);

  ensureDir(args.out);
  fs.writeFileSync(path.join(args.out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(args.out, 'summary.md'), markdownReport(report));
  process.stdout.write(`${JSON.stringify({
    ok: report.execution.ok,
    verdict: decision.verdict,
    candidates: decision.candidates.map((row) => row.category),
    limitations: decision.limitations,
    report: path.join(args.out, 'report.json'),
    summary: path.join(args.out, 'summary.md'),
  }, null, 2)}\n`);
  if (!report.execution.ok) process.exitCode = report.execution.exitCode;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

export {
  ATTRIBUTION_RULE,
  GC_FUNCTION_NAMES,
  MODES,
  RESULT_PREFIX,
  ROUNDS,
  RUN_TIMEOUT_MS,
  SYSTEM_FUNCTION_NAMES,
  TOTAL_TIMEOUT_MS,
  USER_FUNCTION_CATEGORY,
  VERDICTS,
  classifyFrame,
  decideAttribution,
  evaluateExecution,
  executionReasonForInvalidRun,
  finalizeReport,
  inclusiveByFunction,
  markdownReport,
  median,
  parseArgs,
  parseProfile,
  profilerOverhead,
  projectRound,
  round,
  runProfileWorker,
  summarizeSeries,
  summaryMatchesSeries,
  validateProfileStructure,
  validateProfileRun,
};
