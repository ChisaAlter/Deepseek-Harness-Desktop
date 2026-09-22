import type { Agent } from "@/stores/session-store";

/**
 * Extracts a non-empty model name from an agent, preferring runtime info
 * @param agent Agent snapshot, if any
 * @returns Trimmed model id, or null when unavailable
 */
export function extractAgentModel(agent?: Agent | null): string | null {
  if (!agent) return null;
  const runtimeModel = agent.runtimeInfo?.model;
  const fallbackModel = agent.model;
  if (typeof runtimeModel === "string") {
    const normalized = runtimeModel.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }
  if (typeof fallbackModel === "string") {
    const normalized = fallbackModel.trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return null;
}
