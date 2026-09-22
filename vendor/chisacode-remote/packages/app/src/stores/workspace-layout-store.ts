import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  extractActiveTargetFromLegacyLayout,
  normalizeWorkspaceKey,
} from "@/stores/workspace-layout-actions";
import { normalizeWorkspaceTabTarget } from "@/workspace-tabs/identity";
import type { WorkspaceTabTarget } from "@/workspace-tabs/identity";

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Builds the persisted workspace state key from a server/workspace pair.
 * @param input The server and workspace identifiers
 * @returns The normalized persistence key, or null when either id is empty
 */
export function buildWorkspaceTabPersistenceKey(input: {
  serverId: string;
  workspaceId: string;
}): string | null {
  const serverId = trimNonEmpty(input.serverId);
  const workspaceId = trimNonEmpty(input.workspaceId);
  if (!serverId || !workspaceId) {
    return null;
  }
  return `${serverId}:${workspaceId}`;
}

interface WorkspaceLayoutStore {
  /** The single active content target per workspace (null-absent workspaces show the empty state) */
  activeTargetByWorkspace: Record<string, WorkspaceTabTarget>;
  /** Agents pinned to a workspace from the sidebar (in-memory only) */
  pinnedAgentIdsByWorkspace: Record<string, Set<string>>;
  /** Sets the workspace center column content to the target, replacing whatever was shown */
  openTarget: (workspaceKey: string, target: WorkspaceTabTarget) => void;
  /** Converts the active draft target into a live agent once its session is created */
  convertDraftToAgent: (workspaceKey: string, agentId: string) => void;
  /** Clears the active content, returning the workspace to the empty state */
  clearTarget: (workspaceKey: string) => void;
  pinAgent: (workspaceKey: string, agentId: string) => void;
  unpinAgent: (workspaceKey: string, agentId: string) => void;
  unpinAgentEverywhere: (agentId: string) => void;
  purgeWorkspace: (workspaceKey: string) => void;
}

function addIdToWorkspaceSet(
  state: Record<string, Set<string>>,
  workspaceKey: string,
  id: string,
): Record<string, Set<string>> {
  const currentIds = state[workspaceKey] ?? null;
  if (currentIds?.has(id)) {
    return state;
  }

  const nextIds = new Set(currentIds ?? []);
  nextIds.add(id);
  return {
    ...state,
    [workspaceKey]: nextIds,
  };
}

function removeIdFromWorkspaceSet(
  state: Record<string, Set<string>>,
  workspaceKey: string,
  id: string,
): Record<string, Set<string>> {
  const currentIds = state[workspaceKey] ?? null;
  if (!currentIds?.has(id)) {
    return state;
  }

  if (currentIds.size === 1) {
    const nextState = { ...state };
    delete nextState[workspaceKey];
    return nextState;
  }

  const nextIds = new Set(currentIds);
  nextIds.delete(id);
  return {
    ...state,
    [workspaceKey]: nextIds,
  };
}

function removeIdFromEveryWorkspaceSet(
  state: Record<string, Set<string>>,
  id: string,
): Record<string, Set<string>> {
  let nextState: Record<string, Set<string>> | null = null;
  for (const [workspaceKey, currentIds] of Object.entries(state)) {
    if (!currentIds.has(id)) {
      continue;
    }

    nextState ??= { ...state };
    if (currentIds.size === 1) {
      delete nextState[workspaceKey];
      continue;
    }

    const nextIds = new Set(currentIds);
    nextIds.delete(id);
    nextState[workspaceKey] = nextIds;
  }

  return nextState ?? state;
}

function mergePersistedWorkspaceLayoutState(
  persistedState: unknown,
  currentState: WorkspaceLayoutStore,
): WorkspaceLayoutStore {
  if (!isPlainRecord(persistedState)) {
    return currentState;
  }
  const rawActiveTargets = isPlainRecord(persistedState.activeTargetByWorkspace)
    ? persistedState.activeTargetByWorkspace
    : {};
  const activeTargetByWorkspace: Record<string, WorkspaceTabTarget> = {};
  for (const [key, value] of Object.entries(rawActiveTargets)) {
    const target = normalizeWorkspaceTabTarget(value as WorkspaceTabTarget);
    if (target) {
      activeTargetByWorkspace[key] = target;
    }
  }
  return {
    ...currentState,
    activeTargetByWorkspace,
    // Pinned agents intentionally stay in-memory (legacy behavior).
    pinnedAgentIdsByWorkspace: currentState.pinnedAgentIdsByWorkspace,
  };
}

function migratePersistedWorkspaceLayoutState(
  persistedState: unknown,
  version: number,
): { activeTargetByWorkspace: Record<string, WorkspaceTabTarget> } {
  if (version >= 2) {
    return { activeTargetByWorkspace: {} };
  }
  const raw = isPlainRecord(persistedState) ? persistedState : {};
  const rawLayouts = isPlainRecord(raw.layoutByWorkspace) ? raw.layoutByWorkspace : {};
  const activeTargetByWorkspace: Record<string, WorkspaceTabTarget> = {};
  for (const [key, layout] of Object.entries(rawLayouts)) {
    const target = extractActiveTargetFromLegacyLayout(layout);
    if (target) {
      activeTargetByWorkspace[key] = target;
    }
  }
  return { activeTargetByWorkspace };
}

export function createWorkspaceLayoutStore() {
  return create<WorkspaceLayoutStore>()(
    persist(
      (set, get) => ({
        activeTargetByWorkspace: {},
        pinnedAgentIdsByWorkspace: {},
        openTarget: (workspaceKey, target) => {
          const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
          const normalizedTarget = normalizeWorkspaceTabTarget(target);
          if (!normalizedWorkspaceKey || !normalizedTarget) {
            return;
          }

          const current = get().activeTargetByWorkspace[normalizedWorkspaceKey] ?? null;
          if (current && workspaceTabTargetsEqualForStore(current, normalizedTarget)) {
            return;
          }

          set((state) => ({
            activeTargetByWorkspace: {
              ...state.activeTargetByWorkspace,
              [normalizedWorkspaceKey]: normalizedTarget,
            },
          }));
        },
        convertDraftToAgent: (workspaceKey, agentId) => {
          const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
          const normalizedAgentId = trimNonEmpty(agentId);
          if (!normalizedWorkspaceKey || !normalizedAgentId) {
            return;
          }

          set((state) => {
            const current = state.activeTargetByWorkspace[normalizedWorkspaceKey] ?? null;
            if (!current || current.kind !== "draft") {
              return state;
            }
            return {
              activeTargetByWorkspace: {
                ...state.activeTargetByWorkspace,
                [normalizedWorkspaceKey]: { kind: "agent", agentId: normalizedAgentId },
              },
            };
          });
        },
        clearTarget: (workspaceKey) => {
          const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
          if (!normalizedWorkspaceKey) {
            return;
          }

          set((state) => {
            if (!(normalizedWorkspaceKey in state.activeTargetByWorkspace)) {
              return state;
            }
            const { [normalizedWorkspaceKey]: _removed, ...activeTargetByWorkspace } =
              state.activeTargetByWorkspace;
            return { activeTargetByWorkspace };
          });
        },
        pinAgent: (workspaceKey, agentId) => {
          const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
          const normalizedAgentId = trimNonEmpty(agentId);
          if (!normalizedWorkspaceKey || !normalizedAgentId) {
            return;
          }

          set((state) => {
            const currentPinnedAgentIds =
              state.pinnedAgentIdsByWorkspace[normalizedWorkspaceKey] ?? null;
            if (currentPinnedAgentIds?.has(normalizedAgentId)) {
              return state;
            }

            return {
              pinnedAgentIdsByWorkspace: addIdToWorkspaceSet(
                state.pinnedAgentIdsByWorkspace,
                normalizedWorkspaceKey,
                normalizedAgentId,
              ),
            };
          });
        },
        unpinAgent: (workspaceKey, agentId) => {
          const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
          const normalizedAgentId = trimNonEmpty(agentId);
          if (!normalizedWorkspaceKey || !normalizedAgentId) {
            return;
          }

          set((state) => {
            const currentPinnedAgentIds =
              state.pinnedAgentIdsByWorkspace[normalizedWorkspaceKey] ?? null;
            if (!currentPinnedAgentIds?.has(normalizedAgentId)) {
              return state;
            }

            return {
              pinnedAgentIdsByWorkspace: removeIdFromWorkspaceSet(
                state.pinnedAgentIdsByWorkspace,
                normalizedWorkspaceKey,
                normalizedAgentId,
              ),
            };
          });
        },
        unpinAgentEverywhere: (agentId) => {
          const normalizedAgentId = trimNonEmpty(agentId);
          if (!normalizedAgentId) {
            return;
          }

          set((state) => {
            const pinnedAgentIdsByWorkspace = removeIdFromEveryWorkspaceSet(
              state.pinnedAgentIdsByWorkspace,
              normalizedAgentId,
            );
            if (pinnedAgentIdsByWorkspace === state.pinnedAgentIdsByWorkspace) {
              return state;
            }
            return { pinnedAgentIdsByWorkspace };
          });
        },
        purgeWorkspace: (workspaceKey) => {
          const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
          if (!normalizedWorkspaceKey) {
            return;
          }

          set((state) => {
            const hasAny =
              normalizedWorkspaceKey in state.activeTargetByWorkspace ||
              normalizedWorkspaceKey in state.pinnedAgentIdsByWorkspace;
            if (!hasAny) {
              return state;
            }
            const { [normalizedWorkspaceKey]: _target, ...activeTargetByWorkspace } =
              state.activeTargetByWorkspace;
            const { [normalizedWorkspaceKey]: _pinned, ...pinnedAgentIdsByWorkspace } =
              state.pinnedAgentIdsByWorkspace;
            return { activeTargetByWorkspace, pinnedAgentIdsByWorkspace };
          });
        },
      }),
      {
        name: "workspace-layout-state",
        version: 2,
        storage: createJSONStorage(() => AsyncStorage),
        partialize: (state) => ({
          activeTargetByWorkspace: state.activeTargetByWorkspace,
        }),
        migrate: migratePersistedWorkspaceLayoutState,
        merge: mergePersistedWorkspaceLayoutState,
      },
    ),
  );
}

function workspaceTabTargetsEqualForStore(
  left: WorkspaceTabTarget,
  right: WorkspaceTabTarget,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "draft" && right.kind === "draft") {
    return left.draftId === right.draftId;
  }
  if (left.kind === "agent" && right.kind === "agent") {
    return left.agentId === right.agentId;
  }
  if (left.kind === "terminal" && right.kind === "terminal") {
    return left.terminalId === right.terminalId;
  }
  if (left.kind === "browser" && right.kind === "browser") {
    return left.browserId === right.browserId;
  }
  if (left.kind === "file" && right.kind === "file") {
    return left.path === right.path;
  }
  if (left.kind === "setup" && right.kind === "setup") {
    return left.workspaceId === right.workspaceId;
  }
  return false;
}

export const useWorkspaceLayoutStore = createWorkspaceLayoutStore();

export function useWorkspaceLayoutStoreHydrated(): boolean {
  const [hasHydrated, setHasHydrated] = useState(() =>
    useWorkspaceLayoutStore.persist.hasHydrated(),
  );

  useEffect(() => {
    if (useWorkspaceLayoutStore.persist.hasHydrated()) {
      setHasHydrated(true);
      return;
    }

    return useWorkspaceLayoutStore.persist.onFinishHydration(() => {
      setHasHydrated(true);
    });
  }, []);

  return hasHydrated;
}
