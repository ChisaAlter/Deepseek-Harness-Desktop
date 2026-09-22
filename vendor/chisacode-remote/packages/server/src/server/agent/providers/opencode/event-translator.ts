import type { Event as OpenCodeEvent } from "@opencode-ai/sdk/v2/client";

import type { AgentStreamEvent, AgentTimelineItem } from "../../agent-sdk-types.js";
import { readPositiveFiniteNumber } from "./catalog.js";
import { readNonEmptyString, readOpenCodeRecord } from "./event-values.js";
import {
  appendOpenCodeMessagePartDelta,
  appendOpenCodeMessagePartUpdated,
  appendOpenCodeMessageUpdated,
  type OpenCodeMessageTranslationState,
} from "./message-translator.js";
import {
  appendOpenCodePermissionAsked,
  appendOpenCodeQuestionAsked,
} from "./permission-translator.js";
import { appendOpenCodeSubAgentChildSessionLinked } from "./sub-agent-tracking.js";
import { toDiagnosticErrorMessage } from "../diagnostic-utils.js";

export type OpenCodeEventTranslationState = OpenCodeMessageTranslationState;

export { readNonEmptyString, readOpenCodeRecord } from "./event-values.js";
export {
  hasNormalizedOpenCodeUsage,
  isOpenCodeTodoWriteToolPart,
  mergeOpenCodeStepFinishUsage,
  readOpenCodeTodoItemsFromToolPart,
  resolveOpenCodeModelLookupKeyFromAssistantMessage,
  stringifyStructuredAssistantMessage,
} from "./message-translator.js";
export type {
  OpenCodeMessageRole,
  OpenCodeSubAgentActivityState,
  OpenCodeToolPartEventPart,
} from "./message-translator.js";

export function maxFiniteNumber(left: number | undefined, right: number): number {
  return left === undefined ? right : Math.max(left, right);
}

export function mapOpenCodeTodosToTimelineItems(
  todos: Array<{ content?: string | null; status?: string | null }>,
): Extract<AgentTimelineItem, { type: "todo" }> {
  return {
    type: "todo",
    items: todos.flatMap((todo) => {
      const text = readNonEmptyString(todo.content);
      if (!text) {
        return [];
      }

      return [
        {
          text,
          completed: todo.status === "completed",
        },
      ];
    }),
  };
}

function createCompactionTimelineItem(
  status: Extract<AgentTimelineItem, { type: "compaction" }>["status"],
  trigger?: Extract<AgentTimelineItem, { type: "compaction" }>["trigger"],
): Extract<AgentTimelineItem, { type: "compaction" }> {
  return {
    type: "compaction",
    status,
    ...(trigger ? { trigger } : {}),
  };
}

export function translateOpenCodeEvent(
  event: OpenCodeEvent,
  state: OpenCodeEventTranslationState,
): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = [];

  switch (event.type) {
    case "session.created":
    case "session.updated":
      appendOpenCodeSessionCreatedOrUpdated(event, state, events);
      break;
    case "message.updated":
      appendOpenCodeMessageUpdated(event, state, events);
      break;
    case "message.part.updated":
      appendOpenCodeMessagePartUpdated(event, state, events);
      break;
    case "message.part.delta":
      appendOpenCodeMessagePartDelta(event, state, events);
      break;
    case "permission.asked":
      appendOpenCodePermissionAsked(event, state, events);
      break;
    case "question.asked":
      appendOpenCodeQuestionAsked(event, state, events);
      break;
    case "todo.updated":
      if (event.properties.sessionID === state.sessionId) {
        events.push({
          type: "timeline",
          provider: "opencode",
          item: mapOpenCodeTodosToTimelineItems(event.properties.todos),
        });
      }
      break;
    case "session.compacted":
      if (event.properties.sessionID === state.sessionId) {
        events.push({
          type: "timeline",
          provider: "opencode",
          item: createCompactionTimelineItem("completed"),
        });
      }
      break;
    case "session.idle":
      if (event.properties.sessionID === state.sessionId) {
        resetOpenCodeTurnTrackingState(state);
        events.push({ type: "turn_completed", provider: "opencode", usage: undefined });
      }
      break;
    case "session.error":
      appendOpenCodeSessionError(event, state, events);
      break;
    case "session.status":
      appendOpenCodeSessionStatus(event, state, events);
      break;
  }

  return events;
}

function resetOpenCodeTurnTrackingState(state: OpenCodeEventTranslationState): void {
  state.streamedPartKeys.clear();
  state.partTypes.clear();
}

function appendOpenCodeSessionCreatedOrUpdated(
  event: Extract<OpenCodeEvent, { type: "session.created" | "session.updated" }>,
  state: OpenCodeEventTranslationState,
  events: AgentStreamEvent[],
): void {
  const info = readOpenCodeRecord(event.properties.info);
  if (event.properties.info.id === state.sessionId) {
    const sessionCost = readPositiveFiniteNumber(info?.cost);
    if (sessionCost !== undefined) {
      state.sessionTotalCostUsd = maxFiniteNumber(state.sessionTotalCostUsd, sessionCost);
      state.accumulatedUsage.totalCostUsd = state.sessionTotalCostUsd;
    }
    events.push({
      type: "thread_started",
      sessionId: state.sessionId,
      provider: "opencode",
    });
    return;
  }

  const parentSessionId = readNonEmptyString(info?.parentID) ?? readNonEmptyString(info?.parentId);
  if (parentSessionId === state.sessionId) {
    appendOpenCodeSubAgentChildSessionLinked(event.properties.info.id, state, events);
  }
}

function appendOpenCodeSessionError(
  event: Extract<OpenCodeEvent, { type: "session.error" }>,
  state: OpenCodeEventTranslationState,
  events: AgentStreamEvent[],
): void {
  if (event.properties.sessionID !== state.sessionId) {
    return;
  }
  resetOpenCodeTurnTrackingState(state);
  const error = event.properties.error;
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "MessageAbortedError"
  ) {
    events.push({
      type: "turn_canceled",
      provider: "opencode",
      reason: "interrupted",
    });
  } else {
    events.push({
      type: "turn_failed",
      provider: "opencode",
      error: toDiagnosticErrorMessage(error),
    });
  }
}

function appendOpenCodeSessionStatus(
  event: Extract<OpenCodeEvent, { type: "session.status" }>,
  state: OpenCodeEventTranslationState,
  events: AgentStreamEvent[],
): void {
  if (event.properties.sessionID !== state.sessionId) {
    return;
  }
  const { status } = event.properties;
  if (status.type === "idle") {
    resetOpenCodeTurnTrackingState(state);
    events.push({ type: "turn_completed", provider: "opencode", usage: undefined });
    return;
  }
  if (status.type === "retry") {
    // Mirror what opencode's TUI shows: retry attempts are visible activity, not
    // terminal. opencode itself never gives up — it backs off and tries again
    // forever. If we silently swallow these the user sees a spinner with no
    // explanation. Forwarding as a timeline error item is a no-op for old
    // clients (the schema already supports it).
    const message = typeof status.message === "string" ? status.message.trim() : "";
    const text = message
      ? `Provider retry (attempt ${status.attempt}): ${message}`
      : `Provider retry (attempt ${status.attempt})`;
    events.push({
      type: "timeline",
      provider: "opencode",
      item: { type: "error", message: text },
    });
    return;
  }
  // "busy" is transient — no terminal event, no surfaced activity.
}
