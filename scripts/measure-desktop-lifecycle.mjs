#!/usr/bin/env node
/**
 * C1 measurement harness for DSHD host-function hot paths.
 *
 * Measurement-only. This script never changes a production algorithm: it
 * builds synthetic fixtures, launches one worker process per case per batch
 * (sequential, never concurrent), collects the raw samples, applies the
 * thresholds that were recorded before the measurements, and writes a JSON
 * report plus a readable Markdown summary.
 *
 * The harness deliberately does NOT measure the live Electron main thread, IPC
 * round-trip latency, the rendered Files search, full startup or packaging.
 * Those stay NOT MEASURED and must not be read into any result here.
 *
 * Usage:
 *   node scripts/measure-desktop-lifecycle.mjs --profile c1 \
 *     --source-root <candidate> --out <new report dir>
 */

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import worker from './lib/desktop-perf-worker.cjs';

const {
  CASE_IDS,
  CHILD_PREFIX,
  MEASURED_INVOCATIONS,
  RESULT_PREFIX,
  SCHEMA_VERSION: WORKER_SCHEMA_VERSION,
} = worker;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

const BATCH_COUNT = 2;
const WORKER_TIMEOUT_MS = 30_000;
const RUN_TIMEOUT_MS = 180_000;
const TERMINATION_GRACE_MS = 2_000;

const MANY_SMALL_SESSIONS = 1000;
const ONE_LONG_TARGET_BYTES = 8 * 1024 * 1024;
const FILES_SMALL = 100;
const FILES_LARGE = 1000;
const IGNORED_EVERY = 10;

/**
 * Fixture sizes are parameters so the ordinary test suite can build tiny
 * fixtures without paying for the full benchmark, while the CLI always uses the
 * predeclared sizes above.
 */
const DEFAULT_SIZES = {
  manySmallSessions: MANY_SMALL_SESSIONS,
  oneLongTargetBytes: ONE_LONG_TARGET_BYTES,
  filesSmall: FILES_SMALL,
  filesLarge: FILES_LARGE,
  ignoredEvery: IGNORED_EVERY,
};

/**
 * Thresholds recorded BEFORE measurement. These are investigation thresholds
 * for this synthetic workload, not user-facing service-level objectives. They
 * are never adjusted after seeing a result.
 */
const THRESHOLDS = {
  probeImportHold: { metric: 'median', limitMs: 25 },
  scanImport: { metric: 'median', limitMs: 250 },
  listDirSmall: { metric: 'median', limitMs: 100 },
  listDirLarge: { metric: 'median', limitMs: 250 },
};

const BLOCKING_THRESHOLD = { absoluteMs: 50, aboveControlMs: 30 };
const MEMORY_THRESHOLD = {
  rssGrowthBytes: 64 * 1024 * 1024,
  heapGrowthBytes: 32 * 1024 * 1024,
};
const REPEATABILITY = {
  absoluteMs: 5,
  relativeFraction: 0.2,
  madAbsoluteMs: 5,
  madRelativeFraction: 0.2,
};
const CONTROL_CONTAMINATION_MS = 20;

/**
 * Production files whose bytes the measurement depends on. Their hashes are
 * recorded before and after the run so the report can prove which revision was
 * measured. The worker also reports every resolved production dependency it
 * actually loaded, which is the authoritative input list.
 */
const PRODUCTION_FILES = [
  'src/main/data-import.js',
  'src/main/workspace-fs.js',
  'src/main/workspace-authority.js',
  'src/shared/dsh-home.js',
];

const HARNESS_FILES = [
  'scripts/measure-desktop-lifecycle.mjs',
  'scripts/measure-desktop-lifecycle.test.mjs',
  'scripts/lib/desktop-perf-worker.cjs',
];

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function digestOf(value) {
  return `sha256:${crypto.createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function hashFiles(root, files) {
  const rows = {};
  for (const relative of files) {
    rows[relative] = sha256File(path.join(root, relative));
  }
  return rows;
}

function sha256File(file) {
  try {
    return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
  } catch {
    return null;
  }
}

function fileSizeOrNull(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}

/** Read-only Git identity. Never mutates the repository. */
function gitIdentity(root) {
  try {
    const run = (args) => spawnSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    });
    const head = run(['rev-parse', 'HEAD']);
    const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
    const version = run(['--version']);
    return {
      version: version.status === 0 ? version.stdout.trim() : null,
      head: head.status === 0 ? head.stdout.trim() : null,
      branch: branch.status === 0 ? branch.stdout.trim() : null,
      available: head.status === 0,
    };
  } catch {
    return { version: null, head: null, branch: null, available: false };
  }
}

/**
 * Prove the isolated Git configuration actually suppresses operator config for
 * the fixture work tree. This creates no repository, ref or commit; it only
 * asks Git whether it can see an ignore rule in the fixture's own .gitignore.
 */
function gitIgnorePreflight(fixtureRoot, sourceRoot, listings, gitDir) {
  const workspace = listings['files-small'].workspaceRoot;
  const globalConfig = path.join(fixtureRoot, 'git-global-unused');
  const systemConfig = path.join(fixtureRoot, 'git-system-unused');
  const result = spawnSync('git', ['-C', workspace, 'check-ignore', '--no-index', 'ignored_000.txt'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
    env: {
      ...process.env,
      // Mirror the worker exactly: the fixture work tree is paired with the
      // source checkout's read-only Git scaffolding.
      ...(gitDir ? { GIT_DIR: gitDir, GIT_WORK_TREE: workspace } : {}),
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_SYSTEM: systemConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  const isolated = {
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_SYSTEM: systemConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    globalConfigExists: fs.existsSync(globalConfig),
    systemConfigExists: fs.existsSync(systemConfig),
  };
  return {
    workspace,
    gitDir: gitDir || null,
    isolated,
    ignoredRuleRespected: result.status === 0 && String(result.stdout).includes('ignored_000.txt'),
    exitCode: result.status,
    stderrTail: String(result.stderr || '').slice(-500),
    sourceRoot,
  };
}

function mustNotBeInsideRepo(target) {
  const relative = path.relative(REPO_ROOT, path.resolve(target));
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error(`refusing to write inside the source checkout: ${target}`);
  }
}

/**
 * Deterministic session JSONL. Record order matters: the LAST `session/title`
 * line wins, which is exactly what the S2 oracle exercises.
 */
function sessionLogText({ id, cwd, title, createdAt, fillerBytes = 0, finalTitle = '' }) {
  const lines = [JSON.stringify({ type: 'session', id, cwd, createdAt })];
  if (fillerBytes > 0) {
    lines.push(JSON.stringify({
      type: 'message',
      role: 'user',
      content: 'x'.repeat(Math.max(0, fillerBytes)),
    }));
  }
  lines.push(JSON.stringify({ type: 'session/title', data: { title } }));
  if (finalTitle) {
    lines.push(JSON.stringify({ type: 'session/title', data: { title: finalTitle } }));
  }
  return `${lines.join('\n')}\n`;
}

function countJsonlRecords(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0).length;
  } catch {
    return null;
  }
}

function fixtureSessionRow(index) {
  const suffix = String(index).padStart(4, '0');
  return {
    id: `session-${suffix}`,
    cwd: `C:/fixture/workspace-${suffix}`,
    title: `session title ${suffix}`,
  };
}

function buildHomes(fixtureRoot, sizes = DEFAULT_SIZES) {
  const homes = ensureDir(path.join(fixtureRoot, 'homes'));
  const sourceMany = ensureDir(path.join(homes, 'source-many-small', 'sessions'));
  const bytes = { manySmallTotal: 0, manySmallPerLog: null };

  for (let index = 0; index < sizes.manySmallSessions; index += 1) {
    const row = fixtureSessionRow(index);
    const dir = ensureDir(path.join(sourceMany, row.id));
    const text = sessionLogText({
      id: row.id,
      cwd: row.cwd,
      title: row.title,
      createdAt: 1_700_000_000_000 + index,
      fillerBytes: 7 * 1024,
    });
    const buffer = Buffer.from(text, 'utf8');
    writeFileBuffer(path.join(dir, 'session.jsonl'), buffer);
    bytes.manySmallTotal += buffer.length;
  }
  bytes.manySmallPerLog = bytes.manySmallTotal / sizes.manySmallSessions;

  const destPopulated = ensureDir(path.join(homes, 'dest-populated', 'sessions', 'existing-session'));
  writeFileBuffer(
    path.join(destPopulated, 'session.jsonl'),
    Buffer.from(sessionLogText({
      id: 'existing-session',
      cwd: 'C:/fixture/dest',
      title: 'existing dest session',
      createdAt: 1_700_000_000_001,
    }), 'utf8'),
  );

  ensureDir(path.join(homes, 'dest-empty', 'sessions'));
  ensureDir(path.join(homes, 'dest-scan-many-small', 'sessions'));
  ensureDir(path.join(homes, 'dest-scan-one-long', 'sessions'));

  const sourceLong = ensureDir(path.join(homes, 'source-one-long', 'sessions', 'long-session'));
  const longText = sessionLogText({
    id: 'long-session',
    cwd: 'C:/fixture/long',
    title: 'early title',
    createdAt: 1_700_000_000_002,
    fillerBytes: sizes.oneLongTargetBytes,
    finalTitle: 'final title',
  });
  const longBuffer = Buffer.from(longText, 'utf8');
  writeFileBuffer(path.join(sourceLong, 'session.jsonl'), longBuffer);
  bytes.oneLong = longBuffer.length;
  bytes.oneLongRecordCount = longText.split('\n').filter(Boolean).length;
  bytes.manySmallRecordCount = 3;

  ensureDir(path.join(fixtureRoot, 'skills', 'agents'));
  ensureDir(path.join(fixtureRoot, 'skills', 'extra'));
  ensureDir(path.join(fixtureRoot, 'dsh-home'));
  return { bytes };
}

function buildListings(fixtureRoot, sizes = DEFAULT_SIZES) {
  const listingsRoot = ensureDir(path.join(fixtureRoot, 'listings'));
  const report = {};
  const plans = [['files-small', sizes.filesSmall], ['files-large', sizes.filesLarge]];
  for (const [label, count] of plans) {
    // Files live directly in the listed directory so `git check-ignore` is fed
    // paths relative to the same directory its `.gitignore` sits in.
    const workspaceRoot = ensureDir(path.join(listingsRoot, label));
    writeFileBuffer(
      path.join(workspaceRoot, '.gitignore'),
      Buffer.from('ignored_*.txt\nignore-me-too.txt\n', 'utf8'),
    );
    let ignored = 0;
    for (let index = 0; index < count; index += 1) {
      const suffix = String(index).padStart(3, '0');
      const isIgnored = index % sizes.ignoredEvery === 0;
      writeFileBuffer(
        path.join(workspaceRoot, `${isIgnored ? 'ignored' : 'kept'}_${suffix}.txt`),
        Buffer.from(`payload ${suffix}\n`, 'utf8'),
      );
      if (isIgnored) ignored += 1;
    }
    writeFileBuffer(path.join(workspaceRoot, 'ignore-me-too.txt'), Buffer.from('ignored\n', 'utf8'));
    report[label] = {
      workspaceRoot,
      fileCount: count + 2,
      ignoredCount: ignored + 1,
      visibleCount: count - ignored + 1,
    };
  }
  return report;
}

/**
 * Expected digests are computed through the SAME projection function the worker
 * uses, so the oracle cannot drift from the expectation. The expected values
 * themselves are stated literally here.
 */
function expectedDigests(sizes = DEFAULT_SIZES) {
  const many = Array.from({ length: sizes.manySmallSessions }, (_, index) => {
    const row = fixtureSessionRow(index);
    return {
      id: row.id,
      cwd: row.cwd,
      title: row.title,
      createdAt: String(1_700_000_000_000 + index),
      compressedLog: false,
    };
  });
  const visible = (count) => {
    // `.gitignore` is an ordinary visible entry: it is not named `.git`, so the
    // production filter keeps it. Ordering is the production sort (locale order).
    const rows = [{ name: '.gitignore', kind: 'file' }];
    for (let index = 0; index < count; index += 1) {
      if (index % sizes.ignoredEvery === 0) continue;
      rows.push({ name: `kept_${String(index).padStart(3, '0')}.txt`, kind: 'file' });
    }
    return rows;
  };
  return {
    P1: digestOf({ destEmpty: true, sourceHasData: true, hold: true }),
    P2: digestOf({ destEmpty: false, sourceHasData: false, hold: false }),
    S1: digestOf({ count: sizes.manySmallSessions, sessions: many }),
    S2: digestOf({
      count: 1,
      sessions: [{
        id: 'long-session',
        cwd: 'C:/fixture/long',
        title: 'final title',
        createdAt: '1700000000002',
        compressedLog: false,
      }],
    }),
    F1: digestOf({ ok: true, entries: visible(sizes.filesSmall) }),
    F2: digestOf({ ok: true, entries: visible(sizes.filesLarge) }),
  };
}

function inventoryFixture(fixtureRoot, manifest) {
  const dirs = [
    ['sourceManySmall', path.join(fixtureRoot, 'homes', 'source-many-small', 'sessions')],
    ['sourceOneLong', path.join(fixtureRoot, 'homes', 'source-one-long', 'sessions')],
    ['destPopulated', path.join(fixtureRoot, 'homes', 'dest-populated', 'sessions')],
    ['destScanManySmall', path.join(fixtureRoot, 'homes', 'dest-scan-many-small', 'sessions')],
    ['destScanOneLong', path.join(fixtureRoot, 'homes', 'dest-scan-one-long', 'sessions')],
    ['filesSmall', path.join(fixtureRoot, 'listings', 'files-small')],
    ['filesLarge', path.join(fixtureRoot, 'listings', 'files-large')],
  ];
  const rows = {};
  for (const [label, dir] of dirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      entries = [];
    }
    const files = [];
    for (const entry of entries.sort()) {
      const file = path.join(dir, entry);
      let stat = null;
      try {
        stat = fs.statSync(file);
      } catch {
        stat = null;
      }
      if (!stat) continue;
      if (stat.isDirectory()) {
        const nested = path.join(file, 'session.jsonl');
        files.push({
          entry,
          kind: 'directory',
          innerFile: 'session.jsonl',
          sizeBytes: fileSizeOrNull(nested),
          sha256: sha256File(nested),
          recordCount: countJsonlRecords(nested),
        });
      } else {
        files.push({
          entry,
          kind: 'file',
          sizeBytes: stat.size,
          sha256: sha256File(file),
          recordCount: entry.endsWith('.jsonl') ? countJsonlRecords(file) : null,
        });
      }
    }
    rows[label] = { dir, entries: entries.length, files };
  }
  const longLog = path.join(fixtureRoot, 'homes', 'source-one-long', 'sessions', 'long-session', 'session.jsonl');
  const expected = {
    sourceManySmallEntries: manifest.cases.S1.sessions,
    filesSmallEntries: manifest.cases.F1.files,
    filesLargeEntries: manifest.cases.F2.files,
    oneLongBytes: manifest.byteCounts.oneLongBytes,
    oneLongRecordCount: manifest.byteCounts.oneLongRecordCount,
    // `byteCounts.manySmallRecordCount` is the per-log count; the observed
    // value sums that over every session directory.
    manySmallRecordCount: manifest.cases.S1.sessions * manifest.byteCounts.manySmallRecordCount,
  };
  const observed = {
    sourceManySmallEntries: rows.sourceManySmall.entries,
    filesSmallEntries: rows.filesSmall.entries,
    filesLargeEntries: rows.filesLarge.entries,
    oneLongBytes: fileSizeOrNull(longLog),
    oneLongRecordCount: countJsonlRecords(longLog),
    // Derived from the files, not copied from the manifest, so a same-length
    // edit cannot masquerade as an unchanged fixture.
    manySmallRecordCount: rows.sourceManySmall.files.reduce(
      (sum, row) => sum + (Number.isFinite(row.recordCount) ? row.recordCount : 0),
      0,
    ),
  };
  return {
    expected,
    observed,
    rows,
    digest: `sha256:${crypto.createHash('sha256').update(stableStringify(rows)).digest('hex')}`,
  };
}

/**
 * Fixtures must be created in a location this run owns. `prepareFixture()`
 * therefore refuses an existing fixture root instead of clearing it: removing a
 * pre-existing directory would risk destroying input the operator supplied.
 */
function prepareFixture(fixtureRoot, sourceRoot, sizes = DEFAULT_SIZES) {
  mustNotBeInsideRepo(fixtureRoot);
  if (fs.existsSync(fixtureRoot)) {
    throw new Error(
      `refusing to reuse an existing fixture root (use a new out directory): ${fixtureRoot}`,
    );
  }
  ensureDir(fixtureRoot);
  const homes = buildHomes(fixtureRoot, sizes);
  const listings = buildListings(fixtureRoot, sizes);
  const manifest = {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    sourceRoot,
    fixtureRoot,
    // F cases run `git check-ignore` through the source tree's own Git
    // scaffolding, read-only. No repository is created and no ref is touched.
    gitDir: fs.existsSync(path.join(sourceRoot, '.git'))
      ? path.join(sourceRoot, '.git')
      : null,
    expectedDigests: expectedDigests(sizes),
    cases: {
      P1: { fixture: 'source-many-small -> dest-empty', sessions: sizes.manySmallSessions },
      P2: { fixture: 'source-many-small -> dest-populated', sessions: sizes.manySmallSessions },
      S1: { fixture: 'source-many-small -> dest-scan-many-small', sessions: sizes.manySmallSessions },
      S2: { fixture: 'source-one-long -> dest-scan-one-long', sessions: 1 },
      F1: { fixture: 'listings/files-small', files: listings['files-small'].fileCount },
      F2: { fixture: 'listings/files-large', files: listings['files-large'].fileCount },
    },
    byteCounts: {
      manySmallTotalBytes: homes.bytes.manySmallTotal,
      manySmallPerLogBytes: round(homes.bytes.manySmallPerLog, 1),
      oneLongBytes: homes.bytes.oneLong,
      oneLongRecordCount: homes.bytes.oneLongRecordCount,
      manySmallRecordCount: homes.bytes.manySmallRecordCount,
    },
    listings,
  };
  fs.writeFileSync(path.join(fixtureRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function caseOrderForBatch(batchIndex) {
  return batchIndex === 0 ? [...CASE_IDS] : [...CASE_IDS].reverse();
}

/** Hard ceiling on bytes a single worker may write to one pipe. */
const MAX_CAPTURED_OUTPUT = 1_000_000;

function appendBounded(current, chunk) {
  if (current.length >= MAX_CAPTURED_OUTPUT) return current;
  return `${current}${chunk.toString('utf8')}`.slice(-MAX_CAPTURED_OUTPUT);
}

/**
 * Task-owned child lifecycle ledger.
 *
 * The worker announces each spawned child immediately and each close later. A
 * historical announcement is NOT authorization to signal a PID: by the time a
 * timeout fires, an earlier invocation's child may have exited and its PID may
 * have been reassigned. The ledger therefore keeps per-child state and only
 * ever exposes children whose current ownership is still open.
 */
function createChildLedger() {
  const children = new Map();
  let pending = '';

  const applyRecord = (record) => {
    // A PID must be a positive integer to be actionable or even comparable.
    if (!record || !Number.isInteger(record.pid) || record.pid <= 0) return;
    const closed = record.exitCode !== undefined
      || record.signal !== undefined
      || record.durationMs !== undefined;
    const entry = children.get(record.pid) || {
      pid: record.pid,
      command: record.command || null,
      state: 'open',
      spawnAnnouncements: 0,
      closeAnnouncements: 0,
      exitCode: null,
      signal: null,
      durationMs: null,
    };
    if (record.command) entry.command = record.command;
    if (closed) {
      entry.closeAnnouncements += 1;
      entry.exitCode = record.exitCode ?? null;
      entry.signal = record.signal ?? null;
      entry.durationMs = record.durationMs ?? null;
      entry.state = 'closed';
    } else {
      entry.spawnAnnouncements += 1;
      // A later spawn announcement for the same PID is a new process.
      entry.state = 'open';
    }
    children.set(record.pid, entry);
  };

  const consume = (text) => {
    pending += text;
    let newline = pending.indexOf('\n');
    while (newline !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/, '');
      pending = pending.slice(newline + 1);
      if (line.startsWith(CHILD_PREFIX)) {
        try {
          applyRecord(JSON.parse(line.slice(CHILD_PREFIX.length)));
        } catch {
          // A torn announcement is dropped rather than guessed at.
        }
      }
      newline = pending.indexOf('\n');
    }
  };

  return {
    consume,
    snapshot: () => [...children.values()].map((entry) => ({ ...entry })),
    openChildren: () => [...children.values()].filter((entry) => entry.state === 'open'),
    closedChildren: () => [...children.values()].filter((entry) => entry.state === 'closed'),
  };
}

/**
 * Existence probe with a tri-state answer. Only a positive liveness answer is
 * "alive" and only a definitive ESRCH is "absent"; anything else is unknown and
 * must never be converted into confirmation that a process is gone.
 */
function probeProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { pid, status: 'absent', error: null, detail: 'invalid-pid' };
  }
  try {
    process.kill(pid, 0);
    return { pid, status: 'alive', error: null, detail: null };
  } catch (error) {
    // ESRCH ("no such process") is the only definitive absence signal. EPERM
    // means the PID exists but is not ours to signal, so it stays alive.
    if (error && error.code === 'EPERM') {
      return { pid, status: 'alive', error: 'EPERM', detail: 'not-ours-to-signal' };
    }
    if (error && error.code === 'ESRCH') {
      return { pid, status: 'absent', error: null, detail: 'esrch' };
    }
    return {
      pid,
      status: 'unknown',
      error: error && error.code ? error.code : String(error),
      detail: error && error.message ? error.message : null,
    };
  }
}

/**
 * Backwards-compatible boolean view: true only for a positive liveness answer,
 * false for a confirmed absence or an invalid PID, and null when the probe
 * could not determine existence. Callers that make cleanup claims must use
 * probeProcess/survivingChildren rather than treating null as gone.
 */
function processAlive(pid) {
  const probe = probeProcess(pid);
  if (probe.status === 'alive') return true;
  if (probe.status === 'absent') return false;
  return null;
}

/**
 * A timeout or an unconfirmed termination stops the run. Returning the reason
 * from one place keeps the loop from treating "worker died at its deadline" as
 * an ordinary invalid row and marching on to the next case.
 */
function stopReasonFor(outcome) {
  if (!outcome) return null;
  if (outcome.failure === 'WORKER_TIMEOUT' || outcome.failure === 'RUN_TIMEOUT') {
    return 'WORKER_TIMEOUT';
  }
  if (outcome.failure === 'UNRESOLVED_PROCESS') return 'UNRESOLVED_PROCESS';
  return null;
}

/**
 * The persisted identity of the worker actually launched. Termination facts are
 * copied from what was observed, never reconstructed from the failure name, and
 * the spawned PID survives even when no final payload was ever printed.
 */
function workerIdentityFor(outcome, workerPath, workerSha256) {
  return {
    pid: outcome && outcome.workerPid != null ? outcome.workerPid : null,
    path: workerPath,
    sha256: workerSha256,
    exitCode: outcome && outcome.exitCode != null ? outcome.exitCode : null,
    signal: (outcome && outcome.signal) || null,
    terminated: Boolean(outcome && outcome.terminationConfirmed === true),
    workerExitConfirmed: Boolean(outcome && outcome.workerExitConfirmed === true),
    workerKill: (outcome && outcome.workerKill) || null,
    signalAttempts: (outcome && outcome.signalAttempts) || null,
    unresolvedChildren: (outcome && outcome.unresolvedChildren) || [],
    unresolvedWorker: (outcome && outcome.unresolvedWorker) || [],
    requestedFailure: (outcome && outcome.requestedFailure) || null,
    // A post-spawn error (for example a failed kill) is preserved as evidence
    // next to, never instead of, the observed termination facts.
    workerError: (outcome && outcome.workerError) || null,
    timedOut: Boolean(outcome && outcome.timedOut === true),
    childProcesses: outcome && Array.isArray(outcome.children) ? outcome.children : [],
  };
}

/** One persisted case row, preserving the observed termination evidence. */
function persistedCaseRow(row) {
  if (row.ok && row.payload) {
    return {
      case: row.case,
      ok: true,
      worker: row.worker || null,
      result: row.payload.result,
    };
  }
  return {
    case: row.case,
    ok: false,
    worker: row.worker || null,
    failure: row.failure || 'WORKER_FAILED',
    failureDetail: row.failureDetail || null,
    requestedFailure: row.requestedFailure || null,
    exitCode: row.exitCode ?? null,
    signal: row.signal ?? null,
    timedOut: row.timedOut === true,
    terminationConfirmed: row.terminationConfirmed === true,
    workerExitConfirmed: row.workerExitConfirmed === true,
    workerKill: row.workerKill || null,
    workerError: row.workerError || null,
    signalAttempts: row.signalAttempts || null,
    unresolvedChildren: Array.isArray(row.unresolvedChildren) ? row.unresolvedChildren : [],
    unresolvedWorker: Array.isArray(row.unresolvedWorker) ? row.unresolvedWorker : [],
    childProcesses: Array.isArray(row.children) ? row.children : [],
    timeoutMs: row.timeoutMs ?? null,
    stdoutTail: row.stdout ? row.stdout.slice(-1500) : null,
    stderrTail: row.stderr ? row.stderr.slice(-1500) : null,
  };
}

/**
 * Single decision point for how one case outcome controls the rest of the run.
 * A timeout closes the remaining cases as invalid; an unconfirmed termination is
 * fatal and must end the run immediately so nothing else is launched while a
 * PID of unknown ownership is still alive.
 */
function runControlAfter(outcome) {
  const reason = stopReasonFor(outcome);
  if (!reason) return { stop: false, fatal: false, reason: null };
  return { stop: true, fatal: reason === 'UNRESOLVED_PROCESS', reason };
}

/**
 * Signal only children whose CURRENT ownership is still open. A closed
 * announcement is history: that PID may already belong to another process, so
 * it is never a kill target. Each attempt is recorded separately from the
 * OS-level confirmation that the PID is actually gone. The signal function is
 * injectable so the ownership rule can be probed without real processes.
 */
function signalOpenChildren(ledger, signalProcess = process.kill.bind(process)) {
  const attempts = [];
  for (const entry of ledger.openChildren()) {
    const attempt = {
      pid: entry.pid,
      command: entry.command,
      signaled: false,
      error: null,
    };
    try {
      signalProcess(entry.pid, 'SIGKILL');
      attempt.signaled = true;
    } catch (error) {
      attempt.error = error && error.code ? error.code : String(error);
    }
    attempts.push(attempt);
  }
  return attempts;
}

/**
 * The set of owned children that are NOT confirmed absent. Unknown probe
 * results count as unresolved: only a definitive absence lets cleanup claim
 * confirmation. The probe is injectable and may return a boolean (`true`
 * alive, `false` absent), a status string, a probe record from probeProcess,
 * or the tri-state result of processAlive; anything else (including a thrown
 * error or `null`) is unknown and therefore unresolved.
 */
function normalizeProbeResult(value) {
  if (value === true || value === 'alive') return 'alive';
  if (value === false || value === 'absent') return 'absent';
  if (value && typeof value === 'object' && typeof value.status === 'string') {
    return value.status;
  }
  if (value === null || value === undefined || value === 'unknown') return 'unknown';
  return 'unknown';
}

function survivingChildren(ledger, probeAlive = processAlive) {
  const unresolved = [];
  for (const entry of ledger.openChildren()) {
    let status;
    try {
      status = normalizeProbeResult(probeAlive(entry.pid));
    } catch {
      status = 'unknown';
    }
    if (status !== 'absent') unresolved.push(entry.pid);
  }
  return unresolved;
}

/**
 * Schema check for one worker result. A success-shaped payload can still be
 * wrong: wrong case, wrong schema, missing samples, a zero exit code that is not
 * zero, or a digest that does not match the fixture oracle all fail here.
 */
function validateWorkerResult(outcome, caseId, expectedDigest) {
  const reject = (failure, detail) => ({ ok: false, failure, detail: detail || null });
  if (outcome.exitCode !== 0) {
    return reject('NONZERO_EXIT', {
      exitCode: outcome.exitCode,
      signal: outcome.signal || null,
      stderrTail: outcome.stderr ? outcome.stderr.slice(-1000) : null,
    });
  }
  const payload = outcome.payload;
  if (!payload || typeof payload !== 'object') return reject('MALFORMED_PAYLOAD', null);
  if (payload.schemaVersion !== WORKER_SCHEMA_VERSION) {
    return reject('SCHEMA_MISMATCH', { expected: WORKER_SCHEMA_VERSION, observed: payload.schemaVersion });
  }
  if (payload.case !== caseId) return reject('CASE_MISMATCH', { expected: caseId, observed: payload.case });
  const result = payload.result;
  if (!result || typeof result !== 'object') return reject('MISSING_RESULT', null);
  if (result.case !== caseId) return reject('CASE_MISMATCH', { expected: caseId, observed: result.case });
  if (result.ok !== true) return reject('CORRECTNESS_FAILURE', { failurePhase: result.failurePhase || null });
  if (typeof result.projectionDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(result.projectionDigest)) {
    return reject('MISSING_DIGEST', null);
  }
  if (expectedDigest && result.projectionDigest !== expectedDigest) {
    return reject('DIGEST_MISMATCH', { expected: expectedDigest, observed: result.projectionDigest });
  }
  const measured = result.measured;
  if (!measured || typeof measured !== 'object') return reject('MISSING_SAMPLES', null);
  if (measured.count !== MEASURED_INVOCATIONS) {
    return reject('WRONG_SAMPLE_COUNT', { expected: MEASURED_INVOCATIONS, observed: measured.count });
  }
    const durations = measured.durationMs && measured.durationMs.samples;
    if (!Array.isArray(durations) || durations.length !== MEASURED_INVOCATIONS
      || !durations.every((value) => Number.isFinite(value))) {
      return reject('MISSING_SAMPLES', { observed: Array.isArray(durations) ? durations.length : null });
    }
  // The decision must consume raw elapsed time; require the worker to say so
  // and reject a payload whose authoritative series is mislabeled.
  if (measured.authoritativeDurationSeries !== 'rawDurationMs') {
    return reject('DURATION_SERIES_MISLABELED', {
      observed: measured.authoritativeDurationSeries || null,
    });
  }
  const maxLateness = measured.heartbeatMaxLatenessMs && measured.heartbeatMaxLatenessMs.samples;
  if (!Array.isArray(maxLateness) || maxLateness.length !== MEASURED_INVOCATIONS) {
    return reject('MISSING_HEARTBEAT', null);
  }
  const controls = result.controls;
  if (!controls || typeof controls !== 'object'
    || typeof controls.detected !== 'boolean'
    || !Array.isArray(controls.outcomes) || controls.outcomes.length < 2) {
    return reject('MISSING_CALIBRATION', null);
  }
  const memory = result.memory;
  if (!memory || memory.protocol !== 'per-invocation-post-yield-growth'
    || !Array.isArray(memory.observations) || memory.observations.length !== MEASURED_INVOCATIONS) {
    return reject('MISSING_MEMORY', null);
  }
  for (const observation of memory.observations) {
    if (!observation || typeof observation !== 'object'
      || !observation.afterInvocationBytes || !observation.postYieldBytes
      || !Number.isFinite(observation.afterInvocationBytes.rssBytes)
      || !Number.isFinite(observation.postYieldBytes.rssBytes)
      || !Number.isFinite(observation.afterInvocationBytes.heapUsedBytes)
      || !Number.isFinite(observation.postYieldBytes.heapUsedBytes)) {
      return reject('MALFORMED_MEMORY', null);
    }
  }
  return { ok: true, failure: null, detail: null };
}

function runWorker({
  nodePath,
  workerPath,
  caseId,
  fixtureRoot,
  sourceRoot,
  jsonOut,
  timeoutMs,
  expectedDigest,
}, dependencies = {}) {
  // The dependency seam exists so the real completion path can be exercised
  // without real unrelated processes: spawn, existence probing and timers are
  // all injectable, while production calls the defaults.
  const spawnWorker = dependencies.spawnWorker || spawn;
  const probeAsync = dependencies.probeAsync
    || ((pid) => {
      const probe = process.kill.bind(process);
      try {
        probe(pid, 0);
        return { pid, status: 'alive' };
      } catch (error) {
        if (error && error.code === 'EPERM') return { pid, status: 'alive', error: 'EPERM' };
        if (error && error.code === 'ESRCH') return { pid, status: 'absent' };
        return { pid, status: 'unknown', error: error && error.code ? error.code : String(error) };
      }
    });
  const schedule = dependencies.setTimeout || setTimeout;
  const cancel = dependencies.clearTimeout || clearTimeout;
  const now = dependencies.now || Date.now;
  const signalProcess = dependencies.signal || process.kill.bind(process);
  return new Promise((resolve) => {
    const ledger = createChildLedger();
    const workerProcess = { pid: null };
    const child = spawnWorker(nodePath, [
      workerPath,
      '--case', caseId,
      '--fixture', fixtureRoot,
      '--source-root', sourceRoot,
      '--json-out', jsonOut,
    ], {
      cwd: sourceRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Isolate Git configuration so an ignore result cannot depend on the
        // operator's global/system config. No repository is created here.
        GIT_CONFIG_GLOBAL: path.join(fixtureRoot, 'git-global-unused'),
        GIT_CONFIG_SYSTEM: path.join(fixtureRoot, 'git-system-unused'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    workerProcess.pid = Number.isInteger(child.pid) ? child.pid : null;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    let killTimer = null;
    let timedOut = false;
    let signalAttempts = null;
    // Two independent facts. Neither one alone is allowed to mean "cleanup
    // finished": the worker must be observed gone AND every tracked child must
    // be confirmed absent (known-closed counts as absent by construction).
    let workerExitConfirmed = false;
    let killAttempt = null;
    // A post-spawn `error` event (for example "the process could not be
    // killed") is evidence, not an outcome. Only a creation failure with no
    // PID may finish as SPAWN_ERROR; otherwise the shared completion check
    // keeps owning the result.
    let workerError = null;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer !== null) cancel(timer);
      if (killTimer !== null) cancel(killTimer);
      resolve(value);
    };

    const workerOutcome = (failure, extra = {}) => ({
      case: caseId,
      ok: false,
      failure,
      workerPid: workerProcess.pid,
      ...extra,
      workerError,
      stdout: stdout.slice(-MAX_CAPTURED_OUTPUT),
      stderr: stderr.slice(-MAX_CAPTURED_OUTPUT),
    });

    // Closed children are history, never kill targets. The attempt list is
    // separate from the OS-level termination confirmation below.
    const signalChildren = () => {
      signalAttempts = signalOpenChildren(ledger, signalProcess);
      return signalAttempts;
    };

    /**
     * The single completion condition used by BOTH the timeout path and the
     * post-exit cleanup path: worker exit observed AND every tracked child
     * either known-closed or confirmed absent. A signal attempt, a missing
     * child list, or an unanswered probe never substitutes for that.
     */
    const settleWhenTerminated = (failure) => {
      const deadline = now() + TERMINATION_GRACE_MS;
      const check = () => {
        if (settled) return;
        const unresolvedChildren = survivingChildren(ledger, probeAsync);
        const unresolvedWorker = workerExitConfirmed ? [] : [workerProcess.pid];
        if (workerExitConfirmed && unresolvedChildren.length === 0) {
          finish(workerOutcome(failure, {
            killed: true,
            timedOut,
            children: ledger.snapshot(),
            signalAttempts,
            workerExitConfirmed: true,
            workerKill: killAttempt,
            unresolvedChildren: [],
            unresolvedWorker: [],
            terminationConfirmed: true,
            workerError,
          }));
          return;
        }
        if (now() >= deadline) {
          // Something is still alive or still unknown. The caller stops the run
          // and keeps the fixtures for inspection; the original failure reason
          // is preserved separately rather than overwritten.
          finish(workerOutcome('UNRESOLVED_PROCESS', {
            killed: true,
            timedOut,
            children: ledger.snapshot(),
            signalAttempts,
            workerExitConfirmed,
            workerKill: killAttempt,
            unresolvedChildren,
            unresolvedWorker: unresolvedWorker.filter((pid) => Number.isInteger(pid) && pid > 0),
            terminationConfirmed: false,
            requestedFailure: failure,
            workerError,
          }));
          return;
        }
        killTimer = schedule(check, 25);
      };
      check();
    };

    const terminate = () => {
      signalChildren();
      // Claim the attempt BEFORE calling kill(): Node may emit `error`
      // synchronously from kill(), and the handler must be able to attach the
      // failure to this attempt instead of treating it as a creation failure.
      killAttempt = { attempted: true, signaled: false, error: null };
      try {
        const signaled = child.kill('SIGKILL');
        // A false return means the signal was not delivered. It is recorded as
        // an attempt, not as the worker having exited.
        killAttempt.signaled = signaled === true;
      } catch (error) {
        // A throw or a false return is recorded, never treated as the worker
        // having exited: only the spawn handle's close event establishes that.
        killAttempt.error = error && error.code ? error.code : String(error);
      }
      settleWhenTerminated('WORKER_TIMEOUT');
    };

    timer = schedule(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk);
      ledger.consume(chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });
    child.on('error', (error) => {
      const code = error && error.code ? error.code : String(error);
      const message = error && error.message ? error.message : String(error);
      workerError = { code, message };
      if (workerProcess.pid === null) {
        // Genuine creation failure: there is no process to signal or observe,
        // so this stays a bounded SPAWN_ERROR with no termination claim.
        finish({
          case: caseId,
          ok: false,
          failure: 'SPAWN_ERROR',
          exitCode: null,
          error: message,
          workerPid: null,
          workerError,
          workerKill: null,
          signalAttempts: null,
          unresolvedChildren: [],
          unresolvedWorker: [],
          childProcesses: [],
          children: [],
          terminationConfirmed: false,
        });
        return;
      }
      // The worker exists. Never finish here: an error emitted by kill() must
      // not short-circuit settleWhenTerminated(), and it must not trigger a
      // second terminate() (which would recurse through kill()).
      if (killAttempt && killAttempt.attempted && !killAttempt.error) {
        killAttempt.error = code;
      }
    });
    child.on('close', (code, signal) => {
      workerExitConfirmed = true;
      if (settled) return;
      // The worker exited, but an announced child may still be alive. A dead
      // parent says nothing about its own children, so check before accepting
      // the case and keep the uncertainty explicit if one survives.
      const survivors = survivingChildren(ledger, probeAsync);
      if (survivors.length > 0) {
        signalChildren();
        // Route through the same completion check, including while timed out:
        // the grace-period observer must not be cleared early just because the
        // worker itself is gone.
        settleWhenTerminated(timedOut ? 'WORKER_TIMEOUT' : 'UNRESOLVED_PROCESS');
        return;
      }
      if (timedOut) {
        settleWhenTerminated('WORKER_TIMEOUT');
        return;
      }
      const base = {
        case: caseId,
        workerPid: workerProcess.pid,
        exitCode: code,
        signal: signal || null,
        timedOut,
        children: ledger.snapshot(),
        signalAttempts,
        workerExitConfirmed: true,
        workerKill: killAttempt,
        unresolvedChildren: [],
        unresolvedWorker: [],
        terminationConfirmed: true,
        workerError,
        timeoutMs,
        stdout: stdout.slice(-MAX_CAPTURED_OUTPUT),
        stderr: stderr.slice(-MAX_CAPTURED_OUTPUT),
      };
      const line = stdout.split(/\r?\n/).find((row) => row.startsWith(RESULT_PREFIX));
      if (!line) {
        finish({ ...base, ok: false, failure: 'MALFORMED_OUTPUT' });
        return;
      }
      let payload;
      try {
        payload = JSON.parse(line.slice(RESULT_PREFIX.length));
      } catch (error) {
        finish({ ...base, ok: false, failure: 'MALFORMED_JSON', error: error.message });
        return;
      }
      const validation = validateWorkerResult({ payload, exitCode: code }, caseId, expectedDigest);
      finish({
        ...base,
        ok: validation.ok,
        failure: validation.failure,
        failureDetail: validation.detail,
        payload,
      });
    });
  });
}

function thresholdForCase(caseId) {
  if (caseId === 'P1' || caseId === 'P2') return THRESHOLDS.probeImportHold;
  if (caseId === 'S1' || caseId === 'S2') return THRESHOLDS.scanImport;
  if (caseId === 'F1') return THRESHOLDS.listDirSmall;
  return THRESHOLDS.listDirLarge;
}

function caseResultIn(batch, caseId) {
  return batch.find((row) => row.case === caseId);
}

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
 * Recompute every statistic the decision uses directly from the published
 * samples. The decision never trusts a pre-computed median, so a worker that
 * publishes consistent-looking summaries over inconsistent samples fails.
 */
function recomputeSeries(samples) {
  const series = Array.isArray(samples) ? samples.filter((row) => Number.isFinite(row)) : [];
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

/**
 * Apply the predeclared thresholds. A latency case breaches only when BOTH
 * batches exceed the same threshold AND the case's own repeatability gate
 * passes. The repeatability gate is applied to the metric that triggered the
 * recommendation: the S1 blocking series, not only the 250 ms duration series.
 */
function decide(batches, calibration, options = {}) {
  const expectedBatches = options.expectedBatches || BATCH_COUNT;
  const expectedSamples = options.expectedSamples || MEASURED_INVOCATIONS;
  const integrity = {
    batchCountOk: Array.isArray(batches) && batches.length === expectedBatches,
    invalidRows: [],
    invalidCalibrations: [],
    invalidInputs: [],
  };

  const table = [];
  for (const caseId of CASE_IDS) {
    const threshold = thresholdForCase(caseId);
    const rows = [];
    for (let index = 0; index < expectedBatches; index += 1) {
      rows.push(Array.isArray(batches[index]) ? caseResultIn(batches[index], caseId) : undefined);
    }
    const validRows = [];
    for (const [index, row] of rows.entries()) {
      if (!row) {
        integrity.invalidRows.push({ caseId, batch: index + 1, reason: 'MISSING_CASE' });
        continue;
      }
      if (row.ok !== true || !row.payload || !row.payload.result) {
        integrity.invalidRows.push({
          caseId,
          batch: index + 1,
          reason: row.failure || 'INVALID_RESULT',
        });
        continue;
      }
      const result = row.payload.result;
      if (result.ok !== true) {
        integrity.invalidRows.push({ caseId, batch: index + 1, reason: result.failure || 'CORRECTNESS_FAILURE' });
        continue;
      }
      if (result.expectedDigest && result.projectionDigest !== result.expectedDigest) {
        integrity.invalidRows.push({ caseId, batch: index + 1, reason: 'DIGEST_MISMATCH' });
        continue;
      }
      // Every series the decision reads must be complete and finite. A short or
      // padded series would let a missing sample look like a fast one.
      const measured = result.measured;
      const memory = result.memory;
      const completeSeries = (samples) => Array.isArray(samples)
        && samples.length === expectedSamples
        && samples.every((value) => Number.isFinite(value));
      const samplesComplete = measured && memory
        && completeSeries(measured.durationMs && measured.durationMs.samples)
        && completeSeries(measured.heartbeatMaxLatenessMs && measured.heartbeatMaxLatenessMs.samples)
        && completeSeries(memory.rssGrowthBytes && memory.rssGrowthBytes.samples)
        && completeSeries(memory.heapGrowthBytes && memory.heapGrowthBytes.samples)
        && Array.isArray(memory.observations)
        && memory.observations.length === expectedSamples;
      if (!samplesComplete) {
        integrity.invalidRows.push({ caseId, batch: index + 1, reason: 'INCOMPLETE_SAMPLES' });
        continue;
      }
      const controls = result.controls;
      if (!controls || controls.detected !== true
        || !Array.isArray(controls.outcomes) || controls.outcomes.length < 2) {
        integrity.invalidRows.push({
          caseId,
          batch: index + 1,
          reason: controls && controls.detected === false ? 'CALIBRATION_NOT_DETECTED' : 'CALIBRATION_UNAVAILABLE',
        });
        integrity.invalidCalibrations.push({ caseId, batch: index + 1, controls });
        continue;
      }
      // A missing or non-finite control maximum must invalidate the row: the
      // contamination check cannot silently skip an unobserved control.
      const noWorkMax = controls.noWork ? controls.noWork.maxLatenessMs : null;
      if (!Number.isFinite(noWorkMax)) {
        integrity.invalidRows.push({ caseId, batch: index + 1, reason: 'MISSING_CONTROL_MAXIMUM' });
        continue;
      }
      // Growth must be derivable from the published endpoints. Published
      // summaries are only accepted when they agree with those endpoints.
      const baseline = memory.afterLoadBytes;
      const memoryConsistent = baseline
        && Number.isFinite(baseline.rssBytes) && Number.isFinite(baseline.heapUsedBytes)
        && memory.observations.every((row) => (
          Number.isFinite(row.postYieldBytes.rssBytes)
          && Number.isFinite(row.postYieldBytes.heapUsedBytes)
        ));
      if (!memoryConsistent) {
        integrity.invalidRows.push({ caseId, batch: index + 1, reason: 'MALFORMED_MEMORY_ENDPOINTS' });
        continue;
      }
      const derivedRss = memory.observations.map(
        (row) => row.postYieldBytes.rssBytes - baseline.rssBytes,
      );
      const derivedHeap = memory.observations.map(
        (row) => row.postYieldBytes.heapUsedBytes - baseline.heapUsedBytes,
      );
      const agrees = (published, derived) => (
        !published || published.samples.length !== derived.length
        || published.samples.every((value, sampleIndex) => Math.abs(value - derived[sampleIndex]) <= 1)
      );
      if (!agrees(memory.rssGrowthBytes, derivedRss) || !agrees(memory.heapGrowthBytes, derivedHeap)) {
        integrity.invalidRows.push({ caseId, batch: index + 1, reason: 'INCONSISTENT_MEMORY_SERIES' });
        continue;
      }
      result.memory.derivedRssGrowthBytes = derivedRss;
      result.memory.derivedHeapGrowthBytes = derivedHeap;
      validRows.push({ batch: index + 1, row, result });
    }

    const durations = validRows.map(({ result }) => recomputeSeries(result.measured.durationMs.samples));
    const durationMads = durations.map((series) => series.mad);
    const controlMaxima = validRows.map(({ result }) => result.controls.noWork.maxLatenessMs);
    const blocking = validRows.map(({ result }) => recomputeSeries(result.measured.heartbeatMaxLatenessMs.samples));
    // Preregistered statistic: median of the per-invocation window maxima.
    // The raw maxima are kept as diagnostics only.
    const blockingMedians = blocking.map((series) => series.median);
    const blockingMaxima = blocking.map((series) => series.max);
    const rssGrowthSeries = validRows.map(({ result }) => result.memory.derivedRssGrowthBytes);
    const heapGrowthSeries = validRows.map(({ result }) => result.memory.derivedHeapGrowthBytes);
    const rssMedians = rssGrowthSeries.map((series) => median(series));
    const heapMedians = heapGrowthSeries.map((series) => median(series));

    const complete = validRows.length === expectedBatches;
    const medians = durations.map((series) => series.median);
    const above = medians.map((value) => Number.isFinite(value) && value > threshold.limitMs);
    const breachedBoth = complete && above.length === expectedBatches && above.every(Boolean);

    const tolerance = complete
      ? Math.max(REPEATABILITY.absoluteMs, Math.min(...medians) * REPEATABILITY.relativeFraction)
      : null;
    const betweenBatchDelta = complete ? Math.abs(medians[0] - medians[1]) : null;
    const durationRepeatable = tolerance !== null
      && betweenBatchDelta !== null
      && betweenBatchDelta <= tolerance
      && durationMads.every((value, index) => Number.isFinite(value)
        && value <= Math.max(REPEATABILITY.madAbsoluteMs, medians[index] * REPEATABILITY.madRelativeFraction));

    const blockingTolerance = complete && blockingMedians.every(Number.isFinite)
      ? Math.max(REPEATABILITY.absoluteMs, Math.min(...blockingMedians) * REPEATABILITY.relativeFraction)
      : null;
    const blockingBetweenBatchDelta = complete && blockingMedians.every(Number.isFinite)
      ? Math.abs(blockingMedians[0] - blockingMedians[1])
      : null;
    const blockingRepeatable = blockingTolerance !== null
      && blockingBetweenBatchDelta !== null
      && blockingBetweenBatchDelta <= blockingTolerance
      && blocking.every((series) => Number.isFinite(series.mad)
        && series.mad <= Math.max(REPEATABILITY.madAbsoluteMs, series.median * REPEATABILITY.madRelativeFraction));

    const blockingAbove = blockingMedians.map((value, index) => (
      Number.isFinite(value)
      && Number.isFinite(controlMaxima[index])
      && value > BLOCKING_THRESHOLD.absoluteMs
      && value - controlMaxima[index] > BLOCKING_THRESHOLD.aboveControlMs
    ));
    const blockingSignal = complete && blockingAbove.every(Boolean);
    const blockingBreach = blockingSignal && blockingRepeatable;

    const rssOver = rssMedians.map((value) => Number.isFinite(value) && value > MEMORY_THRESHOLD.rssGrowthBytes);
    const heapOver = heapMedians.map((value) => Number.isFinite(value) && value > MEMORY_THRESHOLD.heapGrowthBytes);
    const memorySignal = complete && (rssOver.every(Boolean) || heapOver.every(Boolean));
    // Memory keeps the predeclared both-batch rule and nothing stricter: the
    // endpoint observations are GC-timing-dependent, so a MAD gate here would
    // manufacture a finding out of timing noise.
    const memoryBreach = memorySignal;
    const memoryUnstable = complete && !memoryBreach
      && (rssOver.some(Boolean) || heapOver.some(Boolean));

    // Repeatability is applied to the metric that would trigger the
    // recommendation, not to every published series: an idle-case blocking
    // max that happens to jitter must not invalidate a duration result.
    let disposition;
    let profileFocus = null;
    if (!complete) {
      disposition = 'INCONCLUSIVE';
    } else if (breachedBoth && !durationRepeatable) {
      disposition = 'INCONCLUSIVE';
    } else if (blockingSignal && !blockingRepeatable) {
      disposition = 'INCONCLUSIVE';
    } else if (breachedBoth && durationRepeatable) {
      disposition = 'PROFILE_ONE_HOT_PATH';
      profileFocus = 'latency';
    } else if (blockingBreach) {
      disposition = 'PROFILE_ONE_HOT_PATH';
      profileFocus = 'blocking';
    } else if (memoryBreach) {
      disposition = 'PROFILE_ONE_HOT_PATH';
      profileFocus = 'memory';
    } else {
      disposition = 'NO_OPTIMIZATION_JUSTIFIED';
    }

    table.push({
      caseId,
      validBatches: validRows.length,
      thresholdMs: threshold.limitMs,
      batchMediansMs: medians.map((value) => round(value)),
      batchMadsMs: durationMads.map((value) => round(value)),
      breachedBothBatches: breachedBoth,
      durationThresholdBreach: breachedBoth,
      repeatable: durationRepeatable,
      durationRepeatable,
      betweenBatchDeltaMs: round(betweenBatchDelta),
      repeatabilityToleranceMs: round(tolerance),
      controlMaxLatenessMs: controlMaxima.map((value) => round(value)),
      blockingMedianLatenessMs: blockingMedians.map((value) => round(value)),
      blockingMaxLatenessMs: blockingMaxima.map((value) => round(value)),
      blockingMadMs: blocking.map((series) => round(series.mad)),
      blockingBetweenBatchDeltaMs: round(blockingBetweenBatchDelta),
      blockingRepeatabilityToleranceMs: round(blockingTolerance),
      blockingThresholdBreach: blockingSignal,
      blockingRepeatable,
      blockingBreach,
      rssGrowthMiB: rssMedians.map((value) => round(value / (1024 * 1024))),
      heapGrowthMiB: heapMedians.map((value) => round(value / (1024 * 1024))),
      memoryThresholdBreach: memorySignal,
      memoryBreach,
      memoryUnstable,
      disposition,
      profileFocus,
    });
  }

  const timingContaminated = table.some((row) => row.controlMaxLatenessMs.some(
    (value) => Number.isFinite(value) && value > CONTROL_CONTAMINATION_MS,
  ));
  const invalidExecution = !integrity.batchCountOk
    || integrity.invalidRows.length > 0
    || integrity.invalidCalibrations.length > 0
    || integrity.invalidInputs.length > 0;
  const latencyCandidates = table.filter(
    (row) => row.disposition === 'PROFILE_ONE_HOT_PATH'
      && (row.profileFocus === 'latency' || row.profileFocus === 'blocking'),
  );
  const memoryCandidates = table.filter(
    (row) => row.disposition === 'PROFILE_ONE_HOT_PATH' && row.profileFocus === 'memory',
  );
  const inconclusive = table.filter((row) => row.disposition === 'INCONCLUSIVE');

  let verdict;
  if (invalidExecution) verdict = 'CORRECTNESS_FAILURE';
  else if (timingContaminated || inconclusive.length > 0) verdict = 'INCONCLUSIVE';
  else if (latencyCandidates.length > 0 || memoryCandidates.length > 0) verdict = 'PROFILE_ONE_HOT_PATH';
  else verdict = 'NO_OPTIMIZATION_JUSTIFIED';

  return {
    thresholds: THRESHOLDS,
    blockingThreshold: BLOCKING_THRESHOLD,
    memoryThreshold: MEMORY_THRESHOLD,
    repeatability: REPEATABILITY,
    controlContaminationMs: CONTROL_CONTAMINATION_MS,
    timingContaminated,
    integrity,
    invalidExecution,
    calibration,
    table,
    selectedProfileCandidate: verdict === 'PROFILE_ONE_HOT_PATH'
      ? (latencyCandidates.length
        ? latencyCandidates[0].caseId
        : (memoryCandidates.length ? memoryCandidates[0].caseId : null))
      : null,
    selectedProfileFocus: verdict === 'PROFILE_ONE_HOT_PATH'
      ? (latencyCandidates.length
        ? latencyCandidates[0].profileFocus
        : (memoryCandidates.length ? 'memory' : null))
      : null,
    verdict,
  };
}

function markdownReport(report) {
  const lines = [];
  lines.push('# C1 host-function performance baseline (corrected protocol)');
  lines.push('');
  lines.push(`Profile: \`${report.profile}\``);
  lines.push(`Source root: \`${report.sourceRoot}\``);
  lines.push(`Node: \`${report.node}\` (${report.platform}/${report.arch}, ${report.cpus} CPUs)`);
  lines.push(`Git: \`${report.inputIdentity.git.branch || 'unknown'}\` at \`${(report.inputIdentity.git.head || 'unknown').slice(0, 12)}\``);
  lines.push(`Started: ${report.startedAt}`);
  lines.push(`Finished: ${report.finishedAt}`);
  lines.push('');
  lines.push('## Input identity');
  lines.push('');
  lines.push(`- Executable: \`${report.inputIdentity.executable}\``);
  lines.push(`- Worker: \`${report.inputIdentity.workerPath}\``);
  lines.push(`- Worker sha256: ${report.inputIdentity.workerSha256 || 'missing'}`);
  lines.push(`- Production files unchanged during the run: ${report.inputIdentity.productionFilesUnchanged}`);
  lines.push(`- Worker source files unchanged during the run: ${report.inputIdentity.sourceFilesUnchanged}`);
  for (const [relative, digest] of Object.entries(report.inputIdentity.productionFiles)) {
    lines.push(`- \`${relative}\`: ${digest ? `\`${digest.slice(0, 23)}…\`` : 'missing'}`);
  }
  lines.push(`- Resolved production dependencies reported by workers: ${report.inputIdentity.resolvedModules.join(', ') || 'none'}`);
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  lines.push(`**${report.decision.verdict}**`);
  lines.push('');
  if (report.decision.verdict === 'NO_OPTIMIZATION_JUSTIFIED') {
    lines.push('No optimization is justified by C1 measurements.');
    lines.push('');
  }
  lines.push('Thresholds were recorded before measurement and were not tuned afterwards.');
  lines.push('');
  lines.push('## Per-case decision table');
  lines.push('');
  lines.push('| Case | Threshold ms | Batch medians ms | Dur repeatable | Control max ms | Blocking median ms | Blocking max ms (diag) | Block repeatable | RSS medians MiB | Heap medians MiB | Disposition |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of report.decision.table) {
    lines.push(`| ${row.caseId} | ${row.thresholdMs} | ${row.batchMediansMs.join(' / ')} | ${row.durationRepeatable} | ${row.controlMaxLatenessMs.join(' / ')} | ${row.blockingMedianLatenessMs.join(' / ')} | ${row.blockingMaxLatenessMs.join(' / ')} | ${row.blockingRepeatable} | ${row.rssGrowthMiB.join(' / ')} | ${row.heapGrowthMiB.join(' / ')} | ${row.disposition} |`);
  }
  lines.push('');
  lines.push('## Measurement reliability');
  lines.push('');
  const calibrations = report.decision.calibration && report.decision.calibration.runs
    ? report.decision.calibration.runs
    : [];
  if (calibrations.length > 0) {
    for (const run of calibrations) {
      lines.push(`- ${run.batch}/${run.case}: deliberate ${run.blockMs} ms block detected=${run.detected} (max lateness ${run.detectedMs} ms); matched control max lateness ${run.noWorkMaxLatenessMs} ms.`);
    }
  } else {
    lines.push('- Calibration unavailable: no case produced a valid measurement.');
  }
  lines.push(`- All calibrations retained: ${report.decision.calibration ? report.decision.calibration.allDetected : 'n/a'}.`);
  lines.push(`- Timing environment contaminated (>${report.decision.controlContaminationMs} ms control lateness): ${report.decision.timingContaminated}.`);
  lines.push(`- Invalid execution detected: ${report.decision.invalidExecution}.`);
  lines.push('');
  lines.push('## Measurement protocol');
  lines.push('');
  lines.push(`- ${BATCH_COUNT} sequential batches, one fresh worker process per case per batch, case order reversed in batch 2.`);
  lines.push('- Each worker records module-load time, the ACTUAL first invocation, two untimed warm-ups and ten measured invocations.');
  lines.push('- Duration is monotonic around the production call only; fixture work, digesting, oracle checks, memory sampling and serialization are outside the timed window.');
  lines.push('- Memory is the median of ten per-invocation post-yield RSS/heap growth observations against the after-load endpoint.');
  lines.push('- Blocking gate uses the MEDIAN of the ten per-invocation window maxima; those maxima stay as diagnostics.');
  lines.push('- Matched no-work control uses the same per-window maximum statistic.');
  lines.push('- This is fresh-process data, not a controlled cold-disk measurement.');
  lines.push('');
  lines.push('## Fixture inventory');
  lines.push('');
  lines.push(`- Pre-run expected: ${stableStringify(report.fixtureInventory.expected)}`);
  lines.push(`- Pre-run observed: ${stableStringify(report.fixtureInventory.observed)}`);
  lines.push(`- Post-run observed: ${stableStringify(report.fixtureInventory.observedAfter)}`);
  lines.push(`- Fixture inventory unchanged: ${report.fixtureInventory.unchanged}`);
  lines.push('');
  lines.push('## Scope explicitly NOT measured');
  lines.push('');
  lines.push('- Live Electron main-thread blocking and real IPC round-trip latency.');
  lines.push('- Full application startup, launcher paint, Harness readiness, packaged startup.');
  lines.push('- Rendered Files search / renderer responsiveness.');
  lines.push('- Zstandard-compressed session logs, large workspace registries, deep search trees, network filesystems.');
  lines.push('- Packaging and installer acceptance.');
  lines.push('');
  lines.push('These are NOT MEASURED, not passes.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const args = { profile: '', sourceRoot: '', out: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--profile') args.profile = value || '';
    else if (key === '--source-root') args.sourceRoot = path.resolve(value || '');
    else if (key === '--out') args.out = path.resolve(value || '');
  }
  if (args.profile !== 'c1') throw new Error('--profile must be c1');
  if (!args.sourceRoot) throw new Error('--source-root is required');
  if (!args.out) throw new Error('--out is required');
  return args;
}

/**
 * Collect the calibration records of every case that produced one, including
 * failures. A later success never hides an earlier missing or failed
 * calibration: each entry carries its own outcome and `allDetected` is false if
 * any entry is absent or undetected.
 */
function collectCalibration(batches, invalidRows) {
  const runs = [];
  const failures = [];
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    for (const caseId of CASE_IDS) {
      const row = caseResultIn(batches[batchIndex] || [], caseId);
      const controls = row && row.payload && row.payload.result ? row.payload.result.controls : null;
      if (!controls || typeof controls.detected !== 'boolean') {
        failures.push({ batch: batchIndex + 1, case: caseId, reason: 'CALIBRATION_UNAVAILABLE' });
        continue;
      }
      runs.push({
        batch: batchIndex + 1,
        case: caseId,
        blockMs: controls.blockMs ?? controls.calibrationBlockMs ?? null,
        detected: controls.detected,
        detectedMs: round(controls.detectedMs ?? controls.calibrationDetectedMs),
        noWorkMaxLatenessMs: round(controls.noWork ? controls.noWork.maxLatenessMs : null),
        statistic: controls.statistic || null,
        outcomes: controls.outcomes || null,
      });
      if (controls.detected !== true) {
        failures.push({ batch: batchIndex + 1, case: caseId, reason: 'CALIBRATION_NOT_DETECTED' });
      }
    }
  }
  return {
    runs,
    failures,
    allDetected: failures.length === 0,
    invalidRows,
  };
}

/**
 * Fixture identity gate. Runs AFTER the decision and never influences it; its
 * only job is to void a result whose declared inputs cannot be accounted for.
 */
function applyInputGate(report) {
  const violations = [];
  const missingHash = (map) => !map || Object.keys(map).length === 0
    || Object.values(map).some((value) => typeof value !== 'string' || value.length === 0);
  if (missingHash(report.inputIdentity.productionFiles)) violations.push('PRODUCTION_HASH_MISSING');
  if (missingHash(report.inputIdentity.sourceFiles)) violations.push('WORKER_SOURCE_HASH_MISSING');
  if (!report.inputIdentity.productionFilesUnchanged) violations.push('PRODUCTION_FILES_CHANGED');
  if (!report.inputIdentity.sourceFilesUnchanged) violations.push('WORKER_SOURCE_FILES_CHANGED');
  if (!report.inputIdentity.workerSha256 || !report.inputIdentity.workerSha256After) {
    violations.push('WORKER_HASH_MISSING');
  }
  // Resolved production dependencies are part of the measured input, not just
  // displayed provenance: a missing or changed dependency hash voids the run.
  const dependencies = report.inputIdentity.resolvedModules;
  if (!Array.isArray(dependencies) || dependencies.length === 0) {
    violations.push('RESOLVED_DEPENDENCIES_MISSING');
  } else if (dependencies.some((row) => typeof row !== 'string'
    || row.endsWith('missing') || !/sha256:[0-9a-f]{64}$/.test(row))) {
    violations.push('RESOLVED_DEPENDENCY_HASH_MISSING');
  } else if (!report.inputIdentity.resolvedModulesUnchanged) {
    violations.push('RESOLVED_DEPENDENCIES_CHANGED');
  }
  if (!report.fixtureInventory || !report.fixtureInventory.unchanged) violations.push('FIXTURE_UNCHANGED_CHECK_FAILED');
  if (!report.fixtureInventory || report.fixtureInventory.matchesExpected !== true) {
    violations.push('FIXTURE_MANIFEST_MISMATCH');
  }
  if (!report.fixtureInventory || report.fixtureInventory.contentUnchanged !== true) {
    violations.push('FIXTURE_CONTENT_CHANGED');
  }
  if (!report.decision.calibration || report.decision.calibration.allDetected !== true) {
    violations.push('CALIBRATION_INCOMPLETE');
  }
  if (report.decision.invalidExecution) violations.push('INVALID_EXECUTION');
  // Any invalid input voids EVERY conclusive disposition, including a negative
  // one: "no optimization justified" is only trustworthy on accounted inputs.
  if (violations.length > 0 && report.decision.verdict !== 'CORRECTNESS_FAILURE') {
    report.decision.verdict = 'INCONCLUSIVE';
    report.decision.selectedProfileCandidate = null;
    report.decision.selectedProfileFocus = null;
  }
  report.decision.inputGateViolations = violations;
  return violations;
}

/**
 * Execution validity is a separate axis from the analytical verdict.
 *
 * - Invalid inputs/execution make the RUN unusable: `ok:false`, nonzero exit,
 *   specific reasons preserved. This is a reporting/tooling failure.
 * - A complete, valid measurement may still be analytically `INCONCLUSIVE`
 *   because of variability or contamination; that is a legitimate outcome and
 *   the run itself succeeded.
 */
function executionStatus(report) {
  const violations = report.decision.inputGateViolations || [];
  const invalid = violations.length > 0
    || report.decision.invalidExecution === true
    || Boolean(report.unresolvedProcess)
    || report.decision.verdict === 'CORRECTNESS_FAILURE';
  if (!invalid) return { ok: true, exitCode: 0, reasons: [] };
  const reasons = [...violations];
  if (report.decision.invalidExecution === true) reasons.push('INVALID_EXECUTION');
  if (report.unresolvedProcess) reasons.push('UNRESOLVED_PROCESS');
  if (report.decision.verdict === 'CORRECTNESS_FAILURE') reasons.push('CORRECTNESS_FAILURE');
  return {
    ok: false,
    exitCode: 1,
    reasons: [...new Set(reasons)],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mustNotBeInsideRepo(args.out);
  if (fs.existsSync(args.out)) {
    throw new Error(`refusing to overwrite an existing report directory: ${args.out}`);
  }
  const workerPath = path.join(args.sourceRoot, 'scripts', 'lib', 'desktop-perf-worker.cjs');
  if (!fs.existsSync(workerPath)) {
    throw new Error(`worker not found in the source root (sync it first): ${workerPath}`);
  }

  const startedAt = new Date().toISOString();
  const fixtureRoot = path.join(args.out, 'fixtures');
  const manifest = prepareFixture(fixtureRoot, args.sourceRoot);
  const inventoryBefore = inventoryFixture(fixtureRoot, manifest);
  const gitPreflight = gitIgnorePreflight(fixtureRoot, args.sourceRoot, manifest.listings, manifest.gitDir);
  // The declared 180 s budget covers MEASUREMENT only. Fixture preparation and
  // the Git-ignore preflight happen before this point and never consume it.
  const runStarted = Date.now();

  // Input identity BEFORE measurement. The worker actually launched is hashed
  // from sourceRoot, and the resolved production dependency list is collected
  // from the workers themselves after the run.
  const productionHashesBefore = hashFiles(args.sourceRoot, PRODUCTION_FILES);
  const workerHashBefore = sha256File(workerPath);
  const sourceFileHashesBefore = hashFiles(args.sourceRoot, HARNESS_FILES);
  const resolvedFromRuns = new Set();
  const invalidRows = [];

  const batches = [];
  let stopRun = null;
  for (let batchIndex = 0; batchIndex < BATCH_COUNT; batchIndex += 1) {
    const runOrder = caseOrderForBatch(batchIndex);
    const batch = [];
    for (const caseId of runOrder) {
      if (stopRun) {
        invalidRows.push({ caseId, batch: batchIndex + 1, reason: stopRun.reason });
        batch.push({ case: caseId, ok: false, failure: stopRun.reason });
        continue;
      }
      if (Date.now() - runStarted > RUN_TIMEOUT_MS) {
        const row = { case: caseId, ok: false, failure: 'RUN_TIMEOUT' };
        invalidRows.push({ caseId, batch: batchIndex + 1, reason: 'RUN_TIMEOUT' });
        batch.push(row);
        stopRun = { reason: 'RUN_TIMEOUT' };
        continue;
      }
      const remainingBudgetMs = RUN_TIMEOUT_MS - (Date.now() - runStarted);
      const outcome = await runWorker({
        nodePath: process.execPath,
        workerPath,
        caseId,
        fixtureRoot,
        sourceRoot: args.sourceRoot,
        jsonOut: path.join(args.out, 'raw', `batch-${batchIndex + 1}-${caseId}.json`),
        // Never let one case spend more than its own budget or more than the
        // run's remaining budget, whichever is smaller. The remaining budget is
        // used as-is so a nearly exhausted run cannot overshoot by a floor.
        timeoutMs: Math.min(WORKER_TIMEOUT_MS, Math.max(1, remainingBudgetMs)),
        expectedDigest: manifest.expectedDigests[caseId],
      });
      // Record which worker process was actually launched and reaped, so the
      // report can attest to owned-process accounting rather than assume it.
      outcome.worker = workerIdentityFor(outcome, workerPath, workerHashBefore);
      batch.push(outcome);
      if (outcome.ok && outcome.payload.result.resolvedModules) {
        for (const module of outcome.payload.result.resolvedModules) {
          resolvedFromRuns.add(`${module.file} ${module.sha256 || 'missing'}`);
        }
      }
      if (!outcome.ok) {
        invalidRows.push({
          caseId,
          batch: batchIndex + 1,
          reason: outcome.failure || 'WORKER_FAILED',
        });
      }
      // A timeout stops expansion: a killed worker's remaining cases are not
      // "not yet measured", they are invalid measurements. An unconfirmed
      // termination is fatal and returns below without launching anything else.
      const control = runControlAfter(outcome);
      if (control.stop && !control.fatal) stopRun = { reason: control.reason };
      if (control.fatal) {
        // Owned-process termination could not be confirmed. Stop immediately and
        // keep the fixtures so the operator can inspect the unresolved child.
        const decision = decide([...batches, batch], null);
        const report = buildReport({
          args,
          startedAt,
          fixtureRoot,
          manifest,
          inventoryBefore,
          inventoryAfter: inventoryFixture(fixtureRoot, manifest),
          gitPreflight,
          productionHashesBefore,
          workerPath,
          workerHashBefore,
          sourceFileHashesBefore,
          batches: [...batches, batch],
          calibration: collectCalibration([...batches, batch], invalidRows),
          decision,
          resolvedFromRuns,
          unresolvedProcess: { batch: batchIndex + 1, case: caseId },
        });
        writeReport(args.out, report);
        process.stdout.write(`${JSON.stringify({
          ok: false,
          verdict: report.decision.verdict,
          unresolvedProcess: report.unresolvedProcess,
          report: path.join(args.out, 'report.json'),
          summary: path.join(args.out, 'summary.md'),
        }, null, 2)}\n`);
        process.exitCode = 1;
        return;
      }
    }
    batch.sort((left, right) => CASE_IDS.indexOf(left.case) - CASE_IDS.indexOf(right.case));
    batches.push(batch);
  }

  const calibration = collectCalibration(batches, invalidRows);
  const decision = decide(batches, calibration);
  const report = buildReport({
    args,
    startedAt,
    fixtureRoot,
    manifest,
    inventoryBefore,
    inventoryAfter: inventoryFixture(fixtureRoot, manifest),
    gitPreflight,
    productionHashesBefore,
    workerPath,
    workerHashBefore,
    sourceFileHashesBefore,
    batches,
    calibration,
    decision,
    resolvedFromRuns,
    unresolvedProcess: null,
  });
  writeReport(args.out, report);

  const status = executionStatus(report);
  process.stdout.write(`${JSON.stringify({
    ok: status.ok,
    verdict: report.decision.verdict,
    executionReasons: status.reasons,
    selectedProfileCandidate: report.decision.selectedProfileCandidate,
    selectedProfileFocus: report.decision.selectedProfileFocus,
    report: path.join(args.out, 'report.json'),
    summary: path.join(args.out, 'summary.md'),
  }, null, 2)}\n`);
  if (!status.ok) process.exitCode = status.exitCode;
}

function buildReport({
  args,
  startedAt,
  fixtureRoot,
  manifest,
  inventoryBefore,
  inventoryAfter,
  gitPreflight,
  productionHashesBefore,
  workerPath,
  workerHashBefore,
  sourceFileHashesBefore,
  batches,
  calibration,
  decision,
  resolvedFromRuns,
  unresolvedProcess,
}) {
  const productionHashesAfter = hashFiles(args.sourceRoot, PRODUCTION_FILES);
  const workerHashAfter = sha256File(workerPath);
  const sourceFileHashesAfter = hashFiles(args.sourceRoot, HARNESS_FILES);
  const resolvedModules = [...resolvedFromRuns].sort();
  const resolvedModulesAfter = {};
  for (const row of resolvedModules) {
    const separator = row.lastIndexOf(' ');
    const relative = separator === -1 ? row : row.slice(0, separator);
    resolvedModulesAfter[relative] = sha256File(path.join(args.sourceRoot, relative));
  }
  const report = {
    schemaVersion: 2,
    profile: args.profile,
    mode: 'MEASUREMENT_ONLY',
    sourceRoot: args.sourceRoot,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    startedAt,
    finishedAt: new Date().toISOString(),
    unresolvedProcess,
    fixture: {
      root: fixtureRoot,
      byteCounts: manifest.byteCounts,
      expectedDigests: manifest.expectedDigests,
      gitDir: manifest.gitDir,
      gitPreflight,
    },
    fixtureInventory: {
      expected: inventoryBefore.expected,
      observed: inventoryBefore.observed,
      observedAfter: inventoryAfter.observed,
      matchesExpected: stableStringify(inventoryBefore.observed) === stableStringify(inventoryBefore.expected),
      unchanged: stableStringify(inventoryBefore.observed) === stableStringify(inventoryAfter.observed),
      digestBefore: inventoryBefore.digest,
      digestAfter: inventoryAfter.digest,
      contentUnchanged: inventoryBefore.digest === inventoryAfter.digest,
    },
    inputIdentity: {
      executable: process.execPath,
      node: process.version,
      cwd: process.cwd(),
      git: gitIdentity(args.sourceRoot),
      workerPath,
      workerSha256: workerHashBefore,
      workerSha256After: workerHashAfter,
      productionFiles: productionHashesBefore,
      productionFilesAfter: productionHashesAfter,
      sourceFiles: sourceFileHashesBefore,
      sourceFilesAfter: sourceFileHashesAfter,
      resolvedModules,
      resolvedModulesAfter,
      gitConfigIsolation: {
        GIT_CONFIG_GLOBAL: path.join(fixtureRoot, 'git-global-unused'),
        GIT_CONFIG_SYSTEM: path.join(fixtureRoot, 'git-system-unused'),
        GIT_CONFIG_NOSYSTEM: '1',
      },
    },
    batches: batches.map((batch, index) => ({
      batch: index + 1,
      runOrder: caseOrderForBatch(index),
      cases: batch.map((row) => (
        persistedCaseRow(row)
      )),
    })),
    decision,
  };
  report.inputIdentity.productionFilesUnchanged = stableStringify(report.inputIdentity.productionFiles)
    === stableStringify(report.inputIdentity.productionFilesAfter);
  report.inputIdentity.sourceFilesUnchanged = stableStringify(report.inputIdentity.sourceFiles)
    === stableStringify(report.inputIdentity.sourceFilesAfter);
  report.inputIdentity.workerUnchanged = report.inputIdentity.workerSha256
    === report.inputIdentity.workerSha256After;
  report.inputIdentity.resolvedModulesUnchanged = resolvedModules.length > 0
    && resolvedModules.every((row) => {
      const separator = row.lastIndexOf(' ');
      const relative = separator === -1 ? row : row.slice(0, separator);
      const reported = separator === -1 ? null : row.slice(separator + 1);
      return reported === resolvedModulesAfter[relative];
    });
  if (!report.inputIdentity.workerUnchanged) {
    report.decision.invalidExecution = true;
  }
  return report;
}

function writeReport(out, report) {
  applyInputGate(report);
  report.execution = executionStatus(report);
  ensureDir(out);
  fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'summary.md'), markdownReport(report));
}

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function writeFileBuffer(file, buffer) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, buffer);
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
  BLOCKING_THRESHOLD,
  BATCH_COUNT,
  CASE_IDS,
  CONTROL_CONTAMINATION_MS,
  DEFAULT_SIZES,
  FILES_LARGE,
  FILES_SMALL,
  HARNESS_FILES,
  IGNORED_EVERY,
  MANY_SMALL_SESSIONS,
  MEMORY_THRESHOLD,
  ONE_LONG_TARGET_BYTES,
  PRODUCTION_FILES,
  REPEATABILITY,
  RUN_TIMEOUT_MS,
  THRESHOLDS,
  TERMINATION_GRACE_MS,
  WORKER_TIMEOUT_MS,
  applyInputGate,
  buildHomes,
  buildListings,
  caseOrderForBatch,
  collectCalibration,
  createChildLedger,
  decide,
  digestOf,
  ensureDir,
  executionStatus,
  expectedDigests,
  fixtureSessionRow,
  gitIdentity,
  gitIgnorePreflight,
  hashFiles,
  inventoryFixture,
  markdownReport,
  median,
  medianAbsoluteDeviation,
  mustNotBeInsideRepo,
  parseArgs,
  prepareFixture,
  processAlive,
  persistedCaseRow,
  probeProcess,
  recomputeSeries,
  round,
  runControlAfter,
  runWorker,
  sessionLogText,
  sha256File,
  signalOpenChildren,
  stableStringify,
  stopReasonFor,
  survivingChildren,
  thresholdForCase,
  validateWorkerResult,
  workerIdentityFor,
  writeReport,
};
