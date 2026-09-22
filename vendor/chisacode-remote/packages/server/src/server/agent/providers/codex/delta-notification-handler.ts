import type { AgentTimelineItem, ToolCallTimelineItem } from "../../agent-sdk-types.js";
import { decodeCodexOutputDeltaChunk } from "./notification-timeline.js";
import { CodexNotificationStreamState } from "./notification-stream-state.js";
import type { CodexDeltaNotification } from "./notifications.js";

const ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN = "\n\n---\n\n";

interface CodexDeltaNotificationHandlerOptions {
  notificationStream: CodexNotificationStreamState;
  resolveSubAgentCallId: (threadId: string | null) => string | null;
  upsertSubAgentItem: (callId: string, itemId: string, item: AgentTimelineItem) => void;
  emitSubAgentActivity: (callId: string, status: ToolCallTimelineItem["status"]) => void;
  emit: (item: AgentTimelineItem) => void;
}

export class CodexDeltaNotificationHandler {
  private readonly notificationStream: CodexNotificationStreamState;
  private readonly resolveSubAgentCallId: (threadId: string | null) => string | null;
  private readonly upsertSubAgentItem: CodexDeltaNotificationHandlerOptions["upsertSubAgentItem"];
  private readonly emitSubAgentActivity: CodexDeltaNotificationHandlerOptions["emitSubAgentActivity"];
  private readonly emit: CodexDeltaNotificationHandlerOptions["emit"];
  private pendingAssistantMessageBoundary = false;

  constructor(options: CodexDeltaNotificationHandlerOptions) {
    this.notificationStream = options.notificationStream;
    this.resolveSubAgentCallId = options.resolveSubAgentCallId;
    this.upsertSubAgentItem = options.upsertSubAgentItem;
    this.emitSubAgentActivity = options.emitSubAgentActivity;
    this.emit = options.emit;
  }

  handle(parsed: CodexDeltaNotification): void {
    if (parsed.kind === "agent_message_delta") {
      this.handleAssistantDelta(parsed);
      return;
    }
    if (parsed.kind === "reasoning_delta") {
      this.handleReasoningDelta(parsed);
      return;
    }
    if (parsed.kind === "exec_command_output_delta") {
      const chunk = parsed.chunk ? decodeCodexOutputDeltaChunk(parsed.chunk) : parsed.chunk;
      this.notificationStream.appendCommandOutput(parsed.callId, chunk);
      return;
    }
    this.notificationStream.appendFileChangeOutput(parsed.itemId, parsed.delta);
  }

  markAssistantMessageBoundary(): void {
    this.pendingAssistantMessageBoundary = true;
  }

  resetTurn(): void {
    this.pendingAssistantMessageBoundary = false;
  }

  private handleAssistantDelta(
    parsed: Extract<CodexDeltaNotification, { kind: "agent_message_delta" }>,
  ): void {
    const { previous, text } = this.notificationStream.appendAssistantDelta(
      parsed.itemId,
      parsed.delta,
    );
    const subAgentCallId = this.resolveSubAgentCallId(parsed.threadId);
    if (subAgentCallId) {
      this.upsertSubAgentItem(subAgentCallId, parsed.itemId, {
        type: "assistant_message",
        messageId: parsed.itemId,
        text,
      });
      this.emitSubAgentActivity(subAgentCallId, "running");
      return;
    }
    const isFirstDeltaForItem = previous.length === 0;
    this.emit({
      type: "assistant_message",
      messageId: parsed.itemId,
      text:
        isFirstDeltaForItem && this.pendingAssistantMessageBoundary
          ? ASSISTANT_MESSAGE_BOUNDARY_MARKDOWN + parsed.delta
          : parsed.delta,
    });
    if (isFirstDeltaForItem) {
      this.pendingAssistantMessageBoundary = false;
    }
  }

  private handleReasoningDelta(
    parsed: Extract<CodexDeltaNotification, { kind: "reasoning_delta" }>,
  ): void {
    const text = this.notificationStream.appendReasoningDelta(parsed.itemId, parsed.delta);
    const subAgentCallId = this.resolveSubAgentCallId(parsed.threadId);
    if (subAgentCallId) {
      this.upsertSubAgentItem(subAgentCallId, parsed.itemId, {
        type: "reasoning",
        text,
      });
      this.emitSubAgentActivity(subAgentCallId, "running");
      return;
    }
    this.emit({ type: "reasoning", text: parsed.delta });
  }
}
