/**
 * Handles agent interaction and lifecycle mutations: create, delete, archive, cancel,
 * resume, import, rewind, permission responses, runtime configuration, and usage statistics.
 * Read-model queries and live directory subscriptions are owned by AgentDirectoryHandler.
 */

import { randomUUID } from "node:crypto";
import { getErrorMessage, getErrorMessageOr } from "@chisacode/protocol/error-utils";
import {
  type AgentSnapshotPayload,
  type CloseItemsRequest,
  type FirstAgentContext,
  type SessionInboundMessage,
} from "../messages.js";
import {
  archiveAgentCommand,
  cancelAgentRunCommand,
  closeAgentCommand,
  setAgentModeCommand,
  updateAgentCommand,
} from "../agent/lifecycle-command.js";
import { respondToAgentPermission } from "../agent/permission-response.js";
import { importProviderSession, normalizeImportAgentRequest } from "../agent/import-sessions.js";
import { sendPromptToAgent, unarchiveAgentState } from "../agent/agent-prompt.js";
import {
  buildConfigOverrides,
  extractTimestamps,
  isStoredAgentProviderAvailable,
  toAgentPersistenceHandle,
} from "../persistence-hooks.js";
import {
  beginAgentDeleteIfSupported,
  errorToFriendlyMessage,
  resolveWaitForFinishError,
} from "../session-helpers.js";
import type { ManagedAgent } from "../agent/agent-manager.js";
import type {
  AgentPersistenceHandle,
  AgentPermissionResponse,
  AgentSessionConfig,
} from "../agent/agent-sdk-types.js";
import type { StoredAgentRecord } from "../agent/agent-storage.js";
import type { AgentLifecycleHandlerContext, DisposableHandler } from "./session-context.js";
import {
  AgentDirectoryHandler,
  type AgentDirectoryRequestMessage,
} from "./agent-directory-handler.js";
import type { StructuredGenerationDaemonConfig } from "../agent/structured-generation-providers.js";
import { buildAgentPrompt, createAgentCommand } from "../agent/create-agent/create.js";
import type {
  CreateAgentWorkspace,
  CreateAgentSessionWorktreeResult,
} from "../agent/create-agent/create.js";
import { resolveCreateAgentTitles } from "../agent/create-agent-title.js";
import { toWorktreeWireError } from "../worktree-errors.js";
import type { CreateChisaCodeWorktreeWorkflowResult } from "../worktree-session.js";
import { handleModelGatewayRequest } from "../model-gateway/model-gateway.js";
import type { ApplyVisionFallbackParams } from "../agent/vision-fallback.js";
import { buildUsageSummary, exportUsageEvents, pruneUsageEvents } from "../usage/usage-store.js";

/**
 * Runs one create attempt per client-minted agent id at a time.
 *
 * A retried create with the same id arriving while the first attempt is still
 * running awaits it, then re-runs the create body — the serial idempotency
 * check inside it (see `AgentLifecycleHandler.handleCreateAgentRequest`) finds
 * the created agent and emits the retry's own response. Without this, two
 * concurrent attempts could both pass that serial check and create twice.
 */
export class AgentCreateInFlightDedupe {
  private readonly inFlightByAgentId = new Map<string, Promise<unknown>>();

  /**
   * Runs the create, deduping concurrent attempts per agent id.
   * @param agentId The client-minted agent id, if any (daemon-minted ids are never deduped)
   * @param run The create attempt
   * @returns The attempt result
   * @throws When the in-flight attempt failed, or when the re-run attempt fails
   */
  async run<T>(agentId: string | undefined, run: () => Promise<T>): Promise<T> {
    if (!agentId) {
      return run();
    }
    const inFlight = this.inFlightByAgentId.get(agentId);
    if (inFlight) {
      await inFlight;
    } else {
      const attempt = run().finally(() => {
        this.inFlightByAgentId.delete(agentId);
      });
      this.inFlightByAgentId.set(agentId, attempt);
      return attempt;
    }
    // The first attempt settled; run again so the serial idempotency check
    // emits this retry's own response for the now-created agent.
    return run();
  }

  clear(): void {
    this.inFlightByAgentId.clear();
  }
}

export class AgentLifecycleHandler implements DisposableHandler {
  private readonly context: AgentLifecycleHandlerContext;
  private readonly directoryHandler: AgentDirectoryHandler;
  private readonly createInFlightDedupe = new AgentCreateInFlightDedupe();

  constructor(context: AgentLifecycleHandlerContext, directoryHandler: AgentDirectoryHandler) {
    this.context = context;
    this.directoryHandler = directoryHandler;
  }

  dispose(): void {
    this.createInFlightDedupe.clear();
  }

  /** Dispatch an inbound message to the appropriate handler. Returns undefined for unhandled messages. */
  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    return (
      this.directoryHandler.dispatch(msg) ?? this.dispatchReadOps(msg) ?? this.dispatchWriteOps(msg)
    );
  }

  private dispatchReadOps(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "wait_for_finish_request":
        return this.handleWaitForFinish(msg.agentId, msg.requestId, msg.timeoutMs);
      case "agent_permission_response":
        return this.handleAgentPermissionResponse(msg.agentId, msg.requestId, msg.response);
      case "clear_agent_attention":
        return this.handleClearAgentAttention(msg.agentId, msg.requestId);
      case "update_agent_request":
        return this.handleUpdateAgentRequest(
          msg.agentId,
          msg.name,
          msg.labels,
          msg.regenerateTitle,
          msg.requestId,
        );
      case "send_agent_message_request":
        return this.handleSendAgentMessageRequest(msg);
      default:
        return undefined;
    }
  }

  private dispatchWriteOps(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "create_agent_request":
        return this.handleCreateAgentRequest(msg);
      case "delete_agent_request":
        return this.handleDeleteAgentRequest(msg.agentId, msg.requestId);
      case "archive_agent_request":
        return this.handleArchiveAgentRequest(msg.agentId, msg.requestId);
      case "close_items_request":
        return this.handleCloseItemsRequest(msg);
      case "cancel_agent_request":
        return this.handleCancelAgentRequest(msg.agentId, msg.requestId);
      case "resume_agent_request":
        return this.handleResumeAgentRequest(msg);
      case "import_agent_request":
        return this.handleImportAgentRequest(msg);
      case "refresh_agent_request":
        return this.handleRefreshAgentRequest(msg);
      case "agent.rewind.request":
        return this.handleAgentRewindRequest(msg);
      case "usage.summary.get.request":
        return this.handleUsageSummaryGet(msg);
      case "usage.export.request":
        return this.handleUsageExport(msg);
      case "usage.clear.request":
        return this.handleUsageClear(msg);
      case "set_agent_mode_request":
        return this.handleSetAgentModeRequest(msg.agentId, msg.modeId, msg.requestId);
      case "set_agent_model_request":
        return this.handleSetAgentModelRequest(
          msg.agentId,
          msg.modelId,
          msg.requestId,
          msg.runtimeProvider,
        );
      case "set_agent_feature_request":
        return this.handleSetAgentFeatureRequest(
          msg.agentId,
          msg.featureId,
          msg.value,
          msg.requestId,
        );
      case "set_agent_thinking_request":
        return this.handleSetAgentThinkingRequest(msg.agentId, msg.thinkingOptionId, msg.requestId);
      default:
        return undefined;
    }
  }

  // --- Sub-step 2: Handler methods ---

  private async handleSendAgentMessageRequest(
    msg: Extract<SessionInboundMessage, { type: "send_agent_message_request" }>,
  ): Promise<void> {
    const resolved = await this.context.resolveAgentIdentifier(msg.agentId);
    if (!resolved.ok) {
      this.context.emit({
        type: "send_agent_message_response",
        payload: {
          requestId: msg.requestId,
          agentId: msg.agentId,
          accepted: false,
          error: resolved.error,
        },
      });
      return;
    }

    const agentId = resolved.agentId;
    try {
      const prompt = buildAgentPrompt(msg.text, msg.images, msg.attachments);
      this.context.sessionLogger.trace(
        {
          agentId,
          messageId: msg.messageId,
          textPrefix: msg.text.slice(0, 80),
        },
        "agent.session.send_agent_message",
      );

      let dispatchResult: { outOfBand: boolean };
      try {
        dispatchResult = await sendPromptToAgent({
          agentManager: this.context.agentManager,
          agentStorage: this.context.agentStorage,
          agentId,
          prompt,
          messageId: msg.messageId,
          visionFallback: await this.buildVisionFallbackParams(agentId),
          logger: this.context.sessionLogger,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.handleAgentRunError(agentId, error, "Failed to send agent message");
        this.context.emit({
          type: "send_agent_message_response",
          payload: {
            requestId: msg.requestId,
            agentId,
            accepted: false,
            error: message,
          },
        });
        return;
      }

      // Accept immediately after dispatch. Run-start success/failure is reported via
      // agent_state / turn events (forwardTurn emits turn_failed + lifecycle error).
      this.context.emit({
        type: "send_agent_message_response",
        payload: {
          requestId: msg.requestId,
          agentId,
          accepted: true,
          error: null,
          pendingRun: !dispatchResult.outOfBand,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "send_agent_message_response",
        payload: {
          requestId: msg.requestId,
          agentId,
          accepted: false,
          error: errorToFriendlyMessage(error),
        },
      });
    }
  }

  private async handleWaitForFinish(
    agentIdOrIdentifier: string,
    requestId: string,
    timeoutMs?: number,
  ): Promise<void> {
    const resolved = await this.context.resolveAgentIdentifier(agentIdOrIdentifier);
    if (!resolved.ok) {
      this.context.emit({
        type: "wait_for_finish_response",
        payload: {
          requestId,
          status: "error",
          final: null,
          error: resolved.error,
          lastMessage: null,
        },
      });
      return;
    }

    const agentId = resolved.agentId;
    const live = this.context.agentManager.getAgent(agentId);
    if (!live) {
      const record = await this.context.agentStorage.get(agentId);
      if (!record || record.internal) {
        this.context.emit({
          type: "wait_for_finish_response",
          payload: {
            requestId,
            status: "error",
            final: null,
            error: `Agent not found: ${agentId}`,
            lastMessage: null,
          },
        });
        return;
      }
      const final = this.buildStoredAgentPayload(record);
      let status: "permission" | "error" | "idle";
      if (record.attentionReason === "permission") {
        status = "permission";
      } else if (record.lastStatus === "error") {
        status = "error";
      } else {
        status = "idle";
      }
      const error = resolveWaitForFinishError({ status, final });
      this.context.emit({
        type: "wait_for_finish_response",
        payload: { requestId, status, final, error, lastMessage: null },
      });
      return;
    }

    const abortController = new AbortController();
    const hasTimeout = typeof timeoutMs === "number" && timeoutMs > 0;
    const timeoutHandle = hasTimeout
      ? setTimeout(() => {
          abortController.abort("timeout");
        }, timeoutMs)
      : null;

    try {
      let result = await this.context.agentManager.waitForAgentEvent(agentId, {
        signal: abortController.signal,
        waitForActive: true,
      });
      let final = await this.getAgentPayloadById(agentId);
      if (!final) {
        throw new Error(`Agent ${agentId} disappeared while waiting`);
      }

      let status: "permission" | "error" | "idle";
      if (result.permission) {
        status = "permission";
      } else if (result.status === "error") {
        status = "error";
      } else {
        status = "idle";
      }
      const error = resolveWaitForFinishError({ status, final });

      this.context.emit({
        type: "wait_for_finish_response",
        payload: { requestId, status, final, error, lastMessage: result.lastMessage },
      });
    } catch (error) {
      const isAbort =
        error instanceof Error &&
        (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));
      if (!isAbort) {
        const message = errorToFriendlyMessage(error);
        this.context.sessionLogger.error({ err: error, agentId }, "wait_for_finish_request failed");
        const final = await this.getAgentPayloadById(agentId);
        this.context.emit({
          type: "wait_for_finish_response",
          payload: {
            requestId,
            status: "error",
            final,
            error: message,
            lastMessage: null,
          },
        });
        return;
      }

      const final = await this.getAgentPayloadById(agentId);
      if (!final) {
        throw new Error(`Agent ${agentId} disappeared while waiting`, { cause: error });
      }
      this.context.emit({
        type: "wait_for_finish_response",
        payload: { requestId, status: "timeout", final, error: null, lastMessage: null },
      });
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private async handleUpdateAgentRequest(
    agentId: string,
    name: string | undefined,
    labels: Record<string, string> | undefined,
    regenerateTitle: boolean | undefined,
    requestId: string,
  ): Promise<void> {
    this.context.sessionLogger.info(
      {
        agentId,
        requestId,
        hasName: typeof name === "string",
        labelCount: labels ? Object.keys(labels).length : 0,
        regenerateTitle: regenerateTitle === true,
      },
      "session: update_agent_request",
    );

    try {
      const result = await updateAgentCommand(
        {
          agentManager: this.context.agentManager,
          regenerateAgentTitle: async (id) => {
            await this.context.agentManager.regenerateAgentTitle(id, {
              providerSnapshotManager: this.context.providerSnapshotManager,
              workspaceGitService: this.context.workspaceGitService,
              daemonConfig: this.context.readStructuredGenerationDaemonConfig(),
            });
          },
        },
        { agentId, name, labels, regenerateTitle },
      );

      if (!result.accepted) {
        this.context.emit({
          type: "update_agent_response",
          payload: {
            requestId,
            agentId,
            accepted: false,
            error: result.error,
          },
        });
        return;
      }

      this.context.emit({
        type: "update_agent_response",
        payload: { requestId, agentId, accepted: true, error: null },
      });
    } catch (error) {
      this.context.sessionLogger.error(
        { err: error, agentId, requestId },
        "session: update_agent_request error",
      );
      this.context.emit({
        type: "activity_log",
        payload: {
          id: randomUUID(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to update agent: ${getErrorMessage(error)}`,
        },
      });
      this.context.emit({
        type: "update_agent_response",
        payload: {
          requestId,
          agentId,
          accepted: false,
          error: getErrorMessage(error) || "Failed to update agent",
        },
      });
    }
  }

  private async handleClearAgentAttention(
    agentId: string | string[],
    requestId?: string,
  ): Promise<void> {
    const agentIds = Array.isArray(agentId) ? agentId : [agentId];

    try {
      await Promise.all(agentIds.map((id) => this.context.agentManager.clearAgentAttention(id)));
      if (requestId) {
        const agents = (
          await Promise.all(
            agentIds.map(async (id) => {
              const agent = this.context.agentManager.getAgent(id);
              return agent ? this.buildAgentPayload(agent) : null;
            }),
          )
        ).filter((payload): payload is NonNullable<typeof payload> => payload !== null);
        this.context.emit({
          type: "clear_agent_attention_response",
          payload: {
            requestId,
            agentId,
            agents,
          },
        });
      }
    } catch (error) {
      this.context.sessionLogger.error({ err: error, agentIds }, "Failed to clear agent attention");
      // Don't throw - this is not critical
    }
  }

  private async handleAgentPermissionResponse(
    agentId: string,
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<void> {
    try {
      await respondToAgentPermission({
        agentManager: this.context.agentManager,
        agentId,
        requestId,
        response,
        logger: this.context.sessionLogger,
      });
    } catch (error) {
      this.context.sessionLogger.error(
        { err: error, agentId, requestId },
        "Failed to respond to permission",
      );
      this.context.emit({
        type: "activity_log",
        payload: {
          id: randomUUID(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to respond to permission: ${getErrorMessage(error)}`,
        },
      });
      throw error;
    }
  }

  /** Log and emit an error notification for an agent run failure. Called by Session on agent run errors. */
  handleAgentRunError(agentId: string, error: unknown, context: string): void {
    const message = errorToFriendlyMessage(error);
    this.context.sessionLogger.error(
      { err: error, agentId, context },
      `${context} for agent ${agentId}`,
    );
    this.context.emit({
      type: "activity_log",
      payload: {
        id: randomUUID(),
        timestamp: new Date(),
        type: "error",
        content: `${context}: ${message}`,
      },
    });
  }

  // --- State machine helpers ---

  async listFetchAgentsEntries(request: AgentDirectoryRequestMessage) {
    return this.directoryHandler.listFetchAgentsEntries(request);
  }

  private async buildAgentPayload(agent: ManagedAgent): Promise<AgentSnapshotPayload> {
    return this.context.buildAgentPayload(agent) as Promise<AgentSnapshotPayload>;
  }

  private buildStoredAgentPayload(record: StoredAgentRecord): AgentSnapshotPayload {
    return this.context.buildStoredAgentPayload(record) as AgentSnapshotPayload;
  }

  private async getAgentPayloadById(agentId: string): Promise<AgentSnapshotPayload | null> {
    return this.context.getAgentPayloadById(agentId) as Promise<AgentSnapshotPayload | null>;
  }

  private async forwardAgentUpdate(agent: ManagedAgent): Promise<void> {
    await this.directoryHandler.publishAgentUpdate(agent);
  }
  private readStructuredGenerationDaemonConfig(): StructuredGenerationDaemonConfig {
    return {
      metadataGeneration: this.context.daemonConfigStore.get().metadataGeneration,
    };
  }

  private async buildVisionFallbackParams(
    agentId: string,
  ): Promise<Omit<ApplyVisionFallbackParams, "prompt" | "logger"> | undefined> {
    const daemonConfig = this.context.daemonConfigStore.get();
    const visionFallback = daemonConfig.visionFallbackModel ?? null;
    if (!visionFallback) {
      return undefined;
    }

    const agent = this.context.agentManager.getAgent(agentId);
    const provider = agent?.provider ?? agent?.runtimeInfo?.provider;
    const modelId = agent?.runtimeInfo?.model ?? agent?.config?.model ?? null;
    let primarySupportsImages: boolean | undefined;
    if (provider && modelId) {
      try {
        const models = await this.context.providerSnapshotManager.listModels({
          provider,
          cwd: agent?.cwd,
          wait: false,
        });
        const match = models.find((model) => model.id === modelId);
        primarySupportsImages = match?.supportsImages;
      } catch {
        primarySupportsImages = undefined;
      }
    }

    return {
      primarySupportsImages,
      visionFallback,
      modelGateways: daemonConfig.modelGateways,
      requestGateway: ({ gateway, requestBody }) =>
        handleModelGatewayRequest({
          gateway,
          targetFormat: "chatCompletions",
          requestBody,
        }),
    };
  }

  private async registerWorkspaceForImportedAgent(cwd: string): Promise<void> {
    try {
      const workspace = await this.context.findOrCreateWorkspaceForDirectory(cwd);
      await this.context.syncWorkspaceGitObserverForWorkspace(workspace);
      await this.context.describeWorkspaceRecord(workspace);
      await this.context.emitWorkspaceUpdateForCwd(workspace.cwd);
    } catch (error) {
      this.context.sessionLogger.warn(
        { err: error, cwd },
        "Failed to register workspace for imported agent",
      );
    }
  }

  // --- Sub-step 4: create_agent ---

  private async handleCreateAgentRequest(
    msg: Extract<SessionInboundMessage, { type: "create_agent_request" }>,
  ): Promise<void> {
    const { agentId, requestId } = msg;
    try {
      // Dedupe concurrent creates with the same client-minted id (e.g. a retry
      // arriving while the first attempt is still running); the re-run falls
      // into the serial idempotency check inside runCreateAgentRequest, which
      // emits this request's own response for the created agent.
      await this.createInFlightDedupe.run(agentId, () => this.runCreateAgentRequest(msg));
    } catch (error) {
      // Only reachable when an awaited in-flight create failed; the attempt
      // itself already emitted its own failure status.
      const wireError = toWorktreeWireError(error);
      this.context.sessionLogger.error(
        { err: error },
        "Failed to await in-flight agent create for retry",
      );
      if (requestId) {
        this.context.emit({
          type: "status",
          payload: {
            status: "agent_create_failed",
            requestId,
            error: wireError.message,
            errorCode: wireError.code,
          },
        });
      }
    }
  }

  private async runCreateAgentRequest(
    msg: Extract<SessionInboundMessage, { type: "create_agent_request" }>,
  ): Promise<void> {
    const {
      config,
      worktreeName,
      requestId,
      initialPrompt,
      clientMessageId,
      agentId,
      outputSchema,
      git,
      worktree,
      autoArchive,
      images,
      attachments,
      labels,
      relationKind,
      env,
    } = msg;
    this.context.sessionLogger.info(
      { cwd: config.cwd, provider: config.provider, worktreeName, agentId },
      `Creating agent in ${config.cwd} (${config.provider})${
        worktreeName ? ` with worktree ${worktreeName}` : ""
      }`,
    );

    let createdWorktreeForCleanup: CreateChisaCodeWorktreeWorkflowResult | null = null;
    let createdAgentId: string | null = null;
    try {
      // Idempotency for client-minted ids: a retried create with the same
      // agentId (e.g. after a dropped response) must return the existing agent
      // instead of creating a second row. The optimistic sidebar row is keyed by
      // this id, so returning the same agent keeps the UI consistent.
      if (agentId) {
        const existingAgent = this.context.agentManager.getAgent(agentId);
        const existingRecord = existingAgent ? null : await this.context.agentStorage.get(agentId);
        if (existingAgent || existingRecord) {
          this.context.sessionLogger.info(
            { agentId },
            `Create requested for existing agent ${agentId}; returning it`,
          );
          const agentPayload = existingAgent
            ? await this.buildAgentPayload(existingAgent)
            : this.buildStoredAgentPayload(existingRecord!);
          const project = await this.context.buildProjectPlacementForCwd(agentPayload.cwd, {
            refreshGit: false,
            fallback: true,
          });
          if (requestId) {
            this.context.emit({
              type: "status",
              payload: {
                status: "agent_created",
                agentId,
                requestId,
                agent: agentPayload,
                project: project ?? undefined,
                pendingRun: false,
              },
            });
          }
          return;
        }
      }
      const trimmedPrompt = initialPrompt?.trim();
      const { explicitTitle, provisionalTitle } = resolveCreateAgentTitles({
        configTitle: config.title,
        initialPrompt: trimmedPrompt,
      });

      const firstAgentContext: FirstAgentContext = {
        ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      };
      const createdWorktree =
        await this.context.createAgentLifecycleDispatch.createWorktreeForRequest({
          cwd: config.cwd,
          target: worktree,
          firstAgentContext,
          hasLegacyGitOptions: Boolean(git),
        });
      createdWorktreeForCleanup = createdWorktree;
      const createAgentConfig: AgentSessionConfig = createdWorktree
        ? { ...config, cwd: createdWorktree.worktree.worktreePath }
        : config;

      const { snapshot, liveSnapshot } = await createAgentCommand(
        {
          agentManager: this.context.agentManager,
          agentStorage: this.context.agentStorage,
          logger: this.context.sessionLogger,
          chisacodeHome: this.context.chisacodeHome,
          workspaceGitService: this.context.workspaceGitService,
          providerSnapshotManager: this.context.providerSnapshotManager,
          daemonConfig: this.readStructuredGenerationDaemonConfig(),
        },
        {
          kind: "session",
          config: createAgentConfig,
          workspaceId: msg.workspaceId,
          worktreeName,
          initialPrompt,
          clientMessageId,
          agentId,
          outputSchema,
          images,
          attachments,
          git,
          labels,
          relationKind,
          env,
          provisionalTitle,
          explicitTitle,
          firstAgentContext,
          buildSessionConfig: (sessionConfig, gitOptions, legacyWorktreeName, ctx) =>
            this.context.buildAgentSessionConfig(
              sessionConfig,
              gitOptions,
              legacyWorktreeName,
              ctx,
            ) as Promise<CreateAgentSessionWorktreeResult>,
          resolveWorkspace: ({ cwd, workspaceId }) =>
            this.context.resolveCreateAgentWorkspace(
              cwd,
              workspaceId,
            ) as Promise<CreateAgentWorkspace>,
        },
      );
      createdAgentId = snapshot.id;
      await this.forwardAgentUpdate(snapshot);
      this.context.createAgentLifecycleDispatch.registerAutoArchiveIfRequested({
        autoArchive,
        agentId: snapshot.id,
        createdWorktree,
      });

      if (requestId) {
        const agentPayload = await this.buildAgentPayload(liveSnapshot);
        // Attach the workspace project placement so the client can place the
        // created agent under the correct sidebar directory immediately, without
        // waiting for the first agent_update push.
        const project = await this.context.buildProjectPlacementForCwd(agentPayload.cwd, {
          refreshGit: false,
          fallback: true,
        });
        this.context.emit({
          type: "status",
          payload: {
            status: "agent_created",
            agentId: liveSnapshot.id,
            requestId,
            agent: agentPayload,
            project: project ?? undefined,
            // Initial prompt (if any) is dispatched asynchronously after create.
            pendingRun: true,
          },
        });
      }

      this.context.sessionLogger.info(
        { agentId: snapshot.id, provider: snapshot.provider },
        `Created agent ${snapshot.id} (${snapshot.provider})`,
      );
    } catch (error) {
      await this.context.createAgentLifecycleDispatch.cleanupCreatedWorktreeAfterFailedAgentCreate({
        createdWorktree: createdWorktreeForCleanup,
        createdAgentId,
      });
      const wireError = toWorktreeWireError(error);
      this.context.sessionLogger.error({ err: error }, "Failed to create agent");
      if (requestId) {
        this.context.emit({
          type: "status",
          payload: {
            status: "agent_create_failed",
            requestId,
            error: wireError.message,
            errorCode: wireError.code,
          },
        });
      }
      this.context.emit({
        type: "activity_log",
        payload: {
          id: randomUUID(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to create agent: ${wireError.message}`,
        },
      });
    }
  }

  private async handleDeleteAgentRequest(agentId: string, requestId: string): Promise<void> {
    this.context.sessionLogger.info({ agentId }, `Deleting agent ${agentId} from registry`);

    const knownCwd =
      this.context.agentManager.getAgent(agentId)?.cwd ??
      (await this.context.agentStorage.get(agentId))?.cwd ??
      null;

    // File-backed storage still needs an early delete fence before closeAgent().
    beginAgentDeleteIfSupported(this.context.agentStorage, agentId);

    try {
      await closeAgentCommand({ agentManager: this.context.agentManager }, agentId);
    } catch (error) {
      this.context.sessionLogger.warn(
        { err: error, agentId },
        `Failed to close agent ${agentId} during delete`,
      );
    }

    // Drain queued persistence from the just-closed agent before removing its
    // durable snapshot, otherwise an in-flight background write can recreate it.
    await this.context.agentManager.flush();

    try {
      await this.context.agentStorage.remove(agentId);
      await this.context.agentManager.deleteCommittedTimeline(agentId);
    } catch (error) {
      this.context.sessionLogger.error(
        { err: error, agentId },
        `Failed to fully delete agent ${agentId}`,
      );
    }

    this.context.emit({
      type: "agent_deleted",
      payload: {
        agentId,
        requestId,
      },
    });

    this.directoryHandler.publishAgentRemoval(agentId);

    if (knownCwd) {
      await this.context.emitWorkspaceUpdateForCwd(knownCwd);
    }
  }

  private async handleArchiveAgentRequest(agentId: string, requestId: string): Promise<void> {
    this.context.sessionLogger.info({ agentId }, `Archiving agent ${agentId}`);

    const { archivedAt } = await this.archiveAgentForClose(agentId);

    this.context.emit({
      type: "agent_archived",
      payload: {
        agentId,
        archivedAt,
        requestId,
      },
    });
  }

  private async archiveAgentForClose(
    agentId: string,
  ): Promise<{ agentId: string; archivedAt: string }> {
    const { archivedAt, record: archivedRecord } = await archiveAgentCommand(
      {
        agentManager: this.context.agentManager,
        agentStorage: this.context.agentStorage,
        logger: this.context.sessionLogger,
      },
      agentId,
    );

    await this.directoryHandler.publishStoredAgentUpdate(archivedRecord);

    return { agentId, archivedAt };
  }

  private async handleCloseItemsRequest(msg: CloseItemsRequest): Promise<void> {
    const archiveResults = await Promise.allSettled(
      msg.agentIds.map((agentId) => this.archiveAgentForClose(agentId)),
    );
    const agents = [];
    for (let i = 0; i < archiveResults.length; i += 1) {
      const result = archiveResults[i];
      if (result.status === "fulfilled") {
        agents.push(result.value);
      } else {
        this.context.sessionLogger.warn(
          { err: result.reason, agentId: msg.agentIds[i], requestId: msg.requestId },
          "Failed to archive agent during close_items batch",
        );
      }
    }

    const terminals = [];
    for (const terminalId of msg.terminalIds) {
      try {
        terminals.push(this.context.terminalController.killTerminalForClose(terminalId));
      } catch (error) {
        this.context.sessionLogger.warn(
          { err: error, terminalId, requestId: msg.requestId },
          "Failed to kill terminal during close_items batch",
        );
        terminals.push({
          terminalId,
          success: false,
        });
      }
    }

    this.context.emit({
      type: "close_items_response",
      payload: {
        agents,
        terminals,
        requestId: msg.requestId,
      },
    });
  }

  private async unarchiveAgentByHandle(handle: AgentPersistenceHandle): Promise<void> {
    const records = await this.context.agentStorage.list();
    const matched = records.find(
      (record) =>
        record.persistence?.provider === handle.provider &&
        record.persistence?.sessionId === handle.sessionId,
    );
    if (!matched) {
      return;
    }
    await unarchiveAgentState(this.context.agentStorage, this.context.agentManager, matched.id);
  }

  private async handleResumeAgentRequest(
    msg: Extract<SessionInboundMessage, { type: "resume_agent_request" }>,
  ): Promise<void> {
    const { handle, overrides, requestId } = msg;
    if (!handle) {
      this.context.sessionLogger.warn("Resume request missing persistence handle");
      if (requestId) {
        this.context.emit({
          type: "rpc_error",
          payload: {
            requestId,
            requestType: msg.type,
            error: "Unable to resume agent: missing persistence handle",
            code: "agent_resume_failed",
          },
        });
      }
      this.context.emit({
        type: "activity_log",
        payload: {
          id: randomUUID(),
          timestamp: new Date(),
          type: "error",
          content: "Unable to resume agent: missing persistence handle",
        },
      });
      return;
    }
    this.context.sessionLogger.info(
      { sessionId: handle.sessionId, provider: handle.provider },
      `Resuming agent ${handle.sessionId} (${handle.provider})`,
    );
    try {
      await this.unarchiveAgentByHandle(handle);
      const snapshot = await this.context.agentManager.resumeAgentFromPersistence(
        handle,
        overrides,
      );
      await unarchiveAgentState(this.context.agentStorage, this.context.agentManager, snapshot.id);
      await this.context.agentManager.hydrateTimelineFromProvider(snapshot.id);
      await this.forwardAgentUpdate(snapshot);
      const timelineSize = this.context.agentManager.getTimeline(snapshot.id).length;
      if (requestId) {
        const agentPayload = await this.buildAgentPayload(snapshot);
        this.context.emit({
          type: "status",
          payload: {
            status: "agent_resumed",
            agentId: snapshot.id,
            requestId,
            timelineSize,
            agent: agentPayload,
          },
        });
      }
    } catch (error) {
      const message = getErrorMessage(error);
      this.context.sessionLogger.error({ err: error }, "Failed to resume agent");
      if (requestId) {
        this.context.emit({
          type: "rpc_error",
          payload: {
            requestId,
            requestType: msg.type,
            error: message,
            code: "agent_resume_failed",
          },
        });
      }
      this.context.emit({
        type: "activity_log",
        payload: {
          id: randomUUID(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to resume agent: ${message}`,
        },
      });
    }
  }

  private async handleImportAgentRequest(
    msg: Extract<SessionInboundMessage, { type: "import_agent_request" }>,
  ): Promise<void> {
    const normalized = normalizeImportAgentRequest(msg);
    if ("error" in normalized) {
      this.context.emit({
        type: "status",
        payload: {
          status: "agent_create_failed",
          requestId: msg.requestId,
          error: normalized.error,
        },
      });
      return;
    }
    const { provider, providerHandleId, requestId } = normalized;
    this.context.sessionLogger.info(
      { providerHandleId, provider },
      `Importing agent ${providerHandleId} (${provider})`,
    );

    try {
      const { snapshot, timelineSize } = await importProviderSession({
        request: normalized,
        agentManager: this.context.agentManager,
        agentStorage: this.context.agentStorage,
        workspaceGitService: this.context.workspaceGitService,
        providerSnapshotManager: this.context.providerSnapshotManager,
        daemonConfig: this.readStructuredGenerationDaemonConfig(),
        chisacodeHome: this.context.chisacodeHome,
        logger: this.context.sessionLogger,
      });
      await this.registerWorkspaceForImportedAgent(snapshot.cwd);
      await this.forwardAgentUpdate(snapshot);
      const agentPayload = await this.buildAgentPayload(snapshot);
      this.context.emit({
        type: "status",
        payload: {
          status: "agent_resumed",
          agentId: snapshot.id,
          requestId,
          timelineSize,
          agent: agentPayload,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.context.sessionLogger.error({ err: error }, "Failed to import agent");
      this.context.emit({
        type: "status",
        payload: {
          status: "agent_create_failed",
          requestId,
          error: message,
        },
      });
      this.context.emit({
        type: "activity_log",
        payload: {
          id: randomUUID(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to import agent: ${message}`,
        },
      });
    }
  }

  private async handleRefreshAgentRequest(
    msg: Extract<SessionInboundMessage, { type: "refresh_agent_request" }>,
  ): Promise<void> {
    const { agentId, requestId } = msg;
    this.context.sessionLogger.info({ agentId }, `Refreshing agent ${agentId} from persistence`);

    try {
      await unarchiveAgentState(this.context.agentStorage, this.context.agentManager, agentId);
      let snapshot: ManagedAgent;
      const existing = this.context.agentManager.getAgent(agentId);
      if (existing) {
        await this.interruptAgentIfRunning(agentId);
        snapshot = await this.context.agentManager.reloadAgentSession(agentId, undefined, {
          rehydrateFromDisk: true,
        });
      } else {
        const record = await this.context.agentStorage.get(agentId);
        if (!record) {
          throw new Error(`Agent not found: ${agentId}`);
        }
        const registeredProviderIds =
          this.context.providerSnapshotManager.listRegisteredProviderIds();
        if (!isStoredAgentProviderAvailable(record, registeredProviderIds)) {
          throw new Error(`Agent ${agentId} references unavailable provider '${record.provider}'`);
        }
        const handle = toAgentPersistenceHandle(registeredProviderIds, record.persistence);
        if (!handle) {
          throw new Error(`Agent ${agentId} cannot be refreshed because it lacks persistence`);
        }
        snapshot = await this.context.agentManager.resumeAgentFromPersistence(
          handle,
          buildConfigOverrides(record),
          agentId,
          extractTimestamps(record),
        );
      }
      await this.context.agentManager.hydrateTimelineFromProvider(agentId);
      await this.forwardAgentUpdate(snapshot);
      const timelineSize = this.context.agentManager.getTimeline(agentId).length;
      if (requestId) {
        this.context.emit({
          type: "status",
          payload: {
            status: "agent_refreshed",
            agentId,
            requestId,
            timelineSize,
          },
        });
      }
    } catch (error) {
      const message = getErrorMessage(error);
      this.context.sessionLogger.error(
        { err: error, agentId },
        `Failed to refresh agent ${agentId}`,
      );
      if (requestId) {
        this.context.emit({
          type: "rpc_error",
          payload: {
            requestId,
            requestType: msg.type,
            error: message,
            code: "agent_refresh_failed",
          },
        });
      }
      this.context.emit({
        type: "activity_log",
        payload: {
          id: randomUUID(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to refresh agent: ${message}`,
        },
      });
    }
  }

  private async handleCancelAgentRequest(agentId: string, requestId?: string): Promise<void> {
    this.context.sessionLogger.info({ agentId }, `Cancel request received for agent ${agentId}`);

    try {
      await cancelAgentRunCommand(
        { agentManager: this.context.agentManager, logger: this.context.sessionLogger },
        agentId,
      );
      if (requestId) {
        const agent = this.context.agentManager.getAgent(agentId);
        const payload = agent ? await this.buildAgentPayload(agent) : null;
        this.context.emit({
          type: "cancel_agent_response",
          payload: {
            requestId,
            agentId,
            agent: payload,
          },
        });
      }
    } catch (error) {
      this.handleAgentRunError(agentId, error, "Failed to cancel running agent on request");
    }
  }

  private async handleAgentRewindRequest(
    msg: Extract<SessionInboundMessage, { type: "agent.rewind.request" }>,
  ): Promise<void> {
    try {
      await this.context.agentManager.rewind(msg.agentId, msg.messageId, msg.mode);
      this.context.emit({
        type: "agent.rewind.response",
        payload: {
          requestId: msg.requestId,
          agentId: msg.agentId,
          ok: true,
          error: null,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "agent.rewind.response",
        payload: {
          requestId: msg.requestId,
          agentId: msg.agentId,
          ok: false,
          error: error instanceof Error ? error.message : "Failed to rewind agent",
        },
      });
    }
  }

  private async interruptAgentIfRunning(agentId: string): Promise<void> {
    const snapshot = this.context.agentManager.getAgent(agentId);
    if (!snapshot) {
      this.context.sessionLogger.trace({ agentId }, "agent.session.interrupt.not_found");
      throw new Error(`Agent ${agentId} not found`);
    }

    const hasInFlightRun = this.context.agentManager.hasInFlightRun(agentId);
    if (!hasInFlightRun) {
      this.context.sessionLogger.trace(
        {
          agentId,
          provider: snapshot.provider,
          lifecycle: snapshot.lifecycle,
          hasInFlightRun,
        },
        "agent.session.interrupt.skip_not_running",
      );
      return;
    }

    this.context.sessionLogger.debug(
      { agentId, lifecycle: snapshot.lifecycle, hasInFlightRun },
      "interruptAgentIfRunning: interrupting",
    );

    const t0 = Date.now();
    const cancelled = await this.context.agentManager.cancelAgentRun(agentId);
    this.context.sessionLogger.debug(
      { agentId, cancelled, durationMs: Date.now() - t0 },
      "interruptAgentIfRunning: cancelAgentRun completed",
    );
    if (!cancelled) {
      this.context.sessionLogger.warn(
        { agentId },
        "interruptAgentIfRunning: reported running but no active run was cancelled",
      );
    }
  }

  // --- Sub-step 5: Agent Config handlers ---

  private async handleSetAgentModeRequest(
    agentId: string,
    modeId: string,
    requestId: string,
  ): Promise<void> {
    this.context.sessionLogger.info(
      { agentId, modeId, requestId },
      "session: set_agent_mode_request",
    );

    try {
      await setAgentModeCommand({ agentManager: this.context.agentManager }, { agentId, modeId });
      this.context.sessionLogger.info(
        { agentId, modeId, requestId },
        "session: set_agent_mode_request success",
      );
      this.context.emit({
        type: "set_agent_mode_response",
        payload: { requestId, agentId, accepted: true, error: null },
      });
    } catch (error) {
      this.context.sessionLogger.error(
        { err: error, agentId, modeId, requestId },
        "session: set_agent_mode_request error",
      );
      this.context.emit({
        type: "activity_log",
        payload: {
          id: randomUUID(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to set agent mode: ${getErrorMessage(error)}`,
        },
      });
      this.context.emit({
        type: "set_agent_mode_response",
        payload: {
          requestId,
          agentId,
          accepted: false,
          error: getErrorMessageOr(error, "Failed to set agent mode"),
        },
      });
    }
  }

  private async handleSetAgentModelRequest(
    agentId: string,
    modelId: string | null,
    requestId: string,
    runtimeProvider?: string | null,
  ): Promise<void> {
    this.context.sessionLogger.info(
      { agentId, modelId, runtimeProvider, requestId },
      "session: set_agent_model_request",
    );

    try {
      await this.context.agentManager.setAgentModel(agentId, modelId, { runtimeProvider });
      this.context.sessionLogger.info(
        { agentId, modelId, runtimeProvider, requestId },
        "session: set_agent_model_request success",
      );
      this.context.emit({
        type: "set_agent_model_response",
        payload: { requestId, agentId, accepted: true, error: null },
      });
    } catch (error) {
      this.context.sessionLogger.error(
        { err: error, agentId, modelId, runtimeProvider, requestId },
        "session: set_agent_model_request error",
      );
      this.context.emit({
        type: "activity_log",
        payload: {
          id: randomUUID(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to set agent model: ${getErrorMessage(error)}`,
        },
      });
      this.context.emit({
        type: "set_agent_model_response",
        payload: {
          requestId,
          agentId,
          accepted: false,
          error: getErrorMessageOr(error, "Failed to set agent model"),
        },
      });
    }
  }

  private async handleSetAgentFeatureRequest(
    agentId: string,
    featureId: string,
    value: unknown,
    requestId: string,
  ): Promise<void> {
    this.context.sessionLogger.info(
      { agentId, featureId, value, requestId },
      "session: set_agent_feature_request",
    );

    try {
      await this.context.agentManager.setAgentFeature(agentId, featureId, value);
      this.context.sessionLogger.info(
        { agentId, featureId, value, requestId },
        "session: set_agent_feature_request success",
      );
      this.context.emit({
        type: "set_agent_feature_response",
        payload: { requestId, agentId, accepted: true, error: null },
      });
    } catch (error) {
      this.context.sessionLogger.error(
        { err: error, agentId, featureId, value, requestId },
        "session: set_agent_feature_request error",
      );
      this.context.emit({
        type: "activity_log",
        payload: {
          id: randomUUID(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to set agent feature: ${getErrorMessage(error)}`,
        },
      });
      this.context.emit({
        type: "set_agent_feature_response",
        payload: {
          requestId,
          agentId,
          accepted: false,
          error: getErrorMessageOr(error, "Failed to set agent feature"),
        },
      });
    }
  }

  private async handleSetAgentThinkingRequest(
    agentId: string,
    thinkingOptionId: string | null,
    requestId: string,
  ): Promise<void> {
    this.context.sessionLogger.info(
      { agentId, thinkingOptionId, requestId },
      "session: set_agent_thinking_request",
    );

    try {
      await this.context.agentManager.setAgentThinkingOption(agentId, thinkingOptionId);
      this.context.sessionLogger.info(
        { agentId, thinkingOptionId, requestId },
        "session: set_agent_thinking_request success",
      );
      this.context.emit({
        type: "set_agent_thinking_response",
        payload: { requestId, agentId, accepted: true, error: null },
      });
    } catch (error) {
      this.context.sessionLogger.error(
        { err: error, agentId, thinkingOptionId, requestId },
        "session: set_agent_thinking_request error",
      );
      this.context.emit({
        type: "activity_log",
        payload: {
          id: randomUUID(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to set agent thinking option: ${getErrorMessage(error)}`,
        },
      });
      this.context.emit({
        type: "set_agent_thinking_response",
        payload: {
          requestId,
          agentId,
          accepted: false,
          error: getErrorMessageOr(error, "Failed to set agent thinking option"),
        },
      });
    }
  }

  // --- Sub-step 5: Usage handlers ---

  private async listRetainedUsageEvents() {
    if (!this.context.usageStore) {
      return [];
    }
    const records = await this.context.usageStore.list();
    const retained = pruneUsageEvents({ events: records });
    if (retained.length !== records.length) {
      await this.context.usageStore.replace(retained);
    }
    return retained;
  }

  private async handleUsageSummaryGet(
    request: Extract<SessionInboundMessage, { type: "usage.summary.get.request" }>,
  ): Promise<void> {
    try {
      const records = await this.listRetainedUsageEvents();
      this.context.emit({
        type: "usage.summary.get.response",
        payload: {
          requestId: request.requestId,
          summary: buildUsageSummary({
            events: records,
            rangeDays: request.rangeDays,
          }),
        },
      });
    } catch (error) {
      this.context.sessionLogger.error(
        { err: error },
        "Failed to handle usage.summary.get.request",
      );
      this.context.emit({
        type: "rpc_error",
        payload: {
          requestId: request.requestId,
          requestType: request.type,
          error: error instanceof Error ? error.message : "Failed to fetch usage summary",
          code: "usage_summary_failed",
        },
      });
    }
  }

  private async handleUsageExport(
    request: Extract<SessionInboundMessage, { type: "usage.export.request" }>,
  ): Promise<void> {
    try {
      const records = await this.listRetainedUsageEvents();
      this.context.emit({
        type: "usage.export.response",
        payload: {
          requestId: request.requestId,
          format: request.format,
          filename: `chisacode-usage.${request.format}`,
          content: exportUsageEvents(records, request.format),
        },
      });
    } catch (error) {
      this.context.sessionLogger.error({ err: error }, "Failed to handle usage.export.request");
      this.context.emit({
        type: "rpc_error",
        payload: {
          requestId: request.requestId,
          requestType: request.type,
          error: error instanceof Error ? error.message : "Failed to export usage",
          code: "usage_export_failed",
        },
      });
    }
  }

  private async handleUsageClear(
    request: Extract<SessionInboundMessage, { type: "usage.clear.request" }>,
  ): Promise<void> {
    try {
      await this.context.usageStore?.clear();
      this.context.emit({
        type: "usage.clear.response",
        payload: {
          requestId: request.requestId,
          cleared: true,
        },
      });
    } catch (error) {
      this.context.sessionLogger.error({ err: error }, "Failed to handle usage.clear.request");
      this.context.emit({
        type: "rpc_error",
        payload: {
          requestId: request.requestId,
          requestType: request.type,
          error: error instanceof Error ? error.message : "Failed to clear usage",
          code: "usage_clear_failed",
        },
      });
    }
  }
}
