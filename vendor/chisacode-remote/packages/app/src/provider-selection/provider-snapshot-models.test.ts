import { describe, expect, test } from "vitest";
import type { ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";
import { resolveProviderSnapshotModels } from "./provider-snapshot-models";

const directOpenCodeEntry: ProviderSnapshotEntry = {
  provider: "opencode",
  status: "ready",
  enabled: true,
  label: "OpenCode",
  models: [
    {
      provider: "opencode",
      id: "xiaomi/mimo-v2.5",
      label: "mimo-v2.5",
      isDefault: true,
    },
  ],
};

const gatewayOpenCodeEntry: ProviderSnapshotEntry = {
  provider: "opencode-opencode",
  status: "ready",
  enabled: true,
  label: "OpenCode gateway",
  models: [
    {
      provider: "opencode-opencode",
      id: "xiaomi/mimo-v2.5",
      label: "mimo-v2.5",
      isDefault: true,
    },
  ],
};

const claudeEntry: ProviderSnapshotEntry = {
  provider: "claude",
  status: "ready",
  enabled: true,
  label: "Claude",
  models: [
    {
      provider: "claude",
      id: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      isDefault: true,
    },
  ],
};

const claudeMimoGatewayEntry: ProviderSnapshotEntry = {
  provider: "opencode-claude",
  status: "ready",
  enabled: true,
  label: "OpenCode Claude",
  derivedFromProviderId: "claude",
  modelGatewayId: "opencode",
  models: [
    {
      provider: "opencode-claude",
      id: "mimo-v2.5",
      label: "mimo-v2.5",
      isDefault: true,
    },
  ],
};

describe("resolveProviderSnapshotModels", () => {
  test("prefers the selected provider models over a stale runtime gateway entry", () => {
    expect(
      resolveProviderSnapshotModels({
        runtimeProvider: null,
        selectedEntry: directOpenCodeEntry,
        runtimeEntry: gatewayOpenCodeEntry,
      })?.map((model) => model.id),
    ).toEqual(["xiaomi/mimo-v2.5"]);
  });

  test("uses explicit runtime gateway models for a grouped ClaudeCode MiMo selection", () => {
    expect(
      resolveProviderSnapshotModels({
        runtimeProvider: "opencode-claude",
        selectedEntry: claudeEntry,
        runtimeEntry: claudeMimoGatewayEntry,
      })?.map((model) => model.id),
    ).toEqual(["mimo-v2.5"]);
  });

  test("falls back to runtime provider models when the selected provider has no entry", () => {
    expect(
      resolveProviderSnapshotModels({
        runtimeProvider: "opencode-opencode",
        selectedEntry: null,
        runtimeEntry: gatewayOpenCodeEntry,
      })?.map((model) => model.id),
    ).toEqual(["xiaomi/mimo-v2.5"]);
  });

  test("does not fall back to selected provider models while an explicit runtime provider is loading", () => {
    expect(
      resolveProviderSnapshotModels({
        runtimeProvider: "opencode-claude",
        selectedEntry: claudeEntry,
        runtimeEntry: {
          ...claudeMimoGatewayEntry,
          status: "loading",
          models: undefined,
        },
      }),
    ).toBeNull();
  });
});
