import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  checkoutDiffQueryKey,
  checkoutPrStatusQueryKey,
  checkoutStatusQueryKey,
  invalidateCheckoutGitQueriesForClient,
  prPaneTimelineQueryKey,
  normalizeCheckoutCwd,
} from "@/git/query-keys";

describe("checkout query keys", () => {
  const serverId = "server-1";
  const cwd = "/tmp/repo";

  it("normalizes checkout cwd segments in query keys", () => {
    expect(normalizeCheckoutCwd(" C:\\tmp\\repo\\ ")).toBe("C:/tmp/repo");
    expect(checkoutStatusQueryKey(serverId, "/tmp/repo/")).toEqual(
      checkoutStatusQueryKey(serverId, "/tmp/repo"),
    );
  });

  it("invalidates every query for a checkout without touching other checkouts", async () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(checkoutStatusQueryKey(serverId, cwd), { isGit: true });
    queryClient.setQueryData(checkoutDiffQueryKey(serverId, cwd, "base", "main", true), {
      files: [],
    });
    queryClient.setQueryData(checkoutPrStatusQueryKey(serverId, cwd), { status: { number: 12 } });
    queryClient.setQueryData(prPaneTimelineQueryKey({ serverId, cwd, prNumber: 12 }), {
      items: [],
    });
    queryClient.setQueryData(prPaneTimelineQueryKey({ serverId, cwd, prNumber: 13 }), {
      items: [],
    });
    queryClient.setQueryData(
      prPaneTimelineQueryKey({ serverId, cwd: "/tmp/other", prNumber: 12 }),
      { items: [] },
    );

    await invalidateCheckoutGitQueriesForClient(queryClient, { serverId, cwd });

    expect(queryClient.getQueryState(checkoutStatusQueryKey(serverId, cwd))?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(checkoutDiffQueryKey(serverId, cwd, "base", "main", true))
        ?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(checkoutPrStatusQueryKey(serverId, cwd))?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(prPaneTimelineQueryKey({ serverId, cwd, prNumber: 12 }))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(prPaneTimelineQueryKey({ serverId, cwd, prNumber: 13 }))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(
        prPaneTimelineQueryKey({ serverId, cwd: "/tmp/other", prNumber: 12 }),
      )?.isInvalidated,
    ).toBe(false);

    queryClient.clear();
  });

  it("invalidates equivalent cwd spellings for checkout scoped queries", async () => {
    const queryClient = new QueryClient();

    queryClient.setQueryData(checkoutDiffQueryKey(serverId, "C:/tmp/repo", "uncommitted"), {
      files: [],
    });
    queryClient.setQueryData(checkoutPrStatusQueryKey(serverId, "C:/tmp/other"), {
      status: { number: 12 },
    });

    await invalidateCheckoutGitQueriesForClient(queryClient, {
      serverId,
      cwd: "C:\\tmp\\repo\\",
    });

    expect(
      queryClient.getQueryState(checkoutDiffQueryKey(serverId, "C:/tmp/repo", "uncommitted"))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(checkoutPrStatusQueryKey(serverId, "C:/tmp/other"))?.isInvalidated,
    ).toBe(false);

    queryClient.clear();
  });
});
