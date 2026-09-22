import { describe, expect, test } from "vitest";
import type { ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";
import {
  isProviderEntryLoading,
  resolveProviderSnapshotLoadingState,
} from "./provider-snapshot-loading";

const readyMockEntry: ProviderSnapshotEntry = {
  provider: "mock",
  status: "ready",
  enabled: true,
  label: "Mock Provider",
  models: [{ provider: "mock", id: "ten-second-stream", label: "Ten second stream" }],
};

describe("resolveProviderSnapshotLoadingState", () => {
  test("does not block the selected provider while unrelated provider snapshots are still loading", () => {
    expect(
      resolveProviderSnapshotLoadingState({
        snapshotIsLoading: true,
        snapshotEntries: [readyMockEntry],
        selectedProviderIsLoading: false,
      }),
    ).toEqual({
      isAllModelsLoading: false,
      isModelLoading: false,
    });
  });

  test("keeps the form loading before any provider snapshot data arrives", () => {
    expect(
      resolveProviderSnapshotLoadingState({
        snapshotIsLoading: true,
        snapshotEntries: undefined,
        selectedProviderIsLoading: false,
      }).isModelLoading,
    ).toBe(true);
  });

  test("keeps the form loading when the selected provider itself is loading", () => {
    expect(
      resolveProviderSnapshotLoadingState({
        snapshotIsLoading: false,
        snapshotEntries: [readyMockEntry],
        selectedProviderIsLoading: true,
      }).isModelLoading,
    ).toBe(true);
  });
});

describe("isProviderEntryLoading", () => {
  test("does not keep a ready selected provider loading because a stale runtime gateway is loading", () => {
    expect(
      isProviderEntryLoading({
        selectedEntry: readyMockEntry,
        runtimeEntry: { ...readyMockEntry, provider: "mock-gateway", status: "loading" },
      }),
    ).toBe(false);
  });

  test("falls back to runtime loading when selected provider snapshot is absent", () => {
    expect(
      isProviderEntryLoading({
        runtimeProvider: "mock-gateway",
        selectedEntry: null,
        runtimeEntry: { ...readyMockEntry, provider: "mock-gateway", status: "loading" },
      }),
    ).toBe(true);
  });

  test("keeps loading for an explicit runtime provider even when the selected provider is ready", () => {
    expect(
      isProviderEntryLoading({
        runtimeProvider: "mock-gateway",
        selectedEntry: readyMockEntry,
        runtimeEntry: { ...readyMockEntry, provider: "mock-gateway", status: "loading" },
      }),
    ).toBe(true);
  });
});
