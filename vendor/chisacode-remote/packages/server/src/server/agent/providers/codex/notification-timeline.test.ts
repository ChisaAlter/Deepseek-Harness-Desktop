import { describe, expect, test } from "vitest";

import type { ToolCallTimelineItem } from "../../agent-sdk-types.js";
import {
  decodeCodexOutputDeltaChunk,
  isEditToolCallWithoutContent,
  mapCodexExecNotificationToToolCall,
  mapCodexTerminalInteractionToToolCall,
} from "./notification-timeline.js";

describe("Codex notification timeline mapping", () => {
  test("unwraps shell commands and maps failed completion output", () => {
    expect(
      mapCodexExecNotificationToToolCall({
        callId: "command-1",
        command: ["/bin/bash", "-lc", "npm test"],
        cwd: "/workspace",
        output: "failed output",
        exitCode: 1,
        stderr: "Command failed",
        running: false,
      }),
    ).toMatchObject({
      type: "tool_call",
      callId: "command-1",
      name: "shell",
      status: "failed",
      error: { message: "Command failed" },
      detail: {
        type: "shell",
        command: "npm test",
      },
    });
  });

  test("decodes canonical base64 output deltas without corrupting plain text", () => {
    expect(decodeCodexOutputDeltaChunk("aGVsbG8=")).toBe("hello");
    expect(decodeCodexOutputDeltaChunk("plain output")).toBe("plain output");
  });

  test("builds stable terminal interaction ids from process ids", () => {
    expect(
      mapCodexTerminalInteractionToToolCall({ processId: "42", command: "npm test" }),
    ).toMatchObject({
      type: "tool_call",
      callId: "terminal-session-42",
      name: "terminal",
      status: "completed",
      metadata: { processId: "42" },
      detail: { type: "plain_text", label: "npm test" },
    });
  });

  test("detects edit timeline items that lack diff or replacement content", () => {
    const incomplete: ToolCallTimelineItem = {
      type: "tool_call",
      callId: "patch-1",
      name: "apply_patch",
      status: "running",
      error: null,
      detail: { type: "edit", filePath: "README.md" },
    };
    const complete: ToolCallTimelineItem = {
      ...incomplete,
      callId: "patch-2",
      detail: {
        type: "edit",
        filePath: "README.md",
        unifiedDiff: "@@ -1 +1 @@\n-old\n+new",
      },
    };

    expect(isEditToolCallWithoutContent(incomplete)).toBe(true);
    expect(isEditToolCallWithoutContent(complete)).toBe(false);
  });
});
