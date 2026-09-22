import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  parseLinuxProcStat,
  parseWindowsProcessRecord,
  refreshTrackedPosixProcess,
  resolveWindowsProcessQueryTimeout,
  selectOwnedWindowsProcesses,
  terminateProcessTreeWithFallback,
  terminateWithTreeKill,
} from "./tree-kill.js";

interface WindowsProcessSelectionRecord {
  creationTimeMs: number;
  identity: string;
  parentPid: number;
  pid: number;
}

interface TestWindowsOperations {
  query(cleanupSignal: AbortSignal): Promise<WindowsProcessSelectionRecord[]>;
  signal(pid: number, signal: NodeJS.Signals): void;
  isRunning(pid: number): boolean;
}

interface LinuxProcessSelectionRecord {
  identity: string;
  parentPid: number;
  pid: number;
  processGroupId: number;
}

interface TestLinuxOperations {
  readProcess(pid: number): Promise<LinuxProcessSelectionRecord | null>;
  readTopology(): Promise<Map<number, LinuxProcessSelectionRecord>>;
  signal(pid: number, signal: NodeJS.Signals): void;
  signalProcessGroup(processGroupId: number, signal: NodeJS.Signals): void;
}

interface TestPosixProcessTable {
  complete: boolean;
  records: Map<number, LinuxProcessSelectionRecord>;
}

interface TestPosixOperations {
  readProcessTable(cleanupSignal?: AbortSignal): Promise<TestPosixProcessTable>;
  signal(pid: number, signal: NodeJS.Signals): void;
  signalProcessGroup(processGroupId: number, signal: NodeJS.Signals): void;
}

interface TestPosixOutputOperations {
  readProcessTableOutput(cleanupSignal?: AbortSignal): Promise<string>;
  signal(pid: number, signal: NodeJS.Signals): void;
  signalProcessGroup(processGroupId: number, signal: NodeJS.Signals): void;
}

let tempDir: string | null = null;
let ownerProcess: ChildProcess | null = null;
let descendantPid: number | null = null;

function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  check: () => Promise<boolean> | boolean,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  async function poll(): Promise<void> {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setImmediate(resolve));
    return poll();
  }
  return poll();
}

async function readPidFileNumber(filePath: string): Promise<number | null> {
  try {
    const raw = (await readFile(filePath, "utf-8")).trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function killIfRunning(pid: number | null | undefined): void {
  if (!pid || !isProcessRunning(pid)) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Ignore cleanup races.
  }
}

function spawnOwnerWithDescendant(options: {
  childPidPath: string;
  detachedDescendant: boolean;
}): ChildProcess {
  const descendantOptions = options.detachedDescendant
    ? '{ detached: true, stdio: "ignore" }'
    : '{ stdio: "ignore" }';
  const childUnref = options.detachedDescendant ? "child.unref();" : "";

  return spawn(
    process.execPath,
    [
      "-e",
      `
        const { spawn } = require("node:child_process");
        process.on("SIGTERM", () => {});
        const child = spawn(process.execPath, [
          "-e",
          ${JSON.stringify(`
            const fs = require("node:fs");
            process.on("SIGTERM", () => {});
            fs.writeFileSync(${JSON.stringify(options.childPidPath)}, String(process.pid));
            setInterval(() => {}, 1000);
          `)}
        ], ${descendantOptions});
        ${childUnref}
        setInterval(() => {}, 1000);
      `,
    ],
    { stdio: "ignore" },
  );
}

async function waitForFixtureReady(childPidPath: string): Promise<void> {
  await waitFor(
    async () => {
      descendantPid = await readPidFileNumber(childPidPath);
      return (
        isProcessRunning(ownerProcess?.pid ?? -1) &&
        descendantPid !== null &&
        isProcessRunning(descendantPid)
      );
    },
    5000,
    "owner descendant did not become running in time",
  );
}

async function expectOwnerAndDescendantStopped(message: string): Promise<void> {
  await waitFor(
    () => !isProcessRunning(ownerProcess?.pid ?? -1) && !isProcessRunning(descendantPid ?? -1),
    5000,
    message,
  );
}

afterEach(async () => {
  killIfRunning(ownerProcess?.pid);
  killIfRunning(descendantPid);
  ownerProcess = null;
  descendantPid = null;

  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("terminateWithTreeKill", () => {
  test("distinguishes Linux processes that reuse a PID within one second", () => {
    const original = parseLinuxProcStat(42, createLinuxProcStat(7_001));
    const reused = parseLinuxProcStat(42, createLinuxProcStat(7_002));

    expect(original).toEqual({
      identity: "linux-starttime:7001",
      parentPid: 1,
      pid: 42,
      processGroupId: 42,
    });
    expect(reused).toEqual({
      identity: "linux-starttime:7002",
      parentPid: 1,
      pid: 42,
      processGroupId: 42,
    });
  });

  test("distinguishes reused Windows PIDs by CreationDate", () => {
    const original = parseWindowsProcessRecord({
      CreationDate: "/Date(7001)/",
      ParentProcessId: 1,
      ProcessId: 42,
    });
    const reused = parseWindowsProcessRecord({
      CreationDate: "/Date(7002)/",
      ParentProcessId: 1,
      ProcessId: 42,
    });

    expect(original).toEqual({
      creationTimeMs: 7_001,
      identity: "windows-creation:7001",
      parentPid: 1,
      pid: 42,
    });
    expect(reused).toEqual({
      creationTimeMs: 7_002,
      identity: "windows-creation:7002",
      parentPid: 1,
      pid: 42,
    });
  });

  test("ignores older Windows children when live root ownership has no launch bound", () => {
    const selected = selectOwnedWindowsProcesses({
      processes: createUnboundedWindowsProcessRecords(),
      rootExited: false,
      rootPid: 42,
    });

    expect(selected.map((process) => process.pid)).toEqual([200, 42]);
  });

  test("signals only the live Windows root lineage when ownership has no launch bound", async () => {
    const records = createUnboundedWindowsProcessRecords();
    const running = new Set(records.map((process) => process.pid));
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    let queryCount = 0;
    const child = {
      pid: 42,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill() {
        return true;
      },
    };
    const windowsOperations: TestWindowsOperations = {
      async query() {
        queryCount += 1;
        return records;
      },
      signal(pid, signal) {
        signals.push({ pid, signal });
        running.delete(pid);
      },
      isRunning(pid) {
        return running.has(pid);
      },
    };

    const result = await terminateWithTreeKill(child, {
      gracefulTimeoutMs: 0,
      forceTimeoutMs: 0,
      windowsOperations,
    });

    expect(result).toBe("terminated");
    expect(signals).toEqual([
      { pid: 200, signal: "SIGTERM" },
      { pid: 42, signal: "SIGTERM" },
    ]);
    expect([...running]).toEqual([100]);
    expect(queryCount).toBe(2);
  });

  test("does not treat a launch-tolerance record as an old Windows lineage anchor", () => {
    const selected = selectOwnedWindowsProcesses({
      launchedAtMs: 1_000,
      processes: createLaunchToleranceWindowsProcessRecords(),
      rootExited: false,
      rootPid: 42,
    });

    expect(selected.map((process) => process.pid)).toEqual([200, 42]);
  });

  test("does not signal a pre-launch Windows lineage admitted only by root tolerance", async () => {
    const records = createLaunchToleranceWindowsProcessRecords();
    const running = new Set(records.map((process) => process.pid));
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    let queryCount = 0;
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill() {
        return true;
      },
    };
    const windowsOperations: TestWindowsOperations = {
      async query() {
        queryCount += 1;
        return records;
      },
      signal(pid, signal) {
        signals.push({ pid, signal });
        running.delete(pid);
      },
      isRunning(pid) {
        return running.has(pid);
      },
    };

    const result = await terminateWithTreeKill(child, {
      gracefulTimeoutMs: 0,
      forceTimeoutMs: 0,
      ownership: {
        launchedAtMs: 1_000,
        rootPid: 42,
      },
      windowsOperations,
    });

    expect(result).toBe("terminated");
    expect(signals).toEqual([
      { pid: 200, signal: "SIGTERM" },
      { pid: 42, signal: "SIGTERM" },
    ]);
    expect([...running]).toEqual([100]);
    expect(queryCount).toBe(2);
  });

  test.each([
    {
      records: createUnboundedWindowsProcessRecords(),
      rootState: "reused",
    },
    {
      records: createUnboundedWindowsProcessRecords().filter((process) => process.pid !== 42),
      rootState: "missing",
    },
  ])(
    "fails closed without a launch bound when the exited Windows root is $rootState",
    async ({ records }) => {
      const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
      let queryCount = 0;
      const child = {
        pid: 42,
        exitCode: 0,
        signalCode: null,
        kill() {
          return true;
        },
      };
      const windowsOperations: TestWindowsOperations = {
        async query() {
          queryCount += 1;
          return records;
        },
        signal(pid, signal) {
          signals.push({ pid, signal });
        },
        isRunning() {
          return true;
        },
      };

      const result = await terminateWithTreeKill(child, {
        gracefulTimeoutMs: 0,
        forceTimeoutMs: 0,
        windowsOperations,
      });

      expect(result).toBe("kill-timeout");
      expect(signals).toEqual([]);
      expect(queryCount).toBe(1);
    },
  );

  test("excludes a reused Windows root and its newer descendants", () => {
    const processes = createReusedWindowsProcessRecords();

    const selected = selectOwnedWindowsProcesses({
      launchedAtMs: 1_000,
      processes,
      rootExited: true,
      rootPid: 42,
    });

    expect(selected.map((process) => process.pid)).toEqual([101, 100]);
  });

  test("infers Windows root reuse from an older launch-bounded direct child", () => {
    const selected = selectOwnedWindowsProcesses({
      launchedAtMs: 1_000,
      processes: createReusedWindowsProcessRecords(),
      rootExited: false,
      rootPid: 42,
    });

    expect(selected.map((process) => process.pid)).toEqual([101, 100]);
  });

  test("retains late descendants of a proven old Windows lineage after root reuse", () => {
    const selected = selectOwnedWindowsProcesses({
      launchedAtMs: 1_000,
      processes: createLateWindowsDescendantRecords(),
      rootExited: true,
      rootPid: 42,
    });

    expect(selected.map((process) => process.pid)).toEqual([101, 100]);
  });

  test("signals late descendants only through the proven old Windows lineage", async () => {
    const records = createLateWindowsDescendantRecords();
    const running = new Set(records.map((process) => process.pid));
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    let queryCount = 0;
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill() {
        return true;
      },
    };
    const windowsOperations: TestWindowsOperations = {
      async query() {
        queryCount += 1;
        return records;
      },
      signal(pid, signal) {
        signals.push({ pid, signal });
        running.delete(pid);
      },
      isRunning(pid) {
        return running.has(pid);
      },
    };

    const result = await terminateWithTreeKill(child, {
      gracefulTimeoutMs: 0,
      forceTimeoutMs: 0,
      ownership: {
        launchedAtMs: 1_000,
        rootPid: 42,
      },
      windowsOperations,
    });

    expect(result).toBe("terminated");
    expect(signals).toEqual([
      { pid: 101, signal: "SIGTERM" },
      { pid: 100, signal: "SIGTERM" },
    ]);
    expect([...running].sort((left, right) => left - right)).toEqual([42, 200, 201, 202]);
    expect(queryCount).toBe(2);
  });

  test("force-kills a late Windows descendant that survives graceful signaling", async () => {
    const records = createLateWindowsDescendantRecords();
    const running = new Set(records.map((process) => process.pid));
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    let queryCount = 0;
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill() {
        return true;
      },
    };
    const windowsOperations: TestWindowsOperations = {
      async query() {
        queryCount += 1;
        return records;
      },
      signal(pid, signal) {
        signals.push({ pid, signal });
        if (signal === "SIGKILL" || pid === 100) {
          running.delete(pid);
        }
      },
      isRunning(pid) {
        return running.has(pid);
      },
    };

    const result = await terminateWithTreeKill(child, {
      gracefulTimeoutMs: 0,
      forceTimeoutMs: 0,
      ownership: {
        launchedAtMs: 1_000,
        rootPid: 42,
      },
      windowsOperations,
    });

    expect(result).toBe("killed");
    expect(signals).toEqual([
      { pid: 101, signal: "SIGTERM" },
      { pid: 100, signal: "SIGTERM" },
      { pid: 101, signal: "SIGKILL" },
    ]);
    expect([...running].sort((left, right) => left - right)).toEqual([42, 200, 201, 202]);
    expect(queryCount).toBe(3);
  });

  test("fails closed when a reused Windows root has no provable old lineage", () => {
    expect(() =>
      selectOwnedWindowsProcesses({
        launchedAtMs: 1_000,
        processes: [
          {
            creationTimeMs: 5_000,
            identity: "windows-creation:5000",
            parentPid: 1,
            pid: 42,
          },
          {
            creationTimeMs: 5_100,
            identity: "windows-creation:5100",
            parentPid: 42,
            pid: 201,
          },
        ],
        rootExited: true,
        rootPid: 42,
      }),
    ).toThrow(expect.objectContaining({ code: "EXEC_COMMAND_PROCESS_OWNERSHIP_UNVERIFIED" }));
  });

  test("refreshes root exit state after a pending Windows process query", async () => {
    const records = createReusedWindowsProcessRecords();
    const running = new Set(records.map((process) => process.pid));
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    let queryCount = 0;
    let markQueryStarted: (() => void) | null = null;
    let resolveInitialQuery: ((processes: WindowsProcessSelectionRecord[]) => void) | null = null;
    const queryStarted = new Promise<void>((resolve) => {
      markQueryStarted = resolve;
    });
    const initialQuery = new Promise<WindowsProcessSelectionRecord[]>((resolve) => {
      resolveInitialQuery = resolve;
    });
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill() {
        return true;
      },
    };
    const windowsOperations: TestWindowsOperations = {
      async query() {
        queryCount += 1;
        if (queryCount === 1) {
          markQueryStarted?.();
          return initialQuery;
        }
        return records;
      },
      signal(pid, signal) {
        signals.push({ pid, signal });
        running.delete(pid);
      },
      isRunning(pid) {
        return running.has(pid);
      },
    };

    const terminationPromise = terminateWithTreeKill(child, {
      gracefulTimeoutMs: 0,
      forceTimeoutMs: 0,
      ownership: {
        launchedAtMs: 1_000,
        rootPid: 42,
      },
      windowsOperations,
    });
    await queryStarted;
    child.exitCode = 0;
    resolveInitialQuery?.(records);

    await expect(terminationPromise).resolves.toBe("terminated");
    expect(signals).toEqual([
      { pid: 101, signal: "SIGTERM" },
      { pid: 100, signal: "SIGTERM" },
    ]);
    expect(queryCount).toBe(2);
  });

  test("fails closed when root exit is observed only after a pending Windows query", async () => {
    const records: WindowsProcessSelectionRecord[] = [
      {
        creationTimeMs: 5_000,
        identity: "windows-creation:5000",
        parentPid: 1,
        pid: 42,
      },
      {
        creationTimeMs: 5_100,
        identity: "windows-creation:5100",
        parentPid: 42,
        pid: 201,
      },
      {
        creationTimeMs: 5_200,
        identity: "windows-creation:5200",
        parentPid: 201,
        pid: 202,
      },
    ];
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    let queryCount = 0;
    let markQueryStarted: (() => void) | null = null;
    let resolveInitialQuery: ((processes: WindowsProcessSelectionRecord[]) => void) | null = null;
    const queryStarted = new Promise<void>((resolve) => {
      markQueryStarted = resolve;
    });
    const initialQuery = new Promise<WindowsProcessSelectionRecord[]>((resolve) => {
      resolveInitialQuery = resolve;
    });
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill() {
        return true;
      },
    };
    const windowsOperations: TestWindowsOperations = {
      async query() {
        queryCount += 1;
        if (queryCount === 1) {
          markQueryStarted?.();
          return initialQuery;
        }
        return records;
      },
      signal(pid, signal) {
        signals.push({ pid, signal });
      },
      isRunning() {
        return true;
      },
    };

    const terminationPromise = terminateWithTreeKill(child, {
      gracefulTimeoutMs: 0,
      forceTimeoutMs: 0,
      ownership: {
        launchedAtMs: 1_000,
        rootPid: 42,
      },
      windowsOperations,
    });
    await queryStarted;
    child.exitCode = 0;
    resolveInitialQuery?.(records);

    await expect(terminationPromise).resolves.toBe("kill-timeout");
    expect(signals).toEqual([]);
    expect(queryCount).toBe(1);
  });

  test("retains launch-bounded Windows descendants when the root record is missing", () => {
    const selected = selectOwnedWindowsProcesses({
      launchedAtMs: 1_000,
      processes: [
        {
          creationTimeMs: 1_100,
          identity: "windows-creation:1100",
          parentPid: 42,
          pid: 100,
        },
        {
          creationTimeMs: 1_200,
          identity: "windows-creation:1200",
          parentPid: 100,
          pid: 101,
        },
      ],
      rootExited: true,
      rootPid: 42,
    });

    expect(selected.map((process) => process.pid)).toEqual([101, 100]);
  });

  test("refreshes a tracked POSIX process that moved to another process group", () => {
    const tracked = parseLinuxProcStat(42, createLinuxProcStat(7_001, 42));
    const moved = parseLinuxProcStat(42, createLinuxProcStat(7_001, 99));

    expect(tracked).not.toBeNull();
    expect(moved).not.toBeNull();
    expect(refreshTrackedPosixProcess(tracked!, moved)).toEqual({
      identity: "linux-starttime:7001",
      pid: 42,
      processGroupId: 99,
    });
  });

  test("skips a vanished Linux snapshot member and signals the surviving tree", async () => {
    const topology = createLinuxSnapshotTopology();
    const running = new Set([42, 101]);
    const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const fallbackSignals: Array<NodeJS.Signals | number> = [];
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill(signal: NodeJS.Signals | number = "SIGTERM") {
        fallbackSignals.push(signal);
        this.exitCode = 0;
        return true;
      },
    };
    const linuxOperations: TestLinuxOperations = {
      async readTopology() {
        return topology;
      },
      async readProcess(pid) {
        return running.has(pid) ? (topology.get(pid) ?? null) : null;
      },
      signal(pid, signal) {
        signals.push({ pid, signal });
        running.delete(pid);
      },
      signalProcessGroup() {
        throw new Error("process-group signaling was not expected");
      },
    };

    const result = await terminateWithTreeKill(child, {
      gracefulTimeoutMs: 0,
      forceTimeoutMs: 0,
      linuxOperations,
      ownership: {
        launchedAtMs: 1_000,
        rootPid: 42,
      },
    });

    expect(result).toBe("terminated");
    expect(signals).toEqual([
      { pid: 101, signal: "SIGTERM" },
      { pid: 42, signal: "SIGTERM" },
    ]);
    expect(fallbackSignals).toEqual([]);
    expect([...running]).toEqual([]);
  });

  test.each(["unreadable", "inconsistent"] as const)(
    "fails closed when a present Linux snapshot member is %s",
    async (failureMode) => {
      const topology = createLinuxSnapshotTopology();
      const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
      const fallbackSignals: Array<NodeJS.Signals | number> = [];
      const child = {
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        kill(signal: NodeJS.Signals | number = "SIGTERM") {
          fallbackSignals.push(signal);
          this.exitCode = 0;
          return true;
        },
      };
      const linuxOperations: TestLinuxOperations = {
        async readTopology() {
          return topology;
        },
        async readProcess(pid) {
          const process = topology.get(pid) ?? null;
          if (pid !== 100) {
            return process;
          }
          if (failureMode === "unreadable") {
            throw Object.assign(new Error("permission denied"), { code: "EACCES" });
          }
          return process ? { ...process, parentPid: 999 } : null;
        },
        signal(pid, signal) {
          signals.push({ pid, signal });
        },
        signalProcessGroup() {
          throw new Error("process-group signaling was not expected");
        },
      };

      const result = await terminateWithTreeKill(child, {
        gracefulTimeoutMs: 0,
        forceTimeoutMs: 0,
        linuxOperations,
        ownership: {
          launchedAtMs: 1_000,
          rootPid: 42,
        },
      });

      expect(result).toBe("kill-timeout");
      expect(signals).toEqual([]);
      expect(fallbackSignals).toEqual(["SIGTERM"]);
    },
  );

  test.each(["unreadable", "identity-mismatch"] as const)(
    "fails closed before Linux signaling when identity revalidation is %s",
    async (failureMode) => {
      const topology = createLinuxSnapshotTopology();
      const readCounts = new Map<number, number>();
      const pidSignals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
      const groupSignals: Array<{ processGroupId: number; signal: NodeJS.Signals }> = [];
      const fallbackSignals: Array<NodeJS.Signals | number> = [];
      const child = {
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        kill(signal: NodeJS.Signals | number = "SIGTERM") {
          fallbackSignals.push(signal);
          this.exitCode = 0;
          return true;
        },
      };
      const linuxOperations: TestLinuxOperations = {
        async readTopology() {
          return topology;
        },
        async readProcess(pid) {
          const readCount = (readCounts.get(pid) ?? 0) + 1;
          readCounts.set(pid, readCount);
          const current = topology.get(pid) ?? null;
          if (pid !== 100 || readCount === 1) {
            return current;
          }
          if (failureMode === "unreadable") {
            throw Object.assign(new Error("permission denied"), { code: "EACCES" });
          }
          return current ? { ...current, identity: "linux-starttime:reused" } : null;
        },
        signal(pid, signal) {
          pidSignals.push({ pid, signal });
        },
        signalProcessGroup(processGroupId, signal) {
          groupSignals.push({ processGroupId, signal });
        },
      };

      const result = await terminateWithTreeKill(child, {
        gracefulTimeoutMs: 0,
        linuxOperations,
        ownership: {
          launchedAtMs: 1_000,
          processGroupId: 42,
          rootPid: 42,
        },
      });

      expect(result).toBe("kill-timeout");
      expect(pidSignals).toEqual([]);
      expect(groupSignals).toEqual([]);
      expect(fallbackSignals).toEqual(["SIGTERM"]);
    },
  );

  test("keeps an unreadable Linux survivor during polling and revalidates before force signaling", async () => {
    const topology = createLinuxSnapshotTopology();
    const readCounts = new Map<number, number>();
    const groupSignals: NodeJS.Signals[] = [];
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill() {
        throw new Error("raw fallback was not expected");
      },
    };
    const linuxOperations: TestLinuxOperations = {
      async readTopology() {
        return topology;
      },
      async readProcess(pid) {
        const readCount = (readCounts.get(pid) ?? 0) + 1;
        readCounts.set(pid, readCount);
        if (pid === 100 && readCount === 3) {
          throw Object.assign(new Error("temporary read failure"), { code: "EACCES" });
        }
        if (readCount === 3) {
          return null;
        }
        return topology.get(pid) ?? null;
      },
      signal() {
        throw new Error("group signaling should cover the tracked survivor");
      },
      signalProcessGroup(_processGroupId, signal) {
        groupSignals.push(signal);
      },
    };

    const result = await terminateWithTreeKill(child, {
      gracefulTimeoutMs: 0,
      linuxOperations,
      ownership: {
        launchedAtMs: 1_000,
        processGroupId: 42,
        rootPid: 42,
      },
    });

    expect(result).toBe("killed");
    expect(groupSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(readCounts.get(100)).toBe(4);
  });

  test.each(["unreadable", "identity-mismatch"] as const)(
    "fails closed before generic POSIX signaling when process-table revalidation is %s",
    async (failureMode) => {
      const processTable = createTestPosixProcessTable(createLinuxSnapshotTopology());
      const pidSignals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
      const groupSignals: Array<{ processGroupId: number; signal: NodeJS.Signals }> = [];
      const fallbackSignals: Array<NodeJS.Signals | number> = [];
      let posixReadCount = 0;
      const child = {
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        kill(signal: NodeJS.Signals | number = "SIGTERM") {
          fallbackSignals.push(signal);
          this.exitCode = 0;
          return true;
        },
      };
      const posixOperations: TestPosixOperations = {
        async readProcessTable() {
          posixReadCount += 1;
          if (posixReadCount === 1) {
            return processTable;
          }
          if (failureMode === "unreadable") {
            throw new Error("ps failed");
          }
          return createTestPosixProcessTable(
            new Map(
              [...processTable.records].map(([pid, process]) => [
                pid,
                pid === 100 ? { ...process, identity: "ps-start:reused" } : process,
              ]),
            ),
          );
        },
        signal(pid, signal) {
          pidSignals.push({ pid, signal });
        },
        signalProcessGroup(processGroupId, signal) {
          groupSignals.push({ processGroupId, signal });
        },
      };
      const options = {
        gracefulTimeoutMs: 0,
        ownership: {
          launchedAtMs: 1_000,
          processGroupId: 42,
          rootPid: 42,
        },
        posixOperations,
      } as Parameters<typeof terminateWithTreeKill>[1] & {
        posixOperations: TestPosixOperations;
      };

      const result = await terminateWithTreeKill(child, options);

      expect(result).toBe("kill-timeout");
      expect(posixReadCount).toBe(2);
      expect(pidSignals).toEqual([]);
      expect(groupSignals).toEqual([]);
      expect(fallbackSignals).toEqual(["SIGTERM"]);
    },
  );

  test("fails closed when a generic POSIX signal refresh is incomplete", async () => {
    const rootTable = createTestPosixProcessTable(createSinglePosixRootTable());
    const incompleteTable = createTestPosixProcessTable(new Map(), false);
    const pidSignals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const groupSignals: Array<{ processGroupId: number; signal: NodeJS.Signals }> = [];
    const fallbackSignals: Array<NodeJS.Signals | number> = [];
    let readCount = 0;
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill(signal: NodeJS.Signals | number = "SIGTERM") {
        fallbackSignals.push(signal);
        this.exitCode = 0;
        return true;
      },
    };
    const posixOperations: TestPosixOperations = {
      async readProcessTable() {
        readCount += 1;
        return readCount === 1 ? rootTable : incompleteTable;
      },
      signal(pid, signal) {
        pidSignals.push({ pid, signal });
      },
      signalProcessGroup(processGroupId, signal) {
        groupSignals.push({ processGroupId, signal });
      },
    };
    const options = {
      gracefulTimeoutMs: 0,
      ownership: { launchedAtMs: 1_000, rootPid: 42 },
      posixOperations,
    } as Parameters<typeof terminateWithTreeKill>[1] & {
      posixOperations: TestPosixOperations;
    };

    const result = await terminateWithTreeKill(child, options);

    expect(result).toBe("kill-timeout");
    expect(readCount).toBe(2);
    expect(pidSignals).toEqual([]);
    expect(groupSignals).toEqual([]);
    expect(fallbackSignals).toEqual(["SIGTERM"]);
  });

  test.each([
    {
      label: "a malformed non-empty row",
      refreshOutput: "7 1 7 Mon Jul 11 20:00:01 2026\nmalformed process row\n",
    },
    { label: "empty output", refreshOutput: "\n" },
  ])("fails closed when the production POSIX parser sees $label", async ({ refreshOutput }) => {
    const pidSignals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const groupSignals: Array<{ processGroupId: number; signal: NodeJS.Signals }> = [];
    const fallbackSignals: Array<NodeJS.Signals | number> = [];
    let readCount = 0;
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill(signal: NodeJS.Signals | number = "SIGTERM") {
        fallbackSignals.push(signal);
        this.exitCode = 0;
        return true;
      },
    };
    const posixOperations: TestPosixOutputOperations = {
      async readProcessTableOutput() {
        readCount += 1;
        return readCount === 1 ? "42 1 42 Mon Jul 11 20:00:00 2026\n" : refreshOutput;
      },
      signal(pid, signal) {
        pidSignals.push({ pid, signal });
      },
      signalProcessGroup(processGroupId, signal) {
        groupSignals.push({ processGroupId, signal });
      },
    };
    const options = {
      gracefulTimeoutMs: 0,
      ownership: { launchedAtMs: 1_000, rootPid: 42 },
      posixOperations,
    } as Parameters<typeof terminateWithTreeKill>[1] & {
      posixOperations: TestPosixOutputOperations;
    };

    const result = await terminateWithTreeKill(child, options);

    expect(result).toBe("kill-timeout");
    expect(readCount).toBe(2);
    expect(pidSignals).toEqual([]);
    expect(groupSignals).toEqual([]);
    expect(fallbackSignals).toEqual(["SIGTERM"]);
  });

  test.each([
    { label: "spaces", output: "42 1 42    \n" },
    { label: "tabs", output: "42 1 42\t\t\n" },
  ])("rejects a production POSIX $label-only lstart identity", async ({ output }) => {
    const pidSignals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const groupSignals: Array<{ processGroupId: number; signal: NodeJS.Signals }> = [];
    const fallbackSignals: Array<NodeJS.Signals | number> = [];
    let readCount = 0;
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill(signal: NodeJS.Signals | number = "SIGTERM") {
        fallbackSignals.push(signal);
        this.exitCode = 0;
        return true;
      },
    };
    const posixOperations: TestPosixOutputOperations = {
      async readProcessTableOutput() {
        readCount += 1;
        return output;
      },
      signal(pid, signal) {
        pidSignals.push({ pid, signal });
      },
      signalProcessGroup(processGroupId, signal) {
        groupSignals.push({ processGroupId, signal });
      },
    };
    const options = {
      gracefulTimeoutMs: 0,
      ownership: { launchedAtMs: 1_000, rootPid: 42 },
      posixOperations,
    } as Parameters<typeof terminateWithTreeKill>[1] & {
      posixOperations: TestPosixOutputOperations;
    };

    const result = await terminateWithTreeKill(child, options);

    expect(result).toBe("kill-timeout");
    expect(readCount).toBe(1);
    expect(pidSignals).toEqual([]);
    expect(groupSignals).toEqual([]);
    expect(fallbackSignals).toEqual(["SIGTERM"]);
  });

  test("preserves internal spaces in a valid production POSIX lstart identity", async () => {
    const pidSignals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    let readCount = 0;
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill() {
        throw new Error("raw fallback was not expected");
      },
    };
    const posixOperations: TestPosixOutputOperations = {
      async readProcessTableOutput() {
        readCount += 1;
        return "42 1 42 Sat Jul 11 20:00:00 2026   \n";
      },
      signal(pid, signal) {
        pidSignals.push({ pid, signal });
      },
      signalProcessGroup() {
        throw new Error("process-group signaling was not expected");
      },
    };
    const options = {
      gracefulTimeoutMs: 0,
      ownership: { launchedAtMs: 1_000, rootPid: 42 },
      posixOperations,
    } as Parameters<typeof terminateWithTreeKill>[1] & {
      posixOperations: TestPosixOutputOperations;
    };

    const result = await terminateWithTreeKill(child, options);

    expect(result).toBe("killed");
    expect(readCount).toBe(4);
    expect(pidSignals).toEqual([
      { pid: 42, signal: "SIGTERM" },
      { pid: 42, signal: "SIGKILL" },
    ]);
  });

  test("retains a generic POSIX survivor after an incomplete poll and force-signals after a complete refresh", async () => {
    const rootTable = createTestPosixProcessTable(createSinglePosixRootTable());
    const incompleteTable = createTestPosixProcessTable(new Map(), false);
    const pidSignals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    let readCount = 0;
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill() {
        throw new Error("raw fallback was not expected");
      },
    };
    const posixOperations: TestPosixOperations = {
      async readProcessTable() {
        readCount += 1;
        return readCount === 3 ? incompleteTable : rootTable;
      },
      signal(pid, signal) {
        pidSignals.push({ pid, signal });
      },
      signalProcessGroup() {
        throw new Error("process-group signaling was not expected");
      },
    };
    const options = {
      gracefulTimeoutMs: 0,
      ownership: { launchedAtMs: 1_000, rootPid: 42 },
      posixOperations,
    } as Parameters<typeof terminateWithTreeKill>[1] & {
      posixOperations: TestPosixOperations;
    };

    const result = await terminateWithTreeKill(child, options);

    expect(result).toBe("killed");
    expect(readCount).toBe(4);
    expect(pidSignals).toEqual([
      { pid: 42, signal: "SIGTERM" },
      { pid: 42, signal: "SIGKILL" },
    ]);
  });

  test("fails closed before generic POSIX force signaling when the refresh remains incomplete", async () => {
    const rootTable = createTestPosixProcessTable(createSinglePosixRootTable());
    const incompleteTable = createTestPosixProcessTable(new Map(), false);
    const pidSignals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    const fallbackSignals: Array<NodeJS.Signals | number> = [];
    let readCount = 0;
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill(signal: NodeJS.Signals | number = "SIGTERM") {
        fallbackSignals.push(signal);
        this.exitCode = 0;
        return true;
      },
    };
    const posixOperations: TestPosixOperations = {
      async readProcessTable() {
        readCount += 1;
        return readCount <= 2 ? rootTable : incompleteTable;
      },
      signal(pid, signal) {
        pidSignals.push({ pid, signal });
      },
      signalProcessGroup() {
        throw new Error("process-group signaling was not expected");
      },
    };
    const options = {
      gracefulTimeoutMs: 0,
      ownership: { launchedAtMs: 1_000, rootPid: 42 },
      posixOperations,
    } as Parameters<typeof terminateWithTreeKill>[1] & {
      posixOperations: TestPosixOperations;
    };

    const result = await terminateWithTreeKill(child, options);

    expect(result).toBe("kill-timeout");
    expect(readCount).toBe(4);
    expect(pidSignals).toEqual([{ pid: 42, signal: "SIGTERM" }]);
    expect(fallbackSignals).toEqual(["SIGTERM"]);
  });

  test("allows a complete generic POSIX table to confirm the tracked root is gone", async () => {
    const rootTable = createTestPosixProcessTable(createSinglePosixRootTable());
    const completeTableWithoutRoot = createTestPosixProcessTable(createSinglePosixProcessTable(7));
    const pidSignals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
    let readCount = 0;
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill() {
        throw new Error("raw fallback was not expected");
      },
    };
    const posixOperations: TestPosixOperations = {
      async readProcessTable() {
        readCount += 1;
        return readCount === 1 ? rootTable : completeTableWithoutRoot;
      },
      signal(pid, signal) {
        pidSignals.push({ pid, signal });
      },
      signalProcessGroup() {
        throw new Error("process-group signaling was not expected");
      },
    };
    const options = {
      gracefulTimeoutMs: 0,
      ownership: { launchedAtMs: 1_000, rootPid: 42 },
      posixOperations,
    } as Parameters<typeof terminateWithTreeKill>[1] & {
      posixOperations: TestPosixOperations;
    };

    const result = await terminateWithTreeKill(child, options);

    expect(result).toBe("terminated");
    expect(readCount).toBe(3);
    expect(pidSignals).toEqual([]);
  });

  test("bounds each Windows process query by the shared cleanup deadline", () => {
    expect(resolveWindowsProcessQueryTimeout(10_000, 7_500)).toBe(2_500);
    expect(() => resolveWindowsProcessQueryTimeout(10_000, 10_000)).toThrow(
      expect.objectContaining({ code: "EXEC_COMMAND_PROCESS_QUERY_TIMEOUT" }),
    );
  });

  test.each(["snapshot", "signal", "listRunning"] as const)(
    "bounds a never-settling tracked %s operation by one cleanup deadline",
    async (hangingOperation) => {
      interface TrackedProcess {
        identity: string;
        pid: number;
      }
      interface TestOperations {
        listRunning(
          processes: readonly TrackedProcess[],
          cleanupSignal: AbortSignal,
        ): Promise<TrackedProcess[]>;
        signal(
          processes: readonly TrackedProcess[],
          signal: NodeJS.Signals,
          cleanupSignal: AbortSignal,
        ): Promise<void>;
        snapshot(cleanupSignal: AbortSignal): Promise<TrackedProcess[]>;
      }

      vi.useFakeTimers();
      const root = { identity: "root-start", pid: 100 };
      let receivedCleanupSignal: AbortSignal | undefined;
      let settlementCount = 0;
      const neverSettles = <T>(): Promise<T> => new Promise(() => undefined);
      const child = {
        exitCode: null,
        signalCode: null,
        kill() {
          return true;
        },
      };
      const operations: TestOperations = {
        async snapshot(cleanupSignal) {
          if (hangingOperation === "snapshot") {
            receivedCleanupSignal = cleanupSignal;
            return neverSettles();
          }
          return [root];
        },
        async signal(_processes, _signal, cleanupSignal) {
          if (hangingOperation === "signal") {
            receivedCleanupSignal = cleanupSignal;
            return neverSettles();
          }
        },
        async listRunning(processes, cleanupSignal) {
          if (hangingOperation === "listRunning") {
            receivedCleanupSignal = cleanupSignal;
            return neverSettles();
          }
          return [...processes];
        },
      };
      const options = {
        cleanupTimeoutMs: 50,
        gracefulTimeoutMs: 0,
        forceTimeoutMs: 0,
        operations,
      } as Parameters<typeof terminateWithTreeKill>[1] & {
        cleanupTimeoutMs: number;
        operations: TestOperations;
      };

      try {
        const terminationPromise = terminateWithTreeKill(child, options).then((result) => {
          settlementCount += 1;
          return result;
        });

        await vi.advanceTimersByTimeAsync(49);
        expect(settlementCount).toBe(0);

        await vi.advanceTimersByTimeAsync(1);
        expect(settlementCount).toBe(1);
        expect(receivedCleanupSignal?.aborted).toBe(true);
        await expect(terminationPromise).resolves.toBe("kill-timeout");

        await vi.advanceTimersByTimeAsync(1_000);
        expect(settlementCount).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  test.each(["snapshot", "revalidation"] as const)(
    "does not raw-fallback after Windows %s identity tracking fails",
    async (failurePoint) => {
      const records = createReusedWindowsProcessRecords();
      const identitySignals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
      const fallbackSignals: Array<NodeJS.Signals | number> = [];
      let queryCount = 0;
      const child = {
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        kill(signal: NodeJS.Signals | number = "SIGTERM") {
          fallbackSignals.push(signal);
          this.exitCode = 0;
          return true;
        },
      };
      const windowsOperations: TestWindowsOperations = {
        async query() {
          queryCount += 1;
          if (failurePoint === "snapshot" || queryCount > 1) {
            throw new Error(`${failurePoint} query failed`);
          }
          return records;
        },
        signal(pid, signal) {
          identitySignals.push({ pid, signal });
        },
        isRunning() {
          return true;
        },
      };

      const result = await terminateWithTreeKill(child, {
        gracefulTimeoutMs: 0,
        forceTimeoutMs: 0,
        ownership: {
          launchedAtMs: 1_000,
          rootPid: 42,
        },
        windowsOperations,
      });

      expect(result).toBe("kill-timeout");
      expect(identitySignals).toEqual([]);
      expect(fallbackSignals).toEqual([]);
      expect(queryCount).toBe(failurePoint === "snapshot" ? 1 : 2);
    },
  );

  test("bounds a never-settling Windows identity query without raw fallback", async () => {
    vi.useFakeTimers();
    const fallbackSignals: Array<NodeJS.Signals | number> = [];
    let cleanupSignal: AbortSignal | undefined;
    let settlementCount = 0;
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill(signal: NodeJS.Signals | number = "SIGTERM") {
        fallbackSignals.push(signal);
        return true;
      },
    };
    const windowsOperations: TestWindowsOperations = {
      query(signal) {
        cleanupSignal = signal;
        return new Promise(() => undefined);
      },
      signal() {},
      isRunning() {
        return true;
      },
    };

    try {
      const terminationPromise = terminateWithTreeKill(child, {
        cleanupTimeoutMs: 50,
        gracefulTimeoutMs: 0,
        forceTimeoutMs: 0,
        ownership: {
          launchedAtMs: 1_000,
          rootPid: 42,
        },
        windowsOperations,
      }).then((result) => {
        settlementCount += 1;
        return result;
      });

      await vi.advanceTimersByTimeAsync(49);
      expect(settlementCount).toBe(0);

      await vi.advanceTimersByTimeAsync(1);
      expect(settlementCount).toBe(1);
      expect(cleanupSignal?.aborted).toBe(true);
      await expect(terminationPromise).resolves.toBe("kill-timeout");
      expect(fallbackSignals).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("sends a matching graceful and force signal only once", async () => {
    interface TrackedProcess {
      identity: string;
      pid: number;
    }
    interface TestOperations {
      listRunning(processes: readonly TrackedProcess[]): Promise<TrackedProcess[]>;
      signal(processes: readonly TrackedProcess[], signal: NodeJS.Signals): Promise<void>;
      snapshot(): Promise<TrackedProcess[]>;
    }

    const root = { identity: "root-start", pid: 100 };
    const signals: NodeJS.Signals[] = [];
    const child = {
      exitCode: null,
      signalCode: null,
      kill() {
        return true;
      },
    };
    const operations: TestOperations = {
      async snapshot() {
        return [root];
      },
      async listRunning(processes) {
        return [...processes];
      },
      async signal(_processes, signal) {
        signals.push(signal);
      },
    };
    const options = {
      gracefulSignal: "SIGKILL",
      forceSignal: "SIGKILL",
      gracefulTimeoutMs: 0,
      forceTimeoutMs: 0,
      operations,
    } as Parameters<typeof terminateWithTreeKill>[1] & { operations: TestOperations };

    const result = await terminateWithTreeKill(child, options);

    expect(result).toBe("kill-timeout");
    expect(signals).toEqual(["SIGKILL"]);
  });

  test("sends a matching signal once when process tracking is unavailable", async () => {
    const signals: Array<NodeJS.Signals | number> = [];
    const child = {
      exitCode: null,
      signalCode: null,
      kill(signal: NodeJS.Signals | number = "SIGTERM") {
        signals.push(signal);
        return true;
      },
    };

    const result = await terminateWithTreeKill(child, {
      gracefulSignal: "SIGKILL",
      forceSignal: "SIGKILL",
      gracefulTimeoutMs: 0,
      forceTimeoutMs: 0,
    });

    expect(result).toBe("kill-timeout");
    expect(signals).toEqual(["SIGKILL"]);
  });

  test("polls tracked processes at a bounded interval", async () => {
    interface TrackedProcess {
      identity: string;
      pid: number;
    }
    interface TestOperations {
      listRunning(processes: readonly TrackedProcess[]): Promise<TrackedProcess[]>;
      now(): number;
      signal(processes: readonly TrackedProcess[], signal: NodeJS.Signals): Promise<void>;
      snapshot(): Promise<TrackedProcess[]>;
      waitForPoll(delayMs: number): Promise<void>;
    }

    const root = { identity: "root-start", pid: 100 };
    const pollDelays: number[] = [];
    let now = 0;
    const child = {
      exitCode: null,
      signalCode: null,
      kill() {
        return true;
      },
    };
    const operations: TestOperations = {
      async snapshot() {
        return [root];
      },
      async listRunning(processes) {
        return [...processes];
      },
      async signal() {},
      now() {
        return now;
      },
      async waitForPoll(delayMs) {
        pollDelays.push(delayMs);
        now += delayMs;
      },
    };
    const options = {
      gracefulTimeoutMs: 40,
      forceTimeoutMs: 0,
      operations,
    } as Parameters<typeof terminateWithTreeKill>[1] & { operations: TestOperations };

    await expect(terminateWithTreeKill(child, options)).resolves.toBe("kill-timeout");
    expect(pollDelays).toEqual([25, 15]);
  });

  test("does not report tree termination when the process snapshot fails", async () => {
    interface TrackedProcess {
      identity: string;
      pid: number;
    }
    interface TestOperations {
      listRunning(processes: readonly TrackedProcess[]): Promise<TrackedProcess[]>;
      signal(processes: readonly TrackedProcess[], signal: NodeJS.Signals): Promise<void>;
      snapshot(): Promise<TrackedProcess[]>;
    }

    const signals: Array<NodeJS.Signals | number> = [];
    let exitListener: (() => void) | null = null;
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill(signal: NodeJS.Signals | number = "SIGTERM") {
        signals.push(signal);
        this.exitCode = 0;
        exitListener?.();
        return true;
      },
      once(_event: "exit", listener: () => void) {
        exitListener = listener;
      },
    };
    const operations: TestOperations = {
      async snapshot() {
        throw new Error("process table unavailable");
      },
      async listRunning(processes) {
        return [...processes];
      },
      async signal() {},
    };
    const options = {
      gracefulTimeoutMs: 0,
      forceTimeoutMs: 0,
      operations,
    } as Parameters<typeof terminateWithTreeKill>[1] & { operations: TestOperations };

    const result = await terminateWithTreeKill(child, options);

    expect(result).toBe("kill-timeout");
    expect(signals).toEqual(["SIGTERM"]);
  });

  test("treats an empty ownership snapshot as unverified cleanup", async () => {
    interface TrackedProcess {
      identity: string;
      pid: number;
    }
    interface TestOperations {
      listRunning(processes: readonly TrackedProcess[]): Promise<TrackedProcess[]>;
      signal(processes: readonly TrackedProcess[], signal: NodeJS.Signals): Promise<void>;
      snapshot(): Promise<TrackedProcess[]>;
    }

    const child = {
      exitCode: 0,
      signalCode: null,
      kill() {
        return true;
      },
    };
    const operations: TestOperations = {
      async snapshot() {
        return [];
      },
      async listRunning(processes) {
        return [...processes];
      },
      async signal() {},
    };
    const options = {
      gracefulTimeoutMs: 0,
      forceTimeoutMs: 0,
      operations,
      ownership: {
        launchedAtMs: 1_000,
        rootPid: 100,
      },
    } as Parameters<typeof terminateWithTreeKill>[1] & { operations: TestOperations };

    await expect(terminateWithTreeKill(child, options)).resolves.toBe("kill-timeout");
  });

  test("returns kill-timeout when tracked signaling cannot revalidate process identity", async () => {
    interface TrackedProcess {
      identity: string;
      pid: number;
    }
    interface TestOperations {
      listRunning(processes: readonly TrackedProcess[]): Promise<TrackedProcess[]>;
      signal(processes: readonly TrackedProcess[], signal: NodeJS.Signals): Promise<void>;
      snapshot(): Promise<TrackedProcess[]>;
    }

    const root = { identity: "root-start", pid: 100 };
    const fallbackSignals: Array<NodeJS.Signals | number> = [];
    let exitListener: (() => void) | null = null;
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill(signal: NodeJS.Signals | number = "SIGTERM") {
        fallbackSignals.push(signal);
        this.exitCode = 0;
        exitListener?.();
        return true;
      },
      once(_event: "exit", listener: () => void) {
        exitListener = listener;
      },
    };
    const operations: TestOperations = {
      async snapshot() {
        return [root];
      },
      async listRunning(processes) {
        return [...processes];
      },
      async signal() {
        throw new Error("process identity query failed");
      },
    };
    const options = {
      gracefulTimeoutMs: 0,
      forceTimeoutMs: 0,
      operations,
    } as Parameters<typeof terminateWithTreeKill>[1] & { operations: TestOperations };

    await expect(terminateWithTreeKill(child, options)).resolves.toBe("kill-timeout");
    expect(fallbackSignals).toEqual(["SIGTERM"]);
  });

  test("force-kills a tracked descendant after the root exits gracefully", async () => {
    interface TrackedProcess {
      identity: string;
      pid: number;
    }
    interface TestOperations {
      listRunning(processes: readonly TrackedProcess[]): Promise<TrackedProcess[]>;
      signal(processes: readonly TrackedProcess[], signal: NodeJS.Signals): Promise<void>;
      snapshot(): Promise<TrackedProcess[]>;
    }

    const root = { identity: "root-start", pid: 100 };
    const grandchild = { identity: "grandchild-start", pid: 101 };
    const running = new Set([root.pid, grandchild.pid]);
    const signals: Array<{ pids: number[]; signal: NodeJS.Signals }> = [];
    let exitListener: (() => void) | null = null;
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill(signal: NodeJS.Signals | number = "SIGTERM") {
        if (signal === "SIGTERM") {
          running.delete(root.pid);
          this.exitCode = 0;
          exitListener?.();
        }
        return true;
      },
      once(_event: "exit", listener: () => void) {
        exitListener = listener;
      },
    };
    const operations: TestOperations = {
      async snapshot() {
        return [grandchild, root];
      },
      async listRunning(processes) {
        return processes.filter((process) => running.has(process.pid));
      },
      async signal(processes, signal) {
        signals.push({ pids: processes.map((process) => process.pid), signal });
        if (signal === "SIGTERM") {
          running.delete(root.pid);
          child.exitCode = 0;
          exitListener?.();
          return;
        }
        for (const process of processes) {
          running.delete(process.pid);
        }
      },
    };
    const options = {
      gracefulTimeoutMs: 0,
      forceTimeoutMs: 0,
      operations,
    } as Parameters<typeof terminateWithTreeKill>[1] & { operations: TestOperations };

    const result = await terminateWithTreeKill(child, options);

    expect(result).toBe("killed");
    expect(signals).toEqual([
      { pids: [grandchild.pid, root.pid], signal: "SIGTERM" },
      { pids: [grandchild.pid], signal: "SIGKILL" },
    ]);
    expect(Array.from(running)).toEqual([]);
  });

  test.runIf(process.platform === "win32")(
    "kills a live Windows descendant through identity-tracked cleanup",
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), "chisacode-server-tree-kill-"));
      const childPidPath = join(tempDir, "descendant.pid");

      ownerProcess = spawnOwnerWithDescendant({
        childPidPath,
        detachedDescendant: false,
      });
      expect(ownerProcess.pid).toBeTypeOf("number");
      await waitForFixtureReady(childPidPath);

      const result = await terminateWithTreeKill(ownerProcess, {
        gracefulTimeoutMs: 2000,
        forceTimeoutMs: 2000,
      });

      expect(result).toBe("terminated");
      await expectOwnerAndDescendantStopped(
        "owner or Windows descendant survived terminateWithTreeKill",
      );
    },
  );

  test.runIf(process.platform !== "win32")(
    "force-kills descendants that started their own process group",
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), "chisacode-server-tree-kill-"));
      const childPidPath = join(tempDir, "descendant.pid");

      ownerProcess = spawnOwnerWithDescendant({
        childPidPath,
        detachedDescendant: true,
      });
      expect(ownerProcess.pid).toBeTypeOf("number");
      await waitForFixtureReady(childPidPath);

      const result = await terminateWithTreeKill(ownerProcess, {
        gracefulTimeoutMs: 100,
        forceTimeoutMs: 2000,
      });

      expect(result).toBe("killed");
      await expectOwnerAndDescendantStopped(
        "owner or separate-process-group descendant survived terminateWithTreeKill",
      );
    },
  );
});

function createLinuxProcStat(startTime: number, processGroupId = 42): string {
  const fieldsBeforeStartTime = [
    "S",
    "1",
    String(processGroupId),
    ...Array.from({ length: 16 }, () => "0"),
  ];
  return `42 (worker with ) in name) ${[...fieldsBeforeStartTime, String(startTime)].join(" ")}`;
}

function createLinuxSnapshotTopology(): Map<number, LinuxProcessSelectionRecord> {
  return new Map([
    [
      42,
      {
        identity: "linux-starttime:42",
        parentPid: 1,
        pid: 42,
        processGroupId: 42,
      },
    ],
    [
      100,
      {
        identity: "linux-starttime:100",
        parentPid: 42,
        pid: 100,
        processGroupId: 42,
      },
    ],
    [
      101,
      {
        identity: "linux-starttime:101",
        parentPid: 42,
        pid: 101,
        processGroupId: 42,
      },
    ],
  ]);
}

function createSinglePosixRootTable(): Map<number, LinuxProcessSelectionRecord> {
  return createSinglePosixProcessTable(42);
}

function createSinglePosixProcessTable(pid: number): Map<number, LinuxProcessSelectionRecord> {
  return new Map([
    [
      pid,
      {
        identity: `ps-start:${pid}`,
        parentPid: 1,
        pid,
        processGroupId: pid,
      },
    ],
  ]);
}

function createTestPosixProcessTable(
  records: Map<number, LinuxProcessSelectionRecord>,
  complete = true,
): TestPosixProcessTable {
  return { complete, records: new Map(records) };
}

function createReusedWindowsProcessRecords(): WindowsProcessSelectionRecord[] {
  return [
    {
      creationTimeMs: 1_100,
      identity: "windows-creation:1100",
      parentPid: 42,
      pid: 100,
    },
    {
      creationTimeMs: 1_200,
      identity: "windows-creation:1200",
      parentPid: 100,
      pid: 101,
    },
    {
      creationTimeMs: 5_000,
      identity: "windows-creation:5000",
      parentPid: 1,
      pid: 42,
    },
    {
      creationTimeMs: 5_000,
      identity: "windows-creation:5000-equal-child",
      parentPid: 42,
      pid: 200,
    },
    {
      creationTimeMs: 5_100,
      identity: "windows-creation:5100",
      parentPid: 42,
      pid: 201,
    },
    {
      creationTimeMs: 5_200,
      identity: "windows-creation:5200",
      parentPid: 201,
      pid: 202,
    },
  ];
}

function createLateWindowsDescendantRecords(): WindowsProcessSelectionRecord[] {
  return [
    {
      creationTimeMs: 1_100,
      identity: "windows-creation:1100",
      parentPid: 42,
      pid: 100,
    },
    {
      creationTimeMs: 5_100,
      identity: "windows-creation:5100-old-lineage",
      parentPid: 100,
      pid: 101,
    },
    {
      creationTimeMs: 5_000,
      identity: "windows-creation:5000-root",
      parentPid: 1,
      pid: 42,
    },
    {
      creationTimeMs: 5_000,
      identity: "windows-creation:5000-new-direct",
      parentPid: 42,
      pid: 200,
    },
    {
      creationTimeMs: 5_100,
      identity: "windows-creation:5100-new-direct",
      parentPid: 42,
      pid: 201,
    },
    {
      creationTimeMs: 5_200,
      identity: "windows-creation:5200-new-lineage",
      parentPid: 201,
      pid: 202,
    },
  ];
}

function createUnboundedWindowsProcessRecords(): WindowsProcessSelectionRecord[] {
  return [
    {
      creationTimeMs: 1_000,
      identity: "windows-creation:1000-stale-child",
      parentPid: 42,
      pid: 100,
    },
    {
      creationTimeMs: 5_000,
      identity: "windows-creation:5000-live-root",
      parentPid: 1,
      pid: 42,
    },
    {
      creationTimeMs: 5_100,
      identity: "windows-creation:5100-current-child",
      parentPid: 42,
      pid: 200,
    },
  ];
}

function createLaunchToleranceWindowsProcessRecords(): WindowsProcessSelectionRecord[] {
  return [
    {
      creationTimeMs: 500,
      identity: "windows-creation:500-stale-child",
      parentPid: 42,
      pid: 100,
    },
    {
      creationTimeMs: 1_500,
      identity: "windows-creation:1500-current-root",
      parentPid: 1,
      pid: 42,
    },
    {
      creationTimeMs: 1_600,
      identity: "windows-creation:1600-current-child",
      parentPid: 42,
      pid: 200,
    },
  ];
}

describe("terminateProcessTreeWithFallback", () => {
  test("force-kills the root PID when tree tracking fails closed as kill-timeout", async () => {
    // Spawn a real long-lived child so process.kill(pid, SIGKILL) has a target.
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 60000)"], {
      stdio: "ignore",
    });
    const pid = child.pid;
    expect(typeof pid === "number" && pid > 0).toBe(true);
    try {
      await waitFor(() => isProcessRunning(pid ?? -1), 5_000, "fallback child did not start");

      // Windows operations that return records without the live root, with no
      // launch bound, force terminateWithTreeKill into the unverified -> kill-timeout
      // path so the fallback is exercised.
      const windowsOperations: TestWindowsOperations = {
        async query() {
          return [];
        },
        signal() {
          // Should never be called: unverified returns kill-timeout without signalling.
        },
        isRunning() {
          return true;
        },
      };

      const result = await terminateProcessTreeWithFallback(child, {
        gracefulTimeoutMs: 0,
        forceTimeoutMs: 0,
        windowsOperations,
      });

      expect(result).toBe("killed");
      await waitFor(() => !isProcessRunning(pid ?? -1), 5_000, "fallback did not kill the child");
      expect(child.exitCode).not.toBeNull();
    } finally {
      try {
        process.kill(pid ?? -1, "SIGKILL");
      } catch {
        // Already reaped.
      }
      child.removeAllListeners();
    }
  });

  test("returns the original result when tree termination succeeds", async () => {
    // A child that already exited with no live PID: the fallback skips because
    // isProcessExited(child) is true, so the result from terminateWithTreeKill
    // passes through unchanged. Use a non-tracked platform path (posixOperations
    // on a non-Windows host) so Windows PID lookup does not interfere.
    const child = {
      pid: 99_999,
      exitCode: 0,
      signalCode: null,
      kill() {
        return true;
      },
    };

    const result = await terminateProcessTreeWithFallback(child, {
      gracefulTimeoutMs: 0,
      forceTimeoutMs: 0,
      // Force the non-Windows tracking path so an already-exited child with a
      // synthetic PID short-circuits to already-exited without a real lookup.
      posixOperations: {
        async readProcessTable() {
          return { complete: true, records: new Map() };
        },
        signal() {},
        signalProcessGroup() {},
      },
    });

    expect(result).toBe("already-exited");
  });
});
