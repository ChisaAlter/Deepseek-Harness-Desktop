import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager, type AgentManagerEvent } from "./agent-manager.js";
import { AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS } from "./agent-stream-coalescer.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import type {
  AgentCapabilityFlags,
  AgentClient,
  AgentLaunchContext,
  AgentModelDefinition,
  AgentPersistenceHandle,
  AgentProvider,
  AgentSession,
  AgentSessionConfig,
  AgentStreamEvent,
  AgentTimelineItem,
} from "./agent-sdk-types.js";

const COALESCE_WINDOW_MS = AGENT_STREAM_COALESCE_DEFAULT_WINDOW_MS;

const AGENT_IDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
] as const;

const TEST_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: false,
  supportsSessionPersistence: false,
  supportsDynamicModes: false,
  supportsMcpServers: false,
  supportsReasoningStream: false,
  supportsToolInvocations: false,
};

// ─── Mock Session / Client ──────────────────────────────────────────────────

class TestAgentSession implements AgentSession {
  readonly provider: AgentProvider;
  readonly capabilities = TEST_CAPABILITIES;
  readonly id: string;
  private subscribers = new Set<(event: AgentStreamEvent) => void>();
  private historyEvents: AgentStreamEvent[] = [];
  private runtimeModel: string | null = null;

  constructor(
    provider: AgentProvider,
    private readonly config: AgentSessionConfig,
    id: string,
  ) {
    this.provider = provider;
    this.id = id;
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  pushEvent(event: AgentStreamEvent): void {
    for (const callback of this.subscribers) {
      callback(event);
    }
  }

  setHistory(events: AgentStreamEvent[]): void {
    this.historyEvents = [...events];
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    for (const event of this.historyEvents) {
      yield event;
    }
  }

  async getRuntimeInfo() {
    return {
      provider: this.provider,
      sessionId: this.id,
      model: this.config.model ?? this.runtimeModel ?? null,
      modeId: this.config.modeId ?? null,
    };
  }

  async getAvailableModes() {
    return [];
  }

  async getCurrentMode() {
    return null;
  }

  async setMode(): Promise<void> {}

  getPendingPermissions() {
    return [];
  }

  async respondToPermission(): Promise<void> {}

  describePersistence(): AgentPersistenceHandle {
    return { provider: this.provider, sessionId: this.id };
  }

  async interrupt(): Promise<void> {}

  async close(): Promise<void> {
    this.subscribers.clear();
  }
}

class TestAgentClient implements AgentClient {
  readonly capabilities = TEST_CAPABILITIES;
  private sessionCounter = 0;
  readonly sessions = new Map<string, TestAgentSession>();

  constructor(readonly provider: AgentProvider = "codex") {}

  async createSession(
    config: AgentSessionConfig,
    _launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const session = new TestAgentSession(
      config.provider,
      config,
      `${config.provider}-session-${++this.sessionCounter}`,
    );
    this.sessions.set(config.cwd, session);
    return session;
  }

  async resumeSession(
    _handle: AgentPersistenceHandle,
    config?: Partial<AgentSessionConfig>,
    _launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    const resolvedConfig: AgentSessionConfig = {
      provider: this.provider,
      cwd: config?.cwd ?? process.cwd(),
      ...config,
    };
    return this.createSession(resolvedConfig);
  }

  async listModels(): Promise<AgentModelDefinition[]> {
    return [{ provider: this.provider, id: "test-model", label: "Test Model", isDefault: true }];
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getSession(cwd: string): TestAgentSession {
    const session = this.sessions.get(cwd);
    if (!session) {
      throw new Error(`No test session for cwd ${cwd}`);
    }
    return session;
  }
}

// ─── Harness ────────────────────────────────────────────────────────────────

interface Harness {
  manager: AgentManager;
  client: TestAgentClient;
  events: AgentManagerEvent[];
  workdir: string;
  cleanup: () => void;
}

function createHarness(options?: { provider?: AgentProvider }): Harness {
  const workdir = mkdtempSync(join(tmpdir(), "agent-manager-gen-ui-"));
  const client = new TestAgentClient(options?.provider ?? "codex");
  const manager = new AgentManager({
    clients: { [client.provider]: client },
    idFactory: createIdFactory(),
    logger: createTestLogger(),
  });
  const events: AgentManagerEvent[] = [];
  manager.subscribe((event) => events.push(event), { replayState: false });

  return {
    manager,
    client,
    events,
    workdir,
    cleanup: () => rmSync(workdir, { recursive: true, force: true }),
  };
}

function createIdFactory(): () => string {
  let index = 0;
  return () => AGENT_IDS[index++] ?? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function createManagedSession(
  harness: Harness,
  options?: { agentId?: string; provider?: AgentProvider; workdir?: string },
): Promise<{ agentId: string; session: TestAgentSession; workdir: string }> {
  const agentId = options?.agentId ?? AGENT_IDS[0];
  const workdir = options?.workdir ?? harness.workdir;
  await harness.manager.createAgent(
    { provider: options?.provider ?? harness.client.provider, cwd: workdir },
    agentId,
  );
  return { agentId, session: harness.client.getSession(workdir), workdir };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function assistant(
  text: string,
  provider: AgentProvider = "codex",
  turnId?: string,
): AgentStreamEvent {
  return { type: "timeline", provider, turnId, item: { type: "assistant_message", text } };
}

function getTimelineItems(rows: AgentTimelineRow[]): AgentTimelineItem[] {
  return rows.map((row) => row.item);
}

async function waitForSessionEventQueue(): Promise<void> {
  for (let i = 0; i < 10_000; i++) {
    await Promise.resolve();
  }
}

/** 构建完整的 chisacode-ui fence block 文本 */
function fenceBlock(componentId: string, props: Record<string, unknown>): string {
  return `\`\`\`chisacode-ui component=${componentId}\n${JSON.stringify(props)}\n\`\`\``;
}

// ─── Teardown ───────────────────────────────────────────────────────────────

let activeHarnasses: Harness[] = [];

afterEach(() => {
  for (const h of activeHarnasses) {
    try {
      h.cleanup();
    } catch {
      /* ignore cleanup errors */
    }
  }
  activeHarnasses = [];
  vi.useRealTimers();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("AgentManager generative UI integration", () => {
  test("T1: keeps a chisacode-ui fence in exactly one assistant timeline row", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    activeHarnasses.push(harness);

    const { agentId, session } = await createManagedSession(harness);
    const text = `Here is a chart:\n\n${fenceBlock("line_chart", { xAxis: "month", yAxis: "sales", data: [{ month: "Jan", sales: 10 }] })}\n\nHope this helps.`;
    session.pushEvent(assistant(text));
    await waitForSessionEventQueue();
    await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 1);

    const rows = await harness.manager.getTimelineRows(agentId);
    const items = getTimelineItems(rows);

    expect(items).toEqual([{ type: "assistant_message", text }]);
  });

  test("T2: does not emit gen_ui when no chisacode-ui fence is present", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    activeHarnasses.push(harness);

    const { agentId, session } = await createManagedSession(harness);
    session.pushEvent(assistant("This is a normal text response with no special fences."));
    await waitForSessionEventQueue();
    await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 1);

    const rows = await harness.manager.getTimelineRows(agentId);
    const items = getTimelineItems(rows);

    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe("assistant_message");
    expect(items.filter((item) => item.type === "generative_ui")).toHaveLength(0);
  });

  test("T3: multiple fences remain in one assistant timeline row", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    activeHarnasses.push(harness);

    const { agentId, session } = await createManagedSession(harness);
    const text = [
      fenceBlock("line_chart", { xAxis: "x", yAxis: "y", data: [] }),
      "some text",
      fenceBlock("bar_chart", { label: "name", value: "count", data: [{ name: "A", count: 5 }] }),
    ].join("\n\n");
    session.pushEvent(assistant(text));
    await waitForSessionEventQueue();
    await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 1);

    const rows = await harness.manager.getTimelineRows(agentId);
    const items = getTimelineItems(rows);
    expect(items).toEqual([{ type: "assistant_message", text }]);
  });

  test("T4: does not emit gen_ui for broken or incomplete fence", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    activeHarnasses.push(harness);

    const { agentId, session } = await createManagedSession(harness);
    // No closing ```
    const broken = '```chisacode-ui component=line_chart\n{"x": 1}';
    session.pushEvent(assistant(broken));
    await waitForSessionEventQueue();
    await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 1);

    const rows = await harness.manager.getTimelineRows(agentId);
    const items = getTimelineItems(rows);

    expect(items).toHaveLength(1);
    expect(items.filter((item) => item.type === "generative_ui")).toHaveLength(0);
  });

  test("T5: a valid fence does not create a second timeline item", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    activeHarnasses.push(harness);

    const { agentId, session } = await createManagedSession(harness);
    const props = {
      title: "Monthly Report",
      columns: [{ key: "name", title: "Name" }],
      rows: [{ name: "Alice" }],
    };
    const text = fenceBlock("table", props);
    session.pushEvent(assistant(text));
    await waitForSessionEventQueue();
    await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 1);

    const rows = await harness.manager.getTimelineRows(agentId);
    const items = getTimelineItems(rows);
    expect(items).toEqual([{ type: "assistant_message", text }]);
  });

  test("T6: fence streaming broadcasts only the assistant timeline event", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    activeHarnasses.push(harness);

    const { agentId, session } = await createManagedSession(harness);
    const text = fenceBlock("form", { fields: [{ name: "email", label: "Email", type: "text" }] });
    session.pushEvent(assistant(text));
    await waitForSessionEventQueue();
    await vi.advanceTimersByTimeAsync(COALESCE_WINDOW_MS + 1);

    const streamEvents = harness.events.filter(
      (event) =>
        event.type === "agent_stream" &&
        event.agentId === agentId &&
        event.event.type === "timeline",
    );
    expect(streamEvents).toHaveLength(1);
    if (streamEvents[0]?.event.type === "timeline") {
      expect(streamEvents[0].event.item).toEqual({ type: "assistant_message", text });
    }
  });
});
