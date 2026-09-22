import pino from "pino";
import { z } from "zod/v3";
import { describe, expect, test } from "vitest";

import { CLIENT_CAPS } from "@chisacode/protocol/client-capabilities";
import {
  AgentSnapshotPayloadSchema,
  AgentTimelineItemPayloadSchema,
  FetchAgentTimelineResponseMessageSchema,
  SessionInboundMessageSchema,
  type SessionOutboundMessage,
} from "@chisacode/protocol/messages";
import { Session, type SessionOptions } from "./session.js";
import { GenerativeUiHandler } from "./session-handlers/generative-ui-handler.js";
import type { GenerativeUiHandlerContext } from "./session-handlers/session-context.js";
import { createProviderSnapshotManagerStub } from "./test-utils/session-stubs.js";
import type { AgentManagerEvent, AgentTimelineRow } from "./agent/agent-manager.js";
import { InMemoryAgentTimelineStore } from "./agent/agent-timeline-store.js";
import { handleCreateChisaCodeWorktreeRequest } from "./worktree-session.js";

const LegacyAgentTimelineItemPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({ type: z.literal("assistant_message"), text: z.string() }),
]);

const LegacyTimelineEntryPayloadSchema = z.object({
  provider: z.enum(["claude", "codex", "opencode"]),
  item: LegacyAgentTimelineItemPayloadSchema,
  timestamp: z.string(),
  seqStart: z.number().int().nonnegative(),
  seqEnd: z.number().int().nonnegative(),
  sourceSeqRanges: z.array(
    z.object({
      startSeq: z.number().int().nonnegative(),
      endSeq: z.number().int().nonnegative(),
    }),
  ),
  // Copied from v0.1.65-beta.3: no reasoning_merge on the wire yet.
  collapsed: z.array(z.enum(["assistant_merge", "tool_lifecycle"])),
});

const LegacyFetchAgentTimelineResponseMessageSchema = z.object({
  type: z.literal("fetch_agent_timeline_response"),
  payload: FetchAgentTimelineResponseMessageSchema.shape.payload.extend({
    entries: z.array(LegacyTimelineEntryPayloadSchema),
  }),
});

const LegacySubAgentToolCallSchema = z.object({
  type: z.literal("tool_call"),
  callId: z.string(),
  name: z.string(),
  status: z.enum(["running", "completed", "failed", "canceled"]),
  error: z.unknown().nullable(),
  detail: z.object({
    type: z.literal("sub_agent"),
    subAgentType: z.string().optional(),
    description: z.string().optional(),
    log: z.string(),
    // Copied from v0.1.65-beta.3: actions was required even though the UI ignored it.
    actions: z.array(
      z.object({
        index: z.number().int().positive(),
        toolName: z.string(),
        summary: z.string().optional(),
      }),
    ),
  }),
});

const LegacyAgentCapabilityFlagsSchema = z.object({
  supportsStreaming: z.boolean(),
  supportsSessionPersistence: z.boolean(),
  supportsDynamicModes: z.boolean(),
  supportsMcpServers: z.boolean(),
  supportsReasoningStream: z.boolean(),
  supportsToolInvocations: z.boolean(),
});

const LegacyAgentSnapshotPayloadSchema = AgentSnapshotPayloadSchema.extend({
  capabilities: LegacyAgentCapabilityFlagsSchema,
});

class InMemoryAgentManager {
  private subscriber: ((event: AgentManagerEvent) => void) | null = null;
  private readonly timelineStore = new InMemoryAgentTimelineStore();

  constructor(rows: AgentTimelineRow[]) {
    this.timelineStore.initialize("agent-1", { epoch: "epoch-1", rows });
  }

  emitEvent(event: AgentManagerEvent) {
    this.subscriber?.(event);
  }

  getAgent() {
    return {
      id: "agent-1",
      provider: "codex",
      cwd: "/tmp/project",
      model: null,
      thinkingOptionId: null,
      effectiveThinkingOptionId: null,
      createdAt: new Date("2026-05-02T00:00:00.000Z"),
      updatedAt: new Date("2026-05-02T00:00:00.000Z"),
      lastUserMessageAt: null,
      lifecycle: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
        supportsRewindConversation: false,
        supportsRewindFiles: false,
        supportsRewindBoth: false,
      },
      config: { provider: "codex", cwd: "/tmp/project" },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: new Map(),
      bufferedPermissionResolutions: new Map(),
      inFlightPermissionResponses: new Set(),
      pendingReplacement: false,
      persistence: null,
      historyPrimed: true,
      lastUsage: undefined,
      lastError: undefined,
      attention: { requiresAttention: false, attentionReason: null, attentionTimestamp: null },
      foregroundTurnWaiters: new Set(),
      finalizedForegroundTurnIds: new Set(),
      unsubscribeSession: null,
      session: null,
      activeForegroundTurnId: null,
      labels: {},
    };
  }

  fetchTimeline(_agentId: string, options?: Parameters<InMemoryAgentTimelineStore["fetch"]>[1]) {
    return this.timelineStore.fetch("agent-1", options);
  }

  listAgents() {
    return [];
  }

  setGoalCompletionJudge() {}

  subscribe(callback: (event: AgentManagerEvent) => void) {
    this.subscriber = callback;
    return () => {
      this.subscriber = null;
    };
  }
}

class EmptyAgentStorage {
  async list() {
    return [];
  }

  async get() {
    return null;
  }
}

class EmptyProjectRegistry {
  async list() {
    return [];
  }

  async get() {
    return null;
  }

  async upsert() {}
  async archive() {}
  async remove() {}
  async initialize() {}
  async existsOnDisk() {
    return false;
  }
}

class EmptyWorkspaceRegistry {
  get() {
    return null;
  }

  list() {
    return [];
  }
}

class EmptyDaemonConfigStore {
  get() {
    return {
      mcp: { injectIntoAgents: false },
      providers: {},
    };
  }

  onChange() {
    return () => {};
  }

  onFieldChange() {
    return () => {};
  }
}

class InMemoryWorktreeWorkflow {
  readonly capturedInputs: unknown[] = [];

  async create(input: unknown) {
    this.capturedInputs.push(input);
    return {} as never;
  }
}

function createSessionForWireCompatTest(options?: {
  clientCapabilities?: Record<string, unknown> | null;
  messages?: SessionOutboundMessage[];
  rows?: AgentTimelineRow[];
  manager?: InMemoryAgentManager;
}): Session {
  const messages = options?.messages ?? [];
  const rows: AgentTimelineRow[] = options?.rows ?? [
    {
      seq: 1,
      timestamp: "2026-05-02T00:00:00.000Z",
      item: { type: "reasoning", text: "Step " },
    },
    {
      seq: 2,
      timestamp: "2026-05-02T00:00:00.100Z",
      item: { type: "reasoning", text: "by step" },
    },
    {
      seq: 3,
      timestamp: "2026-05-02T00:00:00.200Z",
      item: { type: "assistant_message", text: "done" },
    },
  ];

  const session = new Session({
    clientId: "wire-compat-client",
    clientCapabilities: options?.clientCapabilities ?? null,
    onMessage: (message) => messages.push(message),
    logger: pino({ level: "silent" }),
    downloadTokenStore: {} as SessionOptions["downloadTokenStore"],
    pushTokenStore: {} as SessionOptions["pushTokenStore"],
    chisacodeHome: "/tmp/chisacode-home",
    agentManager: (options?.manager ??
      new InMemoryAgentManager(rows)) as unknown as SessionOptions["agentManager"],
    agentStorage: new EmptyAgentStorage() as unknown as SessionOptions["agentStorage"],
    projectRegistry: new EmptyProjectRegistry() as unknown as SessionOptions["projectRegistry"],
    workspaceRegistry:
      new EmptyWorkspaceRegistry() as unknown as SessionOptions["workspaceRegistry"],
    chatService: {} as SessionOptions["chatService"],
    scheduleService: {} as SessionOptions["scheduleService"],
    loopService: {} as SessionOptions["loopService"],
    checkoutDiffManager: {
      scheduleRefreshForCwd() {},
    } as unknown as SessionOptions["checkoutDiffManager"],
    github: {
      invalidate() {},
      async searchIssuesAndPrs() {
        return [];
      },
      async createPullRequest() {
        return null;
      },
    } as unknown as SessionOptions["github"],
    workspaceGitService: {
      async getCheckoutDiff() {
        return null;
      },
      async getSnapshot() {
        return null;
      },
      async suggestBranchesForCwd() {
        return [];
      },
      async listStashes() {
        return [];
      },
      peekSnapshot() {
        return null;
      },
      async validateBranchRef() {
        return { ok: false, error: "not found" };
      },
      async hasLocalBranch() {
        return false;
      },
      async resolveRepoRemoteUrl() {
        return null;
      },
      async getWorkspaceGitMetadata() {
        return null;
      },
    } as unknown as SessionOptions["workspaceGitService"],
    daemonConfigStore:
      new EmptyDaemonConfigStore() as unknown as SessionOptions["daemonConfigStore"],
    stt: null,
    tts: null,
    providerSnapshotManager: createProviderSnapshotManagerStub().manager,
    terminalManager: null,
  });

  return session;
}

async function emitTimelineResponse(
  clientCapabilities?: Record<string, unknown> | null,
): Promise<Extract<SessionOutboundMessage, { type: "fetch_agent_timeline_response" }>> {
  const messages: SessionOutboundMessage[] = [];
  const session = createSessionForWireCompatTest({ clientCapabilities, messages });

  await session.handleMessage({
    type: "fetch_agent_timeline_request",
    requestId: "req-timeline",
    agentId: "agent-1",
    projection: "projected",
  });

  const response = messages[0];
  expect(response?.type).toBe("fetch_agent_timeline_response");
  if (!response || response.type !== "fetch_agent_timeline_response") {
    throw new Error("Expected fetch_agent_timeline_response");
  }
  return response;
}

describe("wire compatibility", () => {
  test("assistant timeline message ids are optional on the wire", () => {
    expect(
      AgentTimelineItemPayloadSchema.parse({
        type: "assistant_message",
        text: "old daemon shape",
      }),
    ).toEqual({
      type: "assistant_message",
      text: "old daemon shape",
    });
    expect(
      AgentTimelineItemPayloadSchema.parse({
        type: "assistant_message",
        text: "new daemon shape",
        messageId: "msg-1",
      }),
    ).toEqual({
      type: "assistant_message",
      text: "new daemon shape",
      messageId: "msg-1",
    });
  });

  test("downgrades reasoning_merge for clients that do not declare the capability", async () => {
    const response = await emitTimelineResponse();

    const currentParsed = FetchAgentTimelineResponseMessageSchema.parse(response);
    expect(currentParsed.payload.entries[0]?.collapsed).not.toContain("reasoning_merge");

    const legacyParsed = LegacyFetchAgentTimelineResponseMessageSchema.parse(response);
    expect(legacyParsed.payload.entries[0]?.collapsed).toEqual([]);
  });

  test("preserves reasoning_merge for clients that declare the capability", async () => {
    const response = await emitTimelineResponse({
      [CLIENT_CAPS.reasoningMergeEnum]: true,
    });

    const currentParsed = FetchAgentTimelineResponseMessageSchema.parse(response);
    expect(currentParsed.payload.entries[0]?.collapsed).toContain("reasoning_merge");
  });

  test("sub_agent tool-call payload still parses against the v0.1.65-beta.3 schema", () => {
    const parsed = LegacySubAgentToolCallSchema.parse({
      type: "tool_call",
      callId: "call-sub-agent-1",
      name: "Task",
      status: "completed",
      error: null,
      detail: {
        type: "sub_agent",
        subAgentType: "Explore",
        description: "Inspect repository structure",
        childSessionId: "child-session-1",
        log: "[Read] README.md",
        actions: [],
      },
    });

    expect(parsed.detail.actions).toEqual([]);
  });

  test("old clients parse agent snapshots with rewind capabilities", () => {
    const parsed = LegacyAgentSnapshotPayloadSchema.parse({
      id: "agent-1",
      provider: "claude",
      cwd: "/tmp/project",
      model: null,
      thinkingOptionId: null,
      effectiveThinkingOptionId: null,
      createdAt: "2026-05-23T00:00:00.000Z",
      updatedAt: "2026-05-23T00:00:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
        supportsRewindConversation: true,
        supportsRewindFiles: true,
        supportsRewindBoth: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: null,
      labels: {},
    });

    expect(parsed.capabilities).toEqual({
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    });
  });

  test("new clients parse agent snapshots without rewind capabilities", () => {
    const parsed = AgentSnapshotPayloadSchema.parse({
      id: "agent-1",
      provider: "claude",
      cwd: "/tmp/project",
      model: null,
      thinkingOptionId: null,
      effectiveThinkingOptionId: null,
      createdAt: "2026-05-23T00:00:00.000Z",
      updatedAt: "2026-05-23T00:00:00.000Z",
      lastUserMessageAt: null,
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: null,
      labels: {},
    });

    expect(parsed.capabilities.supportsRewindConversation).toBe(false);
    expect(parsed.capabilities.supportsRewindFiles).toBe(false);
    expect(parsed.capabilities.supportsRewindBoth).toBe(false);
  });

  test("legacy worktree request shape normalizes to the same internal input as the new shape", async () => {
    const workflow = new InMemoryWorktreeWorkflow();

    const dependencies = {
      chisacodeHome: "/tmp/chisacode-home",
      describeWorkspaceRecord: async () =>
        ({
          id: "ws-1",
          projectId: "proj-1",
          projectDisplayName: "repo",
          projectRootPath: "/tmp/repo",
          projectKind: "directory",
          workspaceKind: "checkout",
          name: "repo",
          cwd: "/tmp/repo",
          status: "ready",
          activityAt: null,
          scripts: [],
        }) as never,
      emit() {},
      sessionLogger: pino({ level: "silent" }),
      createChisaCodeWorktreeWorkflow: workflow.create.bind(workflow),
    };

    const legacyRequest = SessionInboundMessageSchema.parse({
      type: "create_chisacode_worktree_request",
      requestId: "req-legacy",
      cwd: "/tmp/repo",
      worktreeSlug: "legacy-worktree",
      nameContext: "Investigate flaky test",
      attachments: [
        {
          type: "github_issue",
          mimeType: "application/github-issue",
          number: 55,
          title: "Improve startup error details",
          url: "https://github.com/getchisacode/chisacode/issues/55",
        },
      ],
    });

    const newRequest = SessionInboundMessageSchema.parse({
      type: "create_chisacode_worktree_request",
      requestId: "req-new",
      cwd: "/tmp/repo",
      worktreeSlug: "legacy-worktree",
      firstAgentContext: {
        prompt: "Investigate flaky test",
        attachments: [
          {
            type: "github_issue",
            mimeType: "application/github-issue",
            number: 55,
            title: "Improve startup error details",
            url: "https://github.com/getchisacode/chisacode/issues/55",
          },
        ],
      },
    });

    if (legacyRequest.type !== "create_chisacode_worktree_request") {
      throw new Error("Expected legacy worktree request");
    }
    if (newRequest.type !== "create_chisacode_worktree_request") {
      throw new Error("Expected new worktree request");
    }

    await handleCreateChisaCodeWorktreeRequest(dependencies, legacyRequest);
    await handleCreateChisaCodeWorktreeRequest(dependencies, newRequest);

    expect(workflow.capturedInputs).toHaveLength(2);
    expect(workflow.capturedInputs[0]).toEqual(workflow.capturedInputs[1]);
    expect(workflow.capturedInputs[0]).toEqual({
      cwd: "/tmp/repo",
      worktreeSlug: "legacy-worktree",
      firstAgentContext: {
        prompt: "Investigate flaky test",
        attachments: [
          {
            type: "github_issue",
            mimeType: "application/github-issue",
            number: 55,
            title: "Improve startup error details",
            url: "https://github.com/getchisacode/chisacode/issues/55",
          },
        ],
      },
      refName: undefined,
      action: undefined,
      githubPrNumber: undefined,
      runSetup: false,
      chisacodeHome: "/tmp/chisacode-home",
    });
  });
});

describe("generative UI wire capability", () => {
  const fenceText = '```chisacode-ui component=table\n{"rows":[]}\n```';
  const genUiRow: AgentTimelineRow = {
    seq: 4,
    timestamp: "2026-05-02T00:00:00.300Z",
    item: {
      type: "generative_ui",
      instanceId: "gen-ui-1",
      componentId: "table",
      props: { rows: [] },
      source: "tool_call",
      status: "interactive",
    },
  };

  test("legacy timeline schema parses responses without generative UI rows", async () => {
    const rows: AgentTimelineRow[] = [
      {
        seq: 1,
        timestamp: "2026-05-02T00:00:00.000Z",
        item: { type: "assistant_message", text: fenceText },
      },
      genUiRow,
    ];
    const messages: SessionOutboundMessage[] = [];
    const session = createSessionForWireCompatTest({ rows, messages });

    await session.handleMessage({
      type: "fetch_agent_timeline_request",
      requestId: "req-gen-ui-legacy",
      agentId: "agent-1",
      projection: "canonical",
    });

    const response = messages.find((message) => message.type === "fetch_agent_timeline_response");
    expect(response?.type).toBe("fetch_agent_timeline_response");
    if (response?.type !== "fetch_agent_timeline_response") throw new Error("missing response");
    expect(LegacyFetchAgentTimelineResponseMessageSchema.safeParse(response).success).toBe(true);
    expect(response.payload.entries.map((entry) => entry.item.type)).toEqual(["assistant_message"]);
    expect(response.payload.entries[0]?.item).toEqual({
      type: "assistant_message",
      text: fenceText,
    });
  });

  test("capable clients receive explicit generative UI timeline rows", async () => {
    const rows: AgentTimelineRow[] = [genUiRow];
    const messages: SessionOutboundMessage[] = [];
    const session = createSessionForWireCompatTest({
      rows,
      messages,
      clientCapabilities: { [CLIENT_CAPS.generativeUi]: true },
    });

    await session.handleMessage({
      type: "fetch_agent_timeline_request",
      requestId: "req-gen-ui-new",
      agentId: "agent-1",
      projection: "canonical",
    });

    const response = messages.find((message) => message.type === "fetch_agent_timeline_response");
    expect(response?.type).toBe("fetch_agent_timeline_response");
    if (response?.type !== "fetch_agent_timeline_response") throw new Error("missing response");
    expect(response.payload.entries.map((entry) => entry.item.type)).toEqual(["generative_ui"]);
  });

  test("legacy sessions suppress live explicit generative UI creation rows", () => {
    const messages: SessionOutboundMessage[] = [];
    const manager = new InMemoryAgentManager([]);
    createSessionForWireCompatTest({ manager, messages });
    manager.emitEvent({
      type: "agent_stream",
      agentId: "agent-1",
      epoch: "epoch-1",
      seq: 1,
      event: { type: "timeline", item: genUiRow.item, provider: "codex" },
    });
    expect(messages).toHaveLength(0);
  });

  test.each(["generative_ui_update", "generative_ui_remove"] as const)(
    "legacy sessions suppress live %s events",
    (eventType) => {
      const messages: SessionOutboundMessage[] = [];
      const manager = new InMemoryAgentManager([]);
      createSessionForWireCompatTest({ manager, messages });
      manager.emitEvent({
        type: "agent_stream",
        agentId: "agent-1",
        epoch: "epoch-1",
        seq: 1,
        event:
          eventType === "generative_ui_update"
            ? { type: eventType, instanceId: "gen-ui-1", props: {}, provider: "codex" }
            : { type: eventType, instanceId: "gen-ui-1", provider: "codex" },
      });
      expect(messages).toHaveLength(0);
    },
  );
});

describe("generative UI RPC routing compatibility", () => {
  test.each(["generative_ui.action.request", "generative_ui.action"] as const)(
    "routes %s to the shared response contract",
    async (type) => {
      const emitted: Record<string, unknown>[] = [];
      const enqueued: Array<{ agentId: string; action: string }> = [];
      const context = {
        clientId: "client-1",
        sessionId: "session-1",
        sessionLogger: pino({ level: "silent" }),
        chisacodeHome: "/tmp/chisacode",
        appVersion: null,
        abortController: new AbortController(),
        emit: (message: Record<string, unknown>) => emitted.push(message),
        emitBinary: () => {},
        hasBinaryChannel: () => false,
        supports: () => true,
        agentManager: {
          getAgent: () => ({ lifecycle: "idle" }),
          enqueueGenerativeUiAction: (agentId: string, queuedAction: { action: string }) => {
            enqueued.push({ agentId, action: queuedAction.action });
            return { queued: true } as const;
          },
        },
      } as GenerativeUiHandlerContext;
      const handler = new GenerativeUiHandler(context);

      await handler.dispatch({
        type,
        requestId: "req-action",
        agentId: "agent-1",
        instanceId: "instance-1",
        action: "submit",
        payload: null,
        timestamp: 1719700000000,
      });

      expect(enqueued).toEqual([{ agentId: "agent-1", action: "submit" }]);
      expect(emitted).toEqual([
        {
          type: "generative_ui.action.response",
          payload: { requestId: "req-action", received: true, error: null },
        },
      ]);
    },
  );
});

async function fetchTimelineForRows(input: {
  rows: AgentTimelineRow[];
  direction?: "tail" | "before" | "after";
  cursorSeq?: number;
  limit?: number;
  clientCapabilities?: Record<string, unknown> | null;
}) {
  const messages: SessionOutboundMessage[] = [];
  const session = createSessionForWireCompatTest({
    rows: input.rows,
    messages,
    clientCapabilities: input.clientCapabilities,
  });
  await session.handleMessage({
    type: "fetch_agent_timeline_request",
    requestId: "req-pagination",
    agentId: "agent-1",
    projection: "canonical",
    direction: input.direction ?? "tail",
    ...(input.cursorSeq === undefined
      ? {}
      : { cursor: { epoch: "epoch-1", seq: input.cursorSeq } }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  const response = messages.find((message) => message.type === "fetch_agent_timeline_response");
  if (response?.type !== "fetch_agent_timeline_response") throw new Error("missing response");
  return response.payload;
}

describe("generative UI visible pagination", () => {
  const assistantRow = (seq: number): AgentTimelineRow => ({
    seq,
    timestamp: `2026-05-02T00:00:0${seq}.000Z`,
    item: { type: "assistant_message", text: `assistant-${seq}` },
  });
  const hiddenRow = (seq: number): AgentTimelineRow => ({
    seq,
    timestamp: `2026-05-02T00:00:0${seq}.000Z`,
    item: {
      type: "generative_ui",
      instanceId: `gen-ui-${seq}`,
      componentId: "table",
      props: {},
      source: "tool_call",
      status: "interactive",
    },
  });

  test("tail limit fills from visible rows when the newest canonical row is hidden", async () => {
    const payload = await fetchTimelineForRows({
      rows: [assistantRow(1), hiddenRow(2)],
      limit: 1,
    });
    expect(payload.entries.map((entry) => entry.item.type)).toEqual(["assistant_message"]);
    expect(payload.startCursor).toEqual({ epoch: "epoch-1", seq: 1 });
    expect(payload.endCursor).toEqual({ epoch: "epoch-1", seq: 1 });
    expect(payload.window).toEqual({ minSeq: 1, maxSeq: 1, nextSeq: 3 });
    expect(payload.hasOlder).toBe(false);
    expect(payload.hasNewer).toBe(false);
  });

  test("after fills visible limits across hidden sequence gaps", async () => {
    const rows = [assistantRow(1), hiddenRow(2), assistantRow(3), hiddenRow(4), assistantRow(5)];
    const after = await fetchTimelineForRows({ rows, direction: "after", cursorSeq: 1, limit: 2 });
    expect(after.entries.map((entry) => entry.seqStart)).toEqual([3, 5]);
    expect(after.endCursor).toEqual({ epoch: "epoch-1", seq: 5 });
    expect(after.hasNewer).toBe(false);

    const exhausted = await fetchTimelineForRows({
      rows,
      direction: "after",
      cursorSeq: 5,
      limit: 2,
    });
    expect(exhausted.entries).toEqual([]);
    expect(exhausted.endCursor).toBeNull();
    expect(exhausted.hasNewer).toBe(false);
  });

  test("before fills visible limits across hidden sequence gaps", async () => {
    const rows = [assistantRow(1), hiddenRow(2), assistantRow(3), hiddenRow(4), assistantRow(5)];
    const before = await fetchTimelineForRows({
      rows,
      direction: "before",
      cursorSeq: 5,
      limit: 2,
    });
    expect(before.entries.map((entry) => entry.seqStart)).toEqual([1, 3]);
    expect(before.startCursor).toEqual({ epoch: "epoch-1", seq: 1 });
    expect(before.endCursor).toEqual({ epoch: "epoch-1", seq: 3 });
    expect(before.hasOlder).toBe(false);
    expect(before.hasNewer).toBe(true);

    const exhausted = await fetchTimelineForRows({
      rows,
      direction: "before",
      cursorSeq: 1,
      limit: 2,
    });
    expect(exhausted.entries).toEqual([]);
    expect(exhausted.startCursor).toBeNull();
    expect(exhausted.hasOlder).toBe(false);
  });

  test("unsupported canonical after limit counts adjacent assistant rows canonically", async () => {
    const rows = [assistantRow(1), assistantRow(2), assistantRow(3)];
    const payload = await fetchTimelineForRows({
      rows,
      direction: "after",
      cursorSeq: 0,
      limit: 1,
    });
    expect(payload.entries.map((entry) => entry.seqStart)).toEqual([1]);
    expect(payload.endCursor).toEqual({ epoch: "epoch-1", seq: 1 });
    expect(payload.hasOlder).toBe(false);
    expect(payload.hasNewer).toBe(true);
  });

  test("unsupported canonical before limit counts adjacent assistant rows canonically", async () => {
    const rows = [assistantRow(1), assistantRow(2), assistantRow(3)];
    const payload = await fetchTimelineForRows({
      rows,
      direction: "before",
      cursorSeq: 3,
      limit: 1,
    });
    expect(payload.entries.map((entry) => entry.seqStart)).toEqual([2]);
    expect(payload.startCursor).toEqual({ epoch: "epoch-1", seq: 2 });
    expect(payload.endCursor).toEqual({ epoch: "epoch-1", seq: 2 });
    expect(payload.hasOlder).toBe(true);
    expect(payload.hasNewer).toBe(true);
  });

  test("capable canonical after and before limits retain original row counting", async () => {
    const rows = [assistantRow(1), assistantRow(2), assistantRow(3)];
    const clientCapabilities = { [CLIENT_CAPS.generativeUi]: true };
    const after = await fetchTimelineForRows({
      rows,
      direction: "after",
      cursorSeq: 0,
      limit: 1,
      clientCapabilities,
    });
    expect(after.entries.map((entry) => entry.seqStart)).toEqual([1]);
    expect(after.endCursor).toEqual({ epoch: "epoch-1", seq: 1 });
    expect(after.hasNewer).toBe(true);

    const before = await fetchTimelineForRows({
      rows,
      direction: "before",
      cursorSeq: 3,
      limit: 1,
      clientCapabilities,
    });
    expect(before.entries.map((entry) => entry.seqStart)).toEqual([2]);
    expect(before.startCursor).toEqual({ epoch: "epoch-1", seq: 2 });
    expect(before.endCursor).toEqual({ epoch: "epoch-1", seq: 2 });
  });

  test("all-hidden history returns stable empty visible metadata", async () => {
    const payload = await fetchTimelineForRows({ rows: [hiddenRow(1), hiddenRow(2)], limit: 1 });
    expect(payload.entries).toEqual([]);
    expect(payload.startCursor).toBeNull();
    expect(payload.endCursor).toBeNull();
    expect(payload.window).toEqual({ minSeq: 0, maxSeq: 0, nextSeq: 3 });
    expect(payload.hasOlder).toBe(false);
    expect(payload.hasNewer).toBe(false);

    const exhausted = await fetchTimelineForRows({
      rows: [hiddenRow(1), hiddenRow(2)],
      direction: "after",
      cursorSeq: 2,
      limit: 1,
    });
    expect(exhausted.entries).toEqual([]);
    expect(exhausted.startCursor).toBeNull();
    expect(exhausted.endCursor).toBeNull();
    expect(exhausted.hasNewer).toBe(false);
  });

  test("capable clients retain canonical tail rows and metadata", async () => {
    const payload = await fetchTimelineForRows({
      rows: [assistantRow(1), hiddenRow(2)],
      limit: 1,
      clientCapabilities: { [CLIENT_CAPS.generativeUi]: true },
    });
    expect(payload.entries.map((entry) => entry.item.type)).toEqual(["generative_ui"]);
    expect(payload.startCursor).toEqual({ epoch: "epoch-1", seq: 2 });
    expect(payload.endCursor).toEqual({ epoch: "epoch-1", seq: 2 });
    expect(payload.window).toEqual({ minSeq: 1, maxSeq: 2, nextSeq: 3 });
    expect(payload.hasOlder).toBe(true);
    expect(payload.hasNewer).toBe(false);
  });
});
