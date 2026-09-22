import { resolve } from "node:path";
import { stat as statFile } from "node:fs/promises";

import type { ParsedDiffFile } from "../server/utils/diff-highlighter.js";
import { parseAndHighlightDiff } from "../server/utils/diff-highlighter.js";
import { PER_FILE_DIFF_MAX_BYTES, isLikelyBinaryFile } from "./checkout-git-file-inspection.js";
import { READ_ONLY_GIT_ENV, requireGitRepo } from "./checkout-git-repository.js";
import { runGitCommand } from "./run-git-command.js";

/** Structured or textual diff returned for a checkout comparison. */
export interface CheckoutDiffResult {
  diff: string;
  structured?: ParsedDiffFile[];
}

/** Comparison options accepted by checkout diff reads. */
export interface CheckoutDiffCompare {
  mode: "uncommitted" | "base";
  baseRef?: string;
  ignoreWhitespace?: boolean;
  includeStructured?: boolean;
}

interface CheckoutDiffDependencies<TContext> {
  resolveBaseRefForCwd(
    cwd: string,
    context: TContext | undefined,
  ): Promise<{ storedBaseRef: string | null; resolvedBaseRef: string | null }>;
  resolveBestComparisonBaseRef(cwd: string, baseRef: string): Promise<string>;
}
interface CheckoutFileChange {
  path: string;
  oldPath?: string;
  status: string;
  isNew: boolean;
  isDeleted: boolean;
  isUntracked?: boolean;
}

interface CheckoutDiffRefs {
  baseRef: string;
  targetRef?: string;
  includeUntracked: boolean;
}

function getCheckoutDiffRefArgs(refs: CheckoutDiffRefs): string[] {
  return [refs.baseRef, ...(refs.targetRef ? [refs.targetRef] : [])];
}

async function listCheckoutFileChanges(
  cwd: string,
  refs: CheckoutDiffRefs,
  ignoreWhitespace = false,
): Promise<CheckoutFileChange[]> {
  const changes: CheckoutFileChange[] = [];

  const { stdout: nameStatusOut } = await runGitCommand(
    buildGitDiffArgs({
      ignoreWhitespace,
      extra: ["--name-status", ...getCheckoutDiffRefArgs(refs)],
    }),
    { cwd, envOverlay: READ_ONLY_GIT_ENV },
  );
  for (const line of nameStatusOut
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    // `--name-status` uses TAB separators, which preserves filenames with spaces.
    const tabParts = line.split("\t");
    const rawStatus = (tabParts[0] ?? "").trim();
    if (!rawStatus) continue;

    if (rawStatus.startsWith("R") || rawStatus.startsWith("C")) {
      const oldPath = tabParts[1];
      const newPath = tabParts[2];
      if (newPath) {
        changes.push({
          path: newPath,
          ...(oldPath ? { oldPath } : {}),
          status: rawStatus,
          isNew: false,
          isDeleted: false,
        });
      }
      continue;
    }

    const path = tabParts[1];
    if (!path) continue;
    const code = rawStatus[0];
    changes.push({
      path,
      status: rawStatus,
      isNew: code === "A",
      isDeleted: code === "D",
    });
  }

  if (refs.includeUntracked) {
    const { stdout: untrackedOut } = await runGitCommand(
      ["ls-files", "--others", "--exclude-standard"],
      {
        cwd,
        envOverlay: READ_ONLY_GIT_ENV,
      },
    );
    for (const file of untrackedOut
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)) {
      changes.push({
        path: file,
        status: "U",
        isNew: true,
        isDeleted: false,
        isUntracked: true,
      });
    }
  }

  // Deduplicate by path (prefer tracked status over untracked marker if both appear).
  const byPath = new Map<string, CheckoutFileChange>();
  for (const change of changes) {
    const existing = byPath.get(change.path);
    if (!existing) {
      byPath.set(change.path, change);
      continue;
    }
    if (existing.isUntracked && !change.isUntracked) {
      byPath.set(change.path, change);
    }
  }
  return Array.from(byPath.values());
}

async function readGitFileContentAtRef(
  cwd: string,
  ref: string,
  path: string,
): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["show", `${ref}:${path}`], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    return stdout;
  } catch {
    return null;
  }
}

async function tryResolveMergeBase(cwd: string, baseRef: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["merge-base", baseRef, "HEAD"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    const sha = stdout.trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}

type FileStat = { additions: number; deletions: number; isBinary: boolean } | null;

function normalizeNumstatPath(pathField: string): string {
  const braceRenameMatch = pathField.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braceRenameMatch) {
    const [, prefix, , renamed, suffix] = braceRenameMatch;
    return `${prefix}${renamed}${suffix}`;
  }

  const inlineRenameMatch = pathField.match(/^(.*) => (.*)$/);
  if (inlineRenameMatch) {
    return inlineRenameMatch[2] ?? pathField;
  }

  return pathField;
}

function buildGitDiffArgs(args: { ignoreWhitespace?: boolean; extra: string[] }): string[] {
  return ["diff", ...(args.ignoreWhitespace ? ["-w"] : []), ...args.extra];
}

const TRACKED_DIFF_NUMSTAT_MAX_BYTES = 2 * 1024 * 1024; // 2MB
const TRACKED_MAX_CHANGED_LINES = 40_000;
const EMPTY_TREE_OBJECT_ID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

function isUnbornHeadDiffError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("--name-status HEAD") &&
    error.message.includes("ambiguous argument 'HEAD'")
  );
}

async function getTrackedNumstatByPath(
  cwd: string,
  refs: CheckoutDiffRefs,
  ignoreWhitespace = false,
): Promise<Map<string, FileStat>> {
  const result = await runGitCommand(
    buildGitDiffArgs({
      ignoreWhitespace,
      extra: ["--numstat", ...getCheckoutDiffRefArgs(refs)],
    }),
    {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      maxOutputBytes: TRACKED_DIFF_NUMSTAT_MAX_BYTES,
      acceptExitCodes: [0],
    },
  );

  const stats = new Map<string, FileStat>();
  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }

    const additionsField = parts[0] ?? "";
    const deletionsField = parts[1] ?? "";
    const rawPath = parts.slice(2).join("\t");
    const path = normalizeNumstatPath(rawPath);

    if (!path) {
      continue;
    }

    if (additionsField === "-" || deletionsField === "-") {
      stats.set(path, { additions: 0, deletions: 0, isBinary: true });
      continue;
    }

    const additions = Number.parseInt(additionsField, 10);
    const deletions = Number.parseInt(deletionsField, 10);
    if (Number.isNaN(additions) || Number.isNaN(deletions)) {
      stats.set(path, null);
      continue;
    }

    stats.set(path, { additions, deletions, isBinary: false });
  }

  return stats;
}

function isTrackedDiffTooLarge(stat: FileStat): boolean {
  if (!stat || stat.isBinary) {
    return false;
  }
  return stat.additions + stat.deletions > TRACKED_MAX_CHANGED_LINES;
}

const TOTAL_DIFF_MAX_BYTES = 2 * 1024 * 1024; // 2MB
async function inspectUntrackedFile(
  cwd: string,
  relativePath: string,
): Promise<{ stat: FileStat; truncated: boolean }> {
  const absolutePath = resolve(cwd, relativePath);
  const metadata = await statFile(absolutePath);

  if (!metadata.isFile()) {
    return { stat: null, truncated: false };
  }

  if (await isLikelyBinaryFile(absolutePath)) {
    return {
      stat: { additions: 0, deletions: 0, isBinary: true },
      truncated: false,
    };
  }

  if (metadata.size > PER_FILE_DIFF_MAX_BYTES) {
    return {
      stat: { additions: 0, deletions: 0, isBinary: false },
      truncated: true,
    };
  }

  return {
    stat: { additions: 0, deletions: 0, isBinary: false },
    truncated: false,
  };
}

function buildPlaceholderParsedDiffFile(
  change: CheckoutFileChange,
  options: { status: "too_large" | "binary"; stat?: FileStat },
): ParsedDiffFile {
  return {
    path: change.path,
    isNew: change.isNew,
    isDeleted: change.isDeleted,
    additions: options.stat?.additions ?? 0,
    deletions: options.stat?.deletions ?? 0,
    hunks: [],
    status: options.status,
  };
}

async function getUntrackedDiffText(
  cwd: string,
  change: CheckoutFileChange,
  ignoreWhitespace = false,
): Promise<{ text: string; truncated: boolean; stat: FileStat }> {
  try {
    const inspected = await inspectUntrackedFile(cwd, change.path);
    if (inspected.stat?.isBinary || inspected.truncated) {
      return { text: "", truncated: inspected.truncated, stat: inspected.stat };
    }
  } catch {
    // Fall through to git diff path if metadata probing fails.
  }

  const result = await runGitCommand(
    buildGitDiffArgs({
      ignoreWhitespace,
      extra: ["--no-index", "/dev/null", "--", change.path],
    }),
    {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
      maxOutputBytes: PER_FILE_DIFF_MAX_BYTES,
      acceptExitCodes: [0, 1],
    },
  );
  return {
    text: result.stdout,
    truncated: result.truncated,
    stat: { additions: 0, deletions: 0, isBinary: false },
  };
}

interface AppendStructuredTrackedDiffsInput {
  cwd: string;
  trackedChanges: CheckoutFileChange[];
  trackedChangeByPath: Map<string, CheckoutFileChange>;
  trackedNumstatByPath: Map<string, FileStat>;
  trackedPlaceholderByPath: Map<string, { status: "binary" | "too_large"; stat: FileStat }>;
  trackedDiffText: string;
  trackedDiffTruncated: boolean;
  refsForDiff: CheckoutDiffRefs;
  ignoreWhitespace: boolean;
  structured: ParsedDiffFile[];
  appendDiff: (text: string) => void;
  appendTrackedPlaceholderComment: (
    change: CheckoutFileChange,
    status: "binary" | "too_large",
  ) => void;
}

async function appendStructuredTrackedDiffs(
  input: AppendStructuredTrackedDiffsInput,
): Promise<void> {
  const {
    cwd,
    trackedChanges,
    trackedChangeByPath,
    trackedNumstatByPath,
    trackedPlaceholderByPath,
    trackedDiffText,
    trackedDiffTruncated,
    refsForDiff,
    ignoreWhitespace,
    structured,
    appendTrackedPlaceholderComment,
  } = input;

  const parsedTrackedFiles =
    trackedDiffText.length > 0
      ? await parseAndHighlightDiff(trackedDiffText, cwd, {
          getOldFileContent: async (file) => {
            const change = trackedChangeByPath.get(file.path);
            if (!change || change.isNew) {
              return null;
            }
            const refPath = change.oldPath ?? change.path;
            return readGitFileContentAtRef(cwd, refsForDiff.baseRef, refPath);
          },
          getNewFileContent: async (file) => {
            if (!refsForDiff.targetRef) {
              return null;
            }
            return readGitFileContentAtRef(cwd, refsForDiff.targetRef, file.path);
          },
        })
      : [];
  const parsedTrackedByPath = new Map(parsedTrackedFiles.map((file) => [file.path, file]));

  for (const change of trackedChanges) {
    const placeholder = trackedPlaceholderByPath.get(change.path);
    if (placeholder) {
      structured.push(
        buildPlaceholderParsedDiffFile(change, {
          status: placeholder.status,
          stat: placeholder.stat,
        }),
      );
      appendTrackedPlaceholderComment(change, placeholder.status);
      continue;
    }

    const stat = trackedNumstatByPath.get(change.path) ?? null;
    const parsedFile = parsedTrackedByPath.get(change.path);
    if (parsedFile) {
      structured.push({
        ...parsedFile,
        path: change.path,
        isNew: change.isNew,
        isDeleted: change.isDeleted,
        status: "ok",
      });
      continue;
    }

    // `git diff -w --name-status` can still report a modified path even when the
    // whitespace-filtered patch and numstat are both empty. Skip emitting a
    // structured placeholder in that case so whitespace-only edits truly disappear.
    if (
      ignoreWhitespace &&
      !trackedDiffTruncated &&
      change.status.startsWith("M") &&
      (!stat || (!stat.isBinary && stat.additions === 0 && stat.deletions === 0))
    ) {
      continue;
    }

    structured.push({
      path: change.path,
      isNew: change.isNew,
      isDeleted: change.isDeleted,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
      hunks: [],
      status: trackedDiffTruncated ? "too_large" : "ok",
    });
  }
}

interface ProcessUntrackedChangeInput {
  cwd: string;
  change: CheckoutFileChange;
  ignoreWhitespace: boolean;
  includeStructured: boolean;
  structured: ParsedDiffFile[];
  appendDiff: (text: string) => void;
}

async function processUntrackedChange(input: ProcessUntrackedChangeInput): Promise<void> {
  const { cwd, change, ignoreWhitespace, includeStructured, structured, appendDiff } = input;
  const { text, truncated, stat } = await getUntrackedDiffText(cwd, change, ignoreWhitespace);

  if (!includeStructured) {
    if (stat?.isBinary) {
      appendDiff(`# ${change.path}: binary diff omitted\n`);
    } else if (truncated) {
      appendDiff(`# ${change.path}: diff too large omitted\n`);
    } else {
      appendDiff(text);
    }
    return;
  }

  if (stat?.isBinary) {
    structured.push(buildPlaceholderParsedDiffFile(change, { status: "binary", stat }));
    appendDiff(`# ${change.path}: binary diff omitted\n`);
    return;
  }

  if (truncated) {
    structured.push(buildPlaceholderParsedDiffFile(change, { status: "too_large", stat }));
    appendDiff(`# ${change.path}: diff too large omitted\n`);
    return;
  }

  appendDiff(text);
  const parsed = await parseAndHighlightDiff(text, cwd);
  const parsedFile =
    parsed[0] ??
    ({
      path: change.path,
      isNew: change.isNew,
      isDeleted: change.isDeleted,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
      hunks: [],
    } satisfies ParsedDiffFile);

  structured.push({
    ...parsedFile,
    path: change.path,
    isNew: change.isNew,
    isDeleted: change.isDeleted,
    status: "ok",
  });
}

async function resolveCheckoutDiffRefs<TContext>(
  cwd: string,
  compare: CheckoutDiffCompare,
  context: TContext | undefined,
  dependencies: CheckoutDiffDependencies<TContext>,
): Promise<CheckoutDiffRefs | null> {
  if (compare.mode === "uncommitted") {
    return { baseRef: "HEAD", includeUntracked: true };
  }
  const { storedBaseRef, resolvedBaseRef } = await dependencies.resolveBaseRefForCwd(cwd, context);
  const baseRef = compare.baseRef ?? resolvedBaseRef;
  if (!baseRef) {
    return null;
  }
  if (storedBaseRef && compare.baseRef && compare.baseRef !== storedBaseRef) {
    throw new Error(`Base ref mismatch: expected ${baseRef}, got ${compare.baseRef}`);
  }
  const bestBaseRef = await dependencies.resolveBestComparisonBaseRef(cwd, baseRef);
  return {
    baseRef: (await tryResolveMergeBase(cwd, bestBaseRef)) ?? bestBaseRef,
    targetRef: "HEAD",
    includeUntracked: false,
  };
}

async function readCheckoutDiff<TContext>(
  cwd: string,
  compare: CheckoutDiffCompare,
  context: TContext | undefined,
  dependencies: CheckoutDiffDependencies<TContext>,
): Promise<CheckoutDiffResult> {
  await requireGitRepo(cwd);

  const refsForDiff = await resolveCheckoutDiffRefs(cwd, compare, context, dependencies);
  if (!refsForDiff) {
    return { diff: "" };
  }

  const ignoreWhitespace = compare.ignoreWhitespace === true;
  let effectiveRefsForDiff = refsForDiff;
  let changes: CheckoutFileChange[];
  try {
    changes = await listCheckoutFileChanges(cwd, effectiveRefsForDiff, ignoreWhitespace);
  } catch (error) {
    if (!isUnbornHeadDiffError(error)) {
      throw error;
    }
    effectiveRefsForDiff = { ...refsForDiff, baseRef: EMPTY_TREE_OBJECT_ID };
    changes = await listCheckoutFileChanges(cwd, effectiveRefsForDiff, ignoreWhitespace);
  }
  changes.sort((a, b) => {
    if (a.path === b.path) return 0;
    return a.path < b.path ? -1 : 1;
  });

  const structured: ParsedDiffFile[] = [];
  let diffText = "";
  let diffBytes = 0;
  const appendDiff = (text: string) => {
    if (!text) return;
    if (diffBytes >= TOTAL_DIFF_MAX_BYTES) return;
    const buf = Buffer.from(text, "utf8");
    if (diffBytes + buf.length <= TOTAL_DIFF_MAX_BYTES) {
      diffText += text;
      diffBytes += buf.length;
      return;
    }
    const remaining = TOTAL_DIFF_MAX_BYTES - diffBytes;
    if (remaining > 0) {
      diffText += buf.subarray(0, remaining).toString("utf8");
      diffBytes = TOTAL_DIFF_MAX_BYTES;
    }
  };

  const trackedChanges = changes.filter((change) => !change.isUntracked);
  const untrackedChanges = changes.filter((change) => change.isUntracked === true);
  const trackedChangeByPath = new Map(trackedChanges.map((change) => [change.path, change]));

  const trackedNumstatByPath =
    trackedChanges.length > 0
      ? await getTrackedNumstatByPath(cwd, effectiveRefsForDiff, ignoreWhitespace)
      : new Map<string, FileStat>();
  const trackedDiffPaths: string[] = [];
  const trackedPlaceholderByPath = new Map<
    string,
    { status: "binary" | "too_large"; stat: FileStat }
  >();

  for (const change of trackedChanges) {
    const stat = trackedNumstatByPath.get(change.path) ?? null;
    if (stat?.isBinary) {
      trackedPlaceholderByPath.set(change.path, { status: "binary", stat });
      continue;
    }
    if (isTrackedDiffTooLarge(stat)) {
      trackedPlaceholderByPath.set(change.path, { status: "too_large", stat });
      continue;
    }
    trackedDiffPaths.push(change.path);
  }

  let trackedDiffText = "";
  let trackedDiffTruncated = false;
  if (trackedDiffPaths.length > 0) {
    const trackedDiffResult = await runGitCommand(
      buildGitDiffArgs({
        ignoreWhitespace,
        extra: [...getCheckoutDiffRefArgs(effectiveRefsForDiff), "--", ...trackedDiffPaths],
      }),
      {
        cwd,
        envOverlay: READ_ONLY_GIT_ENV,
        maxOutputBytes: TOTAL_DIFF_MAX_BYTES,
      },
    );
    trackedDiffText = trackedDiffResult.stdout;
    trackedDiffTruncated = trackedDiffResult.truncated;
    appendDiff(trackedDiffText);
    if (trackedDiffTruncated) {
      appendDiff("# tracked diff truncated\n");
    }
  }

  const appendTrackedPlaceholderComment = (
    change: CheckoutFileChange,
    status: "binary" | "too_large",
  ) => {
    if (status === "binary") {
      appendDiff(`# ${change.path}: binary diff omitted\n`);
      return;
    }
    appendDiff(`# ${change.path}: diff too large omitted\n`);
  };

  if (compare.includeStructured) {
    await appendStructuredTrackedDiffs({
      cwd,
      trackedChanges,
      trackedChangeByPath,
      trackedNumstatByPath,
      trackedPlaceholderByPath,
      trackedDiffText,
      trackedDiffTruncated,
      refsForDiff: effectiveRefsForDiff,
      ignoreWhitespace,
      structured,
      appendDiff,
      appendTrackedPlaceholderComment,
    });
  } else {
    for (const change of trackedChanges) {
      const placeholder = trackedPlaceholderByPath.get(change.path);
      if (placeholder) {
        appendTrackedPlaceholderComment(change, placeholder.status);
      }
    }
  }

  for (const change of untrackedChanges) {
    if (diffBytes >= TOTAL_DIFF_MAX_BYTES) {
      break;
    }
    await processUntrackedChange({
      cwd,
      change,
      ignoreWhitespace,
      includeStructured: compare.includeStructured === true,
      structured,
      appendDiff,
    });
  }

  if (compare.includeStructured) {
    return { diff: diffText, structured };
  }
  return { diff: diffText };
}

/**
 * Creates the checkout diff read authority with repository-specific base-ref resolution.
 * @param dependencies Base-ref readers owned by the checkout repository façade
 * @returns A checkout diff reader that preserves the public façade contract
 */
export function createCheckoutDiffReader<TContext>(
  dependencies: CheckoutDiffDependencies<TContext>,
): (cwd: string, compare: CheckoutDiffCompare, context?: TContext) => Promise<CheckoutDiffResult> {
  return (cwd, compare, context) => readCheckoutDiff(cwd, compare, context, dependencies);
}
