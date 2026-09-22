import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod/v3";
import type { StreamItem } from "@/types/stream";

const STORAGE_PREFIX = "@chisacode:agent-stream-tail-cache:v1:";
const CACHE_VERSION = 1;
export const MAX_CACHED_AGENT_STREAM_ITEMS = 100;

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
}

type SerializedStreamItem = Omit<StreamItem, "timestamp"> & { timestamp: string };

const serializedStreamItemSchema = z
  .object({
    kind: z.string(),
    id: z.string(),
    timestamp: z.string(),
  })
  .passthrough();

const cachePayloadSchema = z.object({
  version: z.literal(CACHE_VERSION),
  savedAt: z.string(),
  items: z.array(serializedStreamItemSchema),
});

function buildCacheKey(input: { serverId: string; agentId: string }): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(input.serverId)}:${encodeURIComponent(input.agentId)}`;
}

function serializeStreamItem(item: StreamItem): SerializedStreamItem {
  return {
    ...item,
    timestamp: item.timestamp.toISOString(),
  };
}

function deserializeStreamItem(
  item: z.infer<typeof serializedStreamItemSchema>,
): StreamItem | null {
  const timestamp = new Date(item.timestamp);
  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }
  return {
    ...item,
    timestamp,
  } as StreamItem;
}

export async function loadCachedAgentStreamTail(input: {
  serverId: string;
  agentId: string;
  storage?: KeyValueStorage;
}): Promise<StreamItem[]> {
  const storage = input.storage ?? AsyncStorage;
  const stored = await storage.getItem(buildCacheKey(input));
  if (!stored) {
    return [];
  }

  let storedPayload: unknown;
  try {
    storedPayload = JSON.parse(stored);
  } catch {
    return [];
  }

  const parsed = cachePayloadSchema.safeParse(storedPayload);
  if (!parsed.success) {
    return [];
  }

  return parsed.data.items
    .map((item) => deserializeStreamItem(item))
    .filter((item): item is StreamItem => item !== null);
}

export async function saveCachedAgentStreamTail(input: {
  serverId: string;
  agentId: string;
  items: readonly StreamItem[];
  storage?: KeyValueStorage;
}): Promise<void> {
  const storage = input.storage ?? AsyncStorage;
  const key = buildCacheKey(input);
  const items = input.items.slice(-MAX_CACHED_AGENT_STREAM_ITEMS);
  if (items.length === 0) {
    await storage.removeItem?.(key);
    return;
  }

  await storage.setItem(
    key,
    JSON.stringify({
      version: CACHE_VERSION,
      savedAt: new Date().toISOString(),
      items: items.map(serializeStreamItem),
    }),
  );
}

export async function removeCachedAgentStreamTail(input: {
  serverId: string;
  agentId: string;
  storage?: KeyValueStorage;
}): Promise<void> {
  const storage = input.storage ?? AsyncStorage;
  await storage.removeItem?.(buildCacheKey(input));
}
