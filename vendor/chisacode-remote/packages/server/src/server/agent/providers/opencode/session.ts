import { type Event as OpenCodeEvent, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { Logger } from "pino";

import {
  type AgentFeature,
  type AgentMode,
  type AgentPermissionRequest,
  type AgentPermissionResponse,
  type AgentPersistenceHandle,
  type AgentPromptInput,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentRuntimeInfo,
  type AgentSession,
  type AgentSlashCommand,
  type AgentStreamEvent,
  type AgentUsage,
} from "../../agent-sdk-types.js";
import { OpenCodeAbortCoordinator } from "./abort-coordinator.js";
import { OPENCODE_CAPABILITIES } from "./client.js";
import {
  buildOpenCodeModelContextWindowLookup,
  buildOpenCodeModelDefinition,
  buildOpenCodeModelLookupKey,
  extractOpenCodeModelContextWindow,
  isSelectableOpenCodeAgent,
  mapOpenCodeAgentToMode,
  parseOpenCodeModelLookupKey,
  resolveOpenCodeSelectedModelContextWindow,
  type OpenCodeAgentConfig,
} from "./catalog.js";
import { OpenCodeEventStreamController } from "./event-stream.js";
import { OpenCodePermissionController } from "./permission-controller.js";
import { OpenCodeSessionEventBus } from "./session-event-bus.js";
import { OpenCodeSessionRuntime } from "./session-runtime.js";
import {
  buildOpenCodePromptParts,
  buildOpenCodeUserTimelineText,
  OpenCodeTurnExecution,
} from "./turn-execution.js";
import { OpenCodeSessionLifecycle, reconcileOpenCodeSessionClose } from "./session-lifecycle.js";
import { OpenCodeMcpController } from "./mcp-controller.js";
import {
  hasNormalizedOpenCodeUsage,
  maxFiniteNumber,
  mergeOpenCodeStepFinishUsage,
  resolveOpenCodeModelLookupKeyFromAssistantMessage,
  translateOpenCodeEvent,
  type OpenCodeMessageRole,
  type OpenCodeSubAgentActivityState,
  type OpenCodeToolPartEventPart,
} from "./event-translator.js";
import { isOpenCodeAutoAcceptEnabled } from "./helpers.js";
import { revertOpenCodeConversationAndFiles } from "./rewind.js";
import { buildOpenCodeReplayTimelineEvents, filterOpenCodeRevertedMessages } from "./history.js";

export { collectOpenCodePersistedAgentsFromSdk } from "./history.js";

export const __openCodeInternals = {
  buildOpenCodePromptParts,
  buildOpenCodeModelContextWindowLookup,
  buildOpenCodeModelDefinition,
  buildOpenCodeModelLookupKey,
  extractOpenCodeModelContextWindow,
  hasNormalizedOpenCodeUsage,
  mergeOpenCodeStepFinishUsage,
  parseOpenCodeModelLookupKey,
  reconcileOpenCodeSessionClose,
  resolveOpenCodeModelLookupKeyFromAssistantMessage,
  resolveOpenCodeSelectedModelContextWindow,
  isSelectableOpenCodeAgent,
  mapOpenCodeAgentToMode,
  get OpenCodeAgentSession() {
    return OpenCodeAgentSession;
  },
};

interface OpenCodeTraceData {
  turnId?: string;
  [key: string]: unknown;
}

type OpenCodeTraceMessage =
  | "provider.opencode.prompt_async.start"
  | "provider.opencode.prompt_async.response"
  | "provider.opencode.prompt_async.throw"
  | "provider.opencode.subscribe.start"
  | "provider.opencode.subscribe.ready"
  | "provider.opencode.stream.eof"
  | "provider.opencode.turn.fail_eof"
  | "provider.opencode.subscribe.error"
  | "provider.opencode.raw_event"
  | "provider.opencode.event.skip"
  | "provider.opencode.parsed_event"
  | "provider.opencode.parsed_event.skip_active"
  | "provider.opencode.event.terminal"
  | "provider.opencode.finish_foreground_turn"
  | "provider.opencode.event_emit";

export class OpenCodeAgentSession implements AgentSession {
  readonly provider = "opencode" as const;
  readonly capabilities = OPENCODE_CAPABILITIES;

  private readonly config: OpenCodeAgentConfig;
  private readonly client: OpencodeClient;
  private readonly sessionId: string;
  private readonly logger: Logger;
  private readonly sessionRuntime: OpenCodeSessionRuntime;
  private readonly permissionController: OpenCodePermissionController;
  private readonly abortCoordinator: OpenCodeAbortCoordinator;
  private accumulatedUsage: AgentUsage = {};
  private sessionTotalCostUsd: number | undefined;
  private readonly mcpController: OpenCodeMcpController;
  /** Tracks the role of each message by ID to distinguish user from assistant messages */
  private messageRoles = new Map<string, OpenCodeMessageRole>();
  private pendingUserMessageText: string | null = null;
  private emittedUserMessageIds = new Set<string>();
  /** Tracks streamed textual part IDs to suppress final full-text echoes from OpenCode. */
  private streamedPartKeys = new Set<string>();
  /** Tracks assistant messages already emitted from structured payloads. */
  private emittedStructuredMessageIds = new Set<string>();
  /** Tracks the type of each part by ID, learned from message.part.updated events. */
  private partTypes = new Map<string, string>();
  private readonly eventBus: OpenCodeSessionEventBus;
  private subAgentsByCallId = new Map<string, OpenCodeSubAgentActivityState>();
  private subAgentCallIdByChildSessionId = new Map<string, string>();
  private pendingChildToolPartsBySessionId = new Map<string, OpenCodeToolPartEventPart[]>();
  private readonly eventStreamController: OpenCodeEventStreamController;
  private readonly turnExecution: OpenCodeTurnExecution;
  private readonly lifecycle: OpenCodeSessionLifecycle;
  constructor(
    config: OpenCodeAgentConfig,
    client: OpencodeClient,
    sessionId: string,
    logger: Logger,
    modelContextWindowsByModelKey: ReadonlyMap<string, number> = new Map(),
    releaseServer?: () => void,
    persistSession = true,
    private readonly agentId?: string,
    modelPrefix?: string,
  ) {
    this.config = config;
    this.client = client;
    this.sessionId = sessionId;
    this.logger = logger.child({ agentId: this.agentId });
    this.abortCoordinator = new OpenCodeAbortCoordinator({
      client: this.client,
      sessionId: this.sessionId,
      getDirectory: () => this.config.cwd,
      logger: this.logger,
    });
    this.eventBus = new OpenCodeSessionEventBus({
      trace: (message, data) => this.traceOpenCode(message, data),
      onTurnFinished: () => {
        this.pendingUserMessageText = null;
        this.abortCoordinator.clearTurn();
      },
    });
    this.mcpController = new OpenCodeMcpController({
      client: this.client,
      getDirectory: () => this.config.cwd,
    });
    this.permissionController = new OpenCodePermissionController({
      client: this.client,
      getDirectory: () => this.config.cwd,
      logger: this.logger,
      autoAcceptEnabled: isOpenCodeAutoAcceptEnabled(config),
    });
    this.sessionRuntime = new OpenCodeSessionRuntime({
      config: this.config,
      client: this.client,
      sessionId: this.sessionId,
      modelContextWindowsByModelKey,
      modelPrefix,
      setAutoAcceptEnabled: (enabled) => this.permissionController.setAutoAcceptEnabled(enabled),
    });
    this.eventStreamController = new OpenCodeEventStreamController({
      client: this.client,
      sessionId: this.sessionId,
      getDirectory: () => this.config.cwd,
      getActiveTurnId: () => this.eventBus.getActiveTurnId(),
      translateEvent: (event) => this.translateEvent(event),
      trackToolCall: (item) => this.eventBus.trackToolCall(item),
      finishTurn: (event, turnId) => this.eventBus.finish(event, turnId),
      notify: (event, turnId) => this.eventBus.notify(event, turnId),
      trace: (message, data) => this.traceOpenCode(message, data),
      logger: this.logger,
    });
    this.turnExecution = new OpenCodeTurnExecution({
      config: this.config,
      client: this.client,
      sessionId: this.sessionId,
      logger: this.logger,
      abortCoordinator: this.abortCoordinator,
      mcpController: this.mcpController,
      sessionRuntime: this.sessionRuntime,
      eventStreamController: this.eventStreamController,
      eventBus: this.eventBus,
      prepareTranslationState: ({ prompt, contextWindowMaxTokens }) => {
        this.subAgentsByCallId.clear();
        this.subAgentCallIdByChildSessionId.clear();
        this.pendingChildToolPartsBySessionId.clear();
        this.pendingUserMessageText = buildOpenCodeUserTimelineText(prompt);
        this.accumulatedUsage =
          contextWindowMaxTokens !== undefined ? { contextWindowMaxTokens } : {};
      },
      trace: (message, data) => this.traceOpenCode(message, data),
    });
    this.lifecycle = new OpenCodeSessionLifecycle({
      client: this.client,
      sessionId: this.sessionId,
      getDirectory: () => this.config.cwd,
      logger: this.logger,
      persistSession,
      releaseServer,
      closeEventBus: () => this.eventBus.close(),
      closeAbortCoordinator: () => this.abortCoordinator.close(),
      closeEventStream: () => this.eventStreamController.close(),
    });
    this.eventStreamController.start();
  }

  get id(): string | null {
    return this.sessionId;
  }

  get features(): AgentFeature[] {
    return this.sessionRuntime.getFeatures();
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return this.sessionRuntime.getRuntimeInfo();
  }

  async setModel(modelId: string | null): Promise<void> {
    await this.sessionRuntime.setModel(modelId);
  }

  async setThinkingOption(thinkingOptionId: string | null): Promise<void> {
    await this.sessionRuntime.setThinkingOption(thinkingOptionId);
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    return this.turnExecution.run(prompt, options);
  }

  async interrupt(): Promise<void> {
    await this.turnExecution.interrupt();
  }

  async revertBoth(input: { messageId: string }): Promise<void> {
    await revertOpenCodeConversationAndFiles({
      client: this.client,
      sessionId: this.sessionId,
      cwd: this.config.cwd,
      messageId: input.messageId,
    });
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

  private traceOpenCode(msg: OpenCodeTraceMessage, data: OpenCodeTraceData = {}): void {
    this.logger.trace(
      {
        agentId: this.agentId,
        provider: "opencode",
        sessionId: this.sessionId,
        turnId: data.turnId ?? this.eventBus.getActiveTurnId() ?? undefined,
        ...data,
      },
      msg,
    );
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    const sessionResponse = await this.client.session.get({
      sessionID: this.sessionId,
      directory: this.config.cwd,
    });
    const response = await this.client.session.messages({
      sessionID: this.sessionId,
      directory: this.config.cwd,
    });

    if (response.error || !response.data) {
      return;
    }

    const messages = filterOpenCodeRevertedMessages(
      response.data,
      sessionResponse.error ? null : sessionResponse.data?.revert,
    );
    for (const message of messages) {
      for (const event of buildOpenCodeReplayTimelineEvents(message)) {
        yield event;
      }
    }
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return await this.sessionRuntime.getAvailableModes();
  }

  async getCurrentMode(): Promise<string | null> {
    return this.sessionRuntime.getCurrentMode();
  }

  async listCommands(): Promise<AgentSlashCommand[]> {
    return await this.sessionRuntime.listCommands();
  }

  async setMode(modeId: string): Promise<void> {
    await this.sessionRuntime.setMode(modeId);
  }

  async setFeature(featureId: string, value: unknown): Promise<void> {
    await this.sessionRuntime.setFeature(featureId, value);
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return this.permissionController.getPending();
  }

  async respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<void> {
    await this.permissionController.respond(requestId, response);
  }

  describePersistence(): AgentPersistenceHandle | null {
    return this.sessionRuntime.describePersistence();
  }

  async close(): Promise<void> {
    await this.lifecycle.close();
  }

  private async translateEvent(event: OpenCodeEvent): Promise<AgentStreamEvent[]> {
    const translated = translateOpenCodeEvent(event, {
      sessionId: this.sessionId,
      cwd: this.config.cwd,
      messageRoles: this.messageRoles,
      pendingUserMessageText: this.pendingUserMessageText,
      emittedUserMessageIds: this.emittedUserMessageIds,
      accumulatedUsage: this.accumulatedUsage,
      sessionTotalCostUsd: this.sessionTotalCostUsd,
      streamedPartKeys: this.streamedPartKeys,
      emittedStructuredMessageIds: this.emittedStructuredMessageIds,
      partTypes: this.partTypes,
      subAgentsByCallId: this.subAgentsByCallId,
      subAgentCallIdByChildSessionId: this.subAgentCallIdByChildSessionId,
      pendingChildToolPartsBySessionId: this.pendingChildToolPartsBySessionId,
      modelContextWindowsByModelKey: this.sessionRuntime.getModelContextWindowsByModelKey(),
      onAssistantModelContextWindowResolved: (contextWindowMaxTokens) => {
        this.accumulatedUsage.contextWindowMaxTokens = contextWindowMaxTokens;
        this.sessionRuntime.onAssistantModelContextWindowResolved(contextWindowMaxTokens);
      },
    });

    const events: AgentStreamEvent[] = [];
    if (typeof this.accumulatedUsage.totalCostUsd === "number") {
      this.sessionTotalCostUsd = maxFiniteNumber(
        this.sessionTotalCostUsd,
        this.accumulatedUsage.totalCostUsd,
      );
    }

    for (const translatedEvent of translated) {
      if (translatedEvent.type === "permission_requested") {
        const shouldSurface = await this.permissionController.register(translatedEvent.request);
        if (!shouldSurface) {
          continue;
        }
      }
      if (translatedEvent.type === "turn_completed") {
        if (hasNormalizedOpenCodeUsage(this.accumulatedUsage)) {
          translatedEvent.usage = this.accumulatedUsage;
        }
        const contextWindowMaxTokens = this.sessionRuntime.getSelectedModelContextWindowMaxTokens();
        this.accumulatedUsage =
          contextWindowMaxTokens !== undefined ? { contextWindowMaxTokens } : {};
      }
      events.push(translatedEvent);
    }

    return events;
  }
}
