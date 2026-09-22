import {
  type AgentFeature,
  type AgentMode,
  type AgentPermissionRequest,
  type AgentPermissionResponse,
  type AgentPermissionResult,
  type AgentPromptInput,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentRuntimeInfo,
  type AgentSession,
  type AgentSessionConfig,
  type AgentSkill,
  type AgentSlashCommand,
  type AgentStreamEvent,
  type ToolCallTimelineItem,
} from "../../agent-sdk-types.js";
import type { Logger } from "pino";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { renderPromptAttachmentAsText } from "../../prompt-attachments.js";
import {
  CodexAppServerClient,
  parseCodexThreadForkResponse,
  parseCodexThreadRollbackResponse,
  type CodexThreadForkParams,
  type CodexThreadForkResponse,
  type CodexThreadRollbackParams,
  type CodexThreadRollbackResponse,
  type CodexAppServerTraceContext,
} from "./app-server-transport.js";
import { revertCodexConversation } from "./rewind.js";
import { CodexSessionEventBus } from "./session-event-bus.js";
import type { CodexClientLike } from "./client-runtime.js";
import {
  CODEX_APP_SERVER_CAPABILITIES,
  CODEX_PROVIDER,
  type CodexAppServerAgentDeps,
} from "./client.js";
import { CodexUserMessageTurnState } from "./user-message-turn-state.js";
import { CodexContextCompactionState } from "./context-compaction-state.js";
import { CodexDeltaNotificationHandler } from "./delta-notification-handler.js";
import { CodexItemNotificationHandler } from "./item-notification-handler.js";
import {
  cleanupStaleCodexImageAttachments,
  writeCodexImageAttachment,
} from "./image-attachments.js";
import { threadItemToTimeline } from "./history.js";
import type { ParsedCodexNotification } from "./notifications.js";
import { CodexNotificationRouter } from "./notification-router.js";
import { CodexNotificationStreamState } from "./notification-stream-state.js";
import { CodexToolNotificationHandler } from "./tool-notification-handler.js";
import { CodexTurnNotificationHandler } from "./turn-notification-handler.js";
import { CodexThreadBootstrap } from "./thread-bootstrap.js";
import { CodexSessionMetadata } from "./session-metadata.js";
import { CodexSessionHistory } from "./session-history.js";
import { CodexSessionConnection } from "./session-connection.js";
import { CodexSessionRuntime } from "./session-runtime.js";
import { CodexSessionTurnExecution } from "./session-turn-execution.js";
import {
  CodexSessionCommandController,
  type CodexPromptInput,
  type CodexSkillPromptBlock,
} from "./session-commands.js";
import { CodexPermissionController } from "./permission-controller.js";
import { CodexSubAgentTracker } from "./sub-agent-tracker.js";

export { cleanupStaleCodexImageAttachments, threadItemToTimeline };
export { mapCodexPatchNotificationToToolCall } from "./notification-timeline.js";
export { toAgentUsage } from "./turn-notification-handler.js";

export {
  buildCodexAppServerEnv,
  findCodexMicrosoftStoreBinary,
  findDefaultCodexBinary,
} from "./launch.js";

export {
  formatCodexQuestionPrompts,
  mapCodexPlanToToolCall,
  mapCodexQuestionRequestToToolCall,
  normalizeCodexQuestionPrompts,
  planStepsToMarkdown,
} from "./permissions.js";

interface CodexAppServerClientLike extends CodexClientLike {
  forkThread?(params: CodexThreadForkParams): Promise<CodexThreadForkResponse>;
  rollbackThread?(params: CodexThreadRollbackParams): Promise<CodexThreadRollbackResponse>;
}

export { listCodexSkillEntries, listCodexSkills } from "./skills.js";

export { normalizeCodexOutputSchema } from "./turn-config.js";

export async function forkCodexThread(
  client: CodexAppServerClientLike,
  params: CodexThreadForkParams,
): Promise<CodexThreadForkResponse> {
  if (client.forkThread) {
    return client.forkThread(params);
  }
  return parseCodexThreadForkResponse(await client.request("thread/fork", params));
}

export async function rollbackCodexThread(
  client: CodexAppServerClientLike,
  params: CodexThreadRollbackParams,
): Promise<CodexThreadRollbackResponse> {
  if (client.rollbackThread) {
    return client.rollbackThread(params);
  }
  return parseCodexThreadRollbackResponse(await client.request("thread/rollback", params));
}

interface CodexTextElement {
  byteRange: {
    start: number;
    end: number;
  };
  placeholder: string | null;
}

type CodexAppServerUserInput =
  | {
      type: "text";
      text: string;
      text_elements: CodexTextElement[];
    }
  | {
      type: "localImage";
      path: string;
    }
  | CodexSkillPromptBlock;

export async function codexAppServerTurnInputFromPrompt(
  prompt: CodexPromptInput,
  logger: Logger,
): Promise<CodexAppServerUserInput[]> {
  if (typeof prompt === "string") {
    return [toCodexTextInput(prompt)];
  }

  const output: CodexAppServerUserInput[] = [];
  let previousTextBlock = false;
  for (const block of prompt) {
    if (block.type === "text") {
      output.push(toCodexTextInput(block.text));
      previousTextBlock = block.text.length > 0;
      continue;
    }
    if (block.type === "skill") {
      output.push(block);
      previousTextBlock = false;
      continue;
    }
    if (block.type === "image") {
      try {
        const filePath = await writeCodexImageAttachment(block.mimeType, block.data);
        output.push({ type: "localImage", path: filePath });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn({ message }, "Failed to write Codex image attachment");
        output.push({
          ...toCodexTextInput(`User attached image (failed to write temp file): ${message}`),
        });
      }
      previousTextBlock = false;
      continue;
    }
    const attachmentText = renderPromptAttachmentAsText(block);
    output.push(toCodexTextInput(previousTextBlock ? `\n\n${attachmentText}` : attachmentText));
    previousTextBlock = true;
  }
  return output;
}

function toCodexTextInput(text: string): Extract<CodexAppServerUserInput, { type: "text" }> {
  return {
    type: "text",
    text,
    text_elements: [],
  };
}

export class CodexAppServerAgentSession implements AgentSession {
  readonly provider = CODEX_PROVIDER;
  readonly capabilities = CODEX_APP_SERVER_CAPABILITIES;

  private readonly logger: Logger;
  private readonly runtime: CodexSessionRuntime;
  private currentThreadId: string | null = null;
  private readonly connection: CodexSessionConnection;
  private readonly eventBus: CodexSessionEventBus;
  private readonly turnExecution: CodexSessionTurnExecution;
  private readonly permissionController: CodexPermissionController;
  private readonly notificationStream = new CodexNotificationStreamState();
  private readonly notificationRouter: CodexNotificationRouter;
  private readonly deltaNotificationHandler: CodexDeltaNotificationHandler;
  private readonly itemNotificationHandler: CodexItemNotificationHandler;
  private readonly toolNotificationHandler: CodexToolNotificationHandler;
  private readonly turnNotificationHandler: CodexTurnNotificationHandler;
  private readonly threadBootstrap: CodexThreadBootstrap;
  private readonly sessionMetadata: CodexSessionMetadata;
  private readonly sessionHistory: CodexSessionHistory;
  private readonly commandController: CodexSessionCommandController;
  private readonly subAgentTracker = new CodexSubAgentTracker();
  private warnedUnknownNotificationMethods = new Set<string>();
  private warnedInvalidNotificationPayloads = new Set<string>();
  private readonly userMessageTurns = new CodexUserMessageTurnState();
  private readonly compactionState = new CodexContextCompactionState();
  constructor(
    config: AgentSessionConfig,
    private readonly resumeHandle: { sessionId: string; metadata?: Record<string, unknown> } | null,
    logger: Logger,
    private readonly spawnAppServer: () => Promise<ChildProcessWithoutNullStreams>,
    private readonly deps: CodexAppServerAgentDeps = {},
    private readonly ephemeral: boolean = false,
    private readonly goalsEnabled: boolean = false,
    private readonly autoReviewEnabled: boolean = false,
    private readonly agentId?: string,
  ) {
    this.logger = logger.child({
      module: "agent",
      provider: CODEX_PROVIDER,
      agentId: this.agentId,
    });
    this.runtime = new CodexSessionRuntime({
      config,
      autoReviewEnabled: this.autoReviewEnabled,
      getThreadId: () => this.currentThreadId,
      isConnected: () => this.connected,
      connect: () => this.connect(),
      ensureThread: () => this.ensureThread(),
      getResolvedCollaborationMode: () => this.sessionMetadata.getResolvedCollaborationMode(),
      hasPlanCollaborationMode: () => this.sessionMetadata.hasPlanCollaborationMode(),
      refreshResolvedCollaborationMode: (planModeEnabled) =>
        this.sessionMetadata.refreshResolvedCollaborationMode(planModeEnabled),
    });
    this.eventBus = new CodexSessionEventBus(this.logger, {
      agentId: this.agentId,
      getSessionId: () => this.currentThreadId,
      getTurnId: () => this.activeForegroundTurnId,
    });
    this.connection = new CodexSessionConnection({
      logger: this.logger,
      spawnAppServer: this.spawnAppServer,
      getTraceContext: () => this.traceContext(),
      onNotification: (method, params) => this.handleNotification(method, params),
      registerRequestHandlers: (client) => this.registerRequestHandlers(client),
      onInitialized: async () => {
        await this.sessionMetadata.loadAll(this.planModeEnabled);
        if (this.currentThreadId) {
          await this.ensureThreadLoaded();
          await this.loadPersistedHistory();
        }
      },
    });
    this.threadBootstrap = new CodexThreadBootstrap({
      logger: this.logger,
      getClient: () => this.client,
      getConfig: () => this.config,
      getThreadId: () => this.currentThreadId,
      setThreadId: (threadId) => {
        this.currentThreadId = threadId;
      },
      getMode: () => this.currentMode,
      setMode: (modeId) => this.runtime.setModeFromBootstrap(modeId),
      invalidateRuntimeInfo: () => this.runtime.invalidateRuntimeInfo(),
      customProvider: this.deps.customProvider,
      customCodexConfig: this.deps.customCodexConfig,
      ephemeral: this.ephemeral,
    });
    this.sessionHistory = new CodexSessionHistory({
      getClient: () => this.client,
      getThreadId: () => this.currentThreadId,
      getCwd: () => this.config.cwd ?? null,
      userMessageTurns: this.userMessageTurns,
    });
    this.sessionMetadata = new CodexSessionMetadata({
      logger: this.logger,
      getClient: () => this.client,
      getConfig: () => this.config,
      getTraceContext: () => this.traceContext(),
      customProvider: this.deps.customProvider,
    });
    this.commandController = new CodexSessionCommandController({
      logger: this.logger,
      getConfig: () => this.config,
      getClient: () => this.client,
      isConnected: () => this.connected,
      connect: () => this.connect(),
      metadata: this.sessionMetadata,
      workspaceGitService: this.deps.workspaceGitService,
      goalsEnabled: this.goalsEnabled,
      getThreadId: () => this.currentThreadId,
      ensureThreadLoaded: () => this.ensureThreadLoaded(),
      ensureThread: () => this.ensureThread(),
      beginManualCompaction: () => this.compactionState.beginManualCompaction(),
      cancelManualCompactionStart: () => this.compactionState.cancelManualCompactionStart(),
    });
    this.turnExecution = new CodexSessionTurnExecution({
      logger: this.logger,
      getClient: () => this.client,
      connect: () => this.connect(),
      getThreadId: () => this.currentThreadId,
      ensureThreadLoaded: () => this.ensureThreadLoaded(),
      ensureThread: () => this.ensureThread(),
      resolvePrompt: (prompt) => this.commandController.resolvePrompt(prompt),
      buildUserInput: (prompt) => this.buildUserInput(prompt),
      getConfig: () => this.config,
      getMode: () => this.currentMode,
      getServiceTier: () => this.serviceTier,
      getCollaborationMode: () => this.sessionMetadata.getResolvedCollaborationMode(),
      getCodexConfig: () => this.threadBootstrap.buildInnerConfig(),
      customProvider: this.deps.customProvider,
      subscribe: (callback) => this.eventBus.subscribe(callback),
      getRuntimeInfo: () => this.runtime.getRuntimeInfo(),
    });
    this.deltaNotificationHandler = new CodexDeltaNotificationHandler({
      notificationStream: this.notificationStream,
      resolveSubAgentCallId: (threadId) => this.getSubAgentCallIdForThread(threadId),
      upsertSubAgentItem: (callId, itemId, item) =>
        this.subAgentTracker.upsertChildItem(callId, itemId, item),
      emitSubAgentActivity: (callId, status) => this.emitSubAgentActivityUpdate(callId, status),
      emit: (item) => this.eventBus.emit({ type: "timeline", provider: CODEX_PROVIDER, item }),
    });
    this.toolNotificationHandler = new CodexToolNotificationHandler({
      logger: this.logger,
      notificationStream: this.notificationStream,
      getCwd: () => this.config.cwd ?? null,
      emit: (item) => this.eventBus.emit({ type: "timeline", provider: CODEX_PROVIDER, item }),
    });
    this.turnNotificationHandler = new CodexTurnNotificationHandler({
      logger: this.logger,
      getAgentId: () => this.agentId,
      getThreadId: () => this.currentThreadId,
      setThreadId: (threadId) => {
        this.currentThreadId = threadId;
      },
      getTurnId: () => this.turnExecution.getCurrentTurnId(),
      getActiveForegroundTurnId: () => this.activeForegroundTurnId,
      setTurnId: (turnId) => this.turnExecution.setCurrentTurnId(turnId),
      clearActiveForegroundTurn: () => this.turnExecution.clearActiveForegroundTurn(),
      isPlanModeEnabled: () => this.planModeEnabled,
      requestPlanApproval: (plan) => this.permissionController.requestPlanApproval(plan),
      resolveSubAgentCallId: (threadId) => this.getSubAgentCallIdForThread(threadId),
      emitSubAgentActivity: (callId, status) => this.emitSubAgentActivityUpdate(callId, status),
      resetExternalTurnState: () => {
        this.notificationStream.resetTurn();
        this.deltaNotificationHandler.resetTurn();
        this.compactionState.resetTurnPairing();
      },
      userMessageTurns: this.userMessageTurns,
      compactionState: this.compactionState,
      emit: (event) => this.eventBus.emit(event),
    });
    this.itemNotificationHandler = new CodexItemNotificationHandler({
      notificationStream: this.notificationStream,
      compactionState: this.compactionState,
      subAgentTracker: this.subAgentTracker,
      userMessageTurns: this.userMessageTurns,
      getCwd: () => this.config.cwd ?? null,
      resolveSubAgentCallId: (threadId) => this.getSubAgentCallIdForThread(threadId),
      emitSubAgentActivity: (callId, status) => this.emitSubAgentActivityUpdate(callId, status),
      rememberTextualToolCallFailure: (text) =>
        this.turnNotificationHandler.rememberTextualToolCallFailure(text),
      rememberPlanResult: (item) => this.turnNotificationHandler.rememberPlanResult(item),
      isPlanModeEnabled: () => this.planModeEnabled,
      markAssistantMessageBoundary: () =>
        this.deltaNotificationHandler.markAssistantMessageBoundary(),
      warnOnIncompleteEdit: (item, source, payload) =>
        this.toolNotificationHandler.warnOnIncompleteEditToolCall(item, source, payload),
      emit: (item) => this.eventBus.emit({ type: "timeline", provider: CODEX_PROVIDER, item }),
    });
    this.permissionController = new CodexPermissionController({
      getCwd: () => this.config.cwd ?? null,
      emit: (event) => this.eventBus.emit(event),
      onPlanApproved: () => this.runtime.applyFeatureValue("plan_mode", false),
    });
    this.notificationRouter = new CodexNotificationRouter({
      onParsed: (method, params, parsed) => this.traceParsedNotification(method, params, parsed),
      onDelta: (parsed) => this.deltaNotificationHandler.handle(parsed),
      onThreadStarted: (parsed) => this.turnNotificationHandler.handleThreadStarted(parsed),
      onTurnStarted: (parsed) => this.turnNotificationHandler.handleTurnStarted(parsed),
      onTurnCompleted: (parsed) => this.turnNotificationHandler.handleTurnCompleted(parsed),
      onPlanUpdated: (parsed) => this.turnNotificationHandler.handlePlanUpdated(parsed),
      onTokenUsageUpdated: (parsed) => this.turnNotificationHandler.handleTokenUsageUpdated(parsed),
      onContextCompacted: (parsed) => this.turnNotificationHandler.handleContextCompacted(parsed),
      onThreadRolledBack: (parsed) => this.turnNotificationHandler.handleThreadRolledBack(parsed),
      onExecCommandStarted: (parsed) =>
        this.toolNotificationHandler.handleExecCommandStarted(parsed),
      onExecCommandCompleted: (parsed) =>
        this.toolNotificationHandler.handleExecCommandCompleted(parsed),
      onTerminalInteraction: (parsed) =>
        this.toolNotificationHandler.handleTerminalInteraction(parsed),
      onPatchApplyStarted: (parsed) => this.toolNotificationHandler.handlePatchApplyStarted(parsed),
      onPatchApplyCompleted: (parsed) =>
        this.toolNotificationHandler.handlePatchApplyCompleted(parsed),
      onItemCompleted: (parsed) => this.itemNotificationHandler.handleCompleted(parsed),
      onItemStarted: (parsed) => this.itemNotificationHandler.handleStarted(parsed),
      onInvalidPayload: (parsed) =>
        this.warnInvalidNotificationPayload(parsed.method, parsed.params),
      onUnknownMethod: (parsed) => this.warnUnknownNotificationMethod(parsed.method, parsed.params),
    });
    if (this.resumeHandle?.sessionId) {
      this.currentThreadId = this.resumeHandle.sessionId;
      this.sessionHistory.markPending();
    }
  }

  get id(): string | null {
    return this.currentThreadId;
  }

  get features(): AgentFeature[] {
    return this.runtime.getFeatures();
  }

  private get config(): AgentSessionConfig {
    return this.runtime.getConfig();
  }

  private get currentMode(): string {
    return this.runtime.getMode();
  }

  private get serviceTier(): "fast" | null {
    return this.runtime.getServiceTier();
  }

  private get planModeEnabled(): boolean {
    return this.runtime.isPlanModeEnabled();
  }

  private get activeForegroundTurnId(): string | null {
    return this.turnExecution.getActiveForegroundTurnId();
  }

  private set activeForegroundTurnId(turnId: string | null) {
    this.turnExecution.setActiveForegroundTurnId(turnId);
  }

  private get client(): CodexAppServerClient | null {
    return this.connection.getClient();
  }

  private set client(client: CodexAppServerClient | null) {
    this.connection.setClient(client);
  }

  private get connected(): boolean {
    return this.connection.isConnected();
  }

  private set connected(connected: boolean) {
    this.connection.setConnected(connected);
  }

  async connect(): Promise<void> {
    await this.connection.connect();
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }

  private traceContext(): CodexAppServerTraceContext {
    return {
      agentId: this.agentId,
      sessionId: this.currentThreadId ?? undefined,
      turnId: this.activeForegroundTurnId ?? undefined,
    };
  }

  private registerRequestHandlers(client: CodexAppServerClient): void {
    client.setRequestHandler("item/commandExecution/requestApproval", (params) =>
      this.handleCommandApprovalRequest(params),
    );
    client.setRequestHandler("item/fileChange/requestApproval", (params) =>
      this.handleFileChangeApprovalRequest(params),
    );
    client.setRequestHandler("item/tool/requestUserInput", (params) =>
      this.handleToolApprovalRequest(params),
    );
    // COMPAT(codex-tool-request-user-input): remove when supported Codex builds only emit item/tool/requestUserInput.
    client.setRequestHandler("tool/requestUserInput", (params) =>
      this.handleToolApprovalRequest(params),
    );
  }

  private loadPersistedHistory(): Promise<void> {
    return this.sessionHistory.load();
  }

  private ensureThreadLoaded(): Promise<void> {
    return this.threadBootstrap.ensureThreadLoaded();
  }

  private ensureThread(): Promise<void> {
    return this.threadBootstrap.ensureThread();
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    return this.turnExecution.run(prompt, options);
  }

  async startTurn(
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    return this.turnExecution.startTurn(prompt, options);
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    return this.eventBus.subscribe(callback);
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    for (const entry of this.sessionHistory.drain()) {
      yield {
        type: "timeline",
        provider: CODEX_PROVIDER,
        item: entry.item,
        timestamp: entry.timestamp,
      };
    }
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return this.runtime.getRuntimeInfo();
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return this.runtime.getAvailableModes();
  }

  async getCurrentMode(): Promise<string | null> {
    return this.runtime.getCurrentMode();
  }

  async setMode(modeId: string): Promise<void> {
    this.runtime.setMode(modeId);
  }

  async setModel(modelId: string | null): Promise<void> {
    this.runtime.setModel(modelId);
  }

  async setThinkingOption(thinkingOptionId: string | null): Promise<void> {
    this.runtime.setThinkingOption(thinkingOptionId);
  }

  async setFeature(featureId: string, value: unknown): Promise<void> {
    this.runtime.setFeature(featureId, value);
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return this.permissionController.getPendingPermissions();
  }

  async respondToPermission(
    requestId: string,
    response: AgentPermissionResponse,
  ): Promise<AgentPermissionResult | void> {
    return this.permissionController.respondToPermission(requestId, response);
  }

  describePersistence(): {
    provider: typeof CODEX_PROVIDER;
    sessionId: string;
    nativeHandle: string;
    metadata: Record<string, unknown>;
  } | null {
    return this.runtime.describePersistence();
  }

  async revertConversation(input: { messageId: string }): Promise<void> {
    await this.connect();
    if (!this.client) {
      throw new Error("Codex client is not initialized");
    }
    if (this.currentThreadId) {
      await this.ensureThreadLoaded();
    } else {
      await this.ensureThread();
    }

    await revertCodexConversation({
      client: this.client,
      threadId: this.currentThreadId,
      messageId: input.messageId,
      cwd: this.config.cwd ?? null,
      model: this.config.model ?? null,
      serviceTier: this.serviceTier,
      userMessageTurns: this.userMessageTurns,
      setThreadId: async (threadId) => {
        this.currentThreadId = threadId;
        this.runtime.invalidateRuntimeInfo();
        this.sessionHistory.reset();
        await this.loadPersistedHistory();
      },
    });
  }

  async interrupt(): Promise<void> {
    await this.turnExecution.interrupt();
  }

  async close(): Promise<void> {
    this.permissionController.cancelAll();
    this.eventBus.clear();
    this.turnExecution.reset();
    await this.connection.close();
    this.runtime.invalidateRuntimeInfo();
    this.currentThreadId = null;
    // Best-effort: clean up image attachments older than the TTL so temp files
    // do not accumulate across long-lived daemon sessions.
    void cleanupStaleCodexImageAttachments();
  }

  async listCommands(): Promise<AgentSlashCommand[]> {
    return this.commandController.listCommands();
  }

  async listSkills(): Promise<AgentSkill[]> {
    return this.commandController.listSkills();
  }

  tryHandleOutOfBand(
    prompt: AgentPromptInput,
  ): { run(ctx: { emit: (event: AgentStreamEvent) => void }): Promise<void> } | null {
    return this.commandController.tryHandleOutOfBand(prompt);
  }

  private async buildUserInput(prompt: CodexPromptInput): Promise<CodexAppServerUserInput[]> {
    if (typeof prompt === "string") {
      return [toCodexTextInput(prompt)];
    }
    return await codexAppServerTurnInputFromPrompt(prompt, this.logger);
  }

  private handleNotification(method: string, params: unknown): void {
    this.notificationRouter.route(method, params);
  }

  private traceParsedNotification(
    method: string,
    params: unknown,
    parsed: ParsedCodexNotification,
  ): void {
    this.logger.trace(
      {
        agentId: this.agentId,
        provider: CODEX_PROVIDER,
        sessionId: this.currentThreadId,
        turnId: this.activeForegroundTurnId ?? undefined,
        method,
        params,
        parsed,
      },
      "provider.codex.parsed_event",
    );
  }

  private getSubAgentCallIdForThread(threadId: string | null | undefined): string | null {
    if (!threadId || threadId === this.currentThreadId) {
      return null;
    }
    return this.subAgentTracker.getCallIdForThread(threadId);
  }

  private emitSubAgentActivityUpdate(
    callId: string,
    status?: ToolCallTimelineItem["status"],
  ): void {
    const item = this.subAgentTracker.buildActivityUpdate(callId, status);
    if (item) {
      this.eventBus.emit({ type: "timeline", provider: CODEX_PROVIDER, item });
    }
  }

  private warnUnknownNotificationMethod(method: string, params: unknown): void {
    if (this.warnedUnknownNotificationMethods.has(method)) {
      return;
    }
    this.warnedUnknownNotificationMethods.add(method);
    this.logger.trace(
      {
        agentId: this.agentId,
        provider: CODEX_PROVIDER,
        sessionId: this.currentThreadId,
        turnId: this.activeForegroundTurnId ?? undefined,
        method,
        params,
      },
      "provider.codex.event_unhandled",
    );
  }

  private warnInvalidNotificationPayload(method: string, params: unknown): void {
    const key = method;
    if (this.warnedInvalidNotificationPayloads.has(key)) {
      return;
    }
    this.warnedInvalidNotificationPayloads.add(key);
    this.logger.warn({ method, params }, "Invalid Codex app-server notification payload");
  }

  private handleCommandApprovalRequest(params: unknown): Promise<unknown> {
    return this.permissionController.handleCommandApprovalRequest(params);
  }

  private handleFileChangeApprovalRequest(params: unknown): Promise<unknown> {
    return this.permissionController.handleFileChangeApprovalRequest(params);
  }

  private handleToolApprovalRequest(params: unknown): Promise<unknown> {
    return this.permissionController.handleToolApprovalRequest(params);
  }
}
