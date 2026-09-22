import { describe, expect, it } from "vitest";

import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";
import {
  resolveInitialSelectorView,
  resolveTopLevelFavoriteRows,
} from "./combined-model-selector-state";

function modelRow(providerId: string, modelId: string) {
  return {
    favoriteKey: `${providerId}:${modelId}`,
    provider: providerId,
    agentProvider: providerId,
    runtimeProvider: providerId,
    providerLabel: providerId,
    modelId,
    modelLabel: modelId,
  };
}

function makeProvider(id: string, modelIds: string[]): ProviderSelectorProvider {
  return {
    id,
    label: id,
    modelSelection: {
      kind: "models",
      rows: modelIds.map((modelId) => modelRow(id, modelId)),
    },
  };
}

describe("resolveInitialSelectorView", () => {
  it("opens at the provider list before model selection when multiple agents are available", () => {
    expect(
      resolveInitialSelectorView({
        providers: [makeProvider("claude", ["sonnet"]), makeProvider("codex", ["gpt-5"])],
        selectedProvider: "codex",
        selectedModel: "gpt-5",
        favoriteKeys: new Set(),
      }),
    ).toEqual({ kind: "all" });
  });

  it("keeps the single-provider shortcut because there is no agent choice to make", () => {
    expect(
      resolveInitialSelectorView({
        providers: [makeProvider("claude", ["sonnet"])],
        selectedProvider: "claude",
        selectedModel: "sonnet",
        favoriteKeys: new Set(),
      }),
    ).toEqual({ kind: "provider", providerId: "claude", providerLabel: "claude" });
  });
});

describe("resolveTopLevelFavoriteRows", () => {
  it("does not expose model favorites before the user chooses an agent", () => {
    expect(
      resolveTopLevelFavoriteRows({
        providers: [makeProvider("claude", ["sonnet"]), makeProvider("codex", ["gpt-5"])],
        favoriteKeys: new Set(["codex:gpt-5"]),
      }),
    ).toEqual([]);
  });
});
