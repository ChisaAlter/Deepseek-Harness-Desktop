import {
  labelsForAgentRelation,
  readAgentRelation,
  type AgentRelation,
} from "@chisacode/protocol/agent-labels";

import type {
  AgentCreateSessionOptions,
  AgentPersistenceHandle,
  AgentSessionConfig,
} from "./agent-sdk-types.js";
import { AgentLaunchConfigController } from "./agent-launch-config-controller.js";
import type { ManagedAgent } from "./agent-manager.js";
import { AgentProviderController } from "./agent-provider-controller.js";
import { AgentSessionRegistrationController } from "./agent-session-registration-controller.js";
import { AgentSessionTeardownController } from "./agent-session-teardown-controller.js";
import { AgentTimelineController } from "./agent-timeline-controller.js";

type ActiveManagedAgent = Exclude<ManagedAgent, { lifecycle: "closed" }>;

interface CreateManagedAgentOptions {
  labels?: Record<string, string>;
  relation?: AgentRelation;
  workspaceId?: string;
  initialPrompt?: string;
  env?: Record<string, string>;
  persistSession?: boolean;
  initialTitle?: string | null;
}

interface ResumeManagedAgentOptions {
  createdAt?: Date;
  updatedAt?: Date;
  lastUserMessageAt?: Date | null;
  labels?: Record<string, string>;
  relation?: AgentRelation;
}

interface ReloadManagedAgentOptions {
  rehydrateFromDisk?: boolean;
}

interface AgentSessionLifecycleControllerOptions {
  cancelAgentRun(agentId: string): Promise<boolean>;
  getAgent(agentId: string): ActiveManagedAgent;
  hasInFlightRun(agentId: string): boolean;
  idFactory(): string;
  launchConfig: AgentLaunchConfigController;
  providers: AgentProviderController;
  registration: AgentSessionRegistrationController;
  teardown: AgentSessionTeardownController;
  timeline: AgentTimelineController;
  validateAgentId(agentId: string, source: string): string;
}

/** Owns provider session creation, persistence resume, and active session reload orchestration. */
export class AgentSessionLifecycleController {
  constructor(private readonly options: AgentSessionLifecycleControllerOptions) {}

  async create(
    config: AgentSessionConfig,
    agentId?: string,
    options?: CreateManagedAgentOptions,
  ): Promise<ManagedAgent> {
    const resolvedAgentId = this.options.validateAgentId(
      agentId ?? this.options.idFactory(),
      "createAgent",
    );
    this.options.providers.requireEnabledProvider(config.provider);
    this.options.providers.requireEnabledProvider(config.runtimeProvider ?? config.provider);
    const normalizedConfig = await this.options.launchConfig.prepareAgentConfig(
      config,
      resolvedAgentId,
    );
    const launchConfig = this.options.launchConfig.buildRuntimeLaunchConfig(normalizedConfig);
    const launchContext = this.options.launchConfig.buildLaunchContext(
      resolvedAgentId,
      options?.env,
    );
    const client = await this.options.providers.requireAvailableClient(launchConfig.provider);
    const session = await client.createSession(
      launchConfig,
      launchContext,
      this.buildCreateSessionOptions(options),
    );
    const relation = readAgentRelation(options?.labels, options?.relation) ?? undefined;
    return this.options.registration.register(session, normalizedConfig, resolvedAgentId, {
      labels: labelsForAgentRelation(options?.labels, relation),
      relation,
      workspaceId: options?.workspaceId,
      initialTitle: options?.initialTitle,
    });
  }

  async resume(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    agentId?: string,
    options?: ResumeManagedAgentOptions,
  ): Promise<ManagedAgent> {
    const resolvedAgentId = this.options.validateAgentId(
      agentId ?? this.options.idFactory(),
      "resumeAgentFromPersistence",
    );
    const metadata = { ...((handle.metadata ?? {}) as Partial<AgentSessionConfig>) };
    delete metadata.title;
    const mergedConfig = {
      ...metadata,
      ...overrides,
      provider: handle.provider,
    } as AgentSessionConfig;
    const normalizedConfig = await this.options.launchConfig.prepareAgentConfig(
      mergedConfig,
      resolvedAgentId,
    );
    const resumeOverrides = this.buildResumeOverrides(
      metadata,
      mergedConfig,
      normalizedConfig,
      overrides,
    );
    const launchConfig = this.options.launchConfig.buildRuntimeLaunchConfig(normalizedConfig);
    const runtimeProvider = launchConfig.provider;
    const launchContext = this.options.launchConfig.buildLaunchContext(resolvedAgentId);
    const client = this.options.providers.requireClient(runtimeProvider);
    const available = await client.isAvailable();
    if (!available) {
      throw new Error(
        `Provider '${runtimeProvider}' is not available. Please ensure the CLI is installed.`,
      );
    }
    const session =
      handle.provider === runtimeProvider
        ? await client.resumeSession(handle, resumeOverrides, launchContext)
        : await client.createSession(launchConfig, launchContext);
    const relation = readAgentRelation(options?.labels, options?.relation) ?? undefined;
    return this.options.registration.register(session, normalizedConfig, resolvedAgentId, {
      ...options,
      labels: labelsForAgentRelation(options?.labels, relation),
      relation,
    });
  }

  async reload(
    agentId: string,
    overrides?: Partial<AgentSessionConfig>,
    options?: ReloadManagedAgentOptions,
  ): Promise<ManagedAgent> {
    let existing = this.options.getAgent(agentId);
    if (this.options.hasInFlightRun(agentId)) {
      await this.options.cancelAgentRun(agentId);
      existing = this.options.getAgent(agentId);
    }
    const rehydrateFromDisk = options?.rehydrateFromDisk ?? false;
    const handle = existing.persistence;
    const currentRuntimeProvider =
      handle?.provider ?? existing.config.runtimeProvider ?? existing.provider;
    const runtimeProvider =
      overrides?.runtimeProvider ?? existing.config.runtimeProvider ?? currentRuntimeProvider;
    const client = this.options.providers.requireClient(runtimeProvider);
    const reloadHandle = handle?.provider === runtimeProvider ? handle : null;
    const refreshConfig = {
      ...existing.config,
      ...overrides,
      provider: existing.provider,
      runtimeProvider,
    } as AgentSessionConfig;
    const normalizedConfig = await this.options.launchConfig.prepareAgentConfig(
      refreshConfig,
      agentId,
    );
    const launchConfig = this.options.launchConfig.buildRuntimeLaunchConfig(normalizedConfig);
    const launchContext = this.options.launchConfig.buildLaunchContext(agentId);
    const session = reloadHandle
      ? await client.resumeSession(reloadHandle, launchConfig, launchContext)
      : await client.createSession(launchConfig, launchContext);

    await this.options.teardown.detachForReload(existing);
    if (rehydrateFromDisk) {
      await this.options.timeline.deleteAll(agentId);
    }

    return this.options.registration.register(session, normalizedConfig, agentId, {
      labels: existing.labels,
      relation: existing.relation,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
      lastUserMessageAt: existing.lastUserMessageAt,
      historyPrimed: rehydrateFromDisk ? false : existing.historyPrimed,
      lastUsage: existing.lastUsage,
      lastError: existing.lastError,
      attention: existing.attention,
    });
  }

  private buildCreateSessionOptions(
    options?: Pick<CreateManagedAgentOptions, "persistSession">,
  ): AgentCreateSessionOptions | undefined {
    return options?.persistSession === undefined
      ? undefined
      : { persistSession: options.persistSession };
  }

  private buildResumeOverrides(
    metadata: Partial<AgentSessionConfig>,
    mergedConfig: AgentSessionConfig,
    normalizedConfig: AgentSessionConfig,
    overrides: Partial<AgentSessionConfig> | undefined,
  ): Partial<AgentSessionConfig> | undefined {
    const resumeOverrides: Partial<AgentSessionConfig> = { ...overrides };
    let hasResumeOverrides = overrides !== undefined;

    if (normalizedConfig.model !== mergedConfig.model) {
      resumeOverrides.model = normalizedConfig.model;
      hasResumeOverrides = true;
    }
    if (normalizedConfig.modeId !== mergedConfig.modeId) {
      resumeOverrides.modeId = normalizedConfig.modeId;
      hasResumeOverrides = true;
    }
    if (metadata.daemonAppendSystemPrompt !== normalizedConfig.daemonAppendSystemPrompt) {
      resumeOverrides.daemonAppendSystemPrompt = normalizedConfig.daemonAppendSystemPrompt;
      hasResumeOverrides = true;
    }
    if (JSON.stringify(metadata.extra) !== JSON.stringify(normalizedConfig.extra)) {
      resumeOverrides.extra = normalizedConfig.extra;
      hasResumeOverrides = true;
    }
    return hasResumeOverrides ? resumeOverrides : undefined;
  }
}
