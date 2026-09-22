import { execFileText } from "./tree-kill-command.js";
import {
  rethrowCleanupDeadline,
  TREE_KILL_CLEANUP_TIMEOUT_MS,
  TreeKillCleanupDeadline,
  waitForExitOrTimeout,
  waitForProcessPoll,
} from "./tree-kill-deadline.js";
import {
  createGenericPosixTreeKillAdapter,
  createLinuxTreeKillAdapter,
  type LinuxTreeKillOperations,
  type PosixTreeKillOperations,
} from "./tree-kill-posix.js";
import {
  createWindowsTreeKillAdapter,
  type WindowsTreeKillOperations,
} from "./tree-kill-windows.js";

export {
  parseWindowsProcessRecord,
  resolveWindowsProcessQueryTimeout,
  selectOwnedWindowsProcesses,
} from "./tree-kill-windows.js";
export { parseLinuxProcStat, refreshTrackedPosixProcess } from "./tree-kill-posix.js";
export { TREE_KILL_CLEANUP_TIMEOUT_MS } from "./tree-kill-deadline.js";

const PROCESS_POLL_INTERVAL_MS = 25;

export interface TreeKillTarget {
  pid?: number;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  off?(event: "exit", listener: () => void): unknown;
  once?(event: "exit", listener: () => void): unknown;
}

interface TerminateWithTreeKillOptions {
  cleanupTimeoutMs?: number;
  closure?: Promise<void>;
  gracefulSignal?: NodeJS.Signals;
  forceSignal?: NodeJS.Signals;
  gracefulTimeoutMs: number;
  forceTimeoutMs?: number;
  onForceSignal?: () => void;
  operations?: TreeKillOperations;
  linuxOperations?: LinuxTreeKillOperations;
  ownership?: TreeKillOwnership;
  posixOperations?: PosixTreeKillOperations;
  signal?: AbortSignal;
  windowsOperations?: WindowsTreeKillOperations;
}

interface TrackedProcess {
  identity: string;
  pid: number;
  processGroupId?: number;
}

interface TreeKillOperations {
  allowsUnverifiedRootFallback?: boolean;
  snapshot(cleanupSignal: AbortSignal): Promise<TrackedProcess[]>;
  listRunning(
    processes: readonly TrackedProcess[],
    cleanupSignal: AbortSignal,
  ): Promise<TrackedProcess[]>;
  signal(
    processes: readonly TrackedProcess[],
    signal: NodeJS.Signals,
    cleanupSignal: AbortSignal,
  ): Promise<void>;
  now?: () => number;
  waitForPoll?: (delayMs: number, cleanupSignal: AbortSignal) => Promise<void>;
}

export type TerminateWithTreeKillResult =
  | "already-exited"
  | "terminated"
  | "killed"
  | "kill-timeout";

export interface TreeKillOwnership {
  launchedAtMs: number;
  processGroupId?: number;
  rootPid: number;
}

type TrackedTerminationResult =
  | TerminateWithTreeKillResult
  | "tracking-unavailable"
  | "tracking-unverified";

export async function terminateWithTreeKill(
  child: TreeKillTarget,
  options: TerminateWithTreeKillOptions,
): Promise<TerminateWithTreeKillResult> {
  const now = options.operations?.now ?? Date.now;
  const deadline = new TreeKillCleanupDeadline(
    options.cleanupTimeoutMs ?? TREE_KILL_CLEANUP_TIMEOUT_MS,
    now,
    options.signal,
  );
  try {
    const hasWindowsProcessTracking =
      options.windowsOperations !== undefined ||
      (process.platform === "win32" &&
        options.linuxOperations === undefined &&
        options.posixOperations === undefined);
    if (
      isProcessExited(child) &&
      !options.operations &&
      !options.ownership &&
      !hasWindowsProcessTracking
    ) {
      return "already-exited";
    }

    const operations =
      options.operations ??
      createDefaultTreeKillOperations(
        child,
        options.ownership,
        deadline,
        options.windowsOperations,
        options.linuxOperations,
        options.posixOperations,
      );
    const trackedResult = await terminateTrackedProcessTree(options, deadline, operations);
    if (trackedResult !== "tracking-unavailable" && trackedResult !== "tracking-unverified") {
      return trackedResult;
    }
    if (
      trackedResult === "tracking-unverified" &&
      operations?.allowsUnverifiedRootFallback === false
    ) {
      return "kill-timeout";
    }

    const fallbackResult = await terminateRootObservedTree(child, options, deadline);
    return trackedResult === "tracking-unverified" ? "kill-timeout" : fallbackResult;
  } catch (error) {
    if (deadline.signal.aborted) {
      return "kill-timeout";
    }
    throw error;
  } finally {
    deadline.dispose();
  }
}

async function terminateTrackedProcessTree(
  options: TerminateWithTreeKillOptions,
  deadline: TreeKillCleanupDeadline,
  operations: TreeKillOperations | null,
): Promise<TrackedTerminationResult> {
  if (!operations) {
    return "tracking-unavailable";
  }

  let trackedProcesses: TrackedProcess[];
  try {
    trackedProcesses = await deadline.run((cleanupSignal) => operations.snapshot(cleanupSignal));
  } catch (error) {
    rethrowCleanupDeadline(error, deadline);
    return "tracking-unverified";
  }
  if (trackedProcesses.length === 0) {
    if (options.closure) {
      try {
        await deadline.run(async () => options.closure);
        return "already-exited";
      } catch (error) {
        rethrowCleanupDeadline(error, deadline);
      }
    }
    return "tracking-unverified";
  }

  const gracefulSignal = options.gracefulSignal ?? "SIGTERM";
  const forceSignal = options.forceSignal ?? "SIGKILL";
  if (gracefulSignal === forceSignal) {
    options.onForceSignal?.();
    try {
      await deadline.run((cleanupSignal) =>
        operations.signal(trackedProcesses, forceSignal, cleanupSignal),
      );
      if (options.forceTimeoutMs === undefined) {
        return "killed";
      }
      const survivors = await waitForTrackedProcesses(
        operations,
        trackedProcesses,
        options.forceTimeoutMs,
        deadline,
      );
      return survivors.length === 0 ? "killed" : "kill-timeout";
    } catch (error) {
      rethrowCleanupDeadline(error, deadline);
      return "tracking-unverified";
    }
  }

  let survivors: TrackedProcess[];
  try {
    await deadline.run((cleanupSignal) =>
      operations.signal(trackedProcesses, gracefulSignal, cleanupSignal),
    );
    survivors = await waitForTrackedProcesses(
      operations,
      trackedProcesses,
      options.gracefulTimeoutMs,
      deadline,
    );
  } catch (error) {
    rethrowCleanupDeadline(error, deadline);
    return "tracking-unverified";
  }
  if (survivors.length === 0) {
    return "terminated";
  }

  options.onForceSignal?.();
  try {
    await deadline.run((cleanupSignal) => operations.signal(survivors, forceSignal, cleanupSignal));
    if (options.forceTimeoutMs === undefined) {
      return "killed";
    }
    survivors = await waitForTrackedProcesses(
      operations,
      survivors,
      options.forceTimeoutMs,
      deadline,
    );
    return survivors.length === 0 ? "killed" : "kill-timeout";
  } catch (error) {
    rethrowCleanupDeadline(error, deadline);
    return "tracking-unverified";
  }
}

async function terminateRootObservedTree(
  child: TreeKillTarget,
  options: TerminateWithTreeKillOptions,
  deadline: TreeKillCleanupDeadline,
): Promise<TerminateWithTreeKillResult> {
  if (isProcessExited(child)) {
    return "already-exited";
  }

  const isChildExited = () => isProcessExited(child);
  const gracefulSignal = options.gracefulSignal ?? "SIGTERM";
  const forceSignal = options.forceSignal ?? "SIGKILL";
  if (gracefulSignal === forceSignal) {
    options.onForceSignal?.();
    await deadline.run((cleanupSignal) =>
      signalTreeOrChild(child, forceSignal, cleanupSignal, deadline.remainingMs()),
    );
    if (options.forceTimeoutMs === undefined) {
      return "killed";
    }
    return (await waitForExitOrTimeout(child, isChildExited, options.forceTimeoutMs, deadline))
      ? "killed"
      : "kill-timeout";
  }

  await deadline.run((cleanupSignal) =>
    signalTreeOrChild(child, gracefulSignal, cleanupSignal, deadline.remainingMs()),
  );
  if (await waitForExitOrTimeout(child, isChildExited, options.gracefulTimeoutMs, deadline)) {
    return "terminated";
  }

  options.onForceSignal?.();
  await deadline.run((cleanupSignal) =>
    signalTreeOrChild(child, forceSignal, cleanupSignal, deadline.remainingMs()),
  );
  if (options.forceTimeoutMs === undefined) {
    return "killed";
  }
  return (await waitForExitOrTimeout(child, isChildExited, options.forceTimeoutMs, deadline))
    ? "killed"
    : "kill-timeout";
}

function createDefaultTreeKillOperations(
  child: TreeKillTarget,
  ownership: TreeKillOwnership | undefined,
  deadline: TreeKillCleanupDeadline,
  windowsOperations?: WindowsTreeKillOperations,
  linuxOperations?: LinuxTreeKillOperations,
  posixOperations?: PosixTreeKillOperations,
): TreeKillOperations | null {
  const pid = ownership?.rootPid ?? child.pid;
  if (typeof pid !== "number" || pid <= 0) {
    return null;
  }
  if (windowsOperations || (process.platform === "win32" && !linuxOperations && !posixOperations)) {
    return createWindowsTreeKillAdapter({
      launchedAtMs: ownership?.launchedAtMs,
      operations: windowsOperations,
      queryDeadlineMs: deadline.expiresAtMs,
      rootExited: () => isProcessExited(child),
      rootPid: pid,
    });
  }
  if (linuxOperations || (process.platform === "linux" && !posixOperations)) {
    return createLinuxTreeKillAdapter({
      operations: linuxOperations,
      processGroupId: ownership?.processGroupId,
      rootPid: pid,
    });
  }
  return createGenericPosixTreeKillAdapter({
    operations: posixOperations,
    processGroupId: ownership?.processGroupId,
    rootPid: pid,
  });
}

async function waitForTrackedProcesses(
  operations: TreeKillOperations,
  processes: readonly TrackedProcess[],
  timeoutMs: number,
  cleanupDeadline: TreeKillCleanupDeadline,
): Promise<TrackedProcess[]> {
  const now = operations.now ?? Date.now;
  const waitForPoll = operations.waitForPoll ?? waitForProcessPoll;
  const phaseDeadlineMs = Math.min(cleanupDeadline.expiresAtMs, now() + Math.max(0, timeoutMs));
  let survivors = await cleanupDeadline.run((cleanupSignal) =>
    operations.listRunning(processes, cleanupSignal),
  );
  while (survivors.length > 0) {
    const remainingMs = phaseDeadlineMs - now();
    if (remainingMs <= 0) {
      break;
    }
    await cleanupDeadline.run((cleanupSignal) =>
      waitForPoll(Math.min(PROCESS_POLL_INTERVAL_MS, remainingMs), cleanupSignal),
    );
    survivors = await cleanupDeadline.run((cleanupSignal) =>
      operations.listRunning(survivors, cleanupSignal),
    );
  }
  return survivors;
}

async function signalTreeOrChild(
  child: TreeKillTarget,
  signal: NodeJS.Signals,
  cleanupSignal: AbortSignal,
  remainingMs: number,
): Promise<void> {
  if (isProcessExited(child)) {
    return;
  }

  const pid = child.pid;
  if (typeof pid !== "number" || pid <= 0) {
    signalDirectChild(child, signal);
    return;
  }
  if (process.platform !== "win32") {
    signalDirectChild(child, signal);
    return;
  }

  try {
    await execFileText("taskkill.exe", ["/pid", String(pid), "/T", "/F"], {
      signal: cleanupSignal,
      timeout: Math.max(1, Math.floor(remainingMs)),
    });
  } catch (error) {
    if (cleanupSignal.aborted) {
      throw error;
    }
    signalDirectChild(child, signal);
  }
}

function signalDirectChild(child: TreeKillTarget, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    // Ignore cleanup races.
  }
}

function isProcessExited(child: TreeKillTarget): boolean {
  return (
    (child.exitCode !== null && child.exitCode !== undefined) ||
    (child.signalCode !== null && child.signalCode !== undefined)
  );
}

const FORCE_KILL_FALLBACK_TIMEOUT_MS = 500;

/**
 * Terminates a child process tree and force-kills the root PID when tree
 * tracking fails closed. `terminateWithTreeKill` returns `kill-timeout`
 * without sending any signal when Windows lineage verification fails (e.g. an
 * unowned root after the child already exited). For long-lived provider
 * processes (Pi/Codex/OpenCode) that leak OS processes in that case, this
 * wrapper falls back to a direct `process.kill(pid, SIGKILL)` so the root is
 * reaped even when the tree could not be verified.
 * @param child The spawned process to terminate
 * @param options Termination options; same shape as `terminateWithTreeKill`
 * @returns The termination result; `killed` when the fallback reaped the root
 */
export async function terminateProcessTreeWithFallback(
  child: TreeKillTarget,
  options: TerminateWithTreeKillOptions,
): Promise<TerminateWithTreeKillResult> {
  const result = await terminateWithTreeKill(child, options);
  if (result !== "kill-timeout") {
    return result;
  }
  // The tracked path returns kill-timeout when Windows lineage verification
  // fails, even when the child already exited gracefully. Treat an exited
  // child as a successful termination so callers do not log a spurious
  // "did not report exit after SIGKILL" warning for an already-reaped process.
  if (isProcessExited(child)) {
    return "killed";
  }
  const pid = child.pid;
  if (typeof pid !== "number" || pid <= 0) {
    return result;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Process may have exited between the check and the kill; nothing to do.
    return result;
  }
  const deadline = new TreeKillCleanupDeadline(
    FORCE_KILL_FALLBACK_TIMEOUT_MS,
    options.operations?.now ?? Date.now,
    options.signal,
  );
  try {
    const exited = await waitForExitOrTimeout(
      child,
      () => isProcessExited(child),
      FORCE_KILL_FALLBACK_TIMEOUT_MS,
      deadline,
    );
    return exited ? "killed" : "kill-timeout";
  } finally {
    deadline.dispose();
  }
}
