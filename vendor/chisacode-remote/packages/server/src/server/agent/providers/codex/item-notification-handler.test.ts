import { describe, expect, test } from "vitest";

import type { AgentTimelineItem, ToolCallTimelineItem } from "../../agent-sdk-types.js";
import { CodexContextCompactionState } from "./context-compaction-state.js";
import { CodexItemNotificationHandler } from "./item-notification-handler.js";
import { CodexNotificationStreamState } from "./notification-stream-state.js";
import { CodexSubAgentTracker } from "./sub-agent-tracker.js";
import { CodexUserMessageTurnState } from "./user-message-turn-state.js";

function createHandler() {
  const emitted: AgentTimelineItem[] = [];
  const boundaries: string[] = [];
  const notificationStream = new CodexNotificationStreamState();
  const handler = new CodexItemNotificationHandler({
    notificationStream,
    compactionState: new CodexContextCompactionState(),
    subAgentTracker: new CodexSubAgentTracker(),
    userMessageTurns: new CodexUserMessageTurnState(),
    getCwd: () => "/workspace/project",
    resolveSubAgentCallId: () => null,
    emitSubAgentActivity: () => {},
    rememberTextualToolCallFailure: () => {},
    rememberPlanResult: () => {},
    isPlanModeEnabled: () => false,
    markAssistantMessageBoundary: () => boundaries.push("boundary"),
    warnOnIncompleteEdit: (_item: ToolCallTimelineItem) => {},
    emit: (item) => emitted.push(item),
  });
  return { boundaries, emitted, handler, notificationStream };
}

describe("Codex item notification handler", () => {
  test("deduplicates matching user message start and completion events", () => {
    const { emitted, handler } = createHandler();
    const item = {
      type: "userMessage",
      id: "user-1",
      content: [{ type: "text", text: "Hello" }],
    };

    handler.handleStarted({
      kind: "item_started",
      source: "item",
      threadId: "thread-1",
      item,
    });
    handler.handleCompleted({
      kind: "item_completed",
      source: "item",
      threadId: "thread-1",
      item,
    });

    expect(emitted).toEqual([{ type: "user_message", messageId: "user-1", text: "Hello" }]);
  });

  test("emits compaction loading and completion lifecycle items", () => {
    const { emitted, handler } = createHandler();
    const item = { type: "contextCompaction", id: "compact-1" };

    handler.handleStarted({
      kind: "item_started",
      source: "item",
      threadId: "thread-1",
      item,
    });
    handler.handleCompleted({
      kind: "item_completed",
      source: "item",
      threadId: "thread-1",
      item,
    });

    expect(emitted).toEqual([
      { type: "compaction", status: "loading" },
      { type: "compaction", status: "completed" },
    ]);
  });

  test("emits only the missing assistant suffix after streamed deltas", () => {
    const { boundaries, emitted, handler, notificationStream } = createHandler();
    notificationStream.appendAssistantDelta("assistant-1", "Hello");

    handler.handleCompleted({
      kind: "item_completed",
      source: "item",
      threadId: "thread-1",
      item: {
        id: "assistant-1",
        type: "agentMessage",
        text: "Hello!",
      },
    });

    expect(emitted).toEqual([{ type: "assistant_message", messageId: "assistant-1", text: "!" }]);
    expect(boundaries).toEqual(["boundary"]);
    expect(notificationStream.hasItemCompleted("assistant-1")).toBe(true);
  });
});
