import { promises } from "node:fs";
import {
  type CanUseTool,
  type PermissionMode,
  type Query,
  type SDKMessage,
  type SDKResultMessage,
  type SDKSystemMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";
import {
  CLAUDE_CAPABILITIES,
  type ClaudeAgentConfig,
  type ClaudeAgentSessionOptions,
} from "./client.js";
import { ClaudeSidechainTracker } from "./sidechain-tracker.js";
import type { ClaudeContentChunk } from "./sdk-types-mapping.js";
import {
  ClaudeMessageRouter,
  type ClaudeAutonomousTurnState,
  type ClaudeTurnState,
} from "./message-router.js";
import { ClaudeTimelineAssembler } from "./timeline-assembler.js";
import { ClaudePermissionController } from "./permission-controller.js";
import { ClaudeOptionsBuilder } from "./options-builder.js";
import { ClaudeForegroundTurnController } from "./foreground-turn-controller.js";
import { ClaudeMessageTranslator } from "./message-translator.js";
import { ClaudeSessionIdentityController } from "./session-identity.js";
import { type ClaudeAsyncMessageInput, ClaudeQueryLifecycle } from "./query-lifecycle.js";
import {
  CLAUDE_INTERRUPT_TOOL_USE_PLACEHOLDER as INTERRUPT_TOOL_USE_PLACEHOLDER,
  ClaudeSessionHistory,
} from "./session-history.js";
import { ClaudeToolCallHandler, type ClaudeToolUseCacheEntry } from "./tool-call-handlers.js";
import { buildClaudeFeatures, claudeModelSupportsFastMode } from "./feature-definitions.js";
import { isClaudeTranscriptNoiseText } from "./history-converter.js";
import { appendOrReplaceGrowingAssistantMessage, runProviderTurn } from "../provider-runner.js";
import { realClaudeRewindSdk, revertClaudeConversation, revertClaudeFiles } from "./rewind.js";
import { ClaudeRewindController } from "./rewind-controller.js";

import {
  getAgentStreamEventTurnId,
  type AgentFeature,
  type AgentMetadata,
  type AgentMode,
  type AgentPermissionRequest,
  type AgentPermissionResponse,
  type AgentPersistenceHandle,
  type AgentPromptInput,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentSession,
  type AgentSlashCommand,
  type AgentStreamEvent,
  type AgentTimelineItem,
  type AgentUsage,
  type AgentRuntimeInfo,
} from "../../agent-sdk-types.js";

const DEFAULT_MODES: AgentMode[] = [
  {
    id: "default",
    label: "Always Ask",
    description: "Prompts for permission the first time a tool is used",
  },
  {
    id: "auto",
    label: "Auto mode",
    description: "Uses a model classifier to review permission prompts automatically",
  },
  {
    id: "acceptEdits",
    label: "Accept File Edits",
    description: "Automatically approves edit-focused tools without prompting",
  },
  {
    id: "plan",
    label: "Plan Mode",
    description: "Analyze the codebase without executing tools or edits",
  },
  {
    id: "bypassPermissions",
    label: "Bypass",
    description: "Skip all permission prompts (use with caution)",
  },
];

const VALID_CLAUDE_MODES = new Set(DEFAULT_MODES.map((mode) => mode.id));

type ClaudeThinkingEffort = "low" | "medium" | "high" | "xhigh" | "max";
type ClaudeThinkingOption = ClaudeThinkingEffort | "ultracode";

function isClaudeThinkingEffort(value: string | null | undefined): value is ClaudeThinkingEffort {
  return (
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}
function isClaudeThinkingOption(value: string | null | undefined): value is ClaudeThinkingOption {
  return value === "ultracode" || isClaudeThinkingEffort(value);
}

function isPermissionMode(value: string | undefined): value is PermissionMode {
  return typeof value === "string" && VALID_CLAUDE_MODES.has(value);
}

export class ClaudeAgentSession implements AgentSession {
  readonly provider = "claude" as const;
  readonly capabilities = CLAUDE_CAPABILITIES;

  private readonly config: ClaudeAgentConfig;
  private readonly agentId?: string;
  private readonly persistSession?: boolean;
  private readonly logger: Logger;
  private readonly optionsBuilder: ClaudeOptionsBuilder;
  private readonly queryLifecycle: ClaudeQueryLifecycle;
  private readonly sessionIdentity: ClaudeSessionIdentityController;
  private readonly foregroundTurns: ClaudeForegroundTurnController;
  private currentMode: PermissionMode;
  private planResumeMode: PermissionMode | null = null;
  private availableModes: AgentMode[] = DEFAULT_MODES;
  private readonly permissionController: ClaudePermissionController;
  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private readonly timelineAssembler = new ClaudeTimelineAssembler({
    shouldSuppressAssistantText: (text) =>
      text === INTERRUPT_TOOL_USE_PLACEHOLDER || isClaudeTranscriptNoiseText(text),
  });
  private readonly messageRouter: ClaudeMessageRouter;
  private readonly toolCallHandler: ClaudeToolCallHandler;
  private readonly sidechainTracker: ClaudeSidechainTracker;
  private readonly historyController: ClaudeSessionHistory;
  private readonly rewindController: ClaudeRewindController;
  private readonly messageTranslator: ClaudeMessageTranslator;

  constructor(config: ClaudeAgentConfig, options: ClaudeAgentSessionOptions) {
    this.config = config;
    this.agentId = options.agentId;
    this.persistSession = options.persistSession;
    this.logger = options.logger.child({ agentId: this.agentId });
    this.sessionIdentity = new ClaudeSessionIdentityController({
      config: this.config,
      handle: options.handle,
      logger: this.logger,
    });
    this.optionsBuilder = new ClaudeOptionsBuilder({
      config: this.config,
      launchEnv: options.launchEnv,
      defaults: options.defaults,
      runtimeSettings: options.runtimeSettings,
      persistSession: this.persistSession,
      logger: this.logger,
      resolveBinary: options.resolveBinary,
      getCurrentMode: () => this.currentMode,
      getClaudeSessionId: () => this.sessionIdentity.id,
      getPendingFreshSessionId: () => this.sessionIdentity.pendingFreshId,
      canUseTool: async (toolName, input, requestOptions) =>
        this.handlePermissionRequest(toolName, input, requestOptions),
      captureStderr: (data) => this.captureStderr(data),
    });
    this.queryLifecycle = new ClaudeQueryLifecycle({
      logger: this.logger,
      optionsBuilder: this.optionsBuilder,
      runtimeSettings: options.runtimeSettings,
      launchEnv: options.launchEnv,
      queryFactory: options.queryFactory,
      getTraceContext: () => ({
        agentId: this.agentId,
        provider: "claude",
        sessionId: this.sessionIdentity.id,
        turnId: this.activeForegroundTurnId ?? this.autonomousTurn?.id ?? undefined,
      }),
      onBeforeQueryCreate: () => this.sessionIdentity.beforeQueryCreate(),
      onQueryOptionsBuilt: (input) => this.sessionIdentity.captureQueryOptions(input),
      handleMissingResumedConversation: (message, query) =>
        this.handleMissingResumedConversation(message, query),
      routeMessage: (message) => this.messageRouter.routeMessage(message),
      failActiveTurns: (errorMessage) => this.failActiveTurns(errorMessage),
      onInterruptStarted: () => {
        this.pendingInterruptAbort = true;
      },
    });
    this.permissionController = new ClaudePermissionController({
      getPlanResumeMode: () => this.planResumeMode,
      getModeLabel: (modeId) => DEFAULT_MODES.find((mode) => mode.id === modeId)?.label ?? modeId,
      setMode: (modeId) => this.setMode(modeId),
      emitEvent: (event) => this.pushEvent(event),
      emitToolCall: (item) => this.pushToolCall(item),
    });
    this.toolCallHandler = new ClaudeToolCallHandler({
      getCwd: () => this.config.cwd,
      emitTimeline: (item) => this.enqueueTimeline(item),
      deleteSidechain: (toolUseId) => this.sidechainTracker.delete(toolUseId),
      clearSidechains: () => this.sidechainTracker.clear(),
    });
    this.sidechainTracker = new ClaudeSidechainTracker({
      getToolInput: (toolUseId) => this.toolCallHandler.getToolInput(toolUseId),
    });
    this.rewindController = new ClaudeRewindController({
      getHistoryCandidateUserMessageIds: () =>
        this.historyController.getRewindCandidateUserMessageIds(),
      rewindFiles: (messageId) => this.rewindFilesOnce(messageId),
    });
    this.historyController = new ClaudeSessionHistory({
      getCwd: () => this.config.cwd,
      getSdkEnv: () => this.optionsBuilder.buildSdkEnv(this.config.extra?.claude),
      rememberUserMessageId: (messageId) => this.rewindController.rememberUserMessageId(messageId),
      rememberRewindUserAnchor: (messageId) => this.rewindController.rememberUserAnchor(messageId),
      rememberRewindAssistantAnchor: (messageId) =>
        this.rewindController.rememberAssistantAnchor(messageId),
      handleToolUseStart: (block, target) => this.toolCallHandler.handleToolUseStart(block, target),
      handleToolResult: (block, target) => this.toolCallHandler.handleToolResult(block, target),
      updatePartialEventState: (event) => this.toolCallHandler.updatePartialEventState(event),
    });
    this.messageTranslator = new ClaudeMessageTranslator({
      getSessionId: () => this.sessionIdentity.id,
      captureSessionIdFromMessage: (message) => this.captureSessionIdFromMessage(message),
      handleSystemInit: (message) => this.handleSystemMessage(message),
      handleSidechainMessage: (message, parentToolUseId) =>
        this.sidechainTracker.handleMessage(message, parentToolUseId),
      mapBlocksToTimeline: (content, mapOptions) =>
        this.historyController.mapBlocksToTimeline(content, mapOptions),
      mapPartialEvent: (event, mapOptions) =>
        this.historyController.mapPartialEvent(event, mapOptions),
      getToolName: (toolUseId) => this.toolCallHandler.getToolName(toolUseId),
      rememberUserMessageId: (messageId) => this.rewindController.rememberUserMessageId(messageId),
      hasActiveTurnAssistantText: () => this.activeTurnHasAssistantText,
      buildTurnFailedEvent: (errorMessage) => this.buildTurnFailedEvent(errorMessage),
    });
    this.messageRouter = new ClaudeMessageRouter({
      logger: this.logger,
      getTraceContext: () => ({
        agentId: this.agentId,
        provider: "claude",
        sessionId: this.sessionIdentity.id,
      }),
      notifySubscribers: (event) => this.notifySubscribers(event),
      flushPendingToolCalls: () => this.flushPendingToolCalls(),
      buildTurnFailedEvent: (errorMessage) => this.buildTurnFailedEvent(errorMessage),
      rememberTranscriptProgress: (message, messageId) =>
        this.rewindController.rememberTranscriptProgress(message, messageId),
      translateMessageToEvents: (message, routeOptions) =>
        this.translateMessageToEvents(message, routeOptions),
      assembleTimelineItems: (input) => this.timelineAssembler.consume(input),
    });
    this.foregroundTurns = new ClaudeForegroundTurnController({
      logger: this.logger,
      queryLifecycle: this.queryLifecycle,
      messageRouter: this.messageRouter,
      rewindController: this.rewindController,
      getSessionId: () => this.sessionIdentity.id,
      isClosed: () => this.closed,
      clearRecentStderr: () => this.clearRecentStderr(),
      interruptActiveTurn: () => this.interruptActiveTurn(),
      rejectAllPendingPermissions: (error) => this.rejectAllPendingPermissions(error),
      flushPendingToolCalls: () => this.flushPendingToolCalls(),
      notifySubscribers: (event) => this.notifySubscribers(event),
      emitSubmittedUserMessage: (message, turnId) => this.emitSubmittedUserMessage(message, turnId),
      buildTurnFailedEvent: (errorMessage) => this.buildTurnFailedEvent(errorMessage),
    });
    if (this.sessionIdentity.id) {
      this.historyController.load(this.sessionIdentity.id);
    }

    // Validate mode if provided
    if (config.modeId && !VALID_CLAUDE_MODES.has(config.modeId)) {
      const validModesList = Array.from(VALID_CLAUDE_MODES).join(", ");
      throw new Error(
        `Invalid mode '${config.modeId}' for Claude provider. Valid modes: ${validModesList}`,
      );
    }

    this.currentMode = isPermissionMode(config.modeId) ? config.modeId : "default";
    if (this.currentMode !== "plan") {
      this.planResumeMode = this.currentMode;
    }
  }

  // Compatibility surface for focused tool-stream regression tests.
  get toolUseCache(): ReadonlyMap<string, { input?: AgentMetadata | null }> {
    return this.toolCallHandler.getToolUseCache();
  }

  get toolUseIndexToId(): ReadonlyMap<number, string> {
    return this.toolCallHandler.getToolUseIndexToId();
  }

  get toolUseInputBuffers(): ReadonlyMap<string, string> {
    return this.toolCallHandler.getToolUseInputBuffers();
  }

  buildToolOutput(
    block: ClaudeContentChunk,
    entry: ClaudeToolUseCacheEntry | undefined,
  ): AgentMetadata | undefined {
    return this.toolCallHandler.buildToolOutput(block, entry);
  }

  routeSdkMessageFromPump(message: SDKMessage): void {
    this.messageRouter.routeMessage(message);
  }

  mapPartialEvent(
    event: Parameters<ClaudeSessionHistory["mapPartialEvent"]>[0],
    options?: Parameters<ClaudeSessionHistory["mapPartialEvent"]>[1],
  ): AgentTimelineItem[] {
    return this.historyController.mapPartialEvent(event, options);
  }

  // Compatibility surface for focused query lifecycle regression tests.
  private get query(): Query | null {
    return this.queryLifecycle.getCurrentQuery();
  }

  private set query(query: Query | null) {
    this.queryLifecycle.setCurrentQueryForCompatibility(query);
  }

  private get input(): ClaudeAsyncMessageInput<SDKUserMessage> | null {
    return this.queryLifecycle.getCurrentInput();
  }

  private set input(input: ClaudeAsyncMessageInput<SDKUserMessage> | null) {
    this.queryLifecycle.setCurrentInputForCompatibility(input);
  }

  private get queryRestartNeeded(): boolean {
    return this.queryLifecycle.isRestartNeeded();
  }

  private set queryRestartNeeded(restartNeeded: boolean) {
    this.queryLifecycle.setRestartNeeded(restartNeeded);
  }

  private get closed(): boolean {
    return this.queryLifecycle.isClosed();
  }

  private get activeForegroundTurnId(): string | null {
    return this.messageRouter.getActiveForegroundTurnId();
  }

  private set activeForegroundTurnId(turnId: string | null) {
    this.messageRouter.setActiveForegroundTurnId(turnId);
  }

  private get autonomousTurn(): ClaudeAutonomousTurnState | null {
    return this.messageRouter.getAutonomousTurn();
  }

  private set autonomousTurn(turn: ClaudeAutonomousTurnState | null) {
    this.messageRouter.setAutonomousTurn(turn);
  }

  private get turnState(): ClaudeTurnState {
    return this.messageRouter.getTurnState();
  }

  private set turnState(turnState: ClaudeTurnState) {
    this.messageRouter.setTurnState(turnState);
  }

  // Compatibility surface for focused routing regression tests.
  get nextTurnOrdinal(): number {
    return this.messageRouter.getNextTurnOrdinal();
  }

  set nextTurnOrdinal(ordinal: number) {
    this.messageRouter.setNextTurnOrdinal(ordinal);
  }

  private get pendingInterruptAbort(): boolean {
    return this.messageRouter.isPendingInterruptAbort();
  }

  private set pendingInterruptAbort(pending: boolean) {
    this.messageRouter.setPendingInterruptAbort(pending);
  }

  private get foregroundHasVisibleActivity(): boolean {
    return this.messageRouter.hasForegroundVisibleActivity();
  }

  private set foregroundHasVisibleActivity(visible: boolean) {
    this.messageRouter.setForegroundVisibleActivity(visible);
  }

  private get activeTurnHasAssistantText(): boolean {
    return this.messageRouter.hasActiveTurnAssistantText();
  }

  get id(): string | null {
    return this.sessionIdentity.id;
  }

  get features(): AgentFeature[] {
    return buildClaudeFeatures({
      modelId: this.config.model,
      fastModeEnabled: this.config.featureValues?.fast_mode === true,
    });
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return this.sessionIdentity.getRuntimeInfo(this.currentMode ?? null);
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    const result = await runProviderTurn({
      prompt,
      runOptions: options,
      startTurn: (p, o) => this.startTurn(p, o),
      subscribe: (callback) => this.subscribe(callback),
      getSessionId: () => this.sessionIdentity.id ?? "",
      reduceFinalText: appendOrReplaceGrowingAssistantMessage,
    });

    this.sessionIdentity.rememberRunCompleted(this.currentMode ?? null);

    if (!this.sessionIdentity.id) {
      throw new Error("Session ID not set after run completed");
    }

    return result;
  }

  async startTurn(
    prompt: AgentPromptInput,
    _options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    return this.foregroundTurns.startTurn(prompt);
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async interrupt(): Promise<void> {
    await this.foregroundTurns.interrupt();
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    yield* this.historyController.stream();
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return this.availableModes;
  }

  async getCurrentMode(): Promise<string | null> {
    return this.currentMode ?? null;
  }

  async setMode(modeId: string): Promise<void> {
    // Validate mode
    if (!VALID_CLAUDE_MODES.has(modeId)) {
      const validModesList = Array.from(VALID_CLAUDE_MODES).join(", ");
      throw new Error(
        `Invalid mode '${modeId}' for Claude provider. Valid modes: ${validModesList}`,
      );
    }

    const normalized = isPermissionMode(modeId) ? modeId : "default";
    this.optionsBuilder.assertAutoModeEligible(normalized);
    const previousMode = this.currentMode;
    const activeQuery = await this.ensureQuery();
    await activeQuery.setPermissionMode(normalized);
    if (normalized === "plan") {
      if (previousMode !== "plan") {
        this.planResumeMode = previousMode;
      }
    } else {
      this.planResumeMode = normalized;
    }
    this.currentMode = normalized;
    this.sessionIdentity.invalidateRuntimeInfo();
  }

  async setModel(modelId: string | null): Promise<void> {
    const normalizedModelId =
      typeof modelId === "string" && modelId.trim().length > 0 ? modelId : null;
    const activeQuery = await this.ensureQuery();
    await activeQuery.setModel(normalizedModelId ?? undefined);
    this.config.model = normalizedModelId ?? undefined;
    if (!claudeModelSupportsFastMode(this.config.model) && this.config.featureValues?.fast_mode) {
      await this.applyFastModeFeature(false, activeQuery);
    }
    this.sessionIdentity.recordModelSelection(normalizedModelId);
  }

  async setThinkingOption(thinkingOptionId: string | null): Promise<void> {
    const normalizedThinkingOptionId =
      typeof thinkingOptionId === "string" && thinkingOptionId.trim().length > 0
        ? thinkingOptionId
        : null;

    if (!normalizedThinkingOptionId || normalizedThinkingOptionId === "default") {
      this.config.thinkingOptionId = undefined;
    } else if (isClaudeThinkingOption(normalizedThinkingOptionId)) {
      this.config.thinkingOptionId = normalizedThinkingOptionId;
    } else {
      throw new Error(`Unknown thinking option: ${normalizedThinkingOptionId}`);
    }
    this.queryRestartNeeded = true;
  }

  async setFeature(featureId: string, value: unknown): Promise<void> {
    if (featureId !== "fast_mode") {
      throw new Error(`Unknown Claude feature: ${featureId}`);
    }

    const enabled = Boolean(value);
    if (enabled && !claudeModelSupportsFastMode(this.config.model)) {
      throw new Error(
        `Claude fast mode is not available for model '${this.config.model ?? "default"}'`,
      );
    }

    await this.applyFastModeFeature(enabled);
  }

  private async applyFastModeFeature(enabled: boolean, query?: Query): Promise<void> {
    this.config.featureValues = {
      ...this.config.featureValues,
      fast_mode: enabled,
    };
    const activeQuery = query ?? this.queryLifecycle.getCurrentQuery();
    if (activeQuery) {
      await activeQuery.applyFlagSettings({ fastMode: enabled });
    }
    this.sessionIdentity.invalidateRuntimeInfo();
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return this.permissionController.getPending();
  }

  async respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<void> {
    await this.permissionController.respond(requestId, response);
  }

  describePersistence(): AgentPersistenceHandle | null {
    return this.sessionIdentity.describePersistence();
  }

  async close(): Promise<void> {
    this.logger.trace(
      {
        agentId: this.agentId,
        provider: "claude",
        sessionId: this.sessionIdentity.id,
        turnId: this.activeForegroundTurnId ?? this.autonomousTurn?.id ?? undefined,
        turnState: this.turnState,
        hasQuery: Boolean(this.query),
        hasInput: Boolean(this.input),
        hasActiveForegroundTurnId: Boolean(this.activeForegroundTurnId),
      },
      "provider.claude.session_close.start",
    );
    this.queryLifecycle.beginClose();
    this.rejectAllPendingPermissions(new Error("Claude session closed"));
    this.foregroundTurns.close();
    this.subscribers.clear();
    this.sidechainTracker.clear();
    await this.queryLifecycle.closeTransport();
    if (this.persistSession === false && this.sessionIdentity.id) {
      // Claude Code currently ignores --no-session-persistence outside --print mode
      // (see `claude --help`), so the SDK's persistSession=false is silently dropped
      // in stream-json mode. Sweep the transcript ourselves so ephemeral runs
      // (metadata generator, branch-name generator) don't show up as resumable.
      const historyPath = this.historyController.resolvePath(this.sessionIdentity.id);
      if (historyPath) {
        try {
          await promises.rm(historyPath, { force: true });
        } catch (error) {
          this.logger.warn(
            { err: error, historyPath, claudeSessionId: this.sessionIdentity.id },
            "Failed to delete ephemeral Claude session transcript",
          );
        }
      }
    }
    this.logger.trace(
      {
        agentId: this.agentId,
        provider: "claude",
        sessionId: this.sessionIdentity.id,
        turnState: this.turnState,
      },
      "provider.claude.session_close.complete",
    );
  }

  async listCommands(): Promise<AgentSlashCommand[]> {
    const q = await this.ensureQuery();
    const commands = await q.supportedCommands();
    const commandMap = new Map<string, AgentSlashCommand>();
    for (const cmd of commands) {
      if (!commandMap.has(cmd.name)) {
        commandMap.set(cmd.name, {
          name: cmd.name,
          description: cmd.description,
          argumentHint: cmd.argumentHint,
        });
      }
    }
    const rewindCommand = this.rewindController.getCommand();
    if (!commandMap.has(rewindCommand.name)) {
      commandMap.set(rewindCommand.name, rewindCommand);
    }
    return Array.from(commandMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async revertConversation(input: { messageId: string }): Promise<void> {
    const target = this.rewindController.resolveConversationTarget(input.messageId);
    if (target.kind === "fresh-session") {
      this.startFreshConversationSession();
      return;
    }
    await revertClaudeConversation({
      sdk: realClaudeRewindSdk,
      sessionId: this.sessionIdentity.id,
      messageId: target.messageId,
      setSessionId: (sessionId) => {
        this.rebindConversationSession(sessionId);
      },
    });
  }

  async revertFiles(input: { messageId: string }): Promise<void> {
    await revertClaudeFiles({
      query: await this.ensureQuery(),
      messageId: input.messageId,
    });
  }

  async revertBoth(input: { messageId: string }): Promise<void> {
    await this.revertFiles(input);
    await this.revertConversation(input);
  }

  private async rewindFilesOnce(messageId: string): Promise<{
    canRewind: boolean;
    error?: string;
    filesChanged?: string[];
    insertions?: number;
    deletions?: number;
  }> {
    try {
      const activeQuery = await this.ensureFreshQuery();
      return await activeQuery.rewindFiles(messageId, { dryRun: false });
    } catch (error) {
      // The Claude SDK transport can close after a rewind call.
      // If that happens, mark the query stale so a follow-up attempt uses a fresh query.
      this.queryRestartNeeded = true;
      throw error;
    }
  }

  private async ensureFreshQuery(): Promise<Query> {
    return this.queryLifecycle.ensureFreshQuery();
  }

  private rebindConversationSession(sessionId: string): void {
    const capture = this.sessionIdentity.rebindSession(sessionId);
    this.queryRestartNeeded = true;
    this.historyController.clear();
    this.rewindController.reset();
    this.messageTranslator.resetUserMessageState();
    this.historyController.load(sessionId);
    if (capture.threadStartedSessionId && capture.notice) {
      this.dispatchEvents([
        {
          type: "timeline",
          provider: "claude",
          item: capture.notice,
        },
        {
          type: "thread_started",
          provider: "claude",
          sessionId: capture.threadStartedSessionId,
        },
      ]);
    }
  }

  private startFreshConversationSession(): void {
    this.sessionIdentity.startFreshSession();
    this.queryRestartNeeded = true;
    this.historyController.clear();
    this.rewindController.reset();
    this.messageTranslator.resetUserMessageState();
  }

  private async ensureQuery(): Promise<Query> {
    return this.queryLifecycle.ensureQuery();
  }

  private syncTurnState(reason: string): void {
    this.messageRouter.syncTurnState(reason);
  }

  private buildTurnFailedEvent(
    errorMessage: string,
  ): Extract<AgentStreamEvent, { type: "turn_failed" }> {
    const normalized = errorMessage.trim() || "Claude run failed";
    const exitCodeMatch = normalized.match(/\bcode\s+(\d+)\b/i);
    const code = exitCodeMatch ? exitCodeMatch[1] : undefined;
    const diagnostic = this.getRecentStderrDiagnostic();
    return {
      type: "turn_failed",
      provider: "claude",
      error: normalized,
      ...(code ? { code } : {}),
      ...(diagnostic ? { diagnostic } : {}),
    };
  }

  private captureStderr(data: string): void {
    this.queryLifecycle.captureStderr(data);
  }

  private clearRecentStderr(): void {
    this.queryLifecycle.clearRecentStderr();
  }

  private getRecentStderrDiagnostic(): string | undefined {
    return this.queryLifecycle.getRecentStderrDiagnostic();
  }

  private dispatchEvents(events: AgentStreamEvent[]): void {
    this.messageRouter.dispatchEvents(events);
  }

  private failActiveTurns(errorMessage: string): void {
    this.messageRouter.failActiveTurns(errorMessage);
  }

  private async handleMissingResumedConversation(
    message: SDKMessage,
    activeQuery: Query,
  ): Promise<boolean> {
    const staleResumeError = this.messageTranslator.readMissingResumedConversationError(message);
    if (!staleResumeError) {
      return false;
    }

    this.logger.warn(
      {
        error: staleResumeError,
      },
      "Claude resumed session no longer exists; invalidating persisted session",
    );

    this.failActiveTurns(staleResumeError);
    await this.queryLifecycle.invalidateMissingResume(activeQuery);
    this.sessionIdentity.invalidateMissingResume();
    this.historyController.clear();
    this.autonomousTurn = null;
    this.activeForegroundTurnId = null;
    this.syncTurnState("missing resumed conversation");
    return true;
  }

  private async interruptActiveTurn(): Promise<void> {
    await this.queryLifecycle.interruptActiveTurn();
  }

  private translateMessageToEvents(
    message: SDKMessage,
    options?: {
      suppressAssistantText?: boolean;
      suppressReasoning?: boolean;
    },
  ): AgentStreamEvent[] {
    return this.messageTranslator.translate(message, options);
  }

  private emitSubmittedUserMessage(
    message: Extract<SDKMessage, { type: "user" }>,
    turnId: string,
  ): void {
    const events = this.messageTranslator.translateUserMessage(message);
    if (events.length === 0) {
      return;
    }
    this.foregroundHasVisibleActivity = true;
    for (const event of events) {
      if (event.type === "timeline") {
        this.notifySubscribers({ ...event, turnId });
      } else {
        this.notifySubscribers(event);
      }
    }
  }

  private captureSessionIdFromMessage(message: SDKMessage): {
    threadStartedSessionId: string | null;
    notice: AgentTimelineItem | null;
  } {
    return this.sessionIdentity.captureSessionIdFromMessage(message);
  }

  private handleSystemMessage(message: SDKSystemMessage): {
    threadStartedSessionId: string | null;
    notice: AgentTimelineItem | null;
  } {
    const { capture, permissionMode } = this.sessionIdentity.captureSystemMessage(message);
    if (permissionMode) {
      this.availableModes = DEFAULT_MODES;
      this.currentMode = permissionMode;
      if (this.currentMode !== "plan") {
        this.planResumeMode = this.currentMode;
      }
      this.sessionIdentity.invalidateRuntimeInfo();
    }
    return capture;
  }

  // Compatibility surface for focused usage translation regression tests.
  convertUsage(message: SDKResultMessage, modelUsage?: unknown): AgentUsage | undefined {
    return this.messageTranslator.convertUsage(message, modelUsage);
  }

  private handlePermissionRequest: CanUseTool = async (toolName, input, options) =>
    this.permissionController.handleRequest(toolName, input, options);

  private enqueueTimeline(item: AgentTimelineItem) {
    this.pushEvent({ type: "timeline", item, provider: "claude" });
  }

  private flushPendingToolCalls(): void {
    this.toolCallHandler.flushPendingToolCalls();
  }

  private pushToolCall(
    item: Extract<AgentTimelineItem, { type: "tool_call" }> | null,
    target?: AgentTimelineItem[],
  ) {
    if (!item) {
      return;
    }
    if (target) {
      target.push(item);
      return;
    }
    this.enqueueTimeline(item);
  }

  private pushEvent(event: AgentStreamEvent) {
    this.notifySubscribers(event);
  }

  private notifySubscribers(event: AgentStreamEvent): void {
    const turnId = this.activeForegroundTurnId ?? this.autonomousTurn?.id;
    const tagged = turnId ? { ...event, turnId } : event;
    this.logger.trace(
      {
        agentId: this.agentId,
        provider: "claude",
        sessionId: this.sessionIdentity.id,
        turnId: getAgentStreamEventTurnId(tagged),
        event: tagged,
      },
      "provider.claude.event_emit",
    );
    for (const callback of this.subscribers) {
      try {
        callback(tagged);
      } catch (error) {
        this.logger.warn({ err: error }, "Subscriber callback threw");
      }
    }
  }

  private rejectAllPendingPermissions(error: Error): void {
    this.permissionController.rejectAll(error);
  }
}
