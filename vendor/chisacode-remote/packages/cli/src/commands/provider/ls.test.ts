import { Command } from "commander";
import { describe, expect, test } from "vitest";

import { runProviderLsCommandWithDependencies } from "./ls.js";

describe("runProviderLsCommand", () => {
  test("exposes provider versions and the next tooling action", async () => {
    let closed = false;

    const result = await runProviderLsCommandWithDependencies(
      { host: "workstation.local:6767" },
      new Command(),
      {
        tryConnect: async (options) => {
          expect(options).toEqual({ host: "workstation.local:6767" });
          return {
            getProvidersSnapshot: async () => ({
              entries: [
                {
                  provider: "codex",
                  label: "Codex",
                  status: "ready" as const,
                  enabled: true,
                  installedVersion: "1.2.3",
                  latestVersion: "1.2.3",
                  versionStatus: "current" as const,
                },
                {
                  provider: "claude",
                  label: "Claude",
                  status: "unavailable" as const,
                  enabled: true,
                  latestVersion: "2.0.0",
                  versionStatus: "not-installed" as const,
                  installAvailable: true,
                },
                {
                  provider: "opencode",
                  label: "OpenCode",
                  status: "ready" as const,
                  enabled: true,
                  installedVersion: "3.1.0",
                  latestVersion: "3.2.0",
                  versionStatus: "outdated" as const,
                  updateAvailable: true,
                },
                {
                  provider: "pi",
                  label: "Pi",
                  status: "ready" as const,
                  enabled: true,
                  installedVersion: "4.0.0",
                  versionStatus: "unknown" as const,
                  checkedAt: "2026-07-15T02:00:00.000Z",
                },
                {
                  provider: "acp",
                  label: "ACP",
                  status: "loading" as const,
                  enabled: false,
                },
              ],
              requestId: "provider-snapshot-1",
            }),
            close: async () => {
              closed = true;
            },
          };
        },
      },
    );

    expect(
      result.data.map(({ provider, installedVersion, latestVersion, toolingStatus }) => ({
        provider,
        installedVersion,
        latestVersion,
        toolingStatus,
      })),
    ).toEqual([
      {
        provider: "codex",
        installedVersion: "1.2.3",
        latestVersion: "1.2.3",
        toolingStatus: "current",
      },
      {
        provider: "claude",
        installedVersion: "-",
        latestVersion: "2.0.0",
        toolingStatus: "install",
      },
      {
        provider: "opencode",
        installedVersion: "3.1.0",
        latestVersion: "3.2.0",
        toolingStatus: "update",
      },
      {
        provider: "pi",
        installedVersion: "4.0.0",
        latestVersion: "-",
        toolingStatus: "unknown",
      },
      {
        provider: "acp",
        installedVersion: "-",
        latestVersion: "-",
        toolingStatus: "not-checked",
      },
    ]);
    expect(result.schema.columns.map((column) => column.header)).toEqual(
      expect.arrayContaining(["INSTALLED", "LATEST", "TOOLING"]),
    );
    expect(closed).toBe(true);
  });

  test("refreshes provider tooling before reading the list when requested", async () => {
    let refreshed = false;
    let closed = false;

    const result = await runProviderLsCommandWithDependencies({ refresh: true }, new Command(), {
      tryConnect: async () => ({
        refreshProvidersSnapshot: async () => {
          refreshed = true;
          return { acknowledged: true, requestId: "provider-refresh-1" };
        },
        getProvidersSnapshot: async () => {
          expect(refreshed).toBe(true);
          return {
            entries: [
              {
                provider: "codex",
                status: "ready" as const,
                enabled: true,
                installedVersion: "1.2.3",
                latestVersion: "1.3.0",
                versionStatus: "outdated" as const,
              },
            ],
            requestId: "provider-snapshot-refreshed",
          };
        },
        close: async () => {
          closed = true;
        },
      }),
    });

    expect(result.data[0]).toMatchObject({
      provider: "codex",
      latestVersion: "1.3.0",
      toolingStatus: "update",
    });
    expect(closed).toBe(true);
  });
  test("falls back to manifest providers with unchecked tooling when snapshot loading fails", async () => {
    let closed = false;

    const result = await runProviderLsCommandWithDependencies({}, new Command(), {
      tryConnect: async () => ({
        getProvidersSnapshot: async () => {
          throw new Error("snapshot unavailable");
        },
        close: async () => {
          closed = true;
        },
      }),
    });

    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          installedVersion: "-",
          latestVersion: "-",
          toolingStatus: "not-checked",
        }),
      ]),
    );
    expect(result.data.every((provider) => provider.toolingStatus === "not-checked")).toBe(true);
    expect(closed).toBe(true);
  });
});
