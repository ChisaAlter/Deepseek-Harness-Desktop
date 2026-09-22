import { readFile } from "node:fs/promises";
import { execFileText } from "./tree-kill-command.js";

interface PosixTrackedProcess {
  identity: string;
  pid: number;
  processGroupId?: number;
}

export interface PosixProcessRecord {
  identity: string;
  parentPid: number;
  pid: number;
  processGroupId: number;
}

export interface LinuxTreeKillOperations {
  readProcess(pid: number): Promise<PosixProcessRecord | null>;
  readTopology(cleanupSignal?: AbortSignal): Promise<Map<number, PosixProcessRecord>>;
  signal(pid: number, signal: NodeJS.Signals): void;
  signalProcessGroup(processGroupId: number, signal: NodeJS.Signals): void;
}

export interface PosixProcessTableSnapshot {
  complete: boolean;
  records: Map<number, PosixProcessRecord>;
}

export type ReadPosixProcessTable = (
  cleanupSignal?: AbortSignal,
) => Promise<PosixProcessTableSnapshot>;

export type ReadPosixProcessTableOutput = (cleanupSignal?: AbortSignal) => Promise<string>;

export interface PosixTreeKillOperations {
  readProcessTable?: ReadPosixProcessTable;
  readProcessTableOutput?: ReadPosixProcessTableOutput;
  signal(pid: number, signal: NodeJS.Signals): void;
  signalProcessGroup(processGroupId: number, signal: NodeJS.Signals): void;
}

export interface PosixTreeKillAdapterOperations {
  snapshot(cleanupSignal: AbortSignal): Promise<PosixTrackedProcess[]>;
  listRunning(
    processes: readonly PosixTrackedProcess[],
    cleanupSignal: AbortSignal,
  ): Promise<PosixTrackedProcess[]>;
  signal(
    processes: readonly PosixTrackedProcess[],
    signal: NodeJS.Signals,
    cleanupSignal: AbortSignal,
  ): Promise<void>;
}

interface CreatePosixTreeKillAdapterOptions {
  operations?: PosixTreeKillOperations;
  processGroupId?: number;
  rootPid: number;
}

interface CreateLinuxTreeKillAdapterOptions {
  operations?: LinuxTreeKillOperations;
  processGroupId?: number;
  rootPid: number;
}

/** Creates Linux procfs-backed process identity operations. */
export function createLinuxTreeKillAdapter(
  options: CreateLinuxTreeKillAdapterOptions,
): PosixTreeKillAdapterOperations {
  const operations = options.operations ?? createDefaultLinuxOperations();
  return {
    async snapshot(cleanupSignal) {
      return snapshotLinuxProcessTree(
        options.rootPid,
        options.processGroupId,
        cleanupSignal,
        operations,
      );
    },
    async listRunning(processes) {
      return listRunningLinuxProcesses(processes, operations.readProcess);
    },
    async signal(processes, signal) {
      const running = await listSignalableLinuxProcesses(processes, operations.readProcess);
      signalTrackedProcesses(running, options.processGroupId, signal, operations);
    },
  };
}

/** Creates generic POSIX process-table identity operations. */
export function createGenericPosixTreeKillAdapter(
  options: CreatePosixTreeKillAdapterOptions,
): PosixTreeKillAdapterOperations {
  const operations = options.operations ?? createDefaultPosixOperations();
  const readProcessTable =
    operations.readProcessTable ??
    ((cleanupSignal?: AbortSignal) =>
      readPsProcessTableWithIdentity(cleanupSignal, operations.readProcessTableOutput));
  return {
    async snapshot(cleanupSignal) {
      return snapshotGenericPosixProcessTree(
        options.rootPid,
        options.processGroupId,
        cleanupSignal,
        readProcessTable,
      );
    },
    async listRunning(processes, cleanupSignal) {
      return listRunningGenericPosixProcesses(processes, cleanupSignal, readProcessTable);
    },
    async signal(processes, signal, cleanupSignal) {
      const running = await listSignalableGenericPosixProcesses(
        processes,
        cleanupSignal,
        readProcessTable,
      );
      signalTrackedProcesses(running, options.processGroupId, signal, operations);
    },
  };
}

/**
 * Refreshes process-group ownership after verifying a stable POSIX identity.
 * @param tracked Process identity captured for cleanup
 * @param current Current process-table record for the same PID
 * @returns Refreshed tracking metadata, or null when the PID identity changed
 */
export function refreshTrackedPosixProcess(
  tracked: PosixTrackedProcess,
  current: PosixProcessRecord | null,
): PosixTrackedProcess | null {
  if (!current || current.identity !== tracked.identity) {
    return null;
  }
  return {
    identity: tracked.identity,
    pid: tracked.pid,
    processGroupId: current.processGroupId,
  };
}

/**
 * Parses stable Linux process identity fields from `/proc/<pid>/stat`.
 * @param pid Expected process ID from the procfs directory name
 * @param value Raw procfs stat record
 * @returns The process record, or null when the record is malformed
 */
export function parseLinuxProcStat(pid: number, value: string): PosixProcessRecord | null {
  const commandStart = value.indexOf("(");
  const commandEnd = value.lastIndexOf(")");
  if (commandStart <= 0 || commandEnd <= commandStart) {
    return null;
  }
  const parsedPid = Number.parseInt(value.slice(0, commandStart).trim(), 10);
  const fields = value
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/u);
  const parentPid = Number.parseInt(fields[1] ?? "", 10);
  const processGroupId = Number.parseInt(fields[2] ?? "", 10);
  const startTime = fields[19];
  if (
    parsedPid !== pid ||
    parentPid < 0 ||
    processGroupId <= 0 ||
    !startTime ||
    !/^\d+$/u.test(startTime)
  ) {
    return null;
  }
  return {
    identity: `linux-starttime:${startTime}`,
    parentPid,
    pid,
    processGroupId,
  };
}

async function snapshotGenericPosixProcessTree(
  rootPid: number,
  processGroupId: number | undefined,
  cleanupSignal: AbortSignal,
  readProcessTable: ReadPosixProcessTable,
): Promise<PosixTrackedProcess[]> {
  const processTable = await readProcessTable(cleanupSignal);
  if (!processTable.complete) {
    throw new Error("POSIX process table snapshot was incomplete");
  }
  const trackedPids = collectOwnedProcessPids(rootPid, processGroupId, processTable.records);
  return trackedPids.flatMap((pid) => {
    const process = processTable.records.get(pid);
    return process
      ? [{ identity: process.identity, pid, processGroupId: process.processGroupId }]
      : [];
  });
}

async function snapshotLinuxProcessTree(
  rootPid: number,
  processGroupId: number | undefined,
  cleanupSignal: AbortSignal,
  operations: Pick<LinuxTreeKillOperations, "readProcess" | "readTopology">,
): Promise<PosixTrackedProcess[]> {
  const processTable = await operations.readTopology(cleanupSignal);
  const trackedPids = collectOwnedProcessPids(rootPid, processGroupId, processTable);
  const tracked: PosixTrackedProcess[] = [];
  for (const pid of trackedPids) {
    const process = await operations.readProcess(pid);
    const expected = processTable.get(pid);
    if (!process) {
      continue;
    }
    if (
      !expected ||
      process.parentPid !== expected.parentPid ||
      process.processGroupId !== expected.processGroupId
    ) {
      throw new Error(`Process ${pid} changed while its tree was being captured`);
    }
    tracked.push({
      identity: process.identity,
      pid,
      processGroupId: process.processGroupId,
    });
  }
  return tracked;
}

function collectOwnedProcessPids(
  rootPid: number,
  processGroupId: number | undefined,
  processTable: ReadonlyMap<number, PosixProcessRecord>,
): number[] {
  const owned = new Set<number>();
  if (processTable.has(rootPid)) {
    for (const pid of collectProcessTreePids(rootPid, processTable)) {
      owned.add(pid);
    }
  }
  if (processGroupId !== undefined) {
    for (const process of processTable.values()) {
      if (process.processGroupId === processGroupId) {
        owned.add(process.pid);
      }
    }
  }
  return orderProcessPidsChildFirst(owned, processTable);
}

function orderProcessPidsChildFirst(
  pids: ReadonlySet<number>,
  processTable: ReadonlyMap<number, { parentPid: number }>,
): number[] {
  const depthByPid = new Map<number, number>();
  const getDepth = (pid: number): number => {
    const knownDepth = depthByPid.get(pid);
    if (knownDepth !== undefined) {
      return knownDepth;
    }
    const parentPid = processTable.get(pid)?.parentPid;
    const depth = parentPid !== undefined && pids.has(parentPid) ? getDepth(parentPid) + 1 : 0;
    depthByPid.set(pid, depth);
    return depth;
  };
  return [...pids].sort((left, right) => getDepth(right) - getDepth(left));
}

function collectProcessTreePids(
  rootPid: number,
  processTable: ReadonlyMap<number, { parentPid: number }>,
): number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const [pid, process] of processTable) {
    const children = childrenByParent.get(process.parentPid) ?? [];
    children.push(pid);
    childrenByParent.set(process.parentPid, children);
  }

  const tracked: number[] = [];
  const visit = (pid: number): void => {
    for (const childPid of childrenByParent.get(pid) ?? []) {
      visit(childPid);
    }
    tracked.push(pid);
  };
  visit(rootPid);
  return tracked;
}

async function listRunningGenericPosixProcesses(
  processes: readonly PosixTrackedProcess[],
  cleanupSignal: AbortSignal,
  readProcessTable: ReadPosixProcessTable,
): Promise<PosixTrackedProcess[]> {
  let processTable: PosixProcessTableSnapshot;
  try {
    processTable = await readProcessTable(cleanupSignal);
  } catch {
    return [...processes];
  }
  if (!processTable.complete) {
    return [...processes];
  }
  return processes.flatMap((process) => {
    const refreshed = refreshTrackedPosixProcess(
      process,
      processTable.records.get(process.pid) ?? null,
    );
    return refreshed ? [refreshed] : [];
  });
}

async function listSignalableGenericPosixProcesses(
  processes: readonly PosixTrackedProcess[],
  cleanupSignal: AbortSignal,
  readProcessTable: ReadPosixProcessTable,
): Promise<PosixTrackedProcess[]> {
  const processTable = await readProcessTable(cleanupSignal);
  if (!processTable.complete) {
    throw new Error("POSIX process table refresh was incomplete before signaling");
  }
  return processes.flatMap((process) => {
    const refreshed = refreshTrackedPosixProcessForSignal(
      process,
      processTable.records.get(process.pid) ?? null,
    );
    return refreshed ? [refreshed] : [];
  });
}

async function listRunningLinuxProcesses(
  processes: readonly PosixTrackedProcess[],
  readProcess: LinuxTreeKillOperations["readProcess"],
): Promise<PosixTrackedProcess[]> {
  const running: PosixTrackedProcess[] = [];
  for (const process of processes) {
    try {
      const current = await readProcess(process.pid);
      const refreshed = refreshTrackedPosixProcess(process, current);
      if (refreshed) {
        running.push(refreshed);
      }
    } catch {
      running.push(process);
    }
  }
  return running;
}

async function listSignalableLinuxProcesses(
  processes: readonly PosixTrackedProcess[],
  readProcess: LinuxTreeKillOperations["readProcess"],
): Promise<PosixTrackedProcess[]> {
  const running: PosixTrackedProcess[] = [];
  for (const process of processes) {
    const current = await readProcess(process.pid);
    const refreshed = refreshTrackedPosixProcessForSignal(process, current);
    if (refreshed) {
      running.push(refreshed);
    }
  }
  return running;
}

function refreshTrackedPosixProcessForSignal(
  tracked: PosixTrackedProcess,
  current: PosixProcessRecord | null,
): PosixTrackedProcess | null {
  if (current === null) {
    return null;
  }
  if (current.pid !== tracked.pid || current.identity !== tracked.identity) {
    throw new Error(`Process ${tracked.pid} identity changed before signaling`);
  }
  return {
    identity: tracked.identity,
    pid: tracked.pid,
    processGroupId: current.processGroupId,
  };
}

function signalTrackedProcesses(
  processes: readonly PosixTrackedProcess[],
  processGroupId: number | undefined,
  signal: NodeJS.Signals,
  operations: Pick<LinuxTreeKillOperations, "signal" | "signalProcessGroup">,
): void {
  const hasProcessGroupAnchor =
    processGroupId !== undefined &&
    processes.some((process) => process.processGroupId === processGroupId);
  if (hasProcessGroupAnchor) {
    operations.signalProcessGroup(processGroupId, signal);
  }
  for (const process of processes) {
    if (hasProcessGroupAnchor && process.processGroupId === processGroupId) {
      continue;
    }
    operations.signal(process.pid, signal);
  }
}

function createDefaultLinuxOperations(): LinuxTreeKillOperations {
  return {
    readProcess: readLinuxProcessRecord,
    readTopology: readPosixProcessTopology,
    signal: signalPid,
    signalProcessGroup,
  };
}

function createDefaultPosixOperations(): PosixTreeKillOperations {
  return {
    signal: signalPid,
    signalProcessGroup,
  };
}

async function readPosixProcessTopology(
  cleanupSignal?: AbortSignal,
): Promise<Map<number, PosixProcessRecord>> {
  const stdout = await execFileText("ps", ["-eo", "pid=,ppid=,pgid="], {
    signal: cleanupSignal,
  });
  const processTable = new Map<number, PosixProcessRecord>();
  for (const line of stdout.split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/u.exec(line);
    if (!match) {
      continue;
    }
    const pid = Number.parseInt(match[1] ?? "", 10);
    const parentPid = Number.parseInt(match[2] ?? "", 10);
    const processGroupId = Number.parseInt(match[3] ?? "", 10);
    if (pid > 0 && parentPid >= 0 && processGroupId > 0) {
      processTable.set(pid, { identity: "", parentPid, pid, processGroupId });
    }
  }
  return processTable;
}

async function readPsProcessTableWithIdentity(
  cleanupSignal?: AbortSignal,
  readOutput: ReadPosixProcessTableOutput = readPsProcessTableOutput,
): Promise<PosixProcessTableSnapshot> {
  const stdout = await readOutput(cleanupSignal);
  return parsePsProcessTableWithIdentity(stdout);
}

async function readPsProcessTableOutput(cleanupSignal?: AbortSignal): Promise<string> {
  // macOS has no procfs starttime. lstart is second-resolution, so identity remains
  // best-effort there; bounded polling and child-first signaling keep the reuse window small.
  const args =
    process.platform === "darwin"
      ? ["-axo", "pid=,ppid=,pgid=,lstart="]
      : ["-eo", "pid=,ppid=,pgid=,lstart="];
  return execFileText("ps", args, { signal: cleanupSignal });
}

function parsePsProcessTableWithIdentity(value: string): PosixProcessTableSnapshot {
  const records = new Map<number, PosixProcessRecord>();
  let complete = true;
  let sawRecord = false;
  for (const line of value.split(/\r?\n/u)) {
    if (line.trim().length === 0) {
      continue;
    }
    sawRecord = true;
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/u.exec(line);
    if (!match) {
      complete = false;
      continue;
    }
    const pid = Number.parseInt(match[1] ?? "", 10);
    const parentPid = Number.parseInt(match[2] ?? "", 10);
    const processGroupId = Number.parseInt(match[3] ?? "", 10);
    const normalizedIdentity = (match[4] ?? "").trim();
    const isValid =
      Number.isSafeInteger(pid) &&
      pid > 0 &&
      Number.isSafeInteger(parentPid) &&
      parentPid >= 0 &&
      Number.isSafeInteger(processGroupId) &&
      processGroupId > 0 &&
      normalizedIdentity.length > 0 &&
      !records.has(pid);
    if (!isValid) {
      complete = false;
      continue;
    }
    records.set(pid, { identity: normalizedIdentity, parentPid, pid, processGroupId });
  }
  return { complete: complete && sawRecord, records };
}

async function readLinuxProcessRecord(pid: number): Promise<PosixProcessRecord | null> {
  let value: string;
  try {
    value = await readFile(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ESRCH") {
      return null;
    }
    throw error;
  }
  const process = parseLinuxProcStat(pid, value);
  if (!process) {
    throw new Error(`Unable to parse /proc/${pid}/stat`);
  }
  return process;
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // Ignore cleanup races.
  }
}

function signalProcessGroup(processGroupId: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-processGroupId, signal);
  } catch {
    // Ignore cleanup races.
  }
}
