import { describe, expect, it, vi } from "vitest";

// AsyncStorage is not available in the node test environment; stub it with an
// in-memory implementation so zustand persist does not emit unhandled
// rejections. Only the storage adapter is mocked, never the store logic.
vi.mock("@react-native-async-storage/async-storage", () => {
  const memory = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => memory.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        memory.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        memory.delete(key);
      }),
    },
  };
});

import { useDraftStore } from "./index";

describe("reserveDraftAgentId store action", () => {
  it("returns the same id across calls when no draft record exists yet", () => {
    const key = `draft:test:no-record-${Date.now()}`;
    const first = useDraftStore.getState().reserveDraftAgentId({ draftKey: key });
    const second = useDraftStore.getState().reserveDraftAgentId({ draftKey: key });
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
    expect(useDraftStore.getState().drafts[key]?.agentId).toBe(first);
  });

  it("keeps an existing reserved id stable", () => {
    const key = `draft:test:existing-${Date.now()}`;
    const first = useDraftStore.getState().reserveDraftAgentId({ draftKey: key });
    const second = useDraftStore.getState().reserveDraftAgentId({ draftKey: key });
    expect(second).toBe(first);
  });

  it("persists the id onto the draft record even when no record existed", () => {
    const key = `draft:test:create-${Date.now()}`;
    const agentId = useDraftStore.getState().reserveDraftAgentId({ draftKey: key });
    const record = useDraftStore.getState().drafts[key];
    expect(record?.agentId).toBe(agentId);
    expect(record?.lifecycle).toBe("active");
  });
});
