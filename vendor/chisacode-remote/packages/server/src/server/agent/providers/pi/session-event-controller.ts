import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentStreamEvent,
} from "../../agent-sdk-types.js";
import { optionalString } from "./event-values.js";
import type { PiExtensionHistoryController } from "./extension-history-controller.js";
import { getUserMessageText } from "./history-mapper.js";
import {
  buildCombinedAskUserSelectionResponse,
  buildExtensionUiResponse,
  isCombinedAskUserPermission,
  isOptionalInputPlaceholder,
  mapExtensionUiRequestToPermission,
  readActiveAskUserDialog,
  type ActiveAskUserDialog,
  type PendingCombinedAskUserResponse,
} from "./permission-mapper.js";
import type { PiRuntimeSession } from "./runtime.js";
import type { PiAgentMessage, PiAgentSessionEvent, PiRuntimeEvent } from "./rpc-types.js";
import {
  mapToolDetail,
  parseToolArgs,
  parseToolResult,
  resolveToolCallName,
  type PiToolResult,
  type PiTrackedToolCall,
} from "./tool-call-mapper.js";

const PI_PROVIDER = "pi";

type PiTerminalTurnEvent = Extract<
  AgentStreamEvent,
  { type: "turn_completed" | "turn_failed" | "turn_canceled" }
>;

/** Dependencies used by the Pi session event controller. */
export interface PiSessionEventControllerOptions {
  runtimeSession: Pick<PiRuntimeSession, "respondToExtensionUiRequest">;
  extensionHistory: PiExtensionHistoryController;
  emit: (event: AgentStreamEvent) => void;
  getSessionId: () => string;
  resolveTurnError: (messages: PiAgentMessage[]) => string | null;
  onTurnCompleted: (turnId: string | undefined) => void;
}

/** Owns Pi runtime event routing, tool lifecycle, permissions, and active turn state. */
export class PiSessionEventController {
  private readonly activeToolCalls = new Map<string, PiTrackedToolCall>();
  private readonly pendingExtensionUiRequests = new Map<string, AgentPermissionRequest>();
  private activeAskUserDialog: ActiveAskUserDialog | null = null;
  private pendingCombinedAskUserResponse: PendingCombinedAskUserResponse | null = null;
  private currentActiveTurnId: string | null = null;
  private closed = false;
  private readonly finalizedTurnIds = new Set<string>();
  private readonly runtimeSession: Pick<PiRuntimeSession, "respondToExtensionUiRequest">;
  private readonly extensionHistory: PiExtensionHistoryController;
  private readonly emit: (event: AgentStreamEvent) => void;
  private readonly getSessionId: () => string;
  private readonly resolveTurnError: (messages: PiAgentMessage[]) => string | null;
  private readonly onTurnCompleted: (turnId: string | undefined) => void;

  constructor(options: PiSessionEventControllerOptions) {
    this.runtimeSession = options.runtimeSession;
    this.extensionHistory = options.extensionHistory;
    this.emit = options.emit;
    this.getSessionId = options.getSessionId;
    this.resolveTurnError = options.resolveTurnError;
    this.onTurnCompleted = options.onTurnCompleted;
  }

  get activeTurnId(): string | null {
    return this.currentActiveTurnId;
  }

  beginTurn(turnId: string): void {
    if (this.closed) {
      throw new Error("Pi session is closed");
    }
    if (this.currentActiveTurnId) {
      throw new Error("A Pi turn is already active");
    }
    this.finalizedTurnIds.delete(turnId);
    this.currentActiveTurnId = turnId;
  }

  finishTurn(event: PiTerminalTurnEvent): void {
    if (this.closed || !event.turnId || this.finalizedTurnIds.has(event.turnId)) {
      return;
    }
    this.finalizedTurnIds.add(event.turnId);
    if (this.currentActiveTurnId === event.turnId) {
      this.currentActiveTurnId = null;
    }
    this.emit(event);
  }

  clearToolCalls(): void {
    this.activeToolCalls.clear();
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return [...this.pendingExtensionUiRequests.values()];
  }

  async respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<void> {
    const request = this.pendingExtensionUiRequests.get(requestId);
    if (!request) {
      throw new Error(`No pending permission request with id '${requestId}'`);
    }
    this.pendingExtensionUiRequests.delete(requestId);

    if (isCombinedAskUserPermission(request)) {
      const combined = buildCombinedAskUserSelectionResponse(request, response);
      this.pendingCombinedAskUserResponse = combined.pendingResponse;
      this.runtimeSession.respondToExtensionUiRequest(requestId, combined.uiResponse);
    } else {
      this.runtimeSession.respondToExtensionUiRequest(
        requestId,
        buildExtensionUiResponse(request, response),
      );
    }
    this.emit({
      type: "permission_resolved",
      provider: PI_PROVIDER,
      requestId,
      resolution: response,
      turnId: this.currentTurnIdForEvent(),
    });
  }

  handleRuntimeEvent(event: PiRuntimeEvent): void {
    if (this.closed) {
      return;
    }
    if (event.type === "extension_ui_request") {
      this.handleExtensionUiRequest(event);
      return;
    }
    if (event.type === "process_exit") {
      this.handleProcessExit(event.error);
      return;
    }
    this.handleSessionEvent(event);
  }

  close(error: Error, terminalEvent?: PiTerminalTurnEvent): void {
    if (this.closed) {
      return;
    }
    const activeTurnId = this.currentActiveTurnId;
    if (activeTurnId) {
      this.finalizedTurnIds.add(activeTurnId);
      this.currentActiveTurnId = null;
      this.emit(
        terminalEvent ?? {
          type: "turn_canceled",
          provider: PI_PROVIDER,
          turnId: activeTurnId,
          reason: error.message,
        },
      );
    }
    this.closed = true;
    for (const request of this.pendingExtensionUiRequests.values()) {
      try {
        this.runtimeSession.respondToExtensionUiRequest(request.id, { cancelled: true });
      } catch {
        // The runtime may already have lost its transport while the session closes.
      }
    }
    this.pendingExtensionUiRequests.clear();
    this.activeToolCalls.clear();
    this.activeAskUserDialog = null;
    this.pendingCombinedAskUserResponse = null;
    this.currentActiveTurnId = null;
    this.extensionHistory.close(error);
  }

  private currentTurnIdForEvent(): string | undefined {
    return this.currentActiveTurnId ?? undefined;
  }

  private handleExtensionUiRequest(
    event: Extract<PiRuntimeEvent, { type: "extension_ui_request" }>,
  ): void {
    const message = optionalString(event.message);
    if (event.method === "notify" && message) {
      if (this.extensionHistory.handleMarker(message)) {
        return;
      }
    }

    if (this.respondToCombinedAskUserFollowUp(event)) {
      return;
    }

    const shouldCombineOptionalComment =
      event.method === "select" &&
      this.activeAskUserDialog?.allowComment === true &&
      this.activeAskUserDialog.allowMultiple === false;
    const request = mapExtensionUiRequestToPermission(event, {
      combineOptionalComment: shouldCombineOptionalComment,
      allowFreeform: this.activeAskUserDialog?.allowFreeform,
    });
    if (!request) {
      return;
    }

    this.pendingExtensionUiRequests.set(request.id, request);
    this.emit({
      type: "permission_requested",
      provider: PI_PROVIDER,
      request,
      turnId: this.currentTurnIdForEvent(),
    });
  }

  private respondToCombinedAskUserFollowUp(
    event: Extract<PiRuntimeEvent, { type: "extension_ui_request" }>,
  ): boolean {
    const pending = this.pendingCombinedAskUserResponse;
    if (!pending || event.method !== "input") {
      return false;
    }

    const placeholder = optionalString(event.placeholder);
    if (pending.freeform !== null && !isOptionalInputPlaceholder(placeholder)) {
      this.pendingCombinedAskUserResponse = {
        ...pending,
        freeform: null,
      };
      this.runtimeSession.respondToExtensionUiRequest(event.id, { value: pending.freeform });
      return true;
    }

    if (isOptionalInputPlaceholder(placeholder)) {
      this.pendingCombinedAskUserResponse = null;
      this.runtimeSession.respondToExtensionUiRequest(event.id, { value: pending.comment });
      return true;
    }

    return false;
  }

  private handleProcessExit(error: string): void {
    const turnId = this.currentActiveTurnId;
    this.close(
      new Error(error),
      turnId
        ? {
            type: "turn_failed",
            provider: PI_PROVIDER,
            turnId,
            error,
          }
        : undefined,
    );
  }

  private handleSessionEvent(event: PiAgentSessionEvent): void {
    const turnId = this.currentTurnIdForEvent();

    switch (event.type) {
      case "agent_start":
        this.emit({
          type: "thread_started",
          provider: PI_PROVIDER,
          sessionId: this.getSessionId(),
        });
        return;
      case "turn_start":
        this.emit({
          type: "turn_started",
          provider: PI_PROVIDER,
          turnId,
        });
        return;
      case "message_start":
        return;
      case "message_end":
        this.handleMessageEnd(event, turnId);
        return;
      case "message_update":
        this.handleMessageUpdate(event, turnId);
        return;
      case "tool_execution_start":
      case "tool_execution_update":
      case "tool_execution_end":
        this.handleToolExecutionEvent(event);
        return;
      case "compaction_start":
      case "compaction_end":
        this.handleCompactionEvent(event, turnId);
        return;
      case "agent_end":
        this.completeTurn(turnId, event.messages ?? []);
        return;
      default:
        return;
    }
  }

  private handleToolExecutionEvent(
    event: Extract<
      PiAgentSessionEvent,
      { type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end" }
    >,
  ): void {
    if (event.type === "tool_execution_start") {
      const toolCall = parseToolArgs(event.toolName, event.args);
      this.activeToolCalls.set(event.toolCallId, toolCall);
      this.activeAskUserDialog = readActiveAskUserDialog(event.toolName, event.args);
      this.emitToolCallEvent(event.toolCallId, toolCall, "running", null, null);
      return;
    }

    if (event.type === "tool_execution_update") {
      const toolCall = this.activeToolCalls.get(event.toolCallId);
      if (!toolCall) {
        return;
      }
      const partialResult = parseToolResult(event.partialResult);
      this.emitToolCallEvent(event.toolCallId, toolCall, "running", partialResult, null);
      return;
    }

    const toolCall =
      this.activeToolCalls.get(event.toolCallId) ?? parseToolArgs(event.toolName, null);
    this.activeToolCalls.delete(event.toolCallId);

    if (event.toolName === "ask_user") {
      this.activeAskUserDialog = null;
      this.pendingCombinedAskUserResponse = null;
    }

    const result = parseToolResult(event.result);
    const error = event.isError ? event.result : null;
    const status = event.isError ? "failed" : "completed";
    this.emitToolCallEvent(event.toolCallId, toolCall, status, result, error);
  }

  private handleCompactionEvent(
    event: Extract<PiAgentSessionEvent, { type: "compaction_start" | "compaction_end" }>,
    turnId: string | undefined,
  ): void {
    if (event.type === "compaction_start") {
      this.emit({
        type: "timeline",
        provider: PI_PROVIDER,
        turnId,
        item: {
          type: "compaction",
          status: "loading",
          trigger: event.reason === "manual" ? "manual" : "auto",
        },
      });
      return;
    }

    const error = event.errorMessage?.trim();
    let status: "failed" | "completed" = "completed";
    if (event.aborted || error) {
      status = "failed";
    }
    this.emit({
      type: "timeline",
      provider: PI_PROVIDER,
      turnId,
      item: {
        type: "compaction",
        status,
        ...(error ? { error } : {}),
      },
    });
  }

  private handleMessageUpdate(
    event: Extract<PiAgentSessionEvent, { type: "message_update" }>,
    turnId: string | undefined,
  ): void {
    if (event.message.role !== "assistant") {
      return;
    }
    if (event.assistantMessageEvent.type === "text_delta") {
      this.emit({
        type: "timeline",
        provider: PI_PROVIDER,
        turnId,
        item: {
          type: "assistant_message",
          text: event.assistantMessageEvent.delta ?? "",
        },
      });
      return;
    }
    if (event.assistantMessageEvent.type === "thinking_delta") {
      this.emit({
        type: "timeline",
        provider: PI_PROVIDER,
        turnId,
        item: {
          type: "reasoning",
          text: event.assistantMessageEvent.delta ?? "",
        },
      });
    }
  }

  private handleMessageEnd(
    event: Extract<PiAgentSessionEvent, { type: "message_end" }>,
    turnId: string | undefined,
  ): void {
    if (event.message.role !== "user") {
      return;
    }
    const text = getUserMessageText(event.message.content);
    if (!text) {
      return;
    }
    this.extensionHistory.queueUserMessage(text, turnId);
  }

  private emitToolCallEvent(
    toolCallId: string,
    toolCall: PiTrackedToolCall,
    status: "running" | "completed" | "failed",
    result: PiToolResult,
    error: unknown,
  ): void {
    const detail = mapToolDetail(toolCall, result);
    const baseItem = {
      type: "tool_call" as const,
      callId: toolCallId,
      name: resolveToolCallName(toolCall, result),
      detail,
    };
    const item =
      status === "failed" ? { ...baseItem, status, error } : { ...baseItem, status, error: null };
    this.emit({
      type: "timeline",
      provider: PI_PROVIDER,
      turnId: this.currentTurnIdForEvent(),
      item,
    });
  }

  private completeTurn(turnId: string | undefined, messages: PiAgentMessage[]): void {
    if (!turnId || this.finalizedTurnIds.has(turnId)) {
      return;
    }
    const errorMessage = this.resolveTurnError(messages);
    if (typeof errorMessage === "string" && errorMessage.length > 0) {
      this.finishTurn({
        type: "turn_failed",
        provider: PI_PROVIDER,
        turnId,
        error: errorMessage,
      });
      return;
    }
    this.finishTurn({
      type: "turn_completed",
      provider: PI_PROVIDER,
      turnId,
    });
    this.onTurnCompleted(turnId);
  }
}
