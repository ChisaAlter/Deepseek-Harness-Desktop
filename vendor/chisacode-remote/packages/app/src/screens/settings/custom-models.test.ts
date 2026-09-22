import { describe, expect, it } from "vitest";
import type { ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";
import type { MutableDaemonConfig } from "@chisacode/protocol/messages";
import {
  buildAddCustomModelToProviderPatch,
  buildDeleteCustomModelPatch,
  buildDeleteCustomModelFromProviderPatch,
  buildSaveCustomModelPatch,
  collectCustomModels,
  getSelectableCustomModelProviders,
} from "@/screens/settings/custom-models";

function makeProviders(
  providers: MutableDaemonConfig["providers"],
): MutableDaemonConfig["providers"] {
  return providers;
}

const snapshotEntries: ProviderSnapshotEntry[] = [
  {
    provider: "claude",
    label: "Claude",
    status: "ready",
    enabled: true,
    defaultModeId: null,
    modes: [],
  },
  {
    provider: "codex",
    label: "Codex",
    status: "ready",
    enabled: true,
    defaultModeId: null,
    modes: [],
  },
  {
    provider: "copilot",
    label: "Copilot",
    status: "unavailable",
    enabled: true,
    defaultModeId: null,
    modes: [],
  },
];

describe("custom model settings helpers", () => {
  it("collects custom models across providers", () => {
    const providers = makeProviders({
      claude: {
        additionalModels: [
          { id: "glm-5", label: "GLM 5" },
          { id: "qwen3-coder", label: "qwen3-coder" },
        ],
      },
      codex: {
        additionalModels: [{ id: "glm-5", label: "GLM 5" }],
      },
    });

    expect(collectCustomModels({ providers, snapshotEntries })).toEqual([
      {
        id: "glm-5",
        label: "GLM 5",
        providerIds: ["claude", "codex"],
        providers: [
          { id: "claude", label: "Claude" },
          { id: "codex", label: "Codex" },
        ],
      },
      {
        id: "qwen3-coder",
        label: "qwen3-coder",
        providerIds: ["claude"],
        providers: [{ id: "claude", label: "Claude" }],
      },
    ]);
  });

  it("returns enabled available providers for model assignment", () => {
    expect(getSelectableCustomModelProviders(snapshotEntries)).toEqual([
      { id: "claude", label: "Claude" },
      { id: "codex", label: "Codex" },
    ]);
  });

  it("adds one model to multiple providers without duplicating ids", () => {
    const providers = makeProviders({
      claude: {
        enabled: true,
        additionalModels: [{ id: "glm-5", label: "Old GLM" }],
      },
      codex: {
        additionalModels: [{ id: "gpt-custom", label: "GPT Custom" }],
      },
    });

    expect(
      buildSaveCustomModelPatch({
        currentProviders: providers,
        id: "glm-5",
        label: "GLM 5",
        providerIds: ["claude", "codex"],
      }),
    ).toEqual({
      providers: {
        claude: { additionalModels: [{ id: "glm-5", label: "GLM 5" }] },
        codex: {
          additionalModels: [
            { id: "gpt-custom", label: "GPT Custom" },
            { id: "glm-5", label: "GLM 5" },
          ],
        },
      },
    });
  });

  it("updates label only for selected providers and removes the model from unselected providers", () => {
    const providers = makeProviders({
      claude: {
        additionalModels: [{ id: "glm-5", label: "Old GLM" }],
      },
      codex: {
        additionalModels: [{ id: "glm-5", label: "Old GLM" }],
      },
    });

    expect(
      buildSaveCustomModelPatch({
        currentProviders: providers,
        previousId: "glm-5",
        id: "glm-5",
        label: "GLM 5",
        providerIds: ["claude"],
      }),
    ).toEqual({
      providers: {
        claude: { additionalModels: [{ id: "glm-5", label: "GLM 5" }] },
        codex: { additionalModels: [] },
      },
    });
  });

  it("renames a model id by removing the old id and writing the new id", () => {
    const providers = makeProviders({
      claude: {
        additionalModels: [
          { id: "old-model", label: "Old Model" },
          { id: "other", label: "Other" },
        ],
      },
      codex: {
        additionalModels: [{ id: "old-model", label: "Old Model" }],
      },
    });

    expect(
      buildSaveCustomModelPatch({
        currentProviders: providers,
        previousId: "old-model",
        id: "new-model",
        label: "New Model",
        providerIds: ["codex"],
      }),
    ).toEqual({
      providers: {
        claude: { additionalModels: [{ id: "other", label: "Other" }] },
        codex: { additionalModels: [{ id: "new-model", label: "New Model" }] },
      },
    });
  });

  it("deletes a global model from every provider while preserving other provider config", () => {
    const providers = makeProviders({
      claude: {
        enabled: true,
        additionalModels: [
          { id: "glm-5", label: "GLM 5" },
          { id: "other", label: "Other" },
        ],
      },
      codex: {
        additionalModels: [{ id: "glm-5", label: "GLM 5" }],
      },
    });

    expect(buildDeleteCustomModelPatch({ currentProviders: providers, id: "glm-5" })).toEqual({
      providers: {
        claude: { additionalModels: [{ id: "other", label: "Other" }] },
        codex: { additionalModels: [] },
      },
    });
  });

  it("builds a provider-scoped add patch for the provider diagnostics sheet", () => {
    expect(
      buildAddCustomModelToProviderPatch({
        currentProviders: {
          codex: {
            additionalModels: [{ id: "glm-5", label: "Existing GLM" }],
          },
        },
        providerId: "claude",
        id: "glm-5",
      }),
    ).toEqual({
      providers: {
        claude: { additionalModels: [{ id: "glm-5", label: "glm-5" }] },
      },
    });
  });

  it("builds a provider-scoped delete patch for the provider diagnostics sheet", () => {
    const providers = makeProviders({
      claude: {
        additionalModels: [
          { id: "glm-5", label: "GLM 5" },
          { id: "other", label: "Other" },
        ],
      },
      codex: {
        additionalModels: [{ id: "glm-5", label: "GLM 5" }],
      },
    });

    expect(
      buildDeleteCustomModelFromProviderPatch({
        currentProviders: providers,
        providerId: "claude",
        id: "glm-5",
      }),
    ).toEqual({
      providers: {
        claude: { additionalModels: [{ id: "other", label: "Other" }] },
      },
    });
  });
});
