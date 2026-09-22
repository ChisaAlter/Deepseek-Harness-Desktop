import { Command } from "commander";
import { describe, expect, test } from "vitest";
import { runProviderToolingCommandWithDependencies } from "./tooling.js";

describe("runProviderToolingCommand", () => {
  test("normalizes the provider and preserves tooling output", async () => {
    const requests: Array<{ provider: string; action: string }> = [];
    let closed = false;

    const result = await runProviderToolingCommandWithDependencies(
      "update",
      " CoDeX ",
      { host: "workstation.local:6767" },
      new Command(),
      {
        connect: async (options) => {
          expect(options).toEqual({ host: "workstation.local:6767" });
          return {
            runProviderToolingAction: async (provider, action) => {
              requests.push({ provider, action });
              return {
                provider: "codex",
                action: "update",
                exitCode: 0,
                stdout: "updated codex",
                stderr: "",
                success: true,
                requestId: "provider-tooling-1",
              };
            },
            close: async () => {
              closed = true;
            },
          };
        },
      },
    );

    expect(requests).toEqual([{ provider: "codex", action: "update" }]);
    expect(result.data).toEqual({
      provider: "codex",
      action: "update",
      exitCode: 0,
      stdout: "updated codex",
      stderr: "",
      success: true,
    });
    expect(
      result.schema.renderHuman?.(result, {
        format: "table",
        quiet: false,
        noHeaders: false,
        noColor: true,
      }),
    ).toContain("updated codex");
    expect(closed).toBe(true);
  });

  test("turns an unsuccessful tooling response into a command error and closes the client", async () => {
    let closed = false;

    await expect(
      runProviderToolingCommandWithDependencies("install", "claude", {}, new Command(), {
        connect: async () => ({
          runProviderToolingAction: async () => ({
            provider: "claude",
            action: "install",
            exitCode: 1,
            stdout: "",
            stderr: "permission denied",
            success: false,
            requestId: "provider-tooling-2",
          }),
          close: async () => {
            closed = true;
          },
        }),
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_TOOLING_FAILED",
      details: expect.stringMatching(/STDERR:\s+permission denied[\s\S]+1/),
    });

    expect(closed).toBe(true);
  });
});
