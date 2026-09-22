import type { CheckoutPrStatusPayload } from "@/git/use-pr-status-query";

interface ReviewSummaryDiffFile {
  additions: number;
  deletions: number;
}

export type ReviewSummaryChecksStatus = "pending" | "success" | "failure";
export type ReviewSummaryDecision = "approved" | "changes_requested" | "pending";

export interface ReviewSummaryModel {
  changedFileCount: number;
  additions: number;
  deletions: number;
  pullRequestLabel: string | null;
  pullRequestTerminalState: "merged" | "closed" | null;
  checksStatus: ReviewSummaryChecksStatus | null;
  reviewDecision: ReviewSummaryDecision | null;
}

export function buildReviewSummaryModel(input: {
  files: readonly ReviewSummaryDiffFile[];
  pullRequestStatus: CheckoutPrStatusPayload["status"] | null | undefined;
}): ReviewSummaryModel {
  let additions = 0;
  let deletions = 0;
  for (const file of input.files) {
    additions += normalizeLineCount(file.additions);
    deletions += normalizeLineCount(file.deletions);
  }

  const pullRequestNumber =
    normalizePullRequestNumber(input.pullRequestStatus?.number) ??
    parsePullRequestNumber(input.pullRequestStatus?.url);
  const terminalState = resolvePullRequestTerminalState(input.pullRequestStatus);
  return {
    changedFileCount: input.files.length,
    additions,
    deletions,
    pullRequestLabel: pullRequestNumber === null ? null : `#${pullRequestNumber}`,
    pullRequestTerminalState: terminalState,
    checksStatus:
      terminalState === null ? normalizeChecksStatus(input.pullRequestStatus?.checksStatus) : null,
    reviewDecision:
      terminalState === null
        ? normalizeReviewDecision(input.pullRequestStatus?.reviewDecision)
        : null,
  };
}

function normalizeLineCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function normalizeChecksStatus(
  status: string | null | undefined,
): ReviewSummaryChecksStatus | null {
  if (status === "success" || status === "failure" || status === "pending") {
    return status;
  }
  return null;
}

function normalizeReviewDecision(
  decision: string | null | undefined,
): ReviewSummaryDecision | null {
  if (decision === "approved" || decision === "changes_requested" || decision === "pending") {
    return decision;
  }
  return null;
}

function normalizePullRequestNumber(value: number | null | undefined): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  return null;
}

function resolvePullRequestTerminalState(
  status: CheckoutPrStatusPayload["status"] | null | undefined,
): ReviewSummaryModel["pullRequestTerminalState"] {
  if (status?.isMerged) {
    return "merged";
  }
  if (status?.state === "closed") {
    return "closed";
  }
  return null;
}

function parsePullRequestNumber(url: string | null | undefined): number | null {
  if (!url) {
    return null;
  }
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\/pull\/(\d+)(?:\/|$)/);
    if (!match) {
      return null;
    }
    const value = Number.parseInt(match[1], 10);
    return normalizePullRequestNumber(value);
  } catch {
    return null;
  }
}
