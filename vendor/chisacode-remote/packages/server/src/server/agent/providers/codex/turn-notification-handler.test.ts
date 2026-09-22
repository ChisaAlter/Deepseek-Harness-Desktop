import { describe, expect, test } from "vitest";

import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { CodexContextCompactionState } from "./context-compaction-state.js";
import { CodexTurnNotificationHandler } from "./turn-notification-handler.js";
import { CodexUserMessageTurnState } from "./user-message-turn-state.js";

function createHandler(planModeEnabled = false) {
  const emitted: AgentStreamEvent[] = [];
  const approvals: string[] = [];
  let threadId: string | null = "thread-1";
  let turnId: string | null = "turn-1";
  let activeForegroundTurn = true;
  let resets = 0;
  const handler = new CodexTurnNotificationHandler({
    logger: createTestLogger(),
    getAgentId: () => "agent-1",
    getThreadId: () => threadId,
    setThreadId: (value) => {
      threadId = value;
    },
    getTurnId: () => turnId,
    getActiveForegroundTurnId: () => "foreground-turn-1",
    setTurnId: (value) => {
      turnId = value;
    },
    clearActiveForegroundTurn: () => {
      activeForegroundTurn = false;
    },
    isPlanModeEnabled: () => planModeEnabled,
    requestPlanApproval: (text) => approvals.push(text),
    resolveSubAgentCallId: () => null,
    emitSubAgentActivity: () => {},
    resetExternalTurnState: () => {
      resets += 1;
    },
    userMessageTurns: new CodexUserMessageTurnState(),
    compactionState: new CodexContextCompactionState(),
    emit: (event) => emitted.push(event),
  });
  return {
    approvals,
    emitted,
    getActiveForegroundTurn: () => activeForegroundTurn,
    getResets: () => resets,
    handler,
  };
}

describe("Codex turn notification handler", () => {
  test("carries token usage onto successful turn completion", () => {
    const { emitted, getActiveForegroundTurn, handler } = createHandler();
    handler.handleTokenUsageUpdated({
      kind: "token_usage_updated",
      tokenUsage: {
        last: {
          inputTokens: 10,
          cachedInputTokens: 2,
          outputTokens: 4,
          total_tokens: 16,
        },
        model_context_window: 100,
      },
    });
    handler.handleTurnCompleted({
      kind: "turn_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      status: "completed",
      errorMessage: null,
    });

    expect(emitted.at(-1)).toEqual({
      type: "turn_completed",
      provider: "codex",
      usage: {
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 4,
        contextWindowMaxTokens: 100,
        contextWindowUsedTokens: 16,
      },
    });
    expect(getActiveForegroundTurn()).toBe(false);
  });

  test("fails the turn after detecting a textual tool call transcript", () => {
    const { emitted, handler } = createHandler();
    handler.rememberTextualToolCallFailure(
      '<tool_call>{"name":"apply_patch"}</tool_call><tool_result>ok</tool_result>',
    );
    handler.handleTurnCompleted({
      kind: "turn_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      status: "completed",
      errorMessage: null,
    });

    expect(emitted.at(-1)).toEqual({
      type: "turn_failed",
      provider: "codex",
      error: "Codex returned a tool call transcript as plain text, so no tool was executed.",
    });
  });

  test("requests plan approval after a successful plan-mode turn", () => {
    const { approvals, emitted, handler } = createHandler(true);
    handler.handlePlanUpdated({
      kind: "plan_updated",
      plan: [{ step: "Implement feature", status: "inProgress" }],
    });
    handler.handleTurnCompleted({
      kind: "turn_completed",
      threadId: "thread-1",
      turnId: "turn-1",
      status: "completed",
      errorMessage: null,
    });

    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toContain("Implement feature");
    expect(emitted).not.toContainEqual(expect.objectContaining({ type: "timeline" }));
    expect(emitted.at(-1)).toMatchObject({ type: "turn_completed", provider: "codex" });
  });
});
