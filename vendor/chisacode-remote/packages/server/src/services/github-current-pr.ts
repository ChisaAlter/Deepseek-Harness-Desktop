import { z } from "zod/v3";

import {
  computePullRequestChecksStatus,
  parseStatusCheckRollup,
  type PullRequestCheck,
  type PullRequestChecksStatus,
} from "./github-pr-checks.js";

const PullRequestReviewDecisionSchema = z
  .enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])
  .nullable()
  .catch(null);

const HeadRepositoryOwnerSchema = z
  .object({
    login: z.string().optional(),
  })
  .nullable()
  .optional();

const PullRequestMergeableSchema = z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]).catch("UNKNOWN");

const GitHubAutoMergeRequestSchema = z
  .object({
    enabledAt: z.string().nullable().optional().catch(null),
    mergeMethod: z.string().nullable().optional().catch(null),
    enabledBy: z
      .object({
        login: z.string().nullable().optional().catch(null),
      })
      .nullable()
      .optional()
      .catch(null),
  })
  .nullable()
  .optional()
  .catch(null);

const GitHubPullRequestFactsGraphqlSchema = z.object({
  data: z.object({
    repository: z
      .object({
        autoMergeAllowed: z.boolean().optional().catch(false),
        mergeCommitAllowed: z.boolean().optional().catch(false),
        squashMergeAllowed: z.boolean().optional().catch(false),
        rebaseMergeAllowed: z.boolean().optional().catch(false),
        viewerDefaultMergeMethod: z.string().nullable().optional().catch(null),
        pullRequest: z
          .object({
            mergeStateStatus: z.string().nullable().optional().catch(null),
            autoMergeRequest: GitHubAutoMergeRequestSchema,
            viewerCanEnableAutoMerge: z.boolean().optional().catch(false),
            viewerCanDisableAutoMerge: z.boolean().optional().catch(false),
            viewerCanMergeAsAdmin: z.boolean().optional().catch(false),
            viewerCanUpdateBranch: z.boolean().optional().catch(false),
            isMergeQueueEnabled: z.boolean().optional().catch(false),
            isInMergeQueue: z.boolean().optional().catch(false),
          })
          .nullable()
          .optional()
          .catch(null),
      })
      .nullable()
      .optional()
      .catch(null),
  }),
});

const CurrentPullRequestStatusSchema = z.object({
  number: z.number().optional(),
  url: z.string().catch(""),
  title: z.string().catch(""),
  state: z.string().catch(""),
  isDraft: z.boolean().optional().catch(false),
  baseRefName: z.string().catch(""),
  headRefName: z.string().catch(""),
  mergedAt: z.string().nullable().optional(),
  statusCheckRollup: z.unknown().optional(),
  reviewDecision: z.unknown().optional(),
  mergeable: PullRequestMergeableSchema.optional().default("UNKNOWN"),
  headRepositoryOwner: HeadRepositoryOwnerSchema,
});

const GitHubRepoViewSchema = z.object({
  owner: z
    .object({
      login: z.string().optional(),
    })
    .nullable()
    .optional(),
  name: z.string().optional(),
  parent: z
    .object({
      owner: z
        .object({
          login: z.string().optional(),
        })
        .nullable()
        .optional(),
      name: z.string().optional(),
    })
    .nullable()
    .optional(),
});

const CURRENT_PR_STATUS_BASE_FIELDS =
  "number,url,title,state,isDraft,baseRefName,headRefName,mergedAt,reviewDecision,mergeable,headRepositoryOwner";
const CURRENT_PR_STATUS_FIELDS = `${CURRENT_PR_STATUS_BASE_FIELDS},statusCheckRollup`;

const PULL_REQUEST_STATUS_FACTS_QUERY = `
query PullRequestStatusFacts($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    autoMergeAllowed
    mergeCommitAllowed
    squashMergeAllowed
    rebaseMergeAllowed
    viewerDefaultMergeMethod
    pullRequest(number: $number) {
      mergeStateStatus
      autoMergeRequest {
        enabledAt
        mergeMethod
        enabledBy {
          login
        }
      }
      viewerCanEnableAutoMerge
      viewerCanDisableAutoMerge
      viewerCanMergeAsAdmin
      viewerCanUpdateBranch
      isMergeQueueEnabled
      isInMergeQueue
    }
  }
}`;

/** Normalized review decision displayed by current pull request consumers. */
export type PullRequestReviewDecision = "approved" | "changes_requested" | "pending" | null;

/** Normalized GitHub mergeability state. */
export type PullRequestMergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

/** GitHub-only merge policy and viewer capability facts for the current pull request. */
export interface GitHubPullRequestStatusFacts {
  mergeStateStatus: string | null;
  autoMergeRequest: {
    enabledAt: string | null;
    mergeMethod: string | null;
    enabledBy: string | null;
  } | null;
  viewerCanEnableAutoMerge: boolean;
  viewerCanDisableAutoMerge: boolean;
  viewerCanMergeAsAdmin: boolean;
  viewerCanUpdateBranch: boolean;
  repository: {
    autoMergeAllowed: boolean;
    mergeCommitAllowed: boolean;
    squashMergeAllowed: boolean;
    rebaseMergeAllowed: boolean;
    viewerDefaultMergeMethod: string | null;
  };
  isMergeQueueEnabled: boolean;
  isInMergeQueue: boolean;
}

/** Current branch pull request status consumed by workspace snapshots and the PR panel. */
export interface GitHubCurrentPullRequestStatus {
  number?: number;
  repoOwner?: string;
  repoName?: string;
  url: string;
  title: string;
  state: string;
  baseRefName: string;
  headRefName: string;
  isMerged: boolean;
  isDraft?: boolean;
  mergeable: PullRequestMergeable;
  checks: PullRequestCheck[];
  checksStatus: PullRequestChecksStatus;
  reviewDecision: PullRequestReviewDecision;
  github?: GitHubPullRequestStatusFacts;
}

/** Minimal repository identity returned by `gh repo view`. */
export type GitHubRepoView = z.infer<typeof GitHubRepoViewSchema>;

interface GitHubCurrentPullRequestInput {
  cwd: string;
  headRef: string;
  headRepositoryOwner?: string;
}

interface GitHubCurrentPullRequestDependencies {
  run(args: string[], options: { cwd: string }): Promise<string>;
  isCommandError(error: unknown): boolean;
  isNoPullRequestFoundError(error: unknown): boolean;
  isStatusCheckRollupPermissionError(error: unknown): boolean;
}

type CurrentPullRequestStatusItem = z.infer<typeof CurrentPullRequestStatusSchema>;
type GitHubPullRequestFactsGraphql = z.infer<typeof GitHubPullRequestFactsGraphqlSchema>;
type GitHubPullRequestFactsRepository = NonNullable<
  GitHubPullRequestFactsGraphql["data"]["repository"]
>;
type GitHubPullRequestFactsPullRequest = NonNullable<
  GitHubPullRequestFactsRepository["pullRequest"]
>;

interface ResolvedPullRequestCandidate {
  status: GitHubCurrentPullRequestStatus;
  headRepositoryOwner?: string;
}

/**
 * Resolves and enriches the pull request associated with the current checkout branch.
 * @param input Checkout path, branch, and optional fork owner identity
 * @param dependencies GitHub command runner and service-owned error classifiers
 * @returns The matched pull request status, or null when no qualified candidate exists
 */
export async function loadGitHubCurrentPullRequestStatus(
  input: GitHubCurrentPullRequestInput,
  dependencies: GitHubCurrentPullRequestDependencies,
): Promise<GitHubCurrentPullRequestStatus | null> {
  const status = await resolveCurrentPullRequestView(input, dependencies);
  return addCurrentPullRequestGithubFacts({ cwd: input.cwd, status }, dependencies);
}

/**
 * Loads the current repository and optional parent identity through GitHub CLI.
 * @param input Checkout path and GitHub command runner
 * @returns Parsed repository identity, or null when the lookup is unavailable
 */
export async function loadGitHubRepoView(input: {
  cwd: string;
  run(args: string[], options: { cwd: string }): Promise<string>;
}): Promise<GitHubRepoView | null> {
  try {
    const stdout = await input.run(["repo", "view", "--json", "owner,name,parent"], {
      cwd: input.cwd,
    });
    return GitHubRepoViewSchema.parse(JSON.parse(stdout || "{}"));
  } catch {
    return null;
  }
}

async function resolveCurrentPullRequestView(
  input: GitHubCurrentPullRequestInput,
  dependencies: GitHubCurrentPullRequestDependencies,
): Promise<GitHubCurrentPullRequestStatus | null> {
  const viewCandidate = await tryCurrentPullRequestView(input, dependencies);
  const viewMatch = viewCandidate
    ? pickPullRequestCandidate({
        candidates: [viewCandidate],
        headRef: input.headRef,
        headRepositoryOwner: input.headRepositoryOwner,
      })
    : null;
  if (viewMatch) {
    return viewMatch.status;
  }

  let listHeadRef = input.headRef;
  let listRepo: string | undefined;
  let headRepositoryOwner = input.headRepositoryOwner;

  if (!headRepositoryOwner) {
    const repo = await loadGitHubRepoView({ cwd: input.cwd, run: dependencies.run });
    const forkOwner = repo?.owner?.login;
    const parentOwner = repo?.parent?.owner?.login;
    const parentName = repo?.parent?.name;
    if (!forkOwner || !parentOwner || !parentName) {
      return null;
    }

    listHeadRef = `${forkOwner}:${input.headRef}`;
    listRepo = `${parentOwner}/${parentName}`;
    headRepositoryOwner = forkOwner;
  }

  const candidates = await listCurrentPullRequestCandidates(
    {
      cwd: input.cwd,
      headRef: listHeadRef,
      repo: listRepo,
    },
    dependencies,
  );
  const match = pickPullRequestCandidate({
    candidates,
    headRef: input.headRef,
    headRepositoryOwner,
  });
  return match?.status ?? null;
}

async function addCurrentPullRequestGithubFacts(
  input: {
    cwd: string;
    status: GitHubCurrentPullRequestStatus | null;
  },
  dependencies: GitHubCurrentPullRequestDependencies,
): Promise<GitHubCurrentPullRequestStatus | null> {
  const { status } = input;
  if (!status?.repoOwner || !status.repoName || typeof status.number !== "number") {
    return status;
  }

  const facts = await loadPullRequestGithubFacts(
    {
      cwd: input.cwd,
      owner: status.repoOwner,
      name: status.repoName,
      number: status.number,
    },
    dependencies,
  );
  if (!facts) {
    return status;
  }
  return {
    ...status,
    github: facts,
  };
}

async function loadPullRequestGithubFacts(
  input: {
    cwd: string;
    owner: string;
    name: string;
    number: number;
  },
  dependencies: GitHubCurrentPullRequestDependencies,
): Promise<GitHubPullRequestStatusFacts | null> {
  try {
    const stdout = await dependencies.run(
      [
        "api",
        "graphql",
        "-f",
        `query=${PULL_REQUEST_STATUS_FACTS_QUERY}`,
        "-F",
        `owner=${input.owner}`,
        "-F",
        `name=${input.name}`,
        "-F",
        `number=${input.number}`,
      ],
      { cwd: input.cwd },
    );
    return parsePullRequestGithubFacts(stdout);
  } catch (error) {
    if (
      dependencies.isCommandError(error) ||
      error instanceof z.ZodError ||
      error instanceof SyntaxError
    ) {
      return null;
    }
    throw error;
  }
}

async function tryCurrentPullRequestView(
  input: GitHubCurrentPullRequestInput,
  dependencies: GitHubCurrentPullRequestDependencies,
): Promise<ResolvedPullRequestCandidate | null> {
  try {
    const stdout = await runCurrentPullRequestStatusCommand(
      {
        cwd: input.cwd,
        args: ["pr", "view"],
      },
      dependencies,
    );
    return parseCurrentPullRequestCandidate(stdout, input.headRef);
  } catch (error) {
    if (dependencies.isNoPullRequestFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function listCurrentPullRequestCandidates(
  input: {
    cwd: string;
    headRef: string;
    repo?: string;
  },
  dependencies: GitHubCurrentPullRequestDependencies,
): Promise<ResolvedPullRequestCandidate[]> {
  const args = ["pr", "list"];
  if (input.repo) {
    args.push("--repo", input.repo);
  }
  args.push("--state", "all", "--head", input.headRef, "--limit", "10");
  try {
    const stdout = await runCurrentPullRequestStatusCommand(
      {
        cwd: input.cwd,
        args,
      },
      dependencies,
    );
    return parseCurrentPullRequestCandidateList(stdout, input.headRef);
  } catch (error) {
    if (dependencies.isNoPullRequestFoundError(error)) {
      return [];
    }
    throw error;
  }
}

async function runCurrentPullRequestStatusCommand(
  input: {
    cwd: string;
    args: string[];
  },
  dependencies: GitHubCurrentPullRequestDependencies,
): Promise<string> {
  try {
    return await dependencies.run([...input.args, "--json", CURRENT_PR_STATUS_FIELDS], {
      cwd: input.cwd,
    });
  } catch (error) {
    if (!dependencies.isStatusCheckRollupPermissionError(error)) {
      throw error;
    }
    return dependencies.run([...input.args, "--json", CURRENT_PR_STATUS_BASE_FIELDS], {
      cwd: input.cwd,
    });
  }
}

function parseCurrentPullRequestCandidate(
  stdout: string,
  fallbackHeadRefName: string,
): ResolvedPullRequestCandidate | null {
  const item = CurrentPullRequestStatusSchema.parse(JSON.parse(stdout || "{}"));
  return toCurrentPullRequestCandidate(item, fallbackHeadRefName);
}

function parseCurrentPullRequestCandidateList(
  stdout: string,
  fallbackHeadRefName: string,
): ResolvedPullRequestCandidate[] {
  const items = z.array(CurrentPullRequestStatusSchema).parse(JSON.parse(stdout || "[]"));
  return items
    .map((item) => toCurrentPullRequestCandidate(item, fallbackHeadRefName))
    .filter((candidate): candidate is ResolvedPullRequestCandidate => candidate !== null);
}

function parsePullRequestGithubFacts(stdout: string): GitHubPullRequestStatusFacts | null {
  const parsed = GitHubPullRequestFactsGraphqlSchema.parse(JSON.parse(stdout || "{}"));
  const repository = parsed.data.repository;
  const pullRequest = repository?.pullRequest;
  if (!repository || !pullRequest) {
    return null;
  }

  return {
    mergeStateStatus: pullRequest.mergeStateStatus ?? null,
    autoMergeRequest: toGitHubAutoMergeRequest(pullRequest.autoMergeRequest),
    viewerCanEnableAutoMerge: pullRequest.viewerCanEnableAutoMerge ?? false,
    viewerCanDisableAutoMerge: pullRequest.viewerCanDisableAutoMerge ?? false,
    viewerCanMergeAsAdmin: pullRequest.viewerCanMergeAsAdmin ?? false,
    viewerCanUpdateBranch: pullRequest.viewerCanUpdateBranch ?? false,
    repository: toGitHubRepositoryMergePolicy(repository),
    isMergeQueueEnabled: pullRequest.isMergeQueueEnabled ?? false,
    isInMergeQueue: pullRequest.isInMergeQueue ?? false,
  };
}

function toGitHubAutoMergeRequest(
  request: GitHubPullRequestFactsPullRequest["autoMergeRequest"],
): GitHubPullRequestStatusFacts["autoMergeRequest"] {
  if (!request) {
    return null;
  }
  return {
    enabledAt: request.enabledAt ?? null,
    mergeMethod: request.mergeMethod ?? null,
    enabledBy: request.enabledBy?.login ?? null,
  };
}

function toGitHubRepositoryMergePolicy(
  repository: GitHubPullRequestFactsRepository,
): GitHubPullRequestStatusFacts["repository"] {
  return {
    autoMergeAllowed: repository.autoMergeAllowed ?? false,
    mergeCommitAllowed: repository.mergeCommitAllowed ?? false,
    squashMergeAllowed: repository.squashMergeAllowed ?? false,
    rebaseMergeAllowed: repository.rebaseMergeAllowed ?? false,
    viewerDefaultMergeMethod: repository.viewerDefaultMergeMethod ?? null,
  };
}

function toCurrentPullRequestCandidate(
  item: CurrentPullRequestStatusItem,
  fallbackHeadRefName: string,
): ResolvedPullRequestCandidate | null {
  const status = toCurrentPullRequestStatus(item, fallbackHeadRefName);
  if (!status) {
    return null;
  }
  const headRepositoryOwner = item.headRepositoryOwner?.login;
  return {
    status,
    ...(headRepositoryOwner ? { headRepositoryOwner } : {}),
  };
}

function pickPullRequestCandidate(input: {
  candidates: ResolvedPullRequestCandidate[];
  headRef: string;
  headRepositoryOwner?: string;
}): ResolvedPullRequestCandidate | null {
  const matching = input.candidates.filter((candidate) => {
    if (!isCandidateForHeadRef(candidate, input.headRef)) {
      return false;
    }
    if (!input.headRepositoryOwner) {
      return true;
    }
    return candidate.headRepositoryOwner === input.headRepositoryOwner;
  });
  matching.sort(comparePullRequestCandidatePreference);
  return matching[0] ?? null;
}

function isCandidateForHeadRef(candidate: ResolvedPullRequestCandidate, headRef: string): boolean {
  return candidate.status.headRefName === headRef && hasResolvedRepoIdentity(candidate.status);
}

function hasResolvedRepoIdentity(status: GitHubCurrentPullRequestStatus): boolean {
  return Boolean(status.repoOwner && status.repoName);
}

function comparePullRequestCandidatePreference(
  left: ResolvedPullRequestCandidate,
  right: ResolvedPullRequestCandidate,
): number {
  return getPullRequestStateRank(left.status) - getPullRequestStateRank(right.status);
}

function getPullRequestStateRank(status: GitHubCurrentPullRequestStatus): number {
  if (status.state === "open") {
    return 0;
  }
  if (status.state === "merged") {
    return 1;
  }
  return 2;
}

function toCurrentPullRequestStatus(
  item: CurrentPullRequestStatusItem,
  fallbackHeadRefName: string,
): GitHubCurrentPullRequestStatus | null {
  if (!item.url || !item.title) {
    return null;
  }
  const repoIdentity = parseGitHubPullRequestRepo(item.url);
  const mergedAt =
    typeof item.mergedAt === "string" && item.mergedAt.trim().length > 0 ? item.mergedAt : null;
  let state: string;
  if (mergedAt !== null) {
    state = "merged";
  } else if (item.state.trim().length > 0) {
    state = item.state.toLowerCase();
  } else {
    state = "";
  }
  const checks = parseStatusCheckRollup(item.statusCheckRollup);
  return {
    ...(typeof item.number === "number" ? { number: item.number } : {}),
    ...(repoIdentity ? { repoOwner: repoIdentity.owner, repoName: repoIdentity.name } : {}),
    url: item.url,
    title: item.title,
    state,
    baseRefName: item.baseRefName,
    headRefName: item.headRefName || fallbackHeadRefName,
    isMerged: mergedAt !== null,
    isDraft: item.isDraft ?? false,
    mergeable: item.mergeable,
    checks,
    checksStatus: computePullRequestChecksStatus(checks),
    reviewDecision: mapReviewDecision(item.reviewDecision),
  };
}

function parseGitHubPullRequestRepo(url: string): { owner: string; name: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") {
      return null;
    }
    const [owner, name, kind] = parsed.pathname.split("/").filter(Boolean);
    if (!owner || !name || kind !== "pull") {
      return null;
    }
    return { owner, name };
  } catch {
    return null;
  }
}

function mapReviewDecision(value: unknown): PullRequestReviewDecision {
  const reviewDecision = PullRequestReviewDecisionSchema.parse(value);
  if (reviewDecision === "APPROVED") {
    return "approved";
  }
  if (reviewDecision === "CHANGES_REQUESTED") {
    return "changes_requested";
  }
  if (reviewDecision === "REVIEW_REQUIRED") {
    return "pending";
  }
  return null;
}
