import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { Agent } from "@/stores/session-store";

function getAgentSourceKey(agent: Pick<AggregatedAgent, "serverId" | "id">): string {
  return `${agent.serverId}:${agent.id}`;
}

function getCreatedTime(agent: AggregatedAgent): number {
  const value = agent.createdAt.getTime();
  return Number.isFinite(value) ? value : 0;
}

/**
 * T3 Sidebar V2: newest created first. Activity never reshuffles this list.
 */
function compareSidebarLiveAgents(left: AggregatedAgent, right: AggregatedAgent): number {
  const createdDiff = getCreatedTime(right) - getCreatedTime(left);
  if (createdDiff !== 0) {
    return createdDiff;
  }
  return left.id.localeCompare(right.id);
}

/**
 * Builds non-archived live agents for the left sidebar from a session store map
 * @param input Agents map, active server id, and display label for that server
 * @returns Aggregated live agents sorted by createdAt descending (newest first)
 */
export function buildSidebarLiveAgents(input: {
  agents: Map<string, Agent> | undefined;
  serverId: string | null;
  serverLabel: string;
}): AggregatedAgent[] {
  if (!input.serverId || !input.agents) {
    return [];
  }
  const liveAgents: AggregatedAgent[] = [];
  for (const agent of input.agents.values()) {
    if (agent.archivedAt) {
      continue;
    }
    liveAgents.push({
      id: agent.id,
      serverId: input.serverId,
      serverLabel: input.serverLabel,
      title: agent.title ?? null,
      status: agent.status,
      lastActivityAt: agent.lastActivityAt,
      cwd: agent.cwd,
      provider: agent.provider,
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
      attentionTimestamp: agent.attentionTimestamp ?? null,
      archivedAt: agent.archivedAt ?? null,
      createdAt: agent.createdAt,
      labels: agent.labels,
      projectPlacement: agent.projectPlacement ?? null,
    });
  }
  liveAgents.sort(compareSidebarLiveAgents);
  return liveAgents;
}

/**
 * Merges live and historical sidebar agents while preserving selection when still present
 * @param input Live agents, history agents, optional suppressions, and selected agent id
 * @returns Deduplicated agents and a selected id only when it still exists in the merge
 */
export function mergeSidebarSessionSources(input: {
  liveAgents: AggregatedAgent[];
  historyAgents: AggregatedAgent[];
  suppressedAgentIds?: ReadonlySet<string>;
  selectedAgentId?: string;
}): { agents: AggregatedAgent[]; selectedAgentId?: string } {
  const merged: AggregatedAgent[] = [];
  const seen = new Set<string>();
  for (const agent of [...input.liveAgents, ...input.historyAgents]) {
    if (input.suppressedAgentIds?.has(agent.id)) {
      continue;
    }
    const key = getAgentSourceKey(agent);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(agent);
  }
  const selectedAgentId =
    input.selectedAgentId &&
    merged.some(
      (agent) =>
        agent.id === input.selectedAgentId ||
        `${agent.serverId}:${agent.id}` === input.selectedAgentId,
    )
      ? input.selectedAgentId
      : undefined;
  return {
    agents: merged,
    selectedAgentId,
  };
}
