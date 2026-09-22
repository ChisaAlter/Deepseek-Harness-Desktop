import { describe, expect, test } from "vitest";

import type { AgentSessionConfig } from "../../agent-sdk-types.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { CodexSessionMetadata } from "./session-metadata.js";

function createConfig(overrides: Partial<AgentSessionConfig> = {}): AgentSessionConfig {
  return {
    provider: "codex",
    cwd: "/workspace/project",
    ...overrides,
  };
}

function createMetadata(
  request: (method: string, params?: unknown) => Promise<unknown>,
  config = createConfig(),
) {
  return new CodexSessionMetadata({
    logger: createTestLogger(),
    getClient: () => ({ request }),
    getConfig: () => config,
    getTraceContext: () => ({ agentId: "agent-1", sessionId: "thread-1" }),
  });
}

describe("Codex session metadata", () => {
  test("resolves code and plan collaboration modes with config overrides", () => {
    const metadata = createMetadata(
      async () => ({}),
      createConfig({
        model: "configured-model",
        thinkingOptionId: "high",
        systemPrompt: "Project instructions",
      }),
    );
    metadata.setCollaborationModes(
      [
        { name: "Code", mode: "code", model: "mode-model" },
        {
          name: "Plan",
          mode: "plan",
          developer_instructions: "Plan carefully",
        },
      ],
      false,
    );

    expect(metadata.getResolvedCollaborationMode()).toMatchObject({
      name: "Code",
      mode: "code",
      settings: { model: "configured-model", reasoning_effort: "high" },
    });

    metadata.refreshResolvedCollaborationMode(true);
    expect(metadata.getResolvedCollaborationMode()).toMatchObject({
      name: "Plan",
      mode: "plan",
      settings: {
        model: "configured-model",
        reasoning_effort: "high",
      },
    });
    expect(metadata.getResolvedCollaborationMode()?.settings.developer_instructions).toContain(
      "Plan carefully",
    );
  });

  test("deduplicates app-server skills and applies the effective policy", async () => {
    const metadata = createMetadata(
      async (method) => {
        if (method !== "skills/list") return {};
        return {
          data: [
            {
              skills: [
                { name: "enabled", description: "Enabled", path: "/skills/enabled" },
                { name: "disabled", description: "Disabled", path: "/skills/disabled" },
              ],
            },
            {
              skills: [{ name: "enabled", description: "Duplicate", path: "/other/enabled" }],
            },
          ],
        };
      },
      createConfig({
        extra: {
          codex: {
            skillsPolicy: { globalDisabledSkillNames: ["disabled"] },
          },
        },
      }),
    );

    await metadata.loadSkills();

    expect(metadata.getCachedSkills()).toHaveLength(2);
    expect(metadata.getEnabledSkills()).toEqual([
      { name: "enabled", description: "Enabled", path: "/skills/enabled" },
    ]);
  });

  test("clears cached metadata when app-server metadata requests fail", async () => {
    const metadata = createMetadata(async () => {
      throw new Error("metadata unavailable");
    });
    metadata.setCollaborationModes([{ name: "Plan", mode: "plan" }], true);

    await metadata.loadAll(false);

    expect(metadata.hasPlanCollaborationMode()).toBe(false);
    expect(metadata.getResolvedCollaborationMode()).toBeNull();
    expect(metadata.getCachedSkills()).toEqual([]);
  });
});
