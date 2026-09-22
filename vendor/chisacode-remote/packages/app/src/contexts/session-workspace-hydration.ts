import type {
  DaemonClient,
  FetchWorkspacesOptions,
} from "@chisacode/client/internal/daemon-client";
import { normalizeWorkspaceDescriptor, type WorkspaceDescriptor } from "@/stores/session-store";
import { shouldSuppressWorkspaceForLocalArchive } from "@/contexts/session-workspace-upserts";

export interface WorkspaceHydrationOptions {
  subscribe?: boolean;
  isCancelled?: () => boolean;
  timeoutMs?: number;
}

export interface WorkspaceHydrationDeps {
  client: Pick<DaemonClient, "fetchWorkspaces">;
  serverId: string;
  setWorkspaces: (serverId: string, workspaces: Map<string, WorkspaceDescriptor>) => void;
  setHasHydratedWorkspaces: (serverId: string, hydrated: boolean) => void;
  shouldSuppressWorkspace?: (input: {
    serverId: string;
    workspace: WorkspaceDescriptor;
  }) => boolean;
}

function isHydrationCancelled(options: WorkspaceHydrationOptions | undefined): boolean {
  return options?.isCancelled?.() === true;
}

const DEFAULT_WORKSPACE_HYDRATION_PAGE_TIMEOUT_MS = 12_000;
let nextHydrationGeneration = 0;
const activeHydrationGenerations = new Map<string, number>();

function beginHydrationGeneration(serverId: string): number {
  nextHydrationGeneration += 1;
  const generation = nextHydrationGeneration;
  activeHydrationGenerations.set(serverId, generation);
  return generation;
}

function isCurrentHydrationGeneration(serverId: string, generation: number): boolean {
  return activeHydrationGenerations.get(serverId) === generation;
}

async function fetchWorkspacePage(
  client: Pick<DaemonClient, "fetchWorkspaces">,
  options: FetchWorkspacesOptions,
  timeoutMs: number,
): Promise<Awaited<ReturnType<DaemonClient["fetchWorkspaces"]>>> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return client.fetchWorkspaces(options);
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Workspace hydration request timed out (${timeoutMs}ms)`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([client.fetchWorkspaces(options), timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function hydrateWorkspaceDescriptors(
  deps: WorkspaceHydrationDeps,
  options?: WorkspaceHydrationOptions,
): Promise<void> {
  const generation = beginHydrationGeneration(deps.serverId);
  const workspaces = new Map<string, WorkspaceDescriptor>();
  let cursor: string | null = null;
  let includeSubscribe = options?.subscribe ?? false;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_WORKSPACE_HYDRATION_PAGE_TIMEOUT_MS;
  const shouldSuppressWorkspace =
    deps.shouldSuppressWorkspace ?? shouldSuppressWorkspaceForLocalArchive;

  try {
    while (true) {
      const payload = await fetchWorkspacePage(
        deps.client,
        {
          sort: [{ key: "activity_at", direction: "desc" }],
          ...(includeSubscribe ? { subscribe: {} } : {}),
          page: cursor ? { limit: 200, cursor } : { limit: 200 },
        },
        timeoutMs,
      );
      if (
        isHydrationCancelled(options) ||
        !isCurrentHydrationGeneration(deps.serverId, generation)
      ) {
        return;
      }

      for (const entry of payload.entries) {
        const workspace = normalizeWorkspaceDescriptor(entry);
        if (shouldSuppressWorkspace({ serverId: deps.serverId, workspace })) {
          continue;
        }
        workspaces.set(workspace.id, workspace);
      }

      if (!payload.pageInfo.hasMore || !payload.pageInfo.nextCursor) {
        break;
      }
      cursor = payload.pageInfo.nextCursor;
      includeSubscribe = false;
    }

    if (isHydrationCancelled(options) || !isCurrentHydrationGeneration(deps.serverId, generation)) {
      return;
    }

    deps.setWorkspaces(deps.serverId, workspaces);
    deps.setHasHydratedWorkspaces(deps.serverId, true);
  } finally {
    if (isCurrentHydrationGeneration(deps.serverId, generation)) {
      activeHydrationGenerations.delete(deps.serverId);
    }
  }
}
