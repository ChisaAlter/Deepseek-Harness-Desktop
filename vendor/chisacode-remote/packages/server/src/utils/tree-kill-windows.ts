import { execFileText } from "./tree-kill-command.js";

const WINDOWS_PROCESS_QUERY_TIMEOUT_MS = 5_000;
const WINDOWS_CREATION_TIME_TOLERANCE_MS = 1_000;

interface WindowsTrackedProcess {
  identity: string;
  pid: number;
  processGroupId?: number;
}

export interface WindowsProcessRecord extends WindowsTrackedProcess {
  creationTimeMs: number;
  parentPid: number;
}

export interface WindowsTreeKillOperations {
  query(cleanupSignal: AbortSignal): Promise<WindowsProcessRecord[]>;
  signal(pid: number, signal: NodeJS.Signals): void;
  isRunning(pid: number): boolean;
}

export interface WindowsTreeKillAdapterOperations {
  allowsUnverifiedRootFallback: false;
  snapshot(cleanupSignal: AbortSignal): Promise<WindowsTrackedProcess[]>;
  listRunning(
    processes: readonly WindowsTrackedProcess[],
    cleanupSignal: AbortSignal,
  ): Promise<WindowsTrackedProcess[]>;
  signal(
    processes: readonly WindowsTrackedProcess[],
    signal: NodeJS.Signals,
    cleanupSignal: AbortSignal,
  ): Promise<void>;
}

interface CreateWindowsTreeKillAdapterOptions {
  launchedAtMs?: number;
  operations?: WindowsTreeKillOperations;
  queryDeadlineMs: number;
  rootExited(): boolean;
  rootPid: number;
}

interface RawWindowsProcessRecord {
  CreationDate?: unknown;
  ParentProcessId?: unknown;
  ProcessId?: unknown;
}

class WindowsProcessOwnershipUnverifiedError extends Error {
  readonly code = "EXEC_COMMAND_PROCESS_OWNERSHIP_UNVERIFIED";

  constructor() {
    super("Windows root PID was reused without a provable prior process lineage");
    this.name = "WindowsProcessOwnershipUnverifiedError";
  }
}

interface WindowsProcessSelectionOptions {
  launchedAtMs?: number;
  processes: readonly WindowsProcessRecord[];
  rootExited: boolean;
  rootPid: number;
}

/** Creates fail-closed Windows process-tree tracking operations. */
export function createWindowsTreeKillAdapter(
  options: CreateWindowsTreeKillAdapterOptions,
): WindowsTreeKillAdapterOperations {
  const operations =
    options.operations ?? createDefaultWindowsTreeKillOperations(options.queryDeadlineMs);
  return {
    allowsUnverifiedRootFallback: false,
    async snapshot(cleanupSignal) {
      const processes = await operations.query(cleanupSignal);
      return selectOwnedWindowsProcesses({
        launchedAtMs: options.launchedAtMs,
        processes,
        rootExited: options.rootExited(),
        rootPid: options.rootPid,
      });
    },
    async listRunning(processes) {
      return processes.filter((process) => operations.isRunning(process.pid));
    },
    async signal(processes, signal, cleanupSignal) {
      const running = await listIdentityMatchingWindowsProcesses(
        processes,
        operations.query,
        cleanupSignal,
      );
      for (const process of running) {
        operations.signal(process.pid, signal);
      }
    },
  };
}

/**
 * Selects Windows process records in child-first termination order.
 * @param options Root identity state and the current Win32 process snapshot
 * @returns Process records that belong to the selected root lineage
 * @throws {Error} If ownership cannot be verified after root exit, disappearance, or reuse
 */
export function selectOwnedWindowsProcesses(
  options: WindowsProcessSelectionOptions,
): WindowsProcessRecord[] {
  const finiteLaunchedAtMs =
    typeof options.launchedAtMs === "number" && Number.isFinite(options.launchedAtMs)
      ? options.launchedAtMs
      : undefined;
  const earliestCreationTime =
    finiteLaunchedAtMs === undefined
      ? Number.NEGATIVE_INFINITY
      : finiteLaunchedAtMs - WINDOWS_CREATION_TIME_TOLERANCE_MS;
  const eligibleProcesses = options.processes.filter(
    (process) => process.creationTimeMs >= earliestCreationTime,
  );
  const currentRoot = eligibleProcesses.find((process) => process.pid === options.rootPid);
  if (finiteLaunchedAtMs === undefined && (options.rootExited || currentRoot === undefined)) {
    throw new WindowsProcessOwnershipUnverifiedError();
  }
  const ownershipEligibleProcesses = eligibleProcesses.filter(
    (process) =>
      process.pid === options.rootPid ||
      finiteLaunchedAtMs === undefined ||
      process.creationTimeMs >= finiteLaunchedAtMs,
  );
  const oldLineageAnchors =
    finiteLaunchedAtMs !== undefined && currentRoot
      ? ownershipEligibleProcesses.filter(
          (process) =>
            process.parentPid === options.rootPid &&
            process.pid !== options.rootPid &&
            process.creationTimeMs < currentRoot.creationTimeMs,
        )
      : [];
  const rootReuseProven =
    currentRoot !== undefined && (options.rootExited || oldLineageAnchors.length > 0);
  const eligibleTable = new Map(
    ownershipEligibleProcesses
      .filter((process) => !rootReuseProven || process.pid !== options.rootPid)
      .map((process) => [process.pid, process] as const),
  );
  const owned = new Set<number>();
  const childrenByParent = new Map<number, number[]>();
  for (const process of eligibleTable.values()) {
    const children = childrenByParent.get(process.parentPid) ?? [];
    children.push(process.pid);
    childrenByParent.set(process.parentPid, children);
  }
  const visit = (pid: number, parentCreationTime?: number): void => {
    for (const childPid of childrenByParent.get(pid) ?? []) {
      const child = eligibleTable.get(childPid);
      if (!child) {
        continue;
      }
      if (parentCreationTime !== undefined && child.creationTimeMs < parentCreationTime) {
        continue;
      }
      visit(childPid, child.creationTimeMs);
    }
    if (eligibleTable.has(pid)) {
      owned.add(pid);
    }
  };
  if (rootReuseProven) {
    for (const anchor of oldLineageAnchors) {
      visit(anchor.pid, anchor.creationTimeMs);
    }
  } else {
    visit(options.rootPid, eligibleTable.get(options.rootPid)?.creationTimeMs);
  }
  const selected = [...owned].flatMap((pid) => {
    const process = eligibleTable.get(pid);
    return process ? [process] : [];
  });
  if (rootReuseProven && selected.length === 0) {
    throw new WindowsProcessOwnershipUnverifiedError();
  }
  return selected;
}

/**
 * Resolves one Windows process-query timeout from a shared cleanup deadline.
 * @param queryDeadlineMs Absolute deadline shared by all termination queries
 * @param nowMs Current time, injectable for deterministic tests
 * @returns The bounded timeout for the next query
 * @throws {Error} If the shared query budget has been exhausted
 */
export function resolveWindowsProcessQueryTimeout(
  queryDeadlineMs: number,
  nowMs = Date.now(),
): number {
  const remainingMs = Math.floor(queryDeadlineMs - nowMs);
  if (remainingMs <= 0) {
    const error = new Error("Windows process-query cleanup budget was exhausted") as Error & {
      code: string;
    };
    error.code = "EXEC_COMMAND_PROCESS_QUERY_TIMEOUT";
    throw error;
  }
  return Math.min(WINDOWS_PROCESS_QUERY_TIMEOUT_MS, remainingMs);
}

/**
 * Parses a Win32 process record with a stable creation-time identity.
 * @param value Raw record returned by PowerShell `ConvertTo-Json`
 * @returns The normalized record, or null when required fields are invalid
 */
export function parseWindowsProcessRecord(value: unknown): WindowsProcessRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as RawWindowsProcessRecord;
  const pid = Number(record.ProcessId);
  const parentPid = Number(record.ParentProcessId);
  const creationTimeMs = parseWindowsCreationTime(record.CreationDate);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(parentPid) || parentPid < 0) {
    return null;
  }
  if (creationTimeMs === null) {
    return null;
  }
  return {
    creationTimeMs,
    identity: `windows-creation:${creationTimeMs}`,
    parentPid,
    pid,
  };
}

function createDefaultWindowsTreeKillOperations(
  queryDeadlineMs: number,
): WindowsTreeKillOperations {
  return {
    async query(cleanupSignal) {
      const processTable = await readWindowsProcessTable(queryDeadlineMs, cleanupSignal);
      return [...processTable.values()];
    },
    isRunning: isPidRunning,
    signal: signalPid,
  };
}

async function listIdentityMatchingWindowsProcesses(
  processes: readonly WindowsTrackedProcess[],
  query: WindowsTreeKillOperations["query"],
  cleanupSignal: AbortSignal,
): Promise<WindowsTrackedProcess[]> {
  const processTable = new Map(
    (await query(cleanupSignal)).map((process) => [process.pid, process] as const),
  );
  return processes.filter(
    (process) => processTable.get(process.pid)?.identity === process.identity,
  );
}

async function readWindowsProcessTable(
  queryDeadlineMs: number,
  cleanupSignal?: AbortSignal,
): Promise<Map<number, WindowsProcessRecord>> {
  const timeout = resolveWindowsProcessQueryTimeout(queryDeadlineMs);
  const stdout = await execFileText(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress",
    ],
    { signal: cleanupSignal, timeout },
  );
  const parsed = JSON.parse(stdout) as RawWindowsProcessRecord | RawWindowsProcessRecord[];
  const records = Array.isArray(parsed) ? parsed : [parsed];
  const processTable = new Map<number, WindowsProcessRecord>();
  for (const record of records) {
    const process = parseWindowsProcessRecord(record);
    if (process) {
      processTable.set(process.pid, process);
    }
  }
  return processTable;
}

function parseWindowsCreationTime(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const serializedDate = /^\/Date\((\d+)\)\/$/u.exec(value);
  if (serializedDate) {
    return Number.parseInt(serializedDate[1] ?? "", 10);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // Ignore cleanup races.
  }
}
