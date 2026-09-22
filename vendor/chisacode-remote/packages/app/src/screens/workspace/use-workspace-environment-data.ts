import { useMemo } from "react";
import type { GoalListItem } from "@chisacode/protocol/goal/rpc-schemas";

import { useGoals } from "@/hooks/use-goal";
import { useSubagentsForParent, type SubagentRow } from "@/subagents/select";
import { useSessionStore, type Agent, type WorkspaceDescriptor } from "@/stores/session-store";
import type { StreamItem, TodoEntry, TurnChangesItem } from "@/types/stream";
import {
  buildWorkspaceActivityItems,
  buildWorkspaceStatusStripModel,
  findLatestTodoItems,
  resolveAgentProgress,
  type AgentProgressModel,
  type WorkspaceActivityItem,
  type WorkspaceStatusStripModel,
} from "@/screens/workspace/workspace-environment-panel-model";
import { findLatestTurnChanges } from "@/screens/workspace/workspace-environment-dock-model";

interface UseWorkspaceEnvironmentDataInput {
  normalizedServerId: string;
  activeTargetAgentId: string | null;
  workspaceDescriptor: WorkspaceDescriptor | null | undefined;
  currentBranchName: string | null;
}

interface UseWorkspaceEnvironmentDataResult {
  environmentPanelAgent: Agent | null;
  environmentPanelAgentId: string | null;
  environmentSubagents: SubagentRow[];
  environmentTodoItems: TodoEntry[] | null;
  environmentProgress: AgentProgressModel | null;
  environmentGoal: GoalListItem | null;
  cancelEnvironmentGoal: (() => Promise<unknown>) | null;
  environmentTurnChanges: TurnChangesItem | null;
  environmentSourceLabel: string | null;
  environmentWorkspaceStatus: WorkspaceDescriptor["status"] | null;
  workspaceStatusStripModel: WorkspaceStatusStripModel;
  workspaceActivityItems: WorkspaceActivityItem[];
  hasFloatingInspectorContent: boolean;
}

function getWorkspaceEnvironmentSourceLabel(
  workspace: WorkspaceDescriptor | null | undefined,
): string | null {
  const label = workspace?.projectDisplayName ?? workspace?.projectRootPath;
  const normalized = label?.trim();
  return normalized ? normalized : null;
}

function useEnvironmentPanelAgent(serverId: string, agentId: string | null): Agent | null {
  return useSessionStore((state) => {
    if (!agentId) {
      return null;
    }
    return state.sessions[serverId]?.agents?.get(agentId) ?? null;
  });
}

function useEnvironmentPanelTodoItems(
  serverId: string,
  agentId: string | null,
): TodoEntry[] | null {
  return useSessionStore((state) => {
    if (!agentId) {
      return null;
    }
    const session = state.sessions[serverId];
    return findLatestTodoItems({
      head: session?.agentStreamHead.get(agentId),
      tail: session?.agentStreamTail.get(agentId),
    });
  });
}

function useEnvironmentPanelStreamHead(
  serverId: string,
  agentId: string | null,
): readonly StreamItem[] | null {
  return useSessionStore((state) => {
    if (!agentId) {
      return null;
    }
    return state.sessions[serverId]?.agentStreamHead.get(agentId) ?? null;
  });
}

function useEnvironmentPanelStreamTail(
  serverId: string,
  agentId: string | null,
): readonly StreamItem[] | null {
  return useSessionStore((state) => {
    if (!agentId) {
      return null;
    }
    return state.sessions[serverId]?.agentStreamTail.get(agentId) ?? null;
  });
}

function useEnvironmentPanelTurnChanges(
  serverId: string,
  agentId: string | null,
): TurnChangesItem | null {
  return useSessionStore((state) => {
    if (!agentId) {
      return null;
    }
    const session = state.sessions[serverId];
    return findLatestTurnChanges({
      head: session?.agentStreamHead.get(agentId),
      tail: session?.agentStreamTail.get(agentId),
    });
  });
}

/**
 * Aggregates the active target's agent, activity, and workspace environment models.
 * @param input Current server, active agent, workspace, and branch inputs
 * @returns Reactive environment panel data and derived presentation models
 */
export function useWorkspaceEnvironmentData(
  input: UseWorkspaceEnvironmentDataInput,
): UseWorkspaceEnvironmentDataResult {
  const { normalizedServerId, activeTargetAgentId, workspaceDescriptor, currentBranchName } = input;
  const environmentPanelAgent = useEnvironmentPanelAgent(normalizedServerId, activeTargetAgentId);
  const environmentSubagents = useSubagentsForParent({
    serverId: normalizedServerId,
    parentAgentId: activeTargetAgentId ?? "",
  });
  const environmentTodoItems = useEnvironmentPanelTodoItems(
    normalizedServerId,
    activeTargetAgentId,
  );
  const environmentStreamHead = useEnvironmentPanelStreamHead(
    normalizedServerId,
    activeTargetAgentId,
  );
  const environmentStreamTail = useEnvironmentPanelStreamTail(
    normalizedServerId,
    activeTargetAgentId,
  );
  const environmentProgress = useMemo(
    () =>
      resolveAgentProgress({
        head: environmentStreamHead,
        tail: environmentStreamTail,
      }),
    [environmentStreamHead, environmentStreamTail],
  );
  const { goals, cancelGoal } = useGoals(normalizedServerId || null);
  const environmentGoal = useMemo(() => {
    if (!activeTargetAgentId) {
      return null;
    }
    return goals.find((goal) => goal.agentId === activeTargetAgentId) ?? null;
  }, [activeTargetAgentId, goals]);
  const cancelEnvironmentGoal = useMemo(() => {
    if (!activeTargetAgentId || !environmentGoal) {
      return null;
    }
    if (
      environmentGoal.status !== "active" &&
      environmentGoal.status !== "paused" &&
      environmentGoal.status !== "blocked"
    ) {
      return null;
    }
    const agentId = activeTargetAgentId;
    return () => cancelGoal(agentId);
  }, [activeTargetAgentId, cancelGoal, environmentGoal]);
  const environmentTurnChanges = useEnvironmentPanelTurnChanges(
    normalizedServerId,
    activeTargetAgentId,
  );
  const workspaceStatusStripModel = useMemo(
    () =>
      buildWorkspaceStatusStripModel({
        activeAgent: environmentPanelAgent,
        workspace: workspaceDescriptor,
        currentBranchName,
        todoItems: environmentTodoItems,
      }),
    [currentBranchName, environmentPanelAgent, environmentTodoItems, workspaceDescriptor],
  );
  const workspaceActivityItems = useMemo(
    () =>
      buildWorkspaceActivityItems({
        activeAgent: environmentPanelAgent,
        workspace: workspaceDescriptor,
        currentBranchName,
      }),
    [currentBranchName, environmentPanelAgent, workspaceDescriptor],
  );
  const hasFloatingInspectorContent = Boolean(
    environmentGoal || environmentProgress || environmentSubagents.length > 0,
  );

  return {
    environmentPanelAgent,
    environmentPanelAgentId: environmentPanelAgent?.id ?? null,
    environmentSubagents,
    environmentTodoItems,
    environmentProgress,
    environmentGoal,
    cancelEnvironmentGoal,
    environmentTurnChanges,
    environmentSourceLabel: getWorkspaceEnvironmentSourceLabel(workspaceDescriptor),
    environmentWorkspaceStatus: workspaceDescriptor?.status ?? null,
    workspaceStatusStripModel,
    workspaceActivityItems,
    hasFloatingInspectorContent,
  };
}
