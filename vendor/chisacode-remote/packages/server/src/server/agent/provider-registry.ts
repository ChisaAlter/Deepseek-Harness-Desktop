import type { Logger } from "pino";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
  AgentClient,
  AgentCreateConfigUnattendedInput,
  AgentMode,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentProvider,
  AgentRuntimeInfo,
  AgentSession,
  AgentStreamEvent,
  ListModelsOptions,
  ListModesOptions,
  ListPersistedAgentsOptions,
  PersistedAgentDescriptor,
  ResolveAgentCreateConfigInput,
  ResolveAgentCreateConfigResult,
} from "./agent-sdk-types.js";
import {
  isDefaultAgentCreateConfigUnattended,
  resolveDefaultAgentCreateConfig,
} from "./create-agent-mode.js";
import { normalizeAgentModelDefinition } from "./agent-sdk-types.js";
import type { WorkspaceGitService } from "../workspace-git-service.js";
import type {
  AgentProviderRuntimeSettingsMap,
  ModelGatewayConfig,
  ModelGatewayConfigs,
  ProviderOverride,
  ProviderProfileModel,
  ProviderRuntimeSettings,
} from "./provider-launch-config.js";
import { ClaudeAgentClient } from "./providers/claude/agent.js";
import { CodexAppServerAgentClient } from "./providers/codex-app-server-agent.js";
import { KimiCodeAgentClient } from "./providers/kimi-code-agent.js";
import { GrokBuildAgentClient } from "./providers/grok-build-agent.js";
import { DshAgentClient } from "./providers/dsh-agent.js";
import { OpenCodeAgentClient } from "./providers/opencode-agent.js";
import { PiRpcAgentClient } from "./providers/pi/agent.js";
import { GenericACPAgentClient } from "./providers/generic-acp-agent.js";
import { createSSHSpawner } from "../ssh-transport.js";
import { MockLoadTestAgentClient } from "./providers/mock-load-test-agent.js";
import { MockSlowProviderClient } from "./providers/mock-slow-provider.js";
import {
  AGENT_PROVIDER_DEFINITIONS,
  DEV_AGENT_PROVIDER_DEFINITIONS,
  getAgentProviderDefinition,
  type AgentProviderDefinition,
} from "@chisacode/protocol/provider-manifest";

export type { AgentProviderDefinition };

export { AGENT_PROVIDER_DEFINITIONS, getAgentProviderDefinition };

export interface ProviderDefinition extends AgentProviderDefinition {
  enabled: boolean;
  runtimeSettings?: ProviderRuntimeSettings;
  /**
   * The id of another *registered* provider this one extends (e.g. a Z.AI
   * profile that extends "claude"). null for built-in providers and for
   * generic ACP providers (which only extend the literal "acp" sentinel).
   */
  derivedFromProviderId: string | null;
  modelGatewayId: string | null;
  createClient: (logger: Logger) => AgentClient;
  resolveCreateConfig: (input: ResolveAgentCreateConfigInput) => ResolveAgentCreateConfigResult;
  isCreateConfigUnattended: (input: AgentCreateConfigUnattendedInput) => boolean;
  fetchModels: (options: ListModelsOptions) => Promise<AgentModelDefinition[]>;
  fetchModes: (options: ListModesOptions) => Promise<AgentMode[]>;
}

export { IMPORTABLE_PROVIDERS } from "@chisacode/protocol/importable-providers";

export interface BuildProviderRegistryOptions {
  runtimeSettings?: AgentProviderRuntimeSettingsMap;
  providerOverrides?: Record<string, ProviderOverride>;
  modelGateways?: ModelGatewayConfigs;
  modelGatewayBaseUrl?: string;
  modelGatewayToken?: string;
  workspaceGitService?: Pick<WorkspaceGitService, "resolveRepoRoot">;
  isDev?: boolean;
  /**
   * Register development-only providers (e.g. mock load-test) in non-dev
   * daemons. Used by packaged/e2e environments that need the synthetic
   * streaming provider for deterministic UI gates; production daemons do not
   * set this.
   */
  enableDevProviders?: boolean;
}

interface ProviderClientFactoryOptions extends Pick<
  BuildProviderRegistryOptions,
  "workspaceGitService"
> {
  profileModels?: ProviderProfileModel[];
  additionalModels?: ProviderProfileModel[];
  customProvider?: {
    id: string;
    label: string;
    extends: string;
  };
}

type ProviderClientFactory = (
  logger: Logger,
  runtimeSettings?: ProviderRuntimeSettings,
  options?: ProviderClientFactoryOptions,
) => AgentClient;

interface ResolvedProvider {
  definition: AgentProviderDefinition;
  runtimeSettings?: ProviderRuntimeSettings;
  profileModels: ProviderProfileModel[];
  additionalModels: ProviderProfileModel[];
  profileModelsAreAdditive: boolean;
  enabled: boolean;
  derivedFromProviderId: string | null;
  modelGatewayId: string | null;
  createBaseClient: (logger: Logger) => AgentClient;
}

const PROVIDER_CLIENT_FACTORIES: Record<string, ProviderClientFactory> = {
  claude: (logger, runtimeSettings) =>
    new ClaudeAgentClient({
      logger,
      runtimeSettings,
    }),
  codex: (logger, runtimeSettings, options) =>
    new CodexAppServerAgentClient(logger, runtimeSettings, {
      workspaceGitService: options?.workspaceGitService,
      customProvider: options?.customProvider,
    }),
  opencode: (logger, runtimeSettings) => new OpenCodeAgentClient(logger, runtimeSettings),
  pi: (logger, runtimeSettings) =>
    new PiRpcAgentClient({
      logger,
      runtimeSettings,
    }),
  kimi: (logger, runtimeSettings, options) =>
    new KimiCodeAgentClient({
      logger,
      runtimeSettings,
      providerId: options?.customProvider?.id ?? "kimi",
      label: options?.customProvider?.label ?? "Kimi Code",
      models: [...(options?.profileModels ?? []), ...(options?.additionalModels ?? [])],
    }),
  grokbuild: (logger, runtimeSettings, options) =>
    new GrokBuildAgentClient({
      logger,
      runtimeSettings,
      providerId: options?.customProvider?.id,
      label: options?.customProvider?.label,
      models: [...(options?.profileModels ?? []), ...(options?.additionalModels ?? [])],
    }),
  dsh: (logger, runtimeSettings, options) =>
    new DshAgentClient({
      logger,
      runtimeSettings,
      providerId: options?.customProvider?.id ?? "dsh",
      label: options?.customProvider?.label ?? "DeepSeek Harness",
      models: [...(options?.profileModels ?? []), ...(options?.additionalModels ?? [])],
    }),
  mock: (logger) => new MockLoadTestAgentClient(logger),
  "mock-slow": () => new MockSlowProviderClient(),
};

function getProviderClientFactory(provider: string): ProviderClientFactory {
  const factory = PROVIDER_CLIENT_FACTORIES[provider];
  if (!factory) {
    throw new Error(`No provider client factory registered for '${provider}'`);
  }
  return factory;
}

function toRuntimeSettings(override?: ProviderOverride): ProviderRuntimeSettings | undefined {
  if (!override?.command && !override?.env && !override?.disallowedTools) {
    return undefined;
  }

  // ProviderOverride.command is a full argv replacement. Gateway faces that need
  // extra CLI flags without replacing the binary use runtimeSettings.command.append
  // via mergeRuntimeSettings / custom factories instead.
  return {
    command: override.command
      ? {
          mode: "replace",
          argv: override.command,
        }
      : undefined,
    env: override.env,
    disallowedTools: override.disallowedTools,
  };
}

function mergeRuntimeSettings(
  base: ProviderRuntimeSettings | undefined,
  override: ProviderRuntimeSettings | undefined,
): ProviderRuntimeSettings | undefined {
  if (!base && !override) {
    return undefined;
  }

  return {
    command: override?.command ?? base?.command,
    env:
      base?.env || override?.env
        ? {
            ...base?.env,
            ...override?.env,
          }
        : undefined,
    disallowedTools:
      base?.disallowedTools || override?.disallowedTools
        ? [...(base?.disallowedTools ?? []), ...(override?.disallowedTools ?? [])]
        : undefined,
  };
}

function applyOverrideToDefinition(
  definition: AgentProviderDefinition,
  override?: ProviderOverride,
): AgentProviderDefinition {
  if (!override) {
    return definition;
  }

  return {
    ...definition,
    label: override.label ?? definition.label,
    description: override.description ?? definition.description,
  };
}

function mapPersistenceHandle(
  provider: AgentProvider,
  handle: AgentPersistenceHandle | null,
): AgentPersistenceHandle | null {
  if (!handle) {
    return null;
  }

  return {
    ...handle,
    provider,
  };
}

function mapRuntimeInfo(provider: AgentProvider, runtimeInfo: AgentRuntimeInfo): AgentRuntimeInfo {
  return {
    ...runtimeInfo,
    provider,
  };
}

function mapStreamEvent(provider: AgentProvider, event: AgentStreamEvent): AgentStreamEvent {
  return {
    ...event,
    provider,
  };
}

function mapPersistedAgentDescriptor(
  provider: AgentProvider,
  descriptor: PersistedAgentDescriptor,
): PersistedAgentDescriptor {
  return {
    ...descriptor,
    provider,
    persistence: {
      ...descriptor.persistence,
      provider,
    },
  };
}

function mapModel(
  provider: AgentProvider,
  model: AgentModelDefinition | ProviderProfileModel,
): AgentModelDefinition {
  return normalizeAgentModelDefinition({ ...model, provider });
}

function mergeModels(
  provider: AgentProvider,
  profileModels: ProviderProfileModel[],
  additionalModels: ProviderProfileModel[],
  runtimeModels: AgentModelDefinition[],
  options?: { profileModelsAreAdditive?: boolean },
): AgentModelDefinition[] {
  const baseModels = runtimeModels.map((model) => mapModel(provider, model));
  if (profileModels.length > 0 && options?.profileModelsAreAdditive !== true) {
    return mergeModelAdditions(
      provider,
      profileModels.map((model) => mapModel(provider, model)),
      additionalModels,
    );
  }

  return mergeModelAdditions(provider, baseModels, [...profileModels, ...additionalModels]);
}

function mergeModelAdditions(
  provider: AgentProvider,
  baseModels: AgentModelDefinition[],
  modelAdditions: ProviderProfileModel[],
): AgentModelDefinition[] {
  if (modelAdditions.length === 0) {
    return baseModels;
  }

  const mergedModels = [...baseModels];
  let hasAdditionalDefault = false;

  for (const model of modelAdditions) {
    const additionalModel = mapModel(provider, model);
    hasAdditionalDefault ||= additionalModel.isDefault === true;

    const existingIndex = mergedModels.findIndex((candidate) => candidate.id === model.id);
    if (existingIndex === -1) {
      mergedModels.push(additionalModel);
      continue;
    }

    mergedModels[existingIndex] = {
      ...mergedModels[existingIndex],
      ...additionalModel,
    };
  }

  if (!hasAdditionalDefault) {
    return mergedModels;
  }

  const additionalDefaultIds = new Set(
    modelAdditions.filter((model) => model.isDefault === true).map((model) => model.id),
  );

  return mergedModels.map((model) =>
    additionalDefaultIds.has(model.id) ? model : Object.assign({}, model, { isDefault: false }),
  );
}

function shouldUseProfileModelsOnly(
  profileModels: ProviderProfileModel[],
  profileModelsAreAdditive: boolean,
): boolean {
  return profileModels.length > 0 && profileModelsAreAdditive !== true;
}

export function wrapSessionProvider(provider: AgentProvider, inner: AgentSession): AgentSession {
  return {
    provider,
    id: inner.id,
    capabilities: inner.capabilities,
    get features() {
      return inner.features;
    },
    run: (prompt, options) => inner.run(prompt, options),
    startTurn: (prompt, options) => inner.startTurn(prompt, options),
    subscribe: (callback) => inner.subscribe((event) => callback(mapStreamEvent(provider, event))),
    async *streamHistory() {
      for await (const event of inner.streamHistory()) {
        yield mapStreamEvent(provider, event);
      }
    },
    getRuntimeInfo: async () => mapRuntimeInfo(provider, await inner.getRuntimeInfo()),
    getAvailableModes: () => inner.getAvailableModes(),
    getCurrentMode: () => inner.getCurrentMode(),
    setMode: (modeId) => inner.setMode(modeId),
    getPendingPermissions: () => inner.getPendingPermissions(),
    respondToPermission: (requestId, response) => inner.respondToPermission(requestId, response),
    describePersistence: () => mapPersistenceHandle(provider, inner.describePersistence()),
    interrupt: () => inner.interrupt(),
    close: () => inner.close(),
    listCommands: inner.listCommands?.bind(inner),
    setModel: inner.setModel?.bind(inner),
    setThinkingOption: inner.setThinkingOption?.bind(inner),
    setFeature: inner.setFeature?.bind(inner),
    revertConversation: inner.revertConversation?.bind(inner),
    revertFiles: inner.revertFiles?.bind(inner),
    revertBoth: inner.revertBoth?.bind(inner),
    tryHandleOutOfBand: inner.tryHandleOutOfBand?.bind(inner),
  };
}

function wrapClientProvider(
  provider: AgentProvider,
  inner: AgentClient,
  profileModels: ProviderProfileModel[],
  additionalModels: ProviderProfileModel[],
  profileModelsAreAdditive: boolean,
): AgentClient {
  const listPersistedAgents = inner.listPersistedAgents?.bind(inner);

  return {
    provider,
    capabilities: inner.capabilities,
    createSession: async (config, launchContext) =>
      wrapSessionProvider(
        provider,
        await inner.createSession(
          {
            ...config,
            provider: inner.provider,
          },
          launchContext,
        ),
      ),
    resumeSession: async (handle, overrides, launchContext) =>
      wrapSessionProvider(
        provider,
        await inner.resumeSession(
          {
            ...handle,
            provider: inner.provider,
          },
          overrides
            ? {
                ...overrides,
                provider: inner.provider,
              }
            : undefined,
          launchContext,
        ),
      ),
    listModels: async (options) => {
      if (shouldUseProfileModelsOnly(profileModels, profileModelsAreAdditive)) {
        return mergeModels(provider, profileModels, additionalModels, [], {
          profileModelsAreAdditive,
        });
      }
      return mergeModels(
        provider,
        profileModels,
        additionalModels,
        await inner.listModels(options),
        {
          profileModelsAreAdditive,
        },
      );
    },
    listModes: inner.listModes?.bind(inner),
    resolveCreateConfig: inner.resolveCreateConfig?.bind(inner),
    isCreateConfigUnattended: inner.isCreateConfigUnattended?.bind(inner),
    listPersistedAgents: listPersistedAgents
      ? async (options?: ListPersistedAgentsOptions) =>
          (await listPersistedAgents(options)).map((descriptor) =>
            mapPersistedAgentDescriptor(provider, descriptor),
          )
      : undefined,
    isAvailable: () => inner.isAvailable(),
    getDiagnostic: inner.getDiagnostic?.bind(inner),
  };
}

function createRegistryEntry(
  logger: Logger,
  provider: AgentProvider,
  resolved: ResolvedProvider,
): ProviderDefinition {
  // kimi/dsh construct lazily: building their client does sync disk/vendor work
  // (managed config materialization, npm-root resolution) that must not sit on
  // the daemon's cold-start path, and neither can serve metadata faster than
  // their profile/gateway model configuration already does. The check uses the
  // derived root, so gateway faces (`<gateway>-dsh`) inherit the same law.
  const lazilyConstructedRoot = resolved.derivedFromProviderId ?? resolved.definition.id;
  const shouldCreateMetadataClientEagerly =
    lazilyConstructedRoot !== "kimi" && lazilyConstructedRoot !== "dsh";
  const modelClient = shouldCreateMetadataClientEagerly ? resolved.createBaseClient(logger) : null;
  const getModelClient = () => modelClient ?? resolved.createBaseClient(logger);

  return {
    ...resolved.definition,
    enabled: resolved.enabled,
    runtimeSettings: resolved.runtimeSettings,
    derivedFromProviderId: resolved.derivedFromProviderId,
    modelGatewayId: resolved.modelGatewayId,
    createClient: (providerLogger: Logger) =>
      createResolvedProviderClient(providerLogger, provider, resolved),
    resolveCreateConfig: modelClient?.resolveCreateConfig ?? resolveDefaultAgentCreateConfig,
    isCreateConfigUnattended:
      modelClient?.isCreateConfigUnattended ?? isDefaultAgentCreateConfigUnattended,
    fetchModels: async (options: ListModelsOptions) => {
      if (shouldUseProfileModelsOnly(resolved.profileModels, resolved.profileModelsAreAdditive)) {
        return mergeModels(provider, resolved.profileModels, resolved.additionalModels, [], {
          profileModelsAreAdditive: resolved.profileModelsAreAdditive,
        });
      }
      return mergeModels(
        provider,
        resolved.profileModels,
        resolved.additionalModels,
        await getModelClient().listModels(options),
        {
          profileModelsAreAdditive: resolved.profileModelsAreAdditive,
        },
      );
    },
    fetchModes: async (options: ListModesOptions) => {
      if (shouldUseProfileModelsOnly(resolved.profileModels, resolved.profileModelsAreAdditive)) {
        return resolved.definition.modes;
      }
      const client = getModelClient();
      const modes = client.listModes ? await client.listModes(options) : resolved.definition.modes;
      return modes.map((mode) => {
        if (mode.icon && mode.colorTier) return mode;
        const definitionMode = resolved.definition.modes.find((d) => d.id === mode.id);
        if (!definitionMode) return mode;
        return Object.assign({}, mode, {
          icon: mode.icon ?? definitionMode.icon,
          colorTier: mode.colorTier ?? definitionMode.colorTier,
        });
      });
    },
  };
}

function createResolvedProviderClient(
  logger: Logger,
  provider: AgentProvider,
  resolved: ResolvedProvider,
): AgentClient {
  const inner = resolved.createBaseClient(logger);
  const hasModelOverrides =
    resolved.profileModels.length > 0 || resolved.additionalModels.length > 0;
  if (inner.provider === provider && !hasModelOverrides) {
    return inner;
  }
  return wrapClientProvider(
    provider,
    inner,
    resolved.profileModels,
    resolved.additionalModels,
    resolved.profileModelsAreAdditive,
  );
}

function buildResolvedBuiltinProviders(
  providerOverrides: Record<string, ProviderOverride>,
  runtimeSettings: AgentProviderRuntimeSettingsMap | undefined,
  options: Pick<BuildProviderRegistryOptions, "workspaceGitService">,
  isDev: boolean,
  enableDevProviders: boolean,
): Map<string, ResolvedProvider> {
  const resolvedProviders = new Map<string, ResolvedProvider>();

  const definitions =
    isDev || enableDevProviders
      ? [...AGENT_PROVIDER_DEFINITIONS, ...DEV_AGENT_PROVIDER_DEFINITIONS]
      : AGENT_PROVIDER_DEFINITIONS;

  for (const definition of definitions) {
    const override = providerOverrides[definition.id];
    const factory = getProviderClientFactory(definition.id);
    const profileModels = override?.models ?? [];
    const additionalModels = override?.additionalModels ?? [];
    const mergedRuntimeSettings = mergeRuntimeSettings(
      runtimeSettings?.[definition.id],
      toRuntimeSettings(override),
    );

    resolvedProviders.set(definition.id, {
      definition: applyOverrideToDefinition(definition, override),
      runtimeSettings: mergedRuntimeSettings,
      profileModels,
      additionalModels,
      profileModelsAreAdditive: definition.id === "claude",
      enabled: override?.enabled !== false,
      derivedFromProviderId: null,
      modelGatewayId: null,
      createBaseClient: (logger) =>
        factory(logger, mergedRuntimeSettings, {
          workspaceGitService: options.workspaceGitService,
          profileModels,
          additionalModels,
        }),
    });
  }

  return resolvedProviders;
}

function requireCustomProviderLabel(providerId: string, override: ProviderOverride): string {
  const label = override.label?.trim();
  if (!label) {
    throw new Error(`Custom provider '${providerId}' requires a label`);
  }
  return label;
}

function requireCustomProviderExtends(providerId: string, override: ProviderOverride): string {
  const extendsProvider = override.extends?.trim();
  if (!extendsProvider) {
    throw new Error(`Custom provider '${providerId}' requires extends`);
  }
  return extendsProvider;
}

function requireAcpCommand(providerId: string, override: ProviderOverride): [string, ...string[]] {
  const command = override.command;
  if (!command || command.length === 0) {
    throw new Error(`ACP provider '${providerId}' requires a command`);
  }
  return command as [string, ...string[]];
}

function buildCustomAcpDefinition(
  providerId: string,
  override: ProviderOverride,
  label: string,
): AgentProviderDefinition {
  return {
    id: providerId,
    label,
    description: override.description ?? "Custom ACP agent provider",
    defaultModeId: null,
    modes: [],
  };
}

function buildDerivedProviderDefinition(
  providerId: string,
  baseDefinition: AgentProviderDefinition,
  override: ProviderOverride,
  label: string,
): AgentProviderDefinition {
  return {
    ...baseDefinition,
    id: providerId,
    label,
    description: override.description ?? baseDefinition.description,
  };
}

function addResolvedCustomProviders(
  resolvedProviders: Map<string, ResolvedProvider>,
  providerOverrides: Record<string, ProviderOverride>,
  runtimeSettings: AgentProviderRuntimeSettingsMap | undefined,
  options: Pick<BuildProviderRegistryOptions, "workspaceGitService"> & {
    modelGatewayIds?: Map<string, string>;
  },
): void {
  for (const [providerId, override] of Object.entries(providerOverrides)) {
    if (resolvedProviders.has(providerId) || !override.extends) {
      continue;
    }

    const label = requireCustomProviderLabel(providerId, override);
    const extendsProvider = requireCustomProviderExtends(providerId, override);
    const profileModels = override.models ?? [];
    const additionalModels = override.additionalModels ?? [];
    const overrideRuntimeSettings = mergeRuntimeSettings(
      runtimeSettings?.[providerId],
      toRuntimeSettings(override),
    );

    if (extendsProvider === "acp") {
      const command = requireAcpCommand(providerId, override);
      const sshSpawner = override.ssh ? createSSHSpawner(override.ssh) : undefined;
      resolvedProviders.set(providerId, {
        definition: buildCustomAcpDefinition(providerId, override, label),
        runtimeSettings: overrideRuntimeSettings,
        profileModels,
        additionalModels,
        profileModelsAreAdditive: false,
        enabled: override.enabled !== false,
        derivedFromProviderId: null,
        modelGatewayId: options.modelGatewayIds?.get(providerId) ?? null,
        createBaseClient: (logger) =>
          new GenericACPAgentClient({
            logger,
            command,
            env: overrideRuntimeSettings?.env,
            providerId,
            label,
            spawn: sshSpawner,
          }),
      });
      continue;
    }

    const baseResolved = resolvedProviders.get(extendsProvider);
    if (!baseResolved) {
      throw new Error(`Provider '${providerId}' extends unknown provider '${extendsProvider}'`);
    }
    const factory = getProviderClientFactory(extendsProvider);
    const mergedRuntimeSettings = mergeRuntimeSettings(
      baseResolved.runtimeSettings,
      overrideRuntimeSettings,
    );

    resolvedProviders.set(providerId, {
      definition: buildDerivedProviderDefinition(
        providerId,
        baseResolved.definition,
        override,
        label,
      ),
      runtimeSettings: mergedRuntimeSettings,
      profileModels,
      additionalModels,
      profileModelsAreAdditive: false,
      enabled: override.enabled !== false,
      derivedFromProviderId: extendsProvider,
      modelGatewayId: options.modelGatewayIds?.get(providerId) ?? null,
      createBaseClient: (logger) =>
        factory(logger, mergedRuntimeSettings, {
          workspaceGitService: options.workspaceGitService,
          customProvider: {
            id: providerId,
            label,
            extends: extendsProvider,
          },
          profileModels,
          additionalModels,
        }),
    });
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function buildGatewayRouteBase(baseUrl: string, gatewayId: string): string {
  return `${trimTrailingSlash(baseUrl)}/api/model-gateways/${encodeURIComponent(gatewayId)}`;
}

function buildClaudeGatewayConfigDir(gatewayId: string): string {
  return join(homedir(), ".chisacode", "claude-model-gateways", gatewayId);
}

/**
 * Writes a managed OpenCode config that registers gateway models under the openai provider.
 * OpenCode does not fully discover arbitrary models from OPENAI_BASE_URL alone; it needs an
 * explicit provider.models entry.
 * @param gatewayId Gateway id used for the managed config directory
 * @param baseUrl Gateway base URL (without `/v1`)
 * @param token Gateway auth token written into the managed config
 * @param models Gateway models to expose as `openai/<id>`
 * @returns Absolute path to the written managed config file
 */
function writeOpenCodeCompatibleGatewayConfig(params: {
  gatewayId: string;
  baseUrl: string;
  token: string;
  models: ProviderProfileModel[];
}): string {
  const dir = join(homedir(), ".chisacode", "opencode-model-gateways", params.gatewayId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const configPath = join(dir, "opencode.json");
  const models: Record<string, { name: string }> = {};
  for (const model of params.models) {
    const bareId = model.id.includes("/") ? model.id.slice(model.id.indexOf("/") + 1) : model.id;
    if (!bareId || models[bareId]) {
      continue;
    }
    models[bareId] = { name: model.label || bareId };
  }
  if (Object.keys(models).length === 0) {
    models["default"] = { name: "default" };
  }
  // Use @ai-sdk/openai (chat completions). openai-compatible currently tries
  // Responses API helpers that our gateway does not expose as a raw SDK surface.
  const payload = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      openai: {
        npm: "@ai-sdk/openai",
        name: "ChisaCode Model Gateway",
        options: {
          baseURL: `${trimTrailingSlash(params.baseUrl)}/v1`,
          apiKey: params.token,
        },
        models,
      },
    },
  };
  writeFileSync(configPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return configPath;
}

function buildGatewayProviderModels(
  models: ProviderProfileModel[],
  options?: { modelPrefix?: string; supportsTools?: boolean },
): ProviderProfileModel[] {
  return models.map((model, index) => ({
    ...model,
    id:
      options?.modelPrefix && !model.id.startsWith(`${options.modelPrefix}/`)
        ? `${options.modelPrefix}/${model.id}`
        : model.id,
    ...(options?.supportsTools === false ? { supportsTools: false } : {}),
    ...(model.isDefault === undefined && index === 0 ? { isDefault: true } : {}),
  }));
}

function buildGatewaySyntheticModels(gateway: ModelGatewayConfig): ProviderProfileModel[] {
  return (gateway.syntheticModels ?? []).map((model) => {
    const providerModel: ProviderProfileModel = {
      id: model.id,
      label: model.label,
    };
    if (model.description) {
      providerModel.description = model.description;
    }
    return providerModel;
  });
}

function buildAllGatewayProviderModels(
  gateway: ModelGatewayConfig,
  options?: { modelPrefix?: string; models?: ProviderProfileModel[]; supportsTools?: boolean },
): ProviderProfileModel[] {
  return buildGatewayProviderModels(
    [...(options?.models ?? gateway.models ?? []), ...buildGatewaySyntheticModels(gateway)],
    options,
  );
}

type GatewayAgentFace = "claude" | "codex" | "opencode" | "pi" | "kimi" | "grokbuild" | "dsh";

type GatewayAgentFaceFlags = Record<GatewayAgentFace, boolean>;

function gatewayProviderOverride(params: {
  gateway: ModelGatewayConfig;
  extendsProvider: GatewayAgentFace;
  label: string;
  baseUrl: string;
  token: string;
  models: ProviderProfileModel[];
}): ProviderOverride {
  const { gateway, extendsProvider, baseUrl, token, models } = params;
  const routeBase = buildGatewayRouteBase(baseUrl, gateway.id);
  if (extendsProvider === "claude") {
    return {
      extends: "claude",
      label: params.label,
      env: {
        ANTHROPIC_API_KEY: token,
        ANTHROPIC_AUTH_TOKEN: token,
        ANTHROPIC_BASE_URL: routeBase,
        CLAUDE_CONFIG_DIR: buildClaudeGatewayConfigDir(gateway.id),
      },
      disallowedTools: ["WebSearch"],
      models,
      enabled: gateway.enabled !== false,
    };
  }
  if (extendsProvider === "codex") {
    return {
      extends: "codex",
      label: params.label,
      env: {
        OPENAI_API_KEY: token,
        OPENAI_BASE_URL: routeBase,
        OPENAI_WIRE_API: "responses",
      },
      models,
      enabled: gateway.enabled !== false,
    };
  }
  if (extendsProvider === "kimi") {
    return {
      extends: "kimi",
      label: params.label,
      env: {
        OPENAI_API_KEY: token,
        OPENAI_BASE_URL: `${routeBase}/v1`,
      },
      models,
      enabled: gateway.enabled !== false,
    };
  }
  if (extendsProvider === "grokbuild") {
    // Command override is applied after toRuntimeSettings via env+managed home;
    // append flags are injected in materialize by rewriting runtimeSettings below
    // is not possible here (override.command is replace-only). The Grok client
    // itself appends --always-approve when gateway env is present.
    return {
      extends: "grokbuild",
      label: params.label,
      env: {
        OPENAI_API_KEY: token,
        OPENAI_BASE_URL: `${routeBase}/v1`,
        XAI_API_KEY: token,
        GROK_MODELS_BASE_URL: `${routeBase}/v1`,
        GROK_DEFAULT_SELECTED_PERMISSION: "always_allow_all_sessions",
      },
      models,
      enabled: gateway.enabled !== false,
    };
  }
  if (extendsProvider === "dsh") {
    return {
      extends: "dsh",
      label: params.label,
      env: {
        DEEPSEEK_API_KEY: token,
        // The dsh-deepseek adapter appends `/chat/completions` to the base URL;
        // serve chat completions under `<routeBase>/v1` like the kimi face.
        DEEPSEEK_BASE_URL: `${routeBase}/v1`,
      },
      models,
      enabled: gateway.enabled !== false,
    };
  }
  if (extendsProvider === "opencode") {
    const configPath = writeOpenCodeCompatibleGatewayConfig({
      gatewayId: gateway.id,
      baseUrl: routeBase,
      token,
      models,
    });
    return {
      extends: extendsProvider,
      label: params.label,
      env: {
        OPENAI_API_KEY: token,
        OPENAI_BASE_URL: `${routeBase}/v1`,
        OPENCODE_CONFIG: configPath,
      },
      models,
      enabled: gateway.enabled !== false,
    };
  }
  return {
    extends: extendsProvider,
    label: params.label,
    env: {
      OPENAI_API_KEY: token,
      OPENAI_BASE_URL: `${routeBase}/v1`,
    },
    models,
    enabled: gateway.enabled !== false,
  };
}

/**
 * Resolves which agent faces a gateway should materialize.
 *
 * Closed-set semantics for `supplyScope` (mirrored by the app read path in
 * `custom-model-providers.ts`):
 * - `supplyScope === "all"` → all 7 faces, regardless of preset/attachToAllAgents
 * - `supplyScope === "matched"` → narrowed by protocolPreset
 *   (claude → 1, codex → 1, openai → 5, all → 7); without a preset, falls back
 *   to legacy upstream inference below
 * - `supplyScope` omitted → legacy behavior: `attachToAllAgents === true` or
 *   `protocolPreset === "all"` → all 6 faces; preset narrows; no preset infers
 *   from enabled upstreams
 * - When both `supplyScope` and `attachToAllAgents` are present, `supplyScope`
 *   wins.
 */
export function resolveGatewayAgentFaces(gateway: {
  supplyScope?: "all" | "matched";
  protocolPreset?: "claude" | "codex" | "openai" | "all";
  attachToAllAgents?: boolean;
  upstreams?: {
    anthropic?: { enabled?: boolean };
    chatCompletions?: { enabled?: boolean };
    responses?: { enabled?: boolean };
  };
}): GatewayAgentFaceFlags {
  if (gateway.supplyScope === "all") {
    return allFaces();
  }
  if (gateway.supplyScope === "matched") {
    const preset = gateway.protocolPreset;
    if (preset === "claude") {
      return singleFace("claude");
    }
    if (preset === "codex") {
      return singleFace("codex");
    }
    if (preset === "openai") {
      return openaiFamilyFaces();
    }
    if (preset === "all") {
      return allFaces();
    }
    // matched without a preset → legacy inference from enabled upstreams.
    return inferFacesFromUpstreams(gateway);
  }

  if (gateway.attachToAllAgents === true || gateway.protocolPreset === "all") {
    return allFaces();
  }

  const preset = gateway.protocolPreset;
  if (preset === "claude") {
    return singleFace("claude");
  }
  if (preset === "codex") {
    return singleFace("codex");
  }
  if (preset === "openai") {
    return openaiFamilyFaces();
  }

  return inferFacesFromUpstreams(gateway);
}

function allFaces(): GatewayAgentFaceFlags {
  return {
    claude: true,
    codex: true,
    opencode: true,
    pi: true,
    kimi: true,
    grokbuild: true,
    dsh: true,
  };
}

function noneFaces(): GatewayAgentFaceFlags {
  return {
    claude: false,
    codex: false,
    opencode: false,
    pi: false,
    kimi: false,
    grokbuild: false,
    dsh: false,
  };
}

function singleFace(face: GatewayAgentFace): GatewayAgentFaceFlags {
  return {
    ...noneFaces(),
    [face]: true,
  };
}

function openaiFamilyFaces(): GatewayAgentFaceFlags {
  return {
    claude: false,
    codex: false,
    opencode: true,
    pi: true,
    kimi: true,
    grokbuild: true,
    dsh: true,
  };
}

function inferFacesFromUpstreams(gateway: {
  upstreams?: {
    anthropic?: { enabled?: boolean };
    chatCompletions?: { enabled?: boolean };
    responses?: { enabled?: boolean };
  };
}): GatewayAgentFaceFlags {
  // If only one upstream is enabled we can still infer a narrow set for cleaner pickers.
  const anthropic = gateway.upstreams?.anthropic?.enabled === true;
  const chat = gateway.upstreams?.chatCompletions?.enabled === true;
  const responses = gateway.upstreams?.responses?.enabled === true;
  const enabledCount = Number(anthropic) + Number(chat) + Number(responses);
  if (enabledCount === 1) {
    if (anthropic) {
      return singleFace("claude");
    }
    if (responses) {
      return singleFace("codex");
    }
    if (chat) {
      return openaiFamilyFaces();
    }
  }

  return allFaces();
}

function registerGatewayFaceOverride(params: {
  gatewayOverrides: Record<string, ProviderOverride>;
  modelGatewayIds: Map<string, string>;
  gateway: ModelGatewayConfig;
  face: GatewayAgentFace;
  extendsProvider: GatewayAgentFace;
  labelSuffix: string;
  baseUrl: string;
  token: string;
  models: ProviderProfileModel[];
}): void {
  const providerId = `${params.gateway.id}-${params.face}`;
  params.gatewayOverrides[providerId] = gatewayProviderOverride({
    gateway: params.gateway,
    extendsProvider: params.extendsProvider,
    label: `${params.gateway.label} ${params.labelSuffix}`,
    baseUrl: params.baseUrl,
    token: params.token,
    models: params.models,
  });
  params.modelGatewayIds.set(providerId, params.gateway.id);
}

function materializeGatewayProviderOverrides(
  gateway: ModelGatewayConfig,
  baseUrl: string,
  token: string,
  gatewayOverrides: Record<string, ProviderOverride>,
  modelGatewayIds: Map<string, string>,
): void {
  const faces = resolveGatewayAgentFaces(gateway);
  const models = buildAllGatewayProviderModels(gateway);
  const shared = {
    gatewayOverrides,
    modelGatewayIds,
    gateway,
    baseUrl,
    token,
  };

  if (faces.claude) {
    registerGatewayFaceOverride({
      ...shared,
      face: "claude",
      extendsProvider: "claude",
      labelSuffix: "Claude",
      models,
    });
  }
  if (faces.codex) {
    registerGatewayFaceOverride({
      ...shared,
      face: "codex",
      extendsProvider: "codex",
      labelSuffix: "Codex",
      models,
    });
  }
  if (faces.opencode) {
    registerGatewayFaceOverride({
      ...shared,
      face: "opencode",
      extendsProvider: "opencode",
      labelSuffix: "OpenCode",
      models: buildAllGatewayProviderModels(gateway, {
        modelPrefix: "openai",
        models: gateway.generatedModels?.opencode,
      }),
    });
  }
  if (faces.pi) {
    registerGatewayFaceOverride({
      ...shared,
      face: "pi",
      extendsProvider: "pi",
      labelSuffix: "Pi",
      models: buildAllGatewayProviderModels(gateway, {
        modelPrefix: "openai",
        models: gateway.generatedModels?.pi,
      }),
    });
  }
  if (faces.kimi) {
    registerGatewayFaceOverride({
      ...shared,
      face: "kimi",
      extendsProvider: "kimi",
      labelSuffix: "Kimi Code",
      models: buildAllGatewayProviderModels(gateway, {
        models: gateway.generatedModels?.kimi,
      }),
    });
  }
  if (faces.grokbuild) {
    registerGatewayFaceOverride({
      ...shared,
      face: "grokbuild",
      extendsProvider: "grokbuild",
      labelSuffix: "Grok Build",
      models: buildAllGatewayProviderModels(gateway, {
        models: gateway.generatedModels?.grokbuild,
      }),
    });
  }
  if (faces.dsh) {
    registerGatewayFaceOverride({
      ...shared,
      face: "dsh",
      extendsProvider: "dsh",
      labelSuffix: "DeepSeek",
      models: buildAllGatewayProviderModels(gateway, {
        models: gateway.generatedModels?.dsh,
      }),
    });
  }
}

function addResolvedModelGatewayProviders(
  resolvedProviders: Map<string, ResolvedProvider>,
  modelGateways: ModelGatewayConfigs | undefined,
  runtimeSettings: AgentProviderRuntimeSettingsMap | undefined,
  options: Pick<
    BuildProviderRegistryOptions,
    "workspaceGitService" | "modelGatewayBaseUrl" | "modelGatewayToken"
  >,
): void {
  const baseUrl = options.modelGatewayBaseUrl?.trim();
  const token = options.modelGatewayToken?.trim();
  if (!baseUrl || !token) {
    return;
  }

  const gatewayOverrides: Record<string, ProviderOverride> = {};
  const modelGatewayIds = new Map<string, string>();
  for (const gateway of Object.values(modelGateways ?? {})) {
    materializeGatewayProviderOverrides(gateway, baseUrl, token, gatewayOverrides, modelGatewayIds);
  }

  addResolvedCustomProviders(resolvedProviders, gatewayOverrides, runtimeSettings, {
    workspaceGitService: options.workspaceGitService,
    modelGatewayIds,
  });
}

export function buildProviderRegistry(
  logger: Logger,
  options?: BuildProviderRegistryOptions,
): Record<AgentProvider, ProviderDefinition> {
  const runtimeSettings = options?.runtimeSettings;
  const providerOverrides = options?.providerOverrides ?? {};
  const resolvedProviders = buildResolvedBuiltinProviders(
    providerOverrides,
    runtimeSettings,
    {
      workspaceGitService: options?.workspaceGitService,
    },
    options?.isDev === true,
    options?.enableDevProviders === true,
  );
  addResolvedCustomProviders(resolvedProviders, providerOverrides, runtimeSettings, {
    workspaceGitService: options?.workspaceGitService,
  });
  addResolvedModelGatewayProviders(resolvedProviders, options?.modelGateways, runtimeSettings, {
    workspaceGitService: options?.workspaceGitService,
    modelGatewayBaseUrl: options?.modelGatewayBaseUrl,
    modelGatewayToken: options?.modelGatewayToken,
  });
  return Object.fromEntries(
    [...resolvedProviders.entries()].map(([provider, resolved]) => [
      provider,
      createRegistryEntry(logger, provider, resolved),
    ]),
  ) as Record<AgentProvider, ProviderDefinition>;
}

export function getProviderIds(
  registry: Record<AgentProvider, ProviderDefinition>,
): AgentProvider[] {
  return Object.keys(registry);
}

// Deprecated: Use buildProviderRegistry instead
export const PROVIDER_REGISTRY: Record<AgentProvider, ProviderDefinition> =
  null as unknown as Record<AgentProvider, ProviderDefinition>;

export function createAllClients(
  logger: Logger,
  options?: BuildProviderRegistryOptions,
): Record<AgentProvider, AgentClient> {
  return createClientsFromRegistry(buildProviderRegistry(logger, options), logger);
}

export function createClientsFromRegistry(
  registry: Record<AgentProvider, ProviderDefinition>,
  logger: Logger,
): Record<AgentProvider, AgentClient> {
  return Object.fromEntries(
    Object.entries(registry).map(([provider, definition]) => [
      provider,
      definition.createClient(logger),
    ]),
  ) as Record<AgentProvider, AgentClient>;
}

export async function shutdownProviders(
  logger: Logger,
  options?: BuildProviderRegistryOptions,
): Promise<void> {
  const clients = createAllClients(logger, options);
  await shutdownAgentClients(Object.values(clients), logger);
}

export async function shutdownAgentClients(
  clients: Iterable<AgentClient>,
  logger: Logger,
): Promise<void> {
  await Promise.all(
    Array.from(clients).map(async (client) => {
      if (!client.shutdown) return;
      try {
        await client.shutdown();
      } catch (error) {
        logger.warn({ err: error, provider: client.provider }, "Provider client shutdown failed");
      }
    }),
  );
}
