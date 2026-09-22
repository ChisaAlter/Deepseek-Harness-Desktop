import type { GitHubSearchKind } from "@chisacode/protocol/messages";

/** Cache-control options shared by GitHub read operations. */
export type GitHubReadOptions =
  | {
      force?: false;
      reason?: string;
    }
  | {
      force: true;
      reason: string;
    };

/** Combined issue and pull request search result returned to clients. */
export interface GitHubSearchResult {
  items: Array<{
    kind: "issue" | "pr";
    number: number;
    title: string;
    url: string;
    state: string;
    body: string | null;
    labels: string[];
    baseRefName?: string | null;
    headRefName?: string | null;
    updatedAt?: string;
  }>;
  githubFeaturesEnabled: boolean;
}

/** Input accepted by the combined GitHub issue and pull request search. */
export type SearchGitHubIssuesAndPrsOptions = {
  cwd: string;
  query: string;
  limit?: number;
  kinds?: GitHubSearchKind[];
} & GitHubReadOptions;

interface GitHubSearchIssueSummary {
  number: number;
  title: string;
  url: string;
  state: string;
  body: string | null;
  labels: string[];
  updatedAt: string;
}

interface GitHubSearchPullRequestSummary extends GitHubSearchIssueSummary {
  baseRefName: string;
  headRefName: string;
}

interface GitHubSearchDependencies {
  listIssues(
    options: {
      cwd: string;
      query: string;
      limit: number;
    } & GitHubReadOptions,
  ): Promise<GitHubSearchIssueSummary[]>;
  listPullRequests(
    options: {
      cwd: string;
      query: string;
      limit: number;
    } & GitHubReadOptions,
  ): Promise<GitHubSearchPullRequestSummary[]>;
  isFeatureUnavailableError(error: unknown): boolean;
}

const GITHUB_ISSUE_OR_PR_URL_PATTERN =
  /^https?:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:pull|issues)\/(\d+)(?:[/?#].*)?$/i;
const DEFAULT_GITHUB_SEARCH_LIMIT = 20;

function normalizeGitHubSearchQuery(query: string): string {
  const trimmed = query.trim();
  const urlMatch = GITHUB_ISSUE_OR_PR_URL_PATTERN.exec(trimmed);
  return urlMatch?.[1] ?? query;
}

function toReadOptions(input: SearchGitHubIssuesAndPrsOptions): GitHubReadOptions {
  return input.force
    ? { force: true, reason: input.reason }
    : { force: false, reason: input.reason };
}

function parseUpdatedAt(timestamp: string | undefined): number {
  if (!timestamp) return 0;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Searches issues and pull requests concurrently, then applies one global result limit.
 * @param input Search scope, query, kinds, and cache-control options
 * @param dependencies Cached issue/PR readers and feature availability classification
 * @returns Combined results sorted by update time and capped to the requested limit
 */
export async function searchGitHubIssuesAndPrs(
  input: SearchGitHubIssuesAndPrsOptions,
  dependencies: GitHubSearchDependencies,
): Promise<GitHubSearchResult> {
  if (input.force && !input.reason) {
    throw new Error("GitHubService forced read requires a reason");
  }

  const kinds = input.kinds ?? ["github-issue", "github-pr"];
  const shouldFetchIssues = kinds.includes("github-issue");
  const shouldFetchPullRequests = kinds.includes("github-pr");
  const readOptions = toReadOptions(input);
  const query = normalizeGitHubSearchQuery(input.query);
  const limit = input.limit ?? DEFAULT_GITHUB_SEARCH_LIMIT;
  const [issuesResult, pullRequestsResult] = await Promise.allSettled([
    shouldFetchIssues
      ? dependencies.listIssues({ cwd: input.cwd, query, limit, ...readOptions })
      : Promise.resolve(null),
    shouldFetchPullRequests
      ? dependencies.listPullRequests({ cwd: input.cwd, query, limit, ...readOptions })
      : Promise.resolve(null),
  ]);

  const requestedResults = [
    shouldFetchIssues ? issuesResult : null,
    shouldFetchPullRequests ? pullRequestsResult : null,
  ].filter((result) => result !== null);
  if (
    requestedResults.length > 0 &&
    requestedResults.every(
      (result) =>
        result.status === "rejected" && dependencies.isFeatureUnavailableError(result.reason),
    )
  ) {
    return { items: [], githubFeaturesEnabled: false };
  }

  const items: GitHubSearchResult["items"] = [];
  if (shouldFetchIssues && issuesResult.status === "fulfilled") {
    for (const item of issuesResult.value ?? []) {
      items.push({
        kind: "issue",
        number: item.number,
        title: item.title,
        url: item.url,
        state: item.state,
        body: item.body,
        labels: item.labels,
        baseRefName: null,
        headRefName: null,
        updatedAt: item.updatedAt,
      });
    }
  }

  if (shouldFetchPullRequests && pullRequestsResult.status === "fulfilled") {
    for (const item of pullRequestsResult.value ?? []) {
      items.push({
        kind: "pr",
        number: item.number,
        title: item.title,
        url: item.url,
        state: item.state,
        body: item.body,
        labels: item.labels,
        baseRefName: item.baseRefName,
        headRefName: item.headRefName,
        updatedAt: item.updatedAt,
      });
    }
  }

  items.sort((left, right) => parseUpdatedAt(right.updatedAt) - parseUpdatedAt(left.updatedAt));
  return { items: items.slice(0, limit), githubFeaturesEnabled: true };
}
