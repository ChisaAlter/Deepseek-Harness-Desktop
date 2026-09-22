import { execFile } from "node:child_process";
import { open, readFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import { promisify } from "node:util";
import { z } from "zod/v3";
import { writeFileAtomic } from "../utils/atomic-write.js";

const execFileAsync = promisify(execFile);
const PID_START_TIME_TOLERANCE_MS = 60_000;
const DEFAULT_LINUX_CLOCK_TICKS_PER_SECOND = 100;

export const pidLockInfoSchema = z.object({
  pid: z.number(),
  startedAt: z.string(),
  hostname: z.string(),
  uid: z.number(),
  listen: z.string().nullable(),
  desktopManaged: z.boolean().optional(),
});

export interface PidLockInfo extends z.infer<typeof pidLockInfoSchema> {}

function parsePidLockInfo(raw: unknown): PidLockInfo | null {
  const result = pidLockInfoSchema.safeParse(raw);
  return result.success ? result.data : null;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

export class PidLockError extends Error {
  constructor(
    message: string,
    public readonly existingLock?: PidLockInfo,
  ) {
    super(message);
    this.name = "PidLockError";
  }
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrnoException(error) && error.code === "EPERM";
  }
}

async function getWindowsProcessStartedAtMs(pid: number): Promise<number | null> {
  try {
    const command = [
      "$ErrorActionPreference = 'Stop';",
      `$process = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}";`,
      "if ($null -eq $process) { exit 2 }",
      "$process.CreationDate.ToUniversalTime().ToString('o')",
    ].join(" ");
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8", timeout: 2_000, windowsHide: true },
    );
    const startedAtMs = Date.parse(stdout.trim());
    return Number.isFinite(startedAtMs) ? startedAtMs : null;
  } catch {
    return null;
  }
}

function parseLinuxProcStatStartTicks(stat: string): number | null {
  const commandEndIndex = stat.lastIndexOf(")");
  if (commandEndIndex === -1) return null;
  const fields = stat
    .slice(commandEndIndex + 2)
    .trim()
    .split(/\s+/);
  const startTicks = Number(fields[19]);
  return Number.isFinite(startTicks) ? startTicks : null;
}

async function getLinuxBootTimeMs(): Promise<number | null> {
  try {
    const procStat = await readFile("/proc/stat", "utf8");
    const bootTimeLine = procStat.split("\n").find((line) => line.startsWith("btime "));
    const bootTimeSeconds = Number(bootTimeLine?.slice("btime ".length).trim());
    return Number.isFinite(bootTimeSeconds) ? bootTimeSeconds * 1_000 : null;
  } catch {
    return null;
  }
}

async function getLinuxClockTicksPerSecond(): Promise<number> {
  try {
    const { stdout } = await execFileAsync("getconf", ["CLK_TCK"], {
      encoding: "utf8",
      timeout: 2_000,
    });
    const ticksPerSecond = Number(stdout.trim());
    return Number.isFinite(ticksPerSecond) && ticksPerSecond > 0
      ? ticksPerSecond
      : DEFAULT_LINUX_CLOCK_TICKS_PER_SECOND;
  } catch {
    return DEFAULT_LINUX_CLOCK_TICKS_PER_SECOND;
  }
}

async function getLinuxProcessStartedAtMs(pid: number): Promise<number | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const startTicks = parseLinuxProcStatStartTicks(stat);
    const bootTimeMs = await getLinuxBootTimeMs();
    if (startTicks === null || bootTimeMs === null) return null;
    const ticksPerSecond = await getLinuxClockTicksPerSecond();
    return bootTimeMs + (startTicks / ticksPerSecond) * 1_000;
  } catch {
    return null;
  }
}

async function getPosixProcessStartedAtMs(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "etimes="], {
      encoding: "utf8",
      timeout: 2_000,
      env: { ...process.env, LC_ALL: "C" },
    });
    const elapsedSeconds = Number(stdout.trim());
    return Number.isFinite(elapsedSeconds) ? Date.now() - elapsedSeconds * 1_000 : null;
  } catch {
    return null;
  }
}

async function getProcessStartedAtMs(pid: number): Promise<number | null> {
  if (process.platform === "win32") {
    return await getWindowsProcessStartedAtMs(pid);
  }
  if (process.platform === "linux") {
    return await getLinuxProcessStartedAtMs(pid);
  }
  return await getPosixProcessStartedAtMs(pid);
}

/**
 * Verifies whether a running process still owns a recorded PID lock identity.
 * @param lock The recorded process PID and optional process start timestamp
 * @returns The owner identity relationship between the lock and current process table
 */
export async function getPidLockOwnerStatus(lock: {
  pid: number;
  startedAt?: string;
}): Promise<"match" | "mismatch" | "unknown" | "not_running"> {
  if (!isPidRunning(lock.pid)) return "not_running";
  if (typeof lock.startedAt !== "string") return "unknown";

  const lockStartedAtMs = Date.parse(lock.startedAt);
  if (!Number.isFinite(lockStartedAtMs)) return "unknown";

  const processStartedAtMs = await getProcessStartedAtMs(lock.pid);
  if (processStartedAtMs === null) {
    return isPidRunning(lock.pid) ? "unknown" : "not_running";
  }

  return Math.abs(processStartedAtMs - lockStartedAtMs) <= PID_START_TIME_TOLERANCE_MS
    ? "match"
    : "mismatch";
}

function getPidFilePath(chisacodeHome: string): string {
  return join(chisacodeHome, "chisacode.pid");
}

function resolveOwnerPid(ownerPid?: number): number {
  if (typeof ownerPid === "number" && Number.isInteger(ownerPid) && ownerPid > 0) {
    return ownerPid;
  }
  return process.pid;
}

export async function acquirePidLock(
  chisacodeHome: string,
  listen: string | null,
  options?: { ownerPid?: number },
): Promise<void> {
  const pidPath = getPidFilePath(chisacodeHome);

  // Ensure chisacodeHome directory exists
  if (!existsSync(chisacodeHome)) {
    await mkdir(chisacodeHome, { recursive: true });
  }

  // Try to read existing lock
  let existingLock: PidLockInfo | null = null;
  try {
    const content = await readFile(pidPath, "utf-8");
    existingLock = parsePidLockInfo(JSON.parse(content));
  } catch {
    // No existing lock or invalid JSON - that's fine
  }

  // Check if existing lock is stale
  const lockOwnerPid = resolveOwnerPid(options?.ownerPid);
  if (existingLock) {
    const ownerStatus = await getPidLockOwnerStatus(existingLock);
    if (ownerStatus === "match" || ownerStatus === "unknown") {
      if (existingLock.pid === lockOwnerPid) {
        return;
      }

      throw new PidLockError(
        `Another ChisaCode daemon is already running (PID ${existingLock.pid}, started ${existingLock.startedAt})`,
        existingLock,
      );
    }
    // Stale lock - remove it
    await unlink(pidPath).catch(() => {});
  }

  // Create new lock with exclusive flag
  const lockInfo: PidLockInfo = {
    pid: lockOwnerPid,
    startedAt: new Date().toISOString(),
    hostname: hostname(),
    uid: process.getuid?.() ?? 0,
    listen,
    ...(process.env.CHISACODE_DESKTOP_MANAGED === "1" ? { desktopManaged: true } : {}),
  };

  let fd;
  try {
    fd = await open(pidPath, "wx");
    await fd.write(JSON.stringify(lockInfo));
  } catch (err) {
    if (isErrnoException(err) && err.code === "EEXIST") {
      // Race condition - another process created the file
      // Re-read and check
      try {
        const content = await readFile(pidPath, "utf-8");
        const raceLock = parsePidLockInfo(JSON.parse(content));
        if (raceLock) {
          throw new PidLockError(
            `Another ChisaCode daemon is already running (PID ${raceLock.pid})`,
            raceLock,
          );
        }
        throw new PidLockError("Failed to acquire PID lock due to race condition");
      } catch (innerErr) {
        if (innerErr instanceof PidLockError) throw innerErr;
        throw new PidLockError("Failed to acquire PID lock due to race condition");
      }
    }
    throw err;
  } finally {
    await fd?.close();
  }
}

export async function updatePidLock(
  chisacodeHome: string,
  patch: { listen: string },
  options?: { ownerPid?: number },
): Promise<void> {
  const pidPath = getPidFilePath(chisacodeHome);
  const lockOwnerPid = resolveOwnerPid(options?.ownerPid);
  const content = await readFile(pidPath, "utf-8");
  const existingLock = parsePidLockInfo(JSON.parse(content));
  if (!existingLock) {
    throw new PidLockError("Cannot update PID lock: invalid lock file");
  }

  if (existingLock.pid !== lockOwnerPid) {
    throw new PidLockError(`Cannot update PID lock owned by PID ${existingLock.pid}`, existingLock);
  }

  const updatedLock: PidLockInfo = {
    ...existingLock,
    ...patch,
  };

  // Atomically write the updated lock so a crash during write never leaves
  // the lock file truncated/empty (which would prevent the next daemon start
  // from parsing it). The temp file + fsync + rename pattern is crash-safe.
  await writeFileAtomic(pidPath, JSON.stringify(updatedLock));
}

export async function releasePidLock(
  chisacodeHome: string,
  options?: { ownerPid?: number },
): Promise<void> {
  const pidPath = getPidFilePath(chisacodeHome);
  const lockOwnerPid = resolveOwnerPid(options?.ownerPid);
  try {
    // Only remove if it's our lock
    const content = await readFile(pidPath, "utf-8");
    const lock = parsePidLockInfo(JSON.parse(content));
    if (lock?.pid === lockOwnerPid) {
      await unlink(pidPath);
    }
  } catch {
    // Ignore errors - lock may already be gone
  }
}

export async function getPidLockInfo(chisacodeHome: string): Promise<PidLockInfo | null> {
  const pidPath = getPidFilePath(chisacodeHome);
  try {
    const content = await readFile(pidPath, "utf-8");
    return parsePidLockInfo(JSON.parse(content));
  } catch {
    return null;
  }
}

export async function isLocked(
  chisacodeHome: string,
): Promise<{ locked: boolean; info?: PidLockInfo }> {
  const info = await getPidLockInfo(chisacodeHome);
  if (!info) {
    return { locked: false };
  }
  const ownerStatus = await getPidLockOwnerStatus(info);
  if (ownerStatus === "mismatch" || ownerStatus === "not_running") {
    return { locked: false, info };
  }
  return { locked: true, info };
}
