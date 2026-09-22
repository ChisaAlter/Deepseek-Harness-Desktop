import { describe, expect, test } from "vitest";

import type { ToolCallTimelineItem } from "../../agent-sdk-types.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { CodexNotificationStreamState } from "./notification-stream-state.js";
import { CodexToolNotificationHandler } from "./tool-notification-handler.js";

function createHandler(cwd = "/workspace/project") {
  const emitted: ToolCallTimelineItem[] = [];
  const notificationStream = new CodexNotificationStreamState();
  const handler = new CodexToolNotificationHandler({
    logger: createTestLogger(),
    notificationStream,
    getCwd: () => cwd,
    emit: (item) => emitted.push(item),
  });
  return { emitted, handler, notificationStream };
}

describe("Codex tool notification handler", () => {
  test("consumes buffered command output across exec lifecycle notifications", () => {
    const { emitted, handler, notificationStream } = createHandler();

    handler.handleExecCommandStarted({
      kind: "exec_command_started",
      callId: "command-1",
      command: ["/bin/bash", "-lc", "npm test"],
      cwd: null,
    });
    notificationStream.appendCommandOutput("command-1", "test output");
    handler.handleExecCommandCompleted({
      kind: "exec_command_completed",
      callId: "command-1",
      command: ["/bin/bash", "-lc", "npm test"],
      cwd: null,
      output: null,
      exitCode: 0,
      success: true,
      stderr: null,
    });

    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toMatchObject({ callId: "command-1", status: "running" });
    expect(emitted[1]).toMatchObject({
      callId: "command-1",
      status: "completed",
      detail: { type: "shell", command: "npm test" },
    });
    expect(notificationStream.hasExecCommandCompleted("command-1")).toBe(true);
    expect(notificationStream.consumeCommandOutput("command-1")).toBeNull();
  });

  test("correlates a late terminal command with an earlier interaction", () => {
    const { emitted, handler } = createHandler();

    handler.handleTerminalInteraction({
      kind: "terminal_interaction",
      source: "codex_event",
      callId: "interaction-1",
      processId: "42",
      stdin: "continue",
    });
    handler.handleExecCommandCompleted({
      kind: "exec_command_completed",
      callId: "command-2",
      command: "npm run dev",
      cwd: null,
      output: "Process running with session id 42",
      exitCode: null,
      success: true,
      stderr: null,
    });

    expect(emitted).toContainEqual(
      expect.objectContaining({
        callId: "terminal-session-42",
        name: "terminal",
        detail: expect.objectContaining({ type: "plain_text", label: "npm run dev" }),
      }),
    );
  });

  test("maps patch start and completion through the configured cwd", () => {
    const { emitted, handler, notificationStream } = createHandler("/workspace/project");
    const changes = [
      {
        path: "/workspace/project/src/example.ts",
        kind: "modify",
        unified_diff: "@@\n-old\n+new\n",
      },
    ];

    handler.handlePatchApplyStarted({
      kind: "patch_apply_started",
      callId: "patch-1",
      changes,
    });
    notificationStream.appendFileChangeOutput("patch-1", "applied");
    handler.handlePatchApplyCompleted({
      kind: "patch_apply_completed",
      callId: "patch-1",
      changes,
      stdout: null,
      stderr: null,
      success: true,
    });

    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toMatchObject({ callId: "patch-1", status: "running" });
    expect(emitted[1]).toMatchObject({
      callId: "patch-1",
      status: "completed",
      detail: { type: "edit", filePath: "src/example.ts" },
    });
    expect(notificationStream.consumeFileChangeOutput("patch-1")).toBeNull();
  });
});
