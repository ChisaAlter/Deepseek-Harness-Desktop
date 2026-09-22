/**
 * Test Daemon Helper
 *
 * Provides utilities for launching real ChisaCode daemons in E2E tests.
 * Each test gets an isolated daemon on an available local port with its own CHISACODE_HOME.
 *
 * CRITICAL RULES (from design doc):
 * 1. Port: Use an available ephemeral local port - NEVER use 6767 (production)
 * 2. Protocol: WebSocket ONLY - daemon has no HTTP endpoints
 * 3. Temp dirs: Create temp directories for CHISACODE_HOME and agent --cwd
 * 4. Model: Always use claude provider with haiku model for fast, cheap tests
 * 5. Cleanup: Kill daemon and remove temp dirs after each test
 */

import { mkdtemp, rm, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ChildProcess, spawn } from "child_process";
import { getAvailablePort } from "./network.ts";

export interface TestDaemonContext {
  /** Available local port for test daemon (never 6767) */
  port: number;
  /** WebSocket URL for connecting to daemon */
  wsUrl: string;
  /** Temp directory for CHISACODE_HOME */
  chisacodeHome: string;
  /** Temp directory for agent working directory */
  workDir: string;
  /** Running daemon process */
  process: ChildProcess | null;
  /** Whether the daemon is ready to accept connections */
  isReady: boolean;
  /** Stop the daemon and clean up resources */
  stop: () => Promise<void>;
}

const TEST_DAEMON_ENV_DEFAULTS: Record<string, string> = {
  CHISACODE_RELAY_ENABLED: "false",
  CHISACODE_LOCAL_SPEECH_AUTO_DOWNLOAD: process.env.CHISACODE_LOCAL_SPEECH_AUTO_DOWNLOAD ?? "0",
  CHISACODE_DICTATION_ENABLED: process.env.CHISACODE_DICTATION_ENABLED ?? "0",
  CHISACODE_VOICE_MODE_ENABLED: process.env.CHISACODE_VOICE_MODE_ENABLED ?? "0",
};
const TEST_DAEMON_HOST = "127.0.0.1";
const TSX_CLI_PATH = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs",
);

function buildTsxSpawnArgs(args: string[]): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: [TSX_CLI_PATH, ...args],
  };
}

const DEFAULT_OUTPUT_CAPTURE_LIMIT = 256 * 1024;
const TEST_OUTPUT_CAPTURE_LIMIT = Number.parseInt(
  process.env.CHISACODE_TEST_OUTPUT_CAPTURE_BYTES ?? `${DEFAULT_OUTPUT_CAPTURE_LIMIT}`,
  10,
);

interface OutputCapture {
  value: string;
  truncated: boolean;
}

function createOutputCapture(): OutputCapture {
  return { value: "", truncated: false };
}

function appendOutputCapture(target: OutputCapture, chunk: Buffer): void {
  const next = target.value + chunk.toString();
  if (next.length <= TEST_OUTPUT_CAPTURE_LIMIT) {
    target.value = next;
    return;
  }
  target.truncated = true;
  target.value = next.slice(next.length - TEST_OUTPUT_CAPTURE_LIMIT);
}

function formatOutputCapture(target: OutputCapture): string {
  if (!target.truncated) {
    return target.value;
  }
  return `[truncated; showing last ${TEST_OUTPUT_CAPTURE_LIMIT} chars]\n${target.value}`;
}

function readNodeErrnoCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

function signalProcessTree(pid: number, signal: NodeJS.Signals): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return true;
    } catch (error) {
      const code = readNodeErrnoCode(error);
      if (code === "ESRCH") {
        return false;
      }
    }
  }

  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    const code = readNodeErrnoCode(error);
    if (code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function terminateProcessTree(processRef: ChildProcess, timeoutMs: number): Promise<void> {
  const pid = processRef.pid;
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  if (processRef.exitCode !== null || processRef.signalCode !== null) {
    return;
  }

  signalProcessTree(pid, "SIGTERM");

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    const onExit = () => {
      clearTimeout(timeoutId);
      done();
    };
    const timeoutId = setTimeout(() => {
      signalProcessTree(pid, "SIGKILL");
      processRef.removeListener("exit", onExit);
      done();
    }, timeoutMs);
    processRef.once("exit", onExit);
  });
}

/**
 * Generate a random port for test daemon
 * Uses range 20000-30000 to avoid conflicts
 * NEVER uses 6767 (user's running daemon)
 */
export function getRandomPort(): number {
  return 20000 + Math.floor(Math.random() * 10000);
}

/**
 * Create isolated temp directories for testing
 */
export async function createTempDirs(): Promise<{ chisacodeHome: string; workDir: string }> {
  const chisacodeHome = await mkdtemp(join(tmpdir(), "chisacode-e2e-home-"));
  const workDir = await mkdtemp(join(tmpdir(), "chisacode-e2e-work-"));

  // Create the agents directory that the daemon expects
  const agentsDir = join(chisacodeHome, "agents");
  await mkdir(agentsDir, { recursive: true });

  return { chisacodeHome, workDir };
}

/**
 * Wait for daemon to be ready by running `chisacode agent ls`
 * This connects via WebSocket and ensures the daemon is responsive
 */
async function probeDaemonReady(port: number): Promise<boolean> {
  try {
    const { exitCode } = await runChisaCodeCli(
      {
        port,
        wsUrl: `ws://${TEST_DAEMON_HOST}:${port}`,
        chisacodeHome: "",
        workDir: "",
        process: null,
        isReady: false,
        stop: async () => {},
      },
      ["agent", "ls"],
      { timeout: 15_000 },
    );
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function waitForDaemonReady(
  port: number,
  timeout = 30000,
  getExitError?: () => Error | null,
): Promise<void> {
  const deadline = Date.now() + timeout;

  async function poll(): Promise<void> {
    const exitError = getExitError?.();
    if (exitError) {
      throw exitError;
    }
    if (await probeDaemonReady(port)) return;
    if (Date.now() >= deadline) {
      throw new Error(`Daemon failed to become ready on port ${port} within ${timeout}ms`);
    }
    await sleep(100);
    return poll();
  }

  return poll();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start a test daemon programmatically using the server's bootstrap API
 *
 * This starts the daemon in a separate process using the CLI's daemon start command
 * with isolated CHISACODE_HOME and CHISACODE_LISTEN environment variables.
 */
export async function startTestDaemon(options?: {
  port?: number;
  chisacodeHome?: string;
  workDir?: string;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<TestDaemonContext> {
  const port = options?.port ?? (await getAvailablePort());
  const { chisacodeHome, workDir } =
    options?.chisacodeHome && options?.workDir
      ? { chisacodeHome: options.chisacodeHome, workDir: options.workDir }
      : await createTempDirs();
  const timeout = options?.timeout ?? 30000;

  const wsUrl = `ws://${TEST_DAEMON_HOST}:${port}`;

  // Find the CLI entry point - use the source file directly with tsx
  const cliDir = join(import.meta.dirname, "..", "..");
  const cliSrcPath = join(cliDir, "src", "index.ts");

  // Start daemon process using tsx to run TypeScript directly
  const daemonInvocation = buildTsxSpawnArgs([cliSrcPath, "daemon", "start", "--foreground"]);
  const daemonProcess = spawn(daemonInvocation.command, daemonInvocation.args, {
    env: {
      ...process.env,
      ...TEST_DAEMON_ENV_DEFAULTS,
      CHISACODE_HOME: chisacodeHome,
      CHISACODE_LISTEN: `${TEST_DAEMON_HOST}:${port}`,
      // Force no TTY to prevent QR code output
      CI: "true",
      ...options?.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  const stdout = createOutputCapture();
  const stderr = createOutputCapture();
  let cleanupRequested = false;

  daemonProcess.stdout?.on("data", (data) => {
    appendOutputCapture(stdout, data);
  });

  daemonProcess.stderr?.on("data", (data) => {
    appendOutputCapture(stderr, data);
  });

  const cleanup = async () => {
    cleanupRequested = true;
    if (daemonProcess) {
      await terminateProcessTree(daemonProcess, 5000);
    }

    // Clean up temp directories
    try {
      if (existsSync(chisacodeHome)) {
        await rm(chisacodeHome, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }

    try {
      if (existsSync(workDir)) {
        await rm(workDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  };

  // Handle process errors
  daemonProcess.on("error", (err) => {
    console.error("Daemon process error:", err);
  });

  daemonProcess.on("exit", (code) => {
    if (!cleanupRequested && code !== 0 && code !== null) {
      console.error(`Daemon process exited with code ${code}`);
      const stderrText = formatOutputCapture(stderr);
      if (stderrText) {
        console.error("Daemon stderr:", stderrText);
      }
    }
  });

  const ctx: TestDaemonContext = {
    port,
    wsUrl,
    chisacodeHome,
    workDir,
    process: daemonProcess,
    isReady: false,
    stop: cleanup,
  };

  // Wait for daemon to be ready
  try {
    await waitForDaemonReady(port, timeout, () => {
      if (daemonProcess.exitCode === null && daemonProcess.signalCode === null) {
        return null;
      }
      return new Error(
        `Daemon process exited before readiness (code=${daemonProcess.exitCode ?? "null"}, signal=${daemonProcess.signalCode ?? "null"})\nStdout: ${formatOutputCapture(stdout)}\nStderr: ${formatOutputCapture(stderr)}`,
      );
    });
    ctx.isReady = true;
  } catch (err) {
    // Daemon failed to start - clean up and rethrow
    await cleanup();
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to start test daemon: ${message}\nStdout: ${formatOutputCapture(stdout)}\nStderr: ${formatOutputCapture(stderr)}`,
      { cause: err },
    );
  }

  return ctx;
}

/**
 * Run a chisacode CLI command against a test daemon
 *
 * This is a helper that sets the correct environment variables
 * to point at the test daemon.
 */
export async function runChisaCodeCli(
  ctx: TestDaemonContext,
  args: string[],
  options?: {
    timeout?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const timeout = options?.timeout ?? 60000;
  const cwd = options?.cwd ?? ctx.workDir;

  const cliDir = join(import.meta.dirname, "..", "..");
  const cliSrcPath = join(cliDir, "src", "index.ts");

  return new Promise((resolve, reject) => {
    const invocation = buildTsxSpawnArgs([cliSrcPath, ...args]);
    const proc = spawn(invocation.command, invocation.args, {
      env: {
        ...process.env,
        ...TEST_DAEMON_ENV_DEFAULTS,
        CHISACODE_HOST: `${TEST_DAEMON_HOST}:${ctx.port}`,
        CHISACODE_HOME: ctx.chisacodeHome,
        ...options?.env,
      },
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    const stdout = createOutputCapture();
    const stderr = createOutputCapture();

    proc.stdout?.on("data", (data) => {
      appendOutputCapture(stdout, data);
    });

    proc.stderr?.on("data", (data) => {
      appendOutputCapture(stderr, data);
    });

    const timeoutId = setTimeout(() => {
      if (proc.pid) {
        signalProcessTree(proc.pid, "SIGKILL");
      }
      reject(new Error(`CLI command timed out after ${timeout}ms: chisacode ${args.join(" ")}`));
    }, timeout);

    proc.on("exit", (code) => {
      clearTimeout(timeoutId);
      resolve({
        exitCode: code ?? 1,
        stdout: formatOutputCapture(stdout),
        stderr: formatOutputCapture(stderr),
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

/**
 * Create a test context that includes a started daemon
 * and a helper to run CLI commands against it.
 *
 * This is the main entry point for E2E tests.
 */
export async function createE2ETestContext(options?: {
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<
  TestDaemonContext & {
    /** Run a chisacode CLI command against this daemon */
    chisacode: (
      args: string[],
      opts?: { timeout?: number; cwd?: string; env?: NodeJS.ProcessEnv },
    ) => Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>;
  }
> {
  const ctx = await startTestDaemon({ timeout: options?.timeout, env: options?.env });

  const chisacode = (
    args: string[],
    opts?: { timeout?: number; cwd?: string; env?: NodeJS.ProcessEnv },
  ) => runChisaCodeCli(ctx, args, opts);

  return {
    ...ctx,
    chisacode,
  };
}
