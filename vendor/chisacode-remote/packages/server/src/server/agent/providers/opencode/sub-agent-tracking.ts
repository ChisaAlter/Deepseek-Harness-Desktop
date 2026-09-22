import type { Event as OpenCodeEvent } from "@opencode-ai/sdk/v2/client";
import { buildToolCallDisplayModel } from "@chisacode/protocol/tool-call-display";

import type {
  AgentStreamEvent,
  ToolCallDetail,
  ToolCallTimelineItem,
} from "../../agent-sdk-types.js";
import { OpencodeToolPartToTimelineItemSchema } from "./helpers.js";

export type OpenCodeToolPartEventPart = Extract<
  Extract<OpenCodeEvent, { type: "message.part.updated" }>["properties"]["part"],
  { type: "tool" }
>;

interface OpenCodeSubAgentActionEntry {
  index: number;
  key: string;
  toolName: string;
  summary?: string;
}

export interface OpenCodeSubAgentActivityState {
  toolCall: ToolCallTimelineItem;
  actions: OpenCodeSubAgentActionEntry[];
  actionIndexByKey: Map<string, number>;
  nextActionIndex: number;
  childSessionId?: string;
}

export interface OpenCodeSubAgentTrackingState {
  sessionId: string;
  cwd?: string;
  subAgentsByCallId?: Map<string, OpenCodeSubAgentActivityState>;
  subAgentCallIdByChildSessionId?: Map<string, string>;
  pendingChildToolPartsBySessionId?: Map<string, OpenCodeToolPartEventPart[]>;
}

const MAX_OPENCODE_SUB_AGENT_ACTIONS = 200;
const MAX_OPENCODE_PENDING_CHILD_TOOL_PARTS = 200;

function getOpenCodeSubAgentMaps(state: OpenCodeSubAgentTrackingState): {
  byCallId: Map<string, OpenCodeSubAgentActivityState>;
  callIdByChildSessionId: Map<string, string>;
  pendingChildToolPartsBySessionId: Map<string, OpenCodeToolPartEventPart[]>;
} {
  state.subAgentsByCallId ??= new Map();
  state.subAgentCallIdByChildSessionId ??= new Map();
  state.pendingChildToolPartsBySessionId ??= new Map();
  return {
    byCallId: state.subAgentsByCallId,
    callIdByChildSessionId: state.subAgentCallIdByChildSessionId,
    pendingChildToolPartsBySessionId: state.pendingChildToolPartsBySessionId,
  };
}

export function isOpenCodeSessionTrackedByParent(
  sessionId: string,
  state: OpenCodeSubAgentTrackingState,
): boolean {
  return (
    sessionId === state.sessionId || state.subAgentCallIdByChildSessionId?.has(sessionId) === true
  );
}

function getOpenCodeSubAgentState(
  callId: string,
  state: OpenCodeSubAgentTrackingState,
  toolCall: ToolCallTimelineItem,
): OpenCodeSubAgentActivityState {
  const maps = getOpenCodeSubAgentMaps(state);
  const existing = maps.byCallId.get(callId);
  if (existing) {
    existing.toolCall = toolCall;
    return existing;
  }

  const created: OpenCodeSubAgentActivityState = {
    toolCall,
    actions: [],
    actionIndexByKey: new Map(),
    nextActionIndex: 1,
  };
  maps.byCallId.set(callId, created);
  return created;
}

function linkOpenCodeSubAgentChildSession(
  activity: OpenCodeSubAgentActivityState,
  childSessionId: string,
  state: OpenCodeSubAgentTrackingState,
): void {
  activity.childSessionId = childSessionId;
  const maps = getOpenCodeSubAgentMaps(state);
  maps.callIdByChildSessionId.set(childSessionId, activity.toolCall.callId);
}

function buildOpenCodeSubAgentLog(
  detail: Extract<ToolCallDetail, { type: "sub_agent" }>,
  activity: OpenCodeSubAgentActivityState,
): string {
  const actionLog = activity.actions
    .map((action) =>
      action.summary ? `[${action.toolName}] ${action.summary}` : `[${action.toolName}]`,
    )
    .join("\n");
  const parts = [actionLog, detail.log].filter((part) => part.trim().length > 0);
  return parts.join("\n\n");
}

function buildOpenCodeSubAgentTimelineItem(
  activity: OpenCodeSubAgentActivityState,
): ToolCallTimelineItem {
  const toolCall = activity.toolCall;
  if (toolCall.detail.type !== "sub_agent") {
    return toolCall;
  }
  const childSessionId = activity.childSessionId ?? toolCall.detail.childSessionId;
  return {
    ...toolCall,
    detail: {
      ...toolCall.detail,
      ...(childSessionId ? { childSessionId } : {}),
      log: buildOpenCodeSubAgentLog(toolCall.detail, activity),
    },
  };
}

function registerOpenCodeSubAgentToolCall(
  item: ToolCallTimelineItem,
  state: OpenCodeSubAgentTrackingState,
): ToolCallTimelineItem {
  if (item.detail.type !== "sub_agent") {
    return item;
  }
  const activity = getOpenCodeSubAgentState(item.callId, state, item);
  if (item.detail.childSessionId) {
    linkOpenCodeSubAgentChildSession(activity, item.detail.childSessionId, state);
  }
  return buildOpenCodeSubAgentTimelineItem(activity);
}

function bufferOpenCodeSubAgentChildToolPart(
  part: OpenCodeToolPartEventPart,
  state: OpenCodeSubAgentTrackingState,
): void {
  const maps = getOpenCodeSubAgentMaps(state);
  if (maps.byCallId.size === 0) {
    return;
  }
  const totalPending = [...maps.pendingChildToolPartsBySessionId.values()].reduce(
    (total, parts) => total + parts.length,
    0,
  );
  if (totalPending >= MAX_OPENCODE_PENDING_CHILD_TOOL_PARTS) {
    return;
  }
  const pending = maps.pendingChildToolPartsBySessionId.get(part.sessionID) ?? [];
  pending.push(part);
  maps.pendingChildToolPartsBySessionId.set(part.sessionID, pending);
}

function flushOpenCodeSubAgentChildToolParts(
  childSessionId: string,
  state: OpenCodeSubAgentTrackingState,
  events: AgentStreamEvent[],
): void {
  const maps = getOpenCodeSubAgentMaps(state);
  const pending = maps.pendingChildToolPartsBySessionId.get(childSessionId);
  if (!pending || pending.length === 0) {
    return;
  }
  maps.pendingChildToolPartsBySessionId.delete(childSessionId);
  for (const part of pending) {
    appendOpenCodeSubAgentChildToolPart(part, state, events);
  }
}

function findOnlyOpenCodeSubAgentWaitingForChild(
  state: OpenCodeSubAgentTrackingState,
): OpenCodeSubAgentActivityState | null {
  const maps = getOpenCodeSubAgentMaps(state);
  const candidates = [...maps.byCallId.values()].filter(
    (activity) =>
      activity.toolCall.status === "running" &&
      activity.toolCall.detail.type === "sub_agent" &&
      !activity.childSessionId,
  );
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

function summarizeOpenCodeSubAgentAction(
  item: ToolCallTimelineItem,
  cwd: string | undefined,
): string | undefined {
  const display = buildToolCallDisplayModel({
    name: item.name,
    status: item.status,
    error: item.error,
    metadata: item.metadata,
    detail: item.detail,
    cwd,
  });
  return display.summary ?? display.errorText;
}

function appendOpenCodeSubAgentAction(
  activity: OpenCodeSubAgentActivityState,
  item: ToolCallTimelineItem,
  cwd: string | undefined,
): boolean {
  const key = item.callId || `${item.name}:${activity.actions.length}`;
  const existingIndex = activity.actionIndexByKey.get(key);
  const summary = summarizeOpenCodeSubAgentAction(item, cwd);

  if (existingIndex !== undefined) {
    const action = activity.actions[existingIndex];
    if (!action) {
      return false;
    }
    const changed = action.toolName !== item.name || action.summary !== summary;
    action.toolName = item.name;
    if (summary) {
      action.summary = summary;
    } else {
      delete action.summary;
    }
    return changed;
  }

  if (activity.actions.length >= MAX_OPENCODE_SUB_AGENT_ACTIONS) {
    return false;
  }

  activity.actionIndexByKey.set(key, activity.actions.length);
  activity.actions.push({
    index: activity.nextActionIndex,
    key,
    toolName: item.name,
    ...(summary ? { summary } : {}),
  });
  activity.nextActionIndex += 1;
  return true;
}

export function appendOpenCodeToolCallTimelineItem(
  item: ToolCallTimelineItem,
  state: OpenCodeSubAgentTrackingState,
  events: AgentStreamEvent[],
): void {
  const timelineItem = registerOpenCodeSubAgentToolCall(item, state);
  events.push({
    type: "timeline",
    provider: "opencode",
    item: timelineItem,
  });
  if (timelineItem.detail.type === "sub_agent" && timelineItem.detail.childSessionId) {
    flushOpenCodeSubAgentChildToolParts(timelineItem.detail.childSessionId, state, events);
  }
}

export function appendOpenCodeSubAgentChildSessionLinked(
  childSessionId: string,
  state: OpenCodeSubAgentTrackingState,
  events: AgentStreamEvent[],
): void {
  const activity = findOnlyOpenCodeSubAgentWaitingForChild(state);
  if (!activity) {
    return;
  }
  linkOpenCodeSubAgentChildSession(activity, childSessionId, state);
  events.push({
    type: "timeline",
    provider: "opencode",
    item: buildOpenCodeSubAgentTimelineItem(activity),
  });
  flushOpenCodeSubAgentChildToolParts(childSessionId, state, events);
}

export function appendOpenCodeSubAgentChildToolPart(
  part: OpenCodeToolPartEventPart,
  state: OpenCodeSubAgentTrackingState,
  events: AgentStreamEvent[],
): void {
  const maps = getOpenCodeSubAgentMaps(state);
  const parentCallId = maps.callIdByChildSessionId.get(part.sessionID);
  if (!parentCallId) {
    bufferOpenCodeSubAgentChildToolPart(part, state);
    return;
  }
  const activity = maps.byCallId.get(parentCallId);
  if (!activity) {
    return;
  }
  const parsedToolPart = OpencodeToolPartToTimelineItemSchema.safeParse(part);
  if (!parsedToolPart.success || !parsedToolPart.data) {
    return;
  }
  if (!appendOpenCodeSubAgentAction(activity, parsedToolPart.data, state.cwd)) {
    return;
  }
  events.push({
    type: "timeline",
    provider: "opencode",
    item: buildOpenCodeSubAgentTimelineItem(activity),
  });
}
