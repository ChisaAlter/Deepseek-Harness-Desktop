import { useCallback, useMemo } from "react";
import {
  Pressable,
  Text,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useTranslation } from "react-i18next";
import {
  AlignJustify,
  ChevronDown,
  Columns2,
  ListChevronsDownUp,
  ListChevronsUpDown,
  Pilcrow,
  RotateCw,
  WrapText,
} from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WORKSPACE_SECONDARY_HEADER_HEIGHT } from "@/constants/layout";
import { GitActionsSplitButton } from "@/git/actions-split-button";
import type { GitActions } from "@/git/policy";
import type { ReviewSummaryModel } from "@/git/review-summary";
import { ICON_SIZE, type Theme } from "@/styles/theme";

interface DiffPaneControlsProps {
  diffMode: "uncommitted" | "base";
  committedDiffDescription?: string;
  canUseSplitLayout: boolean;
  layout: "unified" | "split";
  hideWhitespace: boolean;
  wrapLines: boolean;
  allExpanded: boolean;
  hasFiles: boolean;
  isMobile: boolean;
  refreshSupported: boolean;
  isRefreshing: boolean;
  onSelectUncommitted: () => void;
  onSelectBase: () => void;
  onLayoutChange: (layout: "unified" | "split") => void;
  onToggleHideWhitespace: () => void;
  onToggleWrapLines: () => void;
  onToggleExpandAll: () => void;
  onRefresh: () => void;
}

type PressableStyleFn = (
  state: PressableStateCallbackType & { hovered?: boolean; open?: boolean },
) => StyleProp<ViewStyle>;

const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const refreshIconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedAlignJustify = withUnistyles(AlignJustify);
const ThemedColumns2 = withUnistyles(Columns2);
const ThemedPilcrow = withUnistyles(Pilcrow);
const ThemedWrapText = withUnistyles(WrapText);
const ThemedListChevronsDownUp = withUnistyles(ListChevronsDownUp);
const ThemedListChevronsUpDown = withUnistyles(ListChevronsUpDown);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Renders diff mode, layout, whitespace, wrapping, expansion, and refresh controls. */
export function DiffPaneControls({
  diffMode,
  committedDiffDescription,
  canUseSplitLayout,
  layout,
  hideWhitespace,
  wrapLines,
  allExpanded,
  hasFiles,
  isMobile,
  refreshSupported,
  isRefreshing,
  onSelectUncommitted,
  onSelectBase,
  onLayoutChange,
  onToggleHideWhitespace,
  onToggleWrapLines,
  onToggleExpandAll,
  onRefresh,
}: DiffPaneControlsProps) {
  const { t } = useTranslation();

  const diffModeTriggerStyle = useMemo(() => buildDiffModeTriggerStyle(), []);
  const unifiedToggleStyle = useMemo(
    () =>
      buildToggleButtonStyle(layout === "unified", [
        styles.toggleButton,
        styles.toggleButtonGroupStart,
      ]),
    [layout],
  );
  const splitToggleStyle = useMemo(
    () =>
      buildToggleButtonStyle(layout === "split", [
        styles.toggleButton,
        styles.toggleButtonGroupEnd,
      ]),
    [layout],
  );
  const hideWhitespaceToggleStyle = useMemo(
    () => buildToggleButtonStyle(hideWhitespace, styles.iconButton),
    [hideWhitespace],
  );
  const wrapLinesToggleStyle = useMemo(
    () => buildToggleButtonStyle(wrapLines, styles.iconButton),
    [wrapLines],
  );
  const expandAllToggleStyle = useMemo(() => buildIconButtonStyle(), []);
  const refreshToggleStyle = useMemo(() => buildIconButtonStyle(), []);

  const handleLayoutUnified = useCallback(() => onLayoutChange("unified"), [onLayoutChange]);
  const handleLayoutSplit = useCallback(() => onLayoutChange("split"), [onLayoutChange]);

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <DropdownMenu>
          <DropdownMenuTrigger
            style={diffModeTriggerStyle}
            testID="changes-diff-status"
            accessibilityRole="button"
            accessibilityLabel={t("git.diffMode")}
          >
            <Text style={styles.diffStatusText} numberOfLines={1}>
              {diffMode === "uncommitted" ? t("git.uncommitted") : t("git.committed")}
            </Text>
            <ThemedChevronDown size={12} uniProps={foregroundMutedColorMapping} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" width={260} testID="changes-diff-status-menu">
            <DropdownMenuItem
              testID="changes-diff-mode-uncommitted"
              selected={diffMode === "uncommitted"}
              onSelect={onSelectUncommitted}
            >
              {t("git.uncommitted")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              testID="changes-diff-mode-committed"
              selected={diffMode === "base"}
              description={committedDiffDescription}
              onSelect={onSelectBase}
            >
              {t("git.committed")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <View style={styles.buttonRow}>
          {canUseSplitLayout ? (
            <DiffLayoutToggleGroup
              layout={layout}
              unifiedToggleStyle={unifiedToggleStyle}
              splitToggleStyle={splitToggleStyle}
              onUnified={handleLayoutUnified}
              onSplit={handleLayoutSplit}
            />
          ) : null}
          <DiffWhitespaceToggle
            hideWhitespace={hideWhitespace}
            isMobile={isMobile}
            toggleStyle={hideWhitespaceToggleStyle}
            onToggle={onToggleHideWhitespace}
          />
          {hasFiles ? (
            <DiffFilesToolbar
              wrapLines={wrapLines}
              allExpanded={allExpanded}
              isMobile={isMobile}
              wrapLinesToggleStyle={wrapLinesToggleStyle}
              expandAllToggleStyle={expandAllToggleStyle}
              onToggleWrapLines={onToggleWrapLines}
              onToggleExpandAll={onToggleExpandAll}
            />
          ) : null}
          {refreshSupported ? (
            <DiffRefreshButton
              isRefreshing={isRefreshing}
              toggleStyle={refreshToggleStyle}
              onPress={onRefresh}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** Renders review totals, pull-request state, and checks (read-only on desktop). */
export function ReviewSummaryBand({
  model,
  diffModeLabel,
  gitActions,
  showGitActions = false,
}: {
  model: ReviewSummaryModel;
  diffModeLabel: string;
  gitActions: GitActions;
  /** Desktop keeps write CTAs on the topbar only; mobile may still show compact actions. */
  showGitActions?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.reviewSummaryBand} testID="changes-review-summary">
      <View style={styles.reviewSummaryTextGroup}>
        <Text style={styles.reviewSummaryTitle}>{t("git.reviewMode")}</Text>
        <Text style={styles.reviewSummaryDescription} numberOfLines={1}>
          {t("git.reviewSummary", {
            count: model.changedFileCount,
            additions: model.additions,
            deletions: model.deletions,
            mode: diffModeLabel,
          })}
        </Text>
      </View>
      <View style={styles.reviewSummaryMeta}>
        {model.pullRequestLabel ? (
          <Text style={styles.reviewSummaryMetaText} numberOfLines={1}>
            {model.pullRequestLabel}
          </Text>
        ) : null}
        {model.pullRequestTerminalState ? (
          <Text style={styles.reviewSummaryMetaText} numberOfLines={1}>
            {t(`git.reviewPullRequestState.${model.pullRequestTerminalState}`)}
          </Text>
        ) : null}
        {model.checksStatus ? (
          <Text style={styles.reviewSummaryMetaText} numberOfLines={1}>
            {t(`git.reviewChecksStatus.${model.checksStatus}`)}
          </Text>
        ) : null}
        {model.reviewDecision ? (
          <Text style={styles.reviewSummaryMetaText} numberOfLines={1}>
            {t(`git.reviewDecision.${model.reviewDecision}`)}
          </Text>
        ) : null}
        {showGitActions ? <GitActionsSplitButton gitActions={gitActions} hideLabels /> : null}
      </View>
    </View>
  );
}

function DiffLayoutToggleGroup({
  layout,
  unifiedToggleStyle,
  splitToggleStyle,
  onUnified,
  onSplit,
}: {
  layout: "unified" | "split";
  unifiedToggleStyle: PressableStyleFn;
  splitToggleStyle: PressableStyleFn;
  onUnified: () => void;
  onSplit: () => void;
}) {
  const { t } = useTranslation();
  const unifiedColorMapping =
    layout === "unified" ? foregroundColorMapping : foregroundMutedColorMapping;
  const splitColorMapping =
    layout === "split" ? foregroundColorMapping : foregroundMutedColorMapping;
  return (
    <View style={styles.toggleButtonGroup}>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("git.unifiedDiff")}
            testID="changes-layout-unified"
            onPress={onUnified}
            style={unifiedToggleStyle}
          >
            <ThemedAlignJustify size={14} uniProps={unifiedColorMapping} />
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Text style={styles.tooltipText}>{t("git.unifiedDiff")}</Text>
        </TooltipContent>
      </Tooltip>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("git.splitDiff")}
            testID="changes-layout-split"
            onPress={onSplit}
            style={splitToggleStyle}
          >
            <ThemedColumns2 size={14} uniProps={splitColorMapping} />
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Text style={styles.tooltipText}>{t("git.splitDiff")}</Text>
        </TooltipContent>
      </Tooltip>
    </View>
  );
}

function DiffWhitespaceToggle({
  hideWhitespace,
  isMobile,
  toggleStyle,
  onToggle,
}: {
  hideWhitespace: boolean;
  isMobile: boolean;
  toggleStyle: PressableStyleFn;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const iconColorMapping = hideWhitespace ? foregroundColorMapping : foregroundMutedColorMapping;
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("git.hideWhitespace")}
          testID="changes-toggle-whitespace"
          style={toggleStyle}
          onPress={onToggle}
        >
          <ThemedPilcrow size={isMobile ? 18 : 14} uniProps={iconColorMapping} />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{t("git.hideWhitespace")}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function DiffFilesToolbar({
  wrapLines,
  allExpanded,
  isMobile,
  wrapLinesToggleStyle,
  expandAllToggleStyle,
  onToggleWrapLines,
  onToggleExpandAll,
}: {
  wrapLines: boolean;
  allExpanded: boolean;
  isMobile: boolean;
  wrapLinesToggleStyle: PressableStyleFn;
  expandAllToggleStyle: PressableStyleFn;
  onToggleWrapLines: () => void;
  onToggleExpandAll: () => void;
}) {
  const { t } = useTranslation();
  const wrapColorMapping = wrapLines ? foregroundColorMapping : foregroundMutedColorMapping;
  return (
    <View style={styles.buttonRow}>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <Pressable
            style={wrapLinesToggleStyle}
            onPress={onToggleWrapLines}
            accessibilityRole="button"
            accessibilityLabel={wrapLines ? t("git.scrollLongLines") : t("git.wrapLongLines")}
          >
            <ThemedWrapText size={isMobile ? 18 : 14} uniProps={wrapColorMapping} />
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Text style={styles.tooltipText}>
            {wrapLines ? t("git.scrollLongLines") : t("git.wrapLongLines")}
          </Text>
        </TooltipContent>
      </Tooltip>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <Pressable
            style={expandAllToggleStyle}
            onPress={onToggleExpandAll}
            accessibilityRole="button"
            accessibilityLabel={allExpanded ? t("git.collapseAllFiles") : t("git.expandAllFiles")}
          >
            {allExpanded ? (
              <ThemedListChevronsDownUp
                size={isMobile ? 18 : 14}
                uniProps={foregroundMutedColorMapping}
              />
            ) : (
              <ThemedListChevronsUpDown
                size={isMobile ? 18 : 14}
                uniProps={foregroundMutedColorMapping}
              />
            )}
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Text style={styles.tooltipText}>
            {allExpanded ? t("git.collapseAllFiles") : t("git.expandAllFiles")}
          </Text>
        </TooltipContent>
      </Tooltip>
    </View>
  );
}

function DiffRefreshButton({
  isRefreshing,
  toggleStyle,
  onPress,
}: {
  isRefreshing: boolean;
  toggleStyle: PressableStyleFn;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRefreshing ? t("git.refreshing") : t("git.refreshState")}
          testID="changes-refresh"
          style={toggleStyle}
          onPress={onPress}
          disabled={isRefreshing}
        >
          <View style={styles.refreshIcon}>
            {isRefreshing ? (
              <ThemedLoadingSpinner size={ICON_SIZE.sm} uniProps={refreshIconColorMapping} />
            ) : (
              <ThemedRotateCw size={ICON_SIZE.sm} uniProps={refreshIconColorMapping} />
            )}
          </View>
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{t("git.refresh")}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function buildDiffModeTriggerStyle(): PressableStyleFn {
  return ({ hovered, pressed, open }) => [
    styles.diffModeTrigger,
    (Boolean(hovered) || pressed || Boolean(open)) && styles.controlSurfaceActive,
  ];
}

function buildIconButtonStyle(): PressableStyleFn {
  return ({ hovered, pressed }) => [
    styles.iconButton,
    (Boolean(hovered) || pressed) && styles.controlSurfaceActive,
  ];
}

function buildToggleButtonStyle(
  selected: boolean,
  baseStyles: StyleProp<ViewStyle> | StyleProp<ViewStyle>[],
): PressableStyleFn {
  return ({ hovered, pressed }) => [
    baseStyles,
    (selected || Boolean(hovered) || pressed) && styles.controlSurfaceActive,
  ];
}

const styles = StyleSheet.create((theme) => ({
  // Soft selected control wash: active surface3, not solid surface1 hover fill.
  controlSurfaceActive: {
    backgroundColor: theme.colors.surface3,
  },
  container: {
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT,
    borderBottomWidth: 1,
    // Soft .topbar: quiet --border-soft chrome rule.
    borderBottomColor: theme.colors.secondary,
  },
  inner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: theme.spacing[3],
  },
  diffModeTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    marginLeft: theme.spacing[3] - theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    height: {
      xs: 28,
      sm: 28,
      md: 24,
    },
    // Soft toolbar control: --r-sm 8.
    borderRadius: 8,
    flexShrink: 0,
  },
  diffStatusText: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
  },
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexWrap: "wrap",
  },
  toggleButtonGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  toggleButton: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: {
      xs: 32,
      sm: 32,
      md: 24,
    },
    height: {
      xs: 32,
      sm: 32,
      md: 24,
    },
    paddingHorizontal: {
      xs: theme.spacing[2],
      sm: theme.spacing[2],
      md: theme.spacing[1],
    },
  },
  toggleButtonGroupStart: {
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  toggleButtonGroupEnd: {
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  iconButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    minWidth: {
      xs: 32,
      sm: 32,
      md: 24,
    },
    height: {
      xs: 32,
      sm: 32,
      md: 24,
    },
    paddingHorizontal: {
      xs: theme.spacing[2],
      sm: theme.spacing[2],
      md: theme.spacing[1],
    },
    // Soft toolbar control: --r-sm 8.
    borderRadius: 8,
    flexShrink: 0,
  },
  refreshIcon: {
    width: ICON_SIZE.md,
    height: ICON_SIZE.md,
    alignItems: "center",
    justifyContent: "center",
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: 12.5,
    lineHeight: 16,
  },
  // Soft quiet summary card: r14 card family.
  reviewSummaryBand: {
    marginHorizontal: theme.spacing[3],
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[1],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: 14,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    flexDirection: {
      xs: "column",
      md: "row",
    },
    alignItems: {
      xs: "stretch",
      md: "center",
    },
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  reviewSummaryTextGroup: {
    minWidth: 0,
    flex: 1,
    gap: 1,
  },
  reviewSummaryTitle: {
    color: theme.colors.foreground,
    // Soft review summary title: 12.5 meta medium.
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
  },
  reviewSummaryDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
  },
  reviewSummaryMeta: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  reviewSummaryMetaText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
  },
}));
