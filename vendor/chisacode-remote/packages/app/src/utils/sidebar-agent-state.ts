import {
  deriveAgentStateBucket,
  type AgentAttentionReason,
  type AgentStateBucketInput,
} from "@chisacode/protocol/agent-state-bucket";

/** Coarse agent status bucket used for left-sidebar styling and sorting */
export type SidebarStateBucket = "needs_input" | "failed" | "running" | "attention" | "done";

/** Attention reason forwarded from the shared agent state bucket helpers */
export type SidebarAttentionReason = AgentAttentionReason;

/**
 * Derives the sidebar status bucket for an agent from shared agent-state inputs
 * @param input Agent lifecycle/attention fields used by the protocol bucket helper
 * @returns The sidebar status bucket for the agent
 */
export function deriveSidebarStateBucket(input: AgentStateBucketInput): SidebarStateBucket {
  return deriveAgentStateBucket(input);
}

/**
 * Whether an agent still has active work or attention for sidebar "active" treatment
 * @param input Agent lifecycle/attention fields used by the protocol bucket helper
 * @returns True when the derived bucket is anything other than done
 */
export function isSidebarActiveAgent(input: AgentStateBucketInput): boolean {
  return deriveSidebarStateBucket(input) !== "done";
}
