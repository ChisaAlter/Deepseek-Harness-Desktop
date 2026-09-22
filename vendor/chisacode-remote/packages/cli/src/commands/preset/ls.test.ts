import { Command } from "commander";
import { describe, expect, test } from "vitest";

import { runPresetLsCommandWithDependencies } from "./ls.js";

describe("runPresetLsCommand", () => {
  test("returns complete preset definitions and closes the client", async () => {
    let closed = false;
    const presets = [
      {
        id: "custom-review",
        label: "Custom Review",
        description: "Review with local conventions",
        provider: "codex",
        modeId: "read-only",
        systemPrompt: "Follow the private review checklist.",
        skillIds: ["review"],
        mcpServerIds: ["github"],
        samplePrompts: ["Review this diff"],
      },
    ];

    const result = await runPresetLsCommandWithDependencies(
      { host: "workstation.local:6767" },
      new Command(),
      {
        connect: async (options) => {
          expect(options).toEqual({ host: "workstation.local:6767" });
          return {
            listAgentPresets: async () => ({ presets, requestId: "presets-1" }),
            close: async () => {
              closed = true;
            },
          };
        },
      },
    );

    expect(result.data).toEqual(presets);
    expect(result.schema.columns.map((column) => column.header)).not.toContain("SYSTEM PROMPT");
    expect(closed).toBe(true);
  });

  test("closes the client when preset listing fails", async () => {
    let closed = false;

    await expect(
      runPresetLsCommandWithDependencies({}, new Command(), {
        connect: async () => ({
          listAgentPresets: async () => {
            throw new Error("Preset store unavailable");
          },
          close: async () => {
            closed = true;
          },
        }),
      }),
    ).rejects.toThrow("Preset store unavailable");

    expect(closed).toBe(true);
  });
});
