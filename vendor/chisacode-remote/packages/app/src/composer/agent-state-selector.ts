import type { AgentFeature } from "@chisacode/protocol/agent-types";
import type { useSessionStore } from "@/stores/session-store";

type SessionStoreState = ReturnType<typeof useSessionStore.getState>;

const EMPTY_AGENT_FEATURES: AgentFeature[] = [];

export function buildAgentStateSelector(serverId: string, agentId: string) {
  return (state: SessionStoreState) => {
    const agent = state.sessions[serverId]?.agents?.get(agentId) ?? null;
    return {
      status: agent?.status ?? null,
      provider: agent?.provider ?? null,
      features: agent?.features ?? EMPTY_AGENT_FEATURES,
      contextWindowMaxTokens: agent?.lastUsage?.contextWindowMaxTokens ?? null,
      contextWindowUsedTokens: agent?.lastUsage?.contextWindowUsedTokens ?? null,
      totalCostUsd: agent?.lastUsage?.totalCostUsd ?? null,
    };
  };
}
