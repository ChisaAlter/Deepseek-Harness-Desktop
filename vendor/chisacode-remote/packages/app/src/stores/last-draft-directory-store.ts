import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import {
  createLastDraftDirectoryStore,
  type LastDraftDirectoryStorage,
} from "@/stores/last-draft-directory";

const LAST_DRAFT_DIRECTORY_STORAGE_KEY = "chisacode:last-draft-directory-selection";

const lastDraftDirectoryStorage: LastDraftDirectoryStorage = {
  read: () => AsyncStorage.getItem(LAST_DRAFT_DIRECTORY_STORAGE_KEY),
  write: (value) => AsyncStorage.setItem(LAST_DRAFT_DIRECTORY_STORAGE_KEY, value),
};

const lastDraftDirectoryStore = createLastDraftDirectoryStore(lastDraftDirectoryStorage);

/**
 * Hydrates the last-draft-directory store from persistent storage. Safe to call
 * multiple times; only the first call triggers a read.
 * @returns A promise that resolves once hydration completes
 */
export function hydrateLastDraftDirectory(): Promise<void> {
  return lastDraftDirectoryStore.hydrate();
}

/**
 * Returns the remembered draft directory for a server, or null when none.
 * @param serverId The host server to look up
 * @returns The last picked draft directory, or null when unrecorded
 */
export function getLastDraftDirectory(serverId: string): string | null {
  return lastDraftDirectoryStore.getDirectory(serverId);
}

/**
 * Records the directory the user picked for a draft on the given server.
 * Empty/blank directories are ignored so an unselected draft does not wipe
 * a previously remembered useful path.
 * @param serverId The host server the draft belongs to
 * @param directory The absolute working directory the draft was opened with
 */
export function rememberLastDraftDirectory(serverId: string, directory: string): void {
  lastDraftDirectoryStore.remember(serverId, directory);
}

/**
 * Clears the remembered draft directory for a single server.
 * @param serverId The host server whose draft directory should be forgotten
 */
export function forgetLastDraftDirectory(serverId: string): void {
  lastDraftDirectoryStore.forget(serverId);
}

/**
 * React hook that subscribes to the remembered draft directory for a server
 * and re-renders when it changes.
 * @param serverId The host server to look up
 * @returns The last picked draft directory, or null when unrecorded
 */
export function useLastDraftDirectory(serverId: string | null | undefined): string | null {
  const server = serverId?.trim() || null;
  return useSyncExternalStore(
    lastDraftDirectoryStore.subscribe,
    () => (server ? lastDraftDirectoryStore.getDirectory(server) : null),
    () => (server ? lastDraftDirectoryStore.getDirectory(server) : null),
  );
}

export function useIsLastDraftDirectoryHydrated(): boolean {
  return useSyncExternalStore(
    lastDraftDirectoryStore.subscribe,
    lastDraftDirectoryStore.isHydrated,
    lastDraftDirectoryStore.isHydrated,
  );
}

void hydrateLastDraftDirectory();
