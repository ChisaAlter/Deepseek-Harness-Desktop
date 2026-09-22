import { describe, expect, test, vi } from "vitest";
import { MutableDaemonConfigSchema } from "@chisacode/protocol/daemon/messages";

import { createDaemonDiagnosticReport } from "./diagnostics-report.js";

function createDependencies(overrides?: { readLogTail?: ReturnType<typeof vi.fn> }) {
  return {
    chisacodeHome: "C:\\Users\\alice\\.chisacode",
    homeDirectory: "C:\\Users\\alice",
    daemonVersion: "1.2.3",
    daemonRuntimeConfig: {
      listen: "127.0.0.1:6767",
      relay: { enabled: true, useTls: true, publicUseTls: true },
    },
    daemonConfigStore: {
      get: () =>
        MutableDaemonConfigSchema.parse({
          mcp: { injectIntoAgents: true },
          providers: { codex: { env: { OPENAI_API_KEY: "config-secret" } } },
          modelGateways: {},
          metadataGeneration: { providers: [] },
          autoArchiveAfterMerge: false,
          appendSystemPrompt: "configured but private",
          skills: {
            global: { disabledSkillNames: [] },
            providers: {},
            agents: {},
            installedSources: {},
          },
          mcpServers: {
            servers: {},
            global: { disabledServerNames: [] },
            providers: {},
            agents: {},
          },
        }),
    },
    agentManager: {
      listAgents: () => [{ lifecycle: "running" }, { lifecycle: "idle" }, { lifecycle: "idle" }],
    },
    providerSnapshotManager: {
      listProviders: async () => [
        {
          provider: "codex",
          label: "Codex",
          status: "ready" as const,
          enabled: true,
          versionStatus: "current" as const,
          installedVersion: "0.1.0",
          latestVersion: "0.1.0",
          packageName: "@openai/codex",
        },
      ],
      getProviderDiagnostic: async () => ({
        provider: "codex",
        diagnostic:
          "C:\\Users\\alice\\project OPENAI_API_KEY=provider-secret Authorization: Bearer abc.def",
        details: {
          provider: "codex",
          cwd: "C:\\Users\\alice\\project",
          env: [],
          mcpInjection: {
            supported: true,
            enabled: true,
            reason: "Configured for diagnostics",
          },
        },
      }),
    },
    now: () => new Date("2026-07-14T00:00:00.000Z"),
    ...(overrides?.readLogTail ? { readLogTail: overrides.readLogTail } : {}),
  };
}

describe("daemon diagnostic report", () => {
  test("aggregates runtime, config, agents, and providers without exposing secrets or home paths", async () => {
    const report = await createDaemonDiagnosticReport(createDependencies());

    expect(report).toContain("Version: 1.2.3");
    expect(report).toContain("Agent MCP injection: enabled");
    expect(report).toContain("Total: 3");
    expect(report).toContain("idle: 2");
    expect(report).toContain("## Codex (codex)");
    expect(report).toContain("<home>\\project");
    expect(report).not.toContain("config-secret");
    expect(report).not.toContain("provider-secret");
    expect(report).not.toContain("abc.def");
    expect(report).not.toContain("C:\\Users\\alice");
    expect(report).not.toContain("Recent daemon logs");
  });

  test("includes bounded redacted log context only when explicitly requested", async () => {
    const readLogTail = vi.fn(async () =>
      ["normal line", "token=log-secret", "path=C:\\Users\\alice\\.chisacode\\daemon.log"].join(
        "\n",
      ),
    );

    const report = await createDaemonDiagnosticReport(createDependencies({ readLogTail }), {
      includeLogs: true,
      maxLogLines: 25,
    });

    expect(readLogTail).toHaveBeenCalledWith(expect.stringContaining("daemon.log"), 25);
    expect(report).toContain("Recent daemon logs (last 25 lines, explicitly requested)");
    expect(report).toContain("normal line");
    expect(report).toContain("token=[redacted]");
    expect(report).toContain("path=<chisacode-home>\\daemon.log");
    expect(report).not.toContain("log-secret");
  });
});
