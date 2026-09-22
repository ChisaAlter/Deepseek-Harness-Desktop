import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { Logger } from "pino";

import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentCreateSessionOptions,
  AgentLaunchContext,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentSession,
  AgentSessionConfig,
  ListModelsOptions,
  ListPersistedAgentsOptions,
  PersistedAgentDescriptor,
} from "../../agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import type { WorkspaceGitService } from "../../../workspace-git-service.js";
import { CodexClientRuntime, type CodexClientRuntimeDeps } from "./client-runtime.js";
import { spawnCodexAppServer } from "./launch.js";
import { buildCodexCustomProviderConfig, type CodexCustomProvider } from "./runtime-config.js";

export const CODEX_PROVIDER = "codex" as const;

export const CODEX_APP_SERVER_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsRewindConversation: true,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
};

export interface CodexAppServerAgentDeps extends CodexClientRuntimeDeps {
  workspaceGitService?: Pick<WorkspaceGitService, "resolveRepoRoot">;
  customProvider?: CodexCustomProvider;
  customCodexConfig?: Record<string, unknown> | null;
}

export interface CodexConnectableSession extends AgentSession {
  connect(): Promise<void>;
}

export interface CodexSessionFactoryInput {
  config: AgentSessionConfig;
  resumeHandle: AgentPersistenceHandle | null;
  logger: Logger;
  spawnAppServer: () => Promise<ChildProcessWithoutNullStreams>;
  deps: CodexAppServerAgentDeps;
  ephemeral: boolean;
  goalsEnabled: boolean;
  autoReviewEnabled: boolean;
  agentId?: string;
}

export type CodexSessionFactory = (input: CodexSessionFactoryInput) => CodexConnectableSession;

export class CodexAppServerAgentClient implements AgentClient {
  readonly provider = CODEX_PROVIDER;
  readonly capabilities = CODEX_APP_SERVER_CAPABILITIES;
  private readonly clientRuntime: CodexClientRuntime;

  constructor(
    private readonly logger: Logger,
    private readonly runtimeSettings: ProviderRuntimeSettings | undefined,
    private readonly deps: CodexAppServerAgentDeps,
    private readonly createCodexSession: CodexSessionFactory,
  ) {
    this.clientRuntime = new CodexClientRuntime(this.logger, this.runtimeSettings, this.deps, () =>
      this.spawnAppServer(),
    );
  }

  private get goalsEnabledPromise(): Promise<boolean> | null {
    return this.clientRuntime.getGoalsEnabledPromise();
  }

  private set goalsEnabledPromise(value: Promise<boolean> | null) {
    this.clientRuntime.setGoalsEnabledPromise(value);
  }

  private get autoReviewEnabledPromise(): Promise<boolean> | null {
    return this.clientRuntime.getAutoReviewEnabledPromise();
  }

  private set autoReviewEnabledPromise(value: Promise<boolean> | null) {
    this.clientRuntime.setAutoReviewEnabledPromise(value);
  }

  private sessionDeps(): CodexAppServerAgentDeps {
    return {
      ...this.deps,
      customCodexConfig: buildCodexCustomProviderConfig(
        this.runtimeSettings,
        this.deps.customProvider,
      ),
    };
  }

  private resolveGoalsEnabled(): Promise<boolean> {
    if (!this.goalsEnabledPromise) {
      this.goalsEnabledPromise = this.clientRuntime.resolveGoalsEnabled();
    }
    return this.goalsEnabledPromise;
  }

  private resolveAutoReviewEnabled(): Promise<boolean> {
    if (!this.autoReviewEnabledPromise) {
      this.autoReviewEnabledPromise = this.clientRuntime.resolveAutoReviewEnabled();
    }
    return this.autoReviewEnabledPromise;
  }

  /**
   * Pre-warm memoized version probes so the first createSession/startTurn does not
   * pay a cold `codex --version` exec on the critical path.
   */
  warmVersionGates(): void {
    void this.resolveGoalsEnabled();
    void this.resolveAutoReviewEnabled();
  }

  private async spawnAppServer(
    launchEnv?: Record<string, string>,
    options?: { goalsEnabled?: boolean; agentId?: string },
  ): Promise<ChildProcessWithoutNullStreams> {
    return spawnCodexAppServer({
      logger: this.logger,
      runtimeSettings: this.runtimeSettings,
      launchEnv,
      goalsEnabled: options?.goalsEnabled,
      agentId: options?.agentId,
    });
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
    options?: AgentCreateSessionOptions,
  ): Promise<AgentSession> {
    if (options?.persistSession === false) {
      this.logger.debug(
        "Codex app-server does not expose an ephemeral-session option; persistSession=false is currently a no-op",
      );
      // TODO: Honor persistSession=false if app-server adds support, or route
      // utility generations through `codex exec --ephemeral` in a larger change.
    }
    const goalsEnabled = await this.resolveGoalsEnabled();
    const autoReviewEnabled = await this.resolveAutoReviewEnabled();
    const session = this.createCodexSession({
      config: { ...config, provider: CODEX_PROVIDER },
      resumeHandle: null,
      logger: this.logger,
      spawnAppServer: () =>
        this.spawnAppServer(launchContext?.env, {
          goalsEnabled,
          agentId: launchContext?.agentId,
        }),
      deps: this.sessionDeps(),
      ephemeral: options?.persistSession === false,
      goalsEnabled,
      autoReviewEnabled,
      agentId: launchContext?.agentId,
    });
    // Defer app-server spawn + initialize to startTurn/connect (idempotent).
    // Returning a disconnected session keeps create/resume off the send critical path.
    return session;
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const storedConfig = (handle.metadata ?? {}) as Partial<AgentSessionConfig>;
    const goalsEnabled = await this.resolveGoalsEnabled();
    const autoReviewEnabled = await this.resolveAutoReviewEnabled();
    const session = this.createCodexSession({
      config: {
        ...storedConfig,
        ...overrides,
        provider: CODEX_PROVIDER,
        cwd: overrides?.cwd ?? storedConfig.cwd ?? process.cwd(),
      },
      resumeHandle: handle,
      logger: this.logger,
      spawnAppServer: () =>
        this.spawnAppServer(launchContext?.env, {
          goalsEnabled,
          agentId: launchContext?.agentId,
        }),
      deps: this.sessionDeps(),
      ephemeral: false,
      goalsEnabled,
      autoReviewEnabled,
      agentId: launchContext?.agentId,
    });
    // Same deferred-connect contract as createSession.
    return session;
  }

  listPersistedAgents(options?: ListPersistedAgentsOptions): Promise<PersistedAgentDescriptor[]> {
    return this.clientRuntime.listPersistedAgents(options);
  }

  listModels(options: ListModelsOptions): Promise<AgentModelDefinition[]> {
    return this.clientRuntime.listModels(options);
  }

  archiveNativeSession(handle: AgentPersistenceHandle): Promise<void> {
    return this.clientRuntime.archiveNativeSession(handle);
  }

  isAvailable(): Promise<boolean> {
    return this.clientRuntime.isAvailable();
  }

  getDiagnostic(): Promise<{ diagnostic: string }> {
    return this.clientRuntime.getDiagnostic();
  }
}
