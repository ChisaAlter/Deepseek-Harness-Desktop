import { describe, expect, it } from "vitest";
import type { CheckoutPrStatusResponse } from "@chisacode/protocol/messages";
import { buildReviewSummaryModel } from "./review-summary";

type CheckoutPrStatus = NonNullable<CheckoutPrStatusResponse["payload"]["status"]>;

const basePullRequestStatus: CheckoutPrStatus = {
  number: 42,
  url: "https://github.com/acme/project/pull/42",
  title: "Review flow",
  state: "open",
  baseRefName: "main",
  headRefName: "feature/review",
  isMerged: false,
  isDraft: false,
  mergeable: "UNKNOWN",
  checks: [],
  reviewDecision: null,
};

function file(input: { additions: number; deletions: number }) {
  return {
    additions: input.additions,
    deletions: input.deletions,
  };
}

describe("buildReviewSummaryModel", () => {
  it("summarizes changed files and line stats", () => {
    expect(
      buildReviewSummaryModel({
        files: [file({ additions: 2, deletions: 1 }), file({ additions: 4, deletions: 0 })],
        pullRequestStatus: null,
      }),
    ).toEqual({
      changedFileCount: 2,
      additions: 6,
      deletions: 1,
      pullRequestLabel: null,
      pullRequestTerminalState: null,
      checksStatus: null,
      reviewDecision: null,
    });
  });

  it("normalizes invalid line stats before summarizing", () => {
    expect(
      buildReviewSummaryModel({
        files: [
          file({ additions: -2, deletions: Number.POSITIVE_INFINITY }),
          file({ additions: 3.8, deletions: Number.NaN }),
        ],
        pullRequestStatus: null,
      }),
    ).toMatchObject({
      changedFileCount: 2,
      additions: 3,
      deletions: 0,
    });
  });

  it("adds pull request status labels when available", () => {
    expect(
      buildReviewSummaryModel({
        files: [],
        pullRequestStatus: {
          ...basePullRequestStatus,
          checksStatus: "pending",
          reviewDecision: "changes_requested",
        },
      }),
    ).toMatchObject({
      pullRequestLabel: "#42",
      checksStatus: "pending",
      reviewDecision: "changes_requested",
    });
  });

  it("prefers the structured pull request number over parsing the URL", () => {
    expect(
      buildReviewSummaryModel({
        files: [],
        pullRequestStatus: {
          ...basePullRequestStatus,
          number: 84,
          url: "not a pull request url",
        },
      }),
    ).toMatchObject({
      pullRequestLabel: "#84",
    });
  });

  it("does not show a pull request label when the number and URL are invalid", () => {
    expect(
      buildReviewSummaryModel({
        files: [],
        pullRequestStatus: {
          ...basePullRequestStatus,
          number: 0,
          url: "not a pull request url",
        },
      }),
    ).toMatchObject({
      pullRequestLabel: null,
    });
  });

  it("only parses positive pull request numbers from URLs", () => {
    expect(
      buildReviewSummaryModel({
        files: [],
        pullRequestStatus: {
          ...basePullRequestStatus,
          number: 0,
          url: "https://github.com/acme/project/pull/0",
        },
      }),
    ).toMatchObject({
      pullRequestLabel: null,
    });
    expect(
      buildReviewSummaryModel({
        files: [],
        pullRequestStatus: {
          ...basePullRequestStatus,
          number: 0,
          url: "https://github.com/acme/project/pull/91",
        },
      }),
    ).toMatchObject({
      pullRequestLabel: "#91",
    });
  });

  it("ignores unknown pull request status values", () => {
    expect(
      buildReviewSummaryModel({
        files: [],
        pullRequestStatus: {
          ...basePullRequestStatus,
          checksStatus: "queued",
          reviewDecision: "commented",
        },
      }),
    ).toMatchObject({
      checksStatus: null,
      reviewDecision: null,
    });
  });

  it("lets pull request terminal states override stale checks and review decisions", () => {
    expect(
      buildReviewSummaryModel({
        files: [],
        pullRequestStatus: {
          ...basePullRequestStatus,
          isMerged: true,
          checksStatus: "failure",
          reviewDecision: "changes_requested",
        },
      }),
    ).toMatchObject({
      pullRequestTerminalState: "merged",
      checksStatus: null,
      reviewDecision: null,
    });
    expect(
      buildReviewSummaryModel({
        files: [],
        pullRequestStatus: {
          ...basePullRequestStatus,
          state: "closed",
          checksStatus: "pending",
          reviewDecision: "pending",
        },
      }),
    ).toMatchObject({
      pullRequestTerminalState: "closed",
      checksStatus: null,
      reviewDecision: null,
    });
  });
});
