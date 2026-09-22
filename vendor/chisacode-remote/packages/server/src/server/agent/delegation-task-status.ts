import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type { StoredAgentRecord } from "./agent-storage.js";
import type { ManagedAgent } from "./agent-manager.js";

export type DelegationTaskStatus = "running" | "completed" | "error" | "closed" | "canceled";

export function mapDelegationStatus(input: {
  agent: ManagedAgent | null;
  record: StoredAgentRecord | null;
  timeline: readonly AgentTimelineItem[];
}): DelegationTaskStatus {
  const latestStatus = input.agent?.lifecycle ?? input.record?.lastStatus ?? "closed";
  if (input.record?.labels["chisacode.delegation-status"] === "canceled") {
    return "canceled";
  }
  if (input.record?.archivedAt || latestStatus === "closed") {
    return "closed";
  }
  if (latestStatus === "error") {
    return "error";
  }
  if (latestStatus === "running" || latestStatus === "initializing") {
    return "running";
  }
  return hasAssistantOutput(input.timeline) ? "completed" : "running";
}

export function summarizeDelegationResult(
  timeline: readonly AgentTimelineItem[],
  maxChars = 16_000,
): string {
  const assistantMessages = timeline
    .filter((item): item is Extract<AgentTimelineItem, { type: "assistant_message" }> => {
      return item.type === "assistant_message";
    })
    .map((item) => item.text.trim())
    .filter((text) => text.length > 0);

  const text = assistantMessages.at(-1) ?? "";
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function hasAssistantOutput(timeline: readonly AgentTimelineItem[]): boolean {
  return timeline.some((item) => item.type === "assistant_message" && item.text.trim().length > 0);
}
