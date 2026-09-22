import { z } from "zod/v3";

const TimelineAuthorSchema = z
  .object({
    login: z.string().optional(),
    url: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const PullRequestTimelineReviewNodeSchema = z.object({
  id: z.string().catch(""),
  state: z.string().catch(""),
  body: z.string().nullable().catch(null),
  url: z.string().catch(""),
  submittedAt: z.string().nullable().catch(null),
  author: TimelineAuthorSchema,
});

const PullRequestTimelineCommentNodeSchema = z.object({
  id: z.string().catch(""),
  body: z.string().nullable().catch(null),
  url: z.string().catch(""),
  createdAt: z.string().nullable().catch(null),
  author: TimelineAuthorSchema,
});

const PullRequestTimelinePageInfoSchema = z.object({
  hasNextPage: z.boolean().catch(false),
});

const PullRequestTimelineGraphqlSchema = z.object({
  data: z
    .object({
      repository: z
        .object({
          pullRequest: z
            .object({
              number: z.number().optional(),
              reviews: z
                .object({
                  nodes: z.array(PullRequestTimelineReviewNodeSchema).catch([]),
                  pageInfo: PullRequestTimelinePageInfoSchema.catch({ hasNextPage: false }),
                })
                .catch({ nodes: [], pageInfo: { hasNextPage: false } }),
              comments: z
                .object({
                  nodes: z.array(PullRequestTimelineCommentNodeSchema).catch([]),
                  pageInfo: PullRequestTimelinePageInfoSchema.catch({ hasNextPage: false }),
                })
                .catch({ nodes: [], pageInfo: { hasNextPage: false } }),
            })
            .nullable()
            .optional(),
        })
        .nullable()
        .optional(),
    })
    .optional(),
});

const PULL_REQUEST_TIMELINE_QUERY = `
query PullRequestTimeline($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      reviews(first: 100) {
        nodes {
          id
          state
          body
          url
          submittedAt
          author {
            login
            url
          }
        }
        pageInfo {
          hasNextPage
        }
      }
      comments(first: 100) {
        nodes {
          id
          body
          url
          createdAt
          author {
            login
            url
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  }
}`;

interface GitHubPullRequestTimelineInput {
  cwd: string;
  prNumber: number;
  repoOwner: string;
  repoName: string;
}

/** Normalized review state displayed in the pull request timeline. */
export type PullRequestTimelineReviewState = "approved" | "changes_requested" | "commented";

interface PullRequestTimelineItemBase {
  id: string;
  author: string;
  authorUrl: string | null;
  body: string;
  createdAt: number;
  url: string;
}

/** Review or issue-comment activity displayed in the pull request timeline. */
export type PullRequestTimelineItem =
  | (PullRequestTimelineItemBase & {
      kind: "review";
      reviewState: PullRequestTimelineReviewState;
    })
  | (PullRequestTimelineItemBase & {
      kind: "comment";
    });

/** Stable error classification for pull request timeline reads. */
export type GitHubPullRequestTimelineErrorKind = "not_found" | "forbidden" | "unknown";

/** Error returned as part of a pull request timeline payload. */
export interface GitHubPullRequestTimelineError {
  kind: GitHubPullRequestTimelineErrorKind;
  message: string;
}

/** Parsed pull request review and comment activity. */
export interface GitHubPullRequestTimeline {
  prNumber: number;
  repoOwner: string;
  repoName: string;
  items: PullRequestTimelineItem[];
  truncated: boolean;
  error: GitHubPullRequestTimelineError | null;
}

/** Normalized command failure consumed by the timeline authority. */
export type GitHubPullRequestTimelineFailure =
  | { kind: "command"; stderr: string; message: string }
  | { kind: "authentication"; stderr: string; message: string }
  | { kind: "unknown"; message: string };

interface GitHubPullRequestTimelineDependencies {
  run(args: string[], options: { cwd: string }): Promise<string>;
  normalizeFailure(error: unknown): GitHubPullRequestTimelineFailure;
}

/**
 * Loads and normalizes pull request reviews and comments through one bounded GraphQL query.
 * @param input Repository identity, pull request number, and command working directory
 * @param dependencies GitHub command runner and failure normalization boundary
 * @returns Timeline payload with bounded pagination and stable internal errors
 */
export async function loadGitHubPullRequestTimeline(
  input: GitHubPullRequestTimelineInput,
  dependencies: GitHubPullRequestTimelineDependencies,
): Promise<GitHubPullRequestTimeline> {
  try {
    const stdout = await dependencies.run(
      [
        "api",
        "graphql",
        "-f",
        `query=${PULL_REQUEST_TIMELINE_QUERY}`,
        "-F",
        `owner=${input.repoOwner}`,
        "-F",
        `name=${input.repoName}`,
        "-F",
        `number=${input.prNumber}`,
      ],
      { cwd: input.cwd },
    );
    return parsePullRequestTimeline(stdout, input);
  } catch (error) {
    return {
      prNumber: input.prNumber,
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      items: [],
      truncated: false,
      error: mapPullRequestTimelineFailure(dependencies.normalizeFailure(error)),
    };
  }
}

function parsePullRequestTimeline(
  stdout: string,
  identity: { prNumber: number; repoOwner: string; repoName: string },
): GitHubPullRequestTimeline {
  const parsed = PullRequestTimelineGraphqlSchema.parse(JSON.parse(stdout || "{}"));
  const pullRequest = parsed.data?.repository?.pullRequest;
  const items = pullRequest
    ? [
        ...pullRequest.reviews.nodes.flatMap(toPullRequestTimelineReviewItem),
        ...pullRequest.comments.nodes.map(toPullRequestTimelineCommentItem),
      ].sort(compareTimelineItems)
    : [];
  return {
    prNumber: pullRequest?.number ?? identity.prNumber,
    repoOwner: identity.repoOwner,
    repoName: identity.repoName,
    items,
    // The timeline deliberately caps reads at the first 100 reviews and first 100 comments.
    truncated: Boolean(
      pullRequest?.reviews.pageInfo.hasNextPage || pullRequest?.comments.pageInfo.hasNextPage,
    ),
    error: pullRequest ? null : { kind: "not_found", message: "Pull request not found" },
  };
}

function toPullRequestTimelineReviewItem(
  review: z.infer<typeof PullRequestTimelineReviewNodeSchema>,
): PullRequestTimelineItem[] {
  const reviewState = mapTimelineReviewState(review.state, review.body ?? "");
  if (!reviewState) {
    return [];
  }
  return [
    {
      kind: "review",
      id: review.id,
      author: review.author?.login ?? "unknown",
      authorUrl: review.author?.url ?? null,
      body: review.body ?? "",
      createdAt: parseOptionalTime(review.submittedAt ?? null),
      url: review.url,
      reviewState,
    },
  ];
}

function toPullRequestTimelineCommentItem(
  comment: z.infer<typeof PullRequestTimelineCommentNodeSchema>,
): PullRequestTimelineItem {
  return {
    kind: "comment",
    id: comment.id,
    author: comment.author?.login ?? "unknown",
    authorUrl: comment.author?.url ?? null,
    body: comment.body ?? "",
    createdAt: parseOptionalTime(comment.createdAt ?? null),
    url: comment.url,
  };
}

function mapTimelineReviewState(
  state: string,
  body: string,
): PullRequestTimelineReviewState | null {
  switch (state) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "COMMENTED":
      return "commented";
    case "PENDING":
      return null;
    case "DISMISSED":
    default:
      return body.trim().length > 0 ? "commented" : null;
  }
}

function compareTimelineItems(
  left: PullRequestTimelineItem,
  right: PullRequestTimelineItem,
): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt;
  }
  return left.id.localeCompare(right.id);
}

function mapPullRequestTimelineFailure(
  failure: GitHubPullRequestTimelineFailure,
): GitHubPullRequestTimelineError {
  if (failure.kind === "command") {
    return {
      kind: classifyPullRequestTimelineError(failure.stderr),
      message: failure.stderr || failure.message,
    };
  }
  if (failure.kind === "authentication") {
    return {
      kind: "forbidden",
      message: failure.stderr || failure.message,
    };
  }
  return { kind: "unknown", message: failure.message };
}

function classifyPullRequestTimelineError(stderr: string): GitHubPullRequestTimelineErrorKind {
  const normalized = stderr.toLowerCase();
  if (
    normalized.includes("could not resolve to a pullrequest") ||
    normalized.includes("pull request not found") ||
    normalized.includes("pullrequest not found")
  ) {
    return "not_found";
  }
  if (
    normalized.includes("forbidden") ||
    normalized.includes("resource not accessible") ||
    normalized.includes("permission") ||
    normalized.includes("access denied") ||
    normalized.includes("requires authentication") ||
    normalized.includes("http 403")
  ) {
    return "forbidden";
  }
  return "unknown";
}

function parseOptionalTime(timestamp: string | null): number {
  if (!timestamp) {
    return 0;
  }
  const time = Date.parse(timestamp);
  return Number.isNaN(time) ? 0 : time;
}
