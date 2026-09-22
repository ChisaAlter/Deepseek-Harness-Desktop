import type { Agent } from "@/stores/session-store";

interface ShouldClearAgentAttentionInput {
  agentId: string | null | undefined;
  isConnected: boolean;
  requiresAttention: boolean | null | undefined;
  attentionReason?: "finished" | "error" | "permission" | null | undefined;
  trigger?: AgentAttentionClearTrigger;
  hasDeferredFocusEntryClear?: boolean;
}

/** UI event that may clear an agent's attention flag */
export type AgentAttentionClearTrigger =
  | "focus-entry"
  | "input-focus"
  | "prompt-send"
  | "agent-blur";

const ATTENTION_REASON_PRIORITY = {
  permission: 0,
  error: 1,
  finished: 2,
} as const;

function getAttentionPriority(reason: Agent["attentionReason"]): number | null {
  if (!reason) {
    return null;
  }
  return ATTENTION_REASON_PRIORITY[reason];
}

/**
 * Picks the highest-priority root agent that currently requires attention
 * @param agents Agents to evaluate
 * @returns Agent id of the preferred attention target, or null when none qualify
 */
export function pickAttentionAgent(agents: Agent[]): string | null {
  let selectedAgentId: string | null = null;
  let selectedPriority = Number.POSITIVE_INFINITY;
  let selectedTimestamp = Number.POSITIVE_INFINITY;

  for (const agent of agents) {
    if (agent.requiresAttention !== true) {
      continue;
    }

    if (agent.parentAgentId) {
      continue;
    }

    const priority = getAttentionPriority(agent.attentionReason);
    if (priority === null) {
      continue;
    }

    const timestamp = agent.attentionTimestamp?.getTime() ?? Number.POSITIVE_INFINITY;
    const isHigherPriority = priority < selectedPriority;
    const isOlderAtSamePriority = priority === selectedPriority && timestamp < selectedTimestamp;
    if (isHigherPriority || isOlderAtSamePriority) {
      selectedAgentId = agent.id;
      selectedPriority = priority;
      selectedTimestamp = timestamp;
    }
  }

  return selectedAgentId;
}

/**
 * Whether the current UI trigger should clear an agent's attention state
 * @param input Agent attention fields plus the UI trigger that may clear them
 * @returns True when attention should be cleared for this trigger
 */
export function shouldClearAgentAttention(input: ShouldClearAgentAttentionInput): boolean {
  const agentId = input.agentId?.trim();
  if (!agentId) {
    return false;
  }
  if (!input.isConnected) {
    return false;
  }
  if (!input.requiresAttention) {
    return false;
  }
  if (input.attentionReason === "permission") {
    return false;
  }
  if (input.trigger === "focus-entry" && input.hasDeferredFocusEntryClear === true) {
    return false;
  }
  return true;
}
