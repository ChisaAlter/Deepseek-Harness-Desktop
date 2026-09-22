import type { Logger } from "pino";

import type { AgentStreamEvent, AgentUsage, ToolCallTimelineItem } from "../../agent-sdk-types.js";
import { CODEX_PROVIDER } from "./client.js";
import { CodexContextCompactionState } from "./context-compaction-state.js";
import type { ParsedCodexNotification } from "./notifications.js";
import { mapCodexPlanToToolCall, planStepsToMarkdown } from "./permissions.js";
import { CodexUserMessageTurnState } from "./user-message-turn-state.js";

const CODEX_TEXTUAL_TOOL_CALL_ERROR =
  "Codex returned a tool call transcript as plain text, so no tool was executed.";

interface CodexTurnNotificationHandlerOptions {
  logger: Logger;
  getAgentId: () => string | undefined;
  getThreadId: () => string | null;
  setThreadId: (threadId: string) => void;
  getTurnId: () => string | null;
  getActiveForegroundTurnId: () => string | null;
  setTurnId: (turnId: string) => void;
  clearActiveForegroundTurn: () => void;
  isPlanModeEnabled: () => boolean;
  requestPlanApproval: (text: string) => void;
  resolveSubAgentCallId: (threadId: string | null) => string | null;
  emitSubAgentActivity: (callId: string, status: ToolCallTimelineItem["status"]) => void;
  resetExternalTurnState: () => void;
  userMessageTurns: CodexUserMessageTurnState;
  compactionState: CodexContextCompactionState;
  emit: (event: AgentStreamEvent) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function firstPositiveFiniteNumber(primary: unknown, secondary: unknown): number | undefined {
  if (typeof primary === "number" && Number.isFinite(primary) && primary > 0) {
    return primary;
  }
  if (typeof secondary === "number" && Number.isFinite(secondary) && secondary > 0) {
    return secondary;
  }
  return undefined;
}

export function toAgentUsage(tokenUsage: unknown): AgentUsage | undefined {
  const usage = isRecord(tokenUsage) ? tokenUsage : undefined;
  if (!usage) return undefined;
  const last = isRecord(usage.last) ? usage.last : undefined;
  const contextWindowMaxTokens = firstPositiveFiniteNumber(
    usage.model_context_window,
    usage.modelContextWindow,
  );
  const contextWindowUsedTokens = firstPositiveFiniteNumber(last?.total_tokens, last?.totalTokens);
  return {
    inputTokens: typeof last?.inputTokens === "number" ? last.inputTokens : undefined,
    cachedInputTokens:
      typeof last?.cachedInputTokens === "number" ? last.cachedInputTokens : undefined,
    outputTokens: typeof last?.outputTokens === "number" ? last.outputTokens : undefined,
    ...(contextWindowMaxTokens !== undefined ? { contextWindowMaxTokens } : {}),
    ...(contextWindowUsedTokens !== undefined ? { contextWindowUsedTokens } : {}),
  };
}

function looksLikeTextualCodexToolCallTranscript(text: string): boolean {
  if (!text.includes("<tool_call>") || !text.includes("</tool_call>")) {
    return false;
  }
  if (!text.includes("<tool_result>") && !text.includes("</tool_result>")) {
    return false;
  }
  return /"name"\s*:\s*"(?:apply_patch|apply_diff|write_file|create_file|shell|exec|command|bash|Bash)"/.test(
    text,
  );
}

export class CodexTurnNotificationHandler {
  private latestUsage: AgentUsage | undefined;
  private latestPlanResult: { callId: string; text: string; turnId: string | null } | null = null;
  private textualToolCallError: string | null = null;

  constructor(private readonly options: CodexTurnNotificationHandlerOptions) {}

  handleThreadStarted(parsed: Extract<ParsedCodexNotification, { kind: "thread_started" }>): void {
    this.options.setThreadId(parsed.threadId);
    this.options.emit({
      type: "thread_started",
      provider: CODEX_PROVIDER,
      sessionId: parsed.threadId,
    });
  }

  handleTurnStarted(parsed: Extract<ParsedCodexNotification, { kind: "turn_started" }>): void {
    const subAgentCallId = this.options.resolveSubAgentCallId(parsed.threadId);
    if (subAgentCallId) {
      this.options.emitSubAgentActivity(subAgentCallId, "running");
      return;
    }
    this.options.setTurnId(parsed.turnId);
    this.resetTurnTrackingState();
    this.options.emit({ type: "turn_started", provider: CODEX_PROVIDER });
  }

  handleTurnCompleted(parsed: Extract<ParsedCodexNotification, { kind: "turn_completed" }>): void {
    const subAgentCallId = this.options.resolveSubAgentCallId(parsed.threadId);
    if (subAgentCallId) {
      let status: ToolCallTimelineItem["status"] = "completed";
      if (parsed.status === "failed") {
        status = "failed";
      } else if (parsed.status === "interrupted") {
        status = "canceled";
      }
      this.options.emitSubAgentActivity(subAgentCallId, status);
      return;
    }
    if (this.textualToolCallError) {
      this.options.emit({
        type: "turn_failed",
        provider: CODEX_PROVIDER,
        error: this.textualToolCallError,
      });
    } else if (parsed.status === "failed") {
      this.options.emit({
        type: "turn_failed",
        provider: CODEX_PROVIDER,
        error: parsed.errorMessage ?? "Codex turn failed",
      });
    } else if (parsed.status === "interrupted") {
      this.options.emit({
        type: "turn_canceled",
        provider: CODEX_PROVIDER,
        reason: "interrupted",
      });
    } else {
      if (this.options.isPlanModeEnabled() && this.latestPlanResult?.text) {
        this.options.requestPlanApproval(this.latestPlanResult.text);
      }
      this.options.emit({
        type: "turn_completed",
        provider: CODEX_PROVIDER,
        usage: this.latestUsage,
      });
    }
    this.options.clearActiveForegroundTurn();
    this.resetTurnTrackingState();
  }

  handlePlanUpdated(parsed: Extract<ParsedCodexNotification, { kind: "plan_updated" }>): void {
    const timelineItem = mapCodexPlanToToolCall({
      callId: "plan:" + (this.options.getTurnId() ?? this.options.getThreadId() ?? "current"),
      text: planStepsToMarkdown(
        parsed.plan.map((entry) => ({
          step: entry.step ?? "",
          status: entry.status ?? "pending",
        })),
      ),
    });
    if (!timelineItem) {
      return;
    }
    this.rememberPlanResult(timelineItem);
    if (!this.options.isPlanModeEnabled()) {
      this.options.emit({ type: "timeline", provider: CODEX_PROVIDER, item: timelineItem });
    }
  }

  handleTokenUsageUpdated(
    parsed: Extract<ParsedCodexNotification, { kind: "token_usage_updated" }>,
  ): void {
    this.latestUsage = toAgentUsage(parsed.tokenUsage);
    if (this.latestUsage) {
      this.options.emit({
        type: "usage_updated",
        provider: CODEX_PROVIDER,
        usage: this.latestUsage,
      });
    }
  }

  handleThreadRolledBack(
    parsed: Extract<ParsedCodexNotification, { kind: "thread_rolled_back" }>,
  ): void {
    this.options.userMessageTurns.truncate(parsed.numTurns);
  }

  handleContextCompacted(
    parsed: Extract<ParsedCodexNotification, { kind: "context_compacted" }>,
  ): void {
    if (parsed.threadId !== this.options.getThreadId()) {
      return;
    }
    if (!this.options.compactionState.shouldEmitNotificationCompletion()) {
      return;
    }
    this.options.emit({
      type: "timeline",
      provider: CODEX_PROVIDER,
      item: this.options.compactionState.createTimelineItem("completed"),
      ...(parsed.turnId ? { turnId: parsed.turnId } : {}),
    });
  }

  rememberPlanResult(item: ToolCallTimelineItem): void {
    if (item.detail.type !== "plan") {
      return;
    }
    this.latestPlanResult = {
      callId: item.callId,
      text: item.detail.text,
      turnId: this.options.getTurnId(),
    };
  }

  rememberTextualToolCallFailure(text: string): void {
    if (this.textualToolCallError || !looksLikeTextualCodexToolCallTranscript(text)) {
      return;
    }
    this.textualToolCallError = CODEX_TEXTUAL_TOOL_CALL_ERROR;
    this.options.logger.warn(
      {
        agentId: this.options.getAgentId(),
        provider: CODEX_PROVIDER,
        sessionId: this.options.getThreadId(),
        turnId: this.options.getActiveForegroundTurnId() ?? undefined,
      },
      "provider.codex.textual_tool_call_detected",
    );
  }

  private resetTurnTrackingState(): void {
    this.latestPlanResult = null;
    this.textualToolCallError = null;
    this.options.resetExternalTurnState();
  }
}
