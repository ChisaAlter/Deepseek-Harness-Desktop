import { describe, expect, test } from "vitest";
import {
  AgentPresetsListRequestMessageSchema,
  AgentPresetsListResponseMessageSchema,
} from "./messages.js";
import {
  GetProvidersSnapshotResponseMessageSchema,
  ProviderDiagnosticResponseMessageSchema,
  ProviderSnapshotEntrySchema,
  ProvidersSnapshotUpdateMessageSchema,
  ProviderToolingActionRequestMessageSchema,
  ProviderToolingActionResponseMessageSchema,
} from "./provider/messages.js";

describe("provider snapshot message schemas", () => {
  test("defaults missing provider snapshot entry enabled state to true", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "codex",
      status: "ready",
      label: "Codex",
    });

    expect(parsed.enabled).toBe(true);
  });

  test("preserves disabled provider snapshot entries", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "claude",
      status: "unavailable",
      enabled: false,
      label: "Claude",
    });

    expect(parsed.enabled).toBe(false);
  });

  test("preserves enabled provider snapshot entries", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "opencode",
      status: "loading",
      enabled: true,
      label: "OpenCode",
    });

    expect(parsed.enabled).toBe(true);
  });

  test("normalizes thinking option defaults on provider snapshot models", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "claude",
      status: "ready",
      models: [
        {
          provider: "claude",
          id: "MiniMax-M2.7",
          label: "MiniMax-M2.7",
          isDefault: true,
          thinkingOptions: [
            { id: "off", label: "Off" },
            { id: "max", label: "Max", isDefault: true },
          ],
        },
      ],
    });

    expect(parsed.models).toEqual([
      {
        provider: "claude",
        id: "MiniMax-M2.7",
        label: "MiniMax-M2.7",
        isDefault: true,
        thinkingOptions: [
          { id: "off", label: "Off" },
          { id: "max", label: "Max", isDefault: true },
        ],
        defaultThinkingOptionId: "max",
      },
    ]);
  });

  test("preserves provider tooling metadata on snapshot entries", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "kimi",
      status: "ready",
      installedVersion: "0.14.0",
      latestVersion: "0.14.0",
      versionStatus: "current",
      packageName: "@moonshot-ai/kimi-code",
      checkedAt: "2026-06-10T00:00:00.000Z",
      installAvailable: false,
      updateAvailable: false,
    });

    expect(parsed).toMatchObject({
      installedVersion: "0.14.0",
      latestVersion: "0.14.0",
      versionStatus: "current",
      packageName: "@moonshot-ai/kimi-code",
      installAvailable: false,
      updateAvailable: false,
    });
  });

  test("preserves derived provider and model gateway metadata on snapshot entries", () => {
    const parsed = ProviderSnapshotEntrySchema.parse({
      provider: "opencode-go-claude",
      status: "ready",
      label: "opencode go Claude",
      derivedFromProviderId: "claude",
      modelGatewayId: "opencode-go",
    });

    expect(parsed).toMatchObject({
      provider: "opencode-go-claude",
      derivedFromProviderId: "claude",
      modelGatewayId: "opencode-go",
    });
  });

  test("parses provider tooling action request and response messages", () => {
    expect(
      ProviderToolingActionRequestMessageSchema.parse({
        type: "provider.tooling.run.request",
        provider: "codex",
        action: "update",
        requestId: "req-tooling",
      }).action,
    ).toBe("update");

    const response = ProviderToolingActionResponseMessageSchema.parse({
      type: "provider.tooling.run.response",
      payload: {
        provider: "codex",
        action: "update",
        exitCode: 0,
        stdout: "updated",
        stderr: "",
        success: true,
        requestId: "req-tooling",
      },
    });

    expect(response.payload.success).toBe(true);
  });

  test("parses provider diagnostic details without requiring new clients to send them", () => {
    const parsed = ProviderDiagnosticResponseMessageSchema.parse({
      type: "provider_diagnostic_response",
      payload: {
        provider: "codex",
        diagnostic: "Provider: Codex",
        details: {
          provider: "codex",
          effectiveCommand: {
            argv: ["codex"],
            source: "default",
            resolvedPath: null,
            available: false,
          },
          cwd: "/tmp",
          env: [{ name: "OPENAI_API_KEY", present: false, source: "process" }],
          mcpInjection: {
            supported: true,
            enabled: false,
            reason: "daemon MCP injection is disabled",
          },
        },
        requestId: "req-diagnostic",
      },
    });

    expect(parsed.payload.details?.env[0]).toMatchObject({
      name: "OPENAI_API_KEY",
      present: false,
    });
  });

  test("parses agent preset list request and response messages", () => {
    expect(
      AgentPresetsListRequestMessageSchema.parse({
        type: "agent.presets.list.request",
        requestId: "req-presets",
      }).requestId,
    ).toBe("req-presets");

    const response = AgentPresetsListResponseMessageSchema.parse({
      type: "agent.presets.list.response",
      payload: {
        presets: [
          {
            id: "reviewer",
            label: "Reviewer",
            provider: "default",
          },
        ],
        requestId: "req-presets",
      },
    });

    expect(response.payload.presets[0]?.description).toBe("");
  });

  test("defaults missing enabled state in providers snapshot response entries", () => {
    const parsed = GetProvidersSnapshotResponseMessageSchema.parse({
      type: "get_providers_snapshot_response",
      payload: {
        entries: [
          {
            provider: "codex",
            status: "ready",
            label: "Codex",
          },
          {
            provider: "claude",
            status: "unavailable",
            enabled: false,
            label: "Claude",
          },
        ],
        generatedAt: "2026-04-24T00:00:00.000Z",
        requestId: "req-providers",
      },
    });

    expect(parsed.payload.entries.map((entry) => entry.enabled)).toEqual([true, false]);
  });

  test("defaults missing enabled state in providers snapshot update entries", () => {
    const parsed = ProvidersSnapshotUpdateMessageSchema.parse({
      type: "providers_snapshot_update",
      payload: {
        cwd: "/tmp/repo",
        entries: [
          {
            provider: "codex",
            status: "ready",
            label: "Codex",
          },
        ],
        generatedAt: "2026-04-24T00:00:00.000Z",
      },
    });

    expect(parsed.payload.entries[0]?.enabled).toBe(true);
  });
});
