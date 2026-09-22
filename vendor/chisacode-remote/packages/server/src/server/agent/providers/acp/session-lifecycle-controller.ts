import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  type AgentCapabilities as ACPAgentCapabilities,
  type Client as ACPClient,
  type ClientSideConnection,
  type McpServer,
} from "@agentclientprotocol/sdk";
import type { Logger } from "pino";

import type {
  AgentPersistenceHandle,
  AgentStreamEvent,
  AgentTimelineItem,
  McpServerConfig,
} from "../../agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import {
  resolveACPLaunchCommand,
  spawnInitializedACPProcess,
  terminateACPChildProcess,
  type ACPProcessExit,
  type SpawnedACPProcess,
} from "./process-runtime.js";
import type { SessionStateResponse } from "./session-config-controller.js";

interface ACPSessionLifecycleControllerOptions {
  provider: string;
  logger: Logger;
  cwd: string;
  mcpServers?: Record<string, McpServerConfig>;
  runtimeSettings?: ProviderRuntimeSettings;
  defaultCommand: [string, ...string[]];
  launchEnv?: Record<string, string>;
  initialHandle?: AgentPersistenceHandle;
  clientFactory: () => ACPClient;
  onProcessExit: (exit: ACPProcessExit) => void;
  onThreadBootstrap: () => void;
  onSessionState: (response: SessionStateResponse) => void;
  applyConfiguredOverrides: () => Promise<void>;
  spawnProcess?: () => Promise<SpawnedACPProcess>;
  terminateProcess?: (child: ChildProcessWithoutNullStreams, timeoutMs: number) => Promise<void>;
}

interface CloseOptions {
  activeTurn: boolean;
  beforeTerminate: () => void;
}

/** Owns ACP process, connection, session identity, initialization, replay, and shutdown state. */
export class ACPSessionLifecycleController {
  private readonly provider: string;
  private readonly logger: Logger;
  private readonly cwd: string;
  private readonly mcpServers?: Record<string, McpServerConfig>;
  private readonly runtimeSettings?: ProviderRuntimeSettings;
  private readonly defaultCommand: [string, ...string[]];
  private readonly launchEnv?: Record<string, string>;
  private readonly initialHandle?: AgentPersistenceHandle;
  private readonly clientFactory: () => ACPClient;
  private readonly onProcessExit: (exit: ACPProcessExit) => void;
  private readonly onThreadBootstrap: () => void;
  private readonly onSessionState: (response: SessionStateResponse) => void;
  private readonly applyConfiguredOverrides: () => Promise<void>;
  private readonly spawnProcessOverride?: () => Promise<SpawnedACPProcess>;
  private readonly terminateProcess: (
    child: ChildProcessWithoutNullStreams,
    timeoutMs: number,
  ) => Promise<void>;
  private child: ChildProcessWithoutNullStreams | null = null;
  private currentConnection: ClientSideConnection | null = null;
  private agentCapabilities: ACPAgentCapabilities | null = null;
  private currentSessionId: string | null = null;
  private closed = false;
  private replayingHistory = false;
  private historyPending = false;
  private readonly persistedHistory: AgentTimelineItem[] = [];

  constructor(options: ACPSessionLifecycleControllerOptions) {
    this.provider = options.provider;
    this.logger = options.logger;
    this.cwd = options.cwd;
    this.mcpServers = options.mcpServers;
    this.runtimeSettings = options.runtimeSettings;
    this.defaultCommand = options.defaultCommand;
    this.launchEnv = options.launchEnv;
    this.initialHandle = options.initialHandle;
    this.clientFactory = options.clientFactory;
    this.onProcessExit = options.onProcessExit;
    this.onThreadBootstrap = options.onThreadBootstrap;
    this.onSessionState = options.onSessionState;
    this.applyConfiguredOverrides = options.applyConfiguredOverrides;
    this.spawnProcessOverride = options.spawnProcess;
    this.terminateProcess = options.terminateProcess ?? terminateACPChildProcess;
  }

  get connection(): ClientSideConnection | null {
    return this.currentConnection;
  }

  set connection(connection: ClientSideConnection | null) {
    this.currentConnection = connection;
  }

  get sessionId(): string | null {
    return this.currentSessionId;
  }

  set sessionId(sessionId: string | null) {
    this.currentSessionId = sessionId;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get activeSession(): { connection: ClientSideConnection; sessionId: string } | null {
    if (!this.currentConnection || !this.currentSessionId) {
      return null;
    }
    return { connection: this.currentConnection, sessionId: this.currentSessionId };
  }

  async initializeNewSession(): Promise<void> {
    try {
      await this.attachSpawnedProcess();
      const connection = this.requireConnection();
      const response = await connection.newSession({
        cwd: this.cwd,
        mcpServers: normalizeMcpServers(this.mcpServers),
      });
      this.currentSessionId = response.sessionId;
      this.onThreadBootstrap();
      this.onSessionState(response);
      await this.applyConfiguredOverrides();
    } catch (error) {
      await this.cleanupInitializationFailure(error);
    }
  }

  async initializeResumedSession(): Promise<void> {
    const handle = this.initialHandle;
    if (!handle) {
      throw new Error("Resume requested without persistence handle");
    }

    try {
      await this.attachSpawnedProcess();
      this.currentSessionId = handle.sessionId;
      this.onThreadBootstrap();
      const active = this.requireActiveSession("ACP process did not expose a connection");
      const sessionCapabilities = this.agentCapabilities?.sessionCapabilities;
      let response: SessionStateResponse;
      if (this.agentCapabilities?.loadSession) {
        this.replayingHistory = true;
        try {
          response = await active.connection.loadSession({
            sessionId: handle.sessionId,
            cwd: this.cwd,
            mcpServers: normalizeMcpServers(this.mcpServers),
          });
        } finally {
          this.replayingHistory = false;
        }
        this.historyPending = this.persistedHistory.length > 0;
      } else if (sessionCapabilities?.resume) {
        response = await active.connection.unstable_resumeSession({
          sessionId: handle.sessionId,
          cwd: this.cwd,
          mcpServers: normalizeMcpServers(this.mcpServers),
        });
      } else {
        throw new Error(`${this.provider} does not support ACP session resume`);
      }

      this.onSessionState(response);
      await this.applyConfiguredOverrides();
    } catch (error) {
      await this.cleanupInitializationFailure(error);
    }
  }

  captureReplayEvents(events: AgentStreamEvent[]): boolean {
    if (!this.replayingHistory) {
      return false;
    }
    for (const event of events) {
      if (event.type === "timeline") {
        this.persistedHistory.push(event.item);
      }
    }
    return true;
  }

  drainHistory(): AgentTimelineItem[] {
    if (!this.historyPending || this.persistedHistory.length === 0) {
      return [];
    }
    const history = [...this.persistedHistory];
    this.persistedHistory.length = 0;
    this.historyPending = false;
    return history;
  }

  async close(options: CloseOptions): Promise<boolean> {
    if (this.closed) {
      return false;
    }
    this.closed = true;

    const active = this.activeSession;
    if (active) {
      if (options.activeTurn) {
        try {
          await active.connection.cancel({ sessionId: active.sessionId });
        } catch (error) {
          this.logger.debug(
            { err: error, sessionId: active.sessionId },
            "Failed to cancel ACP session during close",
          );
        }
      }
      try {
        if (this.agentCapabilities?.sessionCapabilities?.close) {
          await active.connection.unstable_closeSession({ sessionId: active.sessionId });
        }
      } catch (error) {
        this.logger.debug({ err: error }, "ACP closeSession failed during shutdown");
      }
    }

    options.beforeTerminate();
    const child = this.child;
    try {
      if (child) {
        await this.terminateProcess(child, 2_000);
      }
    } finally {
      this.currentConnection = null;
      this.child = null;
    }
    return true;
  }

  collectDiagnostic(message: string): string | undefined {
    const parts: string[] = [message];
    if (this.child?.exitCode != null) {
      parts.push(`exitCode=${this.child.exitCode}`);
    }
    if (this.child?.signalCode) {
      parts.push(`signal=${this.child.signalCode}`);
    }
    return parts.join(" | ");
  }

  private async attachSpawnedProcess(): Promise<void> {
    const spawned = await this.spawnProcess();
    this.child = spawned.child;
    this.currentConnection = spawned.connection;
    this.agentCapabilities = spawned.initialize.agentCapabilities ?? null;
  }

  private async spawnProcess(): Promise<SpawnedACPProcess> {
    if (this.spawnProcessOverride) {
      return this.spawnProcessOverride();
    }
    const launch = await resolveACPLaunchCommand({
      provider: this.provider,
      runtimeSettings: this.runtimeSettings,
      defaultCommand: this.defaultCommand,
    });
    return spawnInitializedACPProcess({
      launch,
      cwd: this.cwd,
      runtimeSettings: this.runtimeSettings,
      launchEnv: this.launchEnv,
      logger: this.logger,
      provider: this.provider,
      clientFactory: this.clientFactory,
      onExit: (exit) => {
        if (!this.closed) {
          this.onProcessExit(exit);
        }
      },
    });
  }

  private requireConnection(): ClientSideConnection {
    if (!this.currentConnection) {
      throw new Error("ACP process did not expose a connection");
    }
    return this.currentConnection;
  }

  private requireActiveSession(message: string): {
    connection: ClientSideConnection;
    sessionId: string;
  } {
    const active = this.activeSession;
    if (!active) {
      throw new Error(message);
    }
    return active;
  }

  private async cleanupInitializationFailure(error: unknown): Promise<never> {
    const child = this.child;
    if (child) {
      try {
        await this.terminateProcess(child, 2_000);
      } catch (cleanupError) {
        this.logger.debug({ err: cleanupError }, "Failed to clean up ACP initialization process");
      }
    }
    this.child = null;
    this.currentConnection = null;
    this.currentSessionId = null;
    this.agentCapabilities = null;
    this.replayingHistory = false;
    throw error;
  }
}

function normalizeMcpServers(servers?: Record<string, McpServerConfig>): McpServer[] {
  if (!servers) {
    return [];
  }

  return Object.entries(servers).map(([name, config]) => {
    if (config.type === "stdio") {
      return {
        name,
        command: config.command,
        args: config.args ?? [],
        env: Object.entries(config.env ?? {}).map(([envName, value]) => ({
          name: envName,
          value,
        })),
      } satisfies McpServer;
    }
    if (config.type === "http") {
      return {
        type: "http",
        name,
        url: config.url,
        headers: Object.entries(config.headers ?? {}).map(([headerName, value]) => ({
          name: headerName,
          value,
        })),
      } satisfies McpServer;
    }
    return {
      type: "sse",
      name,
      url: config.url,
      headers: Object.entries(config.headers ?? {}).map(([headerName, value]) => ({
        name: headerName,
        value,
      })),
    } satisfies McpServer;
  });
}
