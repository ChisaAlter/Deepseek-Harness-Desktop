import type { ManagedAgent } from "./agent-manager.js";
import type { AgentStorage, StoredAgentRecord, StoredAgentTitleSource } from "./agent-storage.js";

interface AgentMetadataUpdates {
  labels?: Record<string, string>;
  title?: string;
}

interface MetadataPersistOptions {
  title?: string | null;
  titleSource?: StoredAgentTitleSource;
}

interface AgentMetadataControllerOptions {
  emitState(agent: ManagedAgent, options?: { persist?: boolean }): void;
  getAgent(agentId: string): ManagedAgent | null;
  isAwaitingInitialSnapshotPersist(agentId: string): boolean;
  persistSnapshot(agent: ManagedAgent, options?: MetadataPersistOptions): Promise<void>;
  registry?: AgentStorage;
}

/** Owns agent titles, labels, attention clearing, and monotonic metadata timestamps. */
export class AgentMetadataController {
  constructor(private readonly options: AgentMetadataControllerOptions) {}

  touchUpdatedAt(agent: ManagedAgent): Date {
    const nowMs = Date.now();
    const previousMs = agent.updatedAt.getTime();
    const nextMs = nowMs > previousMs ? nowMs : previousMs + 1;
    const next = new Date(nextMs);
    agent.updatedAt = next;
    return next;
  }

  async setTitle(agent: ManagedAgent, title: string): Promise<void> {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      return;
    }
    if (
      this.options.isAwaitingInitialSnapshotPersist(agent.id) &&
      this.options.registry &&
      (await this.options.registry.get(agent.id)) === null
    ) {
      return;
    }
    agent.config = { ...agent.config, title: normalizedTitle };
    this.touchUpdatedAt(agent);
    await this.options.persistSnapshot(agent, {
      title: normalizedTitle,
      titleSource: "explicit",
    });
    this.options.emitState(agent, { persist: false });
  }

  async setGeneratedTitle(
    agent: ManagedAgent,
    title: string,
    options?: { force?: boolean },
  ): Promise<void> {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      return;
    }

    const registry = this.requireRegistry();
    const persisted = await registry.setGeneratedTitle(agent.id, normalizedTitle, options);
    if (options?.force) {
      agent.config = { ...agent.config, title: normalizedTitle };
    }
    agent.updatedAt = new Date(persisted.updatedAt);
    this.options.emitState(agent, { persist: false });
  }

  async setLabels(agent: ManagedAgent, labels: Record<string, string>): Promise<void> {
    agent.labels = { ...agent.labels, ...labels };
    this.touchUpdatedAt(agent);
    await this.options.persistSnapshot(agent);
    this.options.emitState(agent, { persist: false });
  }

  notifyAgentState(agentId: string): void {
    const agent = this.options.getAgent(agentId);
    if (!agent || agent.internal) {
      return;
    }
    this.touchUpdatedAt(agent);
    this.options.emitState(agent);
  }

  async clearAgentAttention(agent: ManagedAgent): Promise<void> {
    if (agent.attention.requiresAttention) {
      agent.attention = { requiresAttention: false };
      await this.options.persistSnapshot(agent);
      this.options.emitState(agent, { persist: false });
    }
  }

  async updateAgentMetadata(agentId: string, updates: AgentMetadataUpdates): Promise<void> {
    const liveAgent = this.options.getAgent(agentId);
    if (liveAgent) {
      const normalizedTitle = updates.title?.trim();
      const labels = updates.labels;

      if (normalizedTitle) {
        liveAgent.config = { ...liveAgent.config, title: normalizedTitle };
      }
      if (labels) {
        liveAgent.labels = { ...liveAgent.labels, ...labels };
      }
      const snapshotUpdates = normalizedTitle
        ? { title: normalizedTitle, titleSource: "explicit" as const }
        : {};
      this.touchUpdatedAt(liveAgent);
      await this.options.persistSnapshot(liveAgent, snapshotUpdates);
      this.options.emitState(liveAgent, { persist: false });
      return;
    }

    const registry = this.requireRegistry();
    const existing = await registry.get(agentId);
    if (!existing) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    await registry.upsert({
      ...existing,
      ...(updates.title ? { title: updates.title } : {}),
      ...(updates.labels ? { labels: { ...existing.labels, ...updates.labels } } : {}),
      updatedAt: nextStoredUpdatedAt(existing),
    });
  }

  private requireRegistry(): AgentStorage {
    if (!this.options.registry) {
      throw new Error("Agent storage unavailable");
    }
    return this.options.registry;
  }
}

function nextStoredUpdatedAt(record: StoredAgentRecord): string {
  const previousMs = Date.parse(record.updatedAt);
  const nowMs = Date.now();
  const nextMs = nowMs > previousMs ? nowMs : previousMs + 1;
  return new Date(nextMs).toISOString();
}
