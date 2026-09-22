import { describe, expect, test } from "vitest";

import type { AgentSessionConfig } from "../../agent-sdk-types.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { CodexThreadBootstrap } from "./thread-bootstrap.js";

function createConfig(overrides: Partial<AgentSessionConfig> = {}): AgentSessionConfig {
  return {
    provider: "codex",
    cwd: "/workspace/project",
    modeId: "auto",
    ...overrides,
  };
}

function createBootstrap(
  request: (method: string, params?: unknown) => Promise<unknown>,
  config = createConfig(),
  initialThreadId: string | null = null,
) {
  let threadId = initialThreadId;
  let modeId = config.modeId ?? "auto";
  let invalidations = 0;
  const bootstrap = new CodexThreadBootstrap({
    logger: createTestLogger(),
    getClient: () => ({ request }),
    getConfig: () => config,
    getThreadId: () => threadId,
    setThreadId: (value) => {
      threadId = value;
    },
    getMode: () => modeId,
    setMode: (value) => {
      modeId = value;
    },
    invalidateRuntimeInfo: () => {
      invalidations += 1;
    },
    ephemeral: false,
  });
  return {
    bootstrap,
    config,
    getInvalidations: () => invalidations,
    getMode: () => modeId,
    getThreadId: () => threadId,
  };
}

describe("Codex thread bootstrap", () => {
  test("falls back to model/list and starts a thread with resolved defaults", async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    const { bootstrap, config, getThreadId } = createBootstrap(async (method, params) => {
      requests.push({ method, params });
      if (method === "getUserSavedConfig" || method === "config/read") {
        return { config: {} };
      }
      if (method === "model/list") {
        return {
          data: [
            {
              id: "gpt-test",
              isDefault: true,
              defaultReasoningEffort: "high",
            },
          ],
        };
      }
      if (method === "thread/start") {
        return { thread: { id: "thread-created" } };
      }
      return {};
    });

    await bootstrap.ensureThread();

    expect(config.model).toBe("gpt-test");
    expect(config.thinkingOptionId).toBe("high");
    expect(getThreadId()).toBe("thread-created");
    expect(requests.find((entry) => entry.method === "thread/start")?.params).toMatchObject({
      model: "gpt-test",
      cwd: "/workspace/project",
    });
  });

  test("does not resume a thread that is already loaded", async () => {
    const methods: string[] = [];
    const { bootstrap } = createBootstrap(
      async (method) => {
        methods.push(method);
        if (method === "thread/loaded/list") {
          return { data: ["thread-existing"] };
        }
        return {};
      },
      createConfig(),
      "thread-existing",
    );

    await bootstrap.ensureThreadLoaded();

    expect(methods).toEqual(["thread/loaded/list"]);
  });

  test("preserves the thread id in resume failure errors", async () => {
    const { bootstrap } = createBootstrap(
      async (method) => {
        if (method === "thread/loaded/list") {
          return { data: [] };
        }
        if (method === "thread/resume") {
          throw new Error("archived thread missing");
        }
        return {};
      },
      createConfig(),
      "thread-archived",
    );

    await expect(bootstrap.ensureThreadLoaded()).rejects.toThrow(
      "Failed to resume Codex thread thread-archived: archived thread missing",
    );
  });
});
