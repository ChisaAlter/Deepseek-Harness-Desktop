import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Check, Circle, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { GoalListItem, GoalStatus } from "@chisacode/protocol/goal/rpc-schemas";

import type {
  AgentProgressItem,
  AgentProgressModel,
} from "@/screens/workspace/workspace-environment-panel-model";
import type { SubagentRow } from "@/subagents/select";
import type { Theme } from "@/styles/theme";
import { isWeb } from "@/constants/platform";
import {
  WORKBENCH_BODY_FONT_SIZE,
  WORKBENCH_BODY_LINE_HEIGHT,
  WORKBENCH_ENVIRONMENT_PANEL_INSET,
  WORKBENCH_ENVIRONMENT_PANEL_SHADOW,
  WORKBENCH_ENVIRONMENT_PANEL_WIDTH,
  WORKBENCH_META_FONT_SIZE,
  WORKBENCH_META_LINE_HEIGHT,
  WORKBENCH_MICRO_FONT_SIZE,
  WORKBENCH_MICRO_LINE_HEIGHT,
  WORKSPACE_SECONDARY_HEADER_HEIGHT,
} from "@/constants/layout";

const ThemedCheck = withUnistyles(Check);
const ThemedCircle = withUnistyles(Circle);
const ThemedX = withUnistyles(X);

export const WORKSPACE_ENVIRONMENT_PANEL_WIDTH = WORKBENCH_ENVIRONMENT_PANEL_WIDTH;

const MAX_VISIBLE_SUBAGENTS = 6;

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const successColorMapping = (theme: Theme) => ({ color: theme.colors.palette.green[500] });
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accent });

/**
 * Desktop floating inspector: stacked cards for goal, plan/task progress, and subagents.
 * @param props Visibility, models, and action callbacks
 * @returns The floating stack, or null when hidden / empty
 */
export function WorkspaceEnvironmentPanelRail({
  visible,
  goal,
  progress,
  subagents,
  onCancelGoal,
  onOpenSubagent,
  onClose,
}: {
  visible: boolean;
  goal: GoalListItem | null;
  progress: AgentProgressModel | null;
  subagents: readonly SubagentRow[];
  onCancelGoal: (() => void) | null;
  onOpenSubagent: (subagentId: string) => void;
  onClose: () => void;
}) {
  const hasGoal = goal !== null;
  const hasProgress = progress !== null;
  const hasSubagents = subagents.length > 0;

  if (!visible || (!hasGoal && !hasProgress && !hasSubagents)) {
    return null;
  }

  return (
    <View style={styles.environmentStack} testID="workspace-environment-rail">
      {goal ? (
        <GoalCard goal={goal} onCancelGoal={onCancelGoal} onClose={onClose} showClose />
      ) : null}
      {progress ? (
        <PlanProgressCard
          progress={progress}
          onClose={hasGoal ? null : onClose}
          showClose={!hasGoal}
        />
      ) : null}
      {hasSubagents ? (
        <SubagentsCard
          rows={subagents}
          onOpenSubagent={onOpenSubagent}
          onClose={!hasGoal && !hasProgress ? onClose : null}
          showClose={!hasGoal && !hasProgress}
        />
      ) : null}
    </View>
  );
}

function GoalCard({
  goal,
  onCancelGoal,
  onClose,
  showClose,
}: {
  goal: GoalListItem;
  onCancelGoal: (() => void) | null;
  onClose: () => void;
  showClose: boolean;
}) {
  const { t } = useTranslation();
  const statusLabel = formatGoalStatusLabel(goal.status, t);
  const canCancel = Boolean(onCancelGoal) && isCancellableGoalStatus(goal.status);
  const statusBadgeStyle = goalStatusBadgeStyle(goal.status);

  return (
    <View style={styles.floatingCardOuter}>
      <View style={styles.floatingCard} testID="workspace-goal-panel">
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{t("workspace.environment.goalTitle")}</Text>
          {showClose ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("workspace.environment.hideFloatingPanel")}
              onPress={onClose}
              style={styles.iconButton}
              testID="workspace-environment-close"
            >
              <ThemedX size={14} uniProps={mutedColorMapping} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.goalObjective} numberOfLines={4}>
            {goal.objective}
          </Text>
          <View style={styles.badgeRow}>
            <View style={statusBadgeStyle}>
              <Text style={styles.badgeText}>{statusLabel}</Text>
            </View>
            <View style={styles.badgeNeutralChip}>
              <Text style={styles.badgeText}>
                {t("workspace.environment.goalTurns", { count: goal.turnsUsed })}
              </Text>
            </View>
            <View style={styles.badgeNeutralChip}>
              <Text style={styles.badgeText}>
                {t("workspace.environment.goalTokens", {
                  count: formatTokenCount(goal.tokensUsed),
                })}
              </Text>
            </View>
          </View>
          {canCancel ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("workspace.environment.cancelGoal")}
              onPress={onCancelGoal ?? undefined}
              style={styles.secondaryAction}
              testID="workspace-goal-cancel"
            >
              <Text style={styles.secondaryActionText}>
                {t("workspace.environment.cancelGoal")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function PlanProgressCard({
  progress,
  onClose,
  showClose,
}: {
  progress: AgentProgressModel;
  onClose: (() => void) | null;
  showClose: boolean;
}) {
  const { t } = useTranslation();
  const progressFillStyle = useMemo<StyleProp<ViewStyle>>(
    () => [
      styles.progressFill,
      { width: `${Math.round(Math.min(1, Math.max(0, progress.progress)) * 100)}%` },
    ],
    [progress.progress],
  );
  const title =
    progress.source === "plan"
      ? t("workspace.environment.planTitle")
      : t("workspace.environment.taskProgressTitle");

  return (
    <View style={styles.floatingCardOuter}>
      <View style={styles.floatingCard} testID="workspace-task-progress-panel">
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{title}</Text>
          {showClose && onClose ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("workspace.environment.hideFloatingPanel")}
              onPress={onClose}
              style={styles.iconButton}
              testID="workspace-environment-close"
            >
              <ThemedX size={14} uniProps={mutedColorMapping} />
            </Pressable>
          ) : (
            <Text style={styles.cardHeaderMeta}>
              {t("workspace.environment.taskProgress", {
                completed: progress.completedCount,
                total: progress.totalCount,
              })}
            </Text>
          )}
        </View>
        <View style={styles.cardBody}>
          <View style={styles.progressTrack} testID="workspace-task-progress-bar">
            <View style={progressFillStyle} />
          </View>
          {progress.visibleItems.map((item) => (
            <ProgressItemRow key={item.id} item={item} />
          ))}
          {progress.hiddenCount > 0 ? (
            <Text style={styles.hiddenCountText}>
              {t("workspace.environment.moreTasks", { count: progress.hiddenCount })}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function SubagentsCard({
  rows,
  onOpenSubagent,
  onClose,
  showClose,
}: {
  rows: readonly SubagentRow[];
  onOpenSubagent: (subagentId: string) => void;
  onClose: (() => void) | null;
  showClose: boolean;
}) {
  const { t } = useTranslation();
  const visibleRows = rows.slice(0, MAX_VISIBLE_SUBAGENTS);
  const hiddenCount = Math.max(0, rows.length - visibleRows.length);

  return (
    <View style={styles.floatingCardOuter}>
      <View style={styles.floatingCard} testID="workspace-subagents-panel">
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{t("workspace.environment.subagents")}</Text>
          {showClose && onClose ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("workspace.environment.hideFloatingPanel")}
              onPress={onClose}
              style={styles.iconButton}
              testID="workspace-environment-close"
            >
              <ThemedX size={14} uniProps={mutedColorMapping} />
            </Pressable>
          ) : (
            <Text style={styles.cardHeaderMeta}>{rows.length}</Text>
          )}
        </View>
        <View style={styles.cardBody}>
          {visibleRows.map((row) => (
            <SubagentRowButton key={row.id} row={row} onOpenSubagent={onOpenSubagent} />
          ))}
          {hiddenCount > 0 ? (
            <Text style={styles.hiddenCountText}>
              {t("workspace.environment.moreSubagents", { count: hiddenCount })}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function SubagentRowButton({
  row,
  onOpenSubagent,
}: {
  row: SubagentRow;
  onOpenSubagent: (subagentId: string) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    onOpenSubagent(row.id);
  }, [onOpenSubagent, row.id]);
  const initials = useMemo(() => getProviderInitials(row.provider), [row.provider]);
  const statusLabel = formatSubagentStatusLabel(row, t);
  const dotStyle = useMemo(() => {
    if (row.requiresAttention) {
      return styles.statusDotAttention;
    }
    if (row.status === "running") {
      return styles.statusDotBusy;
    }
    return styles.statusDotIdle;
  }, [row.requiresAttention, row.status]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.title ?? row.id}
      onPress={handlePress}
      style={subagentRowStyle}
      testID={`workspace-subagent-row-${row.id}`}
    >
      <View style={styles.subagentAvatar}>
        <Text style={styles.subagentAvatarText}>{initials}</Text>
      </View>
      <View style={styles.subagentCopy}>
        <Text style={styles.subagentTitle} numberOfLines={1}>
          {row.title}
        </Text>
        <Text style={styles.subagentMeta} numberOfLines={1}>
          {statusLabel}
        </Text>
      </View>
      <View style={dotStyle} />
    </Pressable>
  );
}

function ProgressItemRow({ item }: { item: AgentProgressItem }) {
  return (
    <View style={styles.progressRow}>
      <ProgressItemIcon item={item} />
      <Text
        style={item.completed ? styles.progressTextDone : styles.progressText}
        numberOfLines={2}
      >
        {item.text}
      </Text>
    </View>
  );
}

function ProgressItemIcon({ item }: { item: AgentProgressItem }) {
  if (item.completed) {
    return <ThemedCheck size={14} uniProps={successColorMapping} />;
  }
  if (item.status === "in_progress") {
    return <ThemedCircle size={12} uniProps={accentColorMapping} />;
  }
  return <ThemedCircle size={12} uniProps={mutedColorMapping} />;
}

function subagentRowStyle({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) {
  return [styles.subagentRow, (Boolean(hovered) || Boolean(pressed)) && styles.subagentRowHovered];
}

function isCancellableGoalStatus(status: GoalStatus): boolean {
  return status === "active" || status === "paused" || status === "blocked";
}

function formatGoalStatusLabel(status: GoalStatus, t: (key: string) => string): string {
  switch (status) {
    case "active":
      return t("workspace.environment.goalStatus.active");
    case "paused":
      return t("workspace.environment.goalStatus.paused");
    case "blocked":
      return t("workspace.environment.goalStatus.blocked");
    case "complete":
      return t("workspace.environment.goalStatus.complete");
    case "budgetLimited":
      return t("workspace.environment.goalStatus.budgetLimited");
    case "failed":
      return t("workspace.environment.goalStatus.failed");
    case "cancelled":
      return t("workspace.environment.goalStatus.cancelled");
    default:
      return status;
  }
}

function formatSubagentStatusLabel(row: SubagentRow, t: (key: string) => string): string {
  if (row.requiresAttention) {
    return t("workspace.environment.subagentNeedsAttention");
  }
  if (row.status === "running") {
    return t("agentStatus.running");
  }
  if (row.status === "error") {
    return t("agentStatus.errored");
  }
  if (row.status === "closed") {
    return t("agentStatus.completed");
  }
  return t("agentStatus.idle");
}

function goalStatusBadgeStyle(status: GoalStatus) {
  if (status === "active" || status === "paused") {
    return styles.badgeSuccessChip;
  }
  if (status === "blocked" || status === "budgetLimited") {
    return styles.badgeWarningChip;
  }
  return styles.badgeNeutralChip;
}

function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) {
    return "0";
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}k`;
  }
  return String(tokens);
}

function getProviderInitials(provider: string): string {
  const trimmed = provider.trim();
  if (!trimmed) {
    return "?";
  }
  const part = trimmed.includes("/") ? (trimmed.split("/").pop() ?? trimmed) : trimmed;
  return part.slice(0, 2).toUpperCase();
}

const styles = StyleSheet.create((theme) => ({
  environmentStack: {
    width: WORKSPACE_ENVIRONMENT_PANEL_WIDTH,
    position: "absolute",
    top: WORKSPACE_SECONDARY_HEADER_HEIGHT + WORKBENCH_ENVIRONMENT_PANEL_INSET,
    right: WORKBENCH_ENVIRONMENT_PANEL_INSET,
    zIndex: 80,
    elevation: 80,
    gap: 8,
    maxHeight: "100%",
  },
  // Shadow lives on the outer shell so overflow:hidden on the card cannot clip it (Electron web).
  floatingCardOuter: {
    borderRadius: theme.borderRadius["2xl"],
    ...(isWeb ? ({ boxShadow: WORKBENCH_ENVIRONMENT_PANEL_SHADOW } as object) : theme.shadow.md),
  },
  floatingCard: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: theme.colors.surface0,
    overflow: "hidden",
  },
  cardHeader: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: 12,
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.secondary,
  },
  cardTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: WORKBENCH_BODY_FONT_SIZE,
    lineHeight: WORKBENCH_BODY_LINE_HEIGHT,
    fontWeight: theme.fontWeight.semibold,
  },
  cardHeaderMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: WORKBENCH_META_FONT_SIZE,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
    fontWeight: theme.fontWeight.medium,
  },
  iconButton: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  cardBody: {
    paddingVertical: 6,
    paddingHorizontal: 6,
    gap: 2,
  },
  goalObjective: {
    marginHorizontal: 6,
    marginTop: 2,
    marginBottom: 6,
    color: theme.colors.foreground,
    fontSize: WORKBENCH_BODY_FONT_SIZE,
    lineHeight: WORKBENCH_BODY_LINE_HEIGHT,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  badgeSuccessChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    // statusSuccessBg is defined on every active theme; avoid `??` so Unistyles
    // does not narrow the fallback branch to `never`.
    backgroundColor: theme.colors.statusSuccessBg,
  },
  badgeWarningChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: theme.colors.statusWarningBg,
  },
  badgeNeutralChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  badgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: WORKBENCH_MICRO_FONT_SIZE,
    lineHeight: WORKBENCH_MICRO_LINE_HEIGHT,
    fontWeight: theme.fontWeight.medium,
  },
  secondaryAction: {
    marginHorizontal: 4,
    marginTop: 4,
    minHeight: 30,
    borderRadius: 10,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryActionText: {
    color: theme.colors.foregroundMuted,
    fontSize: WORKBENCH_META_FONT_SIZE,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
  },
  progressTrack: {
    height: 4,
    marginHorizontal: 8,
    marginBottom: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surfaceWorkspace,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.accent,
  },
  progressRow: {
    minHeight: 28,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  progressText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: WORKBENCH_META_FONT_SIZE,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
  },
  progressTextDone: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: WORKBENCH_META_FONT_SIZE,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
    textDecorationLine: "line-through",
  },
  hiddenCountText: {
    paddingHorizontal: 8,
    paddingBottom: 4,
    color: theme.colors.foregroundSubtleText,
    fontSize: WORKBENCH_MICRO_FONT_SIZE,
    lineHeight: WORKBENCH_MICRO_LINE_HEIGHT,
  },
  subagentRow: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  subagentRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  subagentAvatar: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.foreground,
  },
  subagentAvatarText: {
    color: theme.colors.surface0,
    fontSize: 11,
    fontWeight: theme.fontWeight.bold,
  },
  subagentCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  subagentTitle: {
    color: theme.colors.foreground,
    fontSize: WORKBENCH_META_FONT_SIZE,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
    fontWeight: theme.fontWeight.medium,
  },
  subagentMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: WORKBENCH_MICRO_FONT_SIZE,
    lineHeight: WORKBENCH_MICRO_LINE_HEIGHT,
  },
  statusDotIdle: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.palette.green[500],
  },
  statusDotBusy: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.accent,
  },
  statusDotAttention: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.warning,
  },
}));
