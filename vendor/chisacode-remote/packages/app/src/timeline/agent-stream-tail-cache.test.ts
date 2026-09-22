import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import {
  loadCachedAgentStreamTail,
  MAX_CACHED_AGENT_STREAM_ITEMS,
  saveCachedAgentStreamTail,
  type KeyValueStorage,
} from "./agent-stream-tail-cache";

function createStorage(): KeyValueStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    async getItem(key) {
      return entries.get(key) ?? null;
    },
    async setItem(key, value) {
      entries.set(key, value);
    },
    async removeItem(key) {
      entries.delete(key);
    },
  };
}

function assistantMessage(index: number): StreamItem {
  return {
    kind: "assistant_message",
    id: `assistant-${index}`,
    text: `cached answer ${index}`,
    timestamp: new Date(1_800_000_000_000 + index),
  };
}

describe("agent stream tail cache", () => {
  it("round-trips cached stream items with Date timestamps", async () => {
    const storage = createStorage();
    const items = [assistantMessage(1), assistantMessage(2)];

    await saveCachedAgentStreamTail({
      serverId: "server 1",
      agentId: "agent/1",
      items,
      storage,
    });

    const loaded = await loadCachedAgentStreamTail({
      serverId: "server 1",
      agentId: "agent/1",
      storage,
    });

    expect(loaded).toEqual(items);
    expect(loaded[0]?.timestamp).toBeInstanceOf(Date);
  });

  it("caps cached history to the newest tail window", async () => {
    const storage = createStorage();
    const items = Array.from({ length: MAX_CACHED_AGENT_STREAM_ITEMS + 2 }, (_, index) =>
      assistantMessage(index),
    );

    await saveCachedAgentStreamTail({
      serverId: "server",
      agentId: "agent",
      items,
      storage,
    });

    const loaded = await loadCachedAgentStreamTail({
      serverId: "server",
      agentId: "agent",
      storage,
    });

    expect(loaded).toHaveLength(MAX_CACHED_AGENT_STREAM_ITEMS);
    expect(loaded[0]?.id).toBe("assistant-2");
  });

  it("ignores malformed cache payloads", async () => {
    const storage = createStorage();
    await storage.setItem(
      "@chisacode:agent-stream-tail-cache:v1:server:agent",
      JSON.stringify({ version: 1, savedAt: new Date().toISOString(), items: [{ id: "x" }] }),
    );

    await expect(
      loadCachedAgentStreamTail({ serverId: "server", agentId: "agent", storage }),
    ).resolves.toEqual([]);
  });

  it("ignores malformed JSON", async () => {
    const storage = createStorage();
    await storage.setItem("@chisacode:agent-stream-tail-cache:v1:server:agent", "{");

    await expect(
      loadCachedAgentStreamTail({ serverId: "server", agentId: "agent", storage }),
    ).resolves.toEqual([]);
  });
});
