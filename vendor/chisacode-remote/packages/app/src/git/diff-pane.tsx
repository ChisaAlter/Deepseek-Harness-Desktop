import { useState, useCallback, useEffect, useMemo, useRef, memo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { DiffStat } from "@/components/diff-stat";
import {
  View,
  Text,
  Pressable,
  FlatList,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { BORDER_WIDTH, LINE_HEIGHT, SPACING, type Theme } from "@/styles/theme";
import {
  Archive,
  ArrowDownUp,
  Download,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  RefreshCcw,
  Upload,
} from "lucide-react-native";

const ThemedArchive = withUnistyles(Archive);
const ThemedArrowDownUp = withUnistyles(ArrowDownUp);
const ThemedDownload = withUnistyles(Download);
const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedGitCommitHorizontal = withUnistyles(GitCommitHorizontal);
const ThemedGitMerge = withUnistyles(GitMerge);
const ThemedRefreshCcw = withUnistyles(RefreshCcw);
const ThemedUpload = withUnistyles(Upload);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
import { useCheckoutDiffQuery, type ParsedDiffFile } from "@/git/use-diff-query";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useCheckoutPrStatusQuery } from "@/git/use-pr-status-query";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { shouldAnchorHeaderBeforeCollapse } from "@/git/diff-scroll";
import { buildSplitDiffRows } from "@/utils/diff-layout";

import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { GitHubIcon as GitHubIconBase } from "@/components/icons/github-icon";

const GitHubIcon = withUnistyles(GitHubIconBase);
import { ErrorBoundary, SectionErrorFallback } from "@/components/error-boundary";
import { useWebScrollViewScrollbar } from "@/components/use-web-scrollbar";
import { useGitActions } from "@/git/use-actions";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { usePanelStore } from "@/stores/panel-store";
import { buildWorkspaceExplorerStateKey } from "@/hooks/use-file-explorer-actions";

import { isWeb, isNative } from "@/constants/platform";
import {
  buildWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import {
  buildReviewDraftScopeKey,
  buildReviewDraftKey,
  useActiveReviewDraftMode,
  useReviewAttachmentSnapshot,
  useSetActiveReviewDraftMode,
  type ReviewDraftMode,
  useInlineReviewController,
} from "@/review";
import { buildReviewSummaryModel } from "@/git/review-summary";
import { DiffPaneControls, ReviewSummaryBand } from "@/git/diff-pane-controls";
import { DiffFileBody } from "@/git/diff-file-body";
import {
  DiffPaneBody,
  type DiffPaneFlatItem,
  type DiffPaneFlatItemLayoutGetter,
} from "@/git/diff-pane-body";

export type { GitActionId, GitAction, GitActions } from "@/git/policy";

function fileHeaderPressableStyle({ pressed }: PressableStateCallbackType) {
  return [styles.fileHeader, pressed && styles.fileHeaderPressed];
}

interface DiffFileSectionProps {
  file: ParsedDiffFile;
  isExpanded: boolean;
  onToggle: (path: string) => void;
  onHeaderHeightChange?: (path: string, height: number) => void;
  testID?: string;
}
const DiffFileHeader = memo(function DiffFileHeader({
  file,
  isExpanded,
  onToggle,
  onHeaderHeightChange,
  testID,
}: DiffFileSectionProps) {
  const { t } = useTranslation();
  const layoutYRef = useRef<number | null>(null);
  const pressHandledRef = useRef(false);
  const pressInRef = useRef<{ ts: number; pageX: number; pageY: number } | null>(null);

  const toggleExpanded = useCallback(() => {
    pressHandledRef.current = true;
    onToggle(file.path);
  }, [file.path, onToggle]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      layoutYRef.current = event.nativeEvent.layout.y;
      onHeaderHeightChange?.(file.path, event.nativeEvent.layout.height);
    },
    [file.path, onHeaderHeightChange],
  );

  const handlePressIn = useCallback((event: { nativeEvent: { pageX: number; pageY: number } }) => {
    pressHandledRef.current = false;
    pressInRef.current = {
      ts: Date.now(),
      pageX: event.nativeEvent.pageX,
      pageY: event.nativeEvent.pageY,
    };
  }, []);

  const handlePressOut = useCallback(
    (event: { nativeEvent: { pageX: number; pageY: number } }) => {
      if (isNative && !pressHandledRef.current && layoutYRef.current === 0 && pressInRef.current) {
        const durationMs = Date.now() - pressInRef.current.ts;
        const dx = event.nativeEvent.pageX - pressInRef.current.pageX;
        const dy = event.nativeEvent.pageY - pressInRef.current.pageY;
        const distance = Math.hypot(dx, dy);
        if (durationMs <= 500 && distance <= 12) {
          toggleExpanded();
        }
      }
    },
    [toggleExpanded],
  );

  const containerStyle = useMemo(
    () => [styles.fileSectionHeaderContainer, isExpanded && styles.fileSectionHeaderExpanded],
    [isExpanded],
  );

  const fileAccessibilityState = useMemo(() => ({ expanded: isExpanded }), [isExpanded]);

  return (
    <View style={containerStyle} onLayout={handleLayout} testID={testID}>
      <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <Pressable
            testID={testID ? `${testID}-toggle` : undefined}
            style={fileHeaderPressableStyle}
            accessibilityRole="button"
            accessibilityLabel={isExpanded ? t("git.collapseFile") : t("git.expandFile")}
            accessibilityState={fileAccessibilityState}
            // Android: prevent parent pan/scroll gestures from canceling the tap release.
            cancelable={false}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            onPress={toggleExpanded}
          >
            <View style={styles.fileHeaderLeft}>
              <Text style={styles.fileName} numberOfLines={1}>
                {file.path.split("/").pop()}
              </Text>
              <Text style={styles.fileDir} numberOfLines={1}>
                {file.path.includes("/")
                  ? ` ${file.path.slice(0, file.path.lastIndexOf("/"))}`
                  : ""}
              </Text>
              {file.isNew && (
                <View style={styles.newBadge}>
                  <Text style={styles.newBadgeText}>{t("git.newFile")}</Text>
                </View>
              )}
              {file.isDeleted && (
                <View style={styles.deletedBadge}>
                  <Text style={styles.deletedBadgeText}>{t("git.deletedFile")}</Text>
                </View>
              )}
            </View>
            <View style={styles.fileHeaderRight}>
              <DiffStat additions={file.additions} deletions={file.deletions} />
            </View>
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" offset={6} maxWidth={520}>
          <Text style={styles.tooltipText}>{file.path}</Text>
        </TooltipContent>
      </Tooltip>
    </View>
  );
});

interface GitDiffPaneProps {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  hideHeaderRow?: boolean;
  enabled?: boolean;
}

function getUnifiedDiffLineCount(file: ParsedDiffFile): number {
  let lineCount = 0;
  for (const hunk of file.hunks) {
    lineCount += hunk.lines.length;
  }
  return lineCount;
}

function getDiffContentLength(file: ParsedDiffFile): number {
  let contentLength = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      contentLength += line.content.length;
    }
  }
  return contentLength;
}

function computeEmptyMessage(
  hideWhitespace: boolean,
  diffMode: "uncommitted" | "base",
  baseRefLabel: string,
  copy: {
    noVisibleChangesAfterWhitespace: string;
    noUncommittedChanges: string;
    noChangesVs: (baseRef: string) => string;
  },
): string {
  if (hideWhitespace) {
    return copy.noVisibleChangesAfterWhitespace;
  }
  if (diffMode === "uncommitted") {
    return copy.noUncommittedChanges;
  }
  return copy.noChangesVs(baseRefLabel);
}

interface DeriveStatusStateInputs {
  status: ReturnType<typeof useCheckoutStatusQuery>["status"];
  isStatusLoading: boolean;
  isStatusError: boolean;
  statusError: unknown;
}

interface DerivedStatusState {
  gitStatus: NonNullable<ReturnType<typeof useCheckoutStatusQuery>["status"]> | null;
  isGit: boolean;
  notGit: boolean;
  statusErrorMessage: string | null;
  baseRef: string | undefined;
  hasUncommittedChanges: boolean;
  actionsDisabled: boolean;
}

function deriveStatusState({
  status,
  isStatusLoading,
  isStatusError,
  statusError,
}: DeriveStatusStateInputs): DerivedStatusState {
  const gitStatus = status && status.isGit ? status : null;
  const isGit = Boolean(gitStatus);
  const notGit = status !== null && !status.isGit && !status.error;
  const statusErrorMessage =
    status?.error?.message ??
    (isStatusError && statusError instanceof Error ? statusError.message : null);
  const baseRef = gitStatus?.baseRef ?? undefined;
  const hasUncommittedChanges = Boolean(gitStatus?.isDirty);
  const actionsDisabled = !isGit || Boolean(status?.error) || isStatusLoading;
  return {
    gitStatus,
    isGit,
    notGit,
    statusErrorMessage,
    baseRef,
    hasUncommittedChanges,
    actionsDisabled,
  };
}

function computeBaseRefLabel(baseRef: string | undefined): string {
  if (!baseRef) return "base";
  const trimmed = baseRef.replace(/^refs\/(heads|remotes)\//, "").trim();
  return trimmed.startsWith("origin/") ? trimmed.slice("origin/".length) : trimmed;
}

function computeCommittedDiffDescription(
  branchLabel: string,
  baseRefLabel: string,
): string | undefined {
  if (!branchLabel || !baseRefLabel) {
    return undefined;
  }
  return branchLabel === baseRefLabel ? undefined : `${branchLabel} -> ${baseRefLabel}`;
}

function computePrErrorMessage(
  githubFeaturesEnabled: boolean,
  prPayloadError: { message?: string } | null | undefined,
): string | null {
  if (!githubFeaturesEnabled) return null;
  return prPayloadError?.message ?? null;
}

function shouldEnableCheckoutDiff(input: { paneEnabled: boolean; isGit: boolean }): boolean {
  return input.paneEnabled && input.isGit;
}

function shouldShowReviewSummaryBand(input: {
  isGit: boolean;
  hasChanges: boolean;
  pullRequestLabel: string | null;
}): boolean {
  return input.isGit && (input.hasChanges || input.pullRequestLabel !== null);
}

export function GitDiffPane({
  serverId,
  workspaceId,
  cwd,
  hideHeaderRow,
  enabled,
}: GitDiffPaneProps) {
  const { t } = useTranslation();
  const isMobile = useIsCompactFormFactor();
  const showDesktopWebScrollbar = isWeb && !isMobile;
  const canUseSplitLayout = isWeb && !isMobile;
  const [diffModeOverride, setDiffModeOverride] = useState<ReviewDraftMode | null>(null);
  const { preferences: changesPreferences, updatePreferences: updateChangesPreferences } =
    useChangesPreferences();
  const wrapLines = changesPreferences.wrapLines;
  const effectiveLayout = canUseSplitLayout ? changesPreferences.layout : "unified";

  const handleToggleWrapLines = useCallback(() => {
    void updateChangesPreferences({ wrapLines: !wrapLines });
  }, [updateChangesPreferences, wrapLines]);

  const handleLayoutChange = useCallback(
    (nextLayout: "unified" | "split") => {
      void updateChangesPreferences({ layout: nextLayout });
    },
    [updateChangesPreferences],
  );

  const handleToggleHideWhitespace = useCallback(() => {
    void updateChangesPreferences({ hideWhitespace: !changesPreferences.hideWhitespace });
  }, [changesPreferences.hideWhitespace, updateChangesPreferences]);

  // handleSelectUncommitted/handleSelectBase are defined later, after reviewDraftScopeKey
  // and setActiveReviewMode are available, so they can record the active review mode.

  const toast = useToast();
  const refreshSupported = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.checkoutRefresh === true,
  );
  const runRefresh = useCheckoutGitActionsStore((s) => s.refresh);
  const isRefreshing =
    useCheckoutGitActionsStore((s) => s.getStatus({ serverId, cwd, actionId: "refresh" })) ===
    "pending";

  const handleRefresh = useCallback(() => {
    if (isRefreshing) {
      return;
    }
    void runRefresh({ serverId, cwd }).catch((error) => {
      toast.error(error instanceof Error ? error.message : t("git.refreshFailed"));
    });
  }, [cwd, isRefreshing, runRefresh, serverId, t, toast]);

  const {
    status,
    isLoading: isStatusLoading,
    isError: isStatusError,
    error: statusError,
  } = useCheckoutStatusQuery({ serverId, cwd });
  const statusState = deriveStatusState({ status, isStatusLoading, isStatusError, statusError });
  const { isGit, notGit, statusErrorMessage, baseRef, hasUncommittedChanges } = statusState;

  // Auto-select diff mode based on state: uncommitted when dirty, base when clean
  const autoDiffMode: ReviewDraftMode = hasUncommittedChanges ? "uncommitted" : "base";
  const reviewDraftScopeKey = useMemo(
    () =>
      buildReviewDraftScopeKey({
        serverId,
        workspaceId,
        cwd,
        baseRef,
        ignoreWhitespace: changesPreferences.hideWhitespace,
      }),
    [baseRef, changesPreferences.hideWhitespace, cwd, serverId, workspaceId],
  );
  const activeReviewMode = useActiveReviewDraftMode({ scopeKey: reviewDraftScopeKey });
  const diffMode = diffModeOverride ?? activeReviewMode ?? autoDiffMode;

  const {
    files,
    payloadError: diffPayloadError,
    isLoading: isDiffLoading,
  } = useCheckoutDiffQuery({
    serverId,
    cwd,
    mode: diffMode,
    baseRef,
    ignoreWhitespace: changesPreferences.hideWhitespace,
    enabled: shouldEnableCheckoutDiff({ paneEnabled: enabled !== false, isGit }),
  });
  const reviewDraftKey = useMemo(
    () =>
      buildReviewDraftKey({
        serverId,
        workspaceId,
        cwd,
        mode: diffMode,
        baseRef,
        ignoreWhitespace: changesPreferences.hideWhitespace,
      }),
    [baseRef, changesPreferences.hideWhitespace, cwd, diffMode, serverId, workspaceId],
  );
  const setActiveReviewMode = useSetActiveReviewDraftMode();

  const handleSelectUncommitted = useCallback(() => {
    setDiffModeOverride("uncommitted");
    setActiveReviewMode({ scopeKey: reviewDraftScopeKey, mode: "uncommitted" });
  }, [reviewDraftScopeKey, setActiveReviewMode]);

  const handleSelectBase = useCallback(() => {
    setDiffModeOverride("base");
    setActiveReviewMode({ scopeKey: reviewDraftScopeKey, mode: "base" });
  }, [reviewDraftScopeKey, setActiveReviewMode]);

  const reviewActions = useInlineReviewController({
    reviewDraftKey,
  });
  const reviewAttachment = useReviewAttachmentSnapshot({
    key: reviewDraftKey,
    diffFiles: files,
    cwd,
    mode: diffMode,
    baseRef,
  });
  const workspaceAttachmentScopeKey = useMemo(
    () => buildWorkspaceAttachmentScopeKey({ serverId, workspaceId, cwd }),
    [cwd, serverId, workspaceId],
  );
  const setWorkspaceAttachments = useWorkspaceAttachmentsStore(
    (state) => state.setWorkspaceAttachments,
  );
  const clearWorkspaceAttachments = useWorkspaceAttachmentsStore(
    (state) => state.clearWorkspaceAttachments,
  );

  useEffect(() => {
    setWorkspaceAttachments({
      scopeKey: workspaceAttachmentScopeKey,
      attachments: reviewAttachment ? [reviewAttachment] : [],
    });

    return () => {
      clearWorkspaceAttachments({ scopeKey: workspaceAttachmentScopeKey });
    };
  }, [
    clearWorkspaceAttachments,
    reviewAttachment,
    setWorkspaceAttachments,
    workspaceAttachmentScopeKey,
  ]);
  const {
    status: pullRequestStatus,
    githubFeaturesEnabled,
    payloadError: prPayloadError,
  } = useCheckoutPrStatusQuery({
    serverId,
    cwd,
    enabled: isGit,
  });
  const normalizedWorkspaceRoot = useMemo(() => cwd.trim(), [cwd]);
  const workspaceStateKey = useMemo(
    () =>
      buildWorkspaceExplorerStateKey({
        workspaceId,
        workspaceRoot: normalizedWorkspaceRoot,
      }),
    [normalizedWorkspaceRoot, workspaceId],
  );
  const expandedPathsArray = usePanelStore((state) =>
    workspaceStateKey ? state.diffExpandedPathsByWorkspace[workspaceStateKey] : undefined,
  );
  const setDiffExpandedPathsForWorkspace = usePanelStore(
    (state) => state.setDiffExpandedPathsForWorkspace,
  );
  const expandedPaths = useMemo(() => new Set(expandedPathsArray ?? []), [expandedPathsArray]);
  const diffListRef = useRef<FlatList<DiffPaneFlatItem>>(null);
  const scrollbar = useWebScrollViewScrollbar(diffListRef, {
    enabled: showDesktopWebScrollbar,
  });
  const diffListScrollOffsetRef = useRef(0);
  const diffListViewportHeightRef = useRef(0);
  const headerHeightByPathRef = useRef<Record<string, number>>({});
  const bodyHeightByKeyRef = useRef<Record<string, number>>({});
  const defaultHeaderHeightRef = useRef<number>(44);
  const [heightVersion, setHeightVersion] = useState(0);
  const diffBodyLineHeight = LINE_HEIGHT.diff;
  const diffBodyChromeHeight = BORDER_WIDTH[1] * 2;
  const statusBodyHeightEstimate = diffBodyChromeHeight + SPACING[4] * 2 + diffBodyLineHeight;
  const { flatItems, stickyHeaderIndices } = useMemo(() => {
    const items: DiffPaneFlatItem[] = [];
    const stickyIndices: number[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isExpanded = expandedPaths.has(file.path);
      items.push({ type: "header", file, fileIndex: i, isExpanded });
      if (isExpanded) {
        stickyIndices.push(items.length - 1);
      }
      if (isExpanded) {
        items.push({ type: "body", file, fileIndex: i });
      }
    }
    return { flatItems: items, stickyHeaderIndices: stickyIndices };
  }, [expandedPaths, files]);

  const getBodyHeightKey = useCallback(
    (file: ParsedDiffFile): string => {
      if (file.status === "too_large" || file.status === "binary") {
        return `${effectiveLayout}:${wrapLines ? "wrap" : "scroll"}:${file.path}:${file.status}`;
      }

      return [
        effectiveLayout,
        wrapLines ? "wrap" : "scroll",
        file.path,
        file.status ?? "ok",
        file.additions,
        file.deletions,
        file.hunks.length,
        getUnifiedDiffLineCount(file),
        getDiffContentLength(file),
      ].join(":");
    },
    [effectiveLayout, wrapLines],
  );

  const estimateBodyHeight = useCallback(
    (file: ParsedDiffFile): number => {
      if (file.status === "too_large" || file.status === "binary") {
        return statusBodyHeightEstimate;
      }

      const lineCount =
        effectiveLayout === "split"
          ? buildSplitDiffRows(file).length
          : getUnifiedDiffLineCount(file);
      return diffBodyChromeHeight + lineCount * diffBodyLineHeight;
    },
    [diffBodyChromeHeight, diffBodyLineHeight, effectiveLayout, statusBodyHeightEstimate],
  );

  const handleHeaderHeightChange = useCallback((path: string, height: number) => {
    if (!Number.isFinite(height) || height <= 0) {
      return;
    }
    const previousHeight = headerHeightByPathRef.current[path];
    if (
      previousHeight !== undefined &&
      Math.abs(previousHeight - height) <= DIFF_HEIGHT_CHANGE_EPSILON
    ) {
      return;
    }
    headerHeightByPathRef.current[path] = height;
    defaultHeaderHeightRef.current = height;
    setHeightVersion((version) => version + 1);
  }, []);

  const handleBodyHeightChange = useCallback(
    (file: ParsedDiffFile, height: number) => {
      if (!Number.isFinite(height) || height < 0) {
        return;
      }
      const heightKey = getBodyHeightKey(file);
      const previousHeight = bodyHeightByKeyRef.current[heightKey];
      if (
        previousHeight !== undefined &&
        Math.abs(previousHeight - height) <= DIFF_HEIGHT_CHANGE_EPSILON
      ) {
        return;
      }
      bodyHeightByKeyRef.current[heightKey] = height;
      setHeightVersion((version) => version + 1);
    },
    [getBodyHeightKey],
  );

  const handleDiffListScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      diffListScrollOffsetRef.current = event.nativeEvent.contentOffset.y;
      scrollbar.onScroll(event);
    },
    [scrollbar],
  );

  const handleDiffListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      if (!Number.isFinite(height) || height <= 0) {
        return;
      }
      diffListViewportHeightRef.current = height;
      scrollbar.onLayout(event);
    },
    [scrollbar],
  );

  const computeHeaderOffset = useCallback(
    (path: string): number => {
      const defaultHeaderHeight = defaultHeaderHeightRef.current;
      let offset = 0;
      for (const file of files) {
        if (file.path === path) {
          break;
        }
        offset += headerHeightByPathRef.current[file.path] ?? defaultHeaderHeight;
        if (expandedPaths.has(file.path)) {
          const bodyHeightKey = getBodyHeightKey(file);
          offset += bodyHeightByKeyRef.current[bodyHeightKey] ?? estimateBodyHeight(file);
        }
      }
      return Math.max(0, offset);
    },
    [estimateBodyHeight, expandedPaths, files, getBodyHeightKey],
  );

  const handleToggleExpanded = useCallback(
    (path: string) => {
      if (!workspaceStateKey) {
        return;
      }
      const isCurrentlyExpanded = expandedPaths.has(path);
      const nextExpanded = !isCurrentlyExpanded;
      const targetOffset = isCurrentlyExpanded ? computeHeaderOffset(path) : null;
      const headerHeight = headerHeightByPathRef.current[path] ?? defaultHeaderHeightRef.current;
      const shouldAnchor =
        isCurrentlyExpanded &&
        targetOffset !== null &&
        shouldAnchorHeaderBeforeCollapse({
          headerOffset: targetOffset,
          headerHeight,
          viewportOffset: diffListScrollOffsetRef.current,
          viewportHeight: diffListViewportHeightRef.current,
        });

      // Anchor to the clicked header before collapsing so visual context is preserved.
      if (shouldAnchor && targetOffset !== null) {
        diffListRef.current?.scrollToOffset({
          offset: targetOffset,
          animated: false,
        });
      }

      const nextPaths = nextExpanded
        ? [...expandedPaths, path]
        : Array.from(expandedPaths).filter((expandedPath) => expandedPath !== path);
      setDiffExpandedPathsForWorkspace(workspaceStateKey, nextPaths);
    },
    [computeHeaderOffset, expandedPaths, setDiffExpandedPathsForWorkspace, workspaceStateKey],
  );

  const allExpanded = useMemo(() => {
    if (files.length === 0) return false;
    return files.every((file) => expandedPaths.has(file.path));
  }, [expandedPaths, files]);

  const handleToggleExpandAll = useCallback(() => {
    if (!workspaceStateKey) {
      return;
    }
    if (allExpanded) {
      setDiffExpandedPathsForWorkspace(workspaceStateKey, []);
    } else {
      setDiffExpandedPathsForWorkspace(
        workspaceStateKey,
        files.map((file) => file.path),
      );
    }
  }, [allExpanded, files, setDiffExpandedPathsForWorkspace, workspaceStateKey]);

  // Clear diff mode override when auto mode changes (e.g., after commit)
  useEffect(() => {
    setDiffModeOverride(null);
  }, [autoDiffMode]);

  const renderFlatItem = useCallback(
    ({ item }: { item: DiffPaneFlatItem }) => {
      if (item.type === "header") {
        return (
          <DiffFileHeader
            file={item.file}
            isExpanded={item.isExpanded}
            onToggle={handleToggleExpanded}
            onHeaderHeightChange={handleHeaderHeightChange}
            testID={`diff-file-${item.fileIndex}`}
          />
        );
      }
      return (
        <DiffFileBody
          file={item.file}
          layout={effectiveLayout}
          wrapLines={wrapLines}
          reviewActions={reviewActions}
          onBodyHeightChange={handleBodyHeightChange}
          testID={`diff-file-${item.fileIndex}-body`}
        />
      );
    },
    [
      effectiveLayout,
      handleBodyHeightChange,
      handleHeaderHeightChange,
      handleToggleExpanded,
      reviewActions,
      wrapLines,
    ],
  );

  const flatKeyExtractor = useCallback(
    (item: DiffPaneFlatItem) => `${item.type}-${item.file.path}`,
    [],
  );

  const getFlatItemHeight = useCallback(
    (item: DiffPaneFlatItem): number => {
      if (item.type === "header") {
        return headerHeightByPathRef.current[item.file.path] ?? defaultHeaderHeightRef.current;
      }

      const bodyHeightKey = getBodyHeightKey(item.file);
      return bodyHeightByKeyRef.current[bodyHeightKey] ?? estimateBodyHeight(item.file);
    },
    [estimateBodyHeight, getBodyHeightKey],
  );

  const getFlatItemLayout = useCallback<DiffPaneFlatItemLayoutGetter>(
    (_data, index) => {
      let offset = 0;
      for (let itemIndex = 0; itemIndex < index; itemIndex += 1) {
        const item = flatItems[itemIndex];
        if (item) {
          offset += getFlatItemHeight(item);
        }
      }

      const item = flatItems[index];
      const length = item ? getFlatItemHeight(item) : 0;
      return { length, offset, index };
    },
    [flatItems, getFlatItemHeight],
  );

  const flatExtraData = useMemo(
    () => ({
      expandedPathsArray,
      effectiveLayout,
      heightVersion,
      wrapLines,
      reviewActions,
    }),
    [expandedPathsArray, effectiveLayout, heightVersion, wrapLines, reviewActions],
  );

  const hasChanges = files.length > 0;
  const diffErrorMessage = diffPayloadError?.message ?? null;
  const prErrorMessage = computePrErrorMessage(githubFeaturesEnabled, prPayloadError);
  const reviewSummaryModel = useMemo(
    () => buildReviewSummaryModel({ files, pullRequestStatus }),
    [files, pullRequestStatus],
  );
  const shouldShowReviewSummary = shouldShowReviewSummaryBand({
    isGit,
    hasChanges,
    pullRequestLabel: reviewSummaryModel.pullRequestLabel,
  });
  const baseRefLabel = useMemo(() => computeBaseRefLabel(baseRef), [baseRef]);
  const gitActionsIcons = useMemo(
    () => ({
      commit: <ThemedGitCommitHorizontal size={16} uniProps={foregroundMutedColorMapping} />,
      pull: <ThemedDownload size={16} uniProps={foregroundMutedColorMapping} />,
      push: <ThemedUpload size={16} uniProps={foregroundMutedColorMapping} />,
      pullAndPush: <ThemedArrowDownUp size={16} uniProps={foregroundMutedColorMapping} />,
      viewPr: <GitHubIcon size={16} uniProps={foregroundMutedColorMapping} />,
      createPr: <GitHubIcon size={16} uniProps={foregroundMutedColorMapping} />,
      mergePrSquash: <GitHubIcon size={16} uniProps={foregroundMutedColorMapping} />,
      mergePrMerge: <GitHubIcon size={16} uniProps={foregroundMutedColorMapping} />,
      mergePrRebase: <GitHubIcon size={16} uniProps={foregroundMutedColorMapping} />,
      merge: <ThemedGitMerge size={16} uniProps={foregroundMutedColorMapping} />,
      mergeFromBase: <ThemedRefreshCcw size={16} uniProps={foregroundMutedColorMapping} />,
      archive: <ThemedArchive size={16} uniProps={foregroundMutedColorMapping} />,
    }),
    [],
  );
  const { gitActions, branchLabel } = useGitActions({ serverId, cwd, icons: gitActionsIcons });
  const committedDiffDescription = useMemo(
    () => computeCommittedDiffDescription(branchLabel, baseRefLabel),
    [baseRefLabel, branchLabel],
  );

  const emptyMessage = computeEmptyMessage(
    changesPreferences.hideWhitespace,
    diffMode,
    baseRefLabel,
    {
      noVisibleChangesAfterWhitespace: t("git.noVisibleChangesAfterWhitespace"),
      noUncommittedChanges: t("git.noUncommittedChanges"),
      noChangesVs: (label) => t("git.noChangesVs", { baseRef: label }),
    },
  );

  const bodyContent: ReactElement = (
    <DiffPaneBody
      isStatusLoading={isStatusLoading}
      statusErrorMessage={statusErrorMessage}
      notGit={notGit}
      isDiffLoading={isDiffLoading}
      diffErrorMessage={diffErrorMessage}
      hasChanges={hasChanges}
      emptyMessage={emptyMessage}
      flatItems={flatItems}
      stickyHeaderIndices={stickyHeaderIndices}
      renderFlatItem={renderFlatItem}
      flatKeyExtractor={flatKeyExtractor}
      getFlatItemLayout={getFlatItemLayout}
      flatExtraData={flatExtraData}
      diffListRef={diffListRef}
      handleDiffListLayout={handleDiffListLayout}
      handleDiffListScroll={handleDiffListScroll}
      onContentSizeChange={scrollbar.onContentSizeChange}
      showDesktopWebScrollbar={showDesktopWebScrollbar}
    />
  );

  const diffFallback = useCallback(
    (error: unknown, resetError: () => void) => (
      <SectionErrorFallback
        error={error}
        onReset={resetError}
        sectionLabel={t("errors.sectionDiff")}
        compact
      />
    ),
    [t],
  );

  return (
    <ErrorBoundary fallback={diffFallback}>
      <View style={styles.container}>
        {!hideHeaderRow ? (
          <View style={styles.header} testID="changes-header">
            <View style={styles.headerLeft}>
              <ThemedGitBranch size={16} uniProps={foregroundMutedColorMapping} />
              <Text style={styles.branchLabel} testID="changes-branch" numberOfLines={1}>
                {branchLabel}
              </Text>
            </View>
            {/* Production single-write-path: Git write CTAs live on desktop topbar only. */}
          </View>
        ) : null}

        {isGit ? (
          <DiffPaneControls
            diffMode={diffMode}
            committedDiffDescription={committedDiffDescription}
            canUseSplitLayout={canUseSplitLayout}
            layout={changesPreferences.layout}
            hideWhitespace={changesPreferences.hideWhitespace}
            wrapLines={wrapLines}
            allExpanded={allExpanded}
            hasFiles={files.length > 0}
            isMobile={isMobile}
            refreshSupported={refreshSupported}
            isRefreshing={isRefreshing}
            onSelectUncommitted={handleSelectUncommitted}
            onSelectBase={handleSelectBase}
            onLayoutChange={handleLayoutChange}
            onToggleHideWhitespace={handleToggleHideWhitespace}
            onToggleWrapLines={handleToggleWrapLines}
            onToggleExpandAll={handleToggleExpandAll}
            onRefresh={handleRefresh}
          />
        ) : null}
        {prErrorMessage ? <Text style={styles.actionErrorText}>{prErrorMessage}</Text> : null}
        {shouldShowReviewSummary ? (
          <ReviewSummaryBand
            model={reviewSummaryModel}
            diffModeLabel={diffMode === "uncommitted" ? t("git.uncommitted") : t("git.committed")}
            gitActions={gitActions}
            // Desktop write CTAs live on the soft topbar only.
            // Compact/mobile has no soft topbar Git control, so restore a single write path here.
            showGitActions={isMobile}
          />
        ) : null}

        <View style={styles.diffContainer} accessibilityLabel={t("git.changesPanel")}>
          {bodyContent}
          {hasChanges ? scrollbar.overlay : null}
        </View>
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    // Soft quiet chrome rule (--border-soft).
    borderBottomColor: theme.colors.secondary,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
  },
  // Soft branch meta: 12.5.
  branchLabel: {
    fontSize: 12.5,
    lineHeight: 18,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
  },
  actionErrorText: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.destructive,
  },
  diffContainer: {
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  fileSection: {
    overflow: "hidden",
    backgroundColor: theme.colors.surface0,
    borderBottomWidth: 1,
    // Soft quiet list divider (--border-soft).
    borderBottomColor: theme.colors.secondary,
  },
  fileSectionHeaderContainer: {
    overflow: "hidden",
  },
  fileSectionHeaderExpanded: {
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  fileHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[1],
    minWidth: 0,
    zIndex: 2,
    elevation: 2,
  },
  fileHeaderPressed: {
    opacity: 0.7,
  },
  fileHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    minWidth: 0,
  },
  fileHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  // Soft file list label: 12.5 meta.
  fileName: {
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
    flexShrink: 1,
    minWidth: 0,
  },
  fileDir: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
    flex: 1,
    minWidth: 0,
  },
  newBadge: {
    backgroundColor: "rgba(46, 160, 67, 0.2)",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: 10,
    flexShrink: 0,
  },
  newBadgeText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.diffAddition,
  },
  deletedBadge: {
    backgroundColor: "rgba(248, 81, 73, 0.2)",
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: 10,
    flexShrink: 0,
  },
  deletedBadgeText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.diffDeletion,
  },
  additions: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.diffAddition,
  },
  deletions: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.diffDeletion,
  },
  tooltipText: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foreground,
  },
}));

const DIFF_HEIGHT_CHANGE_EPSILON = 0.5;
