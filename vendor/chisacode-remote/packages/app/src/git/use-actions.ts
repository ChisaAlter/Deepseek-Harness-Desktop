import { useState, useCallback, useEffect, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { router, type Href } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { type CheckoutGitActionStatus, useCheckoutGitActionsStore } from "@/git/actions-store";
import { type CheckoutStatusPayload, useCheckoutStatusQuery } from "@/git/use-status-query";
import { type CheckoutPrStatusPayload, useCheckoutPrStatusQuery } from "@/git/use-pr-status-query";
import { buildGitActions, narrowPullRequestState, type GitActions } from "@/git/policy";
import type { CheckoutPrMergeMethod } from "@chisacode/protocol/messages";
import { openExternalUrl } from "@/utils/open-external-url";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { resolveWorkspaceIdByExecutionDirectory } from "@/utils/workspace-execution";
import { buildWorkspaceArchiveRedirectRoute } from "@/utils/workspace-archive-navigation";
import { confirmRiskyWorktreeArchive } from "@/git/worktree-archive-warning";

export type { GitActionId, GitAction, GitActions } from "@/git/policy";

function openURLInNewTab(url: string): void {
  void openExternalUrl(url);
}

function isActionDisabled(actionsDisabled: boolean, status: CheckoutGitActionStatus): boolean {
  return actionsDisabled || status === "pending";
}

function resolveBranchLabel(input: {
  currentBranch: string | null | undefined;
  notGit: boolean;
}): string {
  if (input.currentBranch && input.currentBranch !== "HEAD") {
    return input.currentBranch;
  }
  if (input.notGit) {
    return "Not a git repository";
  }
  return "Unknown";
}

function formatBaseRefLabel(baseRef: string | undefined): string {
  if (!baseRef) return "base";
  const trimmed = baseRef.replace(/^refs\/(heads|remotes)\//, "").trim();
  return trimmed.startsWith("origin/") ? trimmed.slice("origin/".length) : trimmed;
}

type PrStatusValue = NonNullable<CheckoutPrStatusPayload["status"]> | null;

interface DeriveGitActionsStateArgs {
  isGit: boolean;
  status: CheckoutStatusPayload | null;
  gitStatus: CheckoutStatusPayload | null;
  prStatus: PrStatusValue;
  hasUncommittedChanges: boolean;
  postShipArchiveSuggested: boolean;
  isStatusLoading: boolean;
  baseRefLabel: string;
}

interface DerivedGitActionsState {
  actionsDisabled: boolean;
  aheadCount: number;
  behindBaseCount: number;
  aheadOfOrigin: number;
  behindOfOrigin: number;
  hasPullRequest: boolean;
  hasRemote: boolean;
  isChisaCodeOwnedWorktree: boolean;
  isOnBaseBranch: boolean;
  shouldPromoteArchive: boolean;
}

interface GitCommitCounts {
  aheadCount: number;
  behindBaseCount: number;
  aheadOfOrigin: number;
  behindOfOrigin: number;
}

function extractGitCommitCounts(gitStatus: CheckoutStatusPayload | null): GitCommitCounts {
  return {
    aheadCount: gitStatus?.aheadBehind?.ahead ?? 0,
    behindBaseCount: gitStatus?.aheadBehind?.behind ?? 0,
    aheadOfOrigin: gitStatus?.aheadOfOrigin ?? 0,
    behindOfOrigin: gitStatus?.behindOfOrigin ?? 0,
  };
}

function computeShouldPromoteArchive(input: {
  isChisaCodeOwnedWorktree: boolean;
  hasUncommittedChanges: boolean;
  postShipArchiveSuggested: boolean;
  isMergedPullRequest: boolean;
}): boolean {
  return (
    input.isChisaCodeOwnedWorktree &&
    !input.hasUncommittedChanges &&
    (input.postShipArchiveSuggested || input.isMergedPullRequest)
  );
}

function deriveGitActionsState(args: DeriveGitActionsStateArgs): DerivedGitActionsState {
  const {
    isGit,
    status,
    gitStatus,
    prStatus,
    hasUncommittedChanges,
    postShipArchiveSuggested,
    isStatusLoading,
    baseRefLabel,
  } = args;
  const actionsDisabled = !isGit || Boolean(status?.error) || isStatusLoading;
  const isChisaCodeOwnedWorktree = gitStatus?.isChisaCodeOwnedWorktree ?? false;
  const isMergedPullRequest = Boolean(prStatus?.isMerged);
  return {
    actionsDisabled,
    ...extractGitCommitCounts(gitStatus),
    hasPullRequest: Boolean(prStatus?.url),
    hasRemote: gitStatus?.hasRemote ?? false,
    isChisaCodeOwnedWorktree,
    isOnBaseBranch: gitStatus?.currentBranch === baseRefLabel,
    shouldPromoteArchive: computeShouldPromoteArchive({
      isChisaCodeOwnedWorktree,
      hasUncommittedChanges,
      postShipArchiveSuggested,
      isMergedPullRequest,
    }),
  };
}

interface UseGitActionsInput {
  serverId: string;
  cwd: string;
  enabled?: boolean;
  icons: {
    commit: ReactElement;
    pull: ReactElement;
    push: ReactElement;
    pullAndPush: ReactElement;
    viewPr: ReactElement;
    createPr: ReactElement;
    mergePrSquash: ReactElement;
    mergePrMerge: ReactElement;
    mergePrRebase: ReactElement;
    merge: ReactElement;
    mergeFromBase: ReactElement;
    archive: ReactElement;
  };
}

interface UseGitActionsResult {
  gitActions: GitActions;
  branchLabel: string;
  isGit: boolean;
  /** True while checkout status is still resolving (slot may reserve a loading placeholder). */
  isStatusLoading: boolean;
  /** Non-null when the last status query failed. */
  statusError: string | null;
}

function useGitActionStatusInputs(input: { serverId: string; cwd: string; enabled: boolean }) {
  const { status, isLoading: isStatusLoading } = useCheckoutStatusQuery({
    serverId: input.serverId,
    cwd: input.cwd,
    enabled: input.enabled,
  });
  const gitStatus = status && status.isGit ? status : null;
  const isGit = Boolean(gitStatus);
  const notGit = status !== null && !status.isGit && !status.error;
  const baseRef = gitStatus?.baseRef ?? undefined;
  const { status: prStatus, githubFeaturesEnabled } = useCheckoutPrStatusQuery({
    serverId: input.serverId,
    cwd: input.cwd,
    enabled: input.enabled && isGit,
  });
  const baseRefLabel = useMemo(() => formatBaseRefLabel(baseRef), [baseRef]);
  const branchLabel = resolveBranchLabel({
    currentBranch: gitStatus?.currentBranch,
    notGit,
  });

  return {
    status,
    gitStatus,
    isGit,
    baseRef,
    prStatus,
    githubFeaturesEnabled,
    baseRefLabel,
    branchLabel,
    isStatusLoading,
  };
}

export function useGitActions({
  serverId,
  cwd,
  enabled = true,
  icons,
}: UseGitActionsInput): UseGitActionsResult {
  const toast = useToast();
  const { t } = useTranslation();
  const [postShipArchiveSuggested, setPostShipArchiveSuggested] = useState(false);
  const [shipDefault, setShipDefault] = useState<"merge" | "pr">("merge");

  const {
    status,
    gitStatus,
    isGit,
    baseRef,
    prStatus,
    githubFeaturesEnabled,
    baseRefLabel,
    branchLabel,
    isStatusLoading,
  } = useGitActionStatusInputs({ serverId, cwd, enabled });

  const hasUncommittedChanges = Boolean(gitStatus?.isDirty);

  const worktreeArchiveCopy = useMemo(
    () => ({
      addedLines: (count: number) => t("git.archiveAddedLines", { count }),
      deletedLines: (count: number) => t("git.archiveDeletedLines", { count }),
      uncommittedChanges: t("git.archiveUncommittedChanges"),
      uncommittedChangesWithStat: (diffStat: string) =>
        t("git.archiveUncommittedChangesWithStat", { diffStat }),
      unpushedCommits: (count: number) => t("git.archiveUnpushedCommits", { count }),
      archiveTitle: (worktreeName: string) => t("git.archiveTitle", { worktreeName }),
      archiveConfirm: t("git.archiveConfirm"),
      cancel: t("common.cancel"),
    }),
    [t],
  );
  const gitActionCopy = useMemo(
    () => ({
      commit: t("git.actionCommit"),
      committing: t("git.actionCommitting"),
      committed: t("git.actionCommitted"),
      pull: t("git.actionPull"),
      pulling: t("git.actionPulling"),
      pulled: t("git.actionPulled"),
      push: t("git.actionPush"),
      pushing: t("git.actionPushing"),
      pushed: t("git.actionPushed"),
      pullAndPush: t("git.actionPullAndPush"),
      pullingAndPushing: t("git.actionPullingAndPushing"),
      pulledAndPushed: t("git.actionPulledAndPushed"),
      mergeLocally: t("git.actionMergeLocally"),
      merging: t("git.actionMerging"),
      merged: t("git.actionMerged"),
      updateFrom: (label: string) => t("git.actionUpdateFrom", { baseRef: label }),
      updating: t("git.actionUpdating"),
      updated: t("git.actionUpdated"),
      archiveWorktree: t("git.actionArchiveWorktree"),
      archiving: t("git.actionArchiving"),
      archived: t("git.actionArchived"),
      viewPr: t("git.actionViewPr"),
      createPr: t("git.actionCreatePr"),
      creatingPr: t("git.actionCreatingPr"),
      prCreated: t("git.actionPrCreated"),
      squashAndMerge: t("git.actionSquashAndMerge"),
      createMergeCommit: t("git.actionCreateMergeCommit"),
      rebaseAndMerge: t("git.actionRebaseAndMerge"),
      mergingPr: t("git.actionMergingPr"),
      prMerged: t("git.actionPrMerged"),
      enableAutoMergeSquash: t("git.actionEnableAutoMergeSquash"),
      enableAutoMergeMerge: t("git.actionEnableAutoMergeMerge"),
      enableAutoMergeRebase: t("git.actionEnableAutoMergeRebase"),
      enablingAutoMerge: t("git.actionEnablingAutoMerge"),
      autoMergeEnabled: t("git.actionAutoMergeEnabled"),
      disablingAutoMerge: t("git.actionDisablingAutoMerge"),
      autoMergeDisabled: t("git.actionAutoMergeDisabled"),
      unavailableArchiveNotOwned: t("git.unavailableArchiveNotOwned"),
      unavailableGithubViewPr: t("git.unavailableGithubViewPr"),
      unavailableAutoMergeDisable: t("git.unavailableAutoMergeDisable"),
      unavailablePullNoRemote: t("git.unavailablePullNoRemote"),
      unavailablePullLocalChanges: t("git.unavailablePullLocalChanges"),
      unavailablePullUpToDate: t("git.unavailablePullUpToDate"),
      unavailablePushNoRemote: t("git.unavailablePushNoRemote"),
      unavailablePushBehind: t("git.unavailablePushBehind"),
      unavailablePushNothingNew: t("git.unavailablePushNothingNew"),
      unavailablePullPushNoRemote: t("git.unavailablePullPushNoRemote"),
      unavailablePullPushLocalChanges: t("git.unavailablePullPushLocalChanges"),
      unavailablePullPushInSync: t("git.unavailablePullPushInSync"),
      unavailableCreatePrGithub: t("git.unavailableCreatePrGithub"),
      unavailableCreatePrNoCommits: t("git.unavailableCreatePrNoCommits"),
      unavailableMergeNoBase: t("git.unavailableMergeNoBase"),
      unavailableMergeLocalChanges: t("git.unavailableMergeLocalChanges"),
      unavailableMergeNothingNew: t("git.unavailableMergeNothingNew"),
      unavailableUpdateNoBase: t("git.unavailableUpdateNoBase"),
      unavailableUpdateLocalChanges: t("git.unavailableUpdateLocalChanges"),
      unavailableUpdateUpToDate: (label: string) =>
        t("git.unavailableUpdateUpToDate", { baseRef: label }),
      unavailableMergePrGithub: t("git.unavailableMergePrGithub"),
      unavailableMergePrMissing: t("git.unavailableMergePrMissing"),
      unavailableMergePrDraft: t("git.unavailableMergePrDraft"),
      unavailableMergePrMerged: t("git.unavailableMergePrMerged"),
      unavailableMergePrClosed: t("git.unavailableMergePrClosed"),
      unavailableMergePrConflicts: t("git.unavailableMergePrConflicts"),
      unavailableMergePrQueue: t("git.unavailableMergePrQueue"),
      unavailableMergePrNotReady: t("git.unavailableMergePrNotReady"),
    }),
    [t],
  );

  // Ship default persistence
  const shipDefaultStorageKey = useMemo(() => {
    if (!gitStatus?.repoRoot) {
      return null;
    }
    return `@chisacode:changes-ship-default:${gitStatus.repoRoot}`;
  }, [gitStatus?.repoRoot]);

  useEffect(() => {
    if (!shipDefaultStorageKey) {
      return;
    }
    let isActive = true;
    AsyncStorage.getItem(shipDefaultStorageKey)
      .then((value) => {
        if (!isActive) return;
        if (value === "pr" || value === "merge") {
          setShipDefault(value);
        }
        return;
      })
      .catch(() => undefined);
    return () => {
      isActive = false;
    };
  }, [shipDefaultStorageKey]);

  const persistShipDefault = useCallback(
    async (next: "merge" | "pr") => {
      setShipDefault(next);
      if (!shipDefaultStorageKey) return;
      try {
        await AsyncStorage.setItem(shipDefaultStorageKey, next);
      } catch {
        // Ignore persistence failures; default will reset to "merge".
      }
    },
    [shipDefaultStorageKey],
  );

  useEffect(() => {
    setPostShipArchiveSuggested(false);
  }, [cwd]);

  const commitStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "commit" }),
  );
  const pullStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "pull" }),
  );
  const pushStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "push" }),
  );
  const pullAndPushStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "pull-and-push" }),
  );
  const prCreateStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "create-pr" }),
  );
  const mergePrStatuses: Record<CheckoutPrMergeMethod, CheckoutGitActionStatus> = {
    squash: useCheckoutGitActionsStore((s) =>
      s.getStatus({ serverId, cwd, actionId: "merge-pr-squash" }),
    ),
    merge: useCheckoutGitActionsStore((s) =>
      s.getStatus({ serverId, cwd, actionId: "merge-pr-merge" }),
    ),
    rebase: useCheckoutGitActionsStore((s) =>
      s.getStatus({ serverId, cwd, actionId: "merge-pr-rebase" }),
    ),
  };
  const enablePrAutoMergeStatuses: Record<CheckoutPrMergeMethod, CheckoutGitActionStatus> = {
    squash: useCheckoutGitActionsStore((s) =>
      s.getStatus({ serverId, cwd, actionId: "enable-pr-auto-merge-squash" }),
    ),
    merge: useCheckoutGitActionsStore((s) =>
      s.getStatus({ serverId, cwd, actionId: "enable-pr-auto-merge-merge" }),
    ),
    rebase: useCheckoutGitActionsStore((s) =>
      s.getStatus({ serverId, cwd, actionId: "enable-pr-auto-merge-rebase" }),
    ),
  };
  const disablePrAutoMergeStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "disable-pr-auto-merge" }),
  );
  const mergeStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "merge-branch" }),
  );
  const mergeFromBaseStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "merge-from-base" }),
  );
  const archiveStatus = useCheckoutGitActionsStore((s) =>
    s.getStatus({ serverId, cwd, actionId: "archive-worktree" }),
  );

  const runCommit = useCheckoutGitActionsStore((s) => s.commit);
  const runPull = useCheckoutGitActionsStore((s) => s.pull);
  const runPush = useCheckoutGitActionsStore((s) => s.push);
  const runPullAndPush = useCheckoutGitActionsStore((s) => s.pullAndPush);
  const runCreatePr = useCheckoutGitActionsStore((s) => s.createPr);
  const runMergePr = useCheckoutGitActionsStore((s) => s.mergePr);
  const runEnablePrAutoMerge = useCheckoutGitActionsStore((s) => s.enablePrAutoMerge);
  const runDisablePrAutoMerge = useCheckoutGitActionsStore((s) => s.disablePrAutoMerge);
  const runMergeBranch = useCheckoutGitActionsStore((s) => s.mergeBranch);
  const runMergeFromBase = useCheckoutGitActionsStore((s) => s.mergeFromBase);
  const runArchiveWorktree = useCheckoutGitActionsStore((s) => s.archiveWorktree);
  const githubAutoMergeActionsEnabled = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.checkoutGithubSetAutoMerge === true,
  );

  const toastActionError = useCallback(
    (error: unknown, fallback: string) => {
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message);
    },
    [toast],
  );

  const toastActionSuccess = useCallback(
    (message: string) => {
      toast.show(message, { variant: "success" });
    },
    [toast],
  );

  // Handlers
  const handleCommit = useCallback(() => {
    void runCommit({ serverId, cwd })
      .then(() => {
        toastActionSuccess(gitActionCopy.committed);
        return;
      })
      .catch((err) => {
        toastActionError(err, t("git.actionFailedCommit"));
      });
  }, [cwd, gitActionCopy.committed, runCommit, serverId, t, toastActionError, toastActionSuccess]);

  const handlePull = useCallback(() => {
    void runPull({ serverId, cwd })
      .then(() => {
        toastActionSuccess(gitActionCopy.pulled);
        return;
      })
      .catch((err) => {
        toastActionError(err, t("git.actionFailedPull"));
      });
  }, [cwd, gitActionCopy.pulled, runPull, serverId, t, toastActionError, toastActionSuccess]);

  const handlePush = useCallback(() => {
    void runPush({ serverId, cwd })
      .then(() => {
        toastActionSuccess(gitActionCopy.pushed);
        return;
      })
      .catch((err) => {
        toastActionError(err, t("git.actionFailedPush"));
      });
  }, [cwd, gitActionCopy.pushed, runPush, serverId, t, toastActionError, toastActionSuccess]);

  const handlePullAndPush = useCallback(() => {
    void runPullAndPush({ serverId, cwd })
      .then(() => {
        toastActionSuccess(gitActionCopy.pulledAndPushed);
        return;
      })
      .catch((err) => {
        toastActionError(err, t("git.actionFailedPullAndPush"));
      });
  }, [
    cwd,
    gitActionCopy.pulledAndPushed,
    runPullAndPush,
    serverId,
    t,
    toastActionError,
    toastActionSuccess,
  ]);

  const handleCreatePr = useCallback(() => {
    void persistShipDefault("pr");
    void runCreatePr({ serverId, cwd })
      .then(() => {
        toastActionSuccess(gitActionCopy.prCreated);
        return;
      })
      .catch((err) => {
        toastActionError(err, t("git.actionFailedCreatePr"));
      });
  }, [
    cwd,
    gitActionCopy.prCreated,
    persistShipDefault,
    runCreatePr,
    serverId,
    t,
    toastActionError,
    toastActionSuccess,
  ]);

  const handleMergePr = useCallback(
    (method: CheckoutPrMergeMethod) => {
      void persistShipDefault("pr");
      void runMergePr({ serverId, cwd, method })
        .then(() => {
          setPostShipArchiveSuggested(true);
          toastActionSuccess(gitActionCopy.prMerged);
          return;
        })
        .catch((err) => {
          toastActionError(err, t("git.actionFailedMergePr"));
        });
    },
    [
      cwd,
      gitActionCopy.prMerged,
      persistShipDefault,
      runMergePr,
      serverId,
      t,
      toastActionError,
      toastActionSuccess,
    ],
  );

  const handleEnablePrAutoMerge = useCallback(
    (method: CheckoutPrMergeMethod) => {
      void persistShipDefault("pr");
      void runEnablePrAutoMerge({ serverId, cwd, method })
        .then(() => {
          toastActionSuccess(gitActionCopy.autoMergeEnabled);
          return;
        })
        .catch((err) => {
          toastActionError(err, t("git.actionFailedEnableAutoMerge"));
        });
    },
    [
      cwd,
      gitActionCopy.autoMergeEnabled,
      persistShipDefault,
      runEnablePrAutoMerge,
      serverId,
      t,
      toastActionError,
      toastActionSuccess,
    ],
  );

  const handleDisablePrAutoMerge = useCallback(() => {
    void runDisablePrAutoMerge({ serverId, cwd })
      .then(() => {
        toastActionSuccess(gitActionCopy.autoMergeDisabled);
        return;
      })
      .catch((err) => {
        toastActionError(err, t("git.actionFailedDisableAutoMerge"));
      });
  }, [
    cwd,
    gitActionCopy.autoMergeDisabled,
    runDisablePrAutoMerge,
    serverId,
    t,
    toastActionError,
    toastActionSuccess,
  ]);

  const handleMergeBranch = useCallback(() => {
    if (!baseRef) {
      toast.error(t("git.baseRefUnavailable"));
      return;
    }
    void persistShipDefault("merge");
    void runMergeBranch({ serverId, cwd, baseRef })
      .then(() => {
        setPostShipArchiveSuggested(true);
        toastActionSuccess(gitActionCopy.merged);
        return;
      })
      .catch((err) => {
        toastActionError(err, t("git.actionFailedMerge"));
      });
  }, [
    baseRef,
    cwd,
    gitActionCopy.merged,
    persistShipDefault,
    runMergeBranch,
    serverId,
    t,
    toast,
    toastActionError,
    toastActionSuccess,
  ]);

  const handleMergeFromBase = useCallback(() => {
    if (!baseRef) {
      toast.error(t("git.baseRefUnavailable"));
      return;
    }
    void runMergeFromBase({ serverId, cwd, baseRef })
      .then(() => {
        toastActionSuccess(gitActionCopy.updated);
        return;
      })
      .catch((err) => {
        toastActionError(err, t("git.actionFailedMergeFromBase"));
      });
  }, [
    baseRef,
    cwd,
    gitActionCopy.updated,
    runMergeFromBase,
    serverId,
    t,
    toast,
    toastActionError,
    toastActionSuccess,
  ]);

  const archiveWorktreeAfterConfirmation = useCallback(async () => {
    const worktreePath = status?.cwd;
    if (!worktreePath) {
      toast.error(t("git.worktreePathUnavailable"));
      return;
    }

    const workspaces = useSessionStore.getState().sessions[serverId]?.workspaces;
    const workspaceList = Array.from(workspaces?.values() ?? []);
    const workspace = workspaceList.find(
      (candidate) => candidate.workspaceDirectory === worktreePath,
    );
    const confirmed = await confirmRiskyWorktreeArchive({
      worktreeName: workspace?.name ?? branchLabel,
      isDirty: gitStatus?.isDirty,
      aheadOfOrigin: gitStatus?.aheadOfOrigin,
      diffStat: workspace?.diffStat ?? null,
      copy: worktreeArchiveCopy,
    });
    if (!confirmed) {
      return;
    }

    const archivedWorkspaceId =
      resolveWorkspaceIdByExecutionDirectory({
        workspaces: workspaceList,
        workspaceDirectory: worktreePath,
      }) ?? worktreePath;
    router.replace(
      buildWorkspaceArchiveRedirectRoute({
        serverId,
        archivedWorkspaceId,
        workspaces: workspaceList,
      }) as Href,
    );
    void runArchiveWorktree({ serverId, cwd, worktreePath }).catch((err) => {
      toastActionError(err, t("git.actionFailedArchiveWorktree"));
    });
  }, [
    branchLabel,
    cwd,
    gitStatus?.aheadOfOrigin,
    gitStatus?.isDirty,
    runArchiveWorktree,
    serverId,
    status?.cwd,
    t,
    toast,
    toastActionError,
    worktreeArchiveCopy,
  ]);

  const handleArchiveWorktree = useCallback(() => {
    void archiveWorktreeAfterConfirmation();
  }, [archiveWorktreeAfterConfirmation]);

  const derived = deriveGitActionsState({
    isGit,
    status,
    gitStatus,
    prStatus,
    hasUncommittedChanges,
    postShipArchiveSuggested,
    isStatusLoading,
    baseRefLabel,
  });
  const {
    actionsDisabled,
    aheadCount,
    behindBaseCount,
    aheadOfOrigin,
    behindOfOrigin,
    hasPullRequest,
    hasRemote,
    isChisaCodeOwnedWorktree,
    isOnBaseBranch,
    shouldPromoteArchive,
  } = derived;

  const handlePrAction = useCallback(() => {
    if (prStatus?.url) {
      openURLInNewTab(prStatus.url);
      return;
    }
    handleCreatePr();
  }, [prStatus?.url, handleCreatePr]);

  // Build actions
  const gitActions: GitActions = useMemo(() => {
    return buildGitActions({
      isGit,
      githubFeaturesEnabled,
      githubAutoMergeActionsEnabled,
      hasPullRequest,
      pullRequestUrl: prStatus?.url ?? null,
      pullRequestState: narrowPullRequestState(prStatus?.state),
      pullRequestIsDraft: prStatus?.isDraft ?? false,
      pullRequestIsMerged: prStatus?.isMerged ?? false,
      pullRequestMergeable: prStatus?.mergeable ?? "UNKNOWN",
      pullRequestGithub: prStatus?.github ?? null,
      hasRemote,
      isChisaCodeOwnedWorktree,
      isOnBaseBranch,
      hasUncommittedChanges,
      baseRefAvailable: Boolean(baseRef),
      baseRefLabel,
      aheadCount,
      behindBaseCount,
      aheadOfOrigin,
      behindOfOrigin,
      shouldPromoteArchive,
      shipDefault,
      runtime: {
        commit: {
          disabled: isActionDisabled(actionsDisabled, commitStatus),
          status: commitStatus,
          icon: icons.commit,
          handler: handleCommit,
        },
        pull: {
          disabled: isActionDisabled(actionsDisabled, pullStatus),
          status: pullStatus,
          icon: icons.pull,
          handler: handlePull,
        },
        push: {
          disabled: isActionDisabled(actionsDisabled, pushStatus),
          status: pushStatus,
          icon: icons.push,
          handler: handlePush,
        },
        "pull-and-push": {
          disabled: isActionDisabled(actionsDisabled, pullAndPushStatus),
          status: pullAndPushStatus,
          icon: icons.pullAndPush,
          handler: handlePullAndPush,
        },
        pr: {
          disabled: isActionDisabled(actionsDisabled, prCreateStatus),
          status: hasPullRequest ? "idle" : prCreateStatus,
          icon: hasPullRequest ? icons.viewPr : icons.createPr,
          handler: handlePrAction,
        },
        "merge-pr-squash": {
          disabled: isActionDisabled(actionsDisabled, mergePrStatuses.squash),
          status: mergePrStatuses.squash,
          icon: icons.mergePrSquash,
          handler: () => handleMergePr("squash"),
        },
        "merge-pr-merge": {
          disabled: isActionDisabled(actionsDisabled, mergePrStatuses.merge),
          status: mergePrStatuses.merge,
          icon: icons.mergePrMerge,
          handler: () => handleMergePr("merge"),
        },
        "merge-pr-rebase": {
          disabled: isActionDisabled(actionsDisabled, mergePrStatuses.rebase),
          status: mergePrStatuses.rebase,
          icon: icons.mergePrRebase,
          handler: () => handleMergePr("rebase"),
        },
        "enable-pr-auto-merge-squash": {
          disabled: isActionDisabled(actionsDisabled, enablePrAutoMergeStatuses.squash),
          status: enablePrAutoMergeStatuses.squash,
          icon: icons.mergePrSquash,
          handler: () => handleEnablePrAutoMerge("squash"),
        },
        "enable-pr-auto-merge-merge": {
          disabled: isActionDisabled(actionsDisabled, enablePrAutoMergeStatuses.merge),
          status: enablePrAutoMergeStatuses.merge,
          icon: icons.mergePrMerge,
          handler: () => handleEnablePrAutoMerge("merge"),
        },
        "enable-pr-auto-merge-rebase": {
          disabled: isActionDisabled(actionsDisabled, enablePrAutoMergeStatuses.rebase),
          status: enablePrAutoMergeStatuses.rebase,
          icon: icons.mergePrRebase,
          handler: () => handleEnablePrAutoMerge("rebase"),
        },
        "disable-pr-auto-merge": {
          disabled: isActionDisabled(actionsDisabled, disablePrAutoMergeStatus),
          status: disablePrAutoMergeStatus,
          icon: icons.viewPr,
          handler: handleDisablePrAutoMerge,
        },
        "merge-branch": {
          disabled: isActionDisabled(actionsDisabled, mergeStatus),
          status: mergeStatus,
          icon: icons.merge,
          handler: handleMergeBranch,
        },
        "merge-from-base": {
          disabled: isActionDisabled(actionsDisabled, mergeFromBaseStatus),
          status: mergeFromBaseStatus,
          icon: icons.mergeFromBase,
          handler: handleMergeFromBase,
        },
        "archive-worktree": {
          disabled: isActionDisabled(actionsDisabled, archiveStatus),
          status: archiveStatus,
          icon: icons.archive,
          handler: handleArchiveWorktree,
        },
      },
      copy: gitActionCopy,
    });
  }, [
    isGit,
    hasRemote,
    hasPullRequest,
    prStatus?.url,
    prStatus?.state,
    prStatus?.isDraft,
    prStatus?.isMerged,
    prStatus?.mergeable,
    prStatus?.github,
    aheadCount,
    behindBaseCount,
    isChisaCodeOwnedWorktree,
    isOnBaseBranch,
    githubFeaturesEnabled,
    githubAutoMergeActionsEnabled,
    hasUncommittedChanges,
    aheadOfOrigin,
    behindOfOrigin,
    shipDefault,
    baseRefLabel,
    shouldPromoteArchive,
    actionsDisabled,
    commitStatus,
    pullStatus,
    pushStatus,
    pullAndPushStatus,
    prCreateStatus,
    mergePrStatuses.squash,
    mergePrStatuses.merge,
    mergePrStatuses.rebase,
    enablePrAutoMergeStatuses.squash,
    enablePrAutoMergeStatuses.merge,
    enablePrAutoMergeStatuses.rebase,
    disablePrAutoMergeStatus,
    mergeStatus,
    mergeFromBaseStatus,
    archiveStatus,
    handleCommit,
    handlePull,
    handlePush,
    handlePullAndPush,
    handlePrAction,
    handleMergePr,
    handleEnablePrAutoMerge,
    handleDisablePrAutoMerge,
    handleMergeBranch,
    handleMergeFromBase,
    handleArchiveWorktree,
    gitActionCopy,
    icons,
    baseRef,
  ]);

  return {
    gitActions,
    branchLabel,
    isGit,
    isStatusLoading,
    statusError: status?.error ? String(status.error) : null,
  };
}
