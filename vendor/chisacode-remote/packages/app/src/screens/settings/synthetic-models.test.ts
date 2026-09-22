import { describe, expect, it } from "vitest";
import {
  buildDeleteSyntheticModelPatch,
  buildSaveSyntheticModelPatch,
  collectSyntheticModelGateways,
  collectSyntheticModels,
  createLegacyMoaConfig,
  getGatewayModelListWithSyntheticModels,
} from "@/screens/settings/synthetic-models";
import type { MutableDaemonConfig } from "@chisacode/protocol/messages";

const modelGateways = {
  zai: {
    id: "zai",
    label: "ZAI",
    enabled: true,
    models: [
      { id: "glm-5", label: "GLM 5", isDefault: true },
      { id: "glm-5-air", label: "GLM 5 Air" },
      { id: "glm-4.6", label: "GLM 4.6" },
    ],
    syntheticModels: [
      {
        id: "moa-coder",
        label: "MoA Coder",
        references: [{ model: "glm-5" }, { model: "glm-5-air" }],
        aggregatorModel: "glm-5",
        rounds: 1,
      },
    ],
    upstreams: {
      anthropic: { enabled: false, baseUrl: "", apiKey: "" },
      chatCompletions: { enabled: true, baseUrl: "https://api.z.ai/v1", apiKey: "sk-chat" },
      responses: { enabled: false, baseUrl: "", apiKey: "" },
    },
  },
} satisfies NonNullable<MutableDaemonConfig["modelGateways"]>;

describe("synthetic model helpers", () => {
  it("collects configured synthetic model gateways and models", () => {
    expect(collectSyntheticModelGateways(modelGateways)).toMatchObject([
      {
        id: "zai",
        label: "ZAI",
        models: [{ id: "glm-5" }, { id: "glm-5-air" }, { id: "glm-4.6" }],
      },
    ]);
    expect(collectSyntheticModels(modelGateways)).toEqual([
      {
        id: "moa-coder",
        label: "MoA Coder",
        references: [{ model: "glm-5" }, { model: "glm-5-air" }],
        aggregatorModel: "glm-5",
        rounds: 1,
        gatewayId: "zai",
        gatewayLabel: "ZAI",
      },
    ]);
  });

  it("keeps gateway supplyScope untouched when patching synthetic models", () => {
    const gatewaysWithScope = {
      zai: {
        ...modelGateways.zai,
        supplyScope: "all" as const,
      },
    } satisfies NonNullable<MutableDaemonConfig["modelGateways"]>;

    const patch = buildSaveSyntheticModelPatch({
      currentGateways: gatewaysWithScope,
      gatewayId: "zai",
      id: "moa-reviewer",
      label: "MoA Reviewer",
      references: ["glm-5", "glm-4.6"],
      aggregatorModel: "glm-5",
      rounds: 2,
    });

    // The gateway patch only carries models/syntheticModels; supplyScope is not
    // overwritten, so the config-store deepMerge keeps the stored value.
    expect(patch.modelGateways?.zai).not.toHaveProperty("supplyScope");
    expect(patch.modelGateways?.zai).not.toHaveProperty("attachToAllAgents");
    expect(patch.modelGateways?.zai?.syntheticModels).toEqual([
      expect.objectContaining({ id: "moa-coder" }),
      expect.objectContaining({ id: "moa-reviewer" }),
    ]);
  });

  it("builds a gateway patch for a synthetic model", () => {
    expect(
      buildSaveSyntheticModelPatch({
        currentGateways: modelGateways,
        previousGatewayId: "zai",
        previousId: "moa-coder",
        gatewayId: "zai",
        id: "moa-reviewer",
        label: "MoA Reviewer",
        references: ["glm-5", "glm-4.6"],
        aggregatorModel: "glm-5",
        rounds: 2,
      }),
    ).toEqual({
      modelGateways: {
        zai: {
          models: modelGateways.zai.models,
          syntheticModels: [
            {
              id: "moa-reviewer",
              label: "MoA Reviewer",
              references: [{ model: "glm-5" }, { model: "glm-4.6" }],
              aggregatorModel: "glm-5",
              rounds: 2,
            },
          ],
        },
      },
    });
  });

  it("builds a gateway patch for a layered MoA model while preserving legacy summary fields", () => {
    expect(
      buildSaveSyntheticModelPatch({
        currentGateways: modelGateways,
        gatewayId: "zai",
        id: "moa-layered",
        label: "MoA Layered",
        references: ["glm-5-air", "glm-4.6"],
        aggregatorModel: "glm-5",
        rounds: 1,
        moa: {
          defaults: { temperature: 0.4, maxTokens: 1024 },
          layers: [
            {
              id: "layer-1",
              label: "Draft",
              nodes: [{ model: "glm-5-air" }, { model: "glm-4.6" }],
            },
            {
              id: "layer-2",
              label: "Refine",
              nodes: [{ model: "glm-5-air", parameters: { temperature: 0.2 } }],
            },
          ],
          aggregator: {
            model: "glm-5",
            parameters: { systemPrompt: "Synthesize carefully." },
          },
        },
      }),
    ).toEqual({
      modelGateways: {
        zai: {
          models: modelGateways.zai.models,
          syntheticModels: [
            modelGateways.zai.syntheticModels[0],
            {
              id: "moa-layered",
              label: "MoA Layered",
              references: [{ model: "glm-5-air" }, { model: "glm-4.6" }],
              aggregatorModel: "glm-5",
              rounds: 1,
              moa: {
                defaults: { temperature: 0.4, maxTokens: 1024 },
                layers: [
                  {
                    id: "layer-1",
                    label: "Draft",
                    nodes: [{ model: "glm-5-air" }, { model: "glm-4.6" }],
                  },
                  {
                    id: "layer-2",
                    label: "Refine",
                    nodes: [{ model: "glm-5-air", parameters: { temperature: 0.2 } }],
                  },
                ],
                aggregator: {
                  model: "glm-5",
                  parameters: { systemPrompt: "Synthesize carefully." },
                },
              },
            },
          ],
        },
      },
    });
  });

  it("allows a layered MoA synthetic model with one configured model per stage", () => {
    expect(
      buildSaveSyntheticModelPatch({
        currentGateways: modelGateways,
        gatewayId: "zai",
        id: "single-model-moa",
        label: "Single Model MoA",
        references: ["glm-5"],
        aggregatorModel: "glm-5",
        rounds: 2,
        moa: {
          layers: [
            {
              id: "layer-1",
              label: "Draft",
              nodes: [{ model: "glm-5" }],
            },
            {
              id: "layer-2",
              label: "Review",
              nodes: [{ model: "glm-5" }],
            },
          ],
          aggregator: { model: "glm-5" },
        },
      }),
    ).toMatchObject({
      modelGateways: {
        zai: {
          syntheticModels: [
            modelGateways.zai.syntheticModels[0],
            {
              id: "single-model-moa",
              references: [{ model: "glm-5" }],
              aggregatorModel: "glm-5",
              rounds: 2,
              moa: {
                layers: [
                  { id: "layer-1", nodes: [{ model: "glm-5" }] },
                  { id: "layer-2", nodes: [{ model: "glm-5" }] },
                ],
                aggregator: { model: "glm-5" },
              },
            },
          ],
        },
      },
    });
  });

  it("allows empty MoA stages and preserves them for runtime skipping", () => {
    expect(
      buildSaveSyntheticModelPatch({
        currentGateways: modelGateways,
        gatewayId: "zai",
        id: "skip-empty-layer",
        label: "Skip Empty Layer",
        references: ["glm-5"],
        aggregatorModel: "glm-5",
        rounds: 2,
        moa: {
          layers: [
            {
              id: "layer-1",
              label: "Draft",
              nodes: [],
            },
            {
              id: "layer-2",
              label: "Review",
              nodes: [{ model: "glm-5" }],
            },
          ],
          aggregator: { model: "glm-5" },
        },
      }),
    ).toMatchObject({
      modelGateways: {
        zai: {
          syntheticModels: [
            modelGateways.zai.syntheticModels[0],
            {
              id: "skip-empty-layer",
              references: [{ model: "glm-5" }],
              aggregatorModel: "glm-5",
              rounds: 2,
              moa: {
                layers: [
                  { id: "layer-1", nodes: [] },
                  { id: "layer-2", nodes: [{ model: "glm-5" }] },
                ],
                aggregator: { model: "glm-5" },
              },
            },
          ],
        },
      },
    });
  });

  it("appends synthetic models to gateway model lists used by agent model selection", () => {
    expect(
      getGatewayModelListWithSyntheticModels(modelGateways.zai).map((model) => model.id),
    ).toEqual(["glm-5", "glm-5-air", "glm-4.6", "moa-coder"]);
  });

  it("creates a legacy-compatible MoA config from references and rounds", () => {
    expect(
      createLegacyMoaConfig({
        references: [{ model: "glm-5" }, { model: "glm-5-air" }],
        aggregatorModel: "glm-5",
        rounds: 2,
      }),
    ).toEqual({
      layers: [
        {
          id: "layer-1",
          label: "Layer 1",
          nodes: [{ model: "glm-5" }, { model: "glm-5-air" }],
        },
        {
          id: "layer-2",
          label: "Layer 2",
          nodes: [{ model: "glm-5" }, { model: "glm-5-air" }],
        },
      ],
      aggregator: { model: "glm-5" },
    });
  });

  it("builds a delete patch for a synthetic model", () => {
    expect(
      buildDeleteSyntheticModelPatch({
        currentGateways: modelGateways,
        gatewayId: "zai",
        id: "moa-coder",
      }),
    ).toEqual({
      modelGateways: {
        zai: {
          models: modelGateways.zai.models,
          syntheticModels: [],
        },
      },
    });
  });
});
