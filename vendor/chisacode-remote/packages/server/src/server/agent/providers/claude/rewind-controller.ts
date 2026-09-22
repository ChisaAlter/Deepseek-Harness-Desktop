import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import type { AgentPromptInput, AgentSlashCommand } from "../../agent-sdk-types.js";
import { isSyntheticUserEntry, isToolResultUserEntry } from "./history-converter.js";

interface ClaudeRewindTurnAnchor {
  userMessageId: string;
  assistantMessageId: string | null;
}

interface ClaudeRewindFilesResult {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}

interface ClaudeRewindControllerOptions {
  getHistoryCandidateUserMessageIds: () => string[];
  rewindFiles: (messageId: string) => Promise<ClaudeRewindFilesResult>;
}

/** Parsed invocation for the built-in Claude rewind command. */
export interface ClaudeRewindInvocation {
  commandName: "rewind";
  args?: string;
  rawInput: string;
}

/** Conversation action required to restore the state before a user message. */
export type ClaudeConversationRewindTarget =
  | { kind: "fresh-session" }
  | { kind: "fork"; messageId: string };

const REWIND_COMMAND: AgentSlashCommand = {
  name: "rewind",
  description: "Rewind tracked files to a previous user message",
  argumentHint: "[user_message_uuid]",
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Owns Claude rewind command parsing, message anchors, and checkpoint selection. */
export class ClaudeRewindController {
  private userMessageIds: string[] = [];
  private readonly turnAnchors: ClaudeRewindTurnAnchor[] = [];

  constructor(private readonly options: ClaudeRewindControllerOptions) {}

  getCommand(): AgentSlashCommand {
    return REWIND_COMMAND;
  }

  resolveSlashCommandInvocation(prompt: AgentPromptInput): ClaudeRewindInvocation | null {
    if (typeof prompt !== "string") {
      return null;
    }
    const parsed = this.parseSlashCommandInput(prompt);
    return parsed?.commandName === "rewind" ? { ...parsed, commandName: "rewind" } : null;
  }

  async attempt(args: string | undefined): Promise<{
    messageId: string | null;
    result?: ClaudeRewindFilesResult;
    error?: string;
  }> {
    if (typeof args === "string" && args.trim().length > 0) {
      const candidate = args.trim().split(/\s+/)[0] ?? "";
      if (!UUID_PATTERN.test(candidate)) {
        return {
          messageId: null,
          error: "Invalid message UUID. Usage: /rewind <user_message_uuid> or /rewind",
        };
      }
      const rewindResult = await this.options.rewindFiles(candidate);
      if (rewindResult.canRewind) {
        return { messageId: candidate, result: rewindResult };
      }
      return {
        messageId: null,
        error: rewindResult.error ?? `No file checkpoint found for message ${candidate}.`,
      };
    }

    const candidates = this.getCandidateUserMessageIds();
    if (candidates.length === 0) {
      return {
        messageId: null,
        error: "No prior user message available to rewind. Use /rewind <user_message_uuid>.",
      };
    }

    let lastError: string | undefined;
    for (const candidate of candidates) {
      try {
        const rewindResult = await this.options.rewindFiles(candidate);
        if (rewindResult.canRewind) {
          return { messageId: candidate, result: rewindResult };
        }
        if (rewindResult.error) {
          lastError = rewindResult.error;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Failed to rewind tracked files.";
      }
    }

    return {
      messageId: null,
      error: lastError ?? "No rewind checkpoints are currently available for this session.",
    };
  }

  buildSuccessMessage(targetUserMessageId: string, result: ClaudeRewindFilesResult): string {
    const fileCount = Array.isArray(result.filesChanged) ? result.filesChanged.length : undefined;
    const stats: string[] = [];
    if (typeof fileCount === "number") {
      stats.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
    }
    if (typeof result.insertions === "number") {
      stats.push(`${result.insertions} insertions`);
    }
    if (typeof result.deletions === "number") {
      stats.push(`${result.deletions} deletions`);
    }
    if (stats.length > 0) {
      return `Rewound tracked files to message ${targetUserMessageId} (${stats.join(", ")}).`;
    }
    return `Rewound tracked files to message ${targetUserMessageId}.`;
  }

  rememberUserMessageId(messageId: string | null | undefined): void {
    if (typeof messageId !== "string" || messageId.length === 0) {
      return;
    }
    const last = this.userMessageIds[this.userMessageIds.length - 1];
    if (last !== messageId) {
      this.userMessageIds.push(messageId);
    }
  }

  rememberUserAnchor(userMessageId: string | null | undefined): void {
    if (typeof userMessageId !== "string" || userMessageId.length === 0) {
      return;
    }
    if (this.turnAnchors.some((anchor) => anchor.userMessageId === userMessageId)) {
      return;
    }
    this.turnAnchors.push({ userMessageId, assistantMessageId: null });
  }

  rememberAssistantAnchor(assistantMessageId: string | null | undefined): void {
    if (typeof assistantMessageId !== "string" || assistantMessageId.length === 0) {
      return;
    }
    for (let index = this.turnAnchors.length - 1; index >= 0; index -= 1) {
      const anchor = this.turnAnchors[index];
      if (anchor) {
        anchor.assistantMessageId = assistantMessageId;
        return;
      }
    }
  }

  rememberTranscriptProgress(message: SDKMessage, messageId: string | null): void {
    if (!messageId) {
      return;
    }
    if (
      message.type === "user" &&
      !isSyntheticUserEntry(message) &&
      !isToolResultUserEntry(message)
    ) {
      this.rememberUserAnchor(messageId);
      return;
    }
    if (message.type === "assistant") {
      this.rememberAssistantAnchor(messageId);
      return;
    }
    if (message.type === "stream_event") {
      const eventType = readTrimmedString(toObjectRecord(message.event)?.type);
      if (eventType === "message_start") {
        this.rememberAssistantAnchor(messageId);
      }
    }
  }

  resolveConversationTarget(messageId: string): ClaudeConversationRewindTarget {
    const index = this.turnAnchors.findIndex((anchor) => anchor.userMessageId === messageId);
    if (index < 0) {
      throw new Error(`Claude rewind target ${messageId} is not in the tracked conversation`);
    }
    if (index === 0) {
      return { kind: "fresh-session" };
    }
    const previousTurn = this.turnAnchors[index - 1];
    if (!previousTurn?.assistantMessageId) {
      throw new Error(
        `Claude rewind cannot preserve turn ${index} because its assistant response id was not observed`,
      );
    }
    return { kind: "fork", messageId: previousTurn.assistantMessageId };
  }

  reset(): void {
    this.userMessageIds = [];
    this.turnAnchors.length = 0;
  }

  private parseSlashCommandInput(text: string): {
    commandName: string;
    args?: string;
    rawInput: string;
  } | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/") || trimmed.length <= 1) {
      return null;
    }
    const withoutPrefix = trimmed.slice(1);
    const firstWhitespaceIdx = withoutPrefix.search(/\s/);
    const commandName =
      firstWhitespaceIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, firstWhitespaceIdx);
    if (!commandName || commandName.includes("/")) {
      return null;
    }
    const rawArgs =
      firstWhitespaceIdx === -1 ? "" : withoutPrefix.slice(firstWhitespaceIdx + 1).trim();
    return rawArgs.length > 0
      ? { commandName, args: rawArgs, rawInput: trimmed }
      : { commandName, rawInput: trimmed };
  }

  private getCandidateUserMessageIds(): string[] {
    const candidates: string[] = [];
    const pushUnique = (value: string | null | undefined) => {
      if (typeof value === "string" && value.length > 0 && !candidates.includes(value)) {
        candidates.push(value);
      }
    };
    for (const messageId of this.options.getHistoryCandidateUserMessageIds()) {
      pushUnique(messageId);
    }
    for (let index = this.userMessageIds.length - 1; index >= 0; index -= 1) {
      pushUnique(this.userMessageIds[index]);
    }
    return candidates;
  }
}
