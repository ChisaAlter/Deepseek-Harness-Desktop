import fs from "node:fs";
import path from "node:path";
import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";

import type { AgentStreamEvent, AgentTimelineItem } from "../../agent-sdk-types.js";
import { normalizeProviderReplayTimestamp } from "../../provider-history-timestamps.js";
import { resolveClaudeConfigDir } from "./client.js";
import {
  convertClaudeHistoryEntry,
  isClaudeTranscriptNoiseText,
  isSyntheticHistoryUserEntry,
  isToolResultUserEntry,
  type ClaudeHistoryEntry,
} from "./history-converter.js";
import { isClaudeContentChunk, type ClaudeContentChunk } from "./sdk-types-mapping.js";
import { formatClaudeUserFacingErrorText } from "./user-facing-error-text.js";

export const CLAUDE_INTERRUPT_TOOL_USE_PLACEHOLDER = "[Request interrupted by user for tool use]";

interface PersistedTimelineEntry {
  item: AgentTimelineItem;
  timestamp?: string;
}

interface ClaudeSessionHistoryOptions {
  getCwd: () => string | undefined;
  getSdkEnv: () => NodeJS.ProcessEnv;
  rememberUserMessageId: (messageId: string) => void;
  rememberRewindUserAnchor: (messageId: string) => void;
  rememberRewindAssistantAnchor: (messageId: string) => void;
  handleToolUseStart: (block: ClaudeContentChunk, target: AgentTimelineItem[]) => void;
  handleToolResult: (block: ClaudeContentChunk, target: AgentTimelineItem[]) => void;
  updatePartialEventState: (event: SDKPartialAssistantMessage["event"]) => boolean;
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function sanitizeClaudeProjectPath(cwd: string): string {
  return cwd.replace(/[\\/._:]/g, "-");
}

/** Owns Claude transcript loading, replay state, and history block mapping. */
export class ClaudeSessionHistory {
  private persistedHistory: PersistedTimelineEntry[] = [];
  private historyPending = false;

  constructor(private readonly options: ClaudeSessionHistoryOptions) {}

  async *stream(): AsyncGenerator<AgentStreamEvent> {
    if (!this.historyPending || this.persistedHistory.length === 0) {
      return;
    }
    const history = this.persistedHistory;
    this.persistedHistory = [];
    this.historyPending = false;
    for (const entry of history) {
      yield {
        type: "timeline",
        item: entry.item,
        provider: "claude",
        timestamp: entry.timestamp,
      };
    }
  }

  load(sessionId: string): void {
    try {
      const historyPath = this.resolvePath(sessionId);
      if (!historyPath || !fs.existsSync(historyPath)) {
        return;
      }
      this.ingest(fs.readFileSync(historyPath, "utf8"));
    } catch {
      // Ignore history load failures.
    }
  }

  clear(): void {
    this.persistedHistory = [];
    this.historyPending = false;
  }

  getRewindCandidateUserMessageIds(): string[] {
    const candidates: string[] = [];
    for (let index = this.persistedHistory.length - 1; index >= 0; index -= 1) {
      const entry = this.persistedHistory[index];
      if (entry?.item.type === "user_message" && entry.item.messageId) {
        if (!candidates.includes(entry.item.messageId)) {
          candidates.push(entry.item.messageId);
        }
      }
    }
    return candidates;
  }

  resolvePath(sessionId: string): string | null {
    const cwd = this.options.getCwd();
    if (!cwd) return null;
    const configDir = resolveClaudeConfigDir(this.options.getSdkEnv());
    const candidates = [cwd];
    try {
      const realCwd = fs.realpathSync(cwd);
      if (realCwd !== cwd) {
        candidates.push(realCwd);
      }
    } catch {
      // Fall back to the configured cwd when the path has already disappeared.
    }
    for (const candidate of candidates) {
      const sanitized = sanitizeClaudeProjectPath(candidate);
      const historyPath = path.join(configDir, "projects", sanitized, `${sessionId}.jsonl`);
      if (fs.existsSync(historyPath)) {
        return historyPath;
      }
    }
    const sanitized = sanitizeClaudeProjectPath(cwd);
    return path.join(configDir, "projects", sanitized, `${sessionId}.jsonl`);
  }

  mapBlocksToTimeline(
    content: string | ReadonlyArray<unknown>,
    options?: {
      textMessageType?: "assistant_message" | "user_message";
      suppressAssistantText?: boolean;
      suppressReasoning?: boolean;
    },
  ): AgentTimelineItem[] {
    const textMessageType = options?.textMessageType ?? "assistant_message";
    const suppressText =
      textMessageType === "assistant_message" && (options?.suppressAssistantText ?? false);
    const suppressReasoning = options?.suppressReasoning ?? false;

    if (typeof content === "string") {
      if (
        !content ||
        content === CLAUDE_INTERRUPT_TOOL_USE_PLACEHOLDER ||
        isClaudeTranscriptNoiseText(content)
      ) {
        return [];
      }
      if (suppressText) {
        return [];
      }
      const text =
        textMessageType === "assistant_message"
          ? formatClaudeUserFacingErrorText(content)
          : content;
      return [{ type: textMessageType, text }];
    }

    const items: AgentTimelineItem[] = [];
    const userTextParts: string[] = [];
    for (const block of content) {
      if (!isClaudeContentChunk(block)) {
        continue;
      }
      this.mapBlockToTimeline(block, {
        items,
        userTextParts,
        textMessageType,
        suppressText,
        suppressReasoning,
      });
    }

    if (textMessageType === "user_message" && userTextParts.length > 0) {
      items.unshift({
        type: "user_message",
        text: userTextParts.join("\n\n"),
      });
    }
    return items;
  }

  mapPartialEvent(
    event: SDKPartialAssistantMessage["event"],
    options?: {
      suppressAssistantText?: boolean;
      suppressReasoning?: boolean;
    },
  ): AgentTimelineItem[] {
    if (this.options.updatePartialEventState(event)) {
      return [];
    }
    switch (event.type) {
      case "content_block_start":
        return isClaudeContentChunk(event.content_block)
          ? this.mapBlocksToTimeline([event.content_block], options)
          : [];
      case "content_block_delta":
        return isClaudeContentChunk(event.delta)
          ? this.mapBlocksToTimeline([event.delta], options)
          : [];
      default:
        return [];
    }
  }

  private ingest(content: string): void {
    if (!content) {
      return;
    }
    const timeline: PersistedTimelineEntry[] = [];
    for (const line of content.split(/\r?\n/)) {
      this.ingestLine(line, timeline);
    }
    if (timeline.length > 0) {
      this.persistedHistory = [...this.persistedHistory, ...timeline];
      this.historyPending = true;
    }
  }

  private ingestLine(line: string, timeline: PersistedTimelineEntry[]): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let entry: Record<string, unknown>;
    try {
      const record = toObjectRecord(JSON.parse(trimmed));
      if (!record) {
        return;
      }
      entry = record;
    } catch {
      return;
    }
    if (entry.isSidechain) {
      return;
    }

    const historyTimestamp = normalizeProviderReplayTimestamp(entry.timestamp);
    const items = this.convertHistoryEntry(entry);
    const isVisibleUserEntry =
      entry.type === "user" &&
      typeof entry.uuid === "string" &&
      !isSyntheticHistoryUserEntry(entry) &&
      !isToolResultUserEntry(entry);
    if (isVisibleUserEntry && typeof entry.uuid === "string") {
      this.options.rememberUserMessageId(entry.uuid);
      this.options.rememberRewindUserAnchor(entry.uuid);
    }
    if (entry.type === "assistant" && typeof entry.uuid === "string") {
      this.options.rememberRewindAssistantAnchor(entry.uuid);
    }
    if (items.length > 0) {
      timeline.push(
        ...items.map((item) => ({
          item,
          timestamp: historyTimestamp ?? undefined,
        })),
      );
    }
  }

  private convertHistoryEntry(entry: ClaudeHistoryEntry): AgentTimelineItem[] {
    return convertClaudeHistoryEntry(entry, (content) => this.mapBlocksToTimeline(content));
  }

  private appendTextBlockToTimeline(
    block: ClaudeContentChunk,
    context: {
      items: AgentTimelineItem[];
      userTextParts: string[];
      textMessageType: "assistant_message" | "user_message";
      suppressText: boolean;
    },
  ): void {
    const { items, userTextParts, textMessageType, suppressText } = context;
    const text = typeof block.text === "string" ? block.text : "";
    if (
      !text ||
      text === CLAUDE_INTERRUPT_TOOL_USE_PLACEHOLDER ||
      isClaudeTranscriptNoiseText(text)
    ) {
      return;
    }
    if (textMessageType === "user_message") {
      const trimmed = text.trim();
      if (trimmed) {
        userTextParts.push(trimmed);
      }
      return;
    }
    if (!suppressText) {
      items.push({
        type: "assistant_message",
        text: formatClaudeUserFacingErrorText(text),
      });
    }
  }

  private mapBlockToTimeline(
    block: ClaudeContentChunk,
    context: {
      items: AgentTimelineItem[];
      userTextParts: string[];
      textMessageType: "assistant_message" | "user_message";
      suppressText: boolean;
      suppressReasoning: boolean;
    },
  ): void {
    switch (block.type) {
      case "text":
      case "text_delta":
        this.appendTextBlockToTimeline(block, context);
        break;
      case "thinking":
      case "thinking_delta":
        if (typeof block.thinking === "string" && block.thinking && !context.suppressReasoning) {
          context.items.push({ type: "reasoning", text: block.thinking });
        }
        break;
      case "tool_use":
      case "server_tool_use":
      case "mcp_tool_use":
        this.options.handleToolUseStart(block, context.items);
        break;
      case "tool_result":
      case "mcp_tool_result":
      case "web_fetch_tool_result":
      case "web_search_tool_result":
      case "code_execution_tool_result":
      case "bash_code_execution_tool_result":
      case "text_editor_code_execution_tool_result":
        this.options.handleToolResult(block, context.items);
        break;
      default:
        break;
    }
  }
}
