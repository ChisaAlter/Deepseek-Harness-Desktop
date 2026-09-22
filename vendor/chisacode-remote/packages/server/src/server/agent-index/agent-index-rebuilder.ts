import type { AgentIndex } from "./sqlite-agent-index.js";
import type { AgentStorage } from "../agent/agent-storage.js";

export async function rebuildAgentIndexIfEmpty(input: {
  index: AgentIndex | null;
  agentStorage: AgentStorage;
}): Promise<void> {
  if (!input.index || !input.index.isEmpty()) {
    return;
  }
  const records = await input.agentStorage.list();
  for (const record of records) {
    input.index.upsertAgent(record);
  }
}
