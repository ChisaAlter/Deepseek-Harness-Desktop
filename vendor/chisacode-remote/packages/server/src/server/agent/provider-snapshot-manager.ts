import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { resolve } from "node:path";

import type { Logger } from "pino";

import { expandTilde } from "../../utils/path.js";
import { withTimeout } from "../../utils/promise-timeout.js";
import type {
  AgentClient,
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "./agent-sdk-types.js";
import type { ManagedAgent } from "./agent-manager.js";
import type { WorkspaceGitService } from "../workspace-git-service.js";
import type {
  AgentProviderRuntimeSettingsMap,
  ModelGatewayConfigs,
  ProviderOverride,
  ProviderRuntimeSettings,
} from "./provider-launch-config.js";
import { checkProviderLaunchAvailable, resolveProviderLaunch } from "./provider-launch-config.js";
import {
  buildProviderRegistry,
  shutdownAgentClients,
  type ProviderDefinition,
} from "./provider-registry.js";
import {
  getProviderToolingDefinition,
  getProviderToolingInfo,
  runProviderToolingAction,
  type ProviderToolingAction,
  type ProviderToolingActionResult,
} from "./provider-tooling.js";
import { applyMutableProviderConfigToOverrides } from "../daemon-config-store.js";
import type { MutableDaemonConfig } from "../daemon-config-store.js";
import {
  redactDiagnosticArgv,
  redactDiagnosticText,
  type DiagnosticPathRedaction,
} from "../diagnostic-redaction.js";

const DEFAULT_REFRESH_TIMEOUT_MS = 30_000;
/** Full refreshes skip ready providers whose snapshot is newer than this. */
const PROVIDER_READY_FRESH_MS = 60_000;
/**
 * Maximum provider probes running at once, shared across every cwd scope.
 * Cold-start warm-up previously fired all providers in parallel, so a slow
 * runtime (e.g. one waiting on machine-level MCP during initialize) starved
 * the others into the 30s timeout. Two slots keep the first round finishing
 * while still pipelining the rest.
 */
const MAX_PROVIDER_PROBE_CONCURRENCY = 2;

type ProviderSnapshotChangeListener = (entries: ProviderSnapshotEntry[], cwd: string) => void;

export interface ProviderSnapshotManagerOptions {
  logger: Logger;
  runtimeSettings?: AgentProviderRuntimeSettingsMap;
  providerOverrides?: Record<string, ProviderOverride>;
  modelGateways?: ModelGatewayConfigs;
  modelGatewayBaseUrl?: string;
  modelGatewayToken?: string;
  workspaceGitService?: Pick<WorkspaceGitService, "resolveRepoRoot">;
  isDev?: boolean;
  /** Register dev-only providers (mock) in non-dev daemons for e2e/packaged gates. */
  enableDevProviders?: boolean;
  extraClients?: Partial<Record<AgentProvider, AgentClient>>;
  refreshTimeoutMs?: number;
}

interface ProviderSnapshotRefreshOptions {
  cwd: string;
  providers?: AgentProvider[];
}

interface ProviderSnapshotReadOptions {
  cwd?: string | null;
  providers?: AgentProvider[];
  wait?: boolean;
}

interface ProviderSnapshotProviderOptions {
  cwd?: string | null;
  provider: AgentProvider;
  wait?: boolean;
}

interface ResolveProviderCreateConfigOptions {
  cwd?: string | null;
  provider: AgentProvider;
  requestedMode: string | undefined;
  featureValues: Record<string, unknown> | undefined;
  parent: ManagedAgent | null;
}

export interface ResolvedProviderCreateConfig {
  modeId: string | undefined;
  featureValues: Record<string, unknown> | undefined;
}

interface ResolveDefaultModelOptions {
  provider: AgentProvider;
  requestedModel?: string | null;
  cwd?: string;
}

export interface ProviderDiagnosticResult {
  provider: AgentProvider;
  diagnostic: string;
  details: ProviderDiagnosticDetails;
}

export interface ProviderDiagnosticDetails {
  provider: AgentProvider;
  effectiveCommand?: {
    argv: string[];
    source: "default" | "append" | "override" | "custom" | "unknown";
    resolvedPath: string | null;
    available: boolean;
  };
  cwd: string;
  env: Array<{
    name: string;
    present: boolean;
    source: "process" | "provider-config";
  }>;
  mcpInjection: {
    supported: boolean;
    enabled: boolean;
    reason: string;
  };
  tooling?: {
    installedVersion?: string | null;
    latestVersion?: string | null;
    versionStatus?: "unknown" | "not-installed" | "current" | "outdated";
    packageName?: string;
    installAvailable?: boolean;
    updateAvailable?: boolean;
    checkedAt?: string;
  };
}

export interface AgentManagerProviderState {
  providerDefinitions: Partial<
    Record<AgentProvider, { enabled: boolean; derivedFromProviderId: string | null }>
  >;
  clients: Partial<Record<AgentProvider, AgentClient>>;
}

interface ProviderLoadOptions {
  cwd: string;
  providers: AgentProvider[];
  force: boolean;
}
interface ProviderLoad {
  promise: Promise<void>;
}

export class ProviderSnapshotManager {
  private readonly snapshots = new Map<string, Map<AgentProvider, ProviderSnapshotEntry>>();
  private readonly providerLoads = new Map<string, Map<AgentProvider, ProviderLoad>>();
  private readonly events = new EventEmitter();
  private destroyed = false;
  private readonly refreshTimeoutMs: number;
  private readonly logger: Logger;
  private readonly workspaceGitService?: Pick<WorkspaceGitService, "resolveRepoRoot">;
  private readonly isDev: boolean;
  private readonly enableDevProviders: boolean;
  private readonly extraClients: Partial<Record<AgentProvider, AgentClient>>;
  private runtimeSettings: AgentProviderRuntimeSettingsMap | undefined;
  private providerOverrides: Record<string, ProviderOverride> | undefined;
  private readonly baseProviderOverrides: Record<string, ProviderOverride> | undefined;
  private modelGateways: ModelGatewayConfigs | undefined;
  private readonly modelGatewayBaseUrl: string | undefined;
  private readonly modelGatewayToken: string | undefined;
  private providerRegistry: Record<AgentProvider, ProviderDefinition>;
  private providerClients: Record<AgentProvider, AgentClient>;
  private mcpInjectionState: { enabled: boolean; baseUrl: string | null } = {
    enabled: false,
    baseUrl: null,
  };
  private activeProbes = 0;
  private readonly probeQueue: Array<() => void> = [];

  constructor(options: ProviderSnapshotManagerOptions) {
    this.logger = options.logger;
    this.workspaceGitService = options.workspaceGitService;
    this.isDev = options.isDev === true;
    this.enableDevProviders = options.enableDevProviders === true;
    this.extraClients = options.extraClients ?? {};
    this.runtimeSettings = options.runtimeSettings;
    this.providerOverrides = options.providerOverrides;
    this.baseProviderOverrides = options.providerOverrides;
    this.modelGateways = options.modelGateways;
    this.modelGatewayBaseUrl = options.modelGatewayBaseUrl;
    this.modelGatewayToken = options.modelGatewayToken;
    this.refreshTimeoutMs = options.refreshTimeoutMs ?? DEFAULT_REFRESH_TIMEOUT_MS;
    this.providerRegistry = this.buildRegistry();
    this.providerClients = { ...this.extraClients } as Record<AgentProvider, AgentClient>;
  }

  getSnapshot(cwd?: string): ProviderSnapshotEntry[] {
    if (this.destroyed) {
      return [];
    }
    const resolvedCwd = resolveSnapshotCwd(cwd);
    const entries = this.snapshots.get(resolvedCwd);
    if (!entries) {
      const loadingEntries = this.resetSnapshotToLoading(resolvedCwd);
      void this.warmUp(resolvedCwd);
      return entriesToArray(loadingEntries);
    }
    const missingProviders = this.getProviderIds().filter((provider) => !entries.has(provider));
    if (missingProviders.length > 0) {
      const loadingEntries = this.createLoadingEntries();
      for (const provider of missingProviders) {
        const loadingEntry = loadingEntries.get(provider);
        if (loadingEntry) {
          entries.set(provider, loadingEntry);
        }
      }
      void this.warmUp(resolvedCwd, missingProviders);
    }
    const providerLoads = this.providerLoads.get(resolvedCwd);
    const loadingProviders = Array.from(entries.values())
      .filter((entry) => entry.status === "loading" && !providerLoads?.has(entry.provider))
      .map((entry) => entry.provider);
    if (loadingProviders.length > 0) {
      void this.warmUp(resolvedCwd, loadingProviders);
    }
    return entriesToArray(entries);
  }

  async refreshSnapshotForCwd(options: ProviderSnapshotRefreshOptions): Promise<void> {
    if (this.destroyed) {
      return;
    }
    const snapshotCwd = resolveSnapshotCwd(options.cwd);
    const providers = this.resolveRefreshProviders(options.providers);
    const providersToRefresh = providers ?? this.resolveFullRefreshProviders(snapshotCwd);
    this.resetSnapshotToLoading(snapshotCwd, providersToRefresh, { preserveExisting: true });
    this.emitChange(snapshotCwd);
    await this.refreshProviders(snapshotCwd, providersToRefresh);
  }

  async refreshSettingsSnapshot(
    options: Omit<ProviderSnapshotRefreshOptions, "cwd"> = {},
  ): Promise<void> {
    if (this.destroyed) {
      return;
    }
    const homeCwd = resolveSnapshotCwd();
    const providers = this.resolveRefreshProviders(options.providers);
    const providersToRefresh = providers ?? this.getProviderIds();

    this.clearCachedProviders(providers);
    const scopes = new Set([...this.snapshots.keys(), homeCwd]);
    for (const cwd of scopes) {
      this.resetSnapshotToLoading(cwd, providers, { preserveExisting: true });
      this.emitChange(cwd);
    }
    await Promise.all(Array.from(scopes, (cwd) => this.refreshProviders(cwd, providersToRefresh)));
  }

  async warmUpSnapshotForCwd(options: ProviderSnapshotRefreshOptions): Promise<void> {
    if (this.destroyed) {
      return;
    }
    const snapshotCwd = resolveSnapshotCwd(options.cwd);
    const providers = this.resolveRefreshProviders(options.providers);
    if (options.providers && providers?.length === 0) {
      return;
    }

    const snapshot = this.snapshots.get(snapshotCwd);
    if (!snapshot) {
      this.resetSnapshotToLoading(snapshotCwd, providers);
    } else if (providers) {
      const missingProviders = providers.filter((provider) => !snapshot.has(provider));
      if (missingProviders.length > 0) {
        this.resetSnapshotToLoading(snapshotCwd, missingProviders);
      }
    }

    await this.warmUp(snapshotCwd, providers);
  }

  async refresh(options: ProviderSnapshotRefreshOptions): Promise<void> {
    await this.refreshSnapshotForCwd(options);
  }

  listRegisteredProviderIds(): AgentProvider[] {
    return this.getProviderIds();
  }

  hasProvider(provider: AgentProvider): boolean {
    return Object.prototype.hasOwnProperty.call(this.providerRegistry, provider);
  }

  setMcpInjectionState(state: { enabled: boolean; baseUrl: string | null }): void {
    this.mcpInjectionState = { ...state };
  }

  getProviderLabel(provider: AgentProvider): string {
    return this.providerRegistry[provider]?.label ?? provider;
  }

  getAgentManagerProviderState(): AgentManagerProviderState {
    const providerDefinitions: AgentManagerProviderState["providerDefinitions"] = {};
    const clients: AgentManagerProviderState["clients"] = {};
    for (const [provider, definition] of Object.entries(this.providerRegistry)) {
      providerDefinitions[provider] = {
        enabled: definition.enabled,
        derivedFromProviderId: definition.derivedFromProviderId,
      };
      if (definition.enabled) {
        clients[provider] = this.ensureClient(provider, definition);
      }
    }
    for (const [provider, client] of Object.entries(this.extraClients)) {
      if (client) {
        clients[provider] = client;
      }
    }
    return { providerDefinitions, clients };
  }

  private ensureClient(provider: AgentProvider, definition: ProviderDefinition): AgentClient {
    const existing = this.providerClients[provider];
    if (existing) {
      return existing;
    }
    const client = definition.createClient(this.logger);
    this.providerClients[provider] = client;
    return client;
  }

  private warmCodexVersionGates(provider: AgentProvider): void {
    if (provider !== "codex") {
      return;
    }
    const client = this.providerClients[provider] as
      | (AgentClient & { warmVersionGates?: () => void })
      | undefined;
    if (!client || typeof client.warmVersionGates !== "function") {
      return;
    }
    try {
      client.warmVersionGates();
    } catch (error) {
      this.logger.debug({ err: error, provider }, "Failed to warm codex version gates");
    }
  }

  async listProviders(input: ProviderSnapshotReadOptions = {}): Promise<ProviderSnapshotEntry[]> {
    const cwd = resolveSnapshotCwd(input.cwd);
    if (input.wait) {
      await this.warmUpSnapshotForCwd({ cwd, providers: input.providers });
    }
    const providerFilter = input.providers ? new Set(input.providers) : null;
    const entries = this.getSnapshot(cwd);
    return providerFilter ? entries.filter((entry) => providerFilter.has(entry.provider)) : entries;
  }

  async getProvider(input: ProviderSnapshotProviderOptions): Promise<ProviderSnapshotEntry> {
    const entry = (await this.listProviders({ ...input, providers: [input.provider] })).find(
      (candidate) => candidate.provider === input.provider,
    );
    if (!entry) {
      throw new Error(`Provider ${input.provider} is not configured`);
    }
    return entry;
  }

  async listModels(input: ProviderSnapshotProviderOptions): Promise<AgentModelDefinition[]> {
    const entry = await this.getReadyProvider(input);
    return entry.models ?? [];
  }

  async listModes(input: ProviderSnapshotProviderOptions): Promise<AgentMode[]> {
    const entry = await this.getReadyProvider(input);
    return entry.modes ?? [];
  }

  async resolveDefaultModel(input: ResolveDefaultModelOptions): Promise<string | undefined> {
    try {
      const trimmed = input.requestedModel?.trim();
      if (trimmed) {
        return trimmed;
      }
      const models = await this.listModels({
        provider: input.provider,
        cwd: input.cwd ? expandTilde(input.cwd) : undefined,
        wait: true,
      });
      const preferred = models.find((model) => model.isDefault) ?? models[0];
      return preferred?.id;
    } catch (error) {
      this.logger.warn({ err: error, provider: input.provider }, "Failed to resolve default model");
      return undefined;
    }
  }

  async resolveCreateConfig(
    input: ResolveProviderCreateConfigOptions,
  ): Promise<ResolvedProviderCreateConfig> {
    const entry = await this.getReadyProvider({
      cwd: input.cwd,
      provider: input.provider,
      wait: true,
    });
    const definition = this.requireProvider(input.provider);
    return definition.resolveCreateConfig({
      provider: input.provider,
      requestedMode: input.requestedMode,
      featureValues: input.featureValues,
      parent: input.parent ? this.resolveParent(input.parent) : null,
      availableModes: entry.modes ?? [],
    });
  }

  async getProviderDiagnostic(provider: AgentProvider): Promise<ProviderDiagnosticResult> {
    const definition = this.requireProvider(provider);
    const client = this.ensureClient(provider, definition);
    const rawDetails = await this.buildProviderDiagnosticDetails(provider, definition, client);
    const pathRedactions: DiagnosticPathRedaction[] = [{ value: homedir(), replacement: "<home>" }];
    const details: ProviderDiagnosticDetails = {
      ...rawDetails,
      cwd: redactDiagnosticText(rawDetails.cwd, { paths: pathRedactions }),
      ...(rawDetails.effectiveCommand
        ? {
            effectiveCommand: {
              ...rawDetails.effectiveCommand,
              argv: redactDiagnosticArgv(rawDetails.effectiveCommand.argv).map((argument) =>
                redactDiagnosticText(argument, { paths: pathRedactions }),
              ),
              resolvedPath: rawDetails.effectiveCommand.resolvedPath
                ? redactDiagnosticText(rawDetails.effectiveCommand.resolvedPath, {
                    paths: pathRedactions,
                  })
                : null,
            },
          }
        : {}),
    };
    const providerDiagnostic = client.getDiagnostic
      ? redactDiagnosticText((await client.getDiagnostic()).diagnostic, {
          paths: pathRedactions,
        })
      : "No provider-specific diagnostic available.";
    return {
      provider,
      diagnostic: formatProviderDiagnosticReport({
        providerLabel: definition.label ?? provider,
        details,
        providerDiagnostic,
      }),
      details,
    };
  }

  async runProviderToolingAction(
    provider: AgentProvider,
    action: ProviderToolingAction,
  ): Promise<ProviderToolingActionResult> {
    if (!this.hasProvider(provider)) {
      throw new Error(`Provider ${provider} is not configured`);
    }
    const result = await runProviderToolingAction(provider, action);
    await this.refreshSettingsSnapshot({ providers: [provider] });
    return result;
  }

  applyMutableProviderConfig(
    mutableProviders: MutableDaemonConfig["providers"] | undefined,
    modelGateways?: MutableDaemonConfig["modelGateways"] | undefined,
  ): AgentManagerProviderState {
    if (this.destroyed) {
      return this.getAgentManagerProviderState();
    }
    const previousClients = this.providerClients;
    this.providerOverrides = applyMutableProviderConfigToOverrides(
      this.baseProviderOverrides,
      mutableProviders,
    );
    this.modelGateways = modelGateways;
    this.providerRegistry = this.buildRegistry();
    this.providerClients = { ...this.extraClients } as Record<AgentProvider, AgentClient>;

    const nextClients = new Set(Object.values(this.providerClients));
    const replacedClients = Object.values(previousClients).filter(
      (client): client is AgentClient => client !== undefined && !nextClients.has(client),
    );
    void shutdownAgentClients(replacedClients, this.logger);

    for (const cwd of this.snapshots.keys()) {
      this.providerLoads.delete(cwd);
      this.snapshots.set(cwd, this.reconcileSnapshotForRegistry(cwd));
      this.emitChange(cwd);
    }

    return this.getAgentManagerProviderState();
  }

  on(event: "change", listener: ProviderSnapshotChangeListener): this {
    this.events.on(event, listener);
    return this;
  }

  off(event: "change", listener: ProviderSnapshotChangeListener): this {
    this.events.off(event, listener);
    return this;
  }

  async shutdown(): Promise<void> {
    // Materialize a client per enabled provider so provider-owned resources
    // (background processes, sockets, etc.) get a chance to release even when
    // a given provider hasn't been touched yet during this daemon's lifetime.
    const state = this.getAgentManagerProviderState();
    const clients = Object.values(state.clients).filter(
      (client): client is AgentClient => client !== undefined,
    );
    await shutdownAgentClients(clients, this.logger);
  }

  destroy(): void {
    this.destroyed = true;
    this.events.removeAllListeners();
    this.snapshots.clear();
    this.providerLoads.clear();
    // Release queued probes; their loads short-circuit on the destroyed flag.
    while (this.probeQueue.length > 0) {
      this.probeQueue.shift()?.();
    }
  }

  private buildRegistry(): Record<AgentProvider, ProviderDefinition> {
    return buildProviderRegistry(this.logger, {
      runtimeSettings: this.runtimeSettings,
      providerOverrides: this.providerOverrides,
      modelGateways: this.modelGateways,
      modelGatewayBaseUrl: this.modelGatewayBaseUrl,
      modelGatewayToken: this.modelGatewayToken,
      workspaceGitService: this.workspaceGitService,
      isDev: this.isDev,
      enableDevProviders: this.enableDevProviders,
    });
  }

  private resolveParent(parent: ManagedAgent) {
    const definition = this.requireProvider(parent.provider);
    return {
      provider: parent.provider,
      modeId: parent.currentModeId,
      isUnattended: definition.isCreateConfigUnattended({
        modeId: parent.currentModeId,
        config: parent.config,
        features: parent.features,
        availableModes: parent.availableModes ?? definition.modes ?? [],
      }),
    };
  }

  private async getReadyProvider(
    input: ProviderSnapshotProviderOptions,
  ): Promise<ProviderSnapshotEntry> {
    const entry = await this.getProvider(input);
    if (!entry.enabled) {
      throw new Error(`Provider '${entry.provider}' is disabled`);
    }
    if (entry.status === "ready") {
      return entry;
    }
    if (entry.status === "error") {
      throw new Error(entry.error ?? `Failed to load provider '${entry.provider}'`);
    }
    throw new Error(`Provider '${entry.provider}' is not available`);
  }

  private requireProvider(provider: AgentProvider): ProviderDefinition {
    const definition = this.providerRegistry[provider];
    if (!definition) {
      throw new Error(`Provider ${provider} is not configured`);
    }
    return definition;
  }

  private createLoadingEntries(): Map<AgentProvider, ProviderSnapshotEntry> {
    const entries = new Map<AgentProvider, ProviderSnapshotEntry>();
    for (const provider of this.getProviderIds()) {
      const definition = this.providerRegistry[provider];
      entries.set(provider, {
        provider,
        status: "loading",
        enabled: definition?.enabled ?? true,
        label: definition?.label,
        description: definition?.description,
        defaultModeId: definition?.defaultModeId ?? null,
        derivedFromProviderId: definition?.derivedFromProviderId ?? null,
        modelGatewayId: definition?.modelGatewayId ?? null,
      });
    }
    return entries;
  }

  private reconcileSnapshotForRegistry(cwd: string): Map<AgentProvider, ProviderSnapshotEntry> {
    const existing = this.snapshots.get(cwd);
    const entries = new Map<AgentProvider, ProviderSnapshotEntry>();

    for (const provider of this.getProviderIds()) {
      const definition = this.providerRegistry[provider];
      const current = existing?.get(provider);
      const metadata = {
        provider,
        enabled: definition?.enabled ?? true,
        label: definition?.label,
        description: definition?.description,
        defaultModeId: definition?.defaultModeId ?? null,
        derivedFromProviderId: definition?.derivedFromProviderId ?? null,
        modelGatewayId: definition?.modelGatewayId ?? null,
      };

      if (!definition?.enabled) {
        entries.set(provider, {
          ...metadata,
          status: "unavailable",
          statusReason: "disabled",
          enabled: false,
        });
        continue;
      }

      entries.set(provider, {
        ...metadata,
        status: "loading",
        statusReason: "configuration_changed",
        enabled: true,
        ...preservedProviderSnapshotData(current),
      });
    }

    return entries;
  }

  private async warmUp(cwd: string, providers?: AgentProvider[]): Promise<void> {
    if (this.destroyed) {
      return;
    }
    const providersToRefresh = providers ?? this.getProviderIds();

    await this.loadProviders({
      cwd,
      providers: providersToRefresh,
      force: false,
    });
  }

  private async refreshProviders(cwd: string, providers: AgentProvider[]): Promise<void> {
    if (this.destroyed) {
      return;
    }
    await this.loadProviders({ cwd, providers, force: true });
  }

  private clearCachedProviders(providers?: AgentProvider[]): void {
    const providerSet = providers ? new Set(providers) : null;

    for (const [cwd, providerLoads] of Array.from(this.providerLoads.entries())) {
      if (!providerSet) {
        this.providerLoads.delete(cwd);
        continue;
      }

      for (const provider of providerSet) {
        providerLoads.delete(provider);
      }
      if (providerLoads.size === 0) {
        this.providerLoads.delete(cwd);
      }
    }
  }

  private async loadProviders(options: ProviderLoadOptions): Promise<void> {
    await Promise.allSettled(
      options.providers.map((provider) => {
        const existingLoad = this.getProviderLoad(options.cwd, provider);
        if (existingLoad) {
          // Already probing in this scope — join it instead of consuming a
          // probe slot for a duplicate.
          return existingLoad.promise;
        }
        return this.withProbeSlot(() => this.loadProvider({ ...options, provider }));
      }),
    );
  }

  /**
   * Runs a single provider load under the shared probe concurrency slot.
   * Queued loads wait for a free slot before calling `loadProvider`; slots
   * are released as soon as the load settles (including the in-flight reuse
   * short-circuit).
   */
  private async withProbeSlot<T>(task: () => Promise<T>): Promise<T> {
    while (this.activeProbes >= MAX_PROVIDER_PROBE_CONCURRENCY) {
      await new Promise<void>((release) => {
        this.probeQueue.push(release);
      });
    }
    this.activeProbes += 1;
    try {
      return await task();
    } finally {
      this.activeProbes -= 1;
      const next = this.probeQueue.shift();
      if (next) {
        next();
      }
    }
  }

  private loadProvider(options: ProviderLoadOptions & { provider: AgentProvider }): Promise<void> {
    if (this.destroyed) {
      return Promise.resolve();
    }
    const definition = this.providerRegistry[options.provider];
    if (!definition) {
      return Promise.resolve();
    }

    const existingLoad = this.getProviderLoad(options.cwd, options.provider);
    if (existingLoad) {
      // A probe is already in flight for this provider in this scope. Reuse it
      // instead of running a parallel availability check and model fetch — the
      // in-flight load emits its result through the same snapshot entry.
      // refreshSettingsSnapshot clears cached loads before forcing, so explicit
      // settings refreshes still start a fresh probe.
      return existingLoad.promise;
    }

    const load: ProviderLoad = {
      promise: Promise.resolve(),
    };
    this.setProviderLoad(options.cwd, options.provider, load);
    load.promise = Promise.resolve()
      .then(() =>
        this.refreshProvider({
          cwd: options.cwd,
          provider: options.provider,
          definition,
          load,
          force: options.force,
        }),
      )
      .finally(() => {
        const providerLoads = this.providerLoads.get(options.cwd);
        if (providerLoads?.get(options.provider) === load) {
          providerLoads.delete(options.provider);
        }
        if (providerLoads?.size === 0) {
          this.providerLoads.delete(options.cwd);
        }
      });
    return load.promise;
  }

  private async refreshProvider(options: {
    cwd: string;
    provider: AgentProvider;
    definition: ProviderDefinition;
    load: ProviderLoad;
    force: boolean;
  }): Promise<void> {
    const { cwd, provider, definition, load, force } = options;
    const snapshot = this.getOrCreateSnapshot(options.cwd);
    const base = {
      provider,
      label: definition.label,
      description: definition.description,
      defaultModeId: definition.defaultModeId,
      derivedFromProviderId: definition.derivedFromProviderId,
      modelGatewayId: definition.modelGatewayId,
    };
    const setEntry = async (entry: ProviderSnapshotEntry) => {
      if (this.destroyed || !this.isCurrentProviderLoad(cwd, provider, load)) {
        return false;
      }
      const tooling = await this.resolveToolingMetadata(provider);
      if (this.destroyed || !this.isCurrentProviderLoad(cwd, provider, load)) {
        return false;
      }
      snapshot.set(provider, {
        ...entry,
        ...tooling,
      });
      this.emitChange(cwd);
      return true;
    };

    try {
      if (!definition.enabled) {
        await setEntry({
          ...base,
          status: "unavailable",
          statusReason: "disabled",
          enabled: false,
          ...preservedProviderSnapshotData(snapshot.get(provider)),
        });
        return;
      }

      const client = this.ensureClient(provider, definition);
      let available: boolean;
      try {
        available = await withTimeout(
          client.isAvailable(),
          this.refreshTimeoutMs,
          `Timed out checking ${definition.label} availability after ${this.refreshTimeoutMs}ms`,
        );
      } catch (error) {
        const emitted = await setEntry({
          ...base,
          status: "error",
          statusReason: "runtime_unavailable",
          enabled: true,
          error: toErrorMessage(error),
          ...preservedProviderSnapshotData(snapshot.get(provider)),
        });
        if (emitted) {
          this.logger.warn({ err: error, provider, cwd }, "Failed to check provider availability");
        }
        return;
      }
      if (!available) {
        await setEntry({
          ...base,
          status: "unavailable",
          statusReason: "command_unavailable",
          enabled: true,
          ...preservedProviderSnapshotData(snapshot.get(provider)),
        });
        return;
      }

      try {
        const [models, modes] = await withTimeout(
          Promise.all([
            definition.fetchModels({ cwd, force }),
            definition.fetchModes({ cwd, force }),
          ]),
          this.refreshTimeoutMs,
          `Timed out refreshing ${definition.label} after ${this.refreshTimeoutMs}ms`,
        );

        await setEntry({
          ...base,
          status: "ready",
          statusReason: undefined,
          enabled: true,
          models,
          modes,
          fetchedAt: new Date().toISOString(),
        });
        // Fire-and-forget codex version probes once the snapshot is warm so the
        // first createSession does not block on `codex --version`.
        this.warmCodexVersionGates(provider);
      } catch (error) {
        const message = toErrorMessage(error);
        const emitted = await setEntry({
          ...base,
          status: "error",
          statusReason: message.startsWith("Timed out refreshing")
            ? "refresh_failed"
            : "model_discovery_failed",
          enabled: true,
          error: message,
          ...preservedProviderSnapshotData(snapshot.get(provider)),
        });
        if (emitted) {
          this.logger.warn({ err: error, provider, cwd }, "Failed to refresh provider models");
        }
      }
    } catch (error) {
      const emitted = await setEntry({
        ...base,
        status: "error",
        statusReason: "model_discovery_failed",
        enabled: true,
        error: toErrorMessage(error),
      });
      if (emitted) {
        this.logger.warn({ err: error, provider, cwd }, "Failed to refresh provider snapshot");
      }
    }
  }

  private async buildProviderDiagnosticDetails(
    provider: AgentProvider,
    definition: ProviderDefinition,
    client: AgentClient,
  ): Promise<ProviderDiagnosticDetails> {
    const baseProvider = definition.derivedFromProviderId ?? provider;
    const toolingDefinition = getProviderToolingDefinition(baseProvider);
    const effectiveCommand = await resolveDiagnosticCommand(
      definition.runtimeSettings,
      toolingDefinition?.binary ?? null,
    );
    const tooling = await getProviderToolingInfo(baseProvider).catch((error) => {
      this.logger.warn({ err: error, provider }, "Failed to resolve provider diagnostic tooling");
      return null;
    });

    return {
      provider,
      ...(effectiveCommand ? { effectiveCommand } : {}),
      cwd: resolveSnapshotCwd(),
      env: collectProviderEnvPresence(baseProvider, definition.runtimeSettings),
      mcpInjection: resolveMcpInjectionDiagnostic(client, this.mcpInjectionState),
      ...(tooling
        ? {
            tooling: {
              installedVersion: tooling.installedVersion,
              latestVersion: tooling.latestVersion,
              versionStatus: tooling.versionStatus,
              packageName: tooling.packageName,
              installAvailable: tooling.installAvailable,
              updateAvailable: tooling.updateAvailable,
              checkedAt: tooling.checkedAt,
            },
          }
        : {}),
    };
  }

  private async resolveToolingMetadata(
    provider: AgentProvider,
  ): Promise<Partial<ProviderSnapshotEntry>> {
    try {
      return (await getProviderToolingInfo(provider)) ?? {};
    } catch (error) {
      this.logger.warn({ err: error, provider }, "Failed to resolve provider tooling metadata");
      return {};
    }
  }

  private getProviderLoad(cwdKey: string, provider: AgentProvider): ProviderLoad | undefined {
    return this.providerLoads.get(cwdKey)?.get(provider);
  }

  private setProviderLoad(cwdKey: string, provider: AgentProvider, load: ProviderLoad): void {
    let providerLoads = this.providerLoads.get(cwdKey);
    if (!providerLoads) {
      providerLoads = new Map<AgentProvider, ProviderLoad>();
      this.providerLoads.set(cwdKey, providerLoads);
    }
    providerLoads.set(provider, load);
  }

  private isCurrentProviderLoad(
    cwdKey: string,
    provider: AgentProvider,
    load: ProviderLoad,
  ): boolean {
    return this.providerLoads.get(cwdKey)?.get(provider) === load;
  }

  private emitChange(cwdKey: string): void {
    if (this.destroyed) {
      return;
    }
    const snapshot = this.snapshots.get(cwdKey);
    if (!snapshot) {
      return;
    }
    const entries = entriesToArray(snapshot);
    for (const listener of this.events.listeners("change")) {
      try {
        listener(entries, cwdKey);
      } catch (error) {
        this.logger.warn({ err: error, cwd: cwdKey }, "Provider snapshot change listener failed");
      }
    }
  }

  private getOrCreateSnapshot(cwdKey: string): Map<AgentProvider, ProviderSnapshotEntry> {
    const existing = this.snapshots.get(cwdKey);
    if (existing) {
      return existing;
    }

    const created = this.createLoadingEntries();
    this.snapshots.set(cwdKey, created);
    return created;
  }

  private resetSnapshotToLoading(
    cwdKey: string,
    providers?: AgentProvider[],
    options: { preserveExisting?: boolean } = {},
  ): Map<AgentProvider, ProviderSnapshotEntry> {
    const snapshot = this.getOrCreateSnapshot(cwdKey);
    const loadingEntries = this.createLoadingEntries();
    const preserveExisting = options.preserveExisting ?? true;

    if (!providers) {
      snapshot.clear();
      for (const [provider, entry] of loadingEntries) {
        snapshot.set(provider, entry);
      }
      return snapshot;
    }

    for (const provider of providers) {
      const loadingEntry = loadingEntries.get(provider);
      if (!loadingEntry) continue;
      const existing = snapshot.get(provider);
      snapshot.set(provider, {
        ...loadingEntry,
        ...(preserveExisting
          ? {
              models: existing?.models,
              modes: existing?.modes,
              fetchedAt: existing?.fetchedAt,
            }
          : {}),
      });
    }
    return snapshot;
  }

  private getProviderIds(): AgentProvider[] {
    return Object.keys(this.providerRegistry);
  }

  private resolveRefreshProviders(providers?: AgentProvider[]): AgentProvider[] | undefined {
    if (!providers || providers.length === 0) {
      return undefined;
    }

    const providerIds = new Set(this.getProviderIds());
    return Array.from(new Set(providers)).filter((provider) => providerIds.has(provider));
  }

  /**
   * Resolves the providers a full refresh (no explicit provider list) should
   * re-probe, skipping providers that are ready with a fresh snapshot.
   * Re-probing them on every full refresh is the availability probe storm this
   * guard prevents. Targeted refreshes always force — the caller asked for
   * those specific providers.
   */
  private resolveFullRefreshProviders(cwdKey: string): AgentProvider[] {
    const snapshot = this.snapshots.get(cwdKey);
    return this.getProviderIds().filter((provider) => !isReadyAndFresh(snapshot?.get(provider)));
  }
}

function preservedProviderSnapshotData(
  current: ProviderSnapshotEntry | undefined,
): Partial<ProviderSnapshotEntry> {
  if (!current) {
    return {};
  }
  return {
    ...(current.models ? { models: current.models } : {}),
    ...(current.modes ? { modes: current.modes } : {}),
    ...(current.fetchedAt ? { fetchedAt: current.fetchedAt } : {}),
  };
}

function isReadyAndFresh(entry: ProviderSnapshotEntry | undefined): boolean {
  if (!entry || entry.status !== "ready" || !entry.fetchedAt) {
    return false;
  }
  const fetchedAt = Date.parse(entry.fetchedAt);
  return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < PROVIDER_READY_FRESH_MS;
}

export function resolveSnapshotCwd(cwd?: string | null): string {
  const trimmed = cwd?.trim();
  if (!trimmed) {
    return homedir();
  }
  const expanded =
    trimmed === "~" || trimmed.startsWith("~/") ? `${homedir()}${trimmed.slice(1)}` : trimmed;
  return resolve(expanded);
}

async function resolveDiagnosticCommand(
  runtimeSettings: ProviderRuntimeSettings | undefined,
  defaultBinary: string | null,
): Promise<ProviderDiagnosticDetails["effectiveCommand"] | undefined> {
  if (!defaultBinary && runtimeSettings?.command?.mode !== "replace") {
    return undefined;
  }
  const launch = await resolveProviderLaunch({
    commandConfig: runtimeSettings?.command,
    ...(defaultBinary ? { defaultBinary } : {}),
  });
  const availability = await checkProviderLaunchAvailable(launch);
  return {
    argv: [launch.command, ...launch.args],
    source: launch.source,
    resolvedPath: availability.resolvedPath,
    available: availability.available,
  };
}

const PROVIDER_ENV_KEYS: Record<string, string[]> = {
  claude: [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
  ],
  codex: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_WIRE_API"],
  opencode: ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
  pi: ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
  kimi: ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
  grokbuild: [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "XAI_API_KEY",
    "GROK_HOME",
    "GROK_MODELS_BASE_URL",
    "GROK_DEFAULT_SELECTED_PERMISSION",
  ],
  dsh: ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DSH_HOME", "DSH_PERMISSION_MODE"],
};

function collectProviderEnvPresence(
  baseProvider: AgentProvider,
  runtimeSettings: ProviderRuntimeSettings | undefined,
): ProviderDiagnosticDetails["env"] {
  const providerConfigKeys = Object.keys(runtimeSettings?.env ?? {});
  const keys = Array.from(
    new Set([...(PROVIDER_ENV_KEYS[baseProvider] ?? []), ...providerConfigKeys]),
  );
  return keys.map((name) => {
    const configuredValue = runtimeSettings?.env?.[name];
    if (configuredValue !== undefined) {
      return {
        name,
        present: configuredValue.trim().length > 0,
        source: "provider-config" as const,
      };
    }
    const processValue = process.env[name];
    return {
      name,
      present: typeof processValue === "string" && processValue.trim().length > 0,
      source: "process" as const,
    };
  });
}

function resolveMcpInjectionDiagnostic(
  client: AgentClient,
  state: { enabled: boolean; baseUrl: string | null },
): ProviderDiagnosticDetails["mcpInjection"] {
  if (!client.capabilities.supportsMcpServers) {
    return {
      supported: false,
      enabled: false,
      reason: "provider does not support MCP servers",
    };
  }
  if (!state.baseUrl) {
    return {
      supported: true,
      enabled: false,
      reason: "daemon MCP endpoint is unavailable",
    };
  }
  if (!state.enabled) {
    return {
      supported: true,
      enabled: false,
      reason: "daemon MCP injection is disabled",
    };
  }
  return {
    supported: true,
    enabled: true,
    reason: "provider supports MCP servers and daemon injection is enabled",
  };
}

function formatProviderDiagnosticReport(input: {
  providerLabel: string;
  details: ProviderDiagnosticDetails;
  providerDiagnostic: string;
}): string {
  const { providerLabel, details, providerDiagnostic } = input;
  const rows: string[] = [`Provider: ${providerLabel}`, `CWD: ${details.cwd}`];
  if (details.effectiveCommand) {
    rows.push(`Effective argv: ${formatArgv(details.effectiveCommand.argv)}`);
    rows.push(`Resolved command: ${details.effectiveCommand.resolvedPath ?? "not found"}`);
    rows.push(`Command source: ${details.effectiveCommand.source}`);
  } else {
    rows.push("Effective argv: unknown");
    rows.push("Resolved command: not checked");
  }
  rows.push(
    `MCP injection: ${details.mcpInjection.enabled ? "enabled" : "disabled"} (${details.mcpInjection.reason})`,
  );
  rows.push(`Env presence: ${formatEnvPresence(details.env)}`);
  if (details.tooling) {
    rows.push(`Package: ${details.tooling.packageName ?? "unknown"}`);
    rows.push(`Installed version: ${details.tooling.installedVersion ?? "not installed"}`);
    rows.push(`Latest version: ${details.tooling.latestVersion ?? "unknown"}`);
    rows.push(`Version status: ${details.tooling.versionStatus ?? "unknown"}`);
  }
  const providerSection = providerDiagnostic.trim();
  if (providerSection.length > 0) {
    rows.push("", "Provider-specific diagnostic:", providerSection);
  }
  return rows.join("\n");
}

function formatArgv(argv: string[]): string {
  return argv.map((part) => (part.includes(" ") ? JSON.stringify(part) : part)).join(" ");
}

function formatEnvPresence(env: ProviderDiagnosticDetails["env"]): string {
  if (env.length === 0) {
    return "none configured or detected";
  }
  return env.map((entry) => `${entry.name}=${entry.present ? "present" : "missing"}`).join(", ");
}

function entriesToArray(
  entries: Map<AgentProvider, ProviderSnapshotEntry>,
): ProviderSnapshotEntry[] {
  return Array.from(entries.values(), cloneEntry);
}

function cloneEntry(entry: ProviderSnapshotEntry): ProviderSnapshotEntry {
  return {
    ...entry,
    models: entry.models?.map((model) => ({ ...model })),
    modes: entry.modes?.map((mode) => ({ ...mode })),
  };
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error) {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }
  return "Unknown error";
}
