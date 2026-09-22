import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { agentHistoryQueryKey } from "@/hooks/agent-history-query-key";
import {
  getSidebarAgentLabelCacheSnapshot,
  patchAgentLabelsInHistoryPayload,
  patchAgentLabelsInListPayload,
  patchAgentLabelsInSidebarCaches,
  restoreSidebarAgentLabelCacheSnapshot,
  type AgentHistoryCachePayload,
  type AgentListCachePayload,
} from "./sidebar-agent-label-cache";

describe("sidebar agent label cache helpers", () => {
  it("patches matching list entries and leaves other agents alone", () => {
    const payload: AgentListCachePayload = {
      entries: [
        { agent: { id: "a1", labels: { keep: "1" } } },
        { agent: { id: "a2", labels: { other: "x" } } },
        { agent: null },
      ],
    };

    const next = patchAgentLabelsInListPayload(payload, {
      agentId: "a1",
      labels: { "chisacode.sidebarPinned": "true", keep: "2" },
    });

    expect(next).not.toBe(payload);
    expect(next?.entries?.[0]?.agent?.labels).toEqual({
      keep: "2",
      "chisacode.sidebarPinned": "true",
    });
    expect(next?.entries?.[1]?.agent?.labels).toEqual({ other: "x" });
  });

  it("returns the same list payload reference when nothing matches", () => {
    const payload: AgentListCachePayload = {
      entries: [{ agent: { id: "a2", labels: { other: "x" } } }],
    };
    const next = patchAgentLabelsInListPayload(payload, {
      agentId: "missing",
      labels: { "chisacode.sidebarPinned": "true" },
    });
    expect(next).toBe(payload);
  });

  it("patches matching history pages and leaves other agents alone", () => {
    const payload: AgentHistoryCachePayload = {
      pages: [
        {
          agents: [
            { id: "a1", labels: { keep: "1" } },
            { id: "a2", labels: { other: "x" } },
          ],
        },
        { agents: [{ id: "a3", labels: {} }] },
      ],
    };

    const next = patchAgentLabelsInHistoryPayload(payload, {
      agentId: "a1",
      labels: { "chisacode.sidebarSnoozedUntil": "2026-08-11T00:00:00.000Z" },
    });

    expect(next).not.toBe(payload);
    expect(next?.pages?.[0]?.agents?.[0]?.labels).toEqual({
      keep: "1",
      "chisacode.sidebarSnoozedUntil": "2026-08-11T00:00:00.000Z",
    });
    expect(next?.pages?.[0]?.agents?.[1]?.labels).toEqual({ other: "x" });
    expect(next?.pages?.[1]?.agents?.[0]?.labels).toEqual({});
  });

  it("returns the same history payload reference when nothing matches", () => {
    const payload: AgentHistoryCachePayload = {
      pages: [{ agents: [{ id: "a2", labels: { other: "x" } }] }],
    };
    const next = patchAgentLabelsInHistoryPayload(payload, {
      agentId: "missing",
      labels: { "chisacode.sidebarSettledAt": "2026-08-10T00:00:00.000Z" },
    });
    expect(next).toBe(payload);
  });

  it("patches all three sidebar caches and can restore a snapshot", () => {
    const queryClient = new QueryClient();
    const serverId = "server-a";
    const listPayload: AgentListCachePayload = {
      entries: [{ agent: { id: "a1", labels: { keep: "1" } } }],
    };
    const historyPayload: AgentHistoryCachePayload = {
      pages: [{ agents: [{ id: "a1", labels: { keep: "1" } }] }],
    };

    queryClient.setQueryData(["sidebarAgentsList", serverId], listPayload);
    queryClient.setQueryData(["allAgents", serverId], listPayload);
    queryClient.setQueryData(
      agentHistoryQueryKey(serverId, { includeArchived: false }),
      historyPayload,
    );

    const snapshot = getSidebarAgentLabelCacheSnapshot(queryClient, serverId);
    expect(snapshot.sidebarAgentsList).toEqual(listPayload);
    expect(snapshot.allAgents).toEqual(listPayload);
    expect(snapshot.agentHistory).toEqual(historyPayload);

    patchAgentLabelsInSidebarCaches(queryClient, {
      serverId,
      agentId: "a1",
      labels: {
        "chisacode.sidebarSettledAt": "2026-08-10T12:00:00.000Z",
        "chisacode.sidebarSettledOverride": "settled",
      },
    });

    expect(
      queryClient.getQueryData<{
        entries?: Array<{ agent?: { labels?: Record<string, string> } }>;
      }>(["sidebarAgentsList", serverId])?.entries?.[0]?.agent?.labels,
    ).toEqual({
      keep: "1",
      "chisacode.sidebarSettledAt": "2026-08-10T12:00:00.000Z",
      "chisacode.sidebarSettledOverride": "settled",
    });
    expect(
      queryClient.getQueryData<{
        pages?: Array<{ agents?: Array<{ labels?: Record<string, string> }> }>;
      }>(agentHistoryQueryKey(serverId, { includeArchived: false }))?.pages?.[0]?.agents?.[0]
        ?.labels,
    ).toEqual({
      keep: "1",
      "chisacode.sidebarSettledAt": "2026-08-10T12:00:00.000Z",
      "chisacode.sidebarSettledOverride": "settled",
    });

    restoreSidebarAgentLabelCacheSnapshot(queryClient, serverId, snapshot);

    expect(queryClient.getQueryData(["sidebarAgentsList", serverId])).toEqual(listPayload);
    expect(queryClient.getQueryData(["allAgents", serverId])).toEqual(listPayload);
    expect(
      queryClient.getQueryData(agentHistoryQueryKey(serverId, { includeArchived: false })),
    ).toEqual(historyPayload);
  });
});
