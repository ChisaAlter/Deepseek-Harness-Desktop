import type { DaemonClient } from "@chisacode/client/internal/daemon-client";
import type { AgentPreset } from "@chisacode/protocol/agent-presets";

export const AGENT_PRESETS_QUERY_ROOT = "agentPresets";

export type AgentPresetsClient = Pick<DaemonClient, "listAgentPresets">;

export function agentPresetsQueryKey(serverId: string) {
  return [AGENT_PRESETS_QUERY_ROOT, serverId] as const;
}

export async function fetchAgentPresets(client: AgentPresetsClient): Promise<AgentPreset[]> {
  const response = await client.listAgentPresets();
  return response.presets;
}
