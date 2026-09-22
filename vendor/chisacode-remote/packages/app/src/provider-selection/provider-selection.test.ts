import { describe, expect, it } from "vitest";
import type { AgentModelDefinition, ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";
import type { AgentProviderDefinition } from "@chisacode/protocol/provider-manifest";
import {
  buildProviderSelectorProviders,
  buildSelectableProviderSelectorProviders,
  buildSelectedTriggerLabel,
  findErrorSelectorProvider,
  filterAndRankModelRows,
  filterProviderSelectorProvidersByRuntimeProvider,
  getProviderModelRows,
  matchesModelSearch,
  resolveSelectedModelLabel,
  resolveSubmissionReadiness,
} from "./provider-selection";

describe("combined model selector data", () => {
  const codexModel: AgentModelDefinition = {
    provider: "codex",
    id: "gpt-5.4",
    label: "GPT-5.4",
  };

  function snapshotEntry(
    overrides: Partial<ProviderSnapshotEntry> & Pick<ProviderSnapshotEntry, "provider">,
  ): ProviderSnapshotEntry {
    return {
      ...overrides,
      provider: overrides.provider,
      status: overrides.status ?? "ready",
      enabled: overrides.enabled ?? true,
      label: overrides.label ?? overrides.provider,
      description: overrides.description ?? `${overrides.provider} provider`,
      defaultModeId: overrides.defaultModeId ?? "default",
      modes: overrides.modes ?? [],
      models: overrides.models ?? [codexModel],
    };
  }

  it("builds selector providers from ready enabled snapshot entries", () => {
    expect(
      buildSelectableProviderSelectorProviders([
        snapshotEntry({
          provider: "codex",
          label: "Codex",
          models: [codexModel],
        }),
      ]),
    ).toEqual([
      {
        id: "codex",
        label: "Codex",
        status: "ready",
        error: null,
        modelSelection: {
          kind: "models",
          rows: [
            {
              favoriteKey: "codex:gpt-5.4",
              provider: "codex",
              agentProvider: "codex",
              runtimeProvider: "codex",
              providerLabel: "Codex",
              modelId: "gpt-5.4",
              modelLabel: "GPT-5.4",
              description: undefined,
              isDefault: undefined,
            },
          ],
        },
      },
    ]);
  });

  it("synthesizes a default model row for ready enabled providers without explicit models", () => {
    expect(
      buildSelectableProviderSelectorProviders([
        snapshotEntry({
          provider: "deepseek-tui",
          label: "DeepSeek TUI",
          models: [],
        }),
      ]),
    ).toEqual([
      {
        id: "deepseek-tui",
        label: "DeepSeek TUI",
        status: "ready",
        error: null,
        modelSelection: {
          kind: "models",
          rows: [
            {
              favoriteKey: "deepseek-tui:",
              provider: "deepseek-tui",
              agentProvider: "deepseek-tui",
              runtimeProvider: "deepseek-tui",
              providerLabel: "DeepSeek TUI",
              modelId: "",
              modelLabel: "Default",
              description: undefined,
              isDefault: true,
            },
          ],
        },
      },
    ]);
  });

  it("excludes disabled providers from selector data", () => {
    expect(
      buildSelectableProviderSelectorProviders([
        snapshotEntry({
          provider: "deepseek-tui",
          label: "DeepSeek TUI",
          enabled: false,
          models: [],
        }),
      ]),
    ).toEqual([]);
  });

  it("groups model gateway provider models under their target agent instead of showing them as agents", () => {
    const providers = buildSelectableProviderSelectorProviders([
      snapshotEntry({
        provider: "claude",
        label: "Claude",
        models: [
          {
            provider: "claude",
            id: "sonnet",
            label: "Sonnet",
          },
        ],
      }),
      snapshotEntry({
        provider: "opencode-go-claude",
        label: "opencode go Claude",
        derivedFromProviderId: "claude",
        modelGatewayId: "opencode-go",
        models: [
          {
            provider: "opencode-go-claude",
            id: "kimi-k2.6",
            label: "Kimi K2.6",
          },
        ],
      } as Partial<ProviderSnapshotEntry> & Pick<ProviderSnapshotEntry, "provider">),
    ]);

    expect(providers.map((provider) => provider.id)).toEqual(["claude"]);
    expect(providers[0]?.modelSelection).toEqual({
      kind: "models",
      rows: [
        expect.objectContaining({
          provider: "claude",
          agentProvider: "claude",
          runtimeProvider: "claude",
          modelId: "sonnet",
          modelLabel: "Sonnet",
        }),
        expect.objectContaining({
          provider: "opencode-go-claude",
          agentProvider: "claude",
          runtimeProvider: "opencode-go-claude",
          providerLabel: "opencode go Claude",
          modelId: "kimi-k2.6",
          modelLabel: "Kimi K2.6",
        }),
      ],
    });
  });

  it("groups gateway models under every generated agent provider", () => {
    const agentIds = ["claude", "codex", "opencode", "pi", "kimi", "grokbuild", "dsh"];
    const entries = [
      ...agentIds.map((provider) =>
        snapshotEntry({
          provider,
          label: provider,
          models: [],
        }),
      ),
      ...agentIds.map((provider) =>
        snapshotEntry({
          provider: `opencode-${provider}`,
          label: `opencode ${provider}`,
          derivedFromProviderId: provider,
          modelGatewayId: "opencode",
          models: [
            {
              provider: `opencode-${provider}`,
              id: provider === "opencode" || provider === "pi" ? "xiaomi/mimo-v2.5" : "mimo-v2.5",
              label: "mimo-v2.5",
            },
          ],
        } as Partial<ProviderSnapshotEntry> & Pick<ProviderSnapshotEntry, "provider">),
      ),
    ];

    const providers = buildSelectableProviderSelectorProviders(entries);

    expect(providers.map((provider) => provider.id)).toEqual(agentIds);
    for (const provider of providers) {
      expect(provider.modelSelection.kind).toBe("models");
      if (provider.modelSelection.kind !== "models") {
        throw new Error("expected models");
      }
      expect(provider.modelSelection.rows).toContainEqual(
        expect.objectContaining({
          agentProvider: provider.id,
          runtimeProvider: `opencode-${provider.id}`,
          providerLabel: `opencode ${provider.id}`,
          modelLabel: "mimo-v2.5",
        }),
      );
    }
  });

  it("keeps gateway models selectable when the base agent provider requires authentication", () => {
    const providers = buildSelectableProviderSelectorProviders([
      snapshotEntry({
        provider: "kimi",
        label: "Kimi Code",
        status: "error",
        error: "Authentication required",
        models: [],
      }),
      snapshotEntry({
        provider: "opencode-kimi",
        label: "DeepSeek via Kimi Code",
        derivedFromProviderId: "kimi",
        modelGatewayId: "opencode",
        models: [
          {
            provider: "opencode-kimi",
            id: "deepseek-v4-pro",
            label: "DeepSeek V4 Pro",
          },
        ],
      } as Partial<ProviderSnapshotEntry> & Pick<ProviderSnapshotEntry, "provider">),
    ]);

    expect(providers.map((provider) => provider.id)).toEqual(["kimi"]);
    expect(providers[0]?.modelSelection).toEqual({
      kind: "models",
      rows: [
        expect.objectContaining({
          provider: "opencode-kimi",
          agentProvider: "kimi",
          runtimeProvider: "opencode-kimi",
          providerLabel: "DeepSeek via Kimi Code",
          modelId: "deepseek-v4-pro",
          modelLabel: "DeepSeek V4 Pro",
        }),
      ],
    });
    expect(
      resolveSelectedModelLabel({
        providers,
        selectedProvider: "kimi",
        selectedRuntimeProvider: "opencode-kimi",
        selectedModel: "deepseek-v4-pro",
        isLoading: false,
      }),
    ).toBe("DeepSeek V4 Pro");
  });

  it("resolves selected labels from gateway model rows grouped under base agents", () => {
    const providers = buildSelectableProviderSelectorProviders([
      snapshotEntry({
        provider: "claude",
        label: "Claude",
        models: [],
      }),
      snapshotEntry({
        provider: "opencode-go-claude",
        label: "opencode go Claude",
        derivedFromProviderId: "claude",
        modelGatewayId: "opencode-go",
        models: [
          {
            provider: "opencode-go-claude",
            id: "kimi-k2.6",
            label: "Kimi K2.6",
          },
        ],
      } as Partial<ProviderSnapshotEntry> & Pick<ProviderSnapshotEntry, "provider">),
    ]);

    expect(
      resolveSelectedModelLabel({
        providers,
        selectedProvider: "claude",
        selectedRuntimeProvider: "opencode-go-claude",
        selectedModel: "kimi-k2.6",
        isLoading: false,
      }),
    ).toBe("Kimi K2.6");
  });

  it("filters grouped gateway rows to the running agent runtime provider", () => {
    const providers = buildSelectableProviderSelectorProviders([
      snapshotEntry({
        provider: "codex",
        label: "Codex",
        models: [
          {
            provider: "codex",
            id: "gpt-5.4",
            label: "GPT-5.4",
          },
        ],
      }),
      snapshotEntry({
        provider: "opencode-codex",
        label: "OpenCode Gateway Codex",
        derivedFromProviderId: "codex",
        modelGatewayId: "opencode",
        models: [
          {
            provider: "opencode-codex",
            id: "GPT6.0",
            label: "GPT6.0",
          },
        ],
      } as Partial<ProviderSnapshotEntry> & Pick<ProviderSnapshotEntry, "provider">),
    ]);

    const filtered = filterProviderSelectorProvidersByRuntimeProvider(providers, "codex");

    expect(filtered[0]?.modelSelection).toEqual({
      kind: "models",
      rows: [
        expect.objectContaining({
          provider: "codex",
          runtimeProvider: "codex",
          modelId: "gpt-5.4",
        }),
      ],
    });
  });

  it("surfaces gateway providers standalone when the base provider is absent", () => {
    const providers = buildSelectableProviderSelectorProviders([
      snapshotEntry({
        provider: "grok-4-5-codex",
        label: "grok-4.5 Codex",
        derivedFromProviderId: "codex",
        modelGatewayId: "grok-4-5",
        models: [
          {
            provider: "grok-4-5-codex",
            id: "grok-4.5",
            label: "grok-4.5",
          },
        ],
      } as Partial<ProviderSnapshotEntry> & Pick<ProviderSnapshotEntry, "provider">),
    ]);

    expect(providers).toEqual([
      {
        id: "grok-4-5-codex",
        label: "grok-4.5 Codex",
        status: "ready",
        error: null,
        modelSelection: {
          kind: "models",
          rows: [
            expect.objectContaining({
              provider: "grok-4-5-codex",
              agentProvider: "grok-4-5-codex",
              runtimeProvider: "grok-4-5-codex",
              modelId: "grok-4.5",
            }),
          ],
        },
      },
    ]);
  });

  it("surfaces non-ready providers with their state-specific selection", () => {
    expect(
      buildSelectableProviderSelectorProviders([
        snapshotEntry({ provider: "loading-provider", status: "loading", models: [] }),
        snapshotEntry({
          provider: "error-provider",
          status: "error",
          error: "boom",
          models: [],
        }),
        snapshotEntry({
          provider: "unavailable-provider",
          status: "unavailable",
          models: [],
        }),
      ]),
    ).toEqual([
      {
        id: "loading-provider",
        label: "loading-provider",
        modelSelection: { kind: "loading" },
        status: "loading",
        error: null,
      },
      {
        id: "error-provider",
        label: "error-provider",
        modelSelection: { kind: "error", message: "boom" },
        status: "error",
        error: "boom",
      },
      {
        id: "unavailable-provider",
        label: "unavailable-provider",
        modelSelection: { kind: "error", message: "Unavailable" },
        status: "unavailable",
        error: null,
      },
    ]);
  });

  it("keeps last-good cached models when a provider is in error", () => {
    const providers = buildSelectableProviderSelectorProviders([
      snapshotEntry({
        provider: "codex",
        label: "Codex",
        status: "error",
        error: "Timed out checking Codex availability after 30000ms",
        models: [codexModel],
      }),
    ]);
    expect(providers).toEqual([
      {
        id: "codex",
        label: "Codex",
        status: "error",
        error: "Timed out checking Codex availability after 30000ms",
        modelSelection: {
          kind: "models",
          rows: [
            expect.objectContaining({
              provider: "codex",
              modelId: "gpt-5.4",
            }),
          ],
        },
      },
    ]);
  });

  it("builds selector providers from an already-curated provider list", () => {
    const providerDefinitions: AgentProviderDefinition[] = [
      {
        id: "codex",
        label: "Codex",
        description: "Codex provider",
        defaultModeId: "auto",
        modes: [],
      },
    ];

    expect(
      buildProviderSelectorProviders({
        providerDefinitions,
        modelsByProvider: new Map([["codex", [codexModel]]]),
      }),
    ).toEqual([
      {
        id: "codex",
        label: "Codex",
        modelSelection: {
          kind: "models",
          rows: [
            expect.objectContaining({
              provider: "codex",
              providerLabel: "Codex",
              modelId: "gpt-5.4",
              modelLabel: "GPT-5.4",
            }),
          ],
        },
      },
    ]);
  });

  it("matches across label, provider, and description with multi-token fuzzy search", () => {
    const row = {
      favoriteKey: "opencode:opencode-zen/kimi-k2.5",
      provider: "opencode",
      agentProvider: "opencode",
      runtimeProvider: "opencode",
      providerLabel: "OpenCode",
      modelId: "opencode-zen/kimi-k2.5",
      modelLabel: "Kimi K2.5",
      description: "OpenCode Zen - kimi",
    };

    expect(matchesModelSearch(row, "kimi zen")).toBe(true);
    expect(matchesModelSearch(row, "zen kimi")).toBe(true);
    expect(matchesModelSearch(row, "k2.5 zen")).toBe(true);
    expect(matchesModelSearch(row, "kimi gemini")).toBe(false);
  });

  it("ranks model search results by fuzzy match quality", () => {
    const rows = [
      {
        favoriteKey: "openai:gpt-4.1",
        provider: "openai",
        agentProvider: "openai",
        runtimeProvider: "openai",
        providerLabel: "OpenAI",
        modelId: "gpt-4.1",
        modelLabel: "GPT-4.1",
      },
      {
        favoriteKey: "openai:gpt-5.4",
        provider: "openai",
        agentProvider: "openai",
        runtimeProvider: "openai",
        providerLabel: "OpenAI",
        modelId: "gpt-5.4",
        modelLabel: "GPT-5.4",
      },
      {
        favoriteKey: "google:gemini",
        provider: "google",
        agentProvider: "google",
        runtimeProvider: "google",
        providerLabel: "Google",
        modelId: "gemini",
        modelLabel: "Gemini",
      },
    ];

    expect(filterAndRankModelRows(rows, "gpt54").map((row) => row.modelId)).toEqual(["gpt-5.4"]);
  });

  it("keeps the selected trigger label model-only", () => {
    expect(buildSelectedTriggerLabel("GPT-5.4")).toBe("GPT-5.4");
  });

  it("resolves selected labels from explicit provider model-selection state", () => {
    const providers = buildSelectableProviderSelectorProviders([
      snapshotEntry({
        provider: "codex",
        label: "Codex",
        models: [codexModel],
      }),
      snapshotEntry({
        provider: "deepseek-tui",
        label: "DeepSeek TUI",
        models: [],
      }),
    ]);

    expect(
      resolveSelectedModelLabel({
        providers,
        selectedProvider: "codex",
        selectedModel: "gpt-5.4",
        isLoading: false,
      }),
    ).toBe("GPT-5.4");
    expect(
      resolveSelectedModelLabel({
        providers,
        selectedProvider: "deepseek-tui",
        selectedModel: "",
        isLoading: false,
      }),
    ).toBe("Default");
  });

  it("keeps the selected model visible while snapshot providers are not available", () => {
    expect(
      resolveSelectedModelLabel({
        providers: [],
        selectedProvider: "codex",
        selectedRuntimeProvider: "xiaomi-codex",
        selectedModel: "mimo-v2.5",
        isLoading: false,
      }),
    ).toBe("mimo-v2.5");
  });

  it("keeps provider snapshot errors visible in the selected trigger label", () => {
    const providers = buildSelectableProviderSelectorProviders([
      snapshotEntry({
        provider: "opencode",
        label: "OpenCode",
        status: "error",
        error: "OpenCode app.agents timed out after 10s",
        models: [],
      }),
    ]);

    expect(
      resolveSelectedModelLabel({
        providers,
        selectedProvider: "opencode",
        selectedModel: "",
        isLoading: false,
      }),
    ).toBe("Error");
  });

  it("preserves native Claude models when a derived gateway is present", () => {
    const providers = buildSelectableProviderSelectorProviders([
      snapshotEntry({
        provider: "claude",
        label: "Claude",
        status: "ready",
        models: [
          { provider: "claude", id: "claude-opus-4-8", label: "Opus 4.8" },
          { provider: "claude", id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
        ],
      }),
      snapshotEntry({
        provider: "custom-claude",
        label: "Custom Claude",
        derivedFromProviderId: "claude",
        modelGatewayId: "custom-gateway",
        status: "ready",
        models: [{ provider: "custom-claude", id: "custom-model", label: "Custom model" }],
      } as Partial<ProviderSnapshotEntry> & Pick<ProviderSnapshotEntry, "provider">),
    ]);

    expect(providers).toHaveLength(1);
    expect(providers[0]?.id).toBe("claude");
    expect(getProviderModelRows(providers[0]!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelId: "claude-opus-4-8", runtimeProvider: "claude" }),
        expect.objectContaining({ modelId: "claude-sonnet-4-6", runtimeProvider: "claude" }),
        expect.objectContaining({ modelId: "custom-model", runtimeProvider: "custom-claude" }),
      ]),
    );
  });

  it("keeps cached native models while the base provider refreshes", () => {
    const providers = buildSelectableProviderSelectorProviders([
      snapshotEntry({
        provider: "claude",
        label: "Claude",
        status: "loading",
        models: [{ provider: "claude", id: "claude-opus-4-8", label: "Opus 4.8" }],
      }),
      snapshotEntry({
        provider: "custom-claude",
        label: "Custom Claude",
        derivedFromProviderId: "claude",
        modelGatewayId: "custom-gateway",
        status: "ready",
        models: [{ provider: "custom-claude", id: "custom-model", label: "Custom model" }],
      } as Partial<ProviderSnapshotEntry> & Pick<ProviderSnapshotEntry, "provider">),
    ]);

    expect(getProviderModelRows(providers[0]!)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ modelId: "claude-opus-4-8" }),
        expect.objectContaining({ modelId: "custom-model" }),
      ]),
    );
  });

  it("returns observable submission readiness reasons", () => {
    expect(
      resolveSubmissionReadiness({
        text: "hello",
        allowsEmptyAutoSubmit: false,
        providerCount: 1,
        selection: {
          provider: "codex",
          modelId: "",
          availableModels: [codexModel],
          isModelLoading: false,
        },
        autoSubmitConfig: null,
        workspaceDirectory: "/repo",
        hasClient: true,
      }),
    ).toEqual({
      ok: false,
      reason: "No model is available for the selected provider",
    });

    expect(
      resolveSubmissionReadiness({
        text: "hello",
        allowsEmptyAutoSubmit: false,
        providerCount: 1,
        selection: {
          provider: "deepseek-tui",
          modelId: "",
          availableModels: [],
          isModelLoading: false,
        },
        autoSubmitConfig: null,
        workspaceDirectory: "/repo",
        hasClient: true,
      }),
    ).toEqual({ ok: true });
  });

  it("allows submission with an explicit selected model while provider defaults are loading", () => {
    expect(
      resolveSubmissionReadiness({
        text: "hello",
        allowsEmptyAutoSubmit: false,
        providerCount: 1,
        selection: {
          provider: "codex",
          modelId: "mimo-v2.5",
          availableModels: [],
          isModelLoading: true,
        },
        autoSubmitConfig: null,
        workspaceDirectory: "/repo",
        hasClient: true,
      }),
    ).toEqual({ ok: true });
  });
});

describe("findErrorSelectorProvider", () => {
  it("returns the selected provider when its snapshot is in error", () => {
    const providers = [
      {
        id: "codex",
        label: "Codex",
        status: "error" as const,
        error: "Timed out checking Codex availability after 30000ms",
        modelSelection: { kind: "models" as const, rows: [] },
      },
    ];
    expect(findErrorSelectorProvider(providers, "codex")).toEqual(providers[0]);
  });

  it("returns null when the selected provider is ready or missing", () => {
    const providers = [
      {
        id: "codex",
        label: "Codex",
        status: "ready" as const,
        error: null,
        modelSelection: { kind: "models" as const, rows: [] },
      },
    ];
    expect(findErrorSelectorProvider(providers, "codex")).toBeNull();
    expect(findErrorSelectorProvider(providers, "claude")).toBeNull();
    expect(findErrorSelectorProvider(providers, null)).toBeNull();
  });
});
