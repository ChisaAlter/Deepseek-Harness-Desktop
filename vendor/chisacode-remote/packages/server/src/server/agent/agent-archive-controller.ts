import { isCascadingAgentRelation, readAgentRelation } from "@chisacode/protocol/agent-labels";
import type { Logger } from "pino";

import type {
  AgentCapabilityFlags,
  AgentPersistenceHandle,
  AgentProvider,
  AgentSessionConfig,
} from "./agent-sdk-types.js";
import { buildArchivedAgentRecord, type ArchivedStoredAgentRecord } from "./agent-archive.js";
import type { ManagedAgent } from "./agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "./agent-storage.js";

const STORED_AGENT_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: false,
  supportsSessionPersistence: true,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: true,
  supportsRewindConversation: false,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
};

export type AgentArchivedCallback = (agentId: string) => Promise<void> | void;

interface AgentArchiveControllerOptions {
  archiveNativeSessionBestEffort(
    provider: AgentProvider,
    persistence: AgentPersistenceHandle | null | undefined,
  ): Promise<void>;
  closeAgent(agentId: string): Promise<void>;
  dispatchAgentState(agent: ManagedAgent): void;
  getAgent(agentId: string): ManagedAgent | null;
  logger: Logger;
  notifyAgentState(agentId: string): void;
  persistSnapshot(agent: ManagedAgent, options?: { internal?: boolean }): Promise<void>;
  registry?: AgentStorage;
}

/** Owns live and stored agent archive lifecycle, cascade policy, and archive notifications. */
export class AgentArchiveController {
  private onAgentArchived?: AgentArchivedCallback;

  constructor(private readonly options: AgentArchiveControllerOptions) {}

  setArchivedCallback(callback: AgentArchivedCallback): void {
    this.onAgentArchived = callback;
  }

  async archiveAgent(agent: ManagedAgent): Promise<{ archivedAt: string }> {
    const registry = this.options.registry;
    if (!registry) {
      throw new Error("Agent storage is not configured");
    }

    await registry.applySnapshot(agent, {
      internal: agent.internal,
    });
    const stored = await registry.get(agent.id);
    if (!stored) {
      throw new Error(`Agent ${agent.id} not found in storage after snapshot`);
    }

    const { archivedAt } = await this.markRecordArchived(stored);
    agent.updatedAt = new Date(archivedAt);
    await this.options.closeAgent(agent.id);

    await this.cascadeArchiveChildren(agent.id);

    return { archivedAt };
  }

  async archiveSnapshot(agentId: string, archivedAt: string): Promise<StoredAgentRecord> {
    const registry = this.requireRegistry();
    const liveAgent = this.options.getAgent(agentId);
    if (liveAgent) {
      await this.options.persistSnapshot(liveAgent, {
        internal: liveAgent.internal,
      });
    }

    const record = await registry.get(agentId);
    if (!record) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const nextRecord = buildArchivedAgentRecord(record, { archivedAt });
    await registry.upsert(nextRecord);

    await this.options.archiveNativeSessionBestEffort(record.provider, record.persistence);

    if (this.options.getAgent(agentId)) {
      this.options.notifyAgentState(agentId);
    } else if (!nextRecord.internal) {
      this.dispatchArchivedStoredAgent(nextRecord);
    }

    await this.fireAgentArchived(agentId);

    return nextRecord;
  }

  async unarchiveSnapshot(agentId: string): Promise<boolean> {
    const registry = this.requireRegistry();
    const record = await registry.get(agentId);
    if (!record || !record.archivedAt) {
      return false;
    }

    await registry.upsert({
      ...record,
      archivedAt: null,
    });

    if (this.options.getAgent(agentId)) {
      this.options.notifyAgentState(agentId);
    }
    return true;
  }

  async unarchiveSnapshotByHandle(handle: AgentPersistenceHandle): Promise<void> {
    const registry = this.requireRegistry();
    const records = await registry.list();
    const matched = records.find(
      (record) =>
        record.persistence?.provider === handle.provider &&
        record.persistence?.sessionId === handle.sessionId,
    );
    if (!matched) {
      return;
    }

    await this.unarchiveSnapshot(matched.id);
  }

  // Only true subagent/team-slot relations are owned by the parent lifecycle.
  // Legacy records with only a parent label still derive a subagent relation.
  private async cascadeArchiveChildren(parentAgentId: string): Promise<void> {
    const registry = this.options.registry;
    if (!registry) {
      return;
    }
    const records = await registry.list();
    for (const record of records) {
      if (record.archivedAt) {
        continue;
      }
      const relation = readAgentRelation(record.labels, record.relation);
      if (relation?.parentAgentId !== parentAgentId || !isCascadingAgentRelation(relation)) {
        continue;
      }
      const liveAgent = this.options.getAgent(record.id);
      if (liveAgent) {
        await this.archiveAgent(liveAgent);
      } else {
        await this.markRecordArchived(record);
        await this.cascadeArchiveChildren(record.id);
      }
    }
  }

  private async markRecordArchived(record: StoredAgentRecord): Promise<ArchivedStoredAgentRecord> {
    const registry = this.requireRegistry();
    const archivedAt = new Date().toISOString();
    const archivedRecord = buildArchivedAgentRecord(record, { archivedAt, updatedAt: archivedAt });

    await registry.upsert(archivedRecord);

    await this.options.archiveNativeSessionBestEffort(record.provider, record.persistence);

    if (this.options.getAgent(record.id)) {
      this.options.notifyAgentState(record.id);
    } else if (!archivedRecord.internal) {
      this.dispatchArchivedStoredAgent(archivedRecord);
    }

    await this.fireAgentArchived(record.id);

    return archivedRecord;
  }

  private async fireAgentArchived(agentId: string): Promise<void> {
    const callback = this.onAgentArchived;
    if (!callback) {
      return;
    }
    try {
      await callback(agentId);
    } catch (error) {
      this.options.logger.warn({ err: error, agentId }, "onAgentArchived callback failed");
    }
  }

  private dispatchArchivedStoredAgent(record: StoredAgentRecord): void {
    const updatedAt = new Date(record.updatedAt);
    this.options.dispatchAgentState({
      id: record.id,
      provider: record.provider,
      cwd: record.cwd,
      session: null,
      capabilities: STORED_AGENT_CAPABILITIES,
      config: buildStoredAgentConfig(record),
      runtimeInfo: undefined,
      lifecycle: "closed",
      createdAt: new Date(record.createdAt),
      updatedAt,
      availableModes: [],
      features: record.features,
      currentModeId: record.lastModeId ?? null,
      pendingPermissions: new Map(),
      bufferedPermissionResolutions: new Map(),
      inFlightPermissionResponses: new Set(),
      pendingReplacement: false,
      activeForegroundTurnId: null,
      foregroundTurnWaiters: new Set(),
      finalizedForegroundTurnIds: new Set(),
      unsubscribeSession: null,
      persistence: record.persistence ?? null,
      historyPrimed: true,
      lastUserMessageAt: record.lastUserMessageAt ? new Date(record.lastUserMessageAt) : null,
      lastUsage: undefined,
      lastError: record.lastError ?? undefined,
      attention: { requiresAttention: false },
      internal: record.internal,
      labels: record.labels,
      currentTurnToolCallCount: 0,
    });
  }

  private requireRegistry(): AgentStorage {
    if (!this.options.registry) {
      throw new Error("Agent storage unavailable");
    }
    return this.options.registry;
  }
}

function buildStoredAgentConfig(record: StoredAgentRecord): AgentSessionConfig {
  const config: AgentSessionConfig = {
    provider: record.provider,
    cwd: record.cwd,
  };
  if (!record.config) {
    return config;
  }
  if (record.config.runtimeProvider != null) config.runtimeProvider = record.config.runtimeProvider;
  if (record.config.modeId != null) config.modeId = record.config.modeId;
  if (record.config.model != null) config.model = record.config.model;
  if (record.config.thinkingOptionId != null) {
    config.thinkingOptionId = record.config.thinkingOptionId;
  }
  if (record.config.featureValues != null) {
    config.featureValues = record.config.featureValues;
  }
  if (record.config.extra != null) config.extra = record.config.extra;
  if (record.config.systemPrompt != null) {
    config.systemPrompt = record.config.systemPrompt;
  }
  if (record.config.mcpServers != null) config.mcpServers = record.config.mcpServers;
  return config;
}
