import { describe, expect, it, vi } from "vitest";
import type {
  DaemonClient,
  FetchAgentHistoryEntry,
  FetchAgentHistoryOptions,
} from "@chisacode/client/internal/daemon-client";
import type { ProjectPlacementPayload } from "@chisacode/protocol/messages";
import { type AgentHistoryClient, fetchAgentHistoryPage } from "./use-agent-history";

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => null,
  useHostRuntimeIsConnected: () => false,
  useHosts: () => [],
}));

type FetchAgentHistory = DaemonClient["fetchAgentHistory"];
type FetchAgentHistoryResult = Awaited<ReturnType<FetchAgentHistory>>;

interface FakeAgentHistoryClient extends AgentHistoryClient {
  calls: FetchAgentHistoryOptions[];
}

function createClient(pages: FetchAgentHistoryResult[]): FakeAgentHistoryClient {
  const calls: FetchAgentHistoryOptions[] = [];
  let index = 0;
  return {
    calls,
    fetchAgentHistory: async (options) => {
      calls.push(options ?? {});
      const page = pages[index] ?? pages[pages.length - 1];
      index += 1;
      if (!page) {
        throw new Error("No more history pages configured");
      }
      return page;
    },
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function historyPayload(input: {
  entries: FetchAgentHistoryEntry[];
  hasMore?: boolean;
  nextCursor?: string | null;
}): FetchAgentHistoryResult {
  return {
    requestId: "req_history",
    entries: input.entries,
    pageInfo: {
      nextCursor: input.nextCursor ?? null,
      prevCursor: null,
      hasMore: input.hasMore ?? false,
    },
  };
}

function historyEntry(input: {
  id: string;
  cwd: string;
  updatedAt: string;
  title?: string | null;
  archivedAt?: string | null;
  project?: ProjectPlacementPayload;
}): FetchAgentHistoryEntry {
  const project =
    input.project ??
    ({
      projectKey: input.cwd,
      projectName: "workspace",
      checkout: {
        cwd: input.cwd,
        isGit: false,
        currentBranch: null,
        remoteUrl: null,
        worktreeRoot: null,
        isChisaCodeOwnedWorktree: false,
        mainRepoRoot: null,
      },
    } satisfies ProjectPlacementPayload);
  return {
    agent: {
      id: input.id,
      provider: "codex",
      status: "closed",
      createdAt: input.updatedAt,
      updatedAt: input.updatedAt,
      lastUserMessageAt: null,
      lastError: undefined,
      runtimeInfo: {
        provider: "codex",
        sessionId: null,
      },
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
      title: input.title ?? null,
      cwd: input.cwd,
      model: null,
      thinkingOptionId: null,
      requiresAttention: false,
      attentionReason: null,
      attentionTimestamp: null,
      archivedAt: input.archivedAt ?? null,
      labels: {},
    },
    project,
  };
}

describe("fetchAgentHistoryPage", () => {
  it("requests the first page with the default limit and updated_at descending sort", async () => {
    const client = createClient([
      historyPayload({
        entries: [
          historyEntry({
            id: "history-1",
            cwd: "/repo",
            updatedAt: "2026-04-02T10:00:00.000Z",
            title: "History one",
          }),
        ],
        hasMore: true,
        nextCursor: "cursor-2",
      }),
    ]);

    const page = await fetchAgentHistoryPage({ client, serverId: "server-1", cursor: null });

    expect(client.calls).toEqual([
      {
        sort: [{ key: "updated_at", direction: "desc" }],
        filter: { includeArchived: true },
        page: { limit: 200 },
      } satisfies FetchAgentHistoryOptions,
    ]);
    expect(page.agents.map((agent) => agent.id)).toEqual(["history-1"]);
    expect(page.pageInfo).toEqual({
      nextCursor: "cursor-2",
      prevCursor: null,
      hasMore: true,
    });
  });

  it("can request active-only history for Soft sidebar pagination", async () => {
    const client = createClient([
      historyPayload({
        entries: [
          historyEntry({
            id: "history-active",
            cwd: "/repo",
            updatedAt: "2026-04-02T10:00:00.000Z",
          }),
        ],
      }),
    ]);

    await fetchAgentHistoryPage({
      client,
      serverId: "server-1",
      cursor: null,
      includeArchived: false,
    });

    expect(client.calls).toEqual([
      {
        sort: [{ key: "updated_at", direction: "desc" }],
        filter: { includeArchived: false },
        page: { limit: 200 },
      } satisfies FetchAgentHistoryOptions,
    ]);
  });

  it("passes the cursor when fetching subsequent pages", async () => {
    const client = createClient([
      historyPayload({
        entries: [
          historyEntry({
            id: "history-2",
            cwd: "/repo",
            updatedAt: "2026-04-01T10:00:00.000Z",
            title: "History two",
          }),
        ],
      }),
    ]);

    await fetchAgentHistoryPage({ client, serverId: "server-1", cursor: "cursor-2" });

    expect(client.calls.at(-1)).toEqual({
      sort: [{ key: "updated_at", direction: "desc" }],
      filter: { includeArchived: true },
      page: { limit: 200, cursor: "cursor-2" },
    } satisfies FetchAgentHistoryOptions);
  });

  it("maps daemon history entries into aggregated agents tagged with the requested server", async () => {
    const client = createClient([
      historyPayload({
        entries: [
          historyEntry({
            id: "history-1",
            cwd: "/repo",
            updatedAt: "2026-04-02T10:00:00.000Z",
            title: "History one",
          }),
        ],
      }),
    ]);

    const page = await fetchAgentHistoryPage({ client, serverId: "server-1", cursor: null });

    expect(page.agents).toEqual([
      expect.objectContaining({
        id: "history-1",
        serverId: "server-1",
        serverLabel: "server-1",
        title: "History one",
        cwd: "/repo",
        provider: "codex",
        archivedAt: null,
      }),
    ]);
  });

  it("carries archived entries through with their archivedAt timestamp", async () => {
    const client = createClient([
      historyPayload({
        entries: [
          historyEntry({
            id: "history-archived",
            cwd: "/repo",
            updatedAt: "2026-04-01T10:00:00.000Z",
            archivedAt: "2026-04-01T10:05:00.000Z",
          }),
        ],
      }),
    ]);

    const page = await fetchAgentHistoryPage({ client, serverId: "server-1", cursor: null });

    expect(page.agents[0]?.archivedAt).toEqual(new Date("2026-04-01T10:05:00.000Z"));
  });

  it("preserves project placement for sidebar workspace grouping", async () => {
    const project: ProjectPlacementPayload = {
      projectKey: "C:\\Ai\\sample-desktop",
      projectName: "sample-desktop",
      checkout: {
        cwd: "C:\\Users\\48818\\.chisacode\\worktrees\\hash\\gallant-owl",
        isGit: true,
        currentBranch: "codex/gallant-owl",
        remoteUrl: null,
        worktreeRoot: "C:\\Users\\48818\\.chisacode\\worktrees\\hash\\gallant-owl",
        isChisaCodeOwnedWorktree: true,
        mainRepoRoot: "C:\\Ai\\sample-desktop",
      },
    };
    const client = createClient([
      historyPayload({
        entries: [
          historyEntry({
            id: "history-owned-worktree",
            cwd: "C:\\Users\\48818\\.chisacode\\worktrees\\hash\\gallant-owl",
            updatedAt: "2026-04-01T10:00:00.000Z",
            project,
          }),
        ],
      }),
    ]);

    const page = await fetchAgentHistoryPage({ client, serverId: "server-1", cursor: null });

    expect(page.agents[0]?.projectPlacement).toEqual(project);
  });

  it("coalesces concurrent requests for the same server, cursor, and sort", async () => {
    const deferred = createDeferred<FetchAgentHistoryResult>();
    const calls: FetchAgentHistoryOptions[] = [];
    const client: FakeAgentHistoryClient = {
      calls,
      fetchAgentHistory: async (options) => {
        calls.push(options ?? {});
        return deferred.promise;
      },
    };

    const first = fetchAgentHistoryPage({ client, serverId: "server-1", cursor: null });
    const second = fetchAgentHistoryPage({ client, serverId: "server-1", cursor: null });

    expect(calls).toHaveLength(1);
    deferred.resolve(
      historyPayload({
        entries: [
          historyEntry({
            id: "history-1",
            cwd: "/repo",
            updatedAt: "2026-04-02T10:00:00.000Z",
          }),
        ],
      }),
    );

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({
        agents: [expect.objectContaining({ id: "history-1" })],
      }),
      expect.objectContaining({
        agents: [expect.objectContaining({ id: "history-1" })],
      }),
    ]);
    expect(calls).toHaveLength(1);
  });

  it("does not coalesce different cursors", async () => {
    const client = createClient([historyPayload({ entries: [] }), historyPayload({ entries: [] })]);

    await Promise.all([
      fetchAgentHistoryPage({ client, serverId: "server-1", cursor: null }),
      fetchAgentHistoryPage({ client, serverId: "server-1", cursor: "cursor-2" }),
    ]);

    expect(client.calls).toHaveLength(2);
  });
});
