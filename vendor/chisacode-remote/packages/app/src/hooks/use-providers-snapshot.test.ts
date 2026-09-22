import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DaemonClient } from "@chisacode/client/internal/daemon-client";
import type { ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";
import {
  applyProvidersSnapshotUpdate,
  fetchProvidersSnapshot,
  providersSnapshotQueryKey,
  refetchProvidersSnapshotIfStale,
  refreshAndApplyProvidersSnapshot,
  type ProvidersSnapshotClient,
  type ProvidersSnapshotUpdateMessage,
} from "./use-providers-snapshot";

type GetProvidersSnapshotResult = Awaited<ReturnType<DaemonClient["getProvidersSnapshot"]>>;
type RefreshProvidersSnapshotResult = Awaited<ReturnType<DaemonClient["refreshProvidersSnapshot"]>>;
type GetProvidersSnapshotOptions = Parameters<DaemonClient["getProvidersSnapshot"]>[0];
type RefreshProvidersSnapshotOptions = Parameters<DaemonClient["refreshProvidersSnapshot"]>[0];

interface FakeProvidersSnapshotClient extends ProvidersSnapshotClient {
  getCalls: GetProvidersSnapshotOptions[];
  refreshCalls: RefreshProvidersSnapshotOptions[];
}

function createClient(
  input: {
    snapshots?: GetProvidersSnapshotResult[];
    refreshResult?: RefreshProvidersSnapshotResult;
  } = {},
): FakeProvidersSnapshotClient {
  const snapshots = [...(input.snapshots ?? [])];
  const refreshResult: RefreshProvidersSnapshotResult = input.refreshResult ?? {
    acknowledged: true,
    requestId: "refresh-1",
  };

  const getCalls: GetProvidersSnapshotOptions[] = [];
  const refreshCalls: RefreshProvidersSnapshotOptions[] = [];

  return {
    getCalls,
    refreshCalls,
    async getProvidersSnapshot(options) {
      getCalls.push(options ?? {});
      const next = snapshots.shift();
      if (!next) {
        throw new Error("No snapshot configured for getProvidersSnapshot call");
      }
      return next;
    },
    async refreshProvidersSnapshot(options) {
      refreshCalls.push(options ?? {});
      return refreshResult;
    },
  };
}

function providersSnapshot(
  entries: ProviderSnapshotEntry[],
  cwd?: string,
): GetProvidersSnapshotResult {
  return {
    ...(cwd ? { cwd } : {}),
    entries,
    generatedAt: "2026-01-01T00:00:00.000Z",
    requestId: "snapshot",
  };
}

function codexEntry(
  status: ProviderSnapshotEntry["status"],
  models?: ProviderSnapshotEntry["models"],
): ProviderSnapshotEntry {
  return {
    provider: "codex",
    status,
    enabled: true,
    ...(models ? { models } : {}),
  };
}

const readyCodexModel = { provider: "codex", id: "gpt-5.4", label: "GPT-5.4" } as const;
const serverId = "server-1";

describe("providersSnapshotQueryKey", () => {
  it("uses separate keys for home and workspace scopes", () => {
    expect(providersSnapshotQueryKey(serverId)).toEqual(["providersSnapshot", serverId, "home"]);
    expect(providersSnapshotQueryKey(serverId, "/repo-a")).toEqual([
      "providersSnapshot",
      serverId,
      "cwd",
      "/repo-a",
    ]);
  });
});

describe("fetchProvidersSnapshot", () => {
  it("sends no cwd for the home scope", async () => {
    const client = createClient({ snapshots: [providersSnapshot([])] });

    await fetchProvidersSnapshot({ client, cwd: null });

    expect(client.getCalls).toEqual([{}]);
  });

  it("sends the workspace cwd for the workspace scope", async () => {
    const client = createClient({ snapshots: [providersSnapshot([])] });

    await fetchProvidersSnapshot({ client, cwd: "/repo-a" });

    expect(client.getCalls).toEqual([{ cwd: "/repo-a" }]);
  });
});

describe("refreshAndApplyProvidersSnapshot", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  it("refreshes then re-fetches the home snapshot and writes it into the home query cache", async () => {
    const client = createClient({
      snapshots: [providersSnapshot([codexEntry("ready", [readyCodexModel])])],
    });

    await refreshAndApplyProvidersSnapshot({
      client,
      queryClient,
      serverId,
      cwd: null,
      providers: ["codex"],
    });

    expect(client.refreshCalls).toEqual([{ providers: ["codex"] }]);
    expect(client.getCalls).toEqual([{}]);
    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId))).toEqual(
      providersSnapshot([codexEntry("ready", [readyCodexModel])]),
    );
  });

  it("stores a pull response under the daemon canonical cwd and requested alias", async () => {
    const client = createClient({
      snapshots: [providersSnapshot([codexEntry("ready")], "/server/repo")],
    });

    await refreshAndApplyProvidersSnapshot({
      client,
      queryClient,
      serverId,
      cwd: "/client/alias",
    });

    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId, "/server/repo"))).toEqual(
      providersSnapshot([codexEntry("ready")], "/server/repo"),
    );
    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId, "/client/alias"))).toEqual(
      providersSnapshot([codexEntry("ready")], "/server/repo"),
    );
    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId))).toBeUndefined();
  });

  it("does not guess the home scope when a workspace pull omits cwd", async () => {
    const client = createClient({ snapshots: [providersSnapshot([codexEntry("ready")])] });

    await refreshAndApplyProvidersSnapshot({
      client,
      queryClient,
      serverId,
      cwd: "/client/alias",
    });

    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId))).toBeUndefined();
    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId, "/client/alias"))).toEqual(
      providersSnapshot([codexEntry("ready")]),
    );
  });

  it("invalidates every scope under the server when refreshing the home snapshot", async () => {
    const client = createClient({ snapshots: [providersSnapshot([])] });
    queryClient.setQueryData(providersSnapshotQueryKey(serverId, "/repo-a"), providersSnapshot([]));
    queryClient.setQueryData(providersSnapshotQueryKey(serverId, "/repo-b"), providersSnapshot([]));

    await refreshAndApplyProvidersSnapshot({
      client,
      queryClient,
      serverId,
      cwd: null,
    });

    expect(
      queryClient.getQueryState(providersSnapshotQueryKey(serverId, "/repo-a"))?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(providersSnapshotQueryKey(serverId, "/repo-b"))?.isInvalidated,
    ).toBe(true);
  });

  it("does not invalidate sibling scopes when refreshing a workspace snapshot", async () => {
    const client = createClient({ snapshots: [providersSnapshot([])] });
    queryClient.setQueryData(providersSnapshotQueryKey(serverId), providersSnapshot([]));
    queryClient.setQueryData(providersSnapshotQueryKey(serverId, "/repo-b"), providersSnapshot([]));

    await refreshAndApplyProvidersSnapshot({
      client,
      queryClient,
      serverId,
      cwd: "/repo-a",
    });

    expect(queryClient.getQueryState(providersSnapshotQueryKey(serverId))?.isInvalidated).toBe(
      false,
    );
    expect(
      queryClient.getQueryState(providersSnapshotQueryKey(serverId, "/repo-b"))?.isInvalidated,
    ).toBe(false);
  });
});

describe("applyProvidersSnapshotUpdate", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  function updateMessage(
    entries: ProviderSnapshotEntry[],
    cwd?: string,
  ): ProvidersSnapshotUpdateMessage {
    return {
      type: "providers_snapshot_update",
      payload: {
        ...(cwd ? { cwd } : {}),
        entries,
        generatedAt: "2026-01-01T00:00:01.000Z",
      },
    };
  }

  it("routes updates to the home query cache when the message carries no cwd", () => {
    applyProvidersSnapshotUpdate({
      serverId,
      queryClient,
      message: updateMessage([codexEntry("ready", [readyCodexModel])]),
    });

    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId))).toEqual({
      entries: [codexEntry("ready", [readyCodexModel])],
      generatedAt: "2026-01-01T00:00:01.000Z",
      requestId: "providers_snapshot_update",
    });
  });

  it("routes workspace pushes to the canonical scope and optional alias", () => {
    applyProvidersSnapshotUpdate({
      serverId,
      queryClient,
      aliasCwd: "/client/alias",
      message: updateMessage([codexEntry("ready")], "/server/repo"),
    });

    const expected = {
      cwd: "/server/repo",
      entries: [codexEntry("ready")],
      generatedAt: "2026-01-01T00:00:01.000Z",
      requestId: "providers_snapshot_update",
    };
    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId, "/server/repo"))).toEqual(
      expected,
    );
    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId, "/client/alias"))).toEqual(
      expected,
    );
    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId))).toBeUndefined();
  });

  it("does not write a workspace alias into home for a cwd-less push", () => {
    applyProvidersSnapshotUpdate({
      serverId,
      queryClient,
      aliasCwd: "/client/alias",
      message: updateMessage([codexEntry("ready")]),
    });

    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId))).toEqual({
      entries: [codexEntry("ready")],
      generatedAt: "2026-01-01T00:00:01.000Z",
      requestId: "providers_snapshot_update",
    });
    expect(
      queryClient.getQueryData(providersSnapshotQueryKey(serverId, "/client/alias")),
    ).toBeUndefined();
  });
});

describe("refetchProvidersSnapshotIfStale", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  it("refetches only active snapshot queries and only when stale", async () => {
    const queryKey = providersSnapshotQueryKey(serverId);
    const queryFn = vi.fn(async () => providersSnapshot([codexEntry("ready", [readyCodexModel])]));
    const observer = new QueryObserver(queryClient, { queryKey, queryFn, staleTime: 60_000 });
    const unsubscribe = observer.subscribe(() => {});
    try {
      // Initial mount fetch.
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));

      // Fresh data: opening the selector must not trigger any request.
      await refetchProvidersSnapshotIfStale(queryClient, queryKey);
      expect(queryFn).toHaveBeenCalledTimes(1);

      // Stale data: opening the selector triggers a plain read refetch, never a refresh RPC.
      queryClient.setQueryData(queryKey, (previous) => previous, { updatedAt: 0 });
      await refetchProvidersSnapshotIfStale(queryClient, queryKey);
      await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    } finally {
      unsubscribe();
    }
  });

  it("does not refetch inactive queries even when stale", async () => {
    const queryKey = providersSnapshotQueryKey(serverId, "/repo-a");
    const queryFn = vi.fn(async () => providersSnapshot([]));
    await queryClient.fetchQuery({ queryKey, queryFn, staleTime: 60_000 });
    queryClient.invalidateQueries({ queryKey });
    queryFn.mockClear();

    await refetchProvidersSnapshotIfStale(queryClient, queryKey);

    expect(queryFn).not.toHaveBeenCalled();
  });
});
