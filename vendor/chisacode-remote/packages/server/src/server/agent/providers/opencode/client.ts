import { homedir } from "node:os";
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { Logger } from "pino";

import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentCreateSessionOptions,
  AgentFeature,
  AgentLaunchContext,
  AgentMode,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentSession,
  AgentSessionConfig,
  AgentSlashCommand,
  ListModelsOptions,
  ListModesOptions,
  ListPersistedAgentsOptions,
  PersistedAgentDescriptor,
} from "../../agent-sdk-types.js";
import {
  checkProviderLaunchAvailable,
  createProviderEnvSpec,
  resolveProviderLaunch,
  type ProviderRuntimeSettings,
} from "../../provider-launch-config.js";
import { withTimeout } from "../../../../utils/promise-timeout.js";
import { execCommand } from "../../../../utils/spawn.js";
import {
  applyRuntimeModelPrefix,
  buildOpenCodeModelContextWindowLookup,
  buildOpenCodeModelDefinition,
  buildOpenCodeModelLookupKey,
  DEFAULT_MODES,
  extractOpenCodeModelContextWindow,
  isSelectableOpenCodeAgent,
  listOpenCodeCommandsFromSdk,
  mapOpenCodeAgentToMode,
  mergeOpenCodeModes,
  normalizeOpenCodeConfig,
  readRuntimeModelPrefix,
  type OpenCodeAgentConfig,
} from "./catalog.js";
import { OPENCODE_PROVIDER_LIST_TIMEOUT_MS } from "./constants.js";
import {
  buildOpenCodeAutoAcceptFeature,
  isOpenCodeCreateConfigUnattended,
  resolveOpenCodeCreateConfig,
} from "./helpers.js";
import { ProductionOpenCodeRuntime, type OpenCodeRuntime } from "./runtime.js";
import { OpenCodeServerManager, type OpenCodeLikeProviderConfig } from "./server-manager.js";
import {
  buildBinaryDiagnosticRows,
  formatDiagnosticStatus,
  formatProviderDiagnostic,
  formatProviderDiagnosticError,
  toDiagnosticErrorMessage,
} from "../diagnostic-utils.js";

export const OPENCODE_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: true,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsRewindConversation: false,
  supportsRewindFiles: false,
  supportsRewindBoth: true,
};

export const OPENCODE_PROVIDER_CONFIG: OpenCodeLikeProviderConfig = {
  providerId: "opencode",
  label: "OpenCode",
  binary: "opencode",
  serveArgs: (port) => ["serve", "--port", port],
  rotateServerOnForceRefresh: true,
  ignoreSystemEnvForDedicatedServer: false,
  installUrl: "https://github.com/opencode-ai/opencode",
};

/** Inputs required to construct an OpenCode session without coupling the client to its class. */
export interface OpenCodeSessionFactoryInput {
  config: OpenCodeAgentConfig;
  client: OpencodeClient;
  sessionId: string;
  logger: Logger;
  modelContextWindowsByModelKey: ReadonlyMap<string, number>;
  releaseServer?: () => void;
  persistSession?: boolean;
  agentId?: string;
  modelPrefix?: string;
}

export type OpenCodeSessionFactory = (input: OpenCodeSessionFactoryInput) => AgentSession;

export type OpenCodePersistedAgentCollector = (
  client: Pick<OpencodeClient, "experimental" | "session">,
  options?: ListPersistedAgentsOptions,
) => Promise<PersistedAgentDescriptor[]>;

export interface OpenCodeAgentClientDeps {
  runtime?: OpenCodeRuntime;
}

export class OpenCodeAgentClientRuntime implements AgentClient {
  readonly provider = "opencode" as const;
  readonly capabilities = OPENCODE_CAPABILITIES;
  readonly resolveCreateConfig = resolveOpenCodeCreateConfig;
  readonly isCreateConfigUnattended = isOpenCodeCreateConfigUnattended;

  private readonly runtime: OpenCodeRuntime;
  private readonly logger: Logger;
  private readonly runtimeSettings?: ProviderRuntimeSettings;
  private readonly providerConfig: OpenCodeLikeProviderConfig;
  private readonly modelContextWindows = new Map<string, number>();
  private readonly sessionFactory: OpenCodeSessionFactory;
  private readonly collectPersistedAgents: OpenCodePersistedAgentCollector;

  constructor(
    logger: Logger,
    runtimeSettings: ProviderRuntimeSettings | undefined,
    deps: OpenCodeAgentClientDeps,
    sessionFactory: OpenCodeSessionFactory,
    collectPersistedAgents: OpenCodePersistedAgentCollector,
    providerConfig: OpenCodeLikeProviderConfig = OPENCODE_PROVIDER_CONFIG,
  ) {
    this.providerConfig = providerConfig;
    this.sessionFactory = sessionFactory;
    this.collectPersistedAgents = collectPersistedAgents;
    this.logger = logger.child({ module: "agent", provider: providerConfig.providerId });
    this.runtimeSettings = runtimeSettings;
    this.runtime =
      deps.runtime ??
      new ProductionOpenCodeRuntime(
        OpenCodeServerManager.getInstance(this.logger, runtimeSettings, providerConfig),
      );
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
    options?: AgentCreateSessionOptions,
  ): Promise<AgentSession> {
    const openCodeConfig = this.assertConfig(config);
    const acquisition = await this.runtime.acquireServer({
      force: false,
      env: launchContext?.env,
    });
    const { url } = acquisition.server;
    const client = this.runtime.createClient({
      baseUrl: url,
      directory: openCodeConfig.cwd,
    });

    try {
      const response = await withTimeout(
        client.session.create({ directory: openCodeConfig.cwd }),
        10_000,
        `${this.providerConfig.label} session.create timed out after 10s`,
      );

      if (response.error) {
        throw new Error(
          `Failed to create ${this.providerConfig.label} session: ${JSON.stringify(
            response.error,
          )}`,
        );
      }

      const session = response.data;
      if (!session) {
        throw new Error(`${this.providerConfig.label} session creation returned no data`);
      }

      await this.populateModelContextWindowCache(client, openCodeConfig.cwd);

      return this.sessionFactory({
        config: openCodeConfig,
        client,
        sessionId: session.id,
        logger: this.logger,
        modelContextWindowsByModelKey: new Map(this.modelContextWindows),
        releaseServer: acquisition.release,
        persistSession: options?.persistSession,
        agentId: launchContext?.agentId,
        modelPrefix: readRuntimeModelPrefix(this.runtimeSettings) ?? undefined,
      });
    } catch (error) {
      acquisition.release();
      throw error;
    }
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const metadata = (handle.metadata ?? {}) as Partial<AgentSessionConfig>;
    const cwd = overrides?.cwd ?? metadata.cwd;
    if (!cwd) {
      throw new Error("OpenCode resume requires the original working directory");
    }

    const config: AgentSessionConfig = {
      ...metadata,
      ...overrides,
      provider: "opencode",
      cwd,
    };
    const openCodeConfig = this.assertConfig(config);
    const acquisition = await this.runtime.acquireServer({ force: false });
    const { url } = acquisition.server;
    const client = this.runtime.createClient({
      baseUrl: url,
      directory: openCodeConfig.cwd,
    });

    try {
      await this.populateModelContextWindowCache(client, openCodeConfig.cwd);

      return this.sessionFactory({
        config: openCodeConfig,
        client,
        sessionId: handle.sessionId,
        logger: this.logger,
        modelContextWindowsByModelKey: new Map(this.modelContextWindows),
        releaseServer: acquisition.release,
        agentId: launchContext?.agentId,
        modelPrefix: readRuntimeModelPrefix(this.runtimeSettings) ?? undefined,
      });
    } catch (error) {
      acquisition.release();
      throw error;
    }
  }

  async listModels(options: ListModelsOptions): Promise<AgentModelDefinition[]> {
    const acquisition = await this.runtime.acquireServer({ force: options.force });
    const { url } = acquisition.server;
    const client = this.runtime.createClient({
      baseUrl: url,
      directory: options.cwd,
    });

    try {
      // Background model discovery can be legitimately slow while OpenCode refreshes
      // provider state, so allow longer than turn execution paths.
      const response = await withTimeout(
        client.provider.list({ directory: options.cwd }),
        OPENCODE_PROVIDER_LIST_TIMEOUT_MS,
        `${this.providerConfig.label} provider.list timed out after ${
          OPENCODE_PROVIDER_LIST_TIMEOUT_MS / 1000
        }s - server may not be authenticated or connected to any providers`,
      );

      if (response.error) {
        throw new Error(
          `Failed to fetch ${this.providerConfig.label} providers: ${JSON.stringify(
            response.error,
          )}`,
        );
      }

      const providers = response.data;
      if (!providers) {
        return [];
      }

      const connectedProviderIds = new Set(providers.connected);

      // Providers with source "api" are managed by the OpenCode console/subscription (e.g. Pi
      // coding agent). They do not appear in `connected` (which only lists env/config providers)
      // but are fully usable — OpenCode authenticates them internally via the console session.
      const isAccessible = (provider: { id: string; source: string }): boolean =>
        connectedProviderIds.has(provider.id) || provider.source === "api";

      // Fail fast if no providers are accessible at all
      if (!providers.all.some(isAccessible)) {
        throw new Error(
          `${this.providerConfig.label} has no connected providers. Please authenticate with at least one provider ` +
            "(e.g., openai, anthropic), set appropriate environment variables (e.g., OPENAI_API_KEY), " +
            `or log in to ${this.providerConfig.label} via the console.`,
        );
      }

      const models: AgentModelDefinition[] = [];
      this.modelContextWindows.clear();
      for (const provider of providers.all) {
        if (!isAccessible(provider)) {
          continue;
        }

        for (const [modelId, model] of Object.entries(provider.models)) {
          const definition = buildOpenCodeModelDefinition(provider, modelId, model);
          const contextWindowMaxTokens = extractOpenCodeModelContextWindow(model);
          if (contextWindowMaxTokens !== undefined) {
            this.modelContextWindows.set(
              buildOpenCodeModelLookupKey(provider.id, modelId),
              contextWindowMaxTokens,
            );
          }
          models.push(definition);
        }
      }

      return models;
    } finally {
      acquisition.release();
    }
  }

  async listModes(options: ListModesOptions): Promise<AgentMode[]> {
    const acquisition = await this.runtime.acquireServer({ force: options.force });
    const { url } = acquisition.server;
    const directory = options.cwd;
    const client = this.runtime.createClient({ baseUrl: url, directory });

    try {
      const response = await withTimeout(
        client.app.agents({ directory }),
        10_000,
        `${this.providerConfig.label} app.agents timed out after 10s`,
      );

      if (response.error || !response.data) {
        return DEFAULT_MODES;
      }

      const discovered = response.data
        .filter(isSelectableOpenCodeAgent)
        .map(mapOpenCodeAgentToMode);

      return mergeOpenCodeModes(discovered);
    } finally {
      acquisition.release();
    }
  }

  async listCommands(config: AgentSessionConfig): Promise<AgentSlashCommand[]> {
    const openCodeConfig = this.assertConfig(config);
    const acquisition = await this.runtime.acquireServer({ force: false });
    const { url } = acquisition.server;
    const client = this.runtime.createClient({
      baseUrl: url,
      directory: openCodeConfig.cwd,
    });

    try {
      return await listOpenCodeCommandsFromSdk(client, openCodeConfig.cwd);
    } finally {
      acquisition.release();
    }
  }

  async listFeatures(config: AgentSessionConfig): Promise<AgentFeature[]> {
    return [buildOpenCodeAutoAcceptFeature(this.assertConfig(config))];
  }

  async listPersistedAgents(
    options?: ListPersistedAgentsOptions,
  ): Promise<PersistedAgentDescriptor[]> {
    const acquisition = await this.runtime.acquireServer({ force: false });
    const { url } = acquisition.server;
    const client = this.runtime.createClient({
      baseUrl: url,
      directory: options?.cwd ?? "",
    });

    try {
      return await this.collectPersistedAgents(client, options);
    } finally {
      acquisition.release();
    }
  }

  async isAvailable(): Promise<boolean> {
    const launch = await resolveProviderLaunch({
      commandConfig: this.runtimeSettings?.command,
      defaultBinary: this.providerConfig.binary,
    });
    const availability = await checkProviderLaunchAvailable(launch);
    return availability.available;
  }

  async shutdown(): Promise<void> {
    await this.runtime.shutdown();
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    try {
      const launch = await resolveProviderLaunch({
        commandConfig: this.runtimeSettings?.command,
        defaultBinary: this.providerConfig.binary,
      });
      const availability = await checkProviderLaunchAvailable(launch);
      const available = availability.available;
      let serverStatus = "Not running";
      let modelsValue = "Not checked";
      let status = formatDiagnosticStatus(available);

      try {
        const { url } = await this.runtime.ensureServerRunning();
        serverStatus = `Running (${url})`;
      } catch (error) {
        serverStatus = `Unavailable (${toDiagnosticErrorMessage(error)})`;
      }

      let authValue = "Not checked";
      const authCommand = availability.available
        ? (availability.resolvedPath ?? launch.command)
        : null;
      if (authCommand) {
        try {
          const { stdout, stderr } = await execCommand(
            authCommand,
            [...launch.args, "auth", "list"],
            {
              ...createProviderEnvSpec(),
              timeout: 5_000,
            },
          );
          const text = (stdout.trim() || stderr.trim()).trim();
          authValue = text ? `\n    ${text.replace(/\n/g, "\n    ")}` : "(empty)";
        } catch (error) {
          authValue = `Error - ${toDiagnosticErrorMessage(error)}`;
        }
      }

      if (available) {
        try {
          const models = await this.listModels({ cwd: homedir(), force: false });
          modelsValue = String(models.length);
        } catch (error) {
          modelsValue = `Error - ${toDiagnosticErrorMessage(error)}`;
          status = formatDiagnosticStatus(available, {
            source: "model fetch",
            cause: error,
          });
        }

        if (!modelsValue.startsWith("Error -")) {
          try {
            await this.listModes({ cwd: homedir(), force: false });
          } catch (error) {
            status = formatDiagnosticStatus(available, {
              source: "mode fetch",
              cause: error,
            });
          }
        }
      }

      return {
        diagnostic: formatProviderDiagnostic(this.providerConfig.label, [
          ...(await buildBinaryDiagnosticRows(launch, availability)),
          { label: "Server", value: serverStatus },
          { label: "Auth", value: authValue },
          { label: "Models", value: modelsValue },
          { label: "Status", value: status },
        ]),
      };
    } catch (error) {
      return {
        diagnostic: formatProviderDiagnosticError(this.providerConfig.label, error),
      };
    }
  }
  private assertConfig(config: AgentSessionConfig): OpenCodeAgentConfig {
    if (config.provider !== "opencode") {
      throw new Error(`OpenCodeAgentClient received config for provider '${config.provider}'`);
    }
    return normalizeOpenCodeConfig({
      ...config,
      provider: "opencode",
      model: applyRuntimeModelPrefix(config.model, readRuntimeModelPrefix(this.runtimeSettings)),
    });
  }

  private async populateModelContextWindowCache(
    client: OpencodeClient,
    cwd: string,
  ): Promise<void> {
    const response = await client.provider.list({ directory: cwd });
    if (response.error || !response.data) {
      return;
    }

    const lookup = buildOpenCodeModelContextWindowLookup(response.data);
    this.modelContextWindows.clear();
    for (const [modelLookupKey, contextWindowMaxTokens] of lookup.entries()) {
      this.modelContextWindows.set(modelLookupKey, contextWindowMaxTokens);
    }
  }
}
