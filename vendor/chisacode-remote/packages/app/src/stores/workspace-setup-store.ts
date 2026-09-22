import type { SessionOutboundMessage } from "@chisacode/protocol/messages";
import { create } from "zustand";
import { buildWorkspaceTabPersistenceKey } from "@/stores/workspace-layout-store";

export type WorkspaceCreationMethod = "open_project" | "create_worktree";

export interface PendingWorkspaceSetup {
  serverId: string;
  sourceDirectory: string;
  sourceWorkspaceId?: string;
  displayName?: string;
  creationMethod: WorkspaceCreationMethod;
}

export type WorkspaceSetupProgressPayload = Extract<
  SessionOutboundMessage,
  { type: "workspace_setup_progress" }
>["payload"];

export interface WorkspaceSetupSnapshot extends WorkspaceSetupProgressPayload {
  updatedAt: number;
  autoOpenUntil: number | null;
}

const WORKSPACE_SETUP_AUTO_OPEN_WINDOW_MS = 30_000;

export function shouldShowWorkspaceSetup(snapshot: WorkspaceSetupSnapshot | null): boolean {
  if (!snapshot) {
    return false;
  }
  return snapshot.error !== null || snapshot.detail.commands.length > 0;
}

export function shouldAutoOpenWorkspaceSetup(
  snapshot: WorkspaceSetupSnapshot | null,
  now: number = Date.now(),
): boolean {
  if (!snapshot || !shouldShowWorkspaceSetup(snapshot)) {
    return false;
  }
  if (snapshot.status === "running") {
    return true;
  }
  return snapshot.autoOpenUntil !== null && now <= snapshot.autoOpenUntil;
}

type WorkspaceSetupProgressSource = "live" | "cached";

interface WorkspaceSetupStoreState {
  pendingWorkspaceSetup: PendingWorkspaceSetup | null;
  snapshots: Record<string, WorkspaceSetupSnapshot>;
  beginWorkspaceSetup: (value: PendingWorkspaceSetup) => void;
  clearWorkspaceSetup: () => void;
  upsertProgress: (input: {
    serverId: string;
    payload: WorkspaceSetupProgressPayload;
    source?: WorkspaceSetupProgressSource;
  }) => void;
  removeWorkspace: (input: { serverId: string; workspaceId: string }) => void;
  clearServer: (serverId: string) => void;
}

function buildWorkspaceSetupKey(input: { serverId: string; workspaceId: string }): string | null {
  return buildWorkspaceTabPersistenceKey(input);
}

function resolveAutoOpenUntil(input: {
  previous: WorkspaceSetupSnapshot | undefined;
  payload: WorkspaceSetupProgressPayload;
  source: WorkspaceSetupProgressSource;
  now: number;
}): number | null {
  if (input.source === "cached" || input.payload.status === "running") {
    return input.previous?.autoOpenUntil ?? null;
  }
  return input.now + WORKSPACE_SETUP_AUTO_OPEN_WINDOW_MS;
}

export const useWorkspaceSetupStore = create<WorkspaceSetupStoreState>()((set) => ({
  pendingWorkspaceSetup: null,
  snapshots: {},
  beginWorkspaceSetup: (value) => {
    set({ pendingWorkspaceSetup: value });
  },
  clearWorkspaceSetup: () => {
    set({ pendingWorkspaceSetup: null });
  },
  upsertProgress: ({ serverId, payload, source = "live" }) => {
    const key = buildWorkspaceSetupKey({ serverId, workspaceId: payload.workspaceId });
    if (!key) {
      return;
    }

    const now = Date.now();
    set((state) => ({
      snapshots: {
        ...state.snapshots,
        [key]: {
          ...payload,
          updatedAt: now,
          autoOpenUntil: resolveAutoOpenUntil({
            previous: state.snapshots[key],
            payload,
            source,
            now,
          }),
        },
      },
    }));
  },
  removeWorkspace: ({ serverId, workspaceId }) => {
    const key = buildWorkspaceSetupKey({ serverId, workspaceId });
    if (!key) {
      return;
    }

    set((state) => {
      if (!(key in state.snapshots)) {
        return state;
      }
      const next = { ...state.snapshots };
      delete next[key];
      return { snapshots: next };
    });
  },
  clearServer: (serverId) => {
    set((state) => {
      const nextEntries = Object.entries(state.snapshots).filter(
        ([key]) => !key.startsWith(`${serverId}:`),
      );
      if (nextEntries.length === Object.keys(state.snapshots).length) {
        return state;
      }
      return { snapshots: Object.fromEntries(nextEntries) };
    });
  },
}));
