import {
  Archive,
  ArrowDownUp,
  Download,
  GitCommitHorizontal,
  GitMerge,
  RefreshCcw,
  Upload,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { GitHubIcon } from "@/components/icons/github-icon";
import { ThemedIconHost } from "@/components/themed-icon-host";
import { GitActionsSplitButton } from "@/git/actions-split-button";
import { resolveIdleGitButtonLabel } from "@/git/idle-git-button-label";
import { useGitActions } from "@/git/use-actions";
import type { GitActions } from "@/git/policy";
import type { Theme } from "@/styles/theme";

interface WorkspaceGitActionsProps {
  serverId: string;
  cwd: string;
  hideLabels?: boolean;
  /**
   * When the workspace header is still resolving checkout identity, keep the Git
   * button mounted in a loading state so Open/Git geometry never collapses.
   */
  forceLoading?: boolean;
  /**
   * Desktop topbar shows BranchSwitcher for the idle branch name.
   */
  hideIdlePrimary?: boolean;
}

const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const ICONS = {
  commit: <ThemedIconHost Icon={GitCommitHorizontal} size={16} uniProps={mutedColorMapping} />,
  pull: <ThemedIconHost Icon={Download} size={16} uniProps={mutedColorMapping} />,
  push: <ThemedIconHost Icon={Upload} size={16} uniProps={mutedColorMapping} />,
  pullAndPush: <ThemedIconHost Icon={ArrowDownUp} size={16} uniProps={mutedColorMapping} />,
  viewPr: <ThemedIconHost Icon={GitHubIcon} size={16} uniProps={mutedColorMapping} />,
  createPr: <ThemedIconHost Icon={GitHubIcon} size={16} uniProps={mutedColorMapping} />,
  mergePrSquash: <ThemedIconHost Icon={GitHubIcon} size={16} uniProps={mutedColorMapping} />,
  mergePrMerge: <ThemedIconHost Icon={GitHubIcon} size={16} uniProps={mutedColorMapping} />,
  mergePrRebase: <ThemedIconHost Icon={GitHubIcon} size={16} uniProps={mutedColorMapping} />,
  merge: <ThemedIconHost Icon={GitMerge} size={16} uniProps={mutedColorMapping} />,
  mergeFromBase: <ThemedIconHost Icon={RefreshCcw} size={16} uniProps={mutedColorMapping} />,
  archive: <ThemedIconHost Icon={Archive} size={16} uniProps={mutedColorMapping} />,
};

const EMPTY_GIT_ACTIONS: GitActions = {
  primary: null,
  secondary: [],
  menu: [],
};

export function WorkspaceGitActions({
  serverId,
  cwd,
  hideLabels,
  forceLoading = false,
  hideIdlePrimary = false,
}: WorkspaceGitActionsProps) {
  const { t } = useTranslation();
  const { gitActions, isGit, isStatusLoading, statusError, branchLabel } = useGitActions({
    serverId,
    cwd,
    icons: ICONS,
    // Keep status query warm while header is still resolving checkout identity.
    enabled: cwd.trim().length > 0,
  });

  const showLoading = forceLoading || isStatusLoading;

  // Always reserve the topbar Git slot once mounted.
  // Loading / non-git query lag / clean idle must not collapse the control next to Open.
  if (!isGit && !showLoading) {
    // Status resolved as not-git (or hard error with no git payload): keep a disabled button
    // so the header geometry stays stable instead of vanishing.
    return (
      <GitActionsSplitButton
        gitActions={EMPTY_GIT_ACTIONS}
        hideLabels={hideLabels}
        idleLabel={statusError ? t("git.refreshFailed") : t("git.notGitRepository")}
        hideIdlePrimary={hideIdlePrimary}
        loading={false}
      />
    );
  }

  return (
    <GitActionsSplitButton
      gitActions={isGit ? gitActions : EMPTY_GIT_ACTIONS}
      hideLabels={hideLabels}
      idleLabel={resolveIdleGitButtonLabel({
        branchLabel: hideIdlePrimary ? "" : branchLabel,
        fallback: t("git.actionUpToDate"),
      })}
      hideIdlePrimary={hideIdlePrimary}
      loading={showLoading && !isGit}
    />
  );
}
