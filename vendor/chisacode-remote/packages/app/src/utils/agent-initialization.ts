/** A deferred promise tracking a pending agent initialization request, with its timeout and scroll direction */
export interface DeferredInit {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
  requestDirection: "tail" | "after";
}

const initPromises = new Map<string, DeferredInit>();

/**
 * Builds the registry key identifying an agent initialization request
 * @param serverId The server the agent belongs to
 * @param agentId The agent being initialized
 * @returns The composite key used to look up the deferred init entry
 */
export function getInitKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

/**
 * Looks up the pending deferred init entry for a key
 * @param key The registry key produced by {@link getInitKey}
 * @returns The deferred entry, or undefined when no initialization is pending
 */
export function getInitDeferred(key: string): DeferredInit | undefined {
  return initPromises.get(key);
}

/**
 * Creates and registers a new deferred init entry for a key
 * @param key The registry key produced by {@link getInitKey}
 * @param requestDirection Whether the initial history request tails or pages after existing messages
 * @returns The newly created deferred entry
 */
export function createInitDeferred(key: string, requestDirection: "tail" | "after"): DeferredInit {
  let resolve!: () => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const deferred: DeferredInit = {
    promise,
    resolve,
    reject,
    timeoutId: null,
    requestDirection,
  };
  initPromises.set(key, deferred);
  return deferred;
}

/**
 * Attaches a timeout handle to a pending init entry so it is cleared on settle; clears the handle immediately if the entry is gone
 * @param key The registry key produced by {@link getInitKey}
 * @param timeoutId The timeout handle to associate with the entry
 */
export function attachInitTimeout(key: string, timeoutId: ReturnType<typeof setTimeout>): void {
  const deferred = initPromises.get(key);
  if (!deferred) {
    clearTimeout(timeoutId);
    return;
  }
  deferred.timeoutId = timeoutId;
}

/**
 * Resolves a pending init entry, clearing its timeout and removing it from the registry
 * @param key The registry key produced by {@link getInitKey}
 */
export function resolveInitDeferred(key: string): void {
  const deferred = initPromises.get(key);
  if (!deferred) {
    return;
  }
  if (deferred.timeoutId) {
    clearTimeout(deferred.timeoutId);
  }
  initPromises.delete(key);
  deferred.resolve();
}

/**
 * Rejects a pending init entry, clearing its timeout and removing it from the registry
 * @param key The registry key produced by {@link getInitKey}
 * @param error The error to reject the init promise with
 */
export function rejectInitDeferred(key: string, error: Error): void {
  const deferred = initPromises.get(key);
  if (!deferred) {
    return;
  }
  if (deferred.timeoutId) {
    clearTimeout(deferred.timeoutId);
  }
  initPromises.delete(key);
  deferred.reject(error);
}
