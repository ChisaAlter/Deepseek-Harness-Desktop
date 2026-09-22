import { describe, expect, it } from "vitest";
import {
  buildDeleteSavedModelPatch,
  buildDisableCustomModelProviderPatch,
  buildModelGatewayProviderIdList,
  buildModelGatewayProviderIds,
  buildSaveCustomModelProviderPatch,
  buildSaveOpenAiCompatibleModelPatch,
  collectCustomModelProviders,
  collectSavedModels,
} from "@/screens/settings/custom-model-providers";
import type { MutableDaemonConfig } from "@chisacode/protocol/messages";

function makeProviders(
  providers: MutableDaemonConfig["providers"],
): MutableDaemonConfig["providers"] {
  return providers;
}

describe("custom model provider helpers", () => {
  it("builds one model gateway from one supplier with three supported upstream formats", () => {
    expect(
      buildSaveCustomModelProviderPatch({
        currentGateways: {},
        id: "zai",
        label: "ZAI",
        models: [
          {
            id: "glm-5",
            contextWindowMaxTokens: 200_000,
            supportsImages: true,
          },
          { id: "glm-5-air" },
        ],
        anthropic: {
          enabled: true,
          baseUrl: "https://api.z.ai/api/anthropic",
          apiKey: "sk-anthropic",
        },
        openai: {
          enabled: true,
          baseUrl: "https://api.z.ai/v1",
          apiKey: "sk-openai",
          wireApi: "responses",
        },
        responses: {
          enabled: true,
          baseUrl: "https://api.z.ai/responses",
          apiKey: "sk-responses",
        },
      }),
    ).toEqual({
      modelGateways: {
        zai: {
          id: "zai",
          label: "ZAI",
          enabled: true,
          protocolPreset: "all",
          models: [
            {
              id: "glm-5",
              label: "glm-5",
              contextWindowMaxTokens: 200_000,
              supportsImages: true,
              isDefault: true,
            },
            { id: "glm-5-air", label: "glm-5-air" },
          ],
          upstreams: {
            anthropic: {
              enabled: true,
              baseUrl: "https://api.z.ai/api/anthropic",
              apiKey: "sk-anthropic",
            },
            chatCompletions: {
              enabled: true,
              baseUrl: "https://api.z.ai/v1",
              apiKey: "sk-openai",
            },
            responses: {
              enabled: true,
              baseUrl: "https://api.z.ai/responses",
              apiKey: "sk-responses",
            },
          },
          generatedProviderIds: {
            claude: "zai-claude",
            codex: "zai-codex",
            opencode: "zai-opencode",
            pi: "zai-pi",
            kimi: "zai-kimi",
            grokbuild: "zai-grokbuild",
            dsh: "zai-dsh",
          },
          generatedModels: {
            opencode: [
              {
                id: "openai/glm-5",
                label: "glm-5",
                contextWindowMaxTokens: 200_000,
                supportsImages: true,
                isDefault: true,
              },
              { id: "openai/glm-5-air", label: "glm-5-air" },
            ],
            pi: [
              {
                id: "openai/glm-5",
                label: "glm-5",
                contextWindowMaxTokens: 200_000,
                supportsImages: true,
                isDefault: true,
              },
              { id: "openai/glm-5-air", label: "glm-5-air" },
            ],
            kimi: [
              {
                id: "glm-5",
                label: "glm-5",
                contextWindowMaxTokens: 200_000,
                supportsImages: true,
                isDefault: true,
              },
              { id: "glm-5-air", label: "glm-5-air" },
            ],
            grokbuild: [
              {
                id: "glm-5",
                label: "glm-5",
                contextWindowMaxTokens: 200_000,
                supportsImages: true,
                isDefault: true,
              },
              { id: "glm-5-air", label: "glm-5-air" },
            ],
            dsh: [
              {
                id: "glm-5",
                label: "glm-5",
                contextWindowMaxTokens: 200_000,
                supportsImages: true,
                isDefault: true,
              },
              { id: "glm-5-air", label: "glm-5-air" },
            ],
          },
        },
      },
    });
  });

  it("returns generated provider IDs for every built-in agent", () => {
    expect(buildModelGatewayProviderIds("zai")).toEqual({
      claudeProviderId: "zai-claude",
      codexProviderId: "zai-codex",
      opencodeProviderId: "zai-opencode",
      piProviderId: "zai-pi",
      kimiProviderId: "zai-kimi",
      grokbuildProviderId: "zai-grokbuild",
      dshProviderId: "zai-dsh",
    });
  });

  it("disables an omitted gateway format while preserving the remaining format", () => {
    const currentGateways = {
      zai: {
        id: "zai",
        label: "ZAI",
        enabled: true,
        models: [{ id: "glm-5", label: "GLM 5", isDefault: true }],
        syntheticModels: [],
        upstreams: {
          anthropic: {
            enabled: true,
            baseUrl: "https://api.z.ai/api/anthropic",
            apiKey: "sk-anthropic",
          },
          chatCompletions: {
            enabled: true,
            baseUrl: "https://api.z.ai/v1",
            apiKey: "sk-openai",
          },
          responses: {
            enabled: false,
            baseUrl: "",
            apiKey: "",
          },
        },
      },
    } satisfies NonNullable<MutableDaemonConfig["modelGateways"]>;

    expect(
      buildSaveCustomModelProviderPatch({
        currentGateways,
        previousId: "zai",
        id: "zai",
        label: "ZAI",
        models: ["glm-5"],
        anthropic: {
          enabled: false,
          baseUrl: "",
          apiKey: "",
        },
        openai: {
          enabled: true,
          baseUrl: "https://api.z.ai/v1",
          apiKey: "sk-openai",
          wireApi: "chat",
        },
        responses: {
          enabled: false,
          baseUrl: "",
          apiKey: "",
        },
      }),
    ).toEqual({
      modelGateways: {
        zai: {
          id: "zai",
          label: "ZAI",
          enabled: true,
          protocolPreset: "openai",
          models: [{ id: "glm-5", label: "glm-5", isDefault: true }],
          upstreams: {
            anthropic: {
              enabled: false,
              baseUrl: "",
              apiKey: "",
            },
            chatCompletions: {
              enabled: true,
              baseUrl: "https://api.z.ai/v1",
              apiKey: "sk-openai",
            },
            responses: {
              enabled: false,
              baseUrl: "",
              apiKey: "",
            },
          },
          generatedProviderIds: {
            claude: "zai-claude",
            codex: "zai-codex",
            opencode: "zai-opencode",
            pi: "zai-pi",
            kimi: "zai-kimi",
            grokbuild: "zai-grokbuild",
            dsh: "zai-dsh",
          },
          generatedModels: {
            opencode: [{ id: "openai/glm-5", label: "glm-5", isDefault: true }],
            pi: [{ id: "openai/glm-5", label: "glm-5", isDefault: true }],
            kimi: [{ id: "glm-5", label: "glm-5", isDefault: true }],
            grokbuild: [{ id: "glm-5", label: "glm-5", isDefault: true }],
            dsh: [{ id: "glm-5", label: "glm-5", isDefault: true }],
          },
        },
      },
    });
  });

  it("collects legacy paired provider entries back into supplier rows", () => {
    const providers = makeProviders({
      "zai-anthropic": {
        extends: "claude",
        label: "ZAI Anthropic",
        env: {
          ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
          ANTHROPIC_AUTH_TOKEN: "secret",
        },
        models: [{ id: "glm-5", label: "GLM 5", isDefault: true }],
        enabled: true,
      },
      "zai-openai": {
        extends: "codex",
        label: "ZAI OpenAI",
        env: {
          OPENAI_BASE_URL: "https://api.z.ai/v1",
          OPENAI_API_KEY: "secret",
          OPENAI_WIRE_API: "chat",
        },
        models: [{ id: "glm-5", label: "GLM 5", isDefault: true }],
        enabled: true,
      },
    });

    expect(collectCustomModelProviders(undefined, providers)).toEqual([
      {
        id: "zai",
        label: "ZAI",
        providerIds: ["zai-anthropic", "zai-openai"],
        models: [{ id: "glm-5", label: "GLM 5", isDefault: true }],
        anthropic: {
          providerId: "zai-anthropic",
          enabled: true,
          baseUrl: "https://api.z.ai/api/anthropic",
          hasApiKey: true,
        },
        openai: {
          providerId: "zai-openai",
          enabled: true,
          baseUrl: "https://api.z.ai/v1",
          hasApiKey: true,
          wireApi: "chat",
        },
        responses: null,
      },
    ]);
  });

  it("builds a disable patch for a gateway", () => {
    expect(buildDisableCustomModelProviderPatch("zai")).toEqual({
      modelGateways: {
        zai: { enabled: false },
      },
    });
  });

  it("flattens enabled gateway models into saved-model rows", () => {
    const gateways = {
      zai: {
        id: "zai",
        label: "ZAI",
        enabled: true,
        models: [
          {
            id: "glm-5",
            label: "GLM 5",
            isDefault: true,
            supportsTools: true,
            thinkingOptions: [{ id: "default", label: "Thinking", isDefault: true }],
          },
          { id: "glm-5-air", label: "GLM 5 Air", supportsImages: true },
        ],
        syntheticModels: [],
        upstreams: {
          anthropic: { enabled: false, baseUrl: "", apiKey: "" },
          chatCompletions: {
            enabled: true,
            baseUrl: "https://api.z.ai/v1",
            apiKey: "sk",
          },
          responses: { enabled: false, baseUrl: "", apiKey: "" },
        },
      },
      disabled: {
        id: "disabled",
        label: "Disabled",
        enabled: false,
        models: [{ id: "hidden", label: "Hidden" }],
        syntheticModels: [],
        upstreams: {
          anthropic: { enabled: false, baseUrl: "", apiKey: "" },
          chatCompletions: { enabled: false, baseUrl: "", apiKey: "" },
          responses: { enabled: false, baseUrl: "", apiKey: "" },
        },
      },
    } satisfies NonNullable<MutableDaemonConfig["modelGateways"]>;

    expect(collectSavedModels(gateways)).toEqual([
      {
        key: "zai:glm-5",
        gatewayId: "zai",
        gatewayLabel: "ZAI",
        modelId: "glm-5",
        label: "GLM 5",
        supportsTools: true,
        supportsThinking: true,
        thinkingMode: "single",
        thinkingLevels: [],
        thinkingOptions: [{ id: "default", label: "Thinking", isDefault: true }],
        protocolPreset: "openai",
        supplyScope: "matched",
        providerIds: ["zai-opencode", "zai-pi", "zai-kimi", "zai-grokbuild", "zai-dsh"],
        baseUrl: "https://api.z.ai/v1",
      },
      {
        key: "zai:glm-5-air",
        gatewayId: "zai",
        gatewayLabel: "ZAI",
        modelId: "glm-5-air",
        label: "GLM 5 Air",
        supportsImages: true,
        thinkingMode: "off",
        protocolPreset: "openai",
        supplyScope: "matched",
        providerIds: ["zai-opencode", "zai-pi", "zai-kimi", "zai-grokbuild", "zai-dsh"],
        baseUrl: "https://api.z.ai/v1",
      },
    ]);
  });

  it("flattens attachToAllAgents gateways into all seven provider ids", () => {
    const gateways = {
      deepseek: {
        id: "deepseek",
        label: "DeepSeek",
        enabled: true,
        models: [{ id: "deepseek-chat", label: "DeepSeek Chat" }],
        syntheticModels: [],
        protocolPreset: "openai",
        attachToAllAgents: true,
        upstreams: {
          anthropic: { enabled: false, baseUrl: "", apiKey: "" },
          chatCompletions: {
            enabled: true,
            baseUrl: "https://api.deepseek.com/v1",
            apiKey: "sk",
          },
          responses: { enabled: false, baseUrl: "", apiKey: "" },
        },
      },
    } satisfies NonNullable<MutableDaemonConfig["modelGateways"]>;

    expect(collectSavedModels(gateways)).toEqual([
      {
        key: "deepseek:deepseek-chat",
        gatewayId: "deepseek",
        gatewayLabel: "DeepSeek",
        modelId: "deepseek-chat",
        label: "DeepSeek Chat",
        thinkingMode: "off",
        protocolPreset: "openai",
        supplyScope: "all",
        attachToAllAgents: true,
        providerIds: [
          "deepseek-claude",
          "deepseek-codex",
          "deepseek-opencode",
          "deepseek-pi",
          "deepseek-kimi",
          "deepseek-grokbuild",
          "deepseek-dsh",
        ],
        baseUrl: "https://api.deepseek.com/v1",
      },
    ]);
  });

  it("saves an OpenAI-compatible model as a chatCompletions-only gateway", () => {
    const patch = buildSaveOpenAiCompatibleModelPatch({
      currentGateways: {},
      modelId: "gpt-4o",
      label: "GPT-4o",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      supportsTools: true,
      supportsImages: true,
      thinkingMode: "levels",
      protocolPreset: "openai",
      contextWindowMaxTokens: 131_072,
    });

    expect(patch.modelGateways?.["gpt-4o"]).toMatchObject({
      id: "gpt-4o",
      label: "GPT-4o",
      enabled: true,
      protocolPreset: "openai",
      models: [
        {
          id: "gpt-4o",
          label: "GPT-4o",
          supportsTools: true,
          supportsImages: true,
          contextWindowMaxTokens: 131_072,
          thinkingOptions: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium", isDefault: true },
            { id: "high", label: "High" },
            { id: "very-high", label: "Very High" },
            { id: "max", label: "Max" },
          ],
          isDefault: true,
        },
      ],
      upstreams: {
        anthropic: { enabled: false, baseUrl: "", apiKey: "" },
        chatCompletions: {
          enabled: true,
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
        },
        responses: { enabled: false, baseUrl: "", apiKey: "" },
      },
    });
  });

  it("writes attachToAllAgents and keeps the protocol preset when attaching to all agents", () => {
    const patch = buildSaveOpenAiCompatibleModelPatch({
      currentGateways: {},
      modelId: "glm-air",
      label: "GLM Air",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      supportsTools: true,
      thinkingMode: "off",
      protocolPreset: "openai",
      attachToAllAgents: true,
    });

    expect(patch.modelGateways?.["glm-air"]).toMatchObject({
      id: "glm-air",
      enabled: true,
      protocolPreset: "openai",
      attachToAllAgents: true,
      upstreams: {
        anthropic: { enabled: false, baseUrl: "", apiKey: "" },
        chatCompletions: {
          enabled: true,
          baseUrl: "https://api.example.com/v1",
          apiKey: "sk-test",
        },
        responses: { enabled: false, baseUrl: "", apiKey: "" },
      },
    });
  });

  it("merges a model into an existing multi-model gateway and deletes one model without removing the rest", () => {
    const currentGateways = {
      zai: {
        id: "zai",
        label: "ZAI",
        enabled: true,
        models: [
          { id: "glm-5", label: "GLM 5", isDefault: true },
          { id: "glm-5-air", label: "GLM 5 Air" },
        ],
        syntheticModels: [],
        upstreams: {
          anthropic: { enabled: false, baseUrl: "", apiKey: "" },
          chatCompletions: {
            enabled: true,
            baseUrl: "https://api.z.ai/v1",
            apiKey: "sk",
          },
          responses: { enabled: false, baseUrl: "", apiKey: "" },
        },
      },
    } satisfies NonNullable<MutableDaemonConfig["modelGateways"]>;

    const savePatch = buildSaveOpenAiCompatibleModelPatch({
      currentGateways,
      gatewayId: "zai",
      previousModelId: "glm-5-air",
      modelId: "glm-5-air",
      label: "GLM 5 Air",
      baseUrl: "https://api.z.ai/v1",
      apiKey: "sk",
      supportsImages: true,
    });

    expect(savePatch.modelGateways?.zai?.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "glm-5" }),
        expect.objectContaining({ id: "glm-5-air", supportsImages: true }),
      ]),
    );

    const deleteOne = buildDeleteSavedModelPatch({
      currentGateways,
      gatewayId: "zai",
      modelId: "glm-5-air",
    });
    expect(deleteOne.modelGateways?.zai?.models).toEqual([
      expect.objectContaining({ id: "glm-5", label: "GLM 5" }),
    ]);

    const deleteLast = buildDeleteSavedModelPatch({
      currentGateways: {
        zai: {
          ...currentGateways.zai,
          models: [{ id: "glm-5", label: "GLM 5", isDefault: true }],
        },
      },
      gatewayId: "zai",
      modelId: "glm-5",
    });
    expect(deleteLast).toEqual({
      modelGateways: {
        zai: { enabled: false },
      },
    });
  });

  it("always writes supplyScope on a supporting daemon and derives it when omitted", () => {
    const derivedPatch = buildSaveOpenAiCompatibleModelPatch({
      currentGateways: {},
      supplyScopeSupported: true,
      modelId: "derived-model",
      label: "Derived",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      protocolPreset: "openai",
    });
    expect(derivedPatch.modelGateways?.["derived"]).toMatchObject({
      supplyScope: "matched",
    });
    expect(derivedPatch.modelGateways?.["derived"]).not.toHaveProperty("attachToAllAgents");

    const explicitPatch = buildSaveOpenAiCompatibleModelPatch({
      currentGateways: {},
      supplyScopeSupported: true,
      supplyScope: "all",
      modelId: "explicit-model",
      label: "Explicit",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      protocolPreset: "openai",
    });
    expect(explicitPatch.modelGateways?.["explicit"]).toMatchObject({
      supplyScope: "all",
    });
    expect(explicitPatch.modelGateways?.["explicit"]).not.toHaveProperty("attachToAllAgents");
  });

  it("overrides a legacy attachToAllAgents gateway with explicit supplyScope on save", () => {
    const currentGateways = {
      legacy: {
        id: "legacy",
        label: "Legacy",
        enabled: true,
        protocolPreset: "openai",
        attachToAllAgents: true,
        models: [{ id: "legacy-model", label: "Legacy Model" }],
        syntheticModels: [],
        upstreams: {
          anthropic: { enabled: false, baseUrl: "", apiKey: "" },
          chatCompletions: {
            enabled: true,
            baseUrl: "https://api.example.com/v1",
            apiKey: "sk",
          },
          responses: { enabled: false, baseUrl: "", apiKey: "" },
        },
      },
    } satisfies NonNullable<MutableDaemonConfig["modelGateways"]>;

    const patch = buildSaveOpenAiCompatibleModelPatch({
      currentGateways,
      gatewayId: "legacy",
      previousModelId: "legacy-model",
      supplyScopeSupported: true,
      supplyScope: "matched",
      modelId: "legacy-model",
      label: "Legacy Model",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk",
      protocolPreset: "openai",
    });

    expect(patch.modelGateways?.legacy).toMatchObject({
      supplyScope: "matched",
    });
    // The stale attachToAllAgents key must not be re-written by the new path.
    expect(patch.modelGateways?.legacy).not.toHaveProperty("attachToAllAgents");
  });

  it("falls back to attachToAllAgents writes on daemons without supplyScope support", () => {
    const patch = buildSaveOpenAiCompatibleModelPatch({
      currentGateways: {},
      supplyScopeSupported: false,
      supplyScope: "all",
      modelId: "legacy-daemon",
      label: "Legacy Daemon",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      protocolPreset: "openai",
      attachToAllAgents: true,
    });
    expect(patch.modelGateways?.["legacy-daemon"]).toMatchObject({
      attachToAllAgents: true,
    });
    expect(patch.modelGateways?.["legacy-daemon"]).not.toHaveProperty("supplyScope");

    const matchedPatch = buildSaveOpenAiCompatibleModelPatch({
      currentGateways: {},
      supplyScopeSupported: false,
      supplyScope: "matched",
      modelId: "legacy-daemon-matched",
      label: "Legacy Daemon Matched",
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      protocolPreset: "openai",
      attachToAllAgents: false,
    });
    expect(matchedPatch.modelGateways?.["legacy-daemon-matched"]).not.toHaveProperty("supplyScope");
    expect(matchedPatch.modelGateways?.["legacy-daemon-matched"]).not.toHaveProperty(
      "attachToAllAgents",
    );
  });

  it("normalizes supplyScope when re-saving a gateway through the delete path", () => {
    const currentGateways = {
      zai: {
        id: "zai",
        label: "ZAI",
        enabled: true,
        protocolPreset: "openai",
        attachToAllAgents: true,
        models: [
          { id: "glm-5", label: "GLM 5", isDefault: true },
          { id: "glm-5-air", label: "GLM 5 Air" },
        ],
        syntheticModels: [],
        upstreams: {
          anthropic: { enabled: false, baseUrl: "", apiKey: "" },
          chatCompletions: {
            enabled: true,
            baseUrl: "https://api.z.ai/v1",
            apiKey: "sk",
          },
          responses: { enabled: false, baseUrl: "", apiKey: "" },
        },
      },
    } satisfies NonNullable<MutableDaemonConfig["modelGateways"]>;

    const patch = buildDeleteSavedModelPatch({
      currentGateways,
      supplyScopeSupported: true,
      gatewayId: "zai",
      modelId: "glm-5-air",
    });

    expect(patch.modelGateways?.zai).toMatchObject({
      supplyScope: "all",
    });
  });

  it("resolves effective supply scope on the read path mirroring the server closed set", () => {
    const collect = (gateway: NonNullable<MutableDaemonConfig["modelGateways"]>[string]) =>
      collectSavedModels({ zai: gateway })[0]?.supplyScope;

    const baseUpstreams = {
      anthropic: { enabled: false, baseUrl: "", apiKey: "" },
      chatCompletions: { enabled: true, baseUrl: "https://api.z.ai/v1", apiKey: "sk" },
      responses: { enabled: false, baseUrl: "", apiKey: "" },
    };

    // stored supplyScope wins over everything else
    expect(
      collect({
        id: "zai",
        label: "ZAI",
        enabled: true,
        supplyScope: "all",
        attachToAllAgents: false,
        protocolPreset: "openai",
        models: [{ id: "m", label: "M" }],
        syntheticModels: [],
        upstreams: baseUpstreams,
      }),
    ).toBe("all");

    // legacy attachToAllAgents=true maps to "all"
    expect(
      collect({
        id: "zai",
        label: "ZAI",
        enabled: true,
        attachToAllAgents: true,
        protocolPreset: "openai",
        models: [{ id: "m", label: "M" }],
        syntheticModels: [],
        upstreams: baseUpstreams,
      }),
    ).toBe("all");

    // stored preset "all" → "all"
    expect(
      collect({
        id: "zai",
        label: "ZAI",
        enabled: true,
        protocolPreset: "all",
        models: [{ id: "m", label: "M" }],
        syntheticModels: [],
        upstreams: baseUpstreams,
      }),
    ).toBe("all");

    // stored preset wins over a multi-upstream inference (reverse scenario)
    expect(
      collect({
        id: "zai",
        label: "ZAI",
        enabled: true,
        protocolPreset: "claude",
        models: [{ id: "m", label: "M" }],
        syntheticModels: [],
        upstreams: {
          anthropic: { enabled: true, baseUrl: "https://a.example.com", apiKey: "k1" },
          chatCompletions: { enabled: true, baseUrl: "https://c.example.com/v1", apiKey: "k2" },
          responses: { enabled: false, baseUrl: "", apiKey: "" },
        },
      }),
    ).toBe("matched");

    // no preset, single upstream → "matched"
    expect(
      collect({
        id: "zai",
        label: "ZAI",
        enabled: true,
        models: [{ id: "m", label: "M" }],
        syntheticModels: [],
        upstreams: baseUpstreams,
      }),
    ).toBe("matched");

    // no preset, multiple upstreams → "all"
    expect(
      collect({
        id: "zai",
        label: "ZAI",
        enabled: true,
        models: [{ id: "m", label: "M" }],
        syntheticModels: [],
        upstreams: {
          anthropic: { enabled: true, baseUrl: "https://a.example.com", apiKey: "k1" },
          chatCompletions: { enabled: true, baseUrl: "https://c.example.com/v1", apiKey: "k2" },
          responses: { enabled: false, baseUrl: "", apiKey: "" },
        },
      }),
    ).toBe("all");
  });

  it("builds provider id lists from supplyScope semantics", () => {
    const allScope = buildModelGatewayProviderIdList("zai", {
      supplyScope: "all",
      protocolPreset: "openai",
    });
    expect(allScope).toEqual([
      "zai-claude",
      "zai-codex",
      "zai-opencode",
      "zai-pi",
      "zai-kimi",
      "zai-grokbuild",
      "zai-dsh",
    ]);

    const matchedScope = buildModelGatewayProviderIdList("zai", {
      supplyScope: "matched",
      protocolPreset: "openai",
    });
    expect(matchedScope).toEqual([
      "zai-opencode",
      "zai-pi",
      "zai-kimi",
      "zai-grokbuild",
      "zai-dsh",
    ]);

    const matchedClaude = buildModelGatewayProviderIdList("zai", {
      supplyScope: "matched",
      protocolPreset: "claude",
    });
    expect(matchedClaude).toEqual(["zai-claude"]);

    // supplyScope beats a conflicting attachToAllAgents
    const scopeWins = buildModelGatewayProviderIdList("zai", {
      supplyScope: "matched",
      protocolPreset: "claude",
      attachToAllAgents: true,
    });
    expect(scopeWins).toEqual(["zai-claude"]);
  });
});
