import { QueryClient } from "@tanstack/react-query";
import type { CheckoutPrStatusResponse, CheckoutStatusUpdate } from "@chisacode/protocol/messages";
import { describe, expect, it } from "vitest";
import { checkoutPrStatusQueryKey } from "@/git/query-keys";
import { applyCheckoutPrStatusUpdate, type CheckoutPrStatusPayload } from "./pr-status-cache";

const serverId = "server-1";
const cwd = "/repo";
type PullRequestStatus = NonNullable<CheckoutPrStatusResponse["payload"]["status"]>;

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function pullRequestStatus(overrides: Partial<PullRequestStatus> = {}): PullRequestStatus {
  return {
    number: 42,
    url: "https://github.com/getchisacode/chisacode/pull/42",
    title: "Tighten review flow",
    state: "open",
    baseRefName: "main",
    headRefName: "feature/review-flow",
    isMerged: false,
    isDraft: false,
    mergeable: "MERGEABLE",
    checks: [],
    checksStatus: "success",
    reviewDecision: "approved",
    ...overrides,
  };
}

function prStatus({
  status,
  ...overrides
}: Partial<CheckoutPrStatusPayload> = {}): CheckoutPrStatusPayload {
  return {
    cwd,
    status: status === undefined ? pullRequestStatus() : status,
    githubFeaturesEnabled: true,
    error: null,
    requestId: "pr-status-1",
    ...overrides,
  };
}

function checkoutStatusUpdate(prStatusPayload?: CheckoutPrStatusPayload): CheckoutStatusUpdate {
  return {
    type: "checkout_status_update",
    payload: {
      cwd,
      error: null,
      requestId: "checkout-status-1",
      isGit: true,
      isChisaCodeOwnedWorktree: false,
      repoRoot: cwd,
      mainRepoRoot: null,
      currentBranch: "main",
      isDirty: false,
      baseRef: "origin/main",
      aheadBehind: { ahead: 0, behind: 0 },
      aheadOfOrigin: 0,
      behindOfOrigin: 0,
      hasRemote: true,
      remoteUrl: "git@github.com:getchisacode/chisacode.git",
      ...(prStatusPayload ? { prStatus: prStatusPayload } : {}),
    },
  };
}

describe("applyCheckoutPrStatusUpdate", () => {
  it("writes pushed PR status into the cache key for the matching cwd", () => {
    const queryClient = createQueryClient();
    const pushed = prStatus({
      requestId: "server-push",
      status: pullRequestStatus({
        checksStatus: "pending",
        reviewDecision: "pending",
      }),
    });

    applyCheckoutPrStatusUpdate({
      queryClient,
      serverId,
      cwd,
      message: checkoutStatusUpdate(pushed),
    });

    expect(queryClient.getQueryData(checkoutPrStatusQueryKey(serverId, cwd))).toEqual(pushed);
  });

  it("ignores pushed checkout updates without PR status metadata", () => {
    const queryClient = createQueryClient();

    applyCheckoutPrStatusUpdate({
      queryClient,
      serverId,
      cwd,
      message: checkoutStatusUpdate(),
    });

    expect(queryClient.getQueryData(checkoutPrStatusQueryKey(serverId, cwd))).toBeUndefined();
  });

  it("ignores PR status updates whose cwd does not match the subscribed cwd", () => {
    const queryClient = createQueryClient();
    const otherCwd = "/other-repo";
    const otherCached = prStatus({
      cwd: otherCwd,
      requestId: "other-cached",
    });
    queryClient.setQueryData(checkoutPrStatusQueryKey(serverId, otherCwd), otherCached);

    applyCheckoutPrStatusUpdate({
      queryClient,
      serverId,
      cwd,
      message: checkoutStatusUpdate(
        prStatus({
          cwd: otherCwd,
          requestId: "server-push",
        }),
      ),
    });

    expect(queryClient.getQueryData(checkoutPrStatusQueryKey(serverId, cwd))).toBeUndefined();
    expect(queryClient.getQueryData(checkoutPrStatusQueryKey(serverId, otherCwd))).toEqual(
      otherCached,
    );
  });

  it("applies PR status updates across equivalent cwd spellings", () => {
    const queryClient = createQueryClient();
    const pushed = prStatus({
      cwd: "C:\\repo\\",
      requestId: "server-push-normalized",
    });

    applyCheckoutPrStatusUpdate({
      queryClient,
      serverId,
      cwd: "C:/repo",
      message: checkoutStatusUpdate(pushed),
    });

    expect(queryClient.getQueryData(checkoutPrStatusQueryKey(serverId, "C:/repo"))).toEqual(pushed);
  });
});
