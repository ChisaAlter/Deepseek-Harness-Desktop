import type { TerminalState } from "@chisacode/protocol/messages";

export interface WorkspaceTerminalSnapshots {
  get: (input: { terminalId: string }) => TerminalState | null;
  set: (input: { terminalId: string; state: TerminalState }) => void;
  clear: (input: { terminalId: string }) => void;
  prune: (input: { terminalIds: string[] }) => void;
}

export interface WorkspaceTerminalSession {
  scopeKey: string;
  snapshots: WorkspaceTerminalSnapshots;
}

interface WorkspaceTerminalSessionRecord {
  snapshotByTerminalId: Map<string, TerminalState>;
  session: WorkspaceTerminalSession;
}

const sessionsByScopeKey = new Map<string, WorkspaceTerminalSessionRecord>();
const refCountByScopeKey = new Map<string, number>();
/** Pending teardown timers keyed by scopeKey; cancelled if a retain arrives
 *  before the grace period elapses, so Strict Mode's dev-only unmount/remount
 *  cycle does not destroy scrollback snapshots between mounts. */
const pendingTeardownByScopeKey = new Map<string, ReturnType<typeof setTimeout>>();
const RELEASE_GRACE_MS = 5_000;

function createSnapshots(input: {
  snapshotByTerminalId: Map<string, TerminalState>;
}): WorkspaceTerminalSnapshots {
  return {
    get: ({ terminalId }) => input.snapshotByTerminalId.get(terminalId) ?? null,
    set: ({ terminalId, state }) => {
      input.snapshotByTerminalId.set(terminalId, state);
    },
    clear: ({ terminalId }) => {
      input.snapshotByTerminalId.delete(terminalId);
    },
    prune: ({ terminalIds }) => {
      const terminalIdSet = new Set(terminalIds);
      for (const terminalId of Array.from(input.snapshotByTerminalId.keys())) {
        if (!terminalIdSet.has(terminalId)) {
          input.snapshotByTerminalId.delete(terminalId);
        }
      }
    },
  };
}

export function getWorkspaceTerminalSession(input: { scopeKey: string }): WorkspaceTerminalSession {
  // If a teardown is pending for this scope, cancel it — a consumer is
  // re-adopting the session before the grace period elapsed.
  const pendingTeardown = pendingTeardownByScopeKey.get(input.scopeKey);
  if (pendingTeardown) {
    clearTimeout(pendingTeardown);
    pendingTeardownByScopeKey.delete(input.scopeKey);
  }

  const existing = sessionsByScopeKey.get(input.scopeKey);
  if (existing) {
    return existing.session;
  }

  const snapshotByTerminalId = new Map<string, TerminalState>();
  const session: WorkspaceTerminalSession = {
    scopeKey: input.scopeKey,
    snapshots: createSnapshots({
      snapshotByTerminalId,
    }),
  };

  sessionsByScopeKey.set(input.scopeKey, {
    snapshotByTerminalId,
    session,
  });
  return session;
}

export function retainWorkspaceTerminalSession(input: { scopeKey: string }): void {
  // Cancel any pending teardown — a new retention revives the session.
  const pendingTeardown = pendingTeardownByScopeKey.get(input.scopeKey);
  if (pendingTeardown) {
    clearTimeout(pendingTeardown);
    pendingTeardownByScopeKey.delete(input.scopeKey);
  }
  const current = refCountByScopeKey.get(input.scopeKey) ?? 0;
  refCountByScopeKey.set(input.scopeKey, current + 1);
}

export function releaseWorkspaceTerminalSession(input: { scopeKey: string }): void {
  const current = refCountByScopeKey.get(input.scopeKey) ?? 0;
  if (current > 1) {
    refCountByScopeKey.set(input.scopeKey, current - 1);
    return;
  }
  refCountByScopeKey.delete(input.scopeKey);
  // Defer session teardown so a rapid re-mount (e.g. Strict Mode dev
  // mount→unmount→mount, or fast tab switches) reuses the existing snapshots
  // instead of losing scrollback to an immediate delete.
  const existingTimer = pendingTeardownByScopeKey.get(input.scopeKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  pendingTeardownByScopeKey.set(
    input.scopeKey,
    setTimeout(() => {
      pendingTeardownByScopeKey.delete(input.scopeKey);
      sessionsByScopeKey.delete(input.scopeKey);
    }, RELEASE_GRACE_MS),
  );
}
