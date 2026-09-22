import type { ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";
import { describe, expect, it } from "vitest";

import { resolveRunningAgentModelControls } from "./running-agent-model-controls";

describe("resolveRunningAgentModelControls", () => {
  it("keeps gateway models grouped under the agent provider and filters to the runtime provider", () => {
    const snapshotEntries: ProviderSnapshotEntry[] = [
      {
        provider: "opencode",
        label: "OpenCode",
        enabled: true,
        status: "ready",
        models: [
          {
            id: "native-model",
            provider: "opencode",
            label: "Native model",
          },
        ],
      },
      {
        provider: "openrouter",
        label: "OpenRouter",
        enabled: true,
        status: "ready",
        derivedFromProviderId: "opencode",
        modelGatewayId: "openrouter",
        models: [
          {
            id: "gateway-model",
            provider: "openrouter",
            label: "Gateway model",
            thinkingOptions: [
              { id: "low", label: "Low" },
              { id: "high", label: "High" },
            ],
            defaultThinkingOptionId: "low",
          },
        ],
      },
    ];

    const result = resolveRunningAgentModelControls({
      agent: {
        provider: "opencode",
        runtimeProvider: "openrouter",
        runtimeModelId: "gateway-model",
        model: "gateway-model",
        thinkingOptionId: "high",
      },
      snapshotEntries,
      defaultModelLabel: "Default",
      unavailable: "Unavailable",
      unknownError: "Unknown error",
    });

    expect(result.agentProvider).toBe("opencode");
    expect(result.agentRuntimeProvider).toBe("openrouter");
    expect(result.agentModelSelectorProviders).toHaveLength(1);
    expect(result.agentModelSelectorProviders[0]?.id).toBe("opencode");
    // Full family list: native + gateway. Runtime filter is not applied for the
    // running-session picker so users can switch back to native models.
    expect(result.agentModelSelectorProviders[0]?.modelSelection).toEqual({
      kind: "models",
      rows: [
        expect.objectContaining({
          agentProvider: "opencode",
          runtimeProvider: "opencode",
          modelId: "native-model",
        }),
        expect.objectContaining({
          agentProvider: "opencode",
          runtimeProvider: "openrouter",
          modelId: "gateway-model",
        }),
      ],
    });
    // modelOptions still follow the active runtime provider's models.
    expect(result.modelOptions).toEqual([{ id: "gateway-model", label: "Gateway model" }]);
    expect(result.modelSelection.activeModelId).toBe("gateway-model");
    expect(result.modelSelection.selectedThinkingId).toBe("high");
    expect(result.thinkingOptions).toEqual([
      { id: "low", label: "低" },
      { id: "high", label: "高" },
    ]);
    expect(result.selectedProviderIsLoading).toBe(false);
  });

  it("lists models for a gateway agent.provider when base provider is also present", () => {
    const snapshotEntries: ProviderSnapshotEntry[] = [
      {
        provider: "codex",
        label: "Codex",
        enabled: true,
        status: "ready",
        models: [
          {
            id: "gpt-5.4",
            provider: "codex",
            label: "GPT-5.4",
          },
        ],
      },
      {
        provider: "grok-4-5-codex",
        label: "grok-4.5 Codex",
        enabled: true,
        status: "ready",
        derivedFromProviderId: "codex",
        modelGatewayId: "grok-4-5",
        models: [
          {
            id: "grok-4.5",
            provider: "grok-4-5-codex",
            label: "grok-4.5",
            isDefault: true,
          },
        ],
      },
    ];

    const result = resolveRunningAgentModelControls({
      agent: {
        provider: "grok-4-5-codex",
        runtimeProvider: "grok-4-5-codex",
        runtimeModelId: "grok-4.5",
        model: "grok-4.5",
        thinkingOptionId: null,
      },
      snapshotEntries,
      defaultModelLabel: "Default",
      unavailable: "Unavailable",
      unknownError: "Unknown error",
    });

    expect(result.agentModelSelectorProviders).toHaveLength(1);
    expect(result.agentModelSelectorProviders[0]?.id).toBe("grok-4-5-codex");
    expect(result.agentModelSelectorProviders[0]?.modelSelection).toEqual({
      kind: "models",
      rows: [
        expect.objectContaining({
          agentProvider: "grok-4-5-codex",
          runtimeProvider: "codex",
          modelId: "gpt-5.4",
        }),
        expect.objectContaining({
          agentProvider: "grok-4-5-codex",
          runtimeProvider: "grok-4-5-codex",
          modelId: "grok-4.5",
        }),
      ],
    });
    expect(result.modelOptions).toEqual([{ id: "grok-4.5", label: "grok-4.5" }]);
  });

  it("lists all codex family models when runtimeProvider is a gateway id", () => {
    const snapshotEntries: ProviderSnapshotEntry[] = [
      {
        provider: "codex",
        label: "Codex",
        enabled: true,
        status: "ready",
        models: [
          {
            id: "gpt-5.4",
            provider: "codex",
            label: "GPT-5.4",
          },
          {
            id: "gpt-5.4-mini",
            provider: "codex",
            label: "GPT-5.4-Mini",
          },
        ],
      },
      {
        provider: "grok-4-5-codex",
        label: "grok-4.5 Codex",
        enabled: true,
        status: "ready",
        derivedFromProviderId: "codex",
        modelGatewayId: "grok-4-5",
        models: [
          {
            id: "grok-4.5",
            provider: "grok-4-5-codex",
            label: "grok-4.5",
            isDefault: true,
          },
        ],
      },
    ];

    const result = resolveRunningAgentModelControls({
      agent: {
        provider: "codex",
        runtimeProvider: "grok-4-5-codex",
        runtimeModelId: "grok-4.5",
        model: "grok-4.5",
        thinkingOptionId: null,
      },
      snapshotEntries,
      defaultModelLabel: "Default",
      unavailable: "Unavailable",
      unknownError: "Unknown error",
    });

    expect(result.agentProvider).toBe("codex");
    expect(result.agentRuntimeProvider).toBe("grok-4-5-codex");
    expect(result.agentModelSelectorProviders).toHaveLength(1);
    expect(result.agentModelSelectorProviders[0]?.id).toBe("codex");
    expect(result.agentModelSelectorProviders[0]?.modelSelection).toEqual({
      kind: "models",
      rows: [
        expect.objectContaining({ modelId: "gpt-5.4", runtimeProvider: "codex" }),
        expect.objectContaining({ modelId: "gpt-5.4-mini", runtimeProvider: "codex" }),
        expect.objectContaining({
          modelId: "grok-4.5",
          runtimeProvider: "grok-4-5-codex",
          agentProvider: "codex",
        }),
      ],
    });
  });

  it("keeps the base family when runtimeProvider points to a derived Claude provider", () => {
    const snapshotEntries: ProviderSnapshotEntry[] = [
      {
        provider: "claude",
        label: "Claude",
        enabled: true,
        status: "ready",
        models: [{ id: "claude-opus-4-8", provider: "claude", label: "Opus 4.8" }],
      },
      {
        provider: "custom-claude",
        label: "Custom Claude",
        enabled: true,
        status: "ready",
        derivedFromProviderId: "claude",
        modelGatewayId: "custom-gateway",
        models: [{ id: "custom-model", provider: "custom-claude", label: "Custom model" }],
      },
    ];

    const result = resolveRunningAgentModelControls({
      agent: {
        provider: "claude",
        runtimeProvider: "custom-claude",
        runtimeModelId: "custom-model",
        model: "custom-model",
        thinkingOptionId: null,
      },
      snapshotEntries,
      defaultModelLabel: "Default",
      unavailable: "Unavailable",
      unknownError: "Unknown error",
    });

    expect(result.agentModelSelectorProviders).toHaveLength(1);
    expect(result.agentModelSelectorProviders[0]?.id).toBe("claude");
    expect(result.agentModelSelectorProviders[0]?.modelSelection).toEqual({
      kind: "models",
      rows: expect.arrayContaining([
        expect.objectContaining({ modelId: "claude-opus-4-8", runtimeProvider: "claude" }),
        expect.objectContaining({ modelId: "custom-model", runtimeProvider: "custom-claude" }),
      ]),
    });
    expect(result.modelOptions).toEqual([{ id: "custom-model", label: "Custom model" }]);
  });

  it("lists models when only the gateway snapshot entry is available", () => {
    const snapshotEntries: ProviderSnapshotEntry[] = [
      {
        provider: "grok-4-5-codex",
        label: "grok-4.5 Codex",
        enabled: true,
        status: "ready",
        derivedFromProviderId: "codex",
        modelGatewayId: "grok-4-5",
        models: [
          {
            id: "grok-4.5",
            provider: "grok-4-5-codex",
            label: "grok-4.5",
            isDefault: true,
          },
        ],
      },
    ];

    const result = resolveRunningAgentModelControls({
      agent: {
        provider: "grok-4-5-codex",
        runtimeProvider: null,
        runtimeModelId: "grok-4.5",
        model: "grok-4.5",
        thinkingOptionId: null,
      },
      snapshotEntries,
      defaultModelLabel: "Default",
      unavailable: "Unavailable",
      unknownError: "Unknown error",
    });

    expect(result.agentModelSelectorProviders).toHaveLength(1);
    expect(result.agentModelSelectorProviders[0]?.id).toBe("grok-4-5-codex");
    expect(result.agentModelSelectorProviders[0]?.modelSelection).toEqual({
      kind: "models",
      rows: [
        expect.objectContaining({
          modelId: "grok-4.5",
          agentProvider: "grok-4-5-codex",
        }),
      ],
    });
  });
});
