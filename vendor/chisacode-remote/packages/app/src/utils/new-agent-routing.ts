import type { CheckoutStatusPayload } from "@/git/use-status-query";
import {
  parseHostWorkspaceOpenIntentFromPathname,
  parseHostAgentRouteFromPathname,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";

/**
 * Parses a `serverId:agentId` compound key
 * @param key Combined server and agent id separated by a colon
 * @returns Parsed ids, or null when the key is missing or malformed
 */
export function parseAgentKey(
  key: string | null | undefined,
): { serverId: string; agentId: string } | null {
  if (!key) {
    return null;
  }
  const sep = key.lastIndexOf(":");
  if (sep <= 0 || sep >= key.length - 1) {
    return null;
  }
  const serverId = key.slice(0, sep).trim();
  const agentId = key.slice(sep + 1).trim();
  if (!serverId || !agentId) {
    return null;
  }
  return { serverId, agentId };
}

/**
 * Resolves which agent context "new agent" flows should inherit from the route
 * @param input Current pathname and optional selected agent key
 * @returns Server/agent ids when an open-agent intent, agent route, or key is available
 */
export function resolveSelectedAgentForNewAgent(input: {
  pathname: string;
  selectedAgentId?: string;
}): { serverId: string; agentId: string } | null {
  const workspaceRoute = parseHostWorkspaceRouteFromPathname(input.pathname);
  const openIntent = parseHostWorkspaceOpenIntentFromPathname(input.pathname);
  if (workspaceRoute && openIntent?.kind === "agent") {
    const agentId = openIntent.agentId.trim();
    if (agentId) {
      return { serverId: workspaceRoute.serverId, agentId };
    }
  }
  return parseHostAgentRouteFromPathname(input.pathname) ?? parseAgentKey(input.selectedAgentId);
}

function inferMainRepoRootFromChisaCodeWorktreePath(cwd: string): string | null {
  const normalizedPath = cwd.replace(/\\/g, "/");
  const markerMatch = normalizedPath.match(/\/\.(?:chisacode|chisacode)\/worktrees/);
  const marker = markerMatch?.[0];
  if (!marker || markerMatch.index === undefined) {
    return null;
  }
  const markerIndex = markerMatch.index;
  if (markerIndex <= 0) {
    return null;
  }
  const markerEnd = markerIndex + marker.length;
  const nextChar = normalizedPath[markerEnd];
  if (nextChar && nextChar !== "/") {
    return null;
  }
  const inferred = cwd.slice(0, markerIndex).replace(/[\\/]+$/, "");
  return inferred.trim() ? inferred : null;
}

/**
 * Chooses the working directory for a new agent, preferring the main repo over worktrees
 * @param cwd Current agent or workspace working directory
 * @param checkout Checkout status used to detect ChisaCode-owned worktrees
 * @returns Main repo root when known, otherwise the original cwd
 */
export function resolveNewAgentWorkingDir(
  cwd: string,
  checkout: CheckoutStatusPayload | null,
): string {
  const explicitMainRepoRoot = checkout?.isChisaCodeOwnedWorktree
    ? checkout.mainRepoRoot?.trim() || null
    : null;
  if (explicitMainRepoRoot) {
    return explicitMainRepoRoot;
  }

  return inferMainRepoRootFromChisaCodeWorktreePath(cwd) ?? cwd;
}
