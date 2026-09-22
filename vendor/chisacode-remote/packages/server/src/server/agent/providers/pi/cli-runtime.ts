import { type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { Logger } from "pino";

import { spawnProcess, type SpawnProcessOptions } from "../../../../utils/spawn.js";
import { terminateProcessTreeWithFallback } from "../../../../utils/tree-kill.js";
import { withTimeout } from "../../../../utils/promise-timeout.js";
import { buildSelfNodeCommand } from "../../../chisacode-env.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import {
  buildPiLaunch,
  type PiPromptOptions,
  type PiRuntime,
  type PiRuntimeLaunch,
  type PiRuntimeSession,
  type PiStartSessionInput,
} from "./runtime.js";
import type {
  PiAgentMessage,
  PiModel,
  PiRpcCommand,
  PiRpcResponse,
  PiRpcSlashCommand,
  PiRuntimeEvent,
  PiSessionState,
  PiSessionStats,
} from "./rpc-types.js";

type Which = (command: string) => string;
const piRequire = createRequire(import.meta.url);
const which = piRequire("which") as Which & { sync: Which };

const DEFAULT_TIMEOUT_MS = 30_000;
const STDERR_BUFFER_LIMIT = 8192;
// Cap stdoutBuffer too: a misbehaving pi process that emits non-newline-
// terminated output would otherwise grow this buffer without bound.
const STDOUT_BUFFER_LIMIT = 1024 * 1024;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 2_000;
const FORCE_SHUTDOWN_TIMEOUT_MS = 1_000;
const CLOSE_TIMEOUT_MS = GRACEFUL_SHUTDOWN_TIMEOUT_MS + FORCE_SHUTDOWN_TIMEOUT_MS + 1_000;

/**
 * Resolves a bare Pi command (e.g. `pi`) to a direct `node cli.js` invocation
 * on Windows. npm generates `pi.cmd` shims whose `%_prog%` indirection defeats
 * `spawnProcess`'s `.cmd` shim parser, so spawning `pi` falls back to
 * `cmd.exe /c pi`. The `cmd.exe` wrapper exits immediately after launching
 * the Pi `node.exe`, orphaning it so tree-kill cannot reap it on session close.
 *
 * This reads the resolved `.cmd` shim, finds the `node_modules` `cli.js` it
 * invokes, and returns `[nodeExe, cliJsPath, ...args]` so `spawnProcess`
 * spawns `node.exe` directly (shell: false), keeping the Pi process as a
 * direct child that tree-kill can terminate.
 * @param command The configured Pi command, usually `pi`
 * @returns A direct `node cli.js` command, or the original on non-Windows / failure
 */
function resolvePiCommand(command: [string, ...string[]]): [string, ...string[]] {
  if (process.platform !== "win32") {
    return command;
  }
  const [executable, ...args] = command;
  // Only resolve bare command names (no path separator, no extension) that
  // need a PATH lookup; absolute/relative paths with an extension are left as-is.
  if (extname(executable) !== "" || executable.includes("/") || executable.includes("\\")) {
    return command;
  }
  let shimPath: string;
  try {
    shimPath = which.sync(executable);
  } catch {
    // Command not on PATH; fall through to the original and let spawn error.
    return command;
  }
  if (!shimPath.toLowerCase().endsWith(".cmd") && !shimPath.toLowerCase().endsWith(".bat")) {
    return command;
  }
  const cliJsPath = resolveCliJsFromNpmShim(shimPath);
  if (!cliJsPath) {
    return command;
  }
  return [process.execPath, cliJsPath, ...args];
}

function resolveDefaultPiCommand(): [string, ...string[]] {
  return [process.env.PI_COMMAND ?? process.env.PI_ACP_PI_COMMAND ?? "pi"];
}

/**
 * Extracts the `dist/cli.js` path an npm `.cmd` shim forwards to.
 * npm shims invoke `<dp0>\node_modules\<pkg>\dist\cli.js` after a `%_prog%`
 * indirection; this finds that path relative to the shim directory.
 * @param shimPath Absolute path to the `.cmd` shim
 * @returns Absolute path to the target `cli.js`, or null when not found
 */
function resolveCliJsFromNpmShim(shimPath: string): string | null {
  const shimDir = dirname(shimPath);
  const contents = readFileSync(shimPath, "utf8");
  const cliJsMatch = /node_modules[\\/][^\s"]*?cli\.js/iu.exec(contents);
  if (!cliJsMatch) {
    return null;
  }
  const cliJsPath = join(shimDir, cliJsMatch[0].replace(/\\/g, "/"));
  return existsSync(cliJsPath) ? cliJsPath : null;
}

function assertChildWithPipes(
  child: ChildProcess,
): asserts child is ChildProcessWithoutNullStreams {
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error("Pi process was spawned without stdio streams");
  }
}

export interface PiDefaultSpawnOptions {
  command: string;
  args: string[];
  options: SpawnProcessOptions;
}

/**
 * Resolves spawn parameters for the default (non-injected) Pi spawn path.
 *
 * When `resolvePiCommand` rewrites the bare `pi` command to
 * `[process.execPath, cliJsPath]` on Windows, `process.execPath` is the
 * Electron binary (the daemon itself runs under `ELECTRON_RUN_AS_NODE=1`).
 * The default external-env path strips `ELECTRON_RUN_AS_NODE`, so the child
 * Electron launches in GUI mode and rejects node flags like `--mode`
 * ("bad option: --mode"). Re-add the flag via `buildSelfNodeCommand` and use
 * `envMode: "internal"` so `spawnProcess` preserves it — mirroring the Claude
 * provider's query.ts pattern.
 *
 * For a custom command (e.g. user-configured `["node", "cli.js"]` or a real
 * `node.exe` path that is not `process.execPath`), the original `envOverlay`
 * path is kept so user env overlays are not stripped.
 * @param launch The Pi runtime launch descriptor
 * @returns Spawn command, args, and options for spawnProcess
 */
export function resolveDefaultPiSpawnOptions(launch: PiRuntimeLaunch): PiDefaultSpawnOptions {
  const [command, ...args] = launch.argv;
  if (command === process.execPath) {
    const selfNode = buildSelfNodeCommand(args, launch.env);
    return {
      command: selfNode.command,
      args: selfNode.args,
      options: {
        cwd: launch.cwd,
        env: selfNode.env,
        envMode: "internal",
        stdio: ["pipe", "pipe", "pipe"],
      },
    };
  }
  return {
    command,
    args,
    options: {
      cwd: launch.cwd,
      envOverlay: launch.env,
      stdio: ["pipe", "pipe", "pipe"],
    },
  };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface PiCliRuntimeOptions {
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
  command?: [string, ...string[]];
  spawnProcess?: (launch: PiRuntimeLaunch) => ChildProcessWithoutNullStreams;
}

export class PiCliRuntime implements PiRuntime {
  private readonly explicitCommand?: [string, ...string[]];
  private readonly spawnProcess: (launch: PiRuntimeLaunch) => ChildProcessWithoutNullStreams;

  constructor(private readonly options: PiCliRuntimeOptions) {
    // Resolve the default command at session-start time. The daemon may update
    // PI_COMMAND/PI_ACP_PI_COMMAND after this runtime is constructed, so never
    // capture the module environment here.
    this.explicitCommand = options.command;
    this.spawnProcess =
      options.spawnProcess ??
      ((launch) => {
        const spawnOptions = resolveDefaultPiSpawnOptions(launch);
        const child = spawnProcess(spawnOptions.command, spawnOptions.args, spawnOptions.options);
        assertChildWithPipes(child);
        return child;
      });
  }

  async startSession(input: PiStartSessionInput): Promise<PiRuntimeSession> {
    const command = this.explicitCommand ?? resolvePiCommand(resolveDefaultPiCommand());
    const launch = buildPiLaunch({
      command,
      runtimeSettings: this.options.runtimeSettings,
      session: input,
    });
    return new PiCliRuntimeSession(launch, this.spawnProcess(launch), this.options.logger);
  }
}

class PiCliRuntimeSession implements PiRuntimeSession {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscribers = new Set<(event: PiRuntimeEvent) => void>();
  private stderrBuffer = "";
  private nextRequestId = 1;
  private disposed = false;
  private closing = false;
  private closePromise: Promise<void> | null = null;
  private processExitEmitted = false;
  private stdoutBuffer = "";

  constructor(
    _launch: PiRuntimeLaunch,
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly logger: Logger,
  ) {
    child.stdout.on("data", (chunk) => {
      this.handleStdoutChunk(chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      this.stderrBuffer += chunk.toString();
      if (this.stderrBuffer.length > STDERR_BUFFER_LIMIT) {
        this.stderrBuffer = this.stderrBuffer.slice(-STDERR_BUFFER_LIMIT);
      }
    });
    child.on("error", (error) => {
      this.handleTransportError(error instanceof Error ? error : new Error(String(error)));
    });
    child.stdin.on("error", (error) => {
      this.handleTransportError(error instanceof Error ? error : new Error(String(error)));
    });
    child.on("exit", (code, signal) => {
      const error = new Error(
        `Pi RPC process exited with code ${code ?? "null"} and signal ${signal ?? "null"}\n${this.stderrBuffer}`.trim(),
      );
      this.rejectPending(error);
      if (!this.closing && !this.processExitEmitted) {
        this.processExitEmitted = true;
        this.disposed = true;
        this.emit({ type: "process_exit", error: error.message });
      } else {
        this.disposed = true;
      }
      this.subscribers.clear();
    });
  }

  onEvent(callback: (event: PiRuntimeEvent) => void): () => void {
    if (this.disposed) {
      return () => undefined;
    }
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async prompt(message: string, options?: PiPromptOptions): Promise<void> {
    await this.request({
      type: "prompt",
      message,
      ...(options?.images?.length ? { images: options.images } : {}),
      // Always include so mid-stream user messages queue instead of failing.
      // Pi ignores this field when the agent is idle.
      streamingBehavior: options?.streamingBehavior ?? "followUp",
    });
  }

  async abort(): Promise<void> {
    await this.request({ type: "abort" });
  }

  async getState(): Promise<PiSessionState> {
    return (await this.request({ type: "get_state" })) as PiSessionState;
  }

  async getMessages(): Promise<PiAgentMessage[]> {
    const data = (await this.request({ type: "get_messages" })) as { messages?: PiAgentMessage[] };
    return data.messages ?? [];
  }

  async getAvailableModels(): Promise<PiModel[]> {
    const data = (await this.request({ type: "get_available_models" })) as { models?: PiModel[] };
    return data.models ?? [];
  }

  async setModel(provider: string, modelId: string): Promise<PiModel> {
    return (await this.request({ type: "set_model", provider, modelId })) as PiModel;
  }

  async setThinkingLevel(level: string): Promise<void> {
    await this.request({ type: "set_thinking_level", level: level as never });
  }

  async getSessionStats(): Promise<PiSessionStats> {
    return (await this.request({ type: "get_session_stats" })) as PiSessionStats;
  }

  async getCommands(): Promise<PiRpcSlashCommand[]> {
    const data = (await this.request({ type: "get_commands" })) as {
      commands?: PiRpcSlashCommand[];
    };
    return data.commands ?? [];
  }

  respondToExtensionUiRequest(
    id: string,
    response: { value?: string; confirmed?: boolean; cancelled?: boolean },
  ): void {
    // Fire-and-forget responses must not throw into event handling if stdin has
    // already failed or the process is closing.
    this.writeJsonLine({ type: "extension_ui_response", id, ...response });
  }

  cancelExtensionUiRequest(id: string): void {
    this.respondToExtensionUiRequest(id, { cancelled: true });
  }

  async close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closing = true;
    this.disposed = true;
    this.rejectPending(new Error("Pi RPC session is closed"));
    this.closePromise = this.terminate().finally(() => {
      this.subscribers.clear();
    });
    return this.closePromise;
  }

  private async terminate(): Promise<void> {
    try {
      this.child.stdin.end();
    } catch {
      // ignore
    }
    try {
      await withTimeout(
        terminateProcessTreeWithFallback(this.child, {
          gracefulTimeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
          forceTimeoutMs: FORCE_SHUTDOWN_TIMEOUT_MS,
          onForceSignal: () => {
            this.logger.warn(
              { timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS },
              "Pi RPC process did not exit after SIGTERM; sending SIGKILL",
            );
          },
        }),
        CLOSE_TIMEOUT_MS,
        `Timed out closing Pi RPC process after ${CLOSE_TIMEOUT_MS}ms`,
      );
    } catch (error) {
      this.logger.warn({ err: error }, "Pi RPC process close did not complete cleanly");
    }
  }

  private request(command: PiRpcCommand, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error("Pi RPC session is closed"));
    }
    const id = `req_${this.nextRequestId}`;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`Pi RPC request timed out for ${command.type}\n${this.stderrBuffer}`.trim()),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        if (!this.writeJsonLine({ ...command, id })) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new Error("Pi RPC session stdin is unavailable"));
        }
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private writeJsonLine(value: unknown): boolean {
    if (this.disposed || this.child.stdin.destroyed || !this.child.stdin.writable) {
      return false;
    }
    try {
      this.child.stdin.write(`${JSON.stringify(value)}\n`, (error?: Error | null) => {
        if (error) {
          this.handleTransportError(error);
        }
      });
      return true;
    } catch (error) {
      this.handleTransportError(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  private handleStdoutChunk(chunk: string): void {
    this.stdoutBuffer += chunk;
    // Guard against a misbehaving pi process that never emits a newline:
    // drop the front of the buffer so it cannot grow unbounded.
    if (this.stdoutBuffer.length > STDOUT_BUFFER_LIMIT) {
      this.stdoutBuffer = this.stdoutBuffer.slice(-STDOUT_BUFFER_LIMIT);
    }
    for (;;) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }
      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (line.trim()) {
        this.handleLine(line);
      }
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      this.logger.warn({ error, line }, "Ignoring non-JSON Pi RPC stdout line");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }
    const message = parsed as Record<string, unknown>;
    if (message.type === "response") {
      this.handleResponse(message as unknown as PiRpcResponse);
      return;
    }
    this.emit(message as PiRuntimeEvent);
  }

  private handleResponse(response: PiRpcResponse): void {
    const id = response.id;
    if (!id) {
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(id);
    if (!response.success) {
      pending.reject(new Error(response.error ?? `Pi RPC ${response.command} failed`));
      return;
    }
    pending.resolve(response.data);
  }

  private emit(event: PiRuntimeEvent): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        this.logger.warn({ err: error }, "Pi runtime event subscriber failed");
      }
    }
  }

  private handleTransportError(error: Error): void {
    this.rejectPending(error);
    if (this.closing || this.processExitEmitted) {
      this.disposed = true;
      return;
    }
    this.disposed = true;
    this.processExitEmitted = true;
    this.emit({ type: "process_exit", error: error.message });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
