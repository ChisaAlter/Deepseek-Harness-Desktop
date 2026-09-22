import { type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type Client as ACPClient,
  type ClientCapabilities as ACPClientCapabilities,
  type InitializeResponse,
} from "@agentclientprotocol/sdk";
import type { Logger } from "pino";

import {
  checkProviderLaunchAvailable,
  createProviderEnvSpec,
  resolveProviderLaunch,
  type ProviderRuntimeSettings,
} from "../../provider-launch-config.js";
import { spawnProcess, type SpawnProcessOptions } from "../../../../utils/spawn.js";
import { createLoggedNdJsonStream } from "./ndjson-stream.js";

const ACP_CLIENT_CAPABILITIES: ACPClientCapabilities = {
  fs: {
    readTextFile: true,
    writeTextFile: true,
  },
  terminal: true,
};

/** Environment overlay used to suppress browser-based auth during ACP probes. */
export const ACP_PROBE_ENV: Record<string, string> = { NO_BROWSER: "true" };

/** Initialized ACP child process and SDK connection. */
export interface SpawnedACPProcess {
  child: ChildProcessWithoutNullStreams;
  connection: ClientSideConnection;
  initialize: InitializeResponse;
}

/** ACP process exit state delivered to the owning session. */
export interface ACPProcessExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  diagnostic?: string;
}

/** Injectable process launcher used by focused runtime tests. */
export type ACPProcessSpawner = (
  command: string,
  args: string[],
  options: SpawnProcessOptions,
) => ChildProcess;

/** Options for starting and initializing an ACP process. */
export interface SpawnInitializedACPProcessOptions {
  launch: { command: string; args: string[] };
  cwd: string;
  runtimeSettings?: ProviderRuntimeSettings;
  launchEnv?: Record<string, string>;
  logger: Logger;
  provider: string;
  clientFactory: () => ACPClient;
  initializeTimeoutMs?: number;
  onExit?: (exit: ACPProcessExit) => void;
  spawn?: ACPProcessSpawner;
}

/**
 * Resolves and validates the provider command used to launch an ACP process.
 * @param options Provider identity, runtime settings, and default argv
 * @returns Resolved executable and arguments
 * @throws If the configured ACP command is unavailable
 */
export async function resolveACPLaunchCommand(options: {
  provider: string;
  runtimeSettings?: ProviderRuntimeSettings;
  defaultCommand: [string, ...string[]];
}): Promise<{ command: string; args: string[] }> {
  const prefix = await resolveProviderLaunch({
    commandConfig: options.runtimeSettings?.command,
    defaultBinary: options.defaultCommand[0],
  });
  const availability = await checkProviderLaunchAvailable(prefix);
  if (!availability.available) {
    throw new Error(`${options.provider} command '${options.defaultCommand[0]}' not found`);
  }
  return {
    command: prefix.command,
    args: [...prefix.args, ...options.defaultCommand.slice(1)],
  };
}

/**
 * Spawns an ACP child, creates its NDJSON connection, and completes initialize.
 * Failed spawn or initialize attempts terminate the child before rejecting.
 * @param options Launch, environment, client, and lifecycle options
 * @returns Initialized ACP process state
 * @throws If spawning or ACP initialization fails or times out
 */
export async function spawnInitializedACPProcess(
  options: SpawnInitializedACPProcessOptions,
): Promise<SpawnedACPProcess> {
  const spawn = options.spawn ?? spawnProcess;
  const child = spawn(options.launch.command, options.launch.args, {
    cwd: options.cwd,
    ...createProviderEnvSpec({
      runtimeSettings: options.runtimeSettings,
      overlays: [options.launchEnv],
    }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  assertChildWithPipes(child);

  const stderrChunks: string[] = [];
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderrChunks.push(chunk.toString());
  });
  child.once("exit", (exitCode, signal) => {
    options.onExit?.({
      exitCode,
      signal,
      diagnostic: stderrChunks.join("").trim() || undefined,
    });
  });

  const spawnErrorPromise = new Promise<never>((_, reject) => {
    child.once("error", (error) => {
      const stderr = stderrChunks.join("").trim();
      reject(new Error(stderr ? `${String(error)}\n${stderr}` : String(error)));
    });
  });

  const stream = createLoggedNdJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(child.stdout),
    { logger: options.logger, provider: options.provider },
  );
  const connection = new ClientSideConnection(options.clientFactory, stream);

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const initializeTimeoutPromise = options.initializeTimeoutMs
    ? new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          // Keep stderr tail and child liveness in the timeout: a hung ACP
          // boot (slow composition load, blocked child) otherwise surfaces as
          // a bare timeout that is indistinguishable from a quiet crash.
          const stderrTail = stderrChunks.join("").trim();
          const exitState = child.exitCode !== null ? `exited(${child.exitCode})` : "running";
          reject(
            new Error(
              `ACP initialize timed out after ${options.initializeTimeoutMs}ms (child ${exitState})` +
                (stderrTail ? ` | child stderr: ${stderrTail.slice(-800)}` : ""),
            ),
          );
        }, options.initializeTimeoutMs);
      })
    : null;

  try {
    const initialize = await Promise.race([
      connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: ACP_CLIENT_CAPABILITIES,
        clientInfo: { name: "ChisaCode", version: "dev" },
      }),
      spawnErrorPromise,
      ...(initializeTimeoutPromise ? [initializeTimeoutPromise] : []),
    ]);
    return { child, connection, initialize };
  } catch (error) {
    await terminateACPChildProcess(child, 2_000);
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

/**
 * Terminates an ACP child and closes all stdio streams.
 * @param child ACP child process
 * @param timeoutMs Grace period before force killing the process
 * @returns A promise that resolves after exit or force-kill escalation
 */
export async function terminateACPChildProcess(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<void> {
  child.kill("SIGTERM");
  child.stdin.destroy();
  child.stdout.destroy();
  child.stderr.destroy();
  await waitForChildExit(child, timeoutMs);
}

function assertChildWithPipes(
  child: ChildProcess,
): asserts child is ChildProcessWithoutNullStreams {
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("Child process did not expose stdio pipes");
  }
}

async function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
}
