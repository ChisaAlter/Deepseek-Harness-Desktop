import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ClientSideConnection,
  type Client as ACPClient,
  type CreateTerminalRequest,
  type KillTerminalRequest,
  type ListSessionsResponse,
  type PermissionOption,
  type ReadTextFileRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionInfoUpdate,
  type SessionNotification,
  type SessionUpdate,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitRequest,
  type WriteTextFileRequest,
} from "@agentclientprotocol/sdk";
import type { Logger } from "pino";

import {
  getAgentStreamEventTurnId,
  type AgentCapabilityFlags,
  type AgentClient,
  type AgentLaunchContext,
  type AgentMetadata,
  type AgentMode,
  type AgentModelDefinition,
  type AgentPermissionRequest,
  type AgentPermissionResponse,
  type AgentPersistenceHandle,
  type AgentPromptInput,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentRuntimeInfo,
  type AgentSession,
  type AgentSessionConfig,
  type AgentSlashCommand,
  type AgentStreamEvent,
  type ListModesOptions,
  type ListModelsOptions,
  type ListPersistedAgentsOptions,
  type PersistedAgentDescriptor,
} from "../agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../provider-launch-config.js";

import { appendOrReplaceGrowingAssistantMessage, runProviderTurn } from "./provider-runner.js";
import {
  mapACPPermissionRequest,
  selectACPPermissionOption,
  type ACPToolSnapshot,
} from "./acp/tool-call-mapper.js";
import { ACPCommandCatalog } from "./acp/command-catalog.js";
import { ACPForegroundTurnController } from "./acp/foreground-turn-controller.js";
import { ACPSessionUpdateController } from "./acp/session-update-controller.js";
import { ACPSessionLifecycleController } from "./acp/session-lifecycle-controller.js";
import {
  deriveModelDefinitionsFromACP,
  deriveModesFromACP,
  type ACPBeforeModeWriteResult,
  type ACPProviderModeWriterContext,
  type ACPProviderModeWriteResult,
} from "./acp/session-config.js";
import {
  ACPSessionConfigController,
  type SessionStateResponse,
} from "./acp/session-config-controller.js";
import {
  ACP_PROBE_ENV,
  resolveACPLaunchCommand,
  spawnInitializedACPProcess,
  terminateACPChildProcess,
  type SpawnedACPProcess,
} from "./acp/process-runtime.js";
import { ACPTerminalController, type ACPTerminalExit } from "./acp/terminal-controller.js";
import { resolvePathInsideBase } from "./acp/workspace-path.js";
export type { ACPToolSnapshot } from "./acp/tool-call-mapper.js";
export { createLoggedNdJsonStream } from "./acp/ndjson-stream.js";
export { mapACPUsage } from "./acp/foreground-turn-controller.js";
export type { SessionStateResponse } from "./acp/session-config-controller.js";
export type { SpawnedACPProcess } from "./acp/process-runtime.js";
export {
  deriveModelDefinitionsFromACP,
  deriveModesFromACP,
  resolveACPModeSelection,
  resolveACPModelSelection,
  type ACPBeforeModeWriteResult,
  type ACPProviderModeWriterContext,
  type ACPProviderModeWriteResult,
} from "./acp/session-config.js";

const DEFAULT_ACP_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsRewindConversation: false,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
};

/**
 * One ACP probe answers both models and modes. Discovery results are cached
 * per cwd so a snapshot refresh does not spawn two child processes; `force`
 * bypasses the completed cache (an in-flight probe is still joined).
 */
const ACP_PROBE_DISCOVERY_TTL_MS = 5 * 60_000;
/** Probe-only initialize cap; real sessions are not subject to this timeout. */
const ACP_PROBE_INITIALIZE_TIMEOUT_MS = 12_000;

interface ACPDiscoverySnapshot {
  cwd: string;
  models: AgentModelDefinition[];
  modes: AgentMode[];
  fetchedAt: number;
}

interface ACPAgentClientOptions {
  provider: string;
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
  defaultCommand: [string, ...string[]];
  defaultModes?: AgentMode[];
  modelTransformer?: (models: AgentModelDefinition[]) => AgentModelDefinition[];
  sessionResponseTransformer?: (response: SessionStateResponse) => SessionStateResponse;
  configOptionsTransformer?: (configOptions: SessionConfigOption[]) => SessionConfigOption[];
  modeIdTransformer?: (modeId: string) => string | null;
  toolSnapshotTransformer?: (snapshot: ACPToolSnapshot) => ACPToolSnapshot;
  providerModeWriter?: (
    context: ACPProviderModeWriterContext,
  ) => Promise<ACPProviderModeWriteResult>;
  beforeModeWriter?: (context: ACPProviderModeWriterContext) => Promise<ACPBeforeModeWriteResult>;
  thinkingOptionWriter?: (
    connection: ClientSideConnection,
    sessionId: string,
    thinkingOptionId: string,
  ) => Promise<void>;
  capabilities?: AgentCapabilityFlags;
  waitForInitialCommands?: boolean;
  initialCommandsWaitTimeoutMs?: number;
}

interface ACPAgentSessionOptions {
  provider: string;
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
  defaultCommand: [string, ...string[]];
  defaultModes: AgentMode[];
  modelTransformer?: (models: AgentModelDefinition[]) => AgentModelDefinition[];
  sessionResponseTransformer?: (response: SessionStateResponse) => SessionStateResponse;
  configOptionsTransformer?: (configOptions: SessionConfigOption[]) => SessionConfigOption[];
  modeIdTransformer?: (modeId: string) => string | null;
  toolSnapshotTransformer?: (snapshot: ACPToolSnapshot) => ACPToolSnapshot;
  providerModeWriter?: (
    context: ACPProviderModeWriterContext,
  ) => Promise<ACPProviderModeWriteResult>;
  beforeModeWriter?: (context: ACPProviderModeWriterContext) => Promise<ACPBeforeModeWriteResult>;
  thinkingOptionWriter?: (
    connection: ClientSideConnection,
    sessionId: string,
    thinkingOptionId: string,
  ) => Promise<void>;
  capabilities: AgentCapabilityFlags;
  handle?: AgentPersistenceHandle;
  agentId?: string;
  launchEnv?: Record<string, string>;
  waitForInitialCommands?: boolean;
  initialCommandsWaitTimeoutMs?: number;
}

interface PendingPermission {
  request: AgentPermissionRequest;
  options: PermissionOption[];
  resolve: (response: RequestPermissionResponse) => void;
  reject: (error: Error) => void;
  turnId: string | null;
}

export class ACPAgentClient implements AgentClient {
  readonly provider: string;
  readonly capabilities: AgentCapabilityFlags;

  protected readonly logger: Logger;
  protected readonly runtimeSettings?: ProviderRuntimeSettings;
  protected readonly defaultCommand: [string, ...string[]];
  protected readonly defaultModes: AgentMode[];
  private readonly discoveryByCwd = new Map<string, ACPDiscoverySnapshot>();
  private readonly discoveryInFlight = new Map<string, Promise<ACPDiscoverySnapshot>>();
  private readonly modelTransformer?: (models: AgentModelDefinition[]) => AgentModelDefinition[];
  private readonly sessionResponseTransformer?: (
    response: SessionStateResponse,
  ) => SessionStateResponse;
  private readonly configOptionsTransformer?: (
    configOptions: SessionConfigOption[],
  ) => SessionConfigOption[];
  private readonly modeIdTransformer?: (modeId: string) => string | null;
  private readonly toolSnapshotTransformer?: (snapshot: ACPToolSnapshot) => ACPToolSnapshot;
  private readonly providerModeWriter?: (
    context: ACPProviderModeWriterContext,
  ) => Promise<ACPProviderModeWriteResult>;
  private readonly beforeModeWriter?: (
    context: ACPProviderModeWriterContext,
  ) => Promise<ACPBeforeModeWriteResult>;
  private readonly thinkingOptionWriter?: (
    connection: ClientSideConnection,
    sessionId: string,
    thinkingOptionId: string,
  ) => Promise<void>;
  private readonly waitForInitialCommands: boolean;
  private readonly initialCommandsWaitTimeoutMs: number;

  constructor(options: ACPAgentClientOptions) {
    this.provider = options.provider;
    this.capabilities = options.capabilities ?? DEFAULT_ACP_CAPABILITIES;
    this.logger = options.logger.child({
      module: "agent",
      provider: options.provider,
    });
    this.runtimeSettings = options.runtimeSettings;
    this.defaultCommand = options.defaultCommand;
    this.defaultModes = options.defaultModes ?? [];
    this.modelTransformer = options.modelTransformer;
    this.sessionResponseTransformer = options.sessionResponseTransformer;
    this.configOptionsTransformer = options.configOptionsTransformer;
    this.modeIdTransformer = options.modeIdTransformer;
    this.toolSnapshotTransformer = options.toolSnapshotTransformer;
    this.providerModeWriter = options.providerModeWriter;
    this.beforeModeWriter = options.beforeModeWriter;
    this.thinkingOptionWriter = options.thinkingOptionWriter;
    this.waitForInitialCommands = options.waitForInitialCommands ?? false;
    this.initialCommandsWaitTimeoutMs = options.initialCommandsWaitTimeoutMs ?? 1500;
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    this.assertProvider(config);
    const session = new ACPAgentSession(
      { ...config, provider: this.provider },
      {
        provider: this.provider,
        logger: this.logger,
        runtimeSettings: this.runtimeSettings,
        defaultCommand: this.defaultCommand,
        defaultModes: this.defaultModes,
        modelTransformer: this.modelTransformer,
        sessionResponseTransformer: this.sessionResponseTransformer,
        configOptionsTransformer: this.configOptionsTransformer,
        modeIdTransformer: this.modeIdTransformer,
        toolSnapshotTransformer: this.toolSnapshotTransformer,
        providerModeWriter: this.providerModeWriter,
        beforeModeWriter: this.beforeModeWriter,
        thinkingOptionWriter: this.thinkingOptionWriter,
        capabilities: this.capabilities,
        agentId: launchContext?.agentId,
        launchEnv: launchContext?.env,
        waitForInitialCommands: this.waitForInitialCommands,
        initialCommandsWaitTimeoutMs: this.initialCommandsWaitTimeoutMs,
      },
    );
    await session.initializeNewSession();
    return session;
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    if (handle.provider !== this.provider) {
      throw new Error(`Cannot resume ${handle.provider} handle with ${this.provider} provider`);
    }

    const storedConfig = coerceSessionConfigMetadata(handle.metadata);
    const cwd = overrides?.cwd ?? storedConfig.cwd;
    if (!cwd) {
      throw new Error(`${this.provider} resume requires the original working directory`);
    }

    const mergedConfig: AgentSessionConfig = {
      ...storedConfig,
      ...overrides,
      provider: this.provider,
      cwd,
    };
    const session = new ACPAgentSession(mergedConfig, {
      provider: this.provider,
      logger: this.logger,
      runtimeSettings: this.runtimeSettings,
      defaultCommand: this.defaultCommand,
      defaultModes: this.defaultModes,
      modelTransformer: this.modelTransformer,
      sessionResponseTransformer: this.sessionResponseTransformer,
      configOptionsTransformer: this.configOptionsTransformer,
      modeIdTransformer: this.modeIdTransformer,
      toolSnapshotTransformer: this.toolSnapshotTransformer,
      providerModeWriter: this.providerModeWriter,
      beforeModeWriter: this.beforeModeWriter,
      thinkingOptionWriter: this.thinkingOptionWriter,
      capabilities: this.capabilities,
      handle,
      agentId: launchContext?.agentId,
      launchEnv: launchContext?.env,
      waitForInitialCommands: this.waitForInitialCommands,
      initialCommandsWaitTimeoutMs: this.initialCommandsWaitTimeoutMs,
    });
    await session.initializeResumedSession();
    return session;
  }

  async listModels(options: ListModelsOptions): Promise<AgentModelDefinition[]> {
    const discovery = await this.resolveDiscovery(options.cwd, options.force);
    return discovery.models;
  }

  async listModes(options: ListModesOptions): Promise<AgentMode[]> {
    const discovery = await this.resolveDiscovery(options.cwd, options.force);
    return discovery.modes;
  }

  /**
   * Resolves models + modes from a single probe session, cached per cwd.
   * Concurrent callers join the in-flight probe; `force` bypasses the
   * completed cache but still joins an in-flight one (mirrors the snapshot
   * manager's no-parallel-probe invariant).
   */
  private resolveDiscovery(cwd: string, force: boolean): Promise<ACPDiscoverySnapshot> {
    const cached = this.discoveryByCwd.get(cwd);
    if (cached && !force && Date.now() - cached.fetchedAt < ACP_PROBE_DISCOVERY_TTL_MS) {
      return Promise.resolve(cached);
    }
    const inFlight = this.discoveryInFlight.get(cwd);
    if (inFlight) {
      return inFlight;
    }
    const promise = this.runDiscovery(cwd);
    this.discoveryInFlight.set(cwd, promise);
    // Consume the rejection before cleaning up the in-flight slot: a rejected
    // discovery is surfaced to listModels/listModes (and from there caught by
    // the snapshot manager), but a bare `void promise.finally(...)` chain would
    // itself reject and trip the daemon's unhandledRejection fatal handler.
    void promise
      .catch(() => undefined)
      .finally(() => {
        if (this.discoveryInFlight.get(cwd) === promise) {
          this.discoveryInFlight.delete(cwd);
        }
      });
    return promise;
  }

  private async runDiscovery(cwd: string): Promise<ACPDiscoverySnapshot> {
    const probe = await this.spawnProcess(ACP_PROBE_ENV, {
      initializeTimeoutMs: ACP_PROBE_INITIALIZE_TIMEOUT_MS,
    });
    try {
      const response = await probe.connection.newSession({
        cwd,
        mcpServers: [],
      });
      const transformed = this.transformSessionResponse(response);
      const models = deriveModelDefinitionsFromACP(
        this.provider,
        transformed.models,
        transformed.configOptions,
      );
      const modeInfo = deriveModesFromACP(
        this.defaultModes,
        transformed.modes,
        transformed.configOptions,
      );
      const snapshot: ACPDiscoverySnapshot = {
        cwd,
        models: this.modelTransformer ? this.modelTransformer(models) : models,
        modes: modeInfo.modes,
        fetchedAt: Date.now(),
      };
      this.discoveryByCwd.set(cwd, snapshot);
      return snapshot;
    } finally {
      await this.closeProbe(probe);
    }
  }

  async listPersistedAgents(
    options?: ListPersistedAgentsOptions,
  ): Promise<PersistedAgentDescriptor[]> {
    const probe = await this.spawnProcess(ACP_PROBE_ENV);
    try {
      if (!probe.initialize.agentCapabilities?.sessionCapabilities?.list) {
        return [];
      }

      const sessions: PersistedAgentDescriptor[] = [];
      let cursor: string | null | undefined;
      for (;;) {
        const page: ListSessionsResponse = await probe.connection.listSessions(
          cursor ? { cursor } : {},
        );
        for (const session of page.sessions) {
          sessions.push({
            provider: this.provider,
            sessionId: session.sessionId,
            cwd: session.cwd,
            title: session.title ?? null,
            lastActivityAt: session.updatedAt ? new Date(session.updatedAt) : new Date(0),
            persistence: {
              provider: this.provider,
              sessionId: session.sessionId,
              nativeHandle: session.sessionId,
              metadata: {
                provider: this.provider,
                cwd: session.cwd,
                title: session.title ?? null,
              },
            },
            timeline: [],
          });
        }
        cursor = page.nextCursor ?? null;
        if (!cursor) break;
        if (options?.limit && sessions.length >= options.limit) break;
      }

      return typeof options?.limit === "number" ? sessions.slice(0, options.limit) : sessions;
    } finally {
      await this.closeProbe(probe);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.resolveLaunchCommand();
      return true;
    } catch {
      return false;
    }
  }

  protected async spawnProcess(
    launchEnv?: Record<string, string>,
    options?: { initializeTimeoutMs?: number },
  ): Promise<SpawnedACPProcess> {
    return spawnInitializedACPProcess({
      launch: await this.resolveLaunchCommand(),
      cwd: process.cwd(),
      runtimeSettings: this.runtimeSettings,
      launchEnv,
      logger: this.logger,
      provider: this.provider,
      clientFactory: () => this.buildProbeClient(),
      initializeTimeoutMs: options?.initializeTimeoutMs,
    });
  }

  protected buildProbeClient(): ACPClient {
    return {
      async requestPermission(): Promise<RequestPermissionResponse> {
        return { outcome: { outcome: "cancelled" } };
      },
      async sessionUpdate(): Promise<void> {},
      // Probe path: agents do not issue fs requests during model/mode probing,
      // so these are protocol placeholders. The cwd-bounded
      // resolvePathInsideBase guard is applied on the live session path
      // (ACPAgentSession.readTextFile/writeTextFile/createTerminal) where real
      // agent requests arrive.
      async readTextFile(params: ReadTextFileRequest) {
        const content = await fs.readFile(params.path, "utf8");
        return { content };
      },
      async writeTextFile(params: WriteTextFileRequest) {
        await fs.mkdir(path.dirname(params.path), { recursive: true });
        await fs.writeFile(params.path, params.content, "utf8");
        return {};
      },
      async createTerminal() {
        throw new Error("ACP model probe does not support terminal execution");
      },
    };
  }

  protected async closeProbe(probe: SpawnedACPProcess): Promise<void> {
    try {
      if (probe.initialize.agentCapabilities?.sessionCapabilities?.close) {
        // No active session to close here; ignore capability.
      }
    } finally {
      await terminateACPChildProcess(probe.child, 2_000);
    }
  }

  protected async resolveLaunchCommand(): Promise<{ command: string; args: string[] }> {
    return resolveACPLaunchCommand({
      provider: this.provider,
      runtimeSettings: this.runtimeSettings,
      defaultCommand: this.defaultCommand,
    });
  }

  private assertProvider(config: AgentSessionConfig): void {
    if (config.provider !== this.provider) {
      throw new Error(`Expected ${this.provider} config, received ${config.provider}`);
    }
  }

  protected transformSessionResponse(response: SessionStateResponse): SessionStateResponse {
    const transformed = this.sessionResponseTransformer
      ? this.sessionResponseTransformer(response)
      : response;
    if (!this.configOptionsTransformer || !transformed.configOptions) {
      return transformed;
    }
    return {
      ...transformed,
      configOptions: this.configOptionsTransformer(transformed.configOptions),
    };
  }
}

export class ACPAgentSession implements AgentSession, ACPClient {
  readonly provider: string;
  readonly capabilities: AgentCapabilityFlags;

  private readonly logger: Logger;
  private readonly toolSnapshotTransformer?: (snapshot: ACPToolSnapshot) => ACPToolSnapshot;
  private readonly agentId?: string;
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly terminalController: ACPTerminalController;
  private readonly sessionUpdates: ACPSessionUpdateController;
  private readonly commandCatalog: ACPCommandCatalog;
  private readonly sessionConfig: ACPSessionConfigController;
  private readonly lifecycle: ACPSessionLifecycleController;
  private readonly foregroundTurn: ACPForegroundTurnController;
  private readonly config: AgentSessionConfig;
  private currentTitle: string | null = null;
  private lastActivityAt: string | null = null;

  constructor(config: AgentSessionConfig, options: ACPAgentSessionOptions) {
    this.provider = options.provider;
    this.capabilities = options.capabilities;
    this.logger = options.logger.child({ module: "agent", provider: options.provider });
    this.toolSnapshotTransformer = options.toolSnapshotTransformer;
    this.agentId = options.agentId;
    this.config = { ...config, provider: options.provider };
    this.terminalController = new ACPTerminalController({
      baseCwd: this.config.cwd,
      runtimeSettings: options.runtimeSettings,
    });
    this.commandCatalog = new ACPCommandCatalog({
      waitForInitialCommands: options.waitForInitialCommands ?? false,
      initialWaitTimeoutMs: options.initialCommandsWaitTimeoutMs ?? 1500,
    });
    this.foregroundTurn = new ACPForegroundTurnController({
      provider: this.provider,
      getSessionId: () => this.sessionId,
      emit: (event) => this.pushEvent(event),
      collectDiagnostic: (message) => this.collectDiagnostic(message),
      createCanceledToolEvents: () => this.sessionUpdates.createCanceledToolEvents(),
    });
    this.sessionConfig = new ACPSessionConfigController({
      provider: this.provider,
      logger: this.logger,
      defaultModes: options.defaultModes,
      initialModeId: config.modeId ?? null,
      initialModelId: config.model ?? null,
      initialThinkingOptionId: config.thinkingOptionId ?? null,
      getConnection: () => this.connection,
      getSessionId: () => this.sessionId,
      getRuntimeInfo: () => this.runtimeInfo(),
      emit: (event) => this.pushEvent(event),
      sessionResponseTransformer: options.sessionResponseTransformer,
      configOptionsTransformer: options.configOptionsTransformer,
      modeIdTransformer: options.modeIdTransformer,
      providerModeWriter: options.providerModeWriter,
      beforeModeWriter: options.beforeModeWriter,
      thinkingOptionWriter: options.thinkingOptionWriter,
    });
    this.sessionUpdates = new ACPSessionUpdateController({
      provider: this.provider,
      getTurnId: () => this.foregroundTurn.activeTurnId,
      getSuppressedUserEcho: () => this.foregroundTurn.suppressedUserEcho,
      getTerminalStates: () => this.terminalController.timelineStates,
      transformToolSnapshot: this.toolSnapshotTransformer,
      onCurrentModeUpdate: (update) => this.sessionConfig.handleCurrentModeUpdate(update),
      onConfigOptionUpdate: (update) => this.sessionConfig.handleConfigOptionUpdate(update),
      onSessionInfoUpdate: (update) => this.handleSessionInfoUpdate(update),
      onAvailableCommandsUpdate: (update) => {
        this.commandCatalog.update(update.availableCommands);
      },
    });
    this.lifecycle = new ACPSessionLifecycleController({
      provider: this.provider,
      logger: this.logger,
      cwd: this.config.cwd,
      mcpServers: this.config.mcpServers,
      runtimeSettings: options.runtimeSettings,
      defaultCommand: options.defaultCommand,
      launchEnv: options.launchEnv,
      initialHandle: options.handle,
      clientFactory: () => this,
      onProcessExit: (exit) => this.foregroundTurn.handleProcessExit(exit),
      onThreadBootstrap: () => this.foregroundTurn.markThreadBootstrapPending(),
      onSessionState: (response) => this.sessionConfig.applySessionState(response),
      applyConfiguredOverrides: () => this.sessionConfig.applyConfiguredOverrides(),
    });
    this.currentTitle = config.title ?? null;
  }

  private get connection(): ClientSideConnection | null {
    return this.lifecycle.connection;
  }

  private set connection(connection: ClientSideConnection | null) {
    this.lifecycle.connection = connection;
  }

  private get sessionId(): string | null {
    return this.lifecycle.sessionId;
  }

  private set sessionId(sessionId: string | null) {
    this.lifecycle.sessionId = sessionId;
  }

  get id(): string | null {
    return this.sessionId;
  }

  async initializeNewSession(): Promise<void> {
    await this.lifecycle.initializeNewSession();
  }

  async initializeResumedSession(): Promise<void> {
    await this.lifecycle.initializeResumedSession();
  }
  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    const result = await runProviderTurn({
      prompt,
      runOptions: options,
      startTurn: (p, o) => this.startTurn(p, o),
      subscribe: (callback) => this.subscribe(callback),
      getSessionId: () => this.sessionId ?? "",
      reduceFinalText: appendOrReplaceGrowingAssistantMessage,
    });

    if (!this.sessionId) {
      throw new Error("ACP session did not expose a session id");
    }

    return result;
  }

  async startTurn(
    prompt: AgentPromptInput,
    _options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    if (this.lifecycle.isClosed) {
      throw new Error(`${this.provider} session is closed`);
    }
    if (!this.connection || !this.sessionId) {
      throw new Error(`${this.provider} session is not initialized`);
    }
    return this.foregroundTurn.startTurn(prompt, this.connection, this.sessionId);
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    if (this.sessionId) {
      callback({
        type: "thread_started",
        provider: this.provider,
        sessionId: this.sessionId,
      });
    }
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    for (const item of this.lifecycle.drainHistory()) {
      yield { type: "timeline", provider: this.provider, item };
    }
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return this.runtimeInfo();
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return this.sessionConfig.modes;
  }

  async getCurrentMode(): Promise<string | null> {
    return this.sessionConfig.modeId;
  }

  async listCommands(): Promise<AgentSlashCommand[]> {
    return this.commandCatalog.list();
  }

  async setMode(modeId: string): Promise<void> {
    await this.sessionConfig.setMode(modeId);
  }

  async setModel(modelId: string | null): Promise<void> {
    await this.sessionConfig.setModel(modelId);
  }

  async setThinkingOption(thinkingOptionId: string | null): Promise<void> {
    await this.sessionConfig.setThinkingOption(thinkingOptionId);
  }
  getPendingPermissions(): AgentPermissionRequest[] {
    return Array.from(this.pendingPermissions.values(), (entry) => entry.request);
  }

  async respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<void> {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      throw new Error(`No pending permission request with id '${requestId}'`);
    }

    this.pendingPermissions.delete(requestId);
    const selectedOption = selectACPPermissionOption(pending.options, response);
    pending.resolve(
      selectedOption
        ? {
            outcome: {
              outcome: "selected",
              optionId: selectedOption.optionId,
            },
          }
        : { outcome: { outcome: "cancelled" } },
    );

    this.pushEvent({
      type: "permission_resolved",
      provider: this.provider,
      requestId,
      resolution: response,
      turnId: pending.turnId ?? undefined,
    });

    if (response.behavior === "deny" && response.interrupt && this.connection && this.sessionId) {
      await this.connection.cancel({ sessionId: this.sessionId });
    }
  }

  describePersistence(): AgentPersistenceHandle | null {
    if (!this.sessionId) {
      return null;
    }
    return {
      provider: this.provider,
      sessionId: this.sessionId,
      nativeHandle: this.sessionId,
      metadata: {
        ...this.config,
        title: this.currentTitle,
      },
    };
  }

  async interrupt(): Promise<void> {
    if (!this.connection || !this.sessionId) {
      return;
    }

    for (const pending of this.pendingPermissions.values()) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.pendingPermissions.clear();

    if (this.foregroundTurn.activeTurnId) {
      await this.connection.cancel({ sessionId: this.sessionId });
    }
  }

  async close(): Promise<void> {
    if (this.lifecycle.isClosed) {
      return;
    }

    this.commandCatalog.close();
    for (const pending of this.pendingPermissions.values()) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
    }
    this.pendingPermissions.clear();

    const closed = await this.lifecycle.close({
      activeTurn: this.foregroundTurn.activeTurnId !== null,
      beforeTerminate: () => this.terminalController.close(),
    });
    if (!closed) {
      return;
    }
    this.subscribers.clear();
    this.foregroundTurn.close();
  }
  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    // Match Zed acp.rs:3189-3220: generic ACP permission requests stay pure pass-through.
    const requestId = randomUUID();
    const toolSnapshot = this.sessionUpdates.buildPermissionToolSnapshot(
      params.toolCall.toolCallId,
      params.toolCall,
    );
    const request = mapACPPermissionRequest(this.provider, requestId, params, toolSnapshot);

    const promise = new Promise<RequestPermissionResponse>((resolve, reject) => {
      this.pendingPermissions.set(requestId, {
        request,
        options: params.options,
        resolve,
        reject,
        turnId: this.foregroundTurn.activeTurnId,
      });
    });

    this.pushEvent({
      type: "permission_requested",
      provider: this.provider,
      request,
      turnId: this.foregroundTurn.activeTurnId ?? undefined,
    });
    return promise;
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    this.logger.trace(
      {
        agentId: this.agentId,
        provider: this.provider,
        sessionId: params.sessionId,
        rawEvent: params,
      },
      "provider.acp.raw_event",
    );
    if (params.sessionId !== this.sessionId) {
      return;
    }

    const events = this.translateSessionUpdate(params.update);
    this.logger.trace(
      {
        agentId: this.agentId,
        provider: this.provider,
        sessionId: this.sessionId,
        turnId: this.foregroundTurn.activeTurnId ?? undefined,
        rawEvent: params,
        events,
      },
      "provider.acp.parsed_event",
    );
    if (this.lifecycle.captureReplayEvents(events)) {
      return;
    }

    for (const event of events) {
      this.pushEvent(event);
    }
  }

  async extNotification(method: string, params: Record<string, unknown>): Promise<void> {
    this.logger.trace(
      {
        agentId: this.agentId,
        provider: this.provider,
        sessionId: typeof params.sessionId === "string" ? params.sessionId : undefined,
        method,
        rawEvent: params,
      },
      "provider.acp.extension_notification",
    );
  }

  async readTextFile(params: ReadTextFileRequest): Promise<{ content: string }> {
    const resolvedPath = resolvePathInsideBase(params.path, this.config.cwd);
    const raw = await fs.readFile(resolvedPath, "utf8");
    if (!params.line && !params.limit) {
      return { content: raw };
    }
    const lines = raw.split(/\r?\n/);
    const start = Math.max((params.line ?? 1) - 1, 0);
    const end = params.limit ? start + params.limit : undefined;
    return { content: lines.slice(start, end).join("\n") };
  }

  async writeTextFile(params: WriteTextFileRequest): Promise<Record<string, never>> {
    const resolvedPath = resolvePathInsideBase(params.path, this.config.cwd);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, params.content, "utf8");
    return {};
  }

  async createTerminal(params: CreateTerminalRequest): Promise<{ terminalId: string }> {
    return this.terminalController.createTerminal(params);
  }

  async terminalOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    return this.terminalController.terminalOutput(params);
  }

  async waitForTerminalExit(params: WaitForTerminalExitRequest): Promise<ACPTerminalExit> {
    return this.terminalController.waitForTerminalExit(params);
  }

  async releaseTerminal(params: { sessionId: string; terminalId: string }): Promise<void> {
    return this.terminalController.releaseTerminal(params);
  }

  async killTerminal(params: KillTerminalRequest): Promise<Record<string, never>> {
    return this.terminalController.killTerminal(params);
  }

  private translateSessionUpdate(update: SessionUpdate): AgentStreamEvent[] {
    return this.sessionUpdates.translate(update);
  }

  private handleSessionInfoUpdate(update: SessionInfoUpdate): void {
    if ("title" in update) {
      this.currentTitle = update.title ?? null;
    }
    if ("updatedAt" in update) {
      this.lastActivityAt = update.updatedAt ?? null;
    }
  }

  private pushEvent(event: AgentStreamEvent): void {
    this.logger.trace(
      {
        agentId: this.agentId,
        provider: this.provider,
        sessionId: this.sessionId,
        turnId: getAgentStreamEventTurnId(event) ?? this.foregroundTurn.activeTurnId ?? undefined,
        event,
      },
      "provider.acp.event_emit",
    );
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  private runtimeInfo(): AgentRuntimeInfo {
    return {
      provider: this.provider,
      sessionId: this.sessionId,
      model: this.sessionConfig.modelId,
      thinkingOptionId: this.sessionConfig.thinkingOptionId,
      modeId: this.sessionConfig.modeId,
      extra: {
        title: this.currentTitle,
        updatedAt: this.lastActivityAt,
      },
    };
  }

  private collectDiagnostic(message: string): string | undefined {
    return this.lifecycle.collectDiagnostic(message);
  }
}

function coerceSessionConfigMetadata(
  metadata: AgentMetadata | undefined,
): Partial<AgentSessionConfig> {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }
  return metadata as Partial<AgentSessionConfig>;
}
