import { Command } from "commander";
import { describe, expect, test } from "vitest";

import { runProviderInspectCommandWithDependencies } from "./inspect.js";

describe("runProviderInspectCommand", () => {
  test("normalizes the provider and preserves structured diagnostic details", async () => {
    const requestedProviders: string[] = [];
    let closed = false;

    const result = await runProviderInspectCommandWithDependencies(
      " CoDeX ",
      { host: "workstation.local:6767" },
      new Command(),
      {
        connect: async (options) => {
          expect(options).toEqual({ host: "workstation.local:6767" });
          return {
            getProviderDiagnostic: async (provider) => {
              requestedProviders.push(provider);
              return {
                provider: "codex",
                diagnostic: "Provider: Codex\nCommand available: yes",
                details: {
                  provider: "codex",
                  effectiveCommand: {
                    argv: ["codex"],
                    source: "default",
                    resolvedPath: "C:/tools/codex.exe",
                    available: true,
                  },
                },
                requestId: "provider-diagnostic-1",
              };
            },
            close: async () => {
              closed = true;
            },
          };
        },
      },
    );

    expect(requestedProviders).toEqual(["codex"]);
    expect(result.data).toEqual({
      provider: "codex",
      diagnostic: "Provider: Codex\nCommand available: yes",
      details: {
        provider: "codex",
        effectiveCommand: {
          argv: ["codex"],
          source: "default",
          resolvedPath: "C:/tools/codex.exe",
          available: true,
        },
      },
    });
    expect(
      result.schema.renderHuman?.(result, {
        format: "table",
        quiet: false,
        noHeaders: false,
        noColor: true,
      }),
    ).toBe("Provider: Codex\nCommand available: yes");
    expect(result.schema.serialize?.(result.data)).toEqual(result.data);
    expect(closed).toBe(true);
  });

  test("closes the client when provider diagnostics fail", async () => {
    let closed = false;

    await expect(
      runProviderInspectCommandWithDependencies("claude", {}, new Command(), {
        connect: async () => ({
          getProviderDiagnostic: async () => {
            throw new Error("Provider claude is unavailable");
          },
          close: async () => {
            closed = true;
          },
        }),
      }),
    ).rejects.toThrow("Provider claude is unavailable");

    expect(closed).toBe(true);
  });

  test("rejects a blank provider before connecting", async () => {
    let connected = false;

    await expect(
      runProviderInspectCommandWithDependencies("   ", {}, new Command(), {
        connect: async () => {
          connected = true;
          throw new Error("must not connect");
        },
      }),
    ).rejects.toMatchObject({
      code: "MISSING_PROVIDER",
      message: "必须提供 provider 名称",
    });

    expect(connected).toBe(false);
  });
});
