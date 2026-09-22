import type { ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import net from "node:net";
import path from "node:path";
import type { Logger } from "pino";

import { findExecutable } from "../../../../utils/executable.js";
import { spawnProcess } from "../../../../utils/spawn.js";
import { terminateProcessTreeWithFallback } from "../../../../utils/tree-kill.js";
import {
  createProviderEnvSpec,
  resolveProviderCommandPrefix,
  type ProviderRuntimeSettings,
} from "../../provider-launch-config.js";

const OPENCODE_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000;
const OPENCODE_SERVER_FORCE_SHUTDOWN_TIMEOUT_MS = 1_000;

/**
 * Resolves the working directory to use when spawning the OpenCode-like server.
 *
 * The server process inherits its working directory from the daemon process. On
 * macOS/Linux the daemon typically runs from the user's home directory, so user
 * project directories (e.g. `/Users/<user>/dev/<repo>`) are within the server's
 * working directory and `provider.list({ directory })` accepts them.
 *
 * On Windows the daemon is launched by the Electron desktop app from the
 * `win-unpacked` install directory (e.g. `C:\Ai\ChisaCode\packages\desktop\
 * release\win-unpacked`), which is NOT an ancestor of user project directories
 * (e.g. `C:\Ai\pi-desktop`). The opencode/mimo server rejects `provider.list`
 * requests with "Access denied: directory must be within the server's working
 * directory" in that case.
 *
 * Fix: on Windows, spawn the server with its working directory set to the
 * filesystem root of the user's home drive (e.g. `C:\`). This ensures any
 * project directory on the same drive as the user's home is accepted. On
 * other platforms, inherit the daemon's working directory (the historical
 * behavior) since home-relative project paths already work.
 */
function resolveServerSpawnCwd(): string {
  if (process.platform === "win32") {
    return path.parse(homedir()).root;
  }
  return process.cwd();
}

export interface OpenCodeLikeProviderConfig {
  providerId: string;
  label: string;
  binary: string;
  serveArgs: (port: string) => string[];
  rotateServerOnForceRefresh: boolean;
  ignoreSystemEnvForDedicatedServer: boolean;
  installUrl: string;
}

const DEFAULT_OPENCODE_PROVIDER_CONFIG: OpenCodeLikeProviderConfig = {
  providerId: "opencode",
  label: "OpenCode",
  binary: "opencode",
  serveArgs: (port) => ["serve", "--port", port],
  rotateServerOnForceRefresh: true,
  ignoreSystemEnvForDedicatedServer: false,
  installUrl: "https://github.com/opencode-ai/opencode",
};

export interface OpenCodeServerAcquisition {
  server: { port: number; url: string };
  release: () => void;
}

export interface OpenCodeServerManagerLike {
  ensureRunning(): Promise<{ port: number; url: string }>;
  acquire(options: {
    force: boolean;
    env?: Record<string, string>;
  }): Promise<OpenCodeServerAcquisition>;
}

export interface OpenCodeServerGeneration {
  process: ChildProcess;
  port: number;
  url: string;
  refCount: number;
  retired: boolean;
}

export class OpenCodeServerManager implements OpenCodeServerManagerLike {
  private static instances = new Map<string, OpenCodeServerManager>();
  private static exitHandlerRegistered = false;
  private currentServer: OpenCodeServerGeneration | null = null;
  private retiredServers = new Set<OpenCodeServerGeneration>();
  private startPromise: Promise<OpenCodeServerGeneration> | null = null;
  private forcedRefreshPromise: Promise<OpenCodeServerGeneration> | null = null;
  private readonly logger: Logger;
  private readonly runtimeSettings?: ProviderRuntimeSettings;
  private readonly runtimeSettingsKey: string;
  private readonly providerConfig: OpenCodeLikeProviderConfig;

  private constructor(
    logger: Logger,
    runtimeSettings?: ProviderRuntimeSettings,
    providerConfig: OpenCodeLikeProviderConfig = DEFAULT_OPENCODE_PROVIDER_CONFIG,
  ) {
    this.logger = logger;
    this.runtimeSettings = runtimeSettings;
    this.providerConfig = providerConfig;
    this.runtimeSettingsKey = JSON.stringify(runtimeSettings ?? {});
  }

  static getInstance(
    logger: Logger,
    runtimeSettings?: ProviderRuntimeSettings,
    providerConfig: OpenCodeLikeProviderConfig = DEFAULT_OPENCODE_PROVIDER_CONFIG,
  ): OpenCodeServerManager {
    const instanceKey = JSON.stringify({
      providerId: providerConfig.providerId,
      runtimeSettings: runtimeSettings ?? {},
    });
    const nextSettingsKey = JSON.stringify(runtimeSettings ?? {});
    let instance = OpenCodeServerManager.instances.get(instanceKey);
    if (!instance) {
      instance = new OpenCodeServerManager(logger, runtimeSettings, providerConfig);
      OpenCodeServerManager.instances.set(instanceKey, instance);
      OpenCodeServerManager.registerExitHandler();
    } else if (instance.runtimeSettingsKey !== nextSettingsKey) {
      logger.warn(
        {
          providerId: providerConfig.providerId,
          existingRuntimeSettings: instance.runtimeSettingsKey,
          requestedRuntimeSettings: nextSettingsKey,
        },
        "OpenCode-like server manager already initialized with different runtime settings",
      );
    }
    return instance;
  }

  private static registerExitHandler(): void {
    if (OpenCodeServerManager.exitHandlerRegistered) {
      return;
    }
    OpenCodeServerManager.exitHandlerRegistered = true;

    const cleanup = () => {
      for (const instance of OpenCodeServerManager.instances.values()) {
        void instance.shutdown();
      }
    };

    process.on("exit", cleanup);
    process.on("SIGTERM", cleanup);
    process.on("SIGINT", cleanup);
  }

  async ensureRunning(): Promise<{ port: number; url: string }> {
    const acquisition = await this.acquire({ force: false });
    acquisition.release();
    return acquisition.server;
  }

  async acquire(options: {
    force: boolean;
    env?: Record<string, string>;
  }): Promise<OpenCodeServerAcquisition> {
    if (hasDedicatedServerEnv(options.env, this.providerConfig)) {
      const server = await this.startDedicatedServer(options.env);
      return this.acquireServer(server);
    }

    const server =
      options.force && this.providerConfig.rotateServerOnForceRefresh
        ? await this.getForcedRefreshServer()
        : await this.getCurrentServer();
    return this.acquireServer(server);
  }

  private acquireServer(server: OpenCodeServerGeneration): OpenCodeServerAcquisition {
    server.refCount += 1;
    let released = false;
    return {
      server: { port: server.port, url: server.url },
      release: () => {
        if (released) {
          return;
        }
        released = true;
        server.refCount -= 1;
        this.cleanupRetiredServers();
      },
    };
  }

  private async getForcedRefreshServer(): Promise<OpenCodeServerGeneration> {
    if (this.forcedRefreshPromise) {
      return this.forcedRefreshPromise;
    }

    this.forcedRefreshPromise = Promise.resolve()
      .then(async () => {
        await this.rotateCurrentServer();
        return this.getCurrentServer();
      })
      .finally(() => {
        this.forcedRefreshPromise = null;
      });
    return this.forcedRefreshPromise;
  }

  private async getCurrentServer(): Promise<OpenCodeServerGeneration> {
    if (this.startPromise) {
      return this.startPromise;
    }

    if (this.currentServer && !this.currentServer.process.killed) {
      return this.currentServer;
    }

    this.startPromise = this.startServer();
    try {
      const result = await this.startPromise;
      if (!result.retired) {
        this.currentServer = result;
      }
      return result;
    } finally {
      this.startPromise = null;
    }
  }

  private async rotateCurrentServer(): Promise<void> {
    const existing = this.currentServer;
    if (existing) {
      existing.retired = true;
      this.retiredServers.add(existing);
      this.currentServer = null;
      this.cleanupRetiredServers();
    }
    if (this.startPromise) {
      const pending = await this.startPromise;
      pending.retired = true;
      this.retiredServers.add(pending);
      this.currentServer = null;
      this.cleanupRetiredServers();
    }
  }

  private async startDedicatedServer(
    env: Record<string, string>,
  ): Promise<OpenCodeServerGeneration> {
    const server = await this.startServer(env);
    server.retired = true;
    this.retiredServers.add(server);
    return server;
  }

  private async startServer(launchEnv?: Record<string, string>): Promise<OpenCodeServerGeneration> {
    const port = await findAvailablePort();
    const url = `http://127.0.0.1:${port}`;
    const launchPrefix = await resolveProviderCommandPrefix(this.runtimeSettings?.command, () =>
      resolveOpenCodeBinary(this.providerConfig),
    );

    return new Promise((resolve, reject) => {
      const serverProcess = spawnProcess(
        launchPrefix.command,
        [...launchPrefix.args, ...this.providerConfig.serveArgs(String(port))],
        {
          detached: process.platform !== "win32",
          cwd: resolveServerSpawnCwd(),
          stdio: ["ignore", "pipe", "pipe"],
          ...createProviderEnvSpec({
            runtimeSettings: this.runtimeSettings,
            overlays: [launchEnv],
          }),
        },
      );

      let started = false;
      let stderrBuffer = "";
      let stdoutBuffer = "";
      const STARTUP_BUFFER_CAP = 8192;
      const appendCapped = (current: string, chunk: string): string => {
        if (current.length >= STARTUP_BUFFER_CAP) {
          return current;
        }
        const remaining = STARTUP_BUFFER_CAP - current.length;
        return current + chunk.slice(0, remaining);
      };
      const buildStartupErrorMessage = (headline: string): string => {
        const sections = [headline];
        const stderrTrimmed = stderrBuffer.trim();
        if (stderrTrimmed.length > 0) {
          sections.push(`stderr: ${stderrTrimmed}`);
        }
        const stdoutTrimmed = stdoutBuffer.trim();
        if (stdoutTrimmed.length > 0) {
          sections.push(`stdout: ${stdoutTrimmed}`);
        }
        return sections.join("\n");
      };
      const timeout = setTimeout(() => {
        if (!started) {
          reject(
            new Error(
              buildStartupErrorMessage(`${this.providerConfig.label} server startup timeout`),
            ),
          );
        }
      }, 30_000);

      serverProcess.stdout?.on("data", (data: Buffer) => {
        const output = data.toString();
        stdoutBuffer = appendCapped(stdoutBuffer, output);
        if (output.includes("listening on") && !started) {
          started = true;
          clearTimeout(timeout);
          resolve({
            process: serverProcess,
            port,
            url,
            refCount: 0,
            retired: false,
          });
        }
      });

      serverProcess.stderr?.on("data", (data: Buffer) => {
        const output = data.toString();
        stderrBuffer = appendCapped(stderrBuffer, output);
        this.logger.error({ stderr: output.trim() }, "OpenCode server stderr");
      });

      serverProcess.on("error", (error) => {
        clearTimeout(timeout);
        const headline = error instanceof Error ? error.message : String(error);
        reject(new Error(buildStartupErrorMessage(headline)));
      });

      serverProcess.on("exit", (code) => {
        if (!started) {
          clearTimeout(timeout);
          reject(
            new Error(
              buildStartupErrorMessage(
                `${this.providerConfig.label} server exited with code ${code}`,
              ),
            ),
          );
        }
        if (this.currentServer?.process === serverProcess) {
          this.currentServer = null;
        }
        for (const retired of Array.from(this.retiredServers)) {
          if (retired.process === serverProcess) {
            this.retiredServers.delete(retired);
          }
        }
      });
    });
  }

  async shutdown(): Promise<void> {
    const servers = [
      ...(this.currentServer ? [this.currentServer] : []),
      ...Array.from(this.retiredServers),
    ];
    await Promise.all(servers.map((server) => this.killServer(server)));
    this.currentServer = null;
    this.retiredServers.clear();
  }

  private cleanupRetiredServers(): void {
    for (const server of Array.from(this.retiredServers)) {
      if (server.refCount === 0) {
        this.retiredServers.delete(server);
        void this.killServer(server);
      }
    }
  }

  private async killServer(server: OpenCodeServerGeneration): Promise<void> {
    if (
      (server.process.exitCode !== null && server.process.exitCode !== undefined) ||
      (server.process.signalCode !== null && server.process.signalCode !== undefined)
    ) {
      return;
    }
    const result = await terminateProcessTreeWithFallback(server.process, {
      gracefulTimeoutMs: OPENCODE_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT_MS,
      forceTimeoutMs: OPENCODE_SERVER_FORCE_SHUTDOWN_TIMEOUT_MS,
      onForceSignal: () => {
        this.logger.warn(
          { timeoutMs: OPENCODE_SERVER_GRACEFUL_SHUTDOWN_TIMEOUT_MS },
          "OpenCode server did not exit after SIGTERM; sending SIGKILL",
        );
      },
    });
    if (result === "kill-timeout") {
      this.logger.warn(
        { timeoutMs: OPENCODE_SERVER_FORCE_SHUTDOWN_TIMEOUT_MS },
        "OpenCode server did not report exit after SIGKILL",
      );
    }
  }
}

function hasDedicatedServerEnv(
  env: Record<string, string> | undefined,
  config: OpenCodeLikeProviderConfig,
): env is Record<string, string> {
  if (env === undefined) {
    return false;
  }
  const keys = Object.keys(env);
  if (keys.length === 0) {
    return false;
  }
  if (!config.ignoreSystemEnvForDedicatedServer) {
    return true;
  }
  return keys.some((key) => key !== "CHISACODE_AGENT_ID");
}

async function resolveOpenCodeBinary(config: OpenCodeLikeProviderConfig): Promise<string> {
  const found = await findExecutable(config.binary);
  if (found) {
    return found;
  }
  throw new Error(
    `${config.label} binary not found. Install ${config.label} (${config.installUrl}) and ensure '${config.binary}' is available in your shell PATH.`,
  );
}

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address) {
          resolve(address.port);
        } else {
          reject(new Error("Failed to allocate port"));
        }
      });
    });
    server.on("error", reject);
  });
}
