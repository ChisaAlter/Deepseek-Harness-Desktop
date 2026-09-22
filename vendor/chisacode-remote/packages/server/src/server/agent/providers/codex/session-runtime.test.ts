import { describe, expect, test, vi } from "vitest";

import type { AgentSessionConfig } from "../../agent-sdk-types.js";
import { CodexSessionRuntime } from "./session-runtime.js";

function createConfig(overrides: Partial<AgentSessionConfig> = {}): AgentSessionConfig {
  return {
    provider: "codex",
    cwd: "/workspace/project",
    model: "gpt-5.4",
    ...overrides,
  };
}

describe("CodexSessionRuntime", () => {
  test("owns normalized feature and persistence metadata", () => {
    const refreshResolvedCollaborationMode = vi.fn();
    const runtime = new CodexSessionRuntime({
      config: createConfig({
        thinkingOptionId: "default",
        featureValues: { fast_mode: true, plan_mode: true },
        title: "Runtime extraction",
      }),
      autoReviewEnabled: true,
      getThreadId: () => "thread-1",
      isConnected: () => true,
      connect: vi.fn(async () => undefined),
      ensureThread: vi.fn(async () => undefined),
      getResolvedCollaborationMode: () => null,
      hasPlanCollaborationMode: () => true,
      refreshResolvedCollaborationMode,
    });

    expect(runtime.getConfig().thinkingOptionId).toBeUndefined();
    expect(runtime.getMode()).toBe("auto");
    expect(runtime.getServiceTier()).toBe("fast");
    expect(runtime.isPlanModeEnabled()).toBe(true);

    runtime.setThinkingOption("high");
    runtime.applyFeatureValue("plan_mode", false);

    expect(refreshResolvedCollaborationMode).toHaveBeenLastCalledWith(false);
    expect(runtime.describePersistence()).toEqual({
      provider: "codex",
      sessionId: "thread-1",
      nativeHandle: "thread-1",
      metadata: {
        provider: "codex",
        cwd: "/workspace/project",
        title: "Runtime extraction",
        threadId: "thread-1",
        modeId: "auto",
        model: "gpt-5.4",
        thinkingOptionId: "high",
        extra: undefined,
        systemPrompt: undefined,
        mcpServers: undefined,
      },
    });
  });

  test("returns lightweight runtime info when disconnected and caches after connect", async () => {
    let connected = false;
    let threadId: string | null = null;
    const connect = vi.fn(async () => {
      connected = true;
    });
    const ensureThread = vi.fn(async () => {
      threadId = "thread-1";
    });
    const runtime = new CodexSessionRuntime({
      config: createConfig({ thinkingOptionId: "medium" }),
      autoReviewEnabled: false,
      getThreadId: () => threadId,
      isConnected: () => connected,
      connect,
      ensureThread,
      getResolvedCollaborationMode: () => ({
        name: "Code",
        mode: "code",
        settings: {},
      }),
      hasPlanCollaborationMode: () => false,
      refreshResolvedCollaborationMode: vi.fn(),
    });

    // Disconnected path must not force spawn/connect.
    await expect(runtime.getRuntimeInfo()).resolves.toMatchObject({
      sessionId: null,
      model: "gpt-5.4",
      thinkingOptionId: "medium",
      modeId: "auto",
    });
    expect(connect).not.toHaveBeenCalled();
    expect(ensureThread).not.toHaveBeenCalled();

    connected = true;
    await expect(runtime.getRuntimeInfo()).resolves.toMatchObject({
      sessionId: "thread-1",
      model: "gpt-5.4",
      thinkingOptionId: "medium",
      modeId: "auto",
      extra: { collaborationMode: "Code" },
    });
    expect(ensureThread).toHaveBeenCalledTimes(1);

    threadId = "thread-2";
    await expect(runtime.getRuntimeInfo()).resolves.toMatchObject({ sessionId: "thread-1" });
    runtime.invalidateRuntimeInfo();
    await expect(runtime.getRuntimeInfo()).resolves.toMatchObject({ sessionId: "thread-2" });
  });
});
