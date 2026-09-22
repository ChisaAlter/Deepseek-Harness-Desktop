import type { FetchAgentsEntry } from "@chisacode/client/internal/daemon-client";
import { type Agent, useSessionStore } from "@/stores/session-store";
import { derivePendingPermissionKey, normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { resolveProjectPlacement } from "@/utils/project-placement";

type AgentDirectoryFetchEntry = FetchAgentsEntry;

interface PendingPermissionEntry {
  key: string;
  agentId: string;
  request: Agent["pendingPermissions"][number];
}

/**
 * Builds session-store agent and pending-permission maps from a directory fetch
 * @param input Server id and fetched agent directory entries
 * @returns Normalized agents map and pending permission entries keyed for the store
 */
export function buildAgentDirectoryState(input: {
  serverId: string;
  entries: AgentDirectoryFetchEntry[];
}): {
  agents: Map<string, Agent>;
  pendingPermissions: Map<string, PendingPermissionEntry>;
} {
  const agents = new Map<string, Agent>();
  const pendingPermissions = new Map<string, PendingPermissionEntry>();

  for (const entry of input.entries) {
    const normalized = normalizeAgentSnapshot(entry.agent, input.serverId);
    const projectPlacement = resolveProjectPlacement({
      projectPlacement: entry.project,
      cwd: normalized.cwd,
    });
    const agent: Agent = {
      ...normalized,
      projectPlacement,
    };
    agents.set(agent.id, agent);

    for (const request of agent.pendingPermissions) {
      const key = derivePendingPermissionKey(agent.id, request);
      pendingPermissions.set(key, { key, agentId: agent.id, request });
    }
  }

  return { agents, pendingPermissions };
}

/**
 * Merges a just-created or optimistic local agent into a fetched directory map so
 * a concurrent directory refresh cannot wipe rows that the UI already knows about.
 * @param input Fetched agents plus local agents that must survive the replace
 * @returns Directory map with newer local agents preserved
 */
export function mergeLocalAgentsIntoFetchedDirectory(input: {
  fetchedAgents: Map<string, Agent>;
  localAgents: Iterable<Agent>;
}): Map<string, Agent> {
  let next: Map<string, Agent> | null = null;
  for (const local of input.localAgents) {
    if (local.archivedAt) {
      continue;
    }
    const fetched = input.fetchedAgents.get(local.id);
    if (!fetched) {
      next ??= new Map(input.fetchedAgents);
      next.set(local.id, local);
      continue;
    }
    if (local.updatedAt.getTime() <= fetched.updatedAt.getTime()) {
      continue;
    }
    next ??= new Map(input.fetchedAgents);
    next.set(local.id, {
      ...fetched,
      ...local,
      projectPlacement: local.projectPlacement ?? fetched.projectPlacement ?? null,
    });
  }
  return next ?? input.fetchedAgents;
}

/**
 * Replaces the session-store agent directory for a server with fetched entries
 * @param input Server id and daemon fetch results for that server
 * @returns The agents map written into the session store
 */
export function replaceFetchedAgentDirectory(input: {
  serverId: string;
  entries: FetchAgentsEntry[];
}): { agents: Map<string, Agent> } {
  const { agents: fetchedAgents, pendingPermissions } = buildAgentDirectoryState(input);
  const store = useSessionStore.getState();
  const previousAgents = store.sessions[input.serverId]?.agents;
  const agents = previousAgents
    ? mergeLocalAgentsIntoFetchedDirectory({
        fetchedAgents,
        localAgents: previousAgents.values(),
      })
    : fetchedAgents;

  store.setAgents(input.serverId, agents);
  store.setAgentDetails(input.serverId, (prev) => {
    let next: Map<string, Agent> | null = null;
    for (const agentId of agents.keys()) {
      if (!prev.has(agentId)) {
        continue;
      }
      next ??= new Map(prev);
      next.delete(agentId);
    }
    return next ?? prev;
  });

  const lastActivityByAgentId = new Map<string, Date>();
  for (const agent of agents.values()) {
    lastActivityByAgentId.set(agent.id, agent.lastActivityAt);
  }
  store.setAgentLastActivityBatch(lastActivityByAgentId);

  store.setPendingPermissions(input.serverId, new Map(pendingPermissions));
  store.setInitializingAgents(input.serverId, new Map());
  store.setHasHydratedAgents(input.serverId, true);
  return { agents };
}
