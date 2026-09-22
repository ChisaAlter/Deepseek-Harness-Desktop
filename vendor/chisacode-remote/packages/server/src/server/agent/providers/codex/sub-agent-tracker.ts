import type { AgentTimelineItem, ToolCallTimelineItem } from "../../agent-sdk-types.js";
import { curateAgentActivity } from "../../activity-curator.js";

interface CodexSubAgentCallState {
  toolCall: ToolCallTimelineItem;
  childItemOrder: string[];
  childItems: Map<string, AgentTimelineItem>;
}

/** Tracks Codex child threads and folds their activity into parent sub-agent tool calls. */
export class CodexSubAgentTracker {
  private readonly callsByCallId = new Map<string, CodexSubAgentCallState>();
  private readonly callIdByChildThreadId = new Map<string, string>();

  registerToolCall(timelineItem: ToolCallTimelineItem, rawItem: { [key: string]: unknown }): void {
    if (timelineItem.detail.type !== "sub_agent") {
      return;
    }

    const existing = this.callsByCallId.get(timelineItem.callId);
    const state =
      existing ??
      ({
        toolCall: timelineItem,
        childItemOrder: [],
        childItems: new Map<string, AgentTimelineItem>(),
      } satisfies CodexSubAgentCallState);

    state.toolCall = {
      ...timelineItem,
      detail: {
        ...timelineItem.detail,
        log:
          timelineItem.detail.log ||
          (state.toolCall.detail.type === "sub_agent" ? state.toolCall.detail.log : ""),
      },
    };
    this.callsByCallId.set(timelineItem.callId, state);

    const receiverThreadIds = Array.isArray(rawItem.receiverThreadIds)
      ? rawItem.receiverThreadIds.filter((value): value is string => typeof value === "string")
      : [];
    for (const receiverThreadId of receiverThreadIds) {
      this.callIdByChildThreadId.set(receiverThreadId, timelineItem.callId);
    }
  }

  getCallIdForThread(threadId: string): string | null {
    return this.callIdByChildThreadId.get(threadId) ?? null;
  }

  upsertChildItem(callId: string, itemId: string, item: AgentTimelineItem): void {
    const state = this.callsByCallId.get(callId);
    if (!state) {
      return;
    }
    if (!state.childItems.has(itemId)) {
      state.childItemOrder.push(itemId);
    }
    state.childItems.set(itemId, item);
  }

  buildActivityUpdate(
    callId: string,
    status?: ToolCallTimelineItem["status"],
  ): ToolCallTimelineItem | null {
    const state = this.callsByCallId.get(callId);
    if (!state || state.toolCall.detail.type !== "sub_agent") {
      return null;
    }
    const childTimeline = state.childItemOrder
      .map((itemId) => state.childItems.get(itemId))
      .filter((item): item is AgentTimelineItem => Boolean(item));
    const log =
      childTimeline.length > 0
        ? curateAgentActivity(childTimeline, { labelAssistantMessages: true })
        : "";
    const resolvedStatus = status ?? state.toolCall.status;
    const baseToolCall = {
      ...state.toolCall,
      detail: {
        ...state.toolCall.detail,
        log,
      },
    };
    const nextToolCall: ToolCallTimelineItem =
      resolvedStatus === "failed"
        ? {
            ...baseToolCall,
            status: "failed",
            error: state.toolCall.error ?? { message: "Sub-agent failed" },
          }
        : {
            ...baseToolCall,
            status: resolvedStatus,
            error: null,
          };
    state.toolCall = nextToolCall;
    return nextToolCall;
  }
}
