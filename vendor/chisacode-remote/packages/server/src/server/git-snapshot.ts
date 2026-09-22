/**
 * Git Snapshot — automatic before/after edit snapshots with rewind support.
 *
 * Creates lightweight git commits on a dedicated snapshot branch
 * (chisacode-snapshots) to capture workspace state before and after agent
 * edits. Sensitive files are excluded via detectSensitivePath. Snapshot
 * commits carry XDT-style trailer metadata for identification.
 *
 * Design adapted from Cindy's git-snapshot/ (Apache-2.0).
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Logger } from "pino";

import { detectSensitivePath } from "../utils/sensitive-path.js";
import { runGitCommand } from "../utils/run-git-command.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type SnapshotKind =
  | "before-edit"
  | "after-edit"
  | "manual"
  | "pre-rollback"
  | "rewind-blocked";

export interface SnapshotMeta {
  kind: SnapshotKind;
  sessionId?: string;
  agentId?: string;
  label?: string;
}

export interface SnapshotResult {
  ok: boolean;
  commitHash?: string;
  /** Reason when ok=false. */
  reason?: string;
  /** Files excluded from the snapshot due to sensitivity. */
  excludedFiles?: string[];
}

export interface SnapshotBlockedState {
  reason: "merge" | "rebase" | "cherry-pick" | "revert" | "conflict";
}

export interface RewindResult {
  ok: boolean;
  restoredFiles?: string[];
  reason?: string;
}

const TRAILER_PREFIX = "XDT";
const SNAPSHOT_BRANCH = "chisacode-snapshots";

/**
 * Per-cwd serialization chains for snapshot creation. Snapshotting mutates a
 * temporary git index file; without serialization, concurrent snapshots on the
 * same repo (e.g. agent turn end + manual snapshot) would race on the index
 * file and produce corrupt or empty trees. Each cwd gets its own promise chain
 * so independent repos are not serialized against each other.
 */
const snapshotLocks = new Map<string, Promise<unknown>>();

function withSnapshotLock<T>(cwd: string, task: () => Promise<T>): Promise<T> {
  const previous = snapshotLocks.get(cwd) ?? Promise.resolve();
  const chained = previous.then(task, task);
  // Store a sentinel that resolves after the task so the map entry can be
  // compared; once settled, remove it so the map only tracks in-flight chains.
  const sentinel = chained.then(
    () => undefined,
    () => undefined,
  );
  snapshotLocks.set(cwd, sentinel);
  sentinel.finally(() => {
    if (snapshotLocks.get(cwd) === sentinel) {
      snapshotLocks.delete(cwd);
    }
  });
  return chained;
}

// ── Blocking state detection ───────────────────────────────────────────────

/**
 * Check if the repository is in a state where snapshot commits must not run
 * (because `git commit` would finish or interfere with the operation).
 */
export async function detectBlockedGitState(
  cwd: string,
  _logger: Logger,
): Promise<SnapshotBlockedState | null> {
  const checks: Array<{ file: string; reason: SnapshotBlockedState["reason"] }> = [
    { file: "MERGE_HEAD", reason: "merge" },
    { file: "rebase-merge", reason: "rebase" },
    { file: "rebase-apply", reason: "rebase" },
    { file: "CHERRY_PICK_HEAD", reason: "cherry-pick" },
    { file: "REVERT_HEAD", reason: "revert" },
  ];

  for (const { file, reason } of checks) {
    try {
      const result = await runGitCommand(["rev-parse", "--git-path", file], { cwd });
      const gitPath = result.stdout?.trim();
      if (!gitPath) continue;

      if (existsSync(gitPath)) {
        return { reason };
      }
    } catch {
      // Non-fatal — skip this check
    }
  }

  return null;
}

// ── Snapshot creation ──────────────────────────────────────────────────────

/**
 * Build the commit message with XDT trailer metadata.
 */
export function buildSnapshotCommitMessage(meta: SnapshotMeta): string {
  const label = meta.label ?? meta.kind;
  const lines = [`chisacode: ${label}`];
  lines.push("");
  lines.push(`${TRAILER_PREFIX}-Snapshot-Kind: ${meta.kind}`);
  if (meta.sessionId) lines.push(`${TRAILER_PREFIX}-Session-Id: ${meta.sessionId}`);
  if (meta.agentId) lines.push(`${TRAILER_PREFIX}-Agent-Id: ${meta.agentId}`);
  return lines.join("\n");
}

/**
 * Parse snapshot metadata from a commit message's trailers.
 */
export function parseSnapshotTrailers(message: string): {
  kind?: string;
  sessionId?: string;
  agentId?: string;
} {
  const kind = message.match(new RegExp(`${TRAILER_PREFIX}-Snapshot-Kind: (.+)`))?.[1];
  const sessionId = message.match(new RegExp(`${TRAILER_PREFIX}-Session-Id: (.+)`))?.[1];
  const agentId = message.match(new RegExp(`${TRAILER_PREFIX}-Agent-Id: (.+)`))?.[1];
  return { kind, sessionId, agentId };
}

/**
 * Create a git snapshot of the current workspace state.
 *
 * Uses git plumbing commands (write-tree + commit-tree + update-ref) to
 * create a snapshot commit without touching HEAD, the current branch, or the
 * staging area. The snapshot is stored under refs/chisacode-snapshots/
 * and can be listed/rewound later.
 *
 * The staging step runs against a temporary `GIT_INDEX_FILE` so the user's real
 * index is never mutated — even on crash, no `git reset` is needed and the
 * user's pre-existing staged changes are preserved. Snapshot creation for a
 * given cwd is serialized to avoid concurrent index races.
 */
export async function createSnapshot(
  cwd: string,
  meta: SnapshotMeta,
  logger: Logger,
): Promise<SnapshotResult> {
  return withSnapshotLock(cwd, () => createSnapshotUnlocked(cwd, meta, logger));
}

interface SnapshotLeafPartition {
  excludedFiles: string[];
  safeAdds: string[];
  safeDeletes: string[];
}

function partitionSnapshotLeaves(entries: SnapshotStatusEntry[]): SnapshotLeafPartition {
  const excludedFiles: string[] = [];
  const safeAdds: string[] = [];
  const safeDeletes: string[] = [];
  for (const entry of entries) {
    const pathValidation = validateSnapshotLeafPath(entry.path);
    if (!pathValidation.ok || detectSensitivePath(entry.path)) {
      excludedFiles.push(entry.path);
      continue;
    }
    if (entry.kind === "delete") {
      safeDeletes.push(entry.path);
    } else {
      safeAdds.push(entry.path);
    }
  }
  return { excludedFiles, safeAdds, safeDeletes };
}

async function resolveSnapshotParentHash(
  cwd: string,
): Promise<{ parentHash: string | null; hasHead: boolean }> {
  try {
    const headResult = await runGitCommand(["rev-parse", "HEAD"], { cwd });
    const parentHash = headResult.stdout?.trim() || null;
    return { parentHash, hasHead: Boolean(parentHash) };
  } catch {
    return { parentHash: null, hasHead: false };
  }
}

async function seedTempIndexFromHead(options: {
  cwd: string;
  indexEnv: Record<string, string>;
  parentHash: string;
}): Promise<SnapshotResult | null> {
  try {
    await runGitCommand(["read-tree", options.parentHash], {
      cwd: options.cwd,
      envOverlay: options.indexEnv,
    });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `failed to seed snapshot index from HEAD: ${message}` };
  }
}

async function treeMatchesHead(options: {
  cwd: string;
  parentHash: string;
  treeHash: string;
}): Promise<boolean> {
  try {
    const headTreeResult = await runGitCommand(["rev-parse", `${options.parentHash}^{tree}`], {
      cwd: options.cwd,
    });
    const headTree = headTreeResult.stdout?.trim();
    return Boolean(headTree && headTree === options.treeHash);
  } catch {
    return false;
  }
}

async function storeSnapshotRef(cwd: string, commitHash: string, logger: Logger): Promise<void> {
  try {
    await runGitCommand(
      ["update-ref", `refs/${SNAPSHOT_BRANCH}/${commitHash.slice(0, 12)}`, commitHash],
      { cwd },
    );
  } catch (refError) {
    logger.warn({ err: refError, commitHash }, "failed to store snapshot ref");
  }
}

async function createSnapshotUnlocked(
  cwd: string,
  meta: SnapshotMeta,
  logger: Logger,
): Promise<SnapshotResult> {
  const blocked = await detectBlockedGitState(cwd, logger);
  if (blocked) {
    return { ok: false, reason: `git ${blocked.reason} in progress` };
  }

  // Temporary index keeps the user's real staging area untouched.
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "chisacode-snap-idx-"));
  const tmpIndex = path.join(tmpDir, "index");
  try {
    // Leaf paths only: --untracked-files=all avoids directory-token collapse.
    const statusResult = await runGitCommand(
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { cwd },
    );
    const statusEntries = parseStatusPorcelainEntries(statusResult.stdout ?? "");
    if (statusEntries.length === 0) {
      return { ok: false, reason: "no changes to snapshot" };
    }

    const { excludedFiles, safeAdds, safeDeletes } = partitionSnapshotLeaves(statusEntries);
    if (safeAdds.length === 0 && safeDeletes.length === 0) {
      return { ok: false, reason: "all changed files are sensitive", excludedFiles };
    }

    const indexEnv = { GIT_INDEX_FILE: tmpIndex };
    const { parentHash, hasHead } = await resolveSnapshotParentHash(cwd);
    if (hasHead && parentHash) {
      const seedError = await seedTempIndexFromHead({ cwd, indexEnv, parentHash });
      if (seedError) {
        return seedError;
      }
    }

    await applyIndexPathBatches({ cwd, indexEnv, paths: safeDeletes, mode: "delete" });
    await applyIndexPathBatches({ cwd, indexEnv, paths: safeAdds, mode: "add" });

    const treeResult = await runGitCommand(["write-tree"], { cwd, envOverlay: indexEnv });
    const treeHash = treeResult.stdout?.trim();
    if (!treeHash) {
      return { ok: false, reason: "failed to create tree object" };
    }

    if (hasHead && parentHash && (await treeMatchesHead({ cwd, parentHash, treeHash }))) {
      return {
        ok: false,
        reason: "no tree diff relative to HEAD after filtering",
        excludedFiles,
      };
    }

    const message = buildSnapshotCommitMessage(meta);
    const commitArgs = parentHash
      ? ["commit-tree", treeHash, "-p", parentHash, "-m", message]
      : ["commit-tree", treeHash, "-m", message];
    const commitResult = await runGitCommand(commitArgs, { cwd });
    const commitHash = commitResult.stdout?.trim();
    if (!commitHash) {
      return { ok: false, reason: "failed to create commit object" };
    }

    await storeSnapshotRef(cwd, commitHash, logger);
    logger.info(
      {
        commitHash,
        kind: meta.kind,
        files: safeAdds.length + safeDeletes.length,
        excluded: excludedFiles.length,
      },
      "snapshot created",
    );
    return { ok: true, commitHash, excludedFiles };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error }, "snapshot creation failed");
    return { ok: false, reason: message };
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // OS tmp reaper will clean leftovers.
    }
  }
}

// ── Rewind ─────────────────────────────────────────────────────────────────

/**
 * Restore specific files from a snapshot commit.
 * Validates that the target commit is actually a snapshot (has XDT trailer).
 */
export async function rewindToSnapshot(
  cwd: string,
  commitHash: string,
  files: string[],
  logger: Logger,
): Promise<RewindResult> {
  try {
    // Defense-in-depth: the protocol schema already restricts commitHash to
    // hex SHA, but reject here too so a direct caller (tests, internal code)
    // cannot perform git argument injection (e.g. --output=<path> writes the
    // log to an arbitrary file).
    if (!/^[0-9a-f]{40,64}$/i.test(commitHash)) {
      return { ok: false, reason: "commitHash must be a 40- or 64-char hex SHA" };
    }
    // Validate that this is actually a snapshot commit
    const logResult = await runGitCommand(["log", "-1", "--format=%B", commitHash], { cwd });
    const trailers = parseSnapshotTrailers(logResult.stdout ?? "");
    if (!trailers.kind) {
      return { ok: false, reason: `commit ${commitHash} is not a snapshot (no XDT trailer)` };
    }

    const targets = files.length > 0 ? files : ["."];
    await runGitCommand(["checkout", commitHash, "--", ...targets], { cwd });

    logger.info({ commitHash, files: targets.length }, "rewind completed");
    return { ok: true, restoredFiles: targets };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: error, commitHash }, "rewind failed");
    return { ok: false, reason: message };
  }
}

/**
 * List recent snapshot commits from the refs/chisacode-snapshots/ namespace.
 */
export async function listSnapshots(
  cwd: string,
  _logger: Logger,
  maxCount = 50,
): Promise<Array<{ hash: string; message: string; kind?: string; createdAt: number }>> {
  try {
    // Get the list of snapshot refs with their creation timestamp (unix seconds).
    const refsResult = await runGitCommand(
      [
        "for-each-ref",
        `--count=${maxCount}`,
        "--sort=-creatordate",
        "--format=%(objectname)%09%(creatordate:unix)",
        `refs/${SNAPSHOT_BRANCH}/`,
      ],
      { cwd },
    );
    const lines = (refsResult.stdout ?? "").trim().split("\n").filter(Boolean);
    if (lines.length === 0) return [];

    // Read each commit message individually (avoids git log format parsing issues)
    const results: Array<{ hash: string; message: string; kind?: string; createdAt: number }> = [];
    for (const line of lines) {
      const [rawHash, rawCreatedAt] = line.split("\t");
      const hash = rawHash?.trim();
      if (!hash) continue;
      const createdAt = Number.parseInt(rawCreatedAt ?? "", 10);
      try {
        const msgResult = await runGitCommand(["log", "-1", "--format=%B", hash], { cwd });
        const message = (msgResult.stdout ?? "").trim();
        const trailers = parseSnapshotTrailers(message);
        results.push({
          hash,
          message,
          kind: trailers.kind,
          createdAt: Number.isFinite(createdAt) ? createdAt : 0,
        });
      } catch {
        // Skip unreadable commits
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ── Internals ──────────────────────────────────────────────────────────────

/** Max paths per git add/update-index invocation to stay under OS argv limits. */
const INDEX_PATH_BATCH_SIZE = 64;

interface SnapshotStatusEntry {
  path: string;
  kind: "add" | "modify" | "delete";
}

/**
 * Parse `git status --porcelain=v1 -z --untracked-files=all` into leaf entries.
 * Directory tokens are rejected later by validateSnapshotLeafPath.
 */
export function parseStatusPorcelainEntries(output: string): SnapshotStatusEntry[] {
  // -z format: entries separated by NUL, each entry is "XY path".
  // Rename/copy entries (R/C status) have an extra NUL-separated old path
  // immediately after the new path entry.
  const entries = output.split("\0").filter(Boolean);
  const files: SnapshotStatusEntry[] = [];
  let skipNext = false;
  for (const entry of entries) {
    if (skipNext) {
      skipNext = false;
      continue; // This is the old path of a rename/copy — skip it
    }
    // Format: "XY <path>" where XY is 2 status chars + space
    const status = entry.slice(0, 2);
    const filePath = entry.slice(3);
    if (!filePath) {
      continue;
    }

    // Rename/copy: treat destination as add/modify and include source as delete
    // so the snapshot tree reflects the rename fully.
    if (status[0] === "R" || status[0] === "C" || status[1] === "R" || status[1] === "C") {
      files.push({ path: filePath, kind: "add" });
      skipNext = true;
      continue;
    }

    const xy = `${status[0] ?? " "}${status[1] ?? " "}`;
    if (xy === "D " || xy === " D" || xy === "DD") {
      files.push({ path: filePath, kind: "delete" });
      continue;
    }
    if (xy.includes("D")) {
      // e.g. MD / AD: still present in worktree as modified content after delete+recreate.
      files.push({ path: filePath, kind: "modify" });
      continue;
    }
    if (xy === "??" || xy === "A " || xy === " A" || xy === "AM" || xy === "MA") {
      files.push({ path: filePath, kind: "add" });
      continue;
    }
    files.push({ path: filePath, kind: "modify" });
  }
  return files;
}

/**
 * Legacy path list helper retained for tests/callers that only need paths.
 */
export function parseStatusPorcelain(output: string): string[] {
  return parseStatusPorcelainEntries(output).map((entry) => entry.path);
}

function validateSnapshotLeafPath(
  relativePath: string,
): { ok: true } | { ok: false; reason: string } {
  if (!relativePath || relativePath.includes("\0")) {
    return { ok: false, reason: "empty_or_nul" };
  }
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.endsWith("/")) {
    // Directory tokens must never be passed to git add.
    return { ok: false, reason: "directory_token" };
  }
  if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
    return { ok: false, reason: "absolute_path" };
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === "")) {
    return { ok: false, reason: "path_traversal_or_empty_segment" };
  }
  return { ok: true };
}

async function applyIndexPathBatches(options: {
  cwd: string;
  indexEnv: Record<string, string>;
  paths: string[];
  mode: "add" | "delete";
}): Promise<void> {
  for (let i = 0; i < options.paths.length; i += INDEX_PATH_BATCH_SIZE) {
    const batch = options.paths.slice(i, i + INDEX_PATH_BATCH_SIZE);
    if (batch.length === 0) {
      continue;
    }
    if (options.mode === "add") {
      await runGitCommand(["add", "--", ...batch], {
        cwd: options.cwd,
        envOverlay: options.indexEnv,
      });
    } else {
      await runGitCommand(["update-index", "--force-remove", "--", ...batch], {
        cwd: options.cwd,
        envOverlay: options.indexEnv,
      });
    }
  }
}
