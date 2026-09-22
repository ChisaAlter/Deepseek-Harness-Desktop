import type { SessionUpdate, ToolCall, ToolCallUpdate } from "@agentclientprotocol/sdk";

import type { AgentStreamEvent, AgentTimelineItem } from "../../agent-sdk-types.js";
import {
  contentBlockToText,
  mapACPPlanToTimeline,
  mapACPToolSnapshotToTimeline,
  mergeACPToolSnapshot,
  type ACPToolSnapshot,
  type ACPToolTerminalState,
} from "./tool-call-mapper.js";

interface MessageAssemblyState {
  text: string;
}

interface SuppressedUserEcho {
  messageId: string | null;
  text: string | null;
}

type CurrentModeUpdate = Extract<SessionUpdate, { sessionUpdate: "current_mode_update" }>;
type ConfigOptionUpdate = Extract<SessionUpdate, { sessionUpdate: "config_option_update" }>;
type SessionInfoUpdate = Extract<SessionUpdate, { sessionUpdate: "session_info_update" }>;
type AvailableCommandsUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "available_commands_update" }
>;

/** Dependencies used by the ACP session update controller. */
export interface ACPSessionUpdateControllerOptions {
  provider: string;
  getTurnId: () => string | null;
  getSuppressedUserEcho: () => SuppressedUserEcho;
  getTerminalStates: () => ReadonlyMap<string, ACPToolTerminalState>;
  transformToolSnapshot?: (snapshot: ACPToolSnapshot) => ACPToolSnapshot;
  onCurrentModeUpdate: (update: CurrentModeUpdate) => AgentStreamEvent[];
  onConfigOptionUpdate: (update: ConfigOptionUpdate) => AgentStreamEvent[];
  onSessionInfoUpdate: (update: SessionInfoUpdate) => void;
  onAvailableCommandsUpdate: (update: AvailableCommandsUpdate) => void;
}

/** Owns ACP message assembly, tool snapshots, and session update routing. */
export class ACPSessionUpdateController {
  private readonly messageAssemblies = new Map<string, MessageAssemblyState>();
  private readonly toolCalls = new Map<string, ACPToolSnapshot>();
  private readonly provider: string;
  private readonly getTurnId: () => string | null;
  private readonly getSuppressedUserEcho: () => SuppressedUserEcho;
  private readonly getTerminalStates: () => ReadonlyMap<string, ACPToolTerminalState>;
  private readonly transformToolSnapshot?: (snapshot: ACPToolSnapshot) => ACPToolSnapshot;
  private readonly onCurrentModeUpdate: (update: CurrentModeUpdate) => AgentStreamEvent[];
  private readonly onConfigOptionUpdate: (update: ConfigOptionUpdate) => AgentStreamEvent[];
  private readonly onSessionInfoUpdate: (update: SessionInfoUpdate) => void;
  private readonly onAvailableCommandsUpdate: (update: AvailableCommandsUpdate) => void;

  constructor(options: ACPSessionUpdateControllerOptions) {
    this.provider = options.provider;
    this.getTurnId = options.getTurnId;
    this.getSuppressedUserEcho = options.getSuppressedUserEcho;
    this.getTerminalStates = options.getTerminalStates;
    this.transformToolSnapshot = options.transformToolSnapshot;
    this.onCurrentModeUpdate = options.onCurrentModeUpdate;
    this.onConfigOptionUpdate = options.onConfigOptionUpdate;
    this.onSessionInfoUpdate = options.onSessionInfoUpdate;
    this.onAvailableCommandsUpdate = options.onAvailableCommandsUpdate;
  }

  translate(update: SessionUpdate): AgentStreamEvent[] {
    switch (update.sessionUpdate) {
      case "user_message_chunk": {
        const item = this.createMessageTimelineItem("user_message", update);
        if (!item) {
          return [];
        }
        const suppressed = this.getSuppressedUserEcho();
        const shouldSuppress =
          suppressed.messageId &&
          update.messageId === suppressed.messageId &&
          suppressed.text &&
          item.text === suppressed.text;
        return shouldSuppress ? [] : [this.wrapTimeline(item)];
      }
      case "agent_message_chunk": {
        const item = this.createMessageTimelineItem("assistant_message", update);
        return item ? [this.wrapTimeline(item)] : [];
      }
      case "agent_thought_chunk": {
        const item = this.createMessageTimelineItem("reasoning", update);
        return item ? [this.wrapTimeline(item)] : [];
      }
      case "tool_call":
        return this.handleToolCallUpdate(update.toolCallId, update);
      case "tool_call_update":
        return this.handleToolCallUpdate(update.toolCallId, update);
      case "plan":
        return [this.wrapTimeline(mapACPPlanToTimeline(update))];
      case "current_mode_update":
        return this.onCurrentModeUpdate(update);
      case "config_option_update":
        return this.onConfigOptionUpdate(update);
      case "session_info_update":
        this.onSessionInfoUpdate(update);
        return [];
      case "usage_update":
        return [];
      case "available_commands_update":
        this.onAvailableCommandsUpdate(update);
        return [];
      default:
        return [];
    }
  }

  buildPermissionToolSnapshot(
    toolCallId: string,
    toolCall: ToolCall | ToolCallUpdate,
  ): ACPToolSnapshot {
    const snapshot = this.toolCalls.get(toolCallId) ?? mergeACPToolSnapshot(toolCallId, toolCall);
    return this.transformToolSnapshot ? this.transformToolSnapshot(snapshot) : snapshot;
  }

  createCanceledToolEvents(): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = [];
    for (const snapshot of this.toolCalls.values()) {
      const mapped = mapACPToolSnapshotToTimeline(snapshot, this.getTerminalStates());
      if (mapped.status === "running") {
        events.push(
          this.wrapTimeline({
            ...mapped,
            status: "canceled",
            error: null,
          }),
        );
      }
    }
    return events;
  }

  private handleToolCallUpdate(
    toolCallId: string,
    update: Extract<SessionUpdate, { sessionUpdate: "tool_call" | "tool_call_update" }>,
  ): AgentStreamEvent[] {
    const previous = this.toolCalls.get(toolCallId);
    let snapshot = mergeACPToolSnapshot(toolCallId, update, previous);
    if (this.transformToolSnapshot) {
      snapshot = this.transformToolSnapshot(snapshot);
    }
    this.toolCalls.set(toolCallId, snapshot);
    return [this.wrapTimeline(mapACPToolSnapshotToTimeline(snapshot, this.getTerminalStates()))];
  }

  private createMessageTimelineItem(
    type: "user_message" | "assistant_message" | "reasoning",
    update: Extract<
      SessionUpdate,
      { sessionUpdate: "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk" }
    >,
  ):
    | { type: "user_message"; text: string; messageId?: string }
    | { type: "assistant_message"; text: string }
    | { type: "reasoning"; text: string }
    | null {
    const chunkText = contentBlockToText(update.content);
    if (!chunkText) {
      return null;
    }
    const key = `${type}:${update.messageId ?? "default"}`;
    const state = this.messageAssemblies.get(key) ?? { text: "" };
    state.text += chunkText;
    this.messageAssemblies.set(key, state);

    if (type === "user_message") {
      return { type: "user_message", text: state.text, messageId: update.messageId ?? undefined };
    }
    if (type === "assistant_message") {
      return { type: "assistant_message", text: chunkText };
    }
    return { type: "reasoning", text: chunkText };
  }

  private wrapTimeline(item: AgentTimelineItem): AgentStreamEvent {
    return {
      type: "timeline",
      provider: this.provider,
      item,
      turnId: this.getTurnId() ?? undefined,
    };
  }
}
