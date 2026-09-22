import type { Logger } from "pino";

import type { AgentTimelineItem } from "./agent-sdk-types.js";
import {
  InMemoryAgentTimelineStore,
  type SeedAgentTimelineOptions,
} from "./agent-timeline-store.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStore,
} from "./agent-timeline-store-types.js";

interface AgentTimelineControllerOptions {
  durableStore?: AgentTimelineStore;
  logger: Logger;
  trackBackgroundTask(task: Promise<void>): void;
}

export interface InitializeAgentTimelineOptions {
  timeline?: AgentTimelineItem[];
  timelineRows?: AgentTimelineRow[];
  timelineNextSeq?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

interface AssistantSegment {
  text: string;
  firstSeq: number;
  startsAtBeginning: boolean;
}

const DURABLE_ASSISTANT_PAGE_SIZE = 200;

function buildExplicitTimelineSeed(
  now: Date,
  options: InitializeAgentTimelineOptions | undefined,
): SeedAgentTimelineOptions | null {
  const hasTimeline = Boolean(options?.timeline?.length);
  const hasTimelineRows = Boolean(options?.timelineRows?.length);
  const hasTimelineNextSeq = options?.timelineNextSeq !== undefined;
  if (!hasTimeline && !hasTimelineRows && !hasTimelineNextSeq) {
    return null;
  }
  return {
    items: options?.timeline,
    rows: options?.timelineRows,
    nextSeq: options?.timelineNextSeq,
    timestamp: (options?.updatedAt ?? options?.createdAt ?? now).toISOString(),
  };
}

function getLastAssistantSegment(rows: readonly AgentTimelineRow[]): AssistantSegment | null {
  const chunks: string[] = [];
  let firstSeq = 0;
  let startsAtBeginning = false;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.item.type !== "assistant_message") {
      if (chunks.length > 0) break;
      continue;
    }
    chunks.push(row.item.text);
    firstSeq = row.seq;
    startsAtBeginning = index === 0;
  }
  if (chunks.length === 0) {
    return null;
  }
  return {
    text: chunks.toReversed().join(""),
    firstSeq,
    startsAtBeginning,
  };
}

/** Owns in-memory and durable timeline state, queries, and persistence scheduling. */
export class AgentTimelineController {
  private readonly memoryStore = new InMemoryAgentTimelineStore();
  private readonly durableStore: AgentTimelineStore | undefined;
  private readonly logger: Logger;
  private readonly trackBackgroundTask: (task: Promise<void>) => void;

  constructor(options: AgentTimelineControllerOptions) {
    this.durableStore = options.durableStore;
    this.logger = options.logger;
    this.trackBackgroundTask = options.trackBackgroundTask;
  }

  has(agentId: string): boolean {
    return this.memoryStore.has(agentId);
  }

  getItemCount(agentId: string): number {
    return this.memoryStore.getItems(agentId).length;
  }

  getItems(agentId: string): AgentTimelineItem[] {
    return this.memoryStore.getItems(agentId);
  }

  async getRows(agentId: string): Promise<AgentTimelineRow[]> {
    return this.durableStore
      ? await this.durableStore.getCommittedRows(agentId)
      : this.memoryStore.getRows(agentId);
  }

  fetch(agentId: string, options?: AgentTimelineFetchOptions): AgentTimelineFetchResult {
    return this.memoryStore.fetch(agentId, options);
  }

  getEpoch(agentId: string): string {
    return this.memoryStore.getEpoch(agentId);
  }

  append(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string },
  ): AgentTimelineRow {
    const row = this.memoryStore.append(agentId, item, options);
    this.enqueueDurableAppend(agentId, row);
    return row;
  }

  async initializeForAgent(input: {
    agentId: string;
    now: Date;
    options?: InitializeAgentTimelineOptions;
  }): Promise<{ durableTimelineHasRows: boolean }> {
    const { agentId, now, options } = input;
    const explicitSeed = buildExplicitTimelineSeed(now, options);
    const durableStore = this.durableStore;
    const shouldSeedFromDurable = !explicitSeed && !this.has(agentId) && durableStore !== undefined;
    const durableSeed = shouldSeedFromDurable
      ? await this.loadCommittedSeed(durableStore, agentId, now)
      : null;
    const durableTimelineHasRows = durableSeed !== null && (durableSeed.nextSeq ?? 1) > 1;
    const timelineSeed = explicitSeed ?? durableSeed;
    if (timelineSeed || !this.has(agentId)) {
      this.memoryStore.initialize(agentId, timelineSeed ?? { timestamp: now.toISOString() });
    }
    if (options?.timelineRows?.length) {
      this.enqueueDurableBulkInsert(agentId, options.timelineRows);
    }
    return { durableTimelineHasRows };
  }

  deleteMemory(agentId: string): void {
    this.memoryStore.delete(agentId);
  }

  resetMemory(agentId: string, timestamp = new Date().toISOString()): void {
    this.memoryStore.delete(agentId);
    this.memoryStore.initialize(agentId, { timestamp });
  }

  async deleteCommitted(agentId: string): Promise<void> {
    await this.durableStore?.deleteAgent(agentId);
  }

  async deleteAll(agentId: string): Promise<void> {
    await this.deleteCommitted(agentId);
    this.deleteMemory(agentId);
  }

  async getLastAssistantMessage(agentId: string): Promise<string | null> {
    const liveSegment = getLastAssistantSegment(this.memoryStore.getRows(agentId));
    if (!this.durableStore) {
      return liveSegment?.text ?? null;
    }
    if (!liveSegment) {
      return await this.durableStore.getLastAssistantMessage(agentId);
    }
    if (!liveSegment.startsAtBeginning) {
      return liveSegment.text;
    }

    const durablePrefix = await this.getDurableAssistantPrefixBefore(
      this.durableStore,
      agentId,
      liveSegment.firstSeq,
    );
    return durablePrefix ? `${durablePrefix}${liveSegment.text}` : liveSegment.text;
  }

  async getLastItem(agentId: string): Promise<AgentTimelineItem | null> {
    const liveItem = this.memoryStore.getLastItem(agentId);
    if (liveItem || !this.durableStore) {
      return liveItem;
    }
    return await this.durableStore.getLastItem(agentId);
  }

  private async loadCommittedSeed(
    durableStore: AgentTimelineStore,
    agentId: string,
    now: Date,
  ): Promise<SeedAgentTimelineOptions> {
    return {
      nextSeq: (await durableStore.getLatestCommittedSeq(agentId)) + 1,
      timestamp: now.toISOString(),
    };
  }

  private async getDurableAssistantPrefixBefore(
    durableStore: AgentTimelineStore,
    agentId: string,
    beforeSeq: number,
  ): Promise<string | null> {
    const tail = await durableStore.fetchCommitted(agentId, { direction: "tail", limit: 1 });
    if (tail.window.maxSeq === 0) {
      return null;
    }

    const chunks: string[] = [];
    let cursor = { epoch: tail.epoch, seq: beforeSeq };
    while (true) {
      const page = await durableStore.fetchCommitted(agentId, {
        direction: "before",
        cursor,
        limit: DURABLE_ASSISTANT_PAGE_SIZE,
      });
      if (page.reset || page.staleCursor || page.gap) {
        return null;
      }

      for (let index = page.rows.length - 1; index >= 0; index -= 1) {
        const item = page.rows[index].item;
        if (item.type !== "assistant_message") {
          return chunks.length > 0 ? chunks.toReversed().join("") : null;
        }
        chunks.push(item.text);
      }

      const firstRow = page.rows[0];
      if (!page.hasOlder || !firstRow) {
        return chunks.length > 0 ? chunks.toReversed().join("") : null;
      }
      cursor = { epoch: page.epoch, seq: firstRow.seq };
    }
  }

  private enqueueDurableAppend(agentId: string, row: AgentTimelineRow): void {
    if (!this.durableStore) {
      return;
    }
    const task = this.durableStore
      .bulkInsert(agentId, [row])
      .then(() => undefined)
      .catch((error) => {
        this.logger.error(
          { err: error, agentId, seq: row.seq, itemType: row.item.type },
          "Failed to append timeline row to durable store",
        );
      });
    this.trackBackgroundTask(task);
  }

  private enqueueDurableBulkInsert(agentId: string, rows: readonly AgentTimelineRow[]): void {
    if (!this.durableStore || rows.length === 0) {
      return;
    }
    const task = this.durableStore.bulkInsert(agentId, rows).catch((error) => {
      this.logger.error(
        { err: error, agentId, rowCount: rows.length },
        "Failed to seed durable timeline store",
      );
    });
    this.trackBackgroundTask(task);
  }
}
