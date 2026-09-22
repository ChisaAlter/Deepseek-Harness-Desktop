import type { WorkspaceDescriptor } from "@/stores/session-store";
import { normalizeWorkspaceOpaqueId, normalizeWorkspacePath } from "@/utils/workspace-identity";

/** A validated workspace authority: the resolved workspace id, directory, and descriptor safe to execute against. */
export interface WorkspaceAuthorityResult {
  workspaceId: string;
  workspaceDirectory: string;
  workspace: WorkspaceDescriptor;
}

/** Machine-readable reasons why workspace execution authority resolution can fail. */
export type WorkspaceExecutionAuthorityFailureReason =
  | "workspace_id_missing"
  | "workspace_missing"
  | "workspace_directory_missing";

/** Result of resolving workspace execution authority: a validated authority or a failure with reason and message. */
export type WorkspaceExecutionAuthorityResult =
  | { ok: true; authority: WorkspaceAuthorityResult }
  | {
      ok: false;
      reason: WorkspaceExecutionAuthorityFailureReason;
      message: string;
    };

/**
 * Normalizes the workspace id taken from a route parameter.
 * @param input Object carrying the raw route workspace id
 * @returns The normalized workspace id, or null when it is blank
 */
export function resolveWorkspaceRouteId(input: {
  routeWorkspaceId: string | null | undefined;
}): string | null {
  return normalizeWorkspaceOpaqueId(input.routeWorkspaceId);
}

/**
 * Finds the workspace whose directory matches the given execution directory.
 * @param input Object carrying the candidate workspaces and the execution directory to match
 * @returns The matching workspace id, or null when no workspace matches
 */
export function resolveWorkspaceIdByExecutionDirectory(input: {
  workspaces: Iterable<WorkspaceDescriptor> | null | undefined;
  workspaceDirectory: string | null | undefined;
}): string | null {
  const normalizedWorkspaceDirectory = normalizeWorkspacePath(input.workspaceDirectory);
  if (!normalizedWorkspaceDirectory) {
    return null;
  }

  for (const workspace of input.workspaces ?? []) {
    if (normalizeWorkspacePath(workspace.workspaceDirectory) === normalizedWorkspaceDirectory) {
      return workspace.id;
    }
  }

  return null;
}

function isPathLikeWorkspaceIdentity(value: string): boolean {
  return value.includes("/") || value.includes("\\") || /^[A-Za-z]:[\\/]/.test(value);
}

function workspaceIdentityMatches(left: string, right: string): boolean {
  const normalizedLeft = normalizeWorkspaceOpaqueId(left);
  const normalizedRight = normalizeWorkspaceOpaqueId(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  if (
    !isPathLikeWorkspaceIdentity(normalizedLeft) ||
    !isPathLikeWorkspaceIdentity(normalizedRight)
  ) {
    return false;
  }
  return normalizeWorkspacePath(normalizedLeft) === normalizeWorkspacePath(normalizedRight);
}

/**
 * Finds the map key whose workspace matches the given id, comparing both opaque ids and path-like identities.
 * @param input Object carrying the workspace map and the workspace id to look up
 * @returns The matching map key, or null when no workspace matches
 */
export function resolveWorkspaceMapKeyByIdentity(input: {
  workspaces: Map<string, WorkspaceDescriptor> | null | undefined;
  workspaceId: string | null | undefined;
}): string | null {
  const normalizedWorkspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
  if (!normalizedWorkspaceId) {
    return null;
  }

  const workspaces = input.workspaces;
  if (!workspaces) {
    return null;
  }

  if (workspaces.has(normalizedWorkspaceId)) {
    return normalizedWorkspaceId;
  }

  for (const [workspaceKey, workspace] of workspaces) {
    if (
      workspaceIdentityMatches(workspace.id, normalizedWorkspaceId) ||
      workspaceIdentityMatches(workspaceKey, normalizedWorkspaceId)
    ) {
      return workspaceKey;
    }
  }

  return null;
}

/**
 * Resolves and validates the execution authority for a workspace supplied directly or via a workspace map and id.
 * @param input Either a workspace descriptor, or a workspace map plus the workspace id to resolve
 * @returns A result that is ok with the validated authority, or a failure with reason and message
 */
export function getWorkspaceExecutionAuthority(
  input:
    | {
        workspace: WorkspaceDescriptor | null | undefined;
      }
    | {
        workspaces: Map<string, WorkspaceDescriptor> | undefined;
        workspaceId: string | null | undefined;
      },
): WorkspaceExecutionAuthorityResult {
  const workspace =
    "workspace" in input
      ? input.workspace
      : (() => {
          const workspaceKey = resolveWorkspaceMapKeyByIdentity({
            workspaces: input.workspaces,
            workspaceId: input.workspaceId,
          });
          if (!workspaceKey) {
            return null;
          }
          return input.workspaces?.get(workspaceKey) ?? null;
        })();

  if ("workspaces" in input) {
    const normalizedWorkspaceId = normalizeWorkspaceOpaqueId(input.workspaceId);
    if (!normalizedWorkspaceId) {
      return {
        ok: false,
        reason: "workspace_id_missing",
        message: "Workspace id is required.",
      };
    }
  }

  if (!workspace) {
    return {
      ok: false,
      reason: "workspace_missing",
      message:
        "workspaces" in input
          ? `Workspace not found: ${input.workspaceId ?? ""}`
          : "Workspace not found.",
    };
  }

  const workspaceDirectory = normalizeWorkspacePath(workspace.workspaceDirectory);
  if (!workspaceDirectory) {
    return {
      ok: false,
      reason: "workspace_directory_missing",
      message: `Workspace directory is missing for workspace ${workspace.id}`,
    };
  }

  return {
    ok: true,
    authority: {
      workspaceId: workspace.id,
      workspaceDirectory,
      workspace,
    },
  };
}

/**
 * Resolves the execution authority for a workspace, throwing when it cannot be validated.
 * @param input Either a workspace descriptor, or a workspace map plus the workspace id to resolve
 * @returns The validated workspace authority
 * @throws When the workspace id is missing, the workspace is not found, or its directory is missing
 */
export function requireWorkspaceExecutionAuthority(
  input:
    | {
        workspace: WorkspaceDescriptor | null | undefined;
      }
    | {
        workspaces: Map<string, WorkspaceDescriptor> | undefined;
        workspaceId: string | null | undefined;
      },
): WorkspaceAuthorityResult {
  const result = getWorkspaceExecutionAuthority(input);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.authority;
}

/**
 * Normalizes a candidate workspace execution directory.
 * @param input Object carrying the raw workspace directory
 * @returns The normalized directory, or null when it is blank
 */
export function resolveWorkspaceExecutionDirectory(input: {
  workspaceDirectory: string | null | undefined;
}): string | null {
  return normalizeWorkspacePath(input.workspaceDirectory);
}

/**
 * Normalizes a workspace execution directory, throwing when it is missing.
 * @param input Object carrying the raw workspace directory and an optional workspace id for the error message
 * @returns The normalized execution directory
 * @throws When the workspace directory is blank
 */
export function requireWorkspaceExecutionDirectory(input: {
  workspaceId?: string;
  workspaceDirectory: string | null | undefined;
}): string {
  const workspaceDirectory = resolveWorkspaceExecutionDirectory({
    workspaceDirectory: input.workspaceDirectory,
  });
  if (!workspaceDirectory) {
    throw new Error(
      input.workspaceId
        ? `Workspace directory is missing for workspace ${input.workspaceId}`
        : "Workspace directory is missing.",
    );
  }
  return workspaceDirectory;
}

/**
 * Resolves the execution authority for a workspace without throwing.
 * @param input Either a workspace descriptor, or a workspace map plus the workspace id to resolve
 * @returns The validated workspace authority, or null when resolution fails
 */
export function resolveWorkspaceExecutionAuthority(
  input:
    | {
        workspace: WorkspaceDescriptor | null | undefined;
      }
    | {
        workspaces: Map<string, WorkspaceDescriptor> | undefined;
        workspaceId: string | null | undefined;
      },
): WorkspaceAuthorityResult | null {
  const result = getWorkspaceExecutionAuthority(input);
  return result.ok ? result.authority : null;
}
