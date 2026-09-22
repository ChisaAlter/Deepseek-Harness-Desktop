import {
  AgentCreateFailedStatusPayloadSchema,
  AgentCreatedStatusPayloadSchema,
  AgentRefreshedStatusPayloadSchema,
  AgentResumedStatusPayloadSchema,
  SessionInboundMessageSchema,
  type AgentRewindResponseMessage,
  type AgentSnapshotPayload,
  type CreateAgentRequestMessage,
  type GitSetupOptions,
  type ProjectPlacementPayload,
  type SessionInboundMessage,
  type SessionOutboundMessage,
} from "@chisacode/protocol/messages";
import type {
  AgentPersistenceHandle,
  AgentProvider,
  AgentSessionConfig,
} from "@chisacode/protocol/agent-types";

import type {
  DaemonCommandResponsePayload,
  DaemonCommandTransport,
} from "./daemon-client-command-transport.js";

interface ImportAgentInputBase {
  cwd?: string;
  labels?: Record<string, string>;
}

/** Identifies a persisted provider session to import into the daemon. */
export type ImportAgentInput =
  | (ImportAgentInputBase & {
      providerId: string;
      providerHandleId: string;
    })
  | (ImportAgentInputBase & {
      provider: AgentProvider;
      sessionId: string;
    });

type AgentConfigOverrides = Partial<Omit<AgentSessionConfig, "provider" | "cwd">>;

/** Options for creating and optionally starting a daemon agent. */
export interface CreateAgentRequestOptions extends AgentConfigOverrides {
  config?: AgentSessionConfig;
  provider?: AgentProvider;
  cwd?: string;
  env?: CreateAgentRequestMessage["env"];
  workspaceId?: string;
  initialPrompt?: string;
  clientMessageId?: string;
  /**
   * Client-minted agent id (UUID). When provided, the daemon adopts it verbatim
   * so the optimistic sidebar row and the authoritative agent share one key.
   * When omitted, the daemon mints its own UUID.
   */
  agentId?: string;
  outputSchema?: Record<string, unknown>;
  images?: CreateAgentRequestMessage["images"];
  attachments?: CreateAgentRequestMessage["attachments"];
  git?: GitSetupOptions;
  worktree?: CreateAgentRequestMessage["worktree"];
  autoArchive?: CreateAgentRequestMessage["autoArchive"];
  worktreeName?: string;
  requestId?: string;
  labels?: Record<string, string>;
}

/**
 * The created agent snapshot, optionally carrying the project placement the
 * daemon attached to the `agent_created` status. Older daemons omit `project`;
 * callers must fall back to the workspace descriptor or a cwd-derived placement.
 */
export type CreateAgentResult = AgentSnapshotPayload & {
  project?: ProjectPlacementPayload | null;
};

/** Latest agent snapshot and its optional project placement. */
export interface FetchAgentResult {
  agent: AgentSnapshotPayload;
  project: ProjectPlacementPayload | null;
}

export type AgentRefreshedStatusPayload = ReturnType<
  typeof AgentRefreshedStatusPayloadSchema.parse
>;

type FetchAgentPayload = DaemonCommandResponsePayload<"fetch_agent_response">;
type ArchiveAgentPayload = DaemonCommandResponsePayload<"agent_archived">;
type RenameProjectPayload = DaemonCommandResponsePayload<"project.rename.response">;
type RewindAgentPayload = AgentRewindResponseMessage["payload"];

interface AgentLifecycleTransport extends DaemonCommandTransport {
  createRequestId(requestId?: string): string;
  requestStatus<T>(params: {
    requestId: string;
    message: SessionInboundMessage;
    timeout: number;
    select(message: SessionOutboundMessage): T | null;
  }): Promise<T>;
}

/** Implements agent lifecycle, persistence, rewind, and runtime setting commands. */
export class AgentLifecycleClient {
  constructor(private readonly transport: AgentLifecycleTransport) {}

  async fetchAgent(agentId: string, requestId?: string): Promise<FetchAgentResult | null> {
    const payload: FetchAgentPayload = await this.transport.request({
      requestId,
      message: { type: "fetch_agent_request", agentId },
      responseType: "fetch_agent_response",
      timeout: 10_000,
    });
    if (payload.error) {
      throw new Error(payload.error);
    }
    if (!payload.agent) {
      return null;
    }
    return { agent: payload.agent, project: payload.project ?? null };
  }

  async createAgent(options: CreateAgentRequestOptions): Promise<CreateAgentResult> {
    const requestId = this.transport.createRequestId(options.requestId);
    const config = resolveAgentConfig(options);
    const message = SessionInboundMessageSchema.parse({
      type: "create_agent_request",
      requestId,
      config,
      ...(options.env ? { env: options.env } : {}),
      ...(options.workspaceId !== undefined ? { workspaceId: options.workspaceId } : {}),
      ...(options.initialPrompt ? { initialPrompt: options.initialPrompt } : {}),
      ...(options.clientMessageId ? { clientMessageId: options.clientMessageId } : {}),
      ...(options.agentId ? { agentId: options.agentId } : {}),
      ...(options.outputSchema ? { outputSchema: options.outputSchema } : {}),
      ...(options.images && options.images.length > 0 ? { images: options.images } : {}),
      ...(options.attachments && options.attachments.length > 0
        ? { attachments: options.attachments }
        : {}),
      ...(options.git ? { git: options.git } : {}),
      ...(options.worktree ? { worktree: options.worktree } : {}),
      ...(options.autoArchive !== undefined ? { autoArchive: options.autoArchive } : {}),
      ...(options.worktreeName ? { worktreeName: options.worktreeName } : {}),
      ...(options.labels && Object.keys(options.labels).length > 0
        ? { labels: options.labels }
        : {}),
    });
    const status = await this.transport.requestStatus({
      requestId,
      message,
      timeout: 60_000,
      select: (response) => {
        if (response.type !== "status") {
          return null;
        }
        const created = AgentCreatedStatusPayloadSchema.safeParse(response.payload);
        if (created.success && created.data.requestId === requestId) {
          return created.data;
        }
        const failed = AgentCreateFailedStatusPayloadSchema.safeParse(response.payload);
        if (failed.success && failed.data.requestId === requestId) {
          return failed.data;
        }
        return null;
      },
    });
    if (status.status === "agent_create_failed") {
      throw new Error(status.error);
    }
    // Attach the daemon-provided project placement (when present) so callers can
    // place the created agent under the correct sidebar directory immediately.
    return status.project ? { ...status.agent, project: status.project } : status.agent;
  }

  async deleteAgent(agentId: string): Promise<void> {
    await this.transport.request({
      message: { type: "delete_agent_request", agentId },
      responseType: "agent_deleted",
      timeout: 10_000,
    });
  }

  async archiveAgent(agentId: string): Promise<{ archivedAt: string }> {
    const result: ArchiveAgentPayload = await this.transport.request({
      message: { type: "archive_agent_request", agentId },
      responseType: "agent_archived",
      // Archiving closes a live agent (cancels in-flight runs, persists the
      // snapshot, cascades to subagents); under load the daemon can take
      // 10–12s per archive. 10s caused spurious client timeouts that rolled
      // back the optimistic removal and made already-archived sessions
      // reappear. 30s keeps the UI honest without masking genuine failures.
      timeout: 30_000,
    });
    return { archivedAt: result.archivedAt };
  }

  async updateAgent(
    agentId: string,
    updates: {
      name?: string;
      labels?: Record<string, string>;
      regenerateTitle?: boolean;
    },
  ): Promise<void> {
    const payload = await this.transport.request({
      message: {
        type: "update_agent_request",
        agentId,
        ...(updates.name !== undefined ? { name: updates.name } : {}),
        ...(updates.labels && Object.keys(updates.labels).length > 0
          ? { labels: updates.labels }
          : {}),
        ...(updates.regenerateTitle === true ? { regenerateTitle: true } : {}),
      },
      responseType: "update_agent_response",
      timeout: 30_000,
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "updateAgent rejected");
    }
  }

  async renameProject(
    projectId: string,
    customName: string | null,
    requestId?: string,
  ): Promise<{ customName: string | null }> {
    const payload: RenameProjectPayload = await this.transport.request({
      requestId,
      message: { type: "project.rename.request", projectId, customName },
      responseType: "project.rename.response",
      timeout: 10_000,
    });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "renameProject rejected");
    }
    return { customName: payload.customName };
  }

  async resumeAgent(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
  ): Promise<AgentSnapshotPayload> {
    const requestId = this.transport.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "resume_agent_request",
      requestId,
      handle,
      ...(overrides ? { overrides } : {}),
    });
    const status = await this.transport.requestStatus({
      requestId,
      message,
      timeout: 15_000,
      select: (response) => {
        if (response.type !== "status") {
          return null;
        }
        const resumed = AgentResumedStatusPayloadSchema.safeParse(response.payload);
        return resumed.success && resumed.data.requestId === requestId ? resumed.data : null;
      },
    });
    return status.agent;
  }

  async importAgent(input: ImportAgentInput): Promise<AgentSnapshotPayload> {
    const requestId = this.transport.createRequestId();
    const message = SessionInboundMessageSchema.parse({
      type: "import_agent_request",
      requestId,
      ...("providerId" in input
        ? { providerId: input.providerId, providerHandleId: input.providerHandleId }
        : { provider: input.provider, sessionId: input.sessionId }),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.labels && Object.keys(input.labels).length > 0 ? { labels: input.labels } : {}),
    });
    const status = await this.transport.requestStatus({
      requestId,
      message,
      timeout: 15_000,
      select: (response) => {
        if (response.type !== "status") {
          return null;
        }
        const resumed = AgentResumedStatusPayloadSchema.safeParse(response.payload);
        if (resumed.success && resumed.data.requestId === requestId) {
          return resumed.data;
        }
        const failed = AgentCreateFailedStatusPayloadSchema.safeParse(response.payload);
        return failed.success && failed.data.requestId === requestId ? failed.data : null;
      },
    });
    if (status.status === "agent_create_failed") {
      throw new Error(status.error);
    }
    return status.agent;
  }

  async refreshAgent(agentId: string, requestId?: string): Promise<AgentRefreshedStatusPayload> {
    const resolvedRequestId = this.transport.createRequestId(requestId);
    const message = SessionInboundMessageSchema.parse({
      type: "refresh_agent_request",
      agentId,
      requestId: resolvedRequestId,
    });
    return this.transport.requestStatus({
      requestId: resolvedRequestId,
      message,
      timeout: 15_000,
      select: (response) => {
        if (response.type !== "status") {
          return null;
        }
        const refreshed = AgentRefreshedStatusPayloadSchema.safeParse(response.payload);
        return refreshed.success && refreshed.data.requestId === resolvedRequestId
          ? refreshed.data
          : null;
      },
    });
  }

  async rewindAgent(
    agentId: string,
    messageId: string,
    mode: "conversation" | "files" | "both",
  ): Promise<RewindAgentPayload> {
    const payload = await this.transport.request({
      message: { type: "agent.rewind.request", agentId, messageId, mode },
      responseType: "agent.rewind.response",
      timeout: 15_000,
    });
    if (!payload.ok) {
      throw new Error(payload.error ?? "Agent rewind failed");
    }
    return payload;
  }

  async cancelAgent(agentId: string): Promise<void> {
    await this.transport.request({
      message: { type: "cancel_agent_request", agentId },
      responseType: "cancel_agent_response",
      timeout: 15_000,
    });
  }

  async setAgentMode(agentId: string, modeId: string): Promise<void> {
    const payload = await this.transport.request({
      message: { type: "set_agent_mode_request", agentId, modeId },
      responseType: "set_agent_mode_response",
      timeout: 15_000,
    });
    assertAccepted(payload, "setAgentMode rejected");
  }

  async setAgentModel(
    agentId: string,
    modelId: string | null,
    runtimeProvider?: string | null,
  ): Promise<void> {
    const payload = await this.transport.request({
      message: {
        type: "set_agent_model_request",
        agentId,
        modelId,
        ...(runtimeProvider ? { runtimeProvider } : {}),
      },
      responseType: "set_agent_model_response",
      timeout: 15_000,
    });
    assertAccepted(payload, "setAgentModel rejected");
  }

  async setAgentFeature(agentId: string, featureId: string, value: unknown): Promise<void> {
    const payload = await this.transport.request({
      message: { type: "set_agent_feature_request", agentId, featureId, value },
      responseType: "set_agent_feature_response",
      timeout: 15_000,
    });
    assertAccepted(payload, "setAgentFeature rejected");
  }

  async setAgentThinkingOption(agentId: string, thinkingOptionId: string | null): Promise<void> {
    const payload = await this.transport.request({
      message: { type: "set_agent_thinking_request", agentId, thinkingOptionId },
      responseType: "set_agent_thinking_response",
      timeout: 15_000,
    });
    assertAccepted(payload, "setAgentThinkingOption rejected");
  }
}

function assertAccepted(
  payload: { accepted: boolean; error?: string | null },
  fallback: string,
): void {
  if (!payload.accepted) {
    throw new Error(payload.error ?? fallback);
  }
}

function resolveAgentConfig(options: CreateAgentRequestOptions): AgentSessionConfig {
  const {
    config,
    provider,
    cwd,
    env: _env,
    workspaceId: _workspaceId,
    initialPrompt: _initialPrompt,
    images: _images,
    git: _git,
    worktreeName: _worktreeName,
    requestId: _requestId,
    labels: _labels,
    ...overrides
  } = options;
  const baseConfig: Partial<AgentSessionConfig> = {
    ...(provider ? { provider } : {}),
    ...(cwd ? { cwd } : {}),
    ...overrides,
  };
  const merged = config ? { ...baseConfig, ...config } : baseConfig;
  if (!merged.provider || !merged.cwd) {
    throw new Error("createAgent requires provider and cwd");
  }
  return { ...merged, provider: merged.provider, cwd: merged.cwd };
}
