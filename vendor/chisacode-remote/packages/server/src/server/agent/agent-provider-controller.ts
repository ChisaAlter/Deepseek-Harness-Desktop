import type { Logger } from "pino";

import type {
  AgentClient,
  AgentFeature,
  AgentPersistenceHandle,
  AgentProvider,
  AgentSessionConfig,
  AgentSlashCommand,
  ListPersistedAgentsOptions,
  PersistedAgentDescriptor,
} from "./agent-sdk-types.js";
import { IMPORTABLE_PROVIDERS } from "./provider-registry.js";

export interface ProviderAvailability {
  provider: AgentProvider;
  available: boolean;
  error: string | null;
}

export interface ProviderEnabledFlag {
  enabled: boolean;
  derivedFromProviderId?: string | null;
}

export type ProviderEnabledMap = Partial<Record<AgentProvider, ProviderEnabledFlag>>;
export type ProviderClientMap = Partial<Record<AgentProvider, AgentClient>>;

export type ImportablePersistedAgentQueryOptions = ListPersistedAgentsOptions & {
  /**
   * When set, only providers in this set are scanned, in addition to the
   * built-in importable allowlist + enabled + non-derived rules.
   */
  providerFilter?: Set<string>;
};

interface AgentProviderControllerOptions {
  clients: ProviderClientMap;
  providerDefinitions: ProviderEnabledMap;
  logger: Logger;
}

function formatProviderList(providers: readonly string[]): string {
  return providers.length > 0 ? providers.join(", ") : "none";
}

/** Owns provider registration, availability, discovery, and client selection. */
export class AgentProviderController {
  private readonly clients = new Map<AgentProvider, AgentClient>();
  private readonly providerEnabled = new Map<AgentProvider, boolean>();
  private readonly providerDerivedFromId = new Map<AgentProvider, string | null>();
  private readonly logger: Logger;

  constructor(options: AgentProviderControllerOptions) {
    this.logger = options.logger;
    this.updateProviderRegistry(options);
  }

  registerClient(provider: AgentProvider, client: AgentClient): void {
    this.clients.set(provider, client);
  }

  updateProviderRegistry(input: {
    providerDefinitions: ProviderEnabledMap;
    clients: ProviderClientMap;
  }): void {
    for (const [provider, definition] of Object.entries(input.providerDefinitions)) {
      if (definition) {
        this.providerEnabled.set(provider, definition.enabled);
        this.providerDerivedFromId.set(provider, definition.derivedFromProviderId ?? null);
      }
    }
    for (const [provider, client] of Object.entries(input.clients)) {
      if (client) {
        this.clients.set(provider, client);
      }
    }
  }

  getRegisteredProviderIds(): AgentProvider[] {
    return Array.from(this.clients.keys());
  }

  getClient(provider: AgentProvider): AgentClient | undefined {
    return this.clients.get(provider);
  }

  requireClient(provider: AgentProvider): AgentClient {
    const client = this.getClient(provider);
    if (!client) {
      throw new Error(`No client registered for provider '${provider}'`);
    }
    return client;
  }

  requireEnabledProvider(provider: AgentProvider): void {
    if (this.providerEnabled.get(provider) === false) {
      throw new Error(`Provider '${provider}' is disabled`);
    }
  }

  async requireAvailableClient(provider: AgentProvider): Promise<AgentClient> {
    const client = this.getClient(provider);
    if (!client) {
      throw new Error(
        `Unknown provider '${provider}'. Configured providers: ${formatProviderList(
          this.getConfiguredProviderIds(),
        )}.`,
      );
    }

    let unavailableReason: string | null = null;
    try {
      const available = await client.isAvailable();
      if (available) {
        return client;
      }
    } catch (error) {
      unavailableReason = error instanceof Error ? error.message : String(error);
    }

    const availableProviders = (await this.listProviderAvailability())
      .filter((entry) => entry.available)
      .map((entry) => entry.provider);
    const providerList = formatProviderList(availableProviders);
    const reason = unavailableReason ? ` Reason: ${unavailableReason}.` : "";
    throw new Error(
      `Provider '${provider}' is not available.${reason} Available providers: ${providerList}. Use one of those providers, or install/configure '${provider}'.`,
    );
  }

  async listProviderAvailability(): Promise<ProviderAvailability[]> {
    const checks = Array.from(this.clients.entries()).map(async ([provider, client]) => {
      try {
        const available = await client.isAvailable();
        return {
          provider,
          available,
          error: null,
        } satisfies ProviderAvailability;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn({ err: error, provider }, "Failed to check provider availability");
        return {
          provider,
          available: false,
          error: message,
        } satisfies ProviderAvailability;
      }
    });

    return await Promise.all(checks);
  }

  async listImportablePersistedAgents(
    options?: ImportablePersistedAgentQueryOptions,
  ): Promise<PersistedAgentDescriptor[]> {
    const providerEntries = Array.from(this.clients.entries()).filter(
      ([provider, client]) =>
        client.listPersistedAgents !== undefined &&
        this.isProviderImportable(provider, options?.providerFilter),
    );
    const descriptorLists = await Promise.all(
      providerEntries.map(async ([provider, client]) => {
        try {
          return await client.listPersistedAgents!({
            limit: options?.limit,
            cwd: options?.cwd,
          });
        } catch (error) {
          this.logger.warn(
            { err: error, provider },
            "Failed to list persisted agents for provider",
          );
          return [];
        }
      }),
    );
    const descriptors: PersistedAgentDescriptor[] = descriptorLists.flat();
    const limit = options?.limit ?? 20;
    return descriptors
      .sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime())
      .slice(0, limit);
  }

  async findPersistedAgent(
    provider: AgentProvider,
    sessionId: string,
    options?: Pick<ListPersistedAgentsOptions, "cwd">,
  ): Promise<PersistedAgentDescriptor | null> {
    const client = this.requireClient(provider);
    if (!client.listPersistedAgents) {
      return null;
    }

    const descriptors = await client.listPersistedAgents({ limit: 200, cwd: options?.cwd });
    return (
      descriptors.find((descriptor) => {
        return (
          descriptor.sessionId === sessionId || descriptor.persistence.nativeHandle === sessionId
        );
      }) ?? null
    );
  }

  async listDraftCommands(
    launchConfig: AgentSessionConfig,
    sourceProvider: AgentProvider,
  ): Promise<AgentSlashCommand[]> {
    const client = this.requireClient(launchConfig.provider);
    await this.requireClientAvailability(client, launchConfig.provider);
    if (client.listCommands) {
      return await client.listCommands(launchConfig);
    }

    const session = await client.createSession(launchConfig);
    try {
      if (!session.listCommands) {
        throw new Error(`Provider '${launchConfig.provider}' does not support listing commands`);
      }
      return await session.listCommands();
    } finally {
      try {
        await session.close();
      } catch (error) {
        this.logger.warn(
          { err: error, provider: sourceProvider },
          "Failed to close draft command listing session",
        );
      }
    }
  }

  async listDraftFeatures(
    launchConfig: AgentSessionConfig,
    sourceProvider: AgentProvider,
  ): Promise<AgentFeature[]> {
    const client = this.requireClient(launchConfig.provider);
    await this.requireClientAvailability(client, launchConfig.provider);
    if (client.listFeatures) {
      return await client.listFeatures(launchConfig);
    }

    const session = await client.createSession(launchConfig);
    try {
      return session.features ?? [];
    } finally {
      try {
        await session.close();
      } catch (error) {
        this.logger.warn(
          { err: error, provider: sourceProvider },
          "Failed to close draft feature listing session",
        );
      }
    }
  }

  async archiveNativeSessionBestEffort(
    provider: AgentProvider,
    persistence: AgentPersistenceHandle | null | undefined,
  ): Promise<void> {
    if (!persistence) return;
    const client = this.getClient(provider);
    if (!client?.archiveNativeSession) return;
    try {
      await client.archiveNativeSession(persistence);
    } catch (error) {
      this.logger.warn(
        { error, provider, sessionId: persistence.sessionId },
        "Failed to archive native session (best-effort)",
      );
    }
  }

  private isProviderImportable(
    provider: AgentProvider,
    providerFilter: Set<string> | undefined,
  ): boolean {
    if (!IMPORTABLE_PROVIDERS.includes(provider as (typeof IMPORTABLE_PROVIDERS)[number])) {
      return false;
    }
    if (this.providerEnabled.get(provider) === false) {
      return false;
    }
    if (this.providerDerivedFromId.get(provider) != null) {
      return false;
    }
    if (providerFilter && !providerFilter.has(provider)) {
      return false;
    }
    return true;
  }

  private getConfiguredProviderIds(): AgentProvider[] {
    return Array.from(new Set([...this.providerEnabled.keys(), ...this.clients.keys()]));
  }

  private async requireClientAvailability(
    client: AgentClient,
    provider: AgentProvider,
  ): Promise<void> {
    if (await client.isAvailable()) {
      return;
    }
    throw new Error(`Provider '${provider}' is not available. Please ensure the CLI is installed.`);
  }
}
