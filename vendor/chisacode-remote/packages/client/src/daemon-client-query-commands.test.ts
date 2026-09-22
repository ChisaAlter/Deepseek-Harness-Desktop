import { describe, expect, test } from "vitest";
import type { DaemonCommandTransport } from "./daemon-client-command-transport.js";
import { QueryCommandClient } from "./daemon-client-query-commands.js";

function createHarness() {
  const requests: Array<Parameters<DaemonCommandTransport["request"]>[0]> = [];
  const client = new QueryCommandClient({
    request: async (params) => {
      requests.push(params);
      return {} as never;
    },
  });
  return { client, requests };
}

describe("QueryCommandClient", () => {
  test("maps agent directory pagination and subscription options", async () => {
    const { client, requests } = createHarness();
    await client.fetchAgents({
      requestId: "agents-1",
      scope: "active",
      filter: { query: "codex" },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: 25, cursor: "cursor-1" },
      subscribe: { subscriptionId: "agents-sub" },
    });

    expect(requests).toEqual([
      {
        requestId: "agents-1",
        message: {
          type: "fetch_agents_request",
          scope: "active",
          filter: { query: "codex" },
          sort: [{ key: "updated_at", direction: "desc" }],
          page: { limit: 25, cursor: "cursor-1" },
          subscribe: { subscriptionId: "agents-sub" },
        },
        responseType: "fetch_agents_response",
        timeout: 10_000,
      },
    ]);
  });

  test("preserves explicit provider lists for recent-session discovery", async () => {
    const { client, requests } = createHarness();
    await client.fetchRecentProviderSessions({
      requestId: "recent-1",
      cwd: "/tmp/project",
      providers: [],
      since: "2026-07-01T00:00:00.000Z",
      limit: 50,
    });

    expect(requests[0]).toMatchObject({
      requestId: "recent-1",
      message: {
        type: "fetch_recent_provider_sessions_request",
        cwd: "/tmp/project",
        providers: [],
        since: "2026-07-01T00:00:00.000Z",
        limit: 50,
      },
      responseType: "fetch_recent_provider_sessions_response",
    });
  });

  test("routes usage RPCs through the same correlated transport", async () => {
    const { client, requests } = createHarness();
    await client.fetchUsageSummary({ requestId: "usage-1", rangeDays: 7 });
    await client.exportUsage({ requestId: "usage-2", format: "csv" });
    await client.clearUsage("usage-3");

    expect(requests).toMatchObject([
      {
        requestId: "usage-1",
        message: { type: "usage.summary.get.request", rangeDays: 7 },
        responseType: "usage.summary.get.response",
      },
      {
        requestId: "usage-2",
        message: { type: "usage.export.request", format: "csv" },
        responseType: "usage.export.response",
      },
      {
        requestId: "usage-3",
        message: { type: "usage.clear.request" },
        responseType: "usage.clear.response",
      },
    ]);
  });
});
