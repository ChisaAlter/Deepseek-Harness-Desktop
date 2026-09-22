import { describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { CodexSessionTurnExecution } from "./session-turn-execution.js";

function createTurnExecution(
  request: (method: string, params?: unknown, timeoutMs?: number) => Promise<unknown>,
): CodexSessionTurnExecution {
  return new CodexSessionTurnExecution({
    logger: createTestLogger(),
    getClient: () => ({ request }),
    connect: vi.fn(async () => undefined),
    getThreadId: () => "thread-1",
    ensureThreadLoaded: vi.fn(async () => undefined),
    ensureThread: vi.fn(async () => undefined),
    resolvePrompt: async (prompt) => prompt,
    buildUserInput: async (prompt) => [{ type: "text", text: prompt }],
    getConfig: () => ({
      provider: "codex",
      cwd: "/workspace/project",
      modeId: "auto",
      model: "gpt-5.4",
    }),
    getMode: () => "auto",
    getServiceTier: () => null,
    getCollaborationMode: () => null,
    getCodexConfig: () => null,
    subscribe: () => () => undefined,
    getRuntimeInfo: async () => ({ provider: "codex", sessionId: "thread-1" }),
  });
}

describe("CodexSessionTurnExecution", () => {
  test("enforces one foreground turn and sends the normalized start request", async () => {
    const request = vi.fn(async () => ({}));
    const execution = createTurnExecution(request);
    execution.setActiveForegroundTurnId("existing-turn");

    await expect(execution.startTurn("blocked")).rejects.toThrow(
      "A foreground turn is already active",
    );
    expect(request).not.toHaveBeenCalled();

    execution.clearActiveForegroundTurn();
    await expect(execution.startTurn("ship it")).resolves.toEqual({
      turnId: "codex-turn-0",
    });
    expect(execution.getActiveForegroundTurnId()).toBe("codex-turn-0");
    expect(request).toHaveBeenCalledWith(
      "turn/start",
      expect.objectContaining({
        threadId: "thread-1",
        model: "gpt-5.4",
        cwd: "/workspace/project",
      }),
      90_000,
    );
    await expect(execution.startTurn("still blocked")).rejects.toThrow(
      "A foreground turn is already active",
    );
  });

  test("clears failed foreground state and interrupts the native turn id", async () => {
    const request = vi
      .fn<(method: string, params?: unknown, timeoutMs?: number) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("turn start failed"))
      .mockResolvedValue({});
    const execution = createTurnExecution(request);

    await expect(execution.startTurn("first attempt")).rejects.toThrow("turn start failed");
    expect(execution.getActiveForegroundTurnId()).toBeNull();
    await expect(execution.startTurn("retry")).resolves.toEqual({ turnId: "codex-turn-1" });

    execution.setCurrentTurnId("native-turn-7");
    await execution.interrupt();

    expect(request).toHaveBeenLastCalledWith(
      "turn/interrupt",
      { threadId: "thread-1", turnId: "native-turn-7" },
      2_000,
    );
  });
});
