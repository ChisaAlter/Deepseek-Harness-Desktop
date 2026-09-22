import type {
  CheckoutPrMergeMethod,
  CreateChisaCodeWorktreeRequest,
  GitHubSearchRequest,
} from "@chisacode/protocol/messages";

import type {
  DaemonCommandResponsePayload,
  DaemonCommandTransport,
} from "./daemon-client-command-transport.js";

type CreateWorktreeInput = Pick<
  CreateChisaCodeWorktreeRequest,
  | "cwd"
  | "projectId"
  | "worktreeSlug"
  | "firstAgentContext"
  | "refName"
  | "action"
  | "githubPrNumber"
>;

/** Implements stateless checkout, pull-request, stash, and worktree RPC commands. */
export class CheckoutCommandClient {
  constructor(private readonly transport: DaemonCommandTransport) {}

  checkoutCommit(
    cwd: string,
    input: { message?: string; addAll?: boolean },
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"checkout_commit_response">> {
    return this.transport.request({
      requestId,
      message: {
        type: "checkout_commit_request",
        cwd,
        message: input.message,
        addAll: input.addAll,
      },
      responseType: "checkout_commit_response",
      timeout: 60000,
    });
  }

  checkoutMerge(
    cwd: string,
    input: { baseRef?: string; strategy?: "merge" | "squash"; requireCleanTarget?: boolean },
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"checkout_merge_response">> {
    return this.transport.request({
      requestId,
      message: {
        type: "checkout_merge_request",
        cwd,
        baseRef: input.baseRef,
        strategy: input.strategy,
        requireCleanTarget: input.requireCleanTarget,
      },
      responseType: "checkout_merge_response",
      timeout: 60000,
    });
  }

  checkoutMergeFromBase(
    cwd: string,
    input: { baseRef?: string; requireCleanTarget?: boolean },
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"checkout_merge_from_base_response">> {
    return this.transport.request({
      requestId,
      message: {
        type: "checkout_merge_from_base_request",
        cwd,
        baseRef: input.baseRef,
        requireCleanTarget: input.requireCleanTarget,
      },
      responseType: "checkout_merge_from_base_response",
      timeout: 60000,
    });
  }

  checkoutPull(
    cwd: string,
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"checkout_pull_response">> {
    return this.transport.request({
      requestId,
      message: { type: "checkout_pull_request", cwd },
      responseType: "checkout_pull_response",
      timeout: 60000,
    });
  }

  checkoutPush(
    cwd: string,
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"checkout_push_response">> {
    return this.transport.request({
      requestId,
      message: { type: "checkout_push_request", cwd },
      responseType: "checkout_push_response",
      timeout: 60000,
    });
  }

  checkoutRefresh(
    cwd: string,
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"checkout.refresh.response">> {
    return this.transport.request({
      requestId,
      message: { type: "checkout.refresh.request", cwd },
      responseType: "checkout.refresh.response",
      timeout: 60000,
    });
  }

  checkoutPrCreate(
    cwd: string,
    input: { title?: string; body?: string; baseRef?: string },
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"checkout_pr_create_response">> {
    return this.transport.request({
      requestId,
      message: {
        type: "checkout_pr_create_request",
        cwd,
        title: input.title,
        body: input.body,
        baseRef: input.baseRef,
      },
      responseType: "checkout_pr_create_response",
      timeout: 60000,
    });
  }

  checkoutPrMerge(
    cwd: string,
    input: { method: CheckoutPrMergeMethod },
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"checkout_pr_merge_response">> {
    return this.transport.request({
      requestId,
      message: {
        type: "checkout_pr_merge_request",
        cwd,
        mergeMethod: input.method,
      },
      responseType: "checkout_pr_merge_response",
      timeout: 60000,
    });
  }

  checkoutGithubSetAutoMerge(
    cwd: string,
    input: { enabled: true; method: CheckoutPrMergeMethod } | { enabled: false },
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"checkout.github.set_auto_merge.response">> {
    return this.transport.request({
      requestId,
      message: {
        type: "checkout.github.set_auto_merge.request",
        cwd,
        enabled: input.enabled,
        ...(input.enabled ? { mergeMethod: input.method } : {}),
      },
      responseType: "checkout.github.set_auto_merge.response",
      timeout: 60000,
    });
  }

  checkoutPrStatus(
    cwd: string,
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"checkout_pr_status_response">> {
    return this.transport.request({
      requestId,
      message: { type: "checkout_pr_status_request", cwd },
      responseType: "checkout_pr_status_response",
      timeout: 60000,
    });
  }

  pullRequestTimeline(
    input: { cwd: string; prNumber: number; repoOwner: string; repoName: string },
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"pull_request_timeline_response">> {
    return this.transport.request({
      requestId,
      message: {
        type: "pull_request_timeline_request",
        cwd: input.cwd,
        prNumber: input.prNumber,
        repoOwner: input.repoOwner,
        repoName: input.repoName,
      },
      responseType: "pull_request_timeline_response",
      timeout: 60000,
    });
  }

  checkoutSwitchBranch(
    cwd: string,
    branch: string,
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"checkout_switch_branch_response">> {
    return this.transport.request({
      requestId,
      message: { type: "checkout_switch_branch_request", cwd, branch },
      responseType: "checkout_switch_branch_response",
      timeout: 30000,
    });
  }

  renameBranch(input: {
    cwd: string;
    branch: string;
    requestId?: string;
  }): Promise<DaemonCommandResponsePayload<"checkout.rename_branch.response">> {
    return this.transport.request({
      requestId: input.requestId,
      message: { type: "checkout.rename_branch.request", cwd: input.cwd, branch: input.branch },
      responseType: "checkout.rename_branch.response",
      timeout: 30000,
    });
  }

  stashSave(
    cwd: string,
    options?: { branch?: string },
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"stash_save_response">> {
    return this.transport.request({
      requestId,
      message: { type: "stash_save_request", cwd, branch: options?.branch },
      responseType: "stash_save_response",
      timeout: 30000,
    });
  }

  stashPop(
    cwd: string,
    stashIndex: number,
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"stash_pop_response">> {
    return this.transport.request({
      requestId,
      message: { type: "stash_pop_request", cwd, stashIndex },
      responseType: "stash_pop_response",
      timeout: 30000,
    });
  }

  stashList(
    cwd: string,
    options?: { chisacodeOnly?: boolean },
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"stash_list_response">> {
    return this.transport.request({
      requestId,
      message: { type: "stash_list_request", cwd, chisacodeOnly: options?.chisacodeOnly },
      responseType: "stash_list_response",
      timeout: 10000,
    });
  }

  getChisaCodeWorktreeList(
    input: { cwd?: string; repoRoot?: string },
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"chisacode_worktree_list_response">> {
    return this.transport.request({
      requestId,
      message: {
        type: "chisacode_worktree_list_request",
        cwd: input.cwd,
        repoRoot: input.repoRoot,
      },
      responseType: "chisacode_worktree_list_response",
      timeout: 60000,
    });
  }

  archiveChisaCodeWorktree(
    input: { worktreePath?: string; repoRoot?: string; branchName?: string },
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"chisacode_worktree_archive_response">> {
    return this.transport.request({
      requestId,
      message: {
        type: "chisacode_worktree_archive_request",
        worktreePath: input.worktreePath,
        repoRoot: input.repoRoot,
        branchName: input.branchName,
      },
      responseType: "chisacode_worktree_archive_response",
      timeout: 60000,
    });
  }

  createChisaCodeWorktree(
    input: CreateWorktreeInput,
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"create_chisacode_worktree_response">> {
    return this.transport.request({
      requestId,
      message: {
        type: "create_chisacode_worktree_request",
        cwd: input.cwd,
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        worktreeSlug: input.worktreeSlug,
        ...(input.firstAgentContext !== undefined
          ? { firstAgentContext: input.firstAgentContext }
          : {}),
        ...(input.refName !== undefined ? { refName: input.refName } : {}),
        ...(input.action !== undefined ? { action: input.action } : {}),
        ...(input.githubPrNumber !== undefined ? { githubPrNumber: input.githubPrNumber } : {}),
      },
      responseType: "create_chisacode_worktree_response",
      timeout: 60000,
    });
  }

  validateBranch(
    options: { cwd: string; branchName: string },
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"validate_branch_response">> {
    return this.transport.request({
      requestId,
      message: {
        type: "validate_branch_request",
        cwd: options.cwd,
        branchName: options.branchName,
      },
      responseType: "validate_branch_response",
      timeout: 10000,
    });
  }

  getBranchSuggestions(
    options: { cwd: string; query?: string; limit?: number },
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"branch_suggestions_response">> {
    return this.transport.request({
      requestId,
      message: {
        type: "branch_suggestions_request",
        cwd: options.cwd,
        query: options.query,
        limit: options.limit,
      },
      responseType: "branch_suggestions_response",
      timeout: 10000,
    });
  }

  searchGitHub(
    options: { cwd: string; query: string; limit?: number; kinds?: GitHubSearchRequest["kinds"] },
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"github_search_response">> {
    return this.transport.request({
      requestId,
      message: {
        type: "github_search_request",
        cwd: options.cwd,
        query: options.query,
        limit: options.limit,
        kinds: options.kinds,
      },
      responseType: "github_search_response",
      timeout: 15000,
    });
  }

  getDirectorySuggestions(
    options: {
      query: string;
      limit?: number;
      cwd?: string;
      includeFiles?: boolean;
      includeDirectories?: boolean;
      matchMode?: "fuzzy" | "suffix";
    },
    requestId?: string,
  ): Promise<DaemonCommandResponsePayload<"directory_suggestions_response">> {
    return this.transport.request({
      requestId,
      message: {
        type: "directory_suggestions_request",
        query: options.query,
        cwd: options.cwd,
        includeFiles: options.includeFiles,
        includeDirectories: options.includeDirectories,
        matchMode: options.matchMode,
        limit: options.limit,
      },
      responseType: "directory_suggestions_response",
      timeout: 10000,
    });
  }
}
