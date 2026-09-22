export interface CompactionMarkerLabelInput {
  status: "loading" | "completed" | "failed";
  error?: string;
  trigger?: "auto" | "manual";
  preTokens?: number;
}

export function getCompactionMarkerLabel({
  status,
  error,
  trigger,
  preTokens,
}: CompactionMarkerLabelInput): string {
  if (status === "loading") return "Compacting...";
  if (status === "failed")
    return error?.trim()
      ? `Context compaction failed: ${error.trim()}`
      : "Context compaction failed";
  if (trigger === "auto") return "Context automatically compacted";
  if (trigger === "manual") return "Context manually compacted";
  if (preTokens) return `Context compacted (${Math.round(preTokens / 1000)}K tokens)`;
  return "Context compacted";
}
