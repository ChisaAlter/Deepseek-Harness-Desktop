import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { tokenizeCommandCenterQuery } from "@/hooks/command-center-tokenizer";

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function matchesCommandCenterAgent(agent: AggregatedAgent, query: string): boolean {
  const queryTokens = tokenizeCommandCenterQuery(query);
  if (queryTokens.length === 0) {
    return true;
  }
  const searchableValues = [
    trimNonEmpty(agent.title) ?? "New agent",
    trimNonEmpty(agent.cwd),
    trimNonEmpty(agent.id),
    trimNonEmpty(agent.serverLabel),
    trimNonEmpty(agent.serverId),
    trimNonEmpty(agent.provider),
    trimNonEmpty(agent.status),
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
  return queryTokens.every((token) => searchableValues.some((value) => value.includes(token)));
}

export function resolveCommandCenterAgentTarget(
  agent: Pick<AggregatedAgent, "serverId" | "id">,
): { serverId: string; agentId: string } | null {
  const serverId = trimNonEmpty(agent.serverId);
  const agentId = trimNonEmpty(agent.id);
  if (!serverId || !agentId) {
    return null;
  }
  return { serverId, agentId };
}

export function compareCommandCenterAgents(left: AggregatedAgent, right: AggregatedAgent): number {
  const leftNeedsInput = (left.pendingPermissionCount ?? 0) > 0 ? 1 : 0;
  const rightNeedsInput = (right.pendingPermissionCount ?? 0) > 0 ? 1 : 0;
  if (leftNeedsInput !== rightNeedsInput) return rightNeedsInput - leftNeedsInput;

  const leftAttention = left.requiresAttention ? 1 : 0;
  const rightAttention = right.requiresAttention ? 1 : 0;
  if (leftAttention !== rightAttention) return rightAttention - leftAttention;

  const leftRunning = left.status === "running" ? 1 : 0;
  const rightRunning = right.status === "running" ? 1 : 0;
  if (leftRunning !== rightRunning) return rightRunning - leftRunning;

  return getActivityTime(right) - getActivityTime(left);
}

function getActivityTime(agent: AggregatedAgent): number {
  const value = agent.lastActivityAt.getTime();
  return Number.isFinite(value) ? value : 0;
}
