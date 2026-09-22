/**
 * Last draft directory selection, per server.
 *
 * Tracks the directory the user most recently picked in a Soft Home draft
 * (regardless of whether the draft was submitted). Used to seed the initial
 * directory when the app launches or when the user clicks 新对话 — so the
 * next draft opens where the last one left off, even if no message was sent.
 *
 * The store is a single value per server: `Record<serverId, directoryPath>`.
 * Empty/blank directories are ignored; `forget(serverId)` clears one entry.
 */

export interface LastDraftDirectorySelection {
  directoryByServer: Record<string, string>;
}

export interface LastDraftDirectoryStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

function normalizeSelection(input: unknown): LastDraftDirectorySelection | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const raw = record.directoryByServer;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const map = raw as Record<string, unknown>;
  const directoryByServer: Record<string, string> = {};
  for (const [serverId, value] of Object.entries(map)) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const trimmedServerId = serverId.trim();
    if (!trimmedServerId) {
      continue;
    }
    directoryByServer[trimmedServerId] = trimmed;
  }
  return { directoryByServer };
}

function parseStoredSelection(stored: string | null): LastDraftDirectorySelection | null {
  if (!stored) {
    return null;
  }
  try {
    return normalizeSelection(JSON.parse(stored));
  } catch {
    return null;
  }
}

export function createLastDraftDirectoryStore(storage: LastDraftDirectoryStorage) {
  let selection: LastDraftDirectorySelection | null = null;
  let hydrated = false;
  let hydrationPromise: Promise<void> | null = null;
  let revision = 0;
  const listeners = new Set<() => void>();

  function notifyListeners() {
    for (const listener of listeners) {
      listener();
    }
  }

  /**
   * Records the directory the user picked for a draft on the given server.
   * Empty/blank directories are ignored so an unselected draft does not wipe
   * a previously remembered useful path.
   * @param serverId The host server the draft belongs to
   * @param directory The absolute working directory the draft was opened with
   */
  function remember(serverId: string, directory: string) {
    const trimmedServerId = serverId.trim();
    const trimmedDirectory = directory.trim();
    if (!trimmedServerId || !trimmedDirectory) {
      return;
    }
    const current = selection?.directoryByServer ?? {};
    if (current[trimmedServerId] === trimmedDirectory) {
      return;
    }
    selection = {
      directoryByServer: {
        ...current,
        [trimmedServerId]: trimmedDirectory,
      },
    };
    revision += 1;
    notifyListeners();
    void storage.write(JSON.stringify(selection)).catch(() => {});
  }

  /**
   * Clears the remembered directory for a single server.
   * @param serverId The host server whose draft directory should be forgotten
   */
  function forget(serverId: string) {
    const trimmedServerId = serverId.trim();
    if (!trimmedServerId || !selection) {
      return;
    }
    if (!(trimmedServerId in selection.directoryByServer)) {
      return;
    }
    const nextDirectoryByServer = { ...selection.directoryByServer };
    delete nextDirectoryByServer[trimmedServerId];
    selection =
      Object.keys(nextDirectoryByServer).length === 0
        ? null
        : { directoryByServer: nextDirectoryByServer };
    revision += 1;
    notifyListeners();
    void storage.write(selection ? JSON.stringify(selection) : "").catch(() => {});
  }

  function hydrate(): Promise<void> {
    if (hydrationPromise) {
      return hydrationPromise;
    }
    const hydrationRevision = revision;
    hydrationPromise = storage
      .read()
      .then((stored) => {
        if (revision === hydrationRevision) {
          selection = parseStoredSelection(stored);
        }
        return undefined;
      })
      .catch(() => {
        if (revision === hydrationRevision) {
          selection = null;
        }
      })
      .finally(() => {
        hydrated = true;
        notifyListeners();
      });
    return hydrationPromise;
  }

  return {
    /**
     * Returns the remembered draft directory for a server, or null if none.
     * @param serverId The host server to look up
     * @returns The last picked draft directory, or null when unrecorded
     */
    getDirectory: (serverId: string): string | null => {
      const trimmedServerId = serverId.trim();
      if (!trimmedServerId || !selection) {
        return null;
      }
      const value = selection.directoryByServer[trimmedServerId];
      return typeof value === "string" && value.trim() ? value : null;
    },
    forget,
    hydrate,
    isHydrated: () => hydrated,
    remember,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
