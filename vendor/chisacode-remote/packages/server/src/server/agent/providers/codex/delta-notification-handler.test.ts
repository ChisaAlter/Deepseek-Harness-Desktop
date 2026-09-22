import { describe, expect, test } from "vitest";

import type { AgentTimelineItem, ToolCallTimelineItem } from "../../agent-sdk-types.js";
import { CodexDeltaNotificationHandler } from "./delta-notification-handler.js";
import { CodexNotificationStreamState } from "./notification-stream-state.js";

function createHandler(
  resolveSubAgentCallId: (threadId: string | null) => string | null = () => null,
) {
  const emitted: AgentTimelineItem[] = [];
  const subAgentItems: Array<{ callId: string; itemId: string; item: AgentTimelineItem }> = [];
  const subAgentActivities: Array<{ callId: string; status: ToolCallTimelineItem["status"] }> = [];
  const notificationStream = new CodexNotificationStreamState();
  const handler = new CodexDeltaNotificationHandler({
    notificationStream,
    resolveSubAgentCallId,
    upsertSubAgentItem: (callId, itemId, item) => subAgentItems.push({ callId, itemId, item }),
    emitSubAgentActivity: (callId, status) => subAgentActivities.push({ callId, status }),
    emit: (item) => emitted.push(item),
  });
  return { emitted, handler, notificationStream, subAgentActivities, subAgentItems };
}

describe("Codex delta notification handler", () => {
  test("owns assistant message boundary state across streamed items", () => {
    const { emitted, handler } = createHandler();
    handler.markAssistantMessageBoundary();

    handler.handle({
      kind: "agent_message_delta",
      itemId: "assistant-1",
      delta: "First",
      threadId: "thread-1",
    });
    handler.handle({
      kind: "agent_message_delta",
      itemId: "assistant-1",
      delta: " continuation",
      threadId: "thread-1",
    });
    handler.handle({
      kind: "agent_message_delta",
      itemId: "assistant-2",
      delta: "Second",
      threadId: "thread-1",
    });

    expect(emitted).toEqual([
      { type: "assistant_message", messageId: "assistant-1", text: "\n\n---\n\nFirst" },
      { type: "assistant_message", messageId: "assistant-1", text: " continuation" },
      { type: "assistant_message", messageId: "assistant-2", text: "Second" },
    ]);
  });

  test("accumulates sub-agent reasoning without emitting it on the parent timeline", () => {
    const { emitted, handler, subAgentActivities, subAgentItems } = createHandler((threadId) =>
      threadId === "child-thread" ? "sub-agent-1" : null,
    );

    handler.handle({
      kind: "reasoning_delta",
      itemId: "reasoning-1",
      delta: "Think",
      threadId: "child-thread",
    });
    handler.handle({
      kind: "reasoning_delta",
      itemId: "reasoning-1",
      delta: "ing",
      threadId: "child-thread",
    });

    expect(emitted).toEqual([]);
    expect(subAgentItems.at(-1)).toEqual({
      callId: "sub-agent-1",
      itemId: "reasoning-1",
      item: { type: "reasoning", text: "Thinking" },
    });
    expect(subAgentActivities).toEqual([
      { callId: "sub-agent-1", status: "running" },
      { callId: "sub-agent-1", status: "running" },
    ]);
  });

  test("buffers decoded command and file change output deltas", () => {
    const { handler, notificationStream } = createHandler();

    handler.handle({
      kind: "exec_command_output_delta",
      callId: "command-1",
      stream: "stdout",
      chunk: "aGVsbG8=",
    });
    handler.handle({
      kind: "file_change_output_delta",
      itemId: "patch-1",
      delta: "applied",
    });

    expect(notificationStream.consumeCommandOutput("command-1")).toBe("hello");
    expect(notificationStream.consumeFileChangeOutput("patch-1")).toBe("applied");
  });
});
