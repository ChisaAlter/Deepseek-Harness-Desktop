import { useMemo, useCallback, useSyncExternalStore } from "react";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "@/stores/session-store";
import type { AgentDirectoryEntry } from "@/types/agent-directory";
import type { Agent } from "@/stores/session-store";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import type { HostRuntimeAgentDirectoryStatus } from "@/runtime/host-runtime";

export interface AggregatedAgent extends AgentDirectoryEntry {
  serverId: string;
  serverLabel: string;
}

export interface AggregatedAgentsResult {
  agents: AggregatedAgent[];
  isLoading: boolean;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  refreshAll: () => void;
}

interface AggregatedHostInfo {
  serverId: string;
  label: string;
  agentDirectoryStatus?: HostRuntimeAgentDirectoryStatus;
}

function toAggregatedAgent(input: {
  agent: Agent;
  serverId: string;
  serverLabel: string;
}): AggregatedAgent {
  return {
    id: input.agent.id,
    serverId: input.serverId,
    serverLabel: input.serverLabel,
    title: input.agent.title ?? null,
    status: input.agent.status,
    lastActivityAt: input.agent.lastActivityAt,
    cwd: input.agent.cwd,
    provider: input.agent.provider,
    pendingPermissionCount: input.agent.pendingPermissions.length,
    requiresAttention: input.agent.requiresAttention,
    attentionReason: input.agent.attentionReason,
    attentionTimestamp: input.agent.attentionTimestamp,
    archivedAt: input.agent.archivedAt,
    createdAt: input.agent.createdAt,
    labels: input.agent.labels,
    projectPlacement: input.agent.projectPlacement ?? null,
  };
}

function getActivityTime(agent: AggregatedAgent): number {
  const value = agent.lastActivityAt.getTime();
  return Number.isFinite(value) ? value : 0;
}

function compareAggregatedAgents(left: AggregatedAgent, right: AggregatedAgent): number {
  const leftRunning = left.status === "running";
  const rightRunning = right.status === "running";
  if (leftRunning && !rightRunning) {
    return -1;
  }
  if (!leftRunning && rightRunning) {
    return 1;
  }
  return getActivityTime(right) - getActivityTime(left);
}

function buildAggregatedAgentsResult(input: {
  hosts: readonly AggregatedHostInfo[];
  sessionAgents: Record<string, Map<string, Agent> | undefined>;
  includeArchived: boolean;
}): Pick<AggregatedAgentsResult, "agents" | "isLoading" | "isInitialLoad" | "isRevalidating"> {
  const allAgents: AggregatedAgent[] = [];
  const serverLabelById = new Map(input.hosts.map((host) => [host.serverId, host.label] as const));

  for (const [serverId, agents] of Object.entries(input.sessionAgents)) {
    if (!agents || agents.size === 0) {
      continue;
    }
    const serverLabel = serverLabelById.get(serverId) ?? serverId;
    for (const agent of agents.values()) {
      if (!input.includeArchived && agent.archivedAt) {
        continue;
      }
      allAgents.push(toAggregatedAgent({ agent, serverId, serverLabel }));
    }
  }

  allAgents.sort(compareAggregatedAgents);

  const hasAnyData = allAgents.length > 0;
  const isLoading = input.hosts.some((host) => {
    const status = host.agentDirectoryStatus ?? "initial_loading";
    return status === "initial_loading" || status === "revalidating";
  });

  return {
    agents: allAgents,
    isLoading,
    isInitialLoad: isLoading && !hasAnyData,
    isRevalidating: isLoading && hasAnyData,
  };
}

export function useAggregatedAgents(options?: {
  includeArchived?: boolean;
}): AggregatedAgentsResult {
  const daemons = useHosts();
  const runtime = getHostRuntimeStore();
  const includeArchived = options?.includeArchived ?? false;
  const runtimeVersion = useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => runtime.getVersion(),
    () => runtime.getVersion(),
  );

  const sessionAgents = useSessionStore(
    useShallow((state) => {
      const result: Record<string, Map<string, Agent> | undefined> = {};
      for (const [serverId, session] of Object.entries(state.sessions)) {
        result[serverId] = session.agents;
      }
      return result;
    }),
  );

  const refreshAll = useCallback(() => {
    runtime.refreshAllAgentDirectories();
  }, [runtime]);

  const result = useMemo(() => {
    // runtimeVersion is referenced so the memo recomputes when runtime state changes.
    void runtimeVersion;
    return buildAggregatedAgentsResult({
      hosts: daemons.map((daemon) => ({
        serverId: daemon.serverId,
        label: daemon.label,
        agentDirectoryStatus: runtime.getSnapshot(daemon.serverId)?.agentDirectoryStatus,
      })),
      sessionAgents,
      includeArchived,
    });
  }, [daemons, includeArchived, runtime, runtimeVersion, sessionAgents]);

  return {
    ...result,
    refreshAll,
  };
}

export const __private__ = {
  buildAggregatedAgentsResult,
  compareAggregatedAgents,
  toAggregatedAgent,
};
