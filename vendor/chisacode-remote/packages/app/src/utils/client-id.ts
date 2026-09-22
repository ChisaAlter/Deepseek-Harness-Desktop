import AsyncStorage from "@react-native-async-storage/async-storage";

const CLIENT_ID_STORAGE_KEY = "@chisacode:client-id-v1";
const LEGACY_CLIENT_ID_STORAGE_KEY = "@chisacode:client-id-v1";

/** The async key-value storage surface used to persist the client id */
export interface ClientIdStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Resolves the stable client id, creating and persisting one on first use */
export interface ClientIdResolver {
  getOrCreate(): Promise<string>;
}

function normalizeStoredClientId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Creates a resolver that returns a cached client id, migrating any legacy stored id, or generating and
 * persisting a new one; concurrent calls share a single in-flight read
 * @param deps The storage backend, uuid generator, and optional storage key overrides
 * @returns The resolver whose getOrCreate yields the stable client id
 */
export function createClientIdResolver(deps: {
  storage: ClientIdStorage;
  generateUuid: () => string;
  storageKey?: string;
  legacyStorageKey?: string;
}): ClientIdResolver {
  const storageKey = deps.storageKey ?? CLIENT_ID_STORAGE_KEY;
  const legacyStorageKey = deps.legacyStorageKey ?? LEGACY_CLIENT_ID_STORAGE_KEY;
  let cached: string | null = null;
  let inFlight: Promise<string> | null = null;

  return {
    async getOrCreate(): Promise<string> {
      if (cached) {
        return cached;
      }
      if (inFlight) {
        return inFlight;
      }

      inFlight = (async () => {
        const stored = await deps.storage.getItem(storageKey);
        const existing = normalizeStoredClientId(stored);
        if (existing) {
          cached = existing;
          return existing;
        }

        const legacyStored = await deps.storage.getItem(legacyStorageKey);
        const legacyExisting = normalizeStoredClientId(legacyStored);
        if (legacyExisting) {
          await deps.storage.setItem(storageKey, legacyExisting);
          cached = legacyExisting;
          return legacyExisting;
        }

        const next = `cid_${deps.generateUuid()}`;
        await deps.storage.setItem(storageKey, next);
        cached = next;
        return next;
      })();

      try {
        return await inFlight;
      } finally {
        inFlight = null;
      }
    },
  };
}

function generateUuidFromGlobalCrypto(): string {
  const cryptoObj = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

const defaultResolver = createClientIdResolver({
  storage: AsyncStorage,
  generateUuid: generateUuidFromGlobalCrypto,
});

/**
 * Returns the app-wide stable client id, creating and persisting one on first use
 * @returns The stable client id
 */
export async function getOrCreateClientId(): Promise<string> {
  return defaultResolver.getOrCreate();
}
