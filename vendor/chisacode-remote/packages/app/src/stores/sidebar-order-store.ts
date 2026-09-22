import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** Sidebar list presentation: project groups vs lifecycle shelves. */
export type SidebarViewMode = "by-project" | "by-status";

interface SidebarOrderStoreState {
  projectOrderByServerId: Record<string, string[]>;
  workspaceOrderByServerAndProject: Record<string, string[]>;
  sessionGroupOrderByServerId: Record<string, string[]>;
  sessionOrderByServerAndGroup: Record<string, string[]>;
  pinnedSessionGroupKeysByServerId: Record<string, string[]>;
  hiddenSessionGroupKeysByServerId: Record<string, string[]>;
  /** Persisted list presentation mode; defaults to project groups. */
  sidebarViewMode: SidebarViewMode;
  getProjectOrder: (serverId: string) => string[];
  setProjectOrder: (serverId: string, keys: string[]) => void;
  getWorkspaceOrder: (serverId: string, projectKey: string) => string[];
  setWorkspaceOrder: (serverId: string, projectKey: string, keys: string[]) => void;
  getSessionGroupOrder: (serverId: string) => string[];
  setSessionGroupOrder: (serverId: string, keys: string[]) => void;
  getSessionOrder: (serverId: string, groupKey: string) => string[];
  setSessionOrder: (serverId: string, groupKey: string, keys: string[]) => void;
  getPinnedSessionGroupKeys: (serverId: string) => string[];
  setSessionGroupPinned: (serverId: string, groupKey: string, pinned: boolean) => void;
  getHiddenSessionGroupKeys: (serverId: string) => string[];
  setSessionGroupHidden: (serverId: string, groupKey: string, hidden: boolean) => void;
  /**
   * Replace the full hidden-group key list for a server. Used by the sidebar
   * reconcile effect to prune keys whose groups now contain agents again, and
   * by the "show hidden projects" entry to clear the list entirely.
   * @param serverId The host server id
   * @param keys The complete next list of hidden group keys
   */
  setHiddenSessionGroupKeys: (serverId: string, keys: string[]) => void;
  /**
   * Clear every hidden-group key for a server so all workspace groups become
   * visible again. Used by the empty-state "show hidden projects" action.
   * @param serverId The host server id
   */
  clearHiddenSessionGroupKeys: (serverId: string) => void;
  /**
   * Sets the sidebar list presentation mode.
   * @param mode Project-grouped list or lifecycle shelves
   */
  setSidebarViewMode: (mode: SidebarViewMode) => void;
}

function normalizeKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawKey of keys) {
    const key = rawKey.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }

  return normalized;
}

function buildScopedOrderKey(serverId: string, scopeKey: string): string {
  return `${serverId.trim()}::${scopeKey.trim()}`;
}

export const useSidebarOrderStore = create<SidebarOrderStoreState>()(
  persist(
    (set, get) => ({
      projectOrderByServerId: {},
      workspaceOrderByServerAndProject: {},
      sessionGroupOrderByServerId: {},
      sessionOrderByServerAndGroup: {},
      pinnedSessionGroupKeysByServerId: {},
      hiddenSessionGroupKeysByServerId: {},
      sidebarViewMode: "by-project",
      getProjectOrder: (serverId) => {
        const key = serverId.trim();
        if (!key) {
          return [];
        }
        return get().projectOrderByServerId[key] ?? [];
      },
      setProjectOrder: (serverId, keys) => {
        const key = serverId.trim();
        if (!key) {
          return;
        }
        const normalized = normalizeKeys(keys);
        set((state) => ({
          projectOrderByServerId: {
            ...state.projectOrderByServerId,
            [key]: normalized,
          },
        }));
      },
      getWorkspaceOrder: (serverId, projectKey) => {
        const serverKey = serverId.trim();
        const projectScope = projectKey.trim();
        if (!serverKey || !projectScope) {
          return [];
        }
        const scopeKey = buildScopedOrderKey(serverKey, projectScope);
        return get().workspaceOrderByServerAndProject[scopeKey] ?? [];
      },
      setWorkspaceOrder: (serverId, projectKey, keys) => {
        const serverKey = serverId.trim();
        const projectScope = projectKey.trim();
        if (!serverKey || !projectScope) {
          return;
        }
        const scopeKey = buildScopedOrderKey(serverKey, projectScope);
        const normalized = normalizeKeys(keys);
        set((state) => ({
          workspaceOrderByServerAndProject: {
            ...state.workspaceOrderByServerAndProject,
            [scopeKey]: normalized,
          },
        }));
      },
      getSessionGroupOrder: (serverId) => {
        const key = serverId.trim();
        if (!key) {
          return [];
        }
        return get().sessionGroupOrderByServerId[key] ?? [];
      },
      setSessionGroupOrder: (serverId, keys) => {
        const key = serverId.trim();
        if (!key) {
          return;
        }
        const normalized = normalizeKeys(keys);
        set((state) => ({
          sessionGroupOrderByServerId: {
            ...state.sessionGroupOrderByServerId,
            [key]: normalized,
          },
        }));
      },
      getSessionOrder: (serverId, groupKey) => {
        const serverKey = serverId.trim();
        const groupScope = groupKey.trim();
        if (!serverKey || !groupScope) {
          return [];
        }
        return get().sessionOrderByServerAndGroup[buildScopedOrderKey(serverKey, groupScope)] ?? [];
      },
      setSessionOrder: (serverId, groupKey, keys) => {
        const serverKey = serverId.trim();
        const groupScope = groupKey.trim();
        if (!serverKey || !groupScope) {
          return;
        }
        const scopeKey = buildScopedOrderKey(serverKey, groupScope);
        const normalized = normalizeKeys(keys);
        set((state) => ({
          sessionOrderByServerAndGroup: {
            ...state.sessionOrderByServerAndGroup,
            [scopeKey]: normalized,
          },
        }));
      },
      getPinnedSessionGroupKeys: (serverId) => {
        const key = serverId.trim();
        return key ? (get().pinnedSessionGroupKeysByServerId[key] ?? []) : [];
      },
      setSessionGroupPinned: (serverId, groupKey, pinned) => {
        const serverKey = serverId.trim();
        const groupScope = groupKey.trim();
        if (!serverKey || !groupScope) {
          return;
        }
        set((state) => {
          const current = state.pinnedSessionGroupKeysByServerId[serverKey] ?? [];
          const next = pinned
            ? normalizeKeys([groupScope, ...current])
            : current.filter((key) => key !== groupScope);
          return {
            pinnedSessionGroupKeysByServerId: {
              ...state.pinnedSessionGroupKeysByServerId,
              [serverKey]: next,
            },
          };
        });
      },
      getHiddenSessionGroupKeys: (serverId) => {
        const key = serverId.trim();
        return key ? (get().hiddenSessionGroupKeysByServerId[key] ?? []) : [];
      },
      setSessionGroupHidden: (serverId, groupKey, hidden) => {
        const serverKey = serverId.trim();
        const groupScope = groupKey.trim();
        if (!serverKey || !groupScope) {
          return;
        }
        set((state) => {
          const current = state.hiddenSessionGroupKeysByServerId[serverKey] ?? [];
          const next = hidden
            ? normalizeKeys([...current, groupScope])
            : current.filter((key) => key !== groupScope);
          return {
            hiddenSessionGroupKeysByServerId: {
              ...state.hiddenSessionGroupKeysByServerId,
              [serverKey]: next,
            },
          };
        });
      },
      setHiddenSessionGroupKeys: (serverId, keys) => {
        const serverKey = serverId.trim();
        if (!serverKey) {
          return;
        }
        const normalized = normalizeKeys(keys);
        set((state) => {
          const current = state.hiddenSessionGroupKeysByServerId[serverKey] ?? [];
          // Avoid a no-op state update when the normalized list is unchanged —
          // reconcile runs in an effect every render, so a spurious set would
          // loop. Compare by length + membership (normalizeKeys already
          // dedupes and preserves order, so equal length + every-key match is
          // a stable equality check).
          if (
            current.length === normalized.length &&
            current.every((key, i) => key === normalized[i])
          ) {
            return state;
          }
          return {
            hiddenSessionGroupKeysByServerId: {
              ...state.hiddenSessionGroupKeysByServerId,
              [serverKey]: normalized,
            },
          };
        });
      },
      clearHiddenSessionGroupKeys: (serverId) => {
        const serverKey = serverId.trim();
        if (!serverKey) {
          return;
        }
        set((state) => {
          if ((state.hiddenSessionGroupKeysByServerId[serverKey] ?? []).length === 0) {
            return state;
          }
          return {
            hiddenSessionGroupKeysByServerId: {
              ...state.hiddenSessionGroupKeysByServerId,
              [serverKey]: [],
            },
          };
        });
      },
      setSidebarViewMode: (mode) => {
        if (mode !== "by-project" && mode !== "by-status") {
          return;
        }
        set((state) => {
          if (state.sidebarViewMode === mode) {
            return state;
          }
          return { sidebarViewMode: mode };
        });
      },
    }),
    {
      name: "sidebar-project-workspace-order",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        projectOrderByServerId: state.projectOrderByServerId,
        workspaceOrderByServerAndProject: state.workspaceOrderByServerAndProject,
        sessionGroupOrderByServerId: state.sessionGroupOrderByServerId,
        sessionOrderByServerAndGroup: state.sessionOrderByServerAndGroup,
        pinnedSessionGroupKeysByServerId: state.pinnedSessionGroupKeysByServerId,
        hiddenSessionGroupKeysByServerId: state.hiddenSessionGroupKeysByServerId,
        sidebarViewMode: state.sidebarViewMode,
      }),
    },
  ),
);
