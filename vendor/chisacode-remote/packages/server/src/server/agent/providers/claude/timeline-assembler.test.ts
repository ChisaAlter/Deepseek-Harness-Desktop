import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, test } from "vitest";

import { ClaudeTimelineAssembler } from "./timeline-assembler.js";

function asSdkMessage(message: Record<string, unknown>): SDKMessage {
  return message as unknown as SDKMessage;
}

describe("ClaudeTimelineAssembler", () => {
  test("deduplicates absolute assistant and reasoning content", () => {
    const assembler = new ClaudeTimelineAssembler({
      shouldSuppressAssistantText: () => false,
    });
    const message = asSdkMessage({
      type: "assistant",
      message: {
        id: "message-1",
        content: [
          { type: "thinking", thinking: "Reason carefully." },
          { type: "text", text: "Ship it." },
        ],
      },
    });

    expect(assembler.consume({ message, runId: "run-1" })).toEqual([
      { type: "assistant_message", text: "Ship it.", messageId: "message-1" },
      { type: "reasoning", text: "Reason carefully." },
    ]);
    expect(assembler.consume({ message, runId: "run-1" })).toEqual([]);
  });

  test("applies suppression policy while preserving reasoning and finalization", () => {
    const assembler = new ClaudeTimelineAssembler({
      shouldSuppressAssistantText: (text) => text === "hidden",
    });

    assembler.consume({
      message: asSdkMessage({
        type: "stream_event",
        event: { type: "message_start", message: { id: "message-2" } },
      }),
      runId: "run-2",
    });
    expect(
      assembler.consume({
        message: asSdkMessage({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "text_delta", text: "hidden" },
          },
        }),
        runId: "run-2",
      }),
    ).toEqual([]);
    expect(
      assembler.consume({
        message: asSdkMessage({
          type: "stream_event",
          event: {
            type: "content_block_delta",
            delta: { type: "thinking_delta", thinking: "still visible" },
          },
        }),
        runId: "run-2",
      }),
    ).toEqual([{ type: "reasoning", text: "still visible" }]);

    assembler.consume({
      message: asSdkMessage({
        type: "stream_event",
        event: { type: "message_stop", message_id: "message-2" },
      }),
      runId: "run-2",
    });
    const internals = assembler as unknown as { messages: Map<string, unknown> };
    expect(internals.messages.size).toBe(0);
  });
});
