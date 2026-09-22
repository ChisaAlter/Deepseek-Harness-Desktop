import { z } from "zod/v3";

import type { GitHubPullRequestStatusFacts, PullRequestMergeable } from "./github-current-pr.js";

const DIRECT_PULL_REQUEST_MERGE_STATE_ALLOWLIST = new Set(["CLEAN", "HAS_HOOKS"]);
const AUTO_MERGE_WAITING_STATE_ALLOWLIST = new Set(["BLOCKED", "BEHIND", "UNSTABLE"]);
const PullRequestCreateResultSchema = z.object({
  url: z.string(),
  number: z.number(),
});

/** Merge strategy accepted by GitHub pull request mutation commands. */
export type GitHubPullRequestMergeMethod = "merge" | "squash" | "rebase";

/** Minimal current pull request state required by mutation policy checks. */
export interface GitHubPullRequestCommandStatus {
  mergeable?: PullRequestMergeable;
  github?: GitHubPullRequestStatusFacts;
}

/** Input for creating a GitHub pull request through the repository API. */
export interface CreateGitHubPullRequestOptions {
  cwd: string;
  repo: string;
  title: string;
  head: string;
  base: string;
  body?: string;
}

/** Created pull request identity returned by GitHub. */
export interface GitHubPullRequestCreateResult {
  url: string;
  number: number;
}

/** Input for directly merging a GitHub pull request. */
export interface MergeGitHubPullRequestOptions {
  cwd: string;
  prNumber: number;
  mergeMethod: GitHubPullRequestMergeMethod;
  status?: GitHubPullRequestCommandStatus | null;
}

/** Input for enabling auto-merge on a GitHub pull request. */
export interface EnableGitHubPullRequestAutoMergeOptions {
  cwd: string;
  prNumber: number;
  mergeMethod: GitHubPullRequestMergeMethod;
  status?: GitHubPullRequestCommandStatus | null;
}

/** Input for disabling auto-merge on a GitHub pull request. */
export interface DisableGitHubPullRequestAutoMergeOptions {
  cwd: string;
  prNumber: number;
  status?: GitHubPullRequestCommandStatus | null;
}

/** Successful direct merge command result. */
export interface GitHubPullRequestMergeResult {
  success: true;
}

/** Successful auto-merge mutation result. */
export interface GitHubPullRequestAutoMergeResult {
  success: true;
}

interface GitHubPullRequestMutationDependencies {
  run(
    args: string[],
    options: { cwd: string; envOverlay?: Record<string, string> },
  ): Promise<string>;
}

/**
 * Creates a pull request through the GitHub repository API.
 * @param input Repository identity, refs, title, and optional body
 * @param dependencies GitHub command runner
 * @returns Created pull request URL and number
 */
export async function createGitHubPullRequest(
  input: CreateGitHubPullRequestOptions,
  dependencies: GitHubPullRequestMutationDependencies,
): Promise<GitHubPullRequestCreateResult> {
  const args = ["api", "-X", "POST", `repos/${input.repo}/pulls`, "-f", `title=${input.title}`];
  args.push("-f", `head=${input.head}`);
  args.push("-f", `base=${input.base}`);
  if (input.body) {
    args.push("-f", `body=${input.body}`);
  }
  const stdout = await dependencies.run(args, { cwd: input.cwd });
  return PullRequestCreateResultSchema.parse(JSON.parse(stdout || "{}"));
}

/**
 * Validates and directly merges a pull request using the selected repository merge method.
 * @param input Pull request identity, merge method, and current GitHub facts
 * @param dependencies GitHub command runner
 * @returns Successful mutation marker
 */
export async function mergeGitHubPullRequest(
  input: MergeGitHubPullRequestOptions,
  dependencies: GitHubPullRequestMutationDependencies,
): Promise<GitHubPullRequestMergeResult> {
  assertDirectPullRequestMergeReady(input);
  await dependencies.run(["pr", "merge", String(input.prNumber), `--${input.mergeMethod}`], {
    cwd: input.cwd,
    envOverlay: { GH_PROMPT_DISABLED: "1" },
  });
  return { success: true };
}

/**
 * Validates and enables auto-merge for a pull request waiting on GitHub merge requirements.
 * @param input Pull request identity, merge method, and current GitHub facts
 * @param dependencies GitHub command runner
 * @returns Successful mutation marker
 */
export async function enableGitHubPullRequestAutoMerge(
  input: EnableGitHubPullRequestAutoMergeOptions,
  dependencies: GitHubPullRequestMutationDependencies,
): Promise<GitHubPullRequestAutoMergeResult> {
  assertPullRequestAutoMergeEnableReady(input);
  await dependencies.run(
    ["pr", "merge", String(input.prNumber), "--auto", `--${input.mergeMethod}`],
    {
      cwd: input.cwd,
      envOverlay: { GH_PROMPT_DISABLED: "1" },
    },
  );
  return { success: true };
}

/**
 * Validates and disables an existing pull request auto-merge request.
 * @param input Pull request identity and current GitHub facts
 * @param dependencies GitHub command runner
 * @returns Successful mutation marker
 */
export async function disableGitHubPullRequestAutoMerge(
  input: DisableGitHubPullRequestAutoMergeOptions,
  dependencies: GitHubPullRequestMutationDependencies,
): Promise<GitHubPullRequestAutoMergeResult> {
  assertPullRequestAutoMergeDisableReady(input);
  await dependencies.run(["pr", "merge", String(input.prNumber), "--disable-auto"], {
    cwd: input.cwd,
    envOverlay: { GH_PROMPT_DISABLED: "1" },
  });
  return { success: true };
}

function assertDirectPullRequestMergeReady(input: MergeGitHubPullRequestOptions): void {
  const github = input.status?.github;
  if (!github) {
    throw new Error("GitHub merge facts are unavailable for this pull request");
  }

  if (!DIRECT_PULL_REQUEST_MERGE_STATE_ALLOWLIST.has(github.mergeStateStatus ?? "")) {
    throw new Error("GitHub does not report this pull request as ready for direct merge");
  }
  if (github.isMergeQueueEnabled || github.isInMergeQueue) {
    throw new Error("Direct merge is not available because this repository uses a merge queue");
  }
  if (github.autoMergeRequest !== null) {
    throw new Error("Direct merge is not available because auto-merge is already enabled");
  }
  if (!isPullRequestMergeMethodAllowed(github.repository, input.mergeMethod)) {
    throw new Error(`Direct merge is not available because ${input.mergeMethod} is disabled`);
  }
}

/**
 * Asserts that current GitHub facts permit enabling auto-merge.
 * @param input Requested merge method and current pull request status
 * @throws {Error} If auto-merge is unavailable or unsafe for the current state
 */
export function assertPullRequestAutoMergeEnableReady(
  input: Pick<EnableGitHubPullRequestAutoMergeOptions, "mergeMethod" | "status">,
): void {
  const github = input.status?.github;
  if (!github) {
    throw new Error("GitHub auto-merge facts are unavailable for this pull request");
  }

  if (!AUTO_MERGE_WAITING_STATE_ALLOWLIST.has(github.mergeStateStatus ?? "")) {
    throw new Error(
      "GitHub does not report this pull request as waiting for auto-merge requirements",
    );
  }
  if (!github.viewerCanEnableAutoMerge) {
    throw new Error("GitHub does not allow this viewer to enable auto-merge");
  }
  if (!github.repository.autoMergeAllowed) {
    throw new Error("Auto-merge is disabled for this repository");
  }
  if (!isPullRequestMergeMethodAllowed(github.repository, input.mergeMethod)) {
    throw new Error(`Auto-merge is not available because ${input.mergeMethod} is disabled`);
  }
  if (github.autoMergeRequest !== null) {
    throw new Error("Auto-merge is already enabled for this pull request");
  }
  if (github.isMergeQueueEnabled || github.isInMergeQueue) {
    throw new Error("Auto-merge is not available because this repository uses a merge queue");
  }
  if (input.status?.mergeable === "CONFLICTING") {
    throw new Error("Auto-merge is not available because this pull request has conflicts");
  }
}

/**
 * Asserts that current GitHub facts permit disabling auto-merge.
 * @param input Current pull request status
 * @throws {Error} If no disable-able auto-merge request exists
 */
export function assertPullRequestAutoMergeDisableReady(
  input: Pick<DisableGitHubPullRequestAutoMergeOptions, "status">,
): void {
  const github = input.status?.github;
  if (!github) {
    throw new Error("GitHub auto-merge facts are unavailable for this pull request");
  }

  if (github.autoMergeRequest === null) {
    throw new Error("Auto-merge is not enabled for this pull request");
  }
  if (!github.viewerCanDisableAutoMerge) {
    throw new Error("GitHub does not allow this viewer to disable auto-merge");
  }
  if (github.isMergeQueueEnabled || github.isInMergeQueue) {
    throw new Error("Auto-merge is not available because this repository uses a merge queue");
  }
}

/**
 * Checks whether the repository permits a requested pull request merge method.
 * @param repository Repository merge policy returned by GitHub
 * @param method Requested merge method
 * @returns Whether the method is enabled for the repository
 */
export function isPullRequestMergeMethodAllowed(
  repository: GitHubPullRequestStatusFacts["repository"],
  method: GitHubPullRequestMergeMethod,
): boolean {
  if (method === "squash") {
    return repository.squashMergeAllowed;
  }
  if (method === "merge") {
    return repository.mergeCommitAllowed;
  }
  return repository.rebaseMergeAllowed;
}
