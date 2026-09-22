import type { AgentTimelineItem } from "../../agent-sdk-types.js";
import { CODEX_CONTEXT_COMPACTION_TYPE, normalizeCodexThreadItemType } from "./history.js";

type CompactionTimelineItem = Extract<AgentTimelineItem, { type: "compaction" }>;

/** Tracks Codex context compaction triggers and mirrored completion channels. */
export class CodexContextCompactionState {
  private pendingManualStarts = 0;
  private readonly triggerByItemId = new Map<string, "auto" | "manual">();
  private unpairedNotificationCompletions = 0;
  private unpairedItemCompletions = 0;

  beginManualCompaction(): void {
    this.pendingManualStarts += 1;
  }

  cancelManualCompactionStart(): void {
    this.pendingManualStarts = Math.max(0, this.pendingManualStarts - 1);
  }

  isCompactionItem(item: { type?: string; [key: string]: unknown }): boolean {
    return (
      normalizeCodexThreadItemType(typeof item.type === "string" ? item.type : undefined) ===
      CODEX_CONTEXT_COMPACTION_TYPE
    );
  }

  createTimelineItem(status: "loading" | "completed", itemId?: string): CompactionTimelineItem {
    const trigger = this.resolveTrigger(itemId);
    if (itemId && trigger) {
      if (status === "loading") {
        this.triggerByItemId.set(itemId, trigger);
      } else {
        this.triggerByItemId.delete(itemId);
      }
    }
    return {
      type: "compaction",
      status,
      ...(trigger ? { trigger } : {}),
    };
  }

  shouldEmitNotificationCompletion(): boolean {
    if (this.unpairedItemCompletions > 0) {
      this.unpairedItemCompletions -= 1;
      return false;
    }
    this.unpairedNotificationCompletions += 1;
    return true;
  }

  shouldEmitItemCompletion(): boolean {
    if (this.unpairedNotificationCompletions > 0) {
      this.unpairedNotificationCompletions -= 1;
      return false;
    }
    this.unpairedItemCompletions += 1;
    return true;
  }

  resetTurnPairing(): void {
    this.unpairedNotificationCompletions = 0;
    this.unpairedItemCompletions = 0;
  }

  private resolveTrigger(itemId?: string): "auto" | "manual" | undefined {
    if (itemId) {
      const known = this.triggerByItemId.get(itemId);
      if (known) {
        return known;
      }
    }
    if (this.pendingManualStarts > 0) {
      this.pendingManualStarts -= 1;
      return "manual";
    }
    return undefined;
  }
}
