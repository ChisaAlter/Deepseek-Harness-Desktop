/**
 * Work-log collapse for the agent chat timeline.
 *
 * Completed turns already fold their thoughts and earlier tool calls into a
 * summary (see model.ts `collapseCompletedTurnThoughtsForDisplay`). This
 * module adds the second noise-reduction layer from the reference
 * implementation: a run of tool badges in the same tool-sequence group is
 * collapsed to the last `maxVisible` entries, with the hidden count surfaced
 * as a "+N" affordance that expands on demand.
 */

import type { StreamItem } from "@/types/stream";

/** Matches the reference implementation's MAX_VISIBLE_WORK_LOG_ENTRIES. */
export const MAX_VISIBLE_WORK_LOG_ENTRIES = 1;

export interface WorkLogCollapseInput {
  readonly toolEntries: readonly Extract<StreamItem, { kind: "tool_call" }>[];
  readonly expanded: boolean;
  readonly maxVisible?: number;
}

export interface WorkLogCollapseResult {
  readonly visibleEntries: readonly Extract<StreamItem, { kind: "tool_call" }>[];
  readonly hiddenCount: number;
  readonly hasHidden: boolean;
}

/**
 * Collapses a run of tool-call entries to its last `maxVisible` entries.
 * @param toolEntries Tool-call entries in render order
 * @param expanded True when the "+N" affordance has been expanded
 * @param maxVisible Max entries kept visible while collapsed (default 1)
 * @returns The entries to render and how many are hidden behind the affordance
 */
export function deriveWorkLogCollapse(input: WorkLogCollapseInput): WorkLogCollapseResult {
  const maxVisible = input.maxVisible ?? MAX_VISIBLE_WORK_LOG_ENTRIES;
  if (input.toolEntries.length === 0) {
    return {
      visibleEntries: [],
      hiddenCount: 0,
      hasHidden: false,
    };
  }
  if (input.toolEntries.length <= maxVisible) {
    return {
      visibleEntries: input.toolEntries,
      hiddenCount: 0,
      hasHidden: false,
    };
  }

  const hiddenEntries = input.toolEntries.slice(0, -maxVisible);
  const visibleEntries = input.toolEntries.slice(-maxVisible);
  return {
    visibleEntries: input.expanded ? [...hiddenEntries, ...visibleEntries] : visibleEntries,
    hiddenCount: hiddenEntries.length,
    hasHidden: true,
  };
}
