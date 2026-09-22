import { z } from "zod/v3";

const CheckoutErrorCodeSchema = z.enum([
  "NOT_GIT_REPO",
  "NOT_ALLOWED",
  "MERGE_CONFLICT",
  "UNKNOWN",
]);

export const CheckoutErrorSchema = z.object({
  code: CheckoutErrorCodeSchema,
  message: z.string(),
});

const CheckoutDiffCompareSchema = z.object({
  mode: z.enum(["uncommitted", "base"]),
  baseRef: z.string().optional(),
  ignoreWhitespace: z.boolean().optional(),
});

export const CheckoutStatusRequestSchema = z.object({
  type: z.literal("checkout_status_request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const SubscribeCheckoutDiffRequestSchema = z.object({
  type: z.literal("subscribe_checkout_diff_request"),
  subscriptionId: z.string(),
  cwd: z.string(),
  compare: CheckoutDiffCompareSchema,
  requestId: z.string(),
});

export const UnsubscribeCheckoutDiffRequestSchema = z.object({
  type: z.literal("unsubscribe_checkout_diff_request"),
  subscriptionId: z.string(),
});

export const CheckoutCommitRequestSchema = z.object({
  type: z.literal("checkout_commit_request"),
  cwd: z.string(),
  message: z.string().optional(),
  addAll: z.boolean().optional(),
  requestId: z.string(),
});

export const CheckoutMergeRequestSchema = z.object({
  type: z.literal("checkout_merge_request"),
  cwd: z.string(),
  baseRef: z.string().optional(),
  strategy: z.enum(["merge", "squash"]).optional(),
  requireCleanTarget: z.boolean().optional(),
  requestId: z.string(),
});

export const CheckoutMergeFromBaseRequestSchema = z.object({
  type: z.literal("checkout_merge_from_base_request"),
  cwd: z.string(),
  baseRef: z.string().optional(),
  requireCleanTarget: z.boolean().optional(),
  requestId: z.string(),
});

export const CheckoutPullRequestSchema = z.object({
  type: z.literal("checkout_pull_request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const CheckoutPushRequestSchema = z.object({
  type: z.literal("checkout_push_request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const CheckoutRefreshRequestSchema = z.object({
  type: z.literal("checkout.refresh.request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const CheckoutPrCreateRequestSchema = z.object({
  type: z.literal("checkout_pr_create_request"),
  cwd: z.string(),
  title: z.string().optional(),
  body: z.string().optional(),
  baseRef: z.string().optional(),
  requestId: z.string(),
});

export const CheckoutPrMergeRequestSchema = z.object({
  type: z.literal("checkout_pr_merge_request"),
  cwd: z.string(),
  mergeMethod: z.enum(["merge", "squash", "rebase"]),
  requestId: z.string(),
});

export const CheckoutGithubSetAutoMergeRequestSchema = z.object({
  type: z.literal("checkout.github.set_auto_merge.request"),
  cwd: z.string(),
  enabled: z.boolean(),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).optional(),
  requestId: z.string(),
});

export const CheckoutPrStatusRequestSchema = z.object({
  type: z.literal("checkout_pr_status_request"),
  cwd: z.string(),
  requestId: z.string(),
});

export const PullRequestTimelineRequestSchema = z.object({
  type: z.literal("pull_request_timeline_request"),
  cwd: z.string(),
  prNumber: z.number(),
  repoOwner: z.string(),
  repoName: z.string(),
  requestId: z.string(),
});

export const ValidateBranchRequestSchema = z.object({
  type: z.literal("validate_branch_request"),
  cwd: z.string(),
  branchName: z.string(),
  requestId: z.string(),
});

export const CheckoutSwitchBranchRequestSchema = z.object({
  type: z.literal("checkout_switch_branch_request"),
  cwd: z.string(),
  branch: z.string(),
  requestId: z.string(),
});

export const CheckoutRenameBranchRequestSchema = z.object({
  type: z.literal("checkout.rename_branch.request"),
  cwd: z.string(),
  branch: z.string(),
  requestId: z.string(),
});

export const StashSaveRequestSchema = z.object({
  type: z.literal("stash_save_request"),
  cwd: z.string(),
  /** Branch name to tag the stash with for later identification. */
  branch: z.string().optional(),
  requestId: z.string(),
});

export const StashPopRequestSchema = z.object({
  type: z.literal("stash_pop_request"),
  cwd: z.string(),
  /** Zero-based index from stash_list_response. */
  stashIndex: z.number().int().min(0),
  requestId: z.string(),
});

export const StashListRequestSchema = z.object({
  type: z.literal("stash_list_request"),
  cwd: z.string(),
  /** If true, only return chisacode-created stashes. Default true. */
  chisacodeOnly: z.boolean().optional(),
  requestId: z.string(),
});

export const BranchSuggestionsRequestSchema = z.object({
  type: z.literal("branch_suggestions_request"),
  cwd: z.string(),
  query: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  requestId: z.string(),
});

export const GitHubSearchItemSchema = z.object({
  kind: z.enum(["issue", "pr"]),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  body: z.string().nullable(),
  labels: z.array(z.string()),
  baseRefName: z.string().nullable().optional(),
  headRefName: z.string().nullable().optional(),
  updatedAt: z.string().optional(),
});

export const GitHubSearchKindSchema = z.enum(["github-issue", "github-pr"]);

export const GitHubSearchRequestSchema = z.object({
  type: z.literal("github_search_request"),
  cwd: z.string(),
  query: z.string(),
  limit: z.number().int().min(1).max(50).optional(),
  kinds: z.array(GitHubSearchKindSchema).optional(),
  requestId: z.string(),
});

// Highlighted diff token schema
// Note: style can be a compound class name (e.g., "heading meta") from the syntax highlighter
const HighlightTokenSchema = z.object({
  text: z.string(),
  style: z.string().nullable(),
});

const DiffLineSchema = z.object({
  type: z.enum(["add", "remove", "context", "header"]),
  content: z.string(),
  tokens: z.array(HighlightTokenSchema).optional(),
});

const DiffHunkSchema = z.object({
  oldStart: z.number(),
  oldCount: z.number(),
  newStart: z.number(),
  newCount: z.number(),
  lines: z.array(DiffLineSchema),
});

const ParsedDiffFileSchema = z.object({
  path: z.string(),
  isNew: z.boolean(),
  isDeleted: z.boolean(),
  additions: z.number(),
  deletions: z.number(),
  hunks: z.array(DiffHunkSchema),
  status: z.enum(["ok", "too_large", "binary"]).optional(),
});

const AheadBehindSchema = z.object({
  ahead: z.number(),
  behind: z.number(),
});

const CheckoutStatusCommonSchema = z.object({
  cwd: z.string(),
  error: CheckoutErrorSchema.nullable(),
  requestId: z.string(),
});

const CheckoutStatusNotGitSchema = CheckoutStatusCommonSchema.extend({
  isGit: z.literal(false),
  isChisaCodeOwnedWorktree: z.literal(false),
  repoRoot: z.null(),
  currentBranch: z.null(),
  isDirty: z.null(),
  baseRef: z.null(),
  aheadBehind: z.null(),
  aheadOfOrigin: z.null(),
  behindOfOrigin: z.null(),
  hasRemote: z.boolean(),
  remoteUrl: z.null(),
});

const CheckoutStatusGitNonChisaCodeSchema = CheckoutStatusCommonSchema.extend({
  isGit: z.literal(true),
  isChisaCodeOwnedWorktree: z.literal(false),
  repoRoot: z.string(),
  mainRepoRoot: z.string().nullable().optional().default(null),
  currentBranch: z.string().nullable(),
  isDirty: z.boolean(),
  baseRef: z.string().nullable(),
  aheadBehind: AheadBehindSchema.nullable(),
  aheadOfOrigin: z.number().nullable(),
  behindOfOrigin: z.number().nullable(),
  hasRemote: z.boolean(),
  remoteUrl: z.string().nullable(),
});

const CheckoutStatusGitChisaCodeSchema = CheckoutStatusCommonSchema.extend({
  isGit: z.literal(true),
  isChisaCodeOwnedWorktree: z.literal(true),
  repoRoot: z.string(),
  mainRepoRoot: z.string(),
  currentBranch: z.string().nullable(),
  isDirty: z.boolean(),
  baseRef: z.string(),
  aheadBehind: AheadBehindSchema.nullable(),
  aheadOfOrigin: z.number().nullable(),
  behindOfOrigin: z.number().nullable(),
  hasRemote: z.boolean(),
  remoteUrl: z.string().nullable(),
});

export const CheckoutStatusResponseSchema = z.object({
  type: z.literal("checkout_status_response"),
  payload: z.union([
    CheckoutStatusNotGitSchema,
    CheckoutStatusGitNonChisaCodeSchema,
    CheckoutStatusGitChisaCodeSchema,
  ]),
});

const CheckoutPrGithubAutoMergeRequestSchema = z
  .object({
    enabledAt: z.string().nullable().optional().default(null),
    mergeMethod: z.string().nullable().optional().default(null),
    enabledBy: z.string().nullable().optional().default(null),
  })
  .nullable()
  .optional()
  .default(null);

const CheckoutPrGithubRepositoryPolicySchema = z
  .object({
    autoMergeAllowed: z.boolean().optional().default(false),
    mergeCommitAllowed: z.boolean().optional().default(false),
    squashMergeAllowed: z.boolean().optional().default(false),
    rebaseMergeAllowed: z.boolean().optional().default(false),
    viewerDefaultMergeMethod: z.string().nullable().optional().default(null),
  })
  .optional()
  .default({
    autoMergeAllowed: false,
    mergeCommitAllowed: false,
    squashMergeAllowed: false,
    rebaseMergeAllowed: false,
    viewerDefaultMergeMethod: null,
  });

const CheckoutPrGithubStatusSchema = z
  .object({
    mergeStateStatus: z.string().nullable().optional().default(null),
    autoMergeRequest: CheckoutPrGithubAutoMergeRequestSchema,
    viewerCanEnableAutoMerge: z.boolean().optional().default(false),
    viewerCanDisableAutoMerge: z.boolean().optional().default(false),
    viewerCanMergeAsAdmin: z.boolean().optional().default(false),
    viewerCanUpdateBranch: z.boolean().optional().default(false),
    repository: CheckoutPrGithubRepositoryPolicySchema,
    isMergeQueueEnabled: z.boolean().optional().default(false),
    isInMergeQueue: z.boolean().optional().default(false),
  })
  .optional();

export const CheckoutPrStatusSchema = z.object({
  number: z.number().optional(),
  url: z.string(),
  title: z.string(),
  state: z.string(),
  baseRefName: z.string(),
  headRefName: z.string(),
  isMerged: z.boolean(),
  isDraft: z.boolean().optional().default(false),
  mergeable: z
    .enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"])
    .catch("UNKNOWN")
    .optional()
    .default("UNKNOWN"),
  checks: z
    .array(
      z.object({
        name: z.string(),
        status: z.string(),
        url: z.string().nullable(),
        workflow: z.string().optional(),
        duration: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
  checksStatus: z.string().optional(),
  reviewDecision: z.string().nullable().optional(),
  repoOwner: z.string().optional(),
  repoName: z.string().optional(),
  github: CheckoutPrGithubStatusSchema,
});

const CheckoutPrStatusPayloadSchema = z.object({
  cwd: z.string(),
  status: CheckoutPrStatusSchema.nullable(),
  githubFeaturesEnabled: z.boolean(),
  error: CheckoutErrorSchema.nullable(),
  requestId: z.string(),
});

const CheckoutStatusUpdateMetadataSchema = z.object({
  prStatus: CheckoutPrStatusPayloadSchema.optional(),
});

export const CheckoutStatusUpdateSchema = z.object({
  type: z.literal("checkout_status_update"),
  payload: z
    .union([
      CheckoutStatusNotGitSchema,
      CheckoutStatusGitNonChisaCodeSchema,
      CheckoutStatusGitChisaCodeSchema,
    ])
    .and(CheckoutStatusUpdateMetadataSchema),
});

const CheckoutDiffSubscriptionPayloadSchema = z.object({
  subscriptionId: z.string(),
  cwd: z.string(),
  files: z.array(ParsedDiffFileSchema),
  error: CheckoutErrorSchema.nullable(),
});

export const SubscribeCheckoutDiffResponseSchema = z.object({
  type: z.literal("subscribe_checkout_diff_response"),
  payload: CheckoutDiffSubscriptionPayloadSchema.extend({
    requestId: z.string(),
  }),
});

export const CheckoutDiffUpdateSchema = z.object({
  type: z.literal("checkout_diff_update"),
  payload: CheckoutDiffSubscriptionPayloadSchema,
});

export const CheckoutCommitResponseSchema = z.object({
  type: z.literal("checkout_commit_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutMergeResponseSchema = z.object({
  type: z.literal("checkout_merge_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutMergeFromBaseResponseSchema = z.object({
  type: z.literal("checkout_merge_from_base_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutPullResponseSchema = z.object({
  type: z.literal("checkout_pull_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutPushResponseSchema = z.object({
  type: z.literal("checkout_push_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutRefreshResponseSchema = z.object({
  type: z.literal("checkout.refresh.response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutPrCreateResponseSchema = z.object({
  type: z.literal("checkout_pr_create_response"),
  payload: z.object({
    cwd: z.string(),
    url: z.string().nullable(),
    number: z.number().nullable(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutPrMergeResponseSchema = z.object({
  type: z.literal("checkout_pr_merge_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutGithubSetAutoMergeResponseSchema = z.object({
  type: z.literal("checkout.github.set_auto_merge.response"),
  payload: z.object({
    cwd: z.string(),
    enabled: z.boolean(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutPrStatusResponseSchema = z.object({
  type: z.literal("checkout_pr_status_response"),
  payload: CheckoutPrStatusPayloadSchema,
});

const PullRequestTimelineKnownErrorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("not_found"),
    message: z.string().optional().default(""),
  }),
  z.object({
    kind: z.literal("forbidden"),
    message: z.string().optional().default(""),
  }),
  z.object({
    kind: z.literal("unknown"),
    message: z.string().optional().default(""),
  }),
]);

const PullRequestTimelineErrorSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "unknown", message: "" };
  }
  const error = value as Record<string, unknown>;
  if (error.kind === "not_found" || error.kind === "forbidden" || error.kind === "unknown") {
    return error;
  }
  return { ...error, kind: "unknown" };
}, PullRequestTimelineKnownErrorSchema);

const PullRequestTimelineReviewItemSchema = z.object({
  id: z.string().optional().default(""),
  kind: z.literal("review"),
  author: z.string().optional().default("unknown"),
  body: z.string().optional().default(""),
  createdAt: z.number().optional().default(0),
  url: z.string().optional().default(""),
  reviewState: z
    .enum(["approved", "changes_requested", "commented"])
    .optional()
    .default("commented"),
});

const PullRequestTimelineCommentItemSchema = z.object({
  id: z.string().optional().default(""),
  kind: z.literal("comment"),
  author: z.string().optional().default("unknown"),
  body: z.string().optional().default(""),
  createdAt: z.number().optional().default(0),
  url: z.string().optional().default(""),
});

export const PullRequestTimelineItemSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    const item = value as Record<string, unknown>;
    if (item.kind === "review" || item.kind === "comment") {
      return item;
    }
    return { ...item, kind: "comment" };
  },
  z.discriminatedUnion("kind", [
    PullRequestTimelineReviewItemSchema,
    PullRequestTimelineCommentItemSchema,
  ]),
);

export const PullRequestTimelineResponseSchema = z.object({
  type: z.literal("pull_request_timeline_response"),
  payload: z
    .object({
      cwd: z.string().optional().default(""),
      prNumber: z.number().nullable().optional().default(null),
      items: z.array(PullRequestTimelineItemSchema).optional().default([]),
      truncated: z.boolean().optional().default(false),
      error: PullRequestTimelineErrorSchema.nullable().optional().default(null),
      requestId: z.string().optional().default(""),
      githubFeaturesEnabled: z.boolean().optional().default(true),
    })
    .optional()
    .default({}),
});

export const CheckoutSwitchBranchResponseSchema = z.object({
  type: z.literal("checkout_switch_branch_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    branch: z.string(),
    source: z.enum(["local", "remote"]).optional(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const CheckoutRenameBranchResponseSchema = z.object({
  type: z.literal("checkout.rename_branch.response"),
  payload: z.object({
    requestId: z.string(),
    success: z.boolean(),
    cwd: z.string(),
    currentBranch: z.string().nullable(),
    error: CheckoutErrorSchema.nullable(),
  }),
});

const StashEntrySchema = z.object({
  index: z.number().int().min(0),
  message: z.string(),
  branch: z.string().nullable(),
  isChisaCode: z.boolean(),
});

export const StashSaveResponseSchema = z.object({
  type: z.literal("stash_save_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const StashPopResponseSchema = z.object({
  type: z.literal("stash_pop_response"),
  payload: z.object({
    cwd: z.string(),
    success: z.boolean(),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const StashListResponseSchema = z.object({
  type: z.literal("stash_list_response"),
  payload: z.object({
    cwd: z.string(),
    entries: z.array(StashEntrySchema),
    error: CheckoutErrorSchema.nullable(),
    requestId: z.string(),
  }),
});

export const ValidateBranchResponseSchema = z.object({
  type: z.literal("validate_branch_response"),
  payload: z.object({
    exists: z.boolean(),
    resolvedRef: z.string().nullable(),
    isRemote: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const BranchSuggestionsResponseSchema = z.object({
  type: z.literal("branch_suggestions_response"),
  payload: z.object({
    branches: z.array(z.string()),
    branchDetails: z
      .array(
        z.object({
          name: z.string(),
          committerDate: z.number(),
          hasLocal: z.boolean().optional(),
          hasRemote: z.boolean().optional(),
        }),
      )
      .optional(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

export const GitHubSearchResponseSchema = z.object({
  type: z.literal("github_search_response"),
  payload: z.object({
    items: z.array(GitHubSearchItemSchema),
    githubFeaturesEnabled: z.boolean(),
    error: z.string().nullable(),
    requestId: z.string(),
  }),
});

/** Checkout request schemas included in the session inbound union. */
export const CheckoutInboundMessageSchemas = [
  CheckoutStatusRequestSchema,
  SubscribeCheckoutDiffRequestSchema,
  UnsubscribeCheckoutDiffRequestSchema,
  CheckoutCommitRequestSchema,
  CheckoutMergeRequestSchema,
  CheckoutMergeFromBaseRequestSchema,
  CheckoutPullRequestSchema,
  CheckoutPushRequestSchema,
  CheckoutRefreshRequestSchema,
  CheckoutPrCreateRequestSchema,
  CheckoutPrMergeRequestSchema,
  CheckoutGithubSetAutoMergeRequestSchema,
  CheckoutPrStatusRequestSchema,
  PullRequestTimelineRequestSchema,
  ValidateBranchRequestSchema,
  CheckoutSwitchBranchRequestSchema,
  CheckoutRenameBranchRequestSchema,
  StashSaveRequestSchema,
  StashPopRequestSchema,
  StashListRequestSchema,
  BranchSuggestionsRequestSchema,
  GitHubSearchRequestSchema,
] as const;

/** Checkout response and event schemas included in the session outbound union. */
export const CheckoutOutboundMessageSchemas = [
  CheckoutStatusResponseSchema,
  CheckoutStatusUpdateSchema,
  SubscribeCheckoutDiffResponseSchema,
  CheckoutDiffUpdateSchema,
  CheckoutCommitResponseSchema,
  CheckoutMergeResponseSchema,
  CheckoutMergeFromBaseResponseSchema,
  CheckoutPullResponseSchema,
  CheckoutPushResponseSchema,
  CheckoutRefreshResponseSchema,
  CheckoutPrCreateResponseSchema,
  CheckoutPrMergeResponseSchema,
  CheckoutGithubSetAutoMergeResponseSchema,
  CheckoutPrStatusResponseSchema,
  PullRequestTimelineResponseSchema,
  CheckoutSwitchBranchResponseSchema,
  CheckoutRenameBranchResponseSchema,
  StashSaveResponseSchema,
  StashPopResponseSchema,
  StashListResponseSchema,
  ValidateBranchResponseSchema,
  BranchSuggestionsResponseSchema,
  GitHubSearchResponseSchema,
] as const;

export type CheckoutStatusRequest = z.infer<typeof CheckoutStatusRequestSchema>;
export type CheckoutStatusResponse = z.infer<typeof CheckoutStatusResponseSchema>;
export type CheckoutStatusUpdate = z.infer<typeof CheckoutStatusUpdateSchema>;
export type SubscribeCheckoutDiffRequest = z.infer<typeof SubscribeCheckoutDiffRequestSchema>;
export type UnsubscribeCheckoutDiffRequest = z.infer<typeof UnsubscribeCheckoutDiffRequestSchema>;
export type SubscribeCheckoutDiffResponse = z.infer<typeof SubscribeCheckoutDiffResponseSchema>;
export type CheckoutDiffUpdate = z.infer<typeof CheckoutDiffUpdateSchema>;
export type CheckoutCommitRequest = z.infer<typeof CheckoutCommitRequestSchema>;
export type CheckoutCommitResponse = z.infer<typeof CheckoutCommitResponseSchema>;
export type CheckoutMergeRequest = z.infer<typeof CheckoutMergeRequestSchema>;
export type CheckoutMergeResponse = z.infer<typeof CheckoutMergeResponseSchema>;
export type CheckoutMergeFromBaseRequest = z.infer<typeof CheckoutMergeFromBaseRequestSchema>;
export type CheckoutMergeFromBaseResponse = z.infer<typeof CheckoutMergeFromBaseResponseSchema>;
export type CheckoutPullRequest = z.infer<typeof CheckoutPullRequestSchema>;
export type CheckoutPullResponse = z.infer<typeof CheckoutPullResponseSchema>;
export type CheckoutPushRequest = z.infer<typeof CheckoutPushRequestSchema>;
export type CheckoutPushResponse = z.infer<typeof CheckoutPushResponseSchema>;
export type CheckoutRefreshRequest = z.infer<typeof CheckoutRefreshRequestSchema>;
export type CheckoutRefreshResponse = z.infer<typeof CheckoutRefreshResponseSchema>;
export type CheckoutPrCreateRequest = z.infer<typeof CheckoutPrCreateRequestSchema>;
export type CheckoutPrCreateResponse = z.infer<typeof CheckoutPrCreateResponseSchema>;
export type CheckoutPrMergeRequest = z.infer<typeof CheckoutPrMergeRequestSchema>;
export type CheckoutPrMergeResponse = z.infer<typeof CheckoutPrMergeResponseSchema>;
export type CheckoutPrMergeMethod = z.infer<typeof CheckoutPrMergeRequestSchema>["mergeMethod"];
export type CheckoutGithubSetAutoMergeRequest = z.infer<
  typeof CheckoutGithubSetAutoMergeRequestSchema
>;
export type CheckoutGithubSetAutoMergeResponse = z.infer<
  typeof CheckoutGithubSetAutoMergeResponseSchema
>;
export type PullRequestMergeable = z.infer<typeof CheckoutPrStatusSchema>["mergeable"];
export type CheckoutPrStatusRequest = z.infer<typeof CheckoutPrStatusRequestSchema>;
export type CheckoutPrStatusResponse = z.infer<typeof CheckoutPrStatusResponseSchema>;
export type PullRequestTimelineRequest = z.infer<typeof PullRequestTimelineRequestSchema>;
export type PullRequestTimelineItem = z.infer<typeof PullRequestTimelineItemSchema>;
export type PullRequestTimelineResponse = z.infer<typeof PullRequestTimelineResponseSchema>;
export type CheckoutSwitchBranchRequest = z.infer<typeof CheckoutSwitchBranchRequestSchema>;
export type CheckoutSwitchBranchResponse = z.infer<typeof CheckoutSwitchBranchResponseSchema>;
export type CheckoutRenameBranchRequest = z.infer<typeof CheckoutRenameBranchRequestSchema>;
export type CheckoutRenameBranchResponse = z.infer<typeof CheckoutRenameBranchResponseSchema>;
export type StashSaveRequest = z.infer<typeof StashSaveRequestSchema>;
export type StashSaveResponse = z.infer<typeof StashSaveResponseSchema>;
export type StashPopRequest = z.infer<typeof StashPopRequestSchema>;
export type StashPopResponse = z.infer<typeof StashPopResponseSchema>;
export type StashListRequest = z.infer<typeof StashListRequestSchema>;
export type StashListResponse = z.infer<typeof StashListResponseSchema>;
export type StashEntry = z.infer<typeof StashEntrySchema>;
export type ValidateBranchRequest = z.infer<typeof ValidateBranchRequestSchema>;
export type ValidateBranchResponse = z.infer<typeof ValidateBranchResponseSchema>;
export type BranchSuggestionsRequest = z.infer<typeof BranchSuggestionsRequestSchema>;
export type BranchSuggestionsResponse = z.infer<typeof BranchSuggestionsResponseSchema>;
export type GitHubSearchItem = z.infer<typeof GitHubSearchItemSchema>;
export type GitHubSearchKind = z.infer<typeof GitHubSearchKindSchema>;
export type GitHubSearchRequest = z.infer<typeof GitHubSearchRequestSchema>;
export type GitHubSearchResponse = z.infer<typeof GitHubSearchResponseSchema>;
