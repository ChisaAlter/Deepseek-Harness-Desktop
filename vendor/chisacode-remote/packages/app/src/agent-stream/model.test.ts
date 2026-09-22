import { describe, expect, it } from "vitest";
import {
  AGENT_PROVIDER_DEFINITIONS,
  DEV_AGENT_PROVIDER_DEFINITIONS,
} from "@chisacode/protocol/provider-manifest";
import type { AgentStreamEventPayload } from "@chisacode/protocol/messages";
import { applyStreamEvent, type StreamItem } from "@/types/stream";
import { buildAgentStreamRenderModel, collapseCompletedTurnThoughtsForDisplay } from "./model";

function createTimestamp(seed: number): Date {
  return new Date(`2026-01-01T00:00:${seed.toString().padStart(2, "0")}.000Z`);
}

function userMessage(id: string, seed: number): StreamItem {
  return {
    kind: "user_message",
    id,
    text: id,
    timestamp: createTimestamp(seed),
  };
}

function assistantMessage(id: string, seed: number): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: createTimestamp(seed),
  };
}

function providerAssistantMessage(
  id: string,
  seed: number,
  input: { text: string; messageId?: string },
): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text: input.text,
    timestamp: createTimestamp(seed),
    ...(input.messageId ? { messageId: input.messageId } : {}),
  };
}

function assistantBlockMessage(
  id: string,
  seed: number,
  block: { groupId: string; index: number },
): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text: id,
    timestamp: createTimestamp(seed),
    blockGroupId: block.groupId,
    blockIndex: block.index,
  };
}

function thoughtMessage(id: string, seed: number, text = id): StreamItem {
  return {
    kind: "thought",
    id,
    text,
    status: "ready",
    timestamp: createTimestamp(seed),
  };
}

function toolCall(id: string, seed: number): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: createTimestamp(seed),
    payload: {
      source: "orchestrator",
      data: {
        toolCallId: id,
        toolName: "Shell",
        arguments: "pwd",
        result: null,
        status: "completed",
      },
    },
  };
}

function providerTimelineEvent(
  provider: string,
  item: Extract<AgentStreamEventPayload, { type: "timeline" }>["item"],
): AgentStreamEventPayload {
  return {
    type: "timeline",
    provider,
    item,
  };
}

function applyProviderEvents(
  provider: string,
  events: Array<Extract<AgentStreamEventPayload, { type: "timeline" }>["item"]>,
): StreamItem[] {
  let tail: StreamItem[] = [];
  let head: StreamItem[] = [];
  for (const [index, item] of events.entries()) {
    const result = applyStreamEvent({
      tail,
      head,
      event: providerTimelineEvent(provider, item),
      timestamp: createTimestamp(index + 1),
    });
    tail = result.tail;
    head = result.head;
  }
  const completed = applyStreamEvent({
    tail,
    head,
    event: { type: "turn_completed", provider, usage: { inputTokens: 1, outputTokens: 1 } },
    timestamp: createTimestamp(events.length + 1),
  });
  return [...completed.tail, ...completed.head];
}

const THOUGHT_COLLAPSE_PROVIDER_COVERAGE = [
  "claude",
  "codex",
  "opencode",
  "pi",
  "kimi",
  "grokbuild",
  "dsh",
  "mock",
  "mock-slow",
] as const;

describe("buildAgentStreamRenderModel", () => {
  it("keeps head separate from committed history on desktop web", () => {
    const tail: StreamItem[] = [];
    for (let index = 0; index < 60; index += 1) {
      const seed = index * 2;
      tail.push(userMessage(`u${index}`, seed + 1));
      tail.push(assistantMessage(`a${index}`, seed + 2));
    }
    const head = [assistantMessage("live-a", 121)];

    const model = buildAgentStreamRenderModel({
      agentStatus: "running",
      tail,
      head,
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(model.segments.historyVirtualized.length).toBeGreaterThan(0);
    expect(model.segments.historyMounted.length).toBeGreaterThan(0);
    expect(model.segments.liveHead.map((item) => item.id)).toEqual(["live-a"]);
    expect(model.history).not.toContain(head[0]);
  });

  it("keeps the full committed tail mounted on mobile web", () => {
    const tail = [userMessage("u1", 1), assistantMessage("a1", 2)];
    const head = [assistantMessage("live-a", 3)];

    const model = buildAgentStreamRenderModel({
      agentStatus: "running",
      tail,
      head,
      platform: "web",
      isMobileBreakpoint: true,
    });

    expect(model.segments.historyVirtualized).toHaveLength(0);
    expect(model.segments.historyMounted).toBe(tail);
    expect(model.segments.liveHead).toBe(head);
  });

  it("reuses ordered committed history when only the live head changes", () => {
    const tail = [userMessage("u1", 1), assistantMessage("a1", 2)];
    const firstHead = [assistantMessage("live-a", 3)];
    const secondHead = [assistantMessage("live-b", 4)];

    const first = buildAgentStreamRenderModel({
      agentStatus: "running",
      tail,
      head: firstHead,
      platform: "native",
      isMobileBreakpoint: false,
    });
    const second = buildAgentStreamRenderModel({
      agentStatus: "running",
      tail,
      head: secondHead,
      platform: "native",
      isMobileBreakpoint: false,
    });

    expect(first.history).toBe(second.history);
    expect(first.segments.historyMounted).toBe(second.segments.historyMounted);
    expect(second.segments.liveHead.map((item) => item.id)).toEqual(["live-b"]);
  });

  it("derives running turn timing across committed history and live head", () => {
    const tail = [userMessage("u1", 1)];
    const head = [assistantMessage("live-a", 4)];

    const model = buildAgentStreamRenderModel({
      agentStatus: "running",
      tail,
      head,
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(model.turnTiming.runningStartedAt).toBe(tail[0]?.timestamp);
    expect(model.turnTiming.byAssistantId.has("live-a")).toBe(false);
  });

  it("maps completed turn timing to assistant ids across committed history and live head", () => {
    const tail = [userMessage("u1", 1)];
    const head = [assistantMessage("live-a", 4)];

    const model = buildAgentStreamRenderModel({
      agentStatus: "idle",
      tail,
      head,
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(model.turnTiming.runningStartedAt).toBe(null);
    expect(model.turnTiming.byAssistantId.get("live-a")).toEqual({
      startedAt: tail[0]?.timestamp,
      completedAt: head[0]?.timestamp,
      durationMs: 3000,
    });
  });

  it("derives the same timing for native inverted rendering", () => {
    const tail = [userMessage("u1", 1), assistantMessage("a1", 4)];

    const model = buildAgentStreamRenderModel({
      agentStatus: "idle",
      tail,
      head: [],
      platform: "native",
      isMobileBreakpoint: false,
    });

    expect(model.segments.historyMounted.map((item) => item.id)).toEqual(["a1", "u1"]);
    expect(model.turnTiming.byAssistantId.get("a1")).toEqual({
      startedAt: tail[0]?.timestamp,
      completedAt: tail[1]?.timestamp,
      durationMs: 3000,
    });
  });

  it("does not create completed timing for adjacent user messages", () => {
    const tail = [userMessage("u1", 1), userMessage("u2", 4)];

    const model = buildAgentStreamRenderModel({
      agentStatus: "idle",
      tail,
      head: [],
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(model.turnTiming.byAssistantId.size).toBe(0);
  });
});

describe("collapseCompletedTurnThoughtsForDisplay", () => {
  it("moves all completed thoughts in a turn above the formal assistant answer", () => {
    const items = [
      userMessage("u1", 1),
      thoughtMessage("t1", 2, "Inspect project"),
      toolCall("tool-1", 3),
      thoughtMessage("t2", 4, "Compare files"),
      assistantMessage("a1", 5),
    ];

    const result = collapseCompletedTurnThoughtsForDisplay(items, { isRunning: false });

    expect(result.map((item) => item.kind)).toEqual([
      "user_message",
      "thought",
      "assistant_message",
    ]);
    const summary = result.at(-2);
    expect(summary).toMatchObject({
      kind: "thought",
      text: "Inspect project\n\n工具调用：Shell pwd\n\nCompare files",
      status: "ready",
      isCollapsedSummary: true,
      summaryForAssistantMessageId: "a1",
    });
  });

  it("collapses pre-answer assistant progress messages into the completed thought summary", () => {
    const items = [
      userMessage("u1", 1),
      assistantMessage("progress-1", 2),
      toolCall("tool-1", 3),
      assistantMessage("progress-2", 4),
      assistantMessage("final-answer", 5),
    ];

    const result = collapseCompletedTurnThoughtsForDisplay(items, { isRunning: false });

    expect(result.map((item) => item.id)).toEqual([
      "u1",
      "thought-summary:final-answer",
      "final-answer",
    ]);
    expect(result.at(-2)).toMatchObject({
      kind: "thought",
      text: "progress-1\n\n工具调用：Shell pwd\n\nprogress-2",
      status: "ready",
      isCollapsedSummary: true,
      summaryForAssistantMessageId: "final-answer",
    });
  });

  it("keeps split final assistant blocks together when collapsing progress messages", () => {
    const items = [
      userMessage("u1", 1),
      assistantMessage("progress-1", 2),
      assistantBlockMessage("final:block:0", 3, { groupId: "final", index: 0 }),
      assistantBlockMessage("final:block:1", 4, { groupId: "final", index: 1 }),
    ];

    const result = collapseCompletedTurnThoughtsForDisplay(items, { isRunning: false });

    expect(result.map((item) => item.id)).toEqual([
      "u1",
      "thought-summary:final:block:1",
      "final:block:0",
      "final:block:1",
    ]);
    expect(result.at(1)).toMatchObject({
      kind: "thought",
      text: "progress-1",
      summaryForAssistantMessageId: "final:block:1",
    });
  });

  it("collapses completed tool calls into the thought summary", () => {
    const items = [
      userMessage("u1", 1),
      thoughtMessage("t1", 2),
      toolCall("tool-1", 3),
      assistantMessage("a1", 4),
    ];

    const result = collapseCompletedTurnThoughtsForDisplay(items, { isRunning: false });

    expect(result.map((item) => item.id)).toEqual(["u1", "thought-summary:a1", "a1"]);
    expect(result.at(1)).toMatchObject({
      kind: "thought",
      text: "t1\n\n工具调用：Shell pwd",
      isCollapsedSummary: true,
      summaryForAssistantMessageId: "a1",
    });
  });

  it("does not move active running thoughts before the formal answer exists", () => {
    const items = [userMessage("u1", 1), thoughtMessage("t1", 2), toolCall("tool-1", 3)];

    const result = collapseCompletedTurnThoughtsForDisplay(items, { isRunning: true });

    expect(result).toBe(items);
    expect(result.map((item) => item.kind)).toEqual(["user_message", "thought", "tool_call"]);
  });

  it("collapses completed thoughts across the history and live-head boundary", () => {
    const thought = thoughtMessage("t1", 2, "Inspect project");
    const assistant = assistantMessage("a1", 3);
    const model = buildAgentStreamRenderModel({
      agentStatus: "idle",
      tail: [userMessage("u1", 1), thought],
      head: [assistant],
      platform: "web",
      isMobileBreakpoint: false,
    });

    expect(model.segments.historyMounted.map((item) => item.id)).toEqual(["u1"]);
    expect(model.segments.liveHead.map((item) => item.id)).toEqual(["thought-summary:a1", "a1"]);
    expect(model.segments.liveHead.at(0)).toMatchObject({
      kind: "thought",
      text: "Inspect project",
      isCollapsedSummary: true,
      summaryForAssistantMessageId: "a1",
    });
  });

  it("collapses Codex pre-answer agent messages from the same turn into one thought summary", () => {
    const items = [
      userMessage("u1", 1),
      providerAssistantMessage("codex-progress-1", 2, {
        messageId: "codex-progress-1",
        text: "Inspecting workspace",
      }),
      thoughtMessage("codex-reasoning", 3, "Comparing stream events"),
      toolCall("codex-tool-1", 4),
      providerAssistantMessage("codex-progress-2", 5, {
        messageId: "codex-progress-2",
        text: "Reading provider output",
      }),
      providerAssistantMessage("codex-final", 6, {
        messageId: "codex-final",
        text: "Final Codex answer",
      }),
    ];

    const result = collapseCompletedTurnThoughtsForDisplay(items, { isRunning: false });

    expect(result.map((item) => item.id)).toEqual([
      "u1",
      "thought-summary:codex-final",
      "codex-final",
    ]);
    expect(result.at(-2)).toMatchObject({
      kind: "thought",
      text: "Inspecting workspace\n\nComparing stream events\n\n工具调用：Shell pwd\n\nReading provider output",
      isCollapsedSummary: true,
      summaryForAssistantMessageId: "codex-final",
    });
  });

  it("keeps Claude assistant chunks with the same message id as the formal answer", () => {
    const items = [
      userMessage("u1", 1),
      thoughtMessage("claude-reasoning", 2, "Thinking with Claude"),
      providerAssistantMessage("claude-answer-1", 3, {
        messageId: "claude-message",
        text: "Claude answer part 1",
      }),
      thoughtMessage("claude-more-reasoning", 4, "Double-checking"),
      providerAssistantMessage("claude-answer-2", 5, {
        messageId: "claude-message",
        text: "Claude answer part 2",
      }),
    ];

    const result = collapseCompletedTurnThoughtsForDisplay(items, { isRunning: false });

    expect(result.map((item) => item.id)).toEqual([
      "u1",
      "thought-summary:claude-answer-2",
      "claude-answer-1",
      "claude-answer-2",
    ]);
    expect(result.at(1)).toMatchObject({
      kind: "thought",
      text: "Thinking with Claude\n\nDouble-checking",
      isCollapsedSummary: true,
      summaryForAssistantMessageId: "claude-answer-2",
    });
  });

  it.each([
    { provider: "opencode" as const, label: "OpenCode" },
    { provider: "pi" as const, label: "Pi" },
  ])("keeps $label assistant deltas without message ids as one formal answer", ({ provider }) => {
    const items = [
      userMessage("u1", 1),
      ...applyProviderEvents(provider, [
        { type: "assistant_message", text: "Formal " },
        { type: "assistant_message", text: "answer" },
      ]),
    ];

    const result = collapseCompletedTurnThoughtsForDisplay(items, { isRunning: false });

    expect(result.map((item) => item.kind)).toEqual(["user_message", "assistant_message"]);
    expect(result.at(-1)).toMatchObject({
      kind: "assistant_message",
      text: "Formal answer",
    });
  });

  it("collapses Kimi ACP reasoning after the formal assistant answer", () => {
    const items = [
      userMessage("u1", 1),
      ...applyProviderEvents("kimi", [
        { type: "reasoning", text: "Kimi ACP reasoning" },
        { type: "assistant_message", text: "Kimi final answer", messageId: "kimi-message" },
      ]),
    ];

    const result = collapseCompletedTurnThoughtsForDisplay(items, { isRunning: false });

    expect(result.map((item) => item.kind)).toEqual([
      "user_message",
      "thought",
      "assistant_message",
    ]);
    expect(result.at(1)).toMatchObject({
      kind: "thought",
      text: "Kimi ACP reasoning",
      isCollapsedSummary: true,
      summaryForAssistantMessageId: "kimi-message",
    });
  });

  // dsh joins this bucket: its transport emits only committed blocks (no
  // reasoning deltas, no tool frames), so pure text turns never yield thoughts.
  it.each(["mock" as const, "mock-slow" as const, "dsh" as const])(
    "does not create an empty thought summary for %s assistant-only turns",
    (provider) => {
      const items = [
        userMessage("u1", 1),
        ...applyProviderEvents(provider, [
          { type: "assistant_message", text: "Mock final answer" },
        ]),
      ];

      const result = collapseCompletedTurnThoughtsForDisplay(items, { isRunning: false });

      expect(result.map((item) => item.kind)).toEqual(["user_message", "assistant_message"]);
      expect(result.at(-1)).toMatchObject({
        kind: "assistant_message",
        text: "Mock final answer",
      });
    },
  );

  it("documents every built-in and development provider covered by thought collapse tests", () => {
    expect(THOUGHT_COLLAPSE_PROVIDER_COVERAGE).toEqual([
      "claude",
      "codex",
      "opencode",
      "pi",
      "kimi",
      "grokbuild",
      "dsh",
      "mock",
      "mock-slow",
    ]);
    expect(THOUGHT_COLLAPSE_PROVIDER_COVERAGE).toEqual(
      [...AGENT_PROVIDER_DEFINITIONS, ...DEV_AGENT_PROVIDER_DEFINITIONS].map(
        (definition) => definition.id,
      ),
    );
  });
});
