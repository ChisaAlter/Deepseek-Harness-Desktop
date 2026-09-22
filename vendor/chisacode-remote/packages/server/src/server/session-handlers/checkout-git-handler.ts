/**
 * CheckoutGitHandler — extracted from Session.
 *
 * Handles all checkout/git/branch/stash/PR operations.
 */

import { homedir } from "node:os";

import { getErrorMessage } from "@chisacode/protocol/error-utils";
import { validateBranchSlug } from "@chisacode/protocol/branch-slug";

import { execCommand } from "../../utils/spawn.js";
import { expandTilde } from "../../utils/path.js";
import {
  searchWorkspaceEntries,
  searchHomeDirectories,
} from "../../utils/directory-suggestions.js";
import {
  checkoutResolvedBranch,
  commitChanges,
  mergeToBase,
  mergeFromBase,
  pullCurrentBranch,
  pushCurrentBranch,
  createPullRequest,
  renameCurrentBranch,
  type CheckoutExistingBranchResult,
} from "../../utils/checkout-git.js";
import {
  assertPullRequestAutoMergeEnableReady,
  assertPullRequestAutoMergeDisableReady,
  type PullRequestTimelineItem,
} from "../../services/github-service.js";
import { toCheckoutError } from "../checkout-git-utils.js";
import {
  buildCheckoutStatusPayloadFromSnapshot,
  buildCheckoutPrStatusPayloadFromSnapshot,
} from "../checkout/status-projection.js";
import { assertSafeGitRef } from "../worktree-session.js";
import type {
  SessionInboundMessage,
  SessionOutboundMessage,
  SubscribeCheckoutDiffRequest,
  UnsubscribeCheckoutDiffRequest,
  DirectorySuggestionsRequest,
  CheckoutRenameBranchRequest,
} from "../messages.js";
import type {
  WorkspaceGitRuntimeSnapshot,
  WorkspaceGitSnapshotOptions,
} from "../workspace-git-service.js";
import type { CurrentWorkspacePullRequest, GitMutationRefreshReason } from "../session-helpers.js";
import type { CheckoutGitHandlerContext, DisposableHandler } from "./session-context.js";

type PullRequestTimelinePayload = Extract<
  SessionOutboundMessage,
  { type: "pull_request_timeline_response" }
>["payload"];
type PullRequestTimelinePayloadItem = PullRequestTimelinePayload["items"][number];

const CHISACODE_STASH_PREFIX = "chisacode-auto-stash:";

/** Handles all checkout, git branch/stash/PR, and diff subscription RPC operations. */
export class CheckoutGitHandler implements DisposableHandler {
  private readonly context: CheckoutGitHandlerContext;
  private readonly checkoutDiffSubscriptions = new Map<string, () => void>();

  constructor(context: CheckoutGitHandlerContext) {
    this.context = context;
  }

  dispose(): void {
    for (const unsubscribe of this.checkoutDiffSubscriptions.values()) {
      try {
        unsubscribe();
      } catch {
        // ignore
      }
    }
    this.checkoutDiffSubscriptions.clear();
  }

  // --- Git mutation notification ---

  private async notifyGitMutation(
    cwd: string,
    reason: GitMutationRefreshReason,
    options?: { invalidateGithub?: boolean },
  ): Promise<void> {
    if (options?.invalidateGithub) {
      this.context.github.invalidate({ cwd });
    }
    try {
      await this.context.workspaceGitService.getSnapshot(cwd, { force: true, reason });
    } catch (error) {
      this.context.sessionLogger.warn(
        { err: error, cwd, reason },
        "Failed to force-refresh workspace git snapshot after mutation",
      );
    }
  }

  // --- Branch safety helpers ---

  /** Check whether the working tree has uncommitted changes. */
  async isWorkingTreeDirty(cwd: string): Promise<boolean> {
    try {
      const snapshot = await this.context.workspaceGitService.getSnapshot(cwd);
      return snapshot.git.isDirty === true;
    } catch (error) {
      throw new Error(`Unable to inspect git status for ${cwd}: ${getErrorMessage(error)}`, {
        cause: error,
      });
    }
  }

  /** Ensure the working tree is clean — throws if there are uncommitted changes. */
  async ensureCleanWorkingTree(cwd: string): Promise<void> {
    if (await this.isWorkingTreeDirty(cwd)) {
      throw new Error(
        "Working directory has uncommitted changes. Commit or stash before switching branches.",
      );
    }
  }

  /** Checkout a branch that already exists (local or remote). */
  async checkoutExistingBranch(cwd: string, branch: string): Promise<CheckoutExistingBranchResult> {
    assertSafeGitRef(branch, "branch");
    const resolution = await this.context.workspaceGitService.validateBranchRef(cwd, branch);
    if (resolution.kind === "not-found") {
      throw new Error(`Branch not found: ${branch}`);
    }
    await this.ensureCleanWorkingTree(cwd);
    const result = await checkoutResolvedBranch({ cwd, resolution });
    await this.notifyGitMutation(cwd, "switch-branch", { invalidateGithub: true });
    return result;
  }

  /** Create a new branch from a base branch reference. */
  async createBranchFromBase(params: {
    cwd: string;
    baseBranch: string;
    newBranchName: string;
  }): Promise<void> {
    const { cwd, baseBranch, newBranchName } = params;
    assertSafeGitRef(baseBranch, "base branch");
    assertSafeGitRef(newBranchName, "new branch");

    const baseResolution = await this.context.workspaceGitService.validateBranchRef(
      cwd,
      baseBranch,
    );
    if (baseResolution.kind === "not-found") {
      throw new Error(`Base branch not found: ${baseBranch}`);
    }

    const exists = await this.doesLocalBranchExist(cwd, newBranchName);
    if (exists) {
      throw new Error(`Branch already exists: ${newBranchName}`);
    }

    await this.ensureCleanWorkingTree(cwd);
    await execCommand("git", ["checkout", "-b", newBranchName, baseBranch], {
      cwd,
    });
    await this.notifyGitMutation(cwd, "create-branch");
  }

  /** Check whether a local branch exists. */
  async doesLocalBranchExist(cwd: string, branch: string): Promise<boolean> {
    assertSafeGitRef(branch, "branch");
    return this.context.workspaceGitService.hasLocalBranch(cwd, branch);
  }

  // --- Stash handlers ---

  /** Handle stash save request — push uncommitted changes to a git stash. */
  async handleStashSaveRequest(
    msg: Extract<SessionInboundMessage, { type: "stash_save_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    try {
      const branchLabel = msg.branch?.trim() ?? "";
      const message = branchLabel
        ? `${CHISACODE_STASH_PREFIX} ${branchLabel}`
        : `${CHISACODE_STASH_PREFIX} unnamed`;
      await execCommand("git", ["stash", "push", "--include-untracked", "-m", message], {
        cwd,
      });
      await this.notifyGitMutation(cwd, "stash-push");
      this.context.checkoutDiffManager.scheduleRefreshForCwd(cwd);
      this.context.emit({
        type: "stash_save_response",
        payload: { cwd, success: true, error: null, requestId },
      });
    } catch (error) {
      this.context.emit({
        type: "stash_save_response",
        payload: { cwd, success: false, error: toCheckoutError(error), requestId },
      });
    }
  }

  /** Handle stash pop request — apply and drop a stash by index. */
  async handleStashPopRequest(
    msg: Extract<SessionInboundMessage, { type: "stash_pop_request" }>,
  ): Promise<void> {
    const { cwd, stashIndex, requestId } = msg;
    try {
      await execCommand("git", ["stash", "pop", `stash@{${stashIndex}}`], {
        cwd,
      });
      await this.notifyGitMutation(cwd, "stash-pop");
      this.context.checkoutDiffManager.scheduleRefreshForCwd(cwd);
      this.context.emit({
        type: "stash_pop_response",
        payload: { cwd, success: true, error: null, requestId },
      });
    } catch (error) {
      this.context.emit({
        type: "stash_pop_response",
        payload: { cwd, success: false, error: toCheckoutError(error), requestId },
      });
    }
  }

  /** Handle stash list request — list ChisaCode-managed stashes in the repository. */
  async handleStashListRequest(
    msg: Extract<SessionInboundMessage, { type: "stash_list_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    const chisacodeOnly = msg.chisacodeOnly !== false;
    try {
      const entries = await this.context.workspaceGitService.listStashes(cwd, { chisacodeOnly });

      this.context.emit({
        type: "stash_list_response",
        payload: { cwd, entries, error: null, requestId },
      });
    } catch (error) {
      this.context.emit({
        type: "stash_list_response",
        payload: { cwd, entries: [], error: toCheckoutError(error), requestId },
      });
    }
  }

  // --- Checkout status / validate / suggestions ---

  /** Handle checkout status request — returns current branch, dirty state, PR status, etc. */
  async handleCheckoutStatusRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_status_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    const resolvedCwd = expandTilde(cwd);
    try {
      const peeked = this.context.workspaceGitService.peekSnapshot(resolvedCwd);
      const snapshot =
        peeked ??
        (await this.context.workspaceGitService.getSnapshot(resolvedCwd, {
          includeGitHub: false,
          reason: "checkout-status",
        }));
      this.context.emit({
        type: "checkout_status_response",
        payload: buildCheckoutStatusPayloadFromSnapshot({ cwd, requestId, snapshot }),
      });
    } catch (error) {
      this.context.emit({
        type: "checkout_status_response",
        payload: {
          cwd,
          isGit: false,
          repoRoot: null,
          currentBranch: null,
          isDirty: null,
          baseRef: null,
          aheadBehind: null,
          aheadOfOrigin: null,
          behindOfOrigin: null,
          hasRemote: false,
          remoteUrl: null,
          isChisaCodeOwnedWorktree: false,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  /** Handle branch validation request — resolve a branch name to local/remote/not-found. */
  async handleValidateBranchRequest(
    msg: Extract<SessionInboundMessage, { type: "validate_branch_request" }>,
  ): Promise<void> {
    const { cwd, branchName, requestId } = msg;
    try {
      const resolvedCwd = expandTilde(cwd);
      assertSafeGitRef(branchName, "branch");
      const resolution = await this.context.workspaceGitService.validateBranchRef(
        resolvedCwd,
        branchName,
      );
      switch (resolution.kind) {
        case "local":
          this.context.emit({
            type: "validate_branch_response",
            payload: {
              exists: true,
              resolvedRef: resolution.name,
              isRemote: false,
              error: null,
              requestId,
            },
          });
          return;
        case "remote-only":
          this.context.emit({
            type: "validate_branch_response",
            payload: {
              exists: true,
              resolvedRef: resolution.remoteRef,
              isRemote: true,
              error: null,
              requestId,
            },
          });
          return;
        case "not-found":
          this.context.emit({
            type: "validate_branch_response",
            payload: { exists: false, resolvedRef: null, isRemote: false, error: null, requestId },
          });
          return;
        default: {
          const exhaustiveCheck: never = resolution;
          throw new Error(`Unhandled branch resolution: ${getErrorMessage(exhaustiveCheck)}`);
        }
      }
    } catch (error) {
      this.context.emit({
        type: "validate_branch_response",
        payload: {
          exists: false,
          resolvedRef: null,
          isRemote: false,
          error: error instanceof Error ? error.message : String(error),
          requestId,
        },
      });
    }
  }

  /** Handle branch suggestions request — fuzzy match branch names for autocomplete. */
  async handleBranchSuggestionsRequest(
    msg: Extract<SessionInboundMessage, { type: "branch_suggestions_request" }>,
  ): Promise<void> {
    const { cwd, query, limit, requestId } = msg;
    try {
      const resolvedCwd = expandTilde(cwd);
      const branchDetails = await this.context.workspaceGitService.suggestBranchesForCwd(
        resolvedCwd,
        { query, limit },
      );
      this.context.emit({
        type: "branch_suggestions_response",
        payload: {
          branches: branchDetails.map((b) => b.name),
          branchDetails,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "branch_suggestions_response",
        payload: {
          branches: [],
          branchDetails: [],
          error: error instanceof Error ? error.message : String(error),
          requestId,
        },
      });
    }
  }

  /** Handle GitHub issue/PR search request. */
  async handleGitHubSearchRequest(
    msg: Extract<SessionInboundMessage, { type: "github_search_request" }>,
  ): Promise<void> {
    const { cwd, query, limit, kinds, requestId } = msg;
    try {
      const resolvedCwd = expandTilde(cwd);
      const result = await this.context.github.searchIssuesAndPrs({
        cwd: resolvedCwd,
        query,
        limit,
        kinds,
      });
      this.context.emit({
        type: "github_search_response",
        payload: {
          items: result.items,
          githubFeaturesEnabled: result.githubFeaturesEnabled,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "github_search_response",
        payload: {
          items: [],
          githubFeaturesEnabled: true,
          error: error instanceof Error ? error.message : String(error),
          requestId,
        },
      });
    }
  }

  /** Handle directory suggestions request — fuzzy match directories for workspace paths. */
  async handleDirectorySuggestionsRequest(msg: DirectorySuggestionsRequest): Promise<void> {
    const { query, limit, requestId, cwd, includeFiles, includeDirectories, matchMode } = msg;
    try {
      const workspaceCwd = cwd?.trim();
      const entries = workspaceCwd
        ? await searchWorkspaceEntries({
            cwd: expandTilde(workspaceCwd),
            query,
            limit,
            includeFiles,
            includeDirectories,
            matchMode,
          })
        : (
            await searchHomeDirectories({ homeDir: process.env.HOME ?? homedir(), query, limit })
          ).map((path) => ({ path, kind: "directory" as const }));
      const directories = entries.filter((e) => e.kind === "directory").map((e) => e.path);
      this.context.emit({
        type: "directory_suggestions_response",
        payload: { directories, entries, error: null, requestId },
      });
    } catch (error) {
      this.context.emit({
        type: "directory_suggestions_response",
        payload: {
          directories: [],
          entries: [],
          error: error instanceof Error ? error.message : String(error),
          requestId,
        },
      });
    }
  }

  // --- Checkout diff subscriptions ---

  /** Handle checkout diff subscription request — subscribe to live diff updates for a workspace. */
  async handleSubscribeCheckoutDiffRequest(msg: SubscribeCheckoutDiffRequest): Promise<void> {
    const cwd = expandTilde(msg.cwd);
    this.checkoutDiffSubscriptions.get(msg.subscriptionId)?.();
    this.checkoutDiffSubscriptions.delete(msg.subscriptionId);
    const subscription = await this.context.checkoutDiffManager.subscribe(
      { cwd, compare: msg.compare },
      (snapshot) => {
        this.context.emit({
          type: "checkout_diff_update",
          payload: { subscriptionId: msg.subscriptionId, ...snapshot },
        });
      },
    );
    this.checkoutDiffSubscriptions.set(msg.subscriptionId, subscription.unsubscribe);
    this.context.emit({
      type: "subscribe_checkout_diff_response",
      payload: {
        subscriptionId: msg.subscriptionId,
        ...subscription.initial,
        requestId: msg.requestId,
      },
    });
  }

  /** Handle checkout diff unsubscription request. */
  handleUnsubscribeCheckoutDiffRequest(msg: UnsubscribeCheckoutDiffRequest): void {
    this.checkoutDiffSubscriptions.get(msg.subscriptionId)?.();
    this.checkoutDiffSubscriptions.delete(msg.subscriptionId);
  }

  /** Emit a checkout status update message to the client for a given cwd and git snapshot. */
  emitCheckoutStatusUpdate(cwd: string, snapshot: WorkspaceGitRuntimeSnapshot): void {
    try {
      const requestId = `subscription:${cwd}`;
      this.context.emit({
        type: "checkout_status_update",
        payload: {
          ...buildCheckoutStatusPayloadFromSnapshot({ cwd, requestId, snapshot }),
          prStatus: buildCheckoutPrStatusPayloadFromSnapshot({ cwd, requestId, snapshot }),
        },
      });
    } catch (error) {
      this.context.sessionLogger.warn(
        { err: error, cwd },
        "Failed to emit workspace checkout status update",
      );
    }
  }

  // --- Branch operations ---

  /** Handle switching to a different branch. */
  async handleCheckoutSwitchBranchRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_switch_branch_request" }>,
  ): Promise<void> {
    const { cwd, branch, requestId } = msg;
    try {
      const checkoutResult = await this.checkoutExistingBranch(cwd, branch);
      this.context.checkoutDiffManager.scheduleRefreshForCwd(cwd);
      await this.context.emitWorkspaceUpdateForCwd(cwd);
      this.context.emit({
        type: "checkout_switch_branch_response",
        payload: {
          cwd,
          success: true,
          branch,
          source: checkoutResult.source,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "checkout_switch_branch_response",
        payload: { cwd, success: false, branch, error: toCheckoutError(error), requestId },
      });
    }
  }

  /** Handle renaming the current branch. */
  async handleCheckoutRenameBranchRequest(msg: CheckoutRenameBranchRequest): Promise<void> {
    const { cwd, branch, requestId } = msg;
    const validation = validateBranchSlug(branch);
    if (!validation.valid) {
      this.context.emit({
        type: "checkout.rename_branch.response",
        payload: {
          cwd,
          success: false,
          currentBranch: null,
          error: toCheckoutError(new Error(validation.error ?? "Invalid branch name")),
          requestId,
        },
      });
      return;
    }
    try {
      const result = await renameCurrentBranch(cwd, branch);
      await this.notifyGitMutation(cwd, "rename-branch", { invalidateGithub: true });
      this.context.checkoutDiffManager.scheduleRefreshForCwd(cwd);
      this.context.handleWorkspaceGitBranchSnapshot(cwd, result.currentBranch);
      await this.context.emitWorkspaceUpdateForCwd(cwd);
      this.context.emit({
        type: "checkout.rename_branch.response",
        payload: {
          cwd,
          success: true,
          currentBranch: result.currentBranch,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "checkout.rename_branch.response",
        payload: {
          cwd,
          success: false,
          currentBranch: null,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  /** Handle commit request — stage and commit with optional auto-generated message. */
  async handleCheckoutCommitRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_commit_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    try {
      let message = msg.message?.trim() ?? "";
      if (!message) {
        message = await this.context.generateCommitMessage(cwd);
      }
      if (!message) {
        throw new Error("Commit message is required");
      }
      await commitChanges(cwd, { message, addAll: msg.addAll ?? true });
      await this.notifyGitMutation(cwd, "commit-changes");
      this.context.checkoutDiffManager.scheduleRefreshForCwd(cwd);
      this.context.emit({
        type: "checkout_commit_response",
        payload: { cwd, success: true, error: null, requestId },
      });
    } catch (error) {
      this.context.emit({
        type: "checkout_commit_response",
        payload: { cwd, success: false, error: toCheckoutError(error), requestId },
      });
    }
  }

  // --- Merge / pull / push / refresh ---

  /** Handle merge-to-base request — merge current branch into a base branch. */
  async handleCheckoutMergeRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_merge_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    try {
      const snapshot = await this.context.workspaceGitService.getSnapshot(cwd);
      if (!snapshot.git.isGit) {
        throw new Error(`Not a git repository: ${cwd}`);
      }
      if (msg.requireCleanTarget && snapshot.git.isDirty) {
        throw new Error("Working directory has uncommitted changes.");
      }
      let baseRef = msg.baseRef ?? snapshot.git.baseRef;
      if (!baseRef) {
        throw new Error("Base branch is required for merge");
      }
      if (baseRef.startsWith("origin/")) {
        baseRef = baseRef.slice("origin/".length);
      }
      const mutatedCwd = await mergeToBase(
        cwd,
        { baseRef, mode: msg.strategy === "squash" ? "squash" : "merge" },
        { chisacodeHome: this.context.chisacodeHome },
      );
      await Promise.all([
        this.notifyGitMutation(mutatedCwd, "merge-to-base", { invalidateGithub: true }),
        ...(mutatedCwd !== cwd ? [this.notifyGitMutation(cwd, "merge-to-base")] : []),
      ]);
      this.context.checkoutDiffManager.scheduleRefreshForCwd(cwd);
      this.context.emit({
        type: "checkout_merge_response",
        payload: { cwd, success: true, error: null, requestId },
      });
    } catch (error) {
      this.context.emit({
        type: "checkout_merge_response",
        payload: { cwd, success: false, error: toCheckoutError(error), requestId },
      });
    }
  }

  /** Handle merge-from-base request — merge a base branch into the current branch. */
  async handleCheckoutMergeFromBaseRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_merge_from_base_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    try {
      if (msg.requireCleanTarget ?? true) {
        const snapshot = await this.context.workspaceGitService.getSnapshot(cwd);
        if (snapshot.git.isDirty) {
          throw new Error("Working directory has uncommitted changes.");
        }
      }
      await mergeFromBase(cwd, {
        baseRef: msg.baseRef,
        requireCleanTarget: msg.requireCleanTarget ?? true,
      });
      await this.notifyGitMutation(cwd, "merge-from-base", { invalidateGithub: true });
      this.context.checkoutDiffManager.scheduleRefreshForCwd(cwd);
      this.context.emit({
        type: "checkout_merge_from_base_response",
        payload: { cwd, success: true, error: null, requestId },
      });
    } catch (error) {
      this.context.emit({
        type: "checkout_merge_from_base_response",
        payload: { cwd, success: false, error: toCheckoutError(error), requestId },
      });
    }
  }

  /** Handle pull request — fetch and merge remote changes into the current branch. */
  async handleCheckoutPullRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_pull_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    try {
      await pullCurrentBranch(cwd);
      await this.notifyGitMutation(cwd, "pull", { invalidateGithub: true });
      this.context.checkoutDiffManager.scheduleRefreshForCwd(cwd);
      this.context.emit({
        type: "checkout_pull_response",
        payload: { cwd, success: true, error: null, requestId },
      });
    } catch (error) {
      this.context.emit({
        type: "checkout_pull_response",
        payload: { cwd, success: false, error: toCheckoutError(error), requestId },
      });
    }
  }

  /** Handle push request — push the current branch to the remote. */
  async handleCheckoutPushRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_push_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    try {
      await pushCurrentBranch(cwd);
      await this.notifyGitMutation(cwd, "push", { invalidateGithub: true });
      this.context.emit({
        type: "checkout_push_response",
        payload: { cwd, success: true, error: null, requestId },
      });
    } catch (error) {
      this.context.emit({
        type: "checkout_push_response",
        payload: { cwd, success: false, error: toCheckoutError(error), requestId },
      });
    }
  }

  /** Handle checkout refresh request — force-refresh git snapshot and GitHub status for a workspace. */
  async handleCheckoutRefreshRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout.refresh.request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    try {
      this.context.github.invalidate({ cwd });
      await this.context.workspaceGitService.getSnapshot(cwd, {
        force: true,
        includeGitHub: true,
        reason: "manual-refresh",
      });
      this.context.checkoutDiffManager.scheduleRefreshForCwd(cwd);
      this.context.emit({
        type: "checkout.refresh.response",
        payload: { cwd, success: true, error: null, requestId },
      });
    } catch (error) {
      this.context.emit({
        type: "checkout.refresh.response",
        payload: { cwd, success: false, error: toCheckoutError(error), requestId },
      });
    }
  }

  // --- PR operations ---

  /** Handle PR create request — create a GitHub pull request from the current branch. */
  async handleCheckoutPrCreateRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_pr_create_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    try {
      let title = msg.title?.trim() ?? "";
      let body = msg.body?.trim() ?? "";
      if (!title || !body) {
        const generated = await this.context.generatePullRequestText(cwd, msg.baseRef);
        if (!title) title = generated.title;
        if (!body) body = generated.body;
      }
      const result = await createPullRequest(
        cwd,
        { title, body, base: msg.baseRef },
        this.context.github,
      );
      await this.notifyGitMutation(cwd, "create-pr", { invalidateGithub: true });
      this.context.emit({
        type: "checkout_pr_create_response",
        payload: {
          cwd,
          url: result.url ?? null,
          number: result.number ?? null,
          error: null,
          requestId,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "checkout_pr_create_response",
        payload: { cwd, url: null, number: null, error: toCheckoutError(error), requestId },
      });
    }
  }

  /** Handle PR merge request — merge a GitHub pull request with the chosen method. */
  async handleCheckoutPrMergeRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_pr_merge_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    try {
      const pullRequest = await this.resolveCurrentPullRequest(cwd, "merge", {
        force: true,
        includeGitHub: true,
        reason: "merge-pr-validation",
      });
      this.assertCurrentPullRequestHasGithubMergeFacts(pullRequest);
      await this.context.github.mergePullRequest({
        cwd,
        prNumber: pullRequest.number,
        mergeMethod: msg.mergeMethod,
        status: pullRequest,
      });
      await this.notifyGitMutation(cwd, "merge-pr", { invalidateGithub: true });
      this.context.emit({
        type: "checkout_pr_merge_response",
        payload: { cwd, success: true, error: null, requestId },
      });
    } catch (error) {
      this.context.emit({
        type: "checkout_pr_merge_response",
        payload: { cwd, success: false, error: toCheckoutError(error), requestId },
      });
    }
  }

  /** Handle GitHub auto-merge toggle request — enable or disable auto-merge for a PR. */
  async handleCheckoutGithubSetAutoMergeRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout.github.set_auto_merge.request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    try {
      const pullRequest = await this.resolveCurrentPullRequest(cwd, "auto-merge", {
        force: true,
        includeGitHub: true,
        reason: "auto-merge-validation",
      });
      if (msg.enabled) {
        const mergeMethod = msg.mergeMethod;
        if (!mergeMethod) {
          throw new Error("mergeMethod is required when enabling auto-merge");
        }
        assertPullRequestAutoMergeEnableReady({ mergeMethod, status: pullRequest });
        await this.context.github.enablePullRequestAutoMerge({
          cwd,
          prNumber: pullRequest.number,
          mergeMethod,
          status: pullRequest,
        });
      } else {
        if (msg.mergeMethod) {
          throw new Error("mergeMethod is not allowed when disabling auto-merge");
        }
        assertPullRequestAutoMergeDisableReady({ status: pullRequest });
        await this.context.github.disablePullRequestAutoMerge({
          cwd,
          prNumber: pullRequest.number,
          status: pullRequest,
        });
      }
      await this.notifyGitMutation(
        cwd,
        msg.enabled ? "enable-pr-auto-merge" : "disable-pr-auto-merge",
        { invalidateGithub: true },
      );
      this.context.emit({
        type: "checkout.github.set_auto_merge.response",
        payload: { cwd, enabled: msg.enabled, success: true, error: null, requestId },
      });
    } catch (error) {
      this.context.emit({
        type: "checkout.github.set_auto_merge.response",
        payload: {
          cwd,
          enabled: msg.enabled,
          success: false,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  /** Handle PR status request — return the current PR status for a workspace. */
  async handleCheckoutPrStatusRequest(
    msg: Extract<SessionInboundMessage, { type: "checkout_pr_status_request" }>,
  ): Promise<void> {
    const { cwd, requestId } = msg;
    try {
      const snapshot = await this.context.workspaceGitService.getSnapshot(cwd);
      this.context.emit({
        type: "checkout_pr_status_response",
        payload: buildCheckoutPrStatusPayloadFromSnapshot({ cwd, requestId, snapshot }),
      });
    } catch (error) {
      this.context.emit({
        type: "checkout_pr_status_response",
        payload: {
          cwd,
          status: null,
          githubFeaturesEnabled: true,
          error: toCheckoutError(error),
          requestId,
        },
      });
    }
  }

  /** Handle pull request timeline request — fetch the timeline of events for a GitHub PR. */
  async handlePullRequestTimelineRequest(
    msg: Extract<SessionInboundMessage, { type: "pull_request_timeline_request" }>,
  ): Promise<void> {
    const { cwd, prNumber, repoOwner, repoName, requestId } = msg;
    if (!isValidPullRequestTimelineIdentity({ prNumber, repoOwner, repoName })) {
      this.context.emit({
        type: "pull_request_timeline_response",
        payload: {
          cwd,
          prNumber,
          items: [],
          truncated: false,
          error: {
            kind: "unknown",
            message: "Pull request timeline request has invalid PR identity",
          },
          requestId,
          githubFeaturesEnabled: true,
        },
      });
      return;
    }
    const githubFeaturesEnabled = await this.context.github.isAuthenticated({ cwd });
    if (!githubFeaturesEnabled) {
      this.context.emit({
        type: "pull_request_timeline_response",
        payload: {
          cwd,
          prNumber,
          items: [],
          truncated: false,
          error: { kind: "unknown", message: "GitHub CLI is unavailable or not authenticated" },
          requestId,
          githubFeaturesEnabled: false,
        },
      });
      return;
    }
    try {
      const timeline = await this.context.github.getPullRequestTimeline({
        cwd,
        prNumber,
        repoOwner,
        repoName,
      });
      this.context.emit({
        type: "pull_request_timeline_response",
        payload: {
          cwd,
          prNumber: timeline.prNumber,
          items: timeline.items.map(toPullRequestTimelinePayloadItem),
          truncated: timeline.truncated,
          error: timeline.error,
          requestId,
          githubFeaturesEnabled: true,
        },
      });
    } catch (error) {
      this.context.emit({
        type: "pull_request_timeline_response",
        payload: {
          cwd,
          prNumber,
          items: [],
          truncated: false,
          error: {
            kind: "unknown",
            message: error instanceof Error ? error.message : String(error),
          },
          requestId,
          githubFeaturesEnabled: true,
        },
      });
    }
  }

  // --- PR helpers ---

  private async resolveCurrentPullRequest(
    cwd: string,
    operation: "merge" | "auto-merge",
    options?: WorkspaceGitSnapshotOptions,
  ): Promise<CurrentWorkspacePullRequest> {
    const snapshot = await this.context.workspaceGitService.getSnapshot(cwd, options);
    const pullRequest = snapshot.github.pullRequest;
    if (!pullRequest || typeof pullRequest.number !== "number") {
      throw new Error(`Unable to determine GitHub pull request number for ${operation}`);
    }
    return { ...pullRequest, number: pullRequest.number };
  }

  private assertCurrentPullRequestHasGithubMergeFacts(
    pullRequest: CurrentWorkspacePullRequest,
  ): void {
    if (!pullRequest.github) {
      throw new Error("GitHub merge facts are unavailable for this pull request");
    }
  }
}

// --- File-level helpers ---

/** Validate that a pull request timeline request has a valid PR identity. */
function isValidPullRequestTimelineIdentity(options: {
  prNumber: number;
  repoOwner: string;
  repoName: string;
}): boolean {
  if (!Number.isInteger(options.prNumber) || options.prNumber <= 0) {
    return false;
  }
  return isValidGitHubRepoSegment(options.repoOwner) && isValidGitHubRepoSegment(options.repoName);
}

/** Validate that a GitHub repo segment (owner or name) is safe. */
function isValidGitHubRepoSegment(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

/** Convert a pull request timeline item to its wire payload (strip author URL). */
function toPullRequestTimelinePayloadItem(
  item: PullRequestTimelineItem,
): PullRequestTimelinePayloadItem {
  const { authorUrl: _authorUrl, ...payload } = item;
  return payload;
}
