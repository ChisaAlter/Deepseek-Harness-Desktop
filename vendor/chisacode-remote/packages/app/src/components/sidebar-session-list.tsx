import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import {
  AlarmClock,
  Archive,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Pin,
  RefreshCw,
  SquarePen,
  Trash2,
  Undo2,
} from "lucide-react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ThemedIconHost } from "@/components/themed-icon-host";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import {
  useIsCompactFormFactor,
  WORKBENCH_META_LINE_HEIGHT,
  WORKBENCH_SIDEBAR_GROUP_LINE_HEIGHT,
} from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { resolveSidebarSessionGroupPresentation } from "@/components/sidebar-session-presentation";
import { Button } from "@/components/ui/button";
import { AgentStatusIndicator } from "@/components/ui/agent-status-indicator";
import { getProviderIcon } from "@/components/provider-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { useToast } from "@/contexts/toast-context";
import { getDesktopHost } from "@/desktop/host";
import {
  useArchiveAgent,
  useSuppressedArchiveAgentIds,
  type ArchiveAgentInput,
} from "@/hooks/use-archive-agent";
import { agentHistoryQueryKeys } from "@/hooks/agent-history-query-key";
import { useSessionStore } from "@/stores/session-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { generateDraftId } from "@/stores/draft-keys";
import { confirmDialog } from "@/utils/confirm-dialog";
import { rememberArchivedAgentDetail } from "@/utils/agent-history-navigation";
import type { SidebarSessionDraft } from "@/utils/left-sidebar-drafts";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import {
  getSidebarAgentLabelCacheSnapshot,
  patchAgentLabelsInSidebarCaches,
  restoreSidebarAgentLabelCacheSnapshot,
} from "@/utils/sidebar-agent-label-cache";
import {
  applyStableSidebarSessionOrder,
  buildWorktreeProjectHintsFromSources,
  buildWorkspaceDirectoryProjectHintsFromSources,
  PINNED_SIDEBAR_SESSION_GROUP_KEY,
  groupAgentsForSidebar,
  reconcileSidebarSessionOrder,
  type SidebarSessionGroup,
} from "@/utils/sidebar-session-groups";
import { buildHostNewWorkspaceRoute } from "@/utils/host-routes";
import { agentToSidebarThread } from "@/sidebar-v2/agent-adapter";
import {
  canSettle,
  canSnooze,
  effectiveSettled,
  effectiveSnoozed,
  resolveSnoozePresets,
  snoozeWakeLabel,
  type SnoozePreset,
} from "@/sidebar-v2/snooze";
import { sidebarV2ThreadKey, useSidebarV2Store } from "@/sidebar-v2/store";
import { formatRelativeTimeLabel } from "@/sidebar-v2/presentation";
import { SidebarStatusView } from "@/components/sidebar-status-view";

// No CSS enter animation on the session list pane. Any `animation:` style on
// the list container re-applies on every re-render (selection, hover, data
// refresh) and re-rasterizes every project/session title — users see all text
// "get wider" even for unselected rows.

const SIDEBAR_PINNED_LABEL = "chisacode.sidebarPinned";
const AUTO_SETTLE_AFTER_DAYS = 3;

interface SidebarSessionListProps {
  agents: AggregatedAgent[];
  drafts?: SidebarSessionDraft[];
  serverId: string | null;
  selectedAgentId?: string;
  showGroupTitles?: boolean;
  isRefreshing?: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onRefresh?: () => void;
  onLoadMore?: () => void;
  onAgentPress?: () => void;
  onAddProject?: () => void;
  viewMode?: "by-project" | "by-status";
  searchQuery?: string;
}

interface SidebarSessionRenderGroup extends SidebarSessionGroup {
  workspaceId: string | null;
}

// Route theme colors through ThemedIconHost so call-site `uniProps` never
// reaches lucide leaves (web withUnistyles merges props onto the child).
function RefreshControlHost({
  tintColor,
  refreshing,
  onRefresh,
  children,
}: {
  tintColor: string;
  refreshing: boolean;
  onRefresh: () => void;
  children?: ReactNode;
}) {
  return (
    <RefreshControl tintColor={tintColor} refreshing={refreshing} onRefresh={onRefresh}>
      {children}
    </RefreshControl>
  );
}

const ThemedRefreshControlHost = withUnistyles(RefreshControlHost);

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accent });
const statusWarningColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });
const foregroundSubtleTextColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundSubtleText,
});
const refreshTintColorMapping = (theme: Theme) => ({
  tintColor: theme.colors.foregroundMuted,
});

function rowProviderIconColorMapping(_isSelected: boolean) {
  // Keep provider icon color stable on selection. Switching muted→solid made
  // the leading glyph paint thicker and pushed title text sideways.
  return foregroundMutedColorMapping;
}

function pinIconColorMapping(isPinned: boolean) {
  if (isPinned) return accentColorMapping;
  return foregroundMutedColorMapping;
}

function workspaceFolderColorMapping(isWorkspaceGroup: boolean) {
  if (isWorkspaceGroup) return foregroundMutedColorMapping;
  return foregroundSubtleTextColorMapping;
}

function getAgentActionKey(agent: AggregatedAgent): string {
  return `${agent.serverId}:${agent.id}`;
}

function sidebarSessionKeyExtractor(agent: AggregatedAgent): string {
  return getAgentActionKey(agent);
}

function ordersEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function isSidebarAgentPinned(agent: AggregatedAgent): boolean {
  return agent.labels?.[SIDEBAR_PINNED_LABEL] === "true";
}

function getSidebarSessionTitle(agent: AggregatedAgent, fallbackTitle: string): string {
  const title = agent.title?.trim();
  return title && title.length > 0 ? title : fallbackTitle;
}

function resolveSidebarAgentLifecycle(agent: AggregatedAgent, nowIso: string) {
  const thread = agentToSidebarThread(agent);
  const isSnoozed = effectiveSnoozed(thread, { now: nowIso });
  const isSettled =
    !isSnoozed &&
    effectiveSettled(thread, {
      now: nowIso,
      autoSettleAfterDays: AUTO_SETTLE_AFTER_DAYS,
      changeRequestState: thread.changeRequestState,
    });
  return {
    thread,
    isSnoozed,
    isSettled,
    canSnoozeThread: canSnooze(thread, { now: nowIso }),
    canSettleThread: canSettle(thread, { now: nowIso }),
    wakeLabel:
      isSnoozed && thread.snoozedUntil
        ? snoozeWakeLabel(thread.snoozedUntil, { now: nowIso })
        : null,
    settledTimeLabel: isSettled
      ? formatRelativeTimeLabel(thread.settledAt ?? thread.lastActivityAt, new Date(nowIso))
      : null,
  };
}

async function copySidebarSessionText({
  text,
  copiedLabel,
  copyFailedLabel,
  toast,
}: {
  text: string;
  copiedLabel: string;
  copyFailedLabel: string;
  toast: ReturnType<typeof useToast>;
}) {
  try {
    await Clipboard.setStringAsync(text);
    toast.copied(copiedLabel);
  } catch {
    toast.error(copyFailedLabel);
  }
}

function updateAgentLabelsInStore(input: {
  serverId: string;
  agentId: string;
  labels: Record<string, string>;
}) {
  const setAgents = useSessionStore.getState().setAgents;
  setAgents(input.serverId, (prev) => {
    const existing = prev.get(input.agentId);
    if (!existing) {
      return prev;
    }
    const next = new Map(prev);
    next.set(input.agentId, {
      ...existing,
      labels: {
        ...existing.labels,
        ...input.labels,
      },
    });
    return next;
  });
}

function clearAgentAttentionInStore(serverId: string, agentIds: ReadonlySet<string>): void {
  const setAgents = useSessionStore.getState().setAgents;
  setAgents(serverId, (previous) => {
    let changed = false;
    const next = new Map(previous);
    for (const agentId of agentIds) {
      const existing = next.get(agentId);
      if (!existing?.requiresAttention) {
        continue;
      }
      changed = true;
      next.set(agentId, {
        ...existing,
        requiresAttention: false,
        attentionReason: null,
        attentionTimestamp: null,
      });
    }
    return changed ? next : previous;
  });
}

function updateProjectNameInStore(serverId: string, projectKey: string, projectName: string): void {
  const setAgents = useSessionStore.getState().setAgents;
  setAgents(serverId, (previous) => {
    let changed = false;
    const next = new Map(previous);
    for (const [agentId, agent] of next) {
      if (agent.projectPlacement?.projectKey !== projectKey) {
        continue;
      }
      changed = true;
      next.set(agentId, {
        ...agent,
        projectPlacement: {
          ...agent.projectPlacement,
          projectName,
        },
      });
    }
    return changed ? next : previous;
  });
}

function deleteAgentFromStore(input: { serverId: string; agentId: string }) {
  useWorkspaceLayoutStore.getState().unpinAgentEverywhere(input.agentId);
  const setAgents = useSessionStore.getState().setAgents;
  const setAgentDetails = useSessionStore.getState().setAgentDetails;
  setAgents(input.serverId, (prev) => {
    if (!prev.has(input.agentId)) {
      return prev;
    }
    const next = new Map(prev);
    next.delete(input.agentId);
    return next;
  });
  setAgentDetails(input.serverId, (prev) => {
    if (!prev.has(input.agentId)) {
      return prev;
    }
    const next = new Map(prev);
    next.delete(input.agentId);
    return next;
  });
}

function invalidateSidebarSessionQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  serverId: string,
) {
  void queryClient.invalidateQueries({ queryKey: ["sidebarAgentsList", serverId] });
  void queryClient.invalidateQueries({ queryKey: ["allAgents", serverId] });
  for (const queryKey of agentHistoryQueryKeys(serverId)) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

function buildRenderGroups(agentGroups: SidebarSessionGroup[]): SidebarSessionRenderGroup[] {
  return agentGroups.map((group) => ({
    ...group,
    workspaceId: null,
  }));
}

// Hover fade mask width for desktop quick actions. Implemented as a CSS
// linear-gradient View (web-only) so we never wrap a DOM View with
// withUnistyles + uniProps — that leaked `uniProps` onto the DOM and threw
// "React does not recognize the `uniProps` prop on a DOM element".
const DESKTOP_ROW_FADE_MASK_WIDTH = 72;

// eslint-disable-next-line complexity -- Cross-platform row owns desktop hover, desktop context menu, and compact menu parity.
function SidebarSessionRow({
  agent,
  selectedAgentId,
  onAgentPress,
  onTogglePin,
  onRename,
  onArchive,
  onDelete,
  onSnooze,
  onWake,
  onSettle,
  onUnsettle,
  onRegenerateTitle,
  onMarkUnread,
  nowIso,
  isPinning,
  isArchiving,
  isDeleting,
  isDragging = false,
  drag,
}: {
  agent: AggregatedAgent;
  selectedAgentId?: string;
  onAgentPress?: () => void;
  onTogglePin: (agent: AggregatedAgent) => void;
  onRename: (agent: AggregatedAgent) => void;
  onArchive: (agent: AggregatedAgent) => void;
  onDelete: (agent: AggregatedAgent) => void;
  onSnooze: (agent: AggregatedAgent, untilIso: string) => void;
  onWake: (agent: AggregatedAgent) => void;
  onSettle: (agent: AggregatedAgent) => void;
  onUnsettle: (agent: AggregatedAgent) => void;
  onRegenerateTitle: (agent: AggregatedAgent) => void;
  onMarkUnread: (agent: AggregatedAgent) => void;
  nowIso: string;
  isPinning: boolean;
  isArchiving: boolean;
  isDeleting: boolean;
  isDragging?: boolean;
  drag?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isCompact = useIsCompactFormFactor();
  const agentActionKey = getAgentActionKey(agent);
  const ProviderIcon = getProviderIcon(agent.provider);
  const isSelected = selectedAgentId === `${agent.serverId}:${agent.id}`;
  const isPinned = isSidebarAgentPinned(agent);
  const [isHovered, setIsHovered] = useState(false);
  const lifecycle = useMemo(() => resolveSidebarAgentLifecycle(agent, nowIso), [agent, nowIso]);
  const snoozePresets = useMemo(() => resolveSnoozePresets(new Date(nowIso)), [nowIso]);

  const sessionTitle = getSidebarSessionTitle(agent, t("session.newSession"));
  const rowBaseStyle = isCompact ? styles.row : styles.desktopRow;
  const rowHoveredStyle = isCompact ? styles.rowHovered : styles.desktopRowHovered;
  const rowSelectedStyle = isCompact ? styles.rowSelected : styles.desktopRowSelected;
  const rowPressedStyle = isCompact ? styles.rowPressed : styles.desktopRowPressed;
  const rowLeadingStyle = isCompact ? styles.rowLeading : styles.desktopRowLeading;
  const rowContentStyle = isCompact ? styles.rowContent : styles.desktopRowContent;
  const rowTitleStyle = isCompact ? styles.rowTitle : styles.desktopRowTitle;
  const rowQuickActionsStyle = isCompact ? styles.rowQuickActions : styles.desktopRowQuickActions;
  const rowQuickButtonStyle = isCompact ? styles.rowQuickButton : styles.desktopRowQuickButton;
  const rowQuickButtonActiveStyle = isCompact
    ? styles.rowQuickButtonActive
    : styles.desktopRowQuickButtonActive;
  const rowQuickButtonPressedStyle = isCompact
    ? styles.rowQuickButtonPressed
    : styles.desktopRowQuickButtonPressed;

  const selectedIndicatorStyle = isCompact
    ? styles.rowSelectedIndicator
    : styles.desktopRowSelectedIndicator;

  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      rowBaseStyle,
      // Keep settled dimming even when selected so glyphs do not re-rasterize
      // wider on selection (opacity restore made text look "bolder"/wider).
      lifecycle.isSettled && styles.rowSettled,
      // Selected fill is the stable chrome. Hover/pressed must not recolor or
      // dim the active row (users read that as the selection "getting darker").
      !isSelected && Boolean(hovered) && rowHoveredStyle,
      isSelected && rowSelectedStyle,
      isDragging && styles.desktopRowDragging,
      !isSelected && pressed && rowPressedStyle,
    ],
    [
      isDragging,
      isSelected,
      lifecycle.isSettled,
      rowBaseStyle,
      rowHoveredStyle,
      rowPressedStyle,
      rowSelectedStyle,
    ],
  );
  const titleStyle = rowTitleStyle;
  const rowAccessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  const showQuickActions = isCompact || isHovered || isPinning || isArchiving;
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      rememberArchivedAgentDetail(agent);
      onAgentPress?.();
      navigateToAgent({
        serverId: agent.serverId,
        agentId: agent.id,
        pin: Boolean(agent.archivedAt),
      });
    },
    [agent, onAgentPress],
  );
  const handleRename = useCallback(() => onRename(agent), [agent, onRename]);
  const handleTogglePin = useCallback(() => onTogglePin(agent), [agent, onTogglePin]);
  const handleArchive = useCallback(() => onArchive(agent), [agent, onArchive]);
  const handleDelete = useCallback(() => onDelete(agent), [agent, onDelete]);
  const handleWake = useCallback(() => onWake(agent), [agent, onWake]);
  const handleSettle = useCallback(() => onSettle(agent), [agent, onSettle]);
  const handleUnsettle = useCallback(() => onUnsettle(agent), [agent, onUnsettle]);
  const handleRegenerateTitle = useCallback(
    () => onRegenerateTitle(agent),
    [agent, onRegenerateTitle],
  );
  const handleMarkUnread = useCallback(() => onMarkUnread(agent), [agent, onMarkUnread]);
  const handleSnoozePreset = useCallback(
    (preset: SnoozePreset) => onSnooze(agent, preset.snoozedUntil),
    [agent, onSnooze],
  );
  const handleCopyPath = useCallback(() => {
    if (!agent.cwd) {
      return;
    }
    void copySidebarSessionText({
      text: agent.cwd,
      copiedLabel: t("common.copiedToClipboard"),
      copyFailedLabel: t("workspace.screen.copyFailed"),
      toast,
    });
  }, [agent.cwd, t, toast]);
  const handleCopyAgentId = useCallback(() => {
    void copySidebarSessionText({
      text: agent.id,
      copiedLabel: t("common.copiedToClipboard"),
      copyFailedLabel: t("workspace.screen.copyFailed"),
      toast,
    });
  }, [agent.id, t, toast]);
  const copyLeading = useMemo(
    () => <ThemedIconHost Icon={Copy} size={16} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const pinLeading = useMemo(
    () => <ThemedIconHost Icon={Pin} size={16} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const renameLeading = useMemo(
    () => <ThemedIconHost Icon={Pencil} size={16} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const archiveLeading = useMemo(
    () => <ThemedIconHost Icon={Archive} size={16} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const deleteLeading = useMemo(
    () => <ThemedIconHost Icon={Trash2} size={16} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const settleLeading = useMemo(
    () => <ThemedIconHost Icon={CheckCheck} size={16} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const unsettleLeading = useMemo(
    () => <ThemedIconHost Icon={Undo2} size={16} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const wakeLeading = useMemo(
    () => <ThemedIconHost Icon={AlarmClock} size={16} uniProps={statusWarningColorMapping} />,
    [],
  );
  const regenerateLeading = useMemo(
    () => <ThemedIconHost Icon={RefreshCw} size={16} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const handleQuickPin = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      handleTogglePin();
    },
    [handleTogglePin],
  );
  const handleQuickArchive = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      handleArchive();
    },
    [handleArchive],
  );
  const quickArchiveIcon = isArchiving ? (
    <ActivityIndicator size="small" style={styles.quickArchiveSpinner} />
  ) : (
    <ThemedIconHost Icon={Archive} size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
  );
  const quickArchiveAccessibilityState = useMemo(
    () => ({ busy: isArchiving, disabled: isArchiving || Boolean(agent.archivedAt) }),
    [agent.archivedAt, isArchiving],
  );

  const menuButtonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.rowMenuButton,
      (Boolean(hovered) || pressed) && styles.rowMenuButtonActive,
    ],
    [],
  );
  const quickButtonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      rowQuickButtonStyle,
      (Boolean(hovered) || pressed) && rowQuickButtonActiveStyle,
      pressed && rowQuickButtonPressedStyle,
    ],
    [rowQuickButtonActiveStyle, rowQuickButtonPressedStyle, rowQuickButtonStyle],
  );
  const pointerEventsStyle = useMemo(
    () => ({ pointerEvents: showQuickActions ? ("auto" as const) : ("none" as const) }),
    [showQuickActions],
  );
  const quickActionsStyle = useMemo(
    () => [rowQuickActionsStyle, !showQuickActions && styles.rowQuickHidden, pointerEventsStyle],
    [pointerEventsStyle, rowQuickActionsStyle, showQuickActions],
  );
  const desktopRowFadeMaskStyle = useMemo(
    () => [
      styles.desktopRowFadeMask,
      isSelected ? styles.desktopRowFadeMaskSelected : styles.desktopRowFadeMaskHovered,
      styles.pointerEventsNone,
    ],
    [isSelected],
  );

  let settleMenuItem: React.ReactNode = null;
  if (lifecycle.isSettled) {
    settleMenuItem = isCompact ? (
      <DropdownMenuItem
        testID={`sidebar-session-unsettle-${agent.serverId}-${agent.id}`}
        onSelect={handleUnsettle}
        leading={unsettleLeading}
      >
        {t("sidebarV2.unsettle")}
      </DropdownMenuItem>
    ) : (
      <ContextMenuItem
        testID={`sidebar-session-unsettle-${agent.serverId}-${agent.id}`}
        onSelect={handleUnsettle}
        leading={unsettleLeading}
      >
        {t("sidebarV2.unsettle")}
      </ContextMenuItem>
    );
  } else if (isCompact) {
    settleMenuItem = (
      <DropdownMenuItem
        testID={`sidebar-session-settle-${agent.serverId}-${agent.id}`}
        onSelect={handleSettle}
        disabled={!lifecycle.canSettleThread}
        leading={settleLeading}
      >
        {t("sidebarV2.settle")}
      </DropdownMenuItem>
    );
  } else {
    settleMenuItem = (
      <ContextMenuItem
        testID={`sidebar-session-settle-${agent.serverId}-${agent.id}`}
        onSelect={handleSettle}
        disabled={!lifecycle.canSettleThread}
        leading={settleLeading}
      >
        {t("sidebarV2.settle")}
      </ContextMenuItem>
    );
  }

  let snoozeMenuItems: React.ReactNode[] = [];
  if (lifecycle.isSnoozed) {
    if (isCompact) {
      snoozeMenuItems = [
        <DropdownMenuItem
          key="wake"
          testID={`sidebar-session-wake-${agent.serverId}-${agent.id}`}
          onSelect={handleWake}
          leading={wakeLeading}
        >
          {t("sidebarV2.wake")}
        </DropdownMenuItem>,
      ];
    } else {
      snoozeMenuItems = [
        <ContextMenuItem
          key="wake"
          testID={`sidebar-session-wake-${agent.serverId}-${agent.id}`}
          onSelect={handleWake}
          leading={wakeLeading}
        >
          {t("sidebarV2.wake")}
        </ContextMenuItem>,
      ];
    }
  } else {
    const snoozeLabel = isCompact ? (
      <DropdownMenuLabel key="snooze-label">{t("sidebarV2.snooze")}</DropdownMenuLabel>
    ) : (
      <ContextMenuLabel key="snooze-label">{t("sidebarV2.snooze")}</ContextMenuLabel>
    );
    snoozeMenuItems = [
      snoozeLabel,
      ...snoozePresets.map((preset) => (
        <SidebarSessionSnoozePresetItem
          key={preset.id}
          agent={agent}
          preset={preset}
          isCompact={isCompact}
          disabled={!lifecycle.canSnoozeThread}
          onSelect={handleSnoozePreset}
        />
      )),
    ];
  }

  const rowMainContent = (
    <>
      {isSelected ? <View style={selectedIndicatorStyle} /> : null}
      <View style={rowLeadingStyle}>
        <ThemedIconHost
          Icon={ProviderIcon}
          size={ICON_SIZE.sm}
          uniProps={rowProviderIconColorMapping(isSelected)}
        />
      </View>
      <View style={rowContentStyle}>
        <Text style={titleStyle} numberOfLines={1}>
          {agent.title || t("session.newSession")}
        </Text>
        {lifecycle.wakeLabel ? (
          <View
            style={styles.snoozeBadge}
            testID={`sidebar-session-snooze-badge-${agent.serverId}-${agent.id}`}
          >
            <ThemedIconHost
              Icon={AlarmClock}
              size={ICON_SIZE.xs}
              uniProps={statusWarningColorMapping}
            />
            <Text style={styles.snoozeBadgeText}>{lifecycle.wakeLabel}</Text>
          </View>
        ) : null}
        {lifecycle.settledTimeLabel ? (
          <Text
            style={styles.settledTimeLabel}
            testID={`sidebar-session-settled-time-${agent.serverId}-${agent.id}`}
          >
            {lifecycle.settledTimeLabel}
          </Text>
        ) : null}
        <AgentStatusIndicator
          status={agent.status}
          requiresAttention={agent.requiresAttention}
          attentionReason={agent.attentionReason}
          pendingPermissionCount={agent.pendingPermissionCount}
          size="sm"
        />
      </View>
    </>
  );

  const compactTrailingContent = (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID={`sidebar-session-menu-${agent.serverId}-${agent.id}`}
        accessibilityLabel={t("sidebar.sessionActions")}
        style={menuButtonStyle}
      >
        <ThemedIconHost
          Icon={MoreHorizontal}
          size={ICON_SIZE.sm}
          uniProps={foregroundMutedColorMapping}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={220}>
        <DropdownMenuItem
          testID={`sidebar-session-toggle-pin-${agent.serverId}-${agent.id}`}
          onSelect={handleTogglePin}
          status={isPinning ? "pending" : "idle"}
          leading={pinLeading}
        >
          {isPinned ? t("sidebar.unpinSession") : t("sidebar.pinSession")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID={`sidebar-session-archive-${agent.serverId}-${agent.id}`}
          onSelect={handleArchive}
          disabled={Boolean(agent.archivedAt)}
          status={isArchiving ? "pending" : "idle"}
          pendingLabel={t("sidebar.archiving")}
          destructive={!agent.archivedAt}
          leading={archiveLeading}
        >
          {agent.archivedAt ? t("session.archived") : t("sidebar.archive")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {settleMenuItem}
        {snoozeMenuItems}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          testID={`sidebar-session-regenerate-title-${agent.serverId}-${agent.id}`}
          onSelect={handleRegenerateTitle}
          leading={regenerateLeading}
        >
          {t("sidebarV2.regenerateTitle")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID={`sidebar-session-mark-unread-${agent.serverId}-${agent.id}`}
          onSelect={handleMarkUnread}
        >
          {t("sidebarV2.markUnread")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID={`sidebar-session-copy-path-${agent.serverId}-${agent.id}`}
          onSelect={handleCopyPath}
          disabled={!agent.cwd}
          leading={copyLeading}
        >
          {t("sidebar.copyPath")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID={`sidebar-session-copy-agent-id-${agent.serverId}-${agent.id}`}
          onSelect={handleCopyAgentId}
          leading={copyLeading}
        >
          {t("workspace.tabMenu.copyAgentId")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID={`sidebar-session-rename-${agent.serverId}-${agent.id}`}
          onSelect={handleRename}
          leading={renameLeading}
        >
          <View testID="sidebar-v2-menu-rename" collapsable={false}>
            <Text>{t("workspace.screen.rename")}</Text>
          </View>
        </DropdownMenuItem>
        <DropdownMenuItem
          testID={`sidebar-session-delete-${agent.serverId}-${agent.id}`}
          onSelect={handleDelete}
          status={isDeleting ? "pending" : "idle"}
          pendingLabel={t("sidebar.deletingSession")}
          destructive
          leading={deleteLeading}
        >
          {t("sidebar.deleteSession")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const desktopTrailingContent = (
    <View
      style={quickActionsStyle}
      testID={`sidebar-session-quick-actions-${agent.serverId}-${agent.id}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          isPinned
            ? t("sidebar.unpinSessionLabel", { title: sessionTitle })
            : t("sidebar.pinSessionLabel", { title: sessionTitle })
        }
        testID={`sidebar-session-quick-pin-${agent.serverId}-${agent.id}`}
        style={quickButtonStyle}
        onPress={handleQuickPin}
        disabled={isPinning}
      >
        <ThemedIconHost Icon={Pin} size={ICON_SIZE.sm} uniProps={pinIconColorMapping(isPinned)} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("sidebar.archiveSessionLabel", { title: sessionTitle })}
        accessibilityState={quickArchiveAccessibilityState}
        testID={`sidebar-session-quick-archive-${agent.serverId}-${agent.id}`}
        style={quickButtonStyle}
        onPress={handleQuickArchive}
        disabled={isArchiving || Boolean(agent.archivedAt)}
      >
        {quickArchiveIcon}
      </Pressable>
    </View>
  );

  if (isCompact) {
    return (
      <View testID={`sidebar-v2-thread-${agent.id}`} collapsable={false}>
        <Pressable
          style={rowStyle}
          onPress={handlePress}
          onLongPress={drag}
          testID={`sidebar-session-${agent.serverId}-${agent.id}`}
          accessibilityRole="button"
          accessibilityLabel={sessionTitle}
          accessibilityState={rowAccessibilityState}
        >
          {rowMainContent}
          {compactTrailingContent}
        </Pressable>
      </View>
    );
  }

  return (
    <ContextMenu>
      <View
        key={agentActionKey}
        style={styles.desktopRowContainer}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        testID={`sidebar-session-container-${agent.serverId}-${agent.id}`}
        collapsable={false}
      >
        <View testID={`sidebar-v2-thread-${agent.id}`} collapsable={false}>
          <ContextMenuTrigger
            enabledOnMobile={false}
            style={rowStyle}
            onPress={handlePress}
            onLongPress={drag}
            testID={`sidebar-session-${agent.serverId}-${agent.id}`}
            accessibilityRole="button"
            accessibilityLabel={sessionTitle}
            accessibilityState={rowAccessibilityState}
          >
            {rowMainContent}
            {showQuickActions ? <View style={desktopRowFadeMaskStyle} /> : null}
          </ContextMenuTrigger>
        </View>
        {desktopTrailingContent}
      </View>
      <ContextMenuContent
        align="start"
        width={220}
        mobileMode="sheet"
        testID={`sidebar-session-context-${agent.serverId}-${agent.id}`}
      >
        <ContextMenuItem
          testID={`sidebar-session-toggle-pin-${agent.serverId}-${agent.id}`}
          onSelect={handleTogglePin}
          status={isPinning ? "pending" : "idle"}
          leading={pinLeading}
        >
          {isPinned ? t("sidebar.unpinSession") : t("sidebar.pinSession")}
        </ContextMenuItem>
        <ContextMenuItem
          testID={`sidebar-session-archive-${agent.serverId}-${agent.id}`}
          onSelect={handleArchive}
          disabled={Boolean(agent.archivedAt)}
          status={isArchiving ? "pending" : "idle"}
          pendingLabel={t("sidebar.archiving")}
          leading={archiveLeading}
        >
          {agent.archivedAt ? t("session.archived") : t("sidebar.archive")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {settleMenuItem}
        {snoozeMenuItems}
        <ContextMenuSeparator />
        <ContextMenuItem
          testID={`sidebar-session-regenerate-title-${agent.serverId}-${agent.id}`}
          onSelect={handleRegenerateTitle}
          leading={regenerateLeading}
        >
          {t("sidebarV2.regenerateTitle")}
        </ContextMenuItem>
        <ContextMenuItem
          testID={`sidebar-session-mark-unread-${agent.serverId}-${agent.id}`}
          onSelect={handleMarkUnread}
        >
          {t("sidebarV2.markUnread")}
        </ContextMenuItem>
        <ContextMenuItem
          testID={`sidebar-session-copy-path-${agent.serverId}-${agent.id}`}
          onSelect={handleCopyPath}
          disabled={!agent.cwd}
          leading={copyLeading}
        >
          {t("sidebar.copyPath")}
        </ContextMenuItem>
        <ContextMenuItem
          testID={`sidebar-session-copy-agent-id-${agent.serverId}-${agent.id}`}
          onSelect={handleCopyAgentId}
          leading={copyLeading}
        >
          {t("workspace.tabMenu.copyAgentId")}
        </ContextMenuItem>
        <ContextMenuItem
          testID={`sidebar-session-rename-${agent.serverId}-${agent.id}`}
          onSelect={handleRename}
          leading={renameLeading}
        >
          <View testID="sidebar-v2-menu-rename" collapsable={false}>
            <Text>{t("workspace.screen.rename")}</Text>
          </View>
        </ContextMenuItem>
        <ContextMenuItem
          testID={`sidebar-session-delete-${agent.serverId}-${agent.id}`}
          onSelect={handleDelete}
          status={isDeleting ? "pending" : "idle"}
          pendingLabel={t("sidebar.deletingSession")}
          destructive
          leading={deleteLeading}
        >
          {t("sidebar.deleteSession")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function SidebarSessionSnoozePresetItem({
  agent,
  preset,
  isCompact,
  disabled,
  onSelect,
}: {
  agent: AggregatedAgent;
  preset: SnoozePreset;
  isCompact: boolean;
  disabled: boolean;
  onSelect: (preset: SnoozePreset) => void;
}) {
  const handleSelect = useCallback(() => onSelect(preset), [onSelect, preset]);
  if (isCompact) {
    return (
      <DropdownMenuItem
        testID={`sidebar-session-snooze-${preset.id}-${agent.serverId}-${agent.id}`}
        onSelect={handleSelect}
        disabled={disabled}
      >
        {preset.label}
      </DropdownMenuItem>
    );
  }
  return (
    <ContextMenuItem
      testID={`sidebar-session-snooze-${preset.id}-${agent.serverId}-${agent.id}`}
      onSelect={handleSelect}
      disabled={disabled}
    >
      {preset.label}
    </ContextMenuItem>
  );
}

function SidebarSessionGroupHeader({
  group,
  serverId,
  isCompact,
  collapsed,
  onToggleCollapsed,
  isPinned,
  isArchiving,
  isRemoving,
  isMarkingRead,
  onTogglePin,
  onOpenPath,
  onRename,
  onMarkAllRead,
  onArchive,
  onRemove,
}: {
  group: SidebarSessionRenderGroup;
  serverId: string | null;
  isCompact: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  isPinned: boolean;
  isArchiving: boolean;
  isRemoving: boolean;
  isMarkingRead: boolean;
  onTogglePin: () => void;
  onOpenPath: () => void;
  onRename: () => void;
  onMarkAllRead: () => void;
  onArchive: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [isHovered, setIsHovered] = useState(false);
  const presentation = resolveSidebarSessionGroupPresentation(isCompact);
  const canOpenDraft = Boolean(serverId && group.cwd);
  const canCollapse = Boolean(group.cwd);
  const isWorkspaceGroup = Boolean(group.cwd);
  const actionsVisible = isCompact || isHovered;
  const handleNewDraft = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      if (!serverId || !group.cwd) {
        return;
      }
      router.push(
        buildHostNewWorkspaceRoute(serverId, group.cwd, {
          draftKey: generateDraftId(),
        }),
      );
    },
    [group.cwd, serverId],
  );
  const addButtonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.groupAddButton,
      (Boolean(hovered) || pressed) && styles.groupAddButtonActive,
    ],
    [],
  );
  const handleCopyPath = useCallback(() => {
    if (!group.cwd) {
      return;
    }
    void copySidebarSessionText({
      text: group.cwd,
      copiedLabel: t("sidebar.pathCopied"),
      copyFailedLabel: t("workspace.screen.copyFailed"),
      toast,
    });
  }, [group.cwd, t, toast]);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const copyPathLeading = useMemo(
    () => <ThemedIconHost Icon={Copy} size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const pinLeading = useMemo(
    () => <ThemedIconHost Icon={Pin} size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const openLeading = useMemo(
    () => (
      <ThemedIconHost
        Icon={FolderOpen}
        size={ICON_SIZE.sm}
        uniProps={foregroundMutedColorMapping}
      />
    ),
    [],
  );
  const renameLeading = useMemo(
    () => (
      <ThemedIconHost Icon={Pencil} size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
    ),
    [],
  );
  const readLeading = useMemo(
    () => (
      <ThemedIconHost
        Icon={CheckCheck}
        size={ICON_SIZE.sm}
        uniProps={foregroundMutedColorMapping}
      />
    ),
    [],
  );
  const archiveLeading = useMemo(
    () => (
      <ThemedIconHost Icon={Archive} size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
    ),
    [],
  );
  const removeLeading = useMemo(
    () => (
      <ThemedIconHost Icon={Trash2} size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
    ),
    [],
  );
  const groupActionsPointerEventsStyle = useMemo(
    () => ({ pointerEvents: actionsVisible ? ("auto" as const) : ("none" as const) }),
    [actionsVisible],
  );
  const actionsStyle = useMemo(
    () => [
      presentation.variant === "workbench" ? styles.desktopGroupActions : styles.groupActions,
      !actionsVisible && styles.groupActionsHidden,
      groupActionsPointerEventsStyle,
    ],
    [actionsVisible, groupActionsPointerEventsStyle, presentation.variant],
  );
  const headerStyle =
    presentation.variant === "workbench" ? styles.desktopGroupHeader : styles.groupHeader;
  const headerLabelStyle =
    presentation.variant === "workbench" ? styles.desktopGroupHeaderLabel : styles.groupHeaderLabel;
  const titleStyle =
    presentation.variant === "workbench" ? styles.desktopGroupTitle : styles.groupTitle;
  const accessibilityState = useMemo(
    () => (canCollapse ? { expanded: !collapsed } : undefined),
    [canCollapse, collapsed],
  );
  const resolvedTitleStyle = useMemo(
    () => [titleStyle, !isCompact && isWorkspaceGroup && styles.desktopWorkspaceGroupTitle],
    [isCompact, isWorkspaceGroup, titleStyle],
  );
  const collapseIndicator = renderSidebarGroupCollapseIndicator({
    canCollapse,
    showCollapseIndicator: presentation.showCollapseIndicator,
    collapsed,
  });

  return (
    <View
      style={headerStyle}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        accessibilityRole={canCollapse ? "button" : undefined}
        accessibilityState={accessibilityState}
        disabled={!canCollapse}
        onPress={onToggleCollapsed}
        style={headerLabelStyle}
        testID={canCollapse ? `sidebar-session-group-toggle-${group.key}` : undefined}
      >
        {collapseIndicator}
        {presentation.showWorkspaceIcon && group.cwd ? (
          <ThemedIconHost
            Icon={Folder}
            size={ICON_SIZE.md}
            uniProps={workspaceFolderColorMapping(isWorkspaceGroup)}
          />
        ) : null}
        <Text style={resolvedTitleStyle} numberOfLines={1}>
          {group.label}
        </Text>
      </Pressable>
      {canOpenDraft ? (
        <View style={actionsStyle} testID={`sidebar-session-group-actions-${group.key}`}>
          <DropdownMenu>
            <DropdownMenuTrigger
              accessibilityRole={isWeb ? undefined : "button"}
              accessibilityLabel={t("sidebar.projectActions")}
              hitSlop={4}
              style={addButtonStyle}
              testID={`sidebar-session-group-menu-${group.key}`}
            >
              <ThemedIconHost
                Icon={MoreHorizontal}
                size={ICON_SIZE.sm}
                uniProps={foregroundMutedColorMapping}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" width={220}>
              <DropdownMenuItem
                leading={pinLeading}
                onSelect={onTogglePin}
                testID={`sidebar-session-group-toggle-pin-${group.key}`}
              >
                {isPinned ? t("sidebar.unpinProject") : t("sidebar.pinProject")}
              </DropdownMenuItem>
              <DropdownMenuItem
                leading={openLeading}
                onSelect={onOpenPath}
                testID={`sidebar-session-group-open-path-${group.key}`}
              >
                {t("sidebar.openInFileExplorer")}
              </DropdownMenuItem>
              <DropdownMenuItem
                leading={renameLeading}
                onSelect={onRename}
                disabled={!group.projectKey}
                testID={`sidebar-session-group-rename-${group.key}`}
              >
                {t("sidebar.renameProject")}
              </DropdownMenuItem>
              <DropdownMenuItem
                leading={readLeading}
                onSelect={onMarkAllRead}
                status={isMarkingRead ? "pending" : "idle"}
                disabled={!group.agents.some((agent) => agent.requiresAttention)}
                testID={`sidebar-session-group-mark-read-${group.key}`}
              >
                {t("sidebar.markAllAsRead")}
              </DropdownMenuItem>
              <DropdownMenuItem
                leading={archiveLeading}
                onSelect={onArchive}
                status={isArchiving ? "pending" : "idle"}
                testID={`sidebar-session-group-archive-${group.key}`}
              >
                {t("sidebar.archiveProjectSessions")}
              </DropdownMenuItem>
              <DropdownMenuItem
                leading={copyPathLeading}
                onSelect={handleCopyPath}
                testID={`sidebar-session-group-copy-path-${group.key}`}
              >
                {t("sidebar.copyPath")}
              </DropdownMenuItem>
              <DropdownMenuItem
                leading={removeLeading}
                onSelect={onRemove}
                status={isRemoving ? "pending" : "idle"}
                destructive
                testID={`sidebar-session-group-remove-${group.key}`}
              >
                {t("sidebar.removeProject")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("sidebar.createConversationForProject", {
              project: group.label,
            })}
            hitSlop={4}
            onPress={handleNewDraft}
            style={addButtonStyle}
            testID={`sidebar-session-group-new-${serverId}-${group.key}`}
          >
            <ThemedIconHost
              Icon={SquarePen}
              size={ICON_SIZE.sm}
              uniProps={foregroundMutedColorMapping}
            />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function renderSidebarGroupCollapseIndicator(input: {
  canCollapse: boolean;
  showCollapseIndicator: boolean;
  collapsed: boolean;
}): React.ReactNode {
  if (!input.canCollapse || !input.showCollapseIndicator) {
    return null;
  }
  return input.collapsed ? (
    <ThemedIconHost
      Icon={ChevronRight}
      size={ICON_SIZE.xs}
      uniProps={foregroundSubtleTextColorMapping}
    />
  ) : (
    <ThemedIconHost
      Icon={ChevronDown}
      size={ICON_SIZE.xs}
      uniProps={foregroundSubtleTextColorMapping}
    />
  );
}

interface SidebarSessionGroupViewProps {
  group: SidebarSessionRenderGroup;
  groupStyle: StyleProp<ViewStyle>;
  serverId: string;
  isCompact: boolean;
  showGroupTitles: boolean;
  collapsed: boolean;
  selectedAgentId?: string;
  onAgentPress?: () => void;
  onTogglePin: (agent: AggregatedAgent) => void;
  onRename: (agent: AggregatedAgent) => void;
  onArchive: (agent: AggregatedAgent) => void;
  onDelete: (agent: AggregatedAgent) => void;
  onSnooze: (agent: AggregatedAgent, untilIso: string) => void;
  onWake: (agent: AggregatedAgent) => void;
  onSettle: (agent: AggregatedAgent) => void;
  onUnsettle: (agent: AggregatedAgent) => void;
  onRegenerateTitle: (agent: AggregatedAgent) => void;
  onMarkUnread: (agent: AggregatedAgent) => void;
  nowIso: string;
  pinningAgentKey: string | null;
  deletingAgentKey: string | null;
  isArchivingAgent: (input: { serverId: string; agentId: string }) => boolean;
  onToggleCollapsed: (groupKey: string) => void;
  onReorderAgents: (groupKey: string, agents: AggregatedAgent[]) => void;
  pinnedProjectGroupKeys: ReadonlySet<string>;
  archivingProjectGroupKey: string | null;
  removingProjectGroupKey: string | null;
  markingReadProjectGroupKey: string | null;
  onToggleProjectPin: (group: SidebarSessionRenderGroup) => void;
  onOpenProjectPath: (group: SidebarSessionRenderGroup) => void;
  onRenameProject: (group: SidebarSessionRenderGroup) => void;
  onMarkProjectRead: (group: SidebarSessionRenderGroup) => void;
  onArchiveProject: (group: SidebarSessionRenderGroup) => void;
  onRemoveProject: (group: SidebarSessionRenderGroup) => void;
}

function SidebarSessionGroupView({
  group,
  groupStyle,
  serverId,
  isCompact,
  showGroupTitles,
  collapsed,
  selectedAgentId,
  onAgentPress,
  onTogglePin,
  onRename,
  onArchive,
  onDelete,
  onSnooze,
  onWake,
  onSettle,
  onUnsettle,
  onRegenerateTitle,
  onMarkUnread,
  nowIso,
  pinningAgentKey,
  deletingAgentKey,
  isArchivingAgent,
  onToggleCollapsed,
  onReorderAgents,
  pinnedProjectGroupKeys,
  archivingProjectGroupKey,
  removingProjectGroupKey,
  markingReadProjectGroupKey,
  onToggleProjectPin,
  onOpenProjectPath,
  onRenameProject,
  onMarkProjectRead,
  onArchiveProject,
  onRemoveProject,
}: SidebarSessionGroupViewProps) {
  const handleToggleCollapsed = useCallback(
    () => onToggleCollapsed(group.key),
    [group.key, onToggleCollapsed],
  );
  const groupRowsStyle = useMemo(
    () => [styles.groupRows, !isCompact && group.cwd && styles.desktopWorkspaceGroupRows],
    [group.cwd, isCompact],
  );
  const renderAgent = useCallback(
    ({ item, drag, isActive }: DraggableRenderItemInfo<AggregatedAgent>) => (
      <SidebarSessionRow
        agent={item}
        selectedAgentId={selectedAgentId}
        onAgentPress={onAgentPress}
        onTogglePin={onTogglePin}
        onRename={onRename}
        onArchive={onArchive}
        onDelete={onDelete}
        onSnooze={onSnooze}
        onWake={onWake}
        onSettle={onSettle}
        onUnsettle={onUnsettle}
        onRegenerateTitle={onRegenerateTitle}
        onMarkUnread={onMarkUnread}
        nowIso={nowIso}
        isPinning={pinningAgentKey === getAgentActionKey(item)}
        isArchiving={isArchivingAgent({ serverId: item.serverId, agentId: item.id })}
        isDeleting={deletingAgentKey === getAgentActionKey(item)}
        isDragging={isActive}
        drag={drag}
      />
    ),
    [
      deletingAgentKey,
      isArchivingAgent,
      nowIso,
      onAgentPress,
      onArchive,
      onDelete,
      onMarkUnread,
      onRegenerateTitle,
      onRename,
      onSettle,
      onSnooze,
      onTogglePin,
      onUnsettle,
      onWake,
      pinningAgentKey,
      selectedAgentId,
    ],
  );
  const handleDragEnd = useCallback(
    (agents: AggregatedAgent[]) => onReorderAgents(group.key, agents),
    [group.key, onReorderAgents],
  );
  const handleToggleProjectPin = useCallback(
    () => onToggleProjectPin(group),
    [group, onToggleProjectPin],
  );
  const handleOpenProjectPath = useCallback(
    () => onOpenProjectPath(group),
    [group, onOpenProjectPath],
  );
  const handleRenameProject = useCallback(() => onRenameProject(group), [group, onRenameProject]);
  const handleMarkProjectRead = useCallback(
    () => onMarkProjectRead(group),
    [group, onMarkProjectRead],
  );
  const handleArchiveProject = useCallback(
    () => onArchiveProject(group),
    [group, onArchiveProject],
  );
  const handleRemoveProject = useCallback(() => onRemoveProject(group), [group, onRemoveProject]);
  let renderedRows: React.ReactNode = null;
  if (!collapsed) {
    renderedRows = isCompact ? (
      <View style={groupRowsStyle}>
        {group.agents.map((agent) => (
          <SidebarSessionRow
            key={`${agent.serverId}:${agent.id}`}
            agent={agent}
            selectedAgentId={selectedAgentId}
            onAgentPress={onAgentPress}
            onTogglePin={onTogglePin}
            onRename={onRename}
            onArchive={onArchive}
            onDelete={onDelete}
            onSnooze={onSnooze}
            onWake={onWake}
            onSettle={onSettle}
            onUnsettle={onUnsettle}
            onRegenerateTitle={onRegenerateTitle}
            onMarkUnread={onMarkUnread}
            nowIso={nowIso}
            isPinning={pinningAgentKey === getAgentActionKey(agent)}
            isArchiving={isArchivingAgent({ serverId: agent.serverId, agentId: agent.id })}
            isDeleting={deletingAgentKey === getAgentActionKey(agent)}
          />
        ))}
      </View>
    ) : (
      <DraggableList
        data={group.agents}
        keyExtractor={sidebarSessionKeyExtractor}
        renderItem={renderAgent}
        onDragEnd={handleDragEnd}
        scrollEnabled={false}
        containerStyle={groupRowsStyle}
        testID={`sidebar-session-order-${group.key}`}
      />
    );
  }

  return (
    <View style={groupStyle} testID={`sidebar-session-group-${group.key}`}>
      {showGroupTitles ? (
        <SidebarSessionGroupHeader
          group={group}
          serverId={serverId}
          isCompact={isCompact}
          collapsed={collapsed}
          onToggleCollapsed={handleToggleCollapsed}
          isPinned={pinnedProjectGroupKeys.has(group.key)}
          isArchiving={archivingProjectGroupKey === group.key}
          isRemoving={removingProjectGroupKey === group.key}
          isMarkingRead={markingReadProjectGroupKey === group.key}
          onTogglePin={handleToggleProjectPin}
          onOpenPath={handleOpenProjectPath}
          onRename={handleRenameProject}
          onMarkAllRead={handleMarkProjectRead}
          onArchive={handleArchiveProject}
          onRemove={handleRemoveProject}
        />
      ) : null}
      {renderedRows}
    </View>
  );
}

// eslint-disable-next-line complexity -- Session orchestration spans query caches, async actions, and responsive states.
export function SidebarSessionList({
  agents,
  serverId,
  selectedAgentId,
  showGroupTitles = true,
  isRefreshing = false,
  isLoadingMore = false,
  hasMore = false,
  onRefresh,
  onLoadMore,
  onAgentPress,
  onAddProject,
  viewMode = "by-project",
  searchQuery = "",
}: SidebarSessionListProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const projectScrollContentStyle = isCompact ? styles.scrollContent : styles.desktopScrollContent;
  const queryClient = useQueryClient();
  const toast = useToast();
  const { archiveAgents, isArchivingAgent } = useArchiveAgent();
  const suppressedArchiveAgentIds = useSuppressedArchiveAgentIds(serverId ?? "");
  const buildSettledLabels = useSidebarV2Store((state) => state.buildSettledLabels);
  const buildSnoozedLabels = useSidebarV2Store((state) => state.buildSnoozedLabels);
  const clearSnoozedLabels = useSidebarV2Store((state) => state.clearSnoozedLabels);
  const markThreadUnread = useSidebarV2Store((state) => state.markThreadUnread);
  const [renamingAgent, setRenamingAgent] = useState<AggregatedAgent | null>(null);
  const [renamingProjectGroup, setRenamingProjectGroup] =
    useState<SidebarSessionRenderGroup | null>(null);
  const [pinningAgentKey, setPinningAgentKey] = useState<string | null>(null);
  const [deletingAgentKey, setDeletingAgentKey] = useState<string | null>(null);
  const [archivingProjectGroupKey, setArchivingProjectGroupKey] = useState<string | null>(null);
  const [removingProjectGroupKey, setRemovingProjectGroupKey] = useState<string | null>(null);
  const [markingReadProjectGroupKey, setMarkingReadProjectGroupKey] = useState<string | null>(null);
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [lifecycleNowIso, setLifecycleNowIso] = useState(() => new Date().toISOString());
  const sessionGroupOrderByServerId = useSidebarOrderStore(
    (state) => state.sessionGroupOrderByServerId,
  );
  const sessionOrderByServerAndGroup = useSidebarOrderStore(
    (state) => state.sessionOrderByServerAndGroup,
  );
  const getSessionOrder = useSidebarOrderStore((state) => state.getSessionOrder);
  const setSessionGroupOrder = useSidebarOrderStore((state) => state.setSessionGroupOrder);
  const setSessionOrder = useSidebarOrderStore((state) => state.setSessionOrder);
  const pinnedSessionGroupKeysByServerId = useSidebarOrderStore(
    (state) => state.pinnedSessionGroupKeysByServerId,
  );
  const hiddenSessionGroupKeysByServerId = useSidebarOrderStore(
    (state) => state.hiddenSessionGroupKeysByServerId,
  );
  const setSessionGroupPinned = useSidebarOrderStore((state) => state.setSessionGroupPinned);
  const setSessionGroupHidden = useSidebarOrderStore((state) => state.setSessionGroupHidden);
  const setHiddenSessionGroupKeys = useSidebarOrderStore(
    (state) => state.setHiddenSessionGroupKeys,
  );
  const clearHiddenSessionGroupKeys = useSidebarOrderStore(
    (state) => state.clearHiddenSessionGroupKeys,
  );
  const workspaces = useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.workspaces ?? null) : null,
  );
  const worktreeProjectHints = useMemo(() => {
    if (!workspaces || workspaces.size === 0) {
      return undefined;
    }
    return buildWorktreeProjectHintsFromSources(workspaces.values());
  }, [workspaces]);
  const workspaceDirectoryHints = useMemo(() => {
    if (!workspaces || workspaces.size === 0) {
      return undefined;
    }
    return buildWorkspaceDirectoryProjectHintsFromSources(workspaces.values());
  }, [workspaces]);
  const visibleAgents = useMemo(
    () => agents.filter((agent) => !agent.archivedAt && !suppressedArchiveAgentIds.has(agent.id)),
    [agents, suppressedArchiveAgentIds],
  );
  // Soft Home / draft routes intentionally pass no selectedAgentId — do not invent
  // a selection from "only one visible session" or the draft home looks occupied.
  const resolvedSelectedAgentId = selectedAgentId;
  const activitySortedGroups = useMemo(() => {
    const unknownWorkspaceLabel = t("sidebar.unknownWorkspace");
    const agentGroups = groupAgentsForSidebar(visibleAgents, {
      unknownWorkspaceLabel,
      pinnedGroupLabel: t("sidebar.pinnedSessions"),
      isPinnedAgent: isSidebarAgentPinned,
      worktreeProjectHints,
      workspaceDirectoryHints,
    });
    return buildRenderGroups(agentGroups);
  }, [t, visibleAgents, worktreeProjectHints, workspaceDirectoryHints]);
  const storedGroupOrder = useMemo(
    () => (serverId ? (sessionGroupOrderByServerId[serverId] ?? []) : []),
    [serverId, sessionGroupOrderByServerId],
  );
  const storedAgentOrderByGroup = useMemo(() => {
    void sessionOrderByServerAndGroup;
    if (!serverId) {
      return {};
    }
    return Object.fromEntries(
      activitySortedGroups.map((group) => [group.key, getSessionOrder(serverId, group.key)]),
    );
  }, [activitySortedGroups, getSessionOrder, serverId, sessionOrderByServerAndGroup]);
  const pinnedProjectGroupKeys = useMemo(
    () => new Set(serverId ? (pinnedSessionGroupKeysByServerId[serverId] ?? []) : []),
    [pinnedSessionGroupKeysByServerId, serverId],
  );
  const hiddenProjectGroupKeys = useMemo(
    () => new Set(serverId ? (hiddenSessionGroupKeysByServerId[serverId] ?? []) : []),
    [hiddenSessionGroupKeysByServerId, serverId],
  );
  const groups = useMemo(
    () =>
      applyStableSidebarSessionOrder(activitySortedGroups, {
        groupOrder: storedGroupOrder,
        agentOrderByGroup: storedAgentOrderByGroup,
        pinnedGroupKeys: pinnedProjectGroupKeys,
      }),
    [activitySortedGroups, pinnedProjectGroupKeys, storedAgentOrderByGroup, storedGroupOrder],
  );

  const nextSnoozeWakeAtMs = useMemo(() => {
    let earliest: number | null = null;
    for (const agent of visibleAgents) {
      const thread = agentToSidebarThread(agent);
      if (!thread.snoozedUntil) {
        continue;
      }
      const wakeMs = Date.parse(thread.snoozedUntil);
      if (Number.isNaN(wakeMs) || wakeMs <= Date.parse(lifecycleNowIso)) {
        continue;
      }
      if (earliest == null || wakeMs < earliest) {
        earliest = wakeMs;
      }
    }
    return earliest;
  }, [lifecycleNowIso, visibleAgents]);

  useEffect(() => {
    if (nextSnoozeWakeAtMs == null) {
      return;
    }
    const delayMs = Math.max(25, nextSnoozeWakeAtMs - Date.now() + 25);
    const timer = setTimeout(() => {
      setLifecycleNowIso(new Date().toISOString());
    }, delayMs);
    return () => clearTimeout(timer);
  }, [nextSnoozeWakeAtMs]);

  useEffect(() => {
    if (!serverId) {
      return;
    }
    const currentGroupKeys = activitySortedGroups
      .filter((group) => group.key !== PINNED_SIDEBAR_SESSION_GROUP_KEY)
      .map((group) => group.key);
    const nextGroupOrder = reconcileSidebarSessionOrder(storedGroupOrder, currentGroupKeys);
    if (!ordersEqual(storedGroupOrder, nextGroupOrder)) {
      setSessionGroupOrder(serverId, nextGroupOrder);
    }
    for (const group of activitySortedGroups) {
      const storedOrder = getSessionOrder(serverId, group.key);
      const nextOrder = reconcileSidebarSessionOrder(
        storedOrder,
        group.agents.map((agent) => agent.id),
      );
      if (!ordersEqual(storedOrder, nextOrder)) {
        setSessionOrder(serverId, group.key, nextOrder);
      }
    }
    // Reconcile hidden group keys: a group is only meaningfully hidden when it
    // currently has no agents. If a previously-removed project reappears (new
    // conversation, re-opened workspace, server re-seeding), un-hide its group
    // so the sidebar never stays permanently blank. "Remove project" is a
    // one-way action with no restore entry — without this prune the hidden
    // blacklist grows monotonically and can hide every active group.
    const storedHidden = hiddenSessionGroupKeysByServerId[serverId] ?? [];
    if (storedHidden.length > 0) {
      const activeGroupKeySet = new Set(currentGroupKeys);
      const nextHidden = storedHidden.filter((key) => !activeGroupKeySet.has(key));
      if (nextHidden.length !== storedHidden.length) {
        setHiddenSessionGroupKeys(serverId, nextHidden);
      }
    }
  }, [
    activitySortedGroups,
    getSessionOrder,
    hiddenSessionGroupKeysByServerId,
    serverId,
    setSessionGroupOrder,
    setSessionOrder,
    setHiddenSessionGroupKeys,
    storedGroupOrder,
  ]);
  const pinnedGroup = useMemo(
    () => groups.find((group) => group.key === PINNED_SIDEBAR_SESSION_GROUP_KEY) ?? null,
    [groups],
  );
  const visibleWorkspaceGroups = useMemo(
    () =>
      groups.filter(
        (group) =>
          group.key !== PINNED_SIDEBAR_SESSION_GROUP_KEY && !hiddenProjectGroupKeys.has(group.key),
      ),
    [groups, hiddenProjectGroupKeys],
  );
  // Safety net: if every active group is hidden but there are visible agents
  // (e.g. a hidden key matches the only active workspace, or reconcile has not
  // yet run on first paint), fall back to showing all non-pinned groups so the
  // sidebar never renders a "no sessions" empty state while the store holds
  // real agents. The reconcile effect above normally un-hides these, this
  // guards the window before it runs and any edge case it misses.
  const workspaceGroups = useMemo(
    () =>
      visibleWorkspaceGroups.length === 0 && !pinnedGroup && visibleAgents.length > 0
        ? groups.filter((group) => group.key !== PINNED_SIDEBAR_SESSION_GROUP_KEY)
        : visibleWorkspaceGroups,
    [groups, pinnedGroup, visibleAgents.length, visibleWorkspaceGroups],
  );
  const refreshControl = useMemo(
    () =>
      onRefresh ? (
        <ThemedRefreshControlHost
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          uniProps={refreshTintColorMapping}
        />
      ) : undefined,
    [isRefreshing, onRefresh],
  );
  const handleShowHiddenProjects = useCallback(() => {
    if (serverId) {
      clearHiddenSessionGroupKeys(serverId);
    }
  }, [clearHiddenSessionGroupKeys, serverId]);
  const renamingClient = useSessionStore((state) =>
    renamingAgent?.serverId ? (state.sessions[renamingAgent.serverId]?.client ?? null) : null,
  );
  const renamingProjectClient = useSessionStore((state) =>
    serverId && renamingProjectGroup ? (state.sessions[serverId]?.client ?? null) : null,
  );

  const handleRename = useCallback((agent: AggregatedAgent) => {
    rememberArchivedAgentDetail(agent);
    setRenamingAgent(agent);
  }, []);

  const handleToggleProjectPin = useCallback(
    (group: SidebarSessionRenderGroup) => {
      if (!serverId) {
        return;
      }
      setSessionGroupPinned(serverId, group.key, !pinnedProjectGroupKeys.has(group.key));
    },
    [pinnedProjectGroupKeys, serverId, setSessionGroupPinned],
  );

  const handleOpenProjectPath = useCallback(
    (group: SidebarSessionRenderGroup) => {
      if (!group.cwd) {
        return;
      }
      const openPath = getDesktopHost()?.opener?.openPath;
      if (!openPath) {
        toast.error(t("sidebar.openInFileExplorerUnavailable"));
        return;
      }
      void openPath(group.cwd).catch((error) => {
        toast.error(error instanceof Error ? error.message : t("sidebar.openInFileExplorerFailed"));
      });
    },
    [t, toast],
  );

  const handleRenameProject = useCallback((group: SidebarSessionRenderGroup) => {
    if (group.projectKey) {
      setRenamingProjectGroup(group);
    }
  }, []);

  const handleMarkProjectRead = useCallback(
    (group: SidebarSessionRenderGroup) => {
      if (!serverId) {
        return;
      }
      const actionClient = useSessionStore.getState().sessions[serverId]?.client ?? null;
      if (!actionClient) {
        toast.error(t("workspace.screen.hostDisconnected"));
        return;
      }
      const agentIds = group.agents
        .filter((agent) => agent.requiresAttention)
        .map((agent) => agent.id);
      if (agentIds.length === 0) {
        return;
      }
      setMarkingReadProjectGroupKey(group.key);
      void actionClient
        .clearAgentAttention(agentIds)
        .then(() => {
          clearAgentAttentionInStore(serverId, new Set(agentIds));
          invalidateSidebarSessionQueries(queryClient, serverId);
          return undefined;
        })
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : t("sidebar.markAllAsReadFailed"));
        })
        .finally(() => setMarkingReadProjectGroupKey(null));
    },
    [queryClient, serverId, t, toast],
  );

  const runArchive = useCallback(
    async (inputs: ArchiveAgentInput[]) => {
      const outcome = await archiveAgents(inputs);
      if (!outcome) {
        return;
      }
      if (outcome.failedCount > 0) {
        toast.show(
          <View style={styles.archiveFailureToast}>
            <Text style={styles.archiveFailureTitle}>
              {t("sidebar.archiveFailedSessions", { count: outcome.failedCount })}
            </Text>
            <Text style={styles.archiveFailureSub}>{t("sidebar.archiveFailedRestored")}</Text>
          </View>,
          {
            variant: "error",
            durationMs: 6000,
            action: {
              label: t("sidebar.retry"),
              onPress: () => {
                void runArchive(outcome.retryInputs);
              },
            },
          },
        );
      }
      // Success / background-timeout: silent. The archive control shows a spinner
      // while pending; once confirmed the row leaves the list.
    },
    [archiveAgents, t, toast],
  );

  const handleArchiveProject = useCallback(
    (group: SidebarSessionRenderGroup) => {
      void (async () => {
        const confirmed = await confirmDialog({
          title: t("sidebar.archiveProjectSessionsTitle"),
          message: t("sidebar.archiveProjectSessionsMessage", { name: group.label }),
          confirmLabel: t("sidebar.archiveProjectSessions"),
          cancelLabel: t("common.cancel"),
        });
        if (!confirmed) {
          return;
        }
        setArchivingProjectGroupKey(group.key);
        try {
          // Skip agents that are already archived — the server's close_items
          // silently drops any archive that fails (including idempotent
          // re-archives whose storage record is gone), which makes the client's
          // count check report a failure. Pre-filtering avoids sending
          // already-archived ids in the batch.
          const toArchive = group.agents
            .filter((agent) => !agent.archivedAt)
            .map((agent) => ({ serverId: agent.serverId, agentId: agent.id }));
          if (toArchive.length === 0) {
            return;
          }
          await runArchive(toArchive);
        } finally {
          setArchivingProjectGroupKey(null);
        }
      })();
    },
    [runArchive, t],
  );

  const handleRemoveProject = useCallback(
    (group: SidebarSessionRenderGroup) => {
      if (!serverId) {
        return;
      }
      void (async () => {
        const confirmed = await confirmDialog({
          title: t("sidebar.removeProjectTitle"),
          message: t("sidebar.removeProjectMessage", { name: group.label }),
          confirmLabel: t("sidebar.removeProject"),
          cancelLabel: t("common.cancel"),
          destructive: true,
        });
        if (!confirmed) {
          return;
        }
        setRemovingProjectGroupKey(group.key);
        setSessionGroupHidden(serverId, group.key, true);
        setRemovingProjectGroupKey(null);
      })();
    },
    [serverId, setSessionGroupHidden, t],
  );

  const handleTogglePin = useCallback(
    (agent: AggregatedAgent) => {
      const actionClient = useSessionStore.getState().sessions[agent.serverId]?.client ?? null;
      if (!actionClient) {
        toast.error(t("workspace.screen.hostDisconnected"));
        return;
      }
      const actionKey = getAgentActionKey(agent);
      const wasPinned = isSidebarAgentPinned(agent);
      const nextPinned = !wasPinned;
      const labels = { [SIDEBAR_PINNED_LABEL]: nextPinned ? "true" : "false" };
      const cacheSnapshot = getSidebarAgentLabelCacheSnapshot(queryClient, agent.serverId);
      setPinningAgentKey(actionKey);
      updateAgentLabelsInStore({
        serverId: agent.serverId,
        agentId: agent.id,
        labels,
      });
      patchAgentLabelsInSidebarCaches(queryClient, {
        serverId: agent.serverId,
        agentId: agent.id,
        labels,
      });
      void (async () => {
        try {
          await actionClient.updateAgent(agent.id, { labels });
          invalidateSidebarSessionQueries(queryClient, agent.serverId);
        } catch (error) {
          updateAgentLabelsInStore({
            serverId: agent.serverId,
            agentId: agent.id,
            labels: { [SIDEBAR_PINNED_LABEL]: wasPinned ? "true" : "false" },
          });
          restoreSidebarAgentLabelCacheSnapshot(queryClient, agent.serverId, cacheSnapshot);
          toast.error(error instanceof Error ? error.message : t("sidebar.pinSessionFailed"));
        } finally {
          setPinningAgentKey((currentKey) => (currentKey === actionKey ? null : currentKey));
        }
      })();
    },
    [queryClient, t, toast],
  );

  const applyAgentLabels = useCallback(
    async (agent: AggregatedAgent, labels: Record<string, string>) => {
      const actionClient = useSessionStore.getState().sessions[agent.serverId]?.client ?? null;
      if (!actionClient) {
        toast.error(t("workspace.screen.hostDisconnected"));
        return false;
      }

      const previousLabels: Record<string, string> = {};
      for (const key of Object.keys(labels)) {
        previousLabels[key] = agent.labels?.[key] ?? "";
      }
      const cacheSnapshot = getSidebarAgentLabelCacheSnapshot(queryClient, agent.serverId);
      updateAgentLabelsInStore({
        serverId: agent.serverId,
        agentId: agent.id,
        labels,
      });
      patchAgentLabelsInSidebarCaches(queryClient, {
        serverId: agent.serverId,
        agentId: agent.id,
        labels,
      });

      try {
        await actionClient.updateAgent(agent.id, { labels });
        invalidateSidebarSessionQueries(queryClient, agent.serverId);
        return true;
      } catch (error) {
        updateAgentLabelsInStore({
          serverId: agent.serverId,
          agentId: agent.id,
          labels: previousLabels,
        });
        restoreSidebarAgentLabelCacheSnapshot(queryClient, agent.serverId, cacheSnapshot);
        toast.error(error instanceof Error ? error.message : t("sidebarV2.actionFailed"));
        return false;
      }
    },
    [queryClient, t, toast],
  );

  const handleSnooze = useCallback(
    (agent: AggregatedAgent, untilIso: string) => {
      const atIso = new Date().toISOString();
      void applyAgentLabels(agent, buildSnoozedLabels(untilIso, atIso));
    },
    [applyAgentLabels, buildSnoozedLabels],
  );

  const handleWake = useCallback(
    (agent: AggregatedAgent) => {
      void applyAgentLabels(agent, clearSnoozedLabels());
    },
    [applyAgentLabels, clearSnoozedLabels],
  );

  const handleSettle = useCallback(
    (agent: AggregatedAgent) => {
      void applyAgentLabels(agent, buildSettledLabels(new Date().toISOString(), true));
    },
    [applyAgentLabels, buildSettledLabels],
  );

  const handleUnsettle = useCallback(
    (agent: AggregatedAgent) => {
      void applyAgentLabels(agent, buildSettledLabels(new Date().toISOString(), false));
    },
    [applyAgentLabels, buildSettledLabels],
  );

  const handleRegenerateTitle = useCallback(
    (agent: AggregatedAgent) => {
      const actionClient = useSessionStore.getState().sessions[agent.serverId]?.client ?? null;
      if (!actionClient) {
        toast.error(t("workspace.screen.hostDisconnected"));
        return;
      }
      void (async () => {
        try {
          await actionClient.updateAgent(agent.id, { regenerateTitle: true });
          invalidateSidebarSessionQueries(queryClient, agent.serverId);
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : t("sidebarV2.regenerateTitleFailed"),
          );
        }
      })();
    },
    [queryClient, t, toast],
  );

  const handleMarkUnread = useCallback(
    (agent: AggregatedAgent) => {
      const threadKey = sidebarV2ThreadKey(agent.serverId, agent.id);
      const completedAt =
        agent.lastActivityAt instanceof Date && !Number.isNaN(agent.lastActivityAt.getTime())
          ? agent.lastActivityAt.toISOString()
          : new Date().toISOString();
      markThreadUnread(threadKey, completedAt);
    },
    [markThreadUnread],
  );

  const handleArchive = useCallback(
    (agent: AggregatedAgent) => {
      if (agent.archivedAt) {
        return;
      }
      void runArchive([{ serverId: agent.serverId, agentId: agent.id }]);
    },
    [runArchive],
  );

  const handleDelete = useCallback(
    (agent: AggregatedAgent) => {
      const actionClient = useSessionStore.getState().sessions[agent.serverId]?.client ?? null;
      if (!actionClient) {
        toast.error(t("workspace.screen.hostDisconnected"));
        return;
      }
      const actionKey = getAgentActionKey(agent);
      void (async () => {
        const confirmed = await confirmDialog({
          title: t("sidebar.deleteSessionTitle"),
          message: t("sidebar.deleteSessionMessage", {
            name: agent.title || t("session.newSession"),
          }),
          confirmLabel: t("sidebar.deleteSession"),
          cancelLabel: t("common.cancel"),
          destructive: true,
        });
        if (!confirmed) {
          return;
        }
        setDeletingAgentKey(actionKey);
        try {
          await actionClient.deleteAgent(agent.id);
          deleteAgentFromStore({ serverId: agent.serverId, agentId: agent.id });
          invalidateSidebarSessionQueries(queryClient, agent.serverId);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t("sidebar.deleteSessionFailed"));
        } finally {
          setDeletingAgentKey(null);
        }
      })();
    },
    [queryClient, t, toast],
  );

  const handleRenameClose = useCallback(() => {
    setRenamingAgent(null);
  }, []);
  const handleRenameProjectClose = useCallback(() => {
    setRenamingProjectGroup(null);
  }, []);
  const toggleCollapsedGroup = useCallback((groupKey: string) => {
    setCollapsedGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);
  const handleReorderAgents = useCallback(
    (groupKey: string, reorderedAgents: AggregatedAgent[]) => {
      if (!serverId) {
        return;
      }
      setSessionOrder(
        serverId,
        groupKey,
        reorderedAgents.map((agent) => agent.id),
      );
    },
    [serverId, setSessionOrder],
  );

  const handleRenameSubmit = useCallback(
    async (nextTitle: string) => {
      if (!renamingAgent) {
        return;
      }
      if (!renamingClient) {
        throw new Error(t("workspace.screen.hostDisconnected"));
      }
      const trimmed = nextTitle.trim();
      await renamingClient.updateAgent(renamingAgent.id, { name: trimmed });
      void queryClient.invalidateQueries({
        queryKey: ["sidebarAgentsList", renamingAgent.serverId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["allAgents", renamingAgent.serverId],
      });
      for (const queryKey of agentHistoryQueryKeys(renamingAgent.serverId)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
    [queryClient, renamingAgent, renamingClient, t],
  );

  const handleRenameProjectSubmit = useCallback(
    async (nextTitle: string) => {
      if (!serverId || !renamingProjectGroup?.projectKey) {
        return;
      }
      if (!renamingProjectClient) {
        throw new Error(t("workspace.screen.hostDisconnected"));
      }
      const trimmed = nextTitle.trim();
      if (!trimmed) {
        return;
      }
      await renamingProjectClient.renameProject(renamingProjectGroup.projectKey, trimmed);
      updateProjectNameInStore(serverId, renamingProjectGroup.projectKey, trimmed);
      invalidateSidebarSessionQueries(queryClient, serverId);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      setRenamingProjectGroup(null);
    },
    [queryClient, renamingProjectClient, renamingProjectGroup, serverId, t],
  );

  const renameModal = (
    <AdaptiveRenameModal
      visible={renamingAgent !== null}
      title={t("workspace.screen.renameAgent")}
      initialValue={renamingAgent?.title ?? ""}
      submitLabel={t("workspace.screen.rename")}
      maxLength={200}
      onClose={handleRenameClose}
      onSubmit={handleRenameSubmit}
      testID={
        renamingAgent
          ? `sidebar-session-rename-modal-${renamingAgent.serverId}-${renamingAgent.id}`
          : undefined
      }
    />
  );
  const renameProjectModal = (
    <AdaptiveRenameModal
      visible={renamingProjectGroup !== null}
      title={t("sidebar.renameProject")}
      initialValue={renamingProjectGroup?.label ?? ""}
      submitLabel={t("workspace.screen.rename")}
      maxLength={200}
      onClose={handleRenameProjectClose}
      onSubmit={handleRenameProjectSubmit}
      testID={
        renamingProjectGroup
          ? `sidebar-session-project-rename-modal-${renamingProjectGroup.key}`
          : undefined
      }
    />
  );

  if (!serverId) {
    return (
      <View style={styles.emptyContainer} testID="sidebar-sessions">
        <Text style={styles.emptyTitle}>{t("sidebar.noHost")}</Text>
        {renameModal}
        {renameProjectModal}
      </View>
    );
  }

  if (viewMode === "by-status") {
    return (
      <View style={styles.container} testID="sidebar-sessions">
        <SidebarStatusView
          agents={visibleAgents}
          serverId={serverId}
          selectedAgentId={resolvedSelectedAgentId}
          onAgentPress={onAgentPress}
          onSnooze={handleSnooze}
          onWake={handleWake}
          onSettle={handleSettle}
          onUnsettle={handleUnsettle}
          onRegenerateTitle={handleRegenerateTitle}
          onMarkUnread={handleMarkUnread}
          onDelete={handleDelete}
          onRename={handleRename}
          onAddProject={onAddProject}
          searchQuery={searchQuery}
          worktreeProjectHints={worktreeProjectHints}
        />
        {renameModal}
        {renameProjectModal}
      </View>
    );
  }

  const projectSearchQuery = searchQuery.trim().toLowerCase();
  const filteredPinnedGroup =
    projectSearchQuery.length === 0 || !pinnedGroup
      ? pinnedGroup
      : Object.assign({}, pinnedGroup, {
          agents: pinnedGroup.agents.filter((agent) =>
            (agent.title ?? "").toLowerCase().includes(projectSearchQuery),
          ),
        });
  const filteredWorkspaceGroups =
    projectSearchQuery.length === 0
      ? workspaceGroups
      : workspaceGroups
          .map((group) =>
            Object.assign({}, group, {
              agents: group.agents.filter((agent) =>
                (agent.title ?? "").toLowerCase().includes(projectSearchQuery),
              ),
            }),
          )
          .filter((group) => group.agents.length > 0);
  const filteredPinnedForRender =
    filteredPinnedGroup && filteredPinnedGroup.agents.length > 0 ? filteredPinnedGroup : null;

  if (!filteredPinnedForRender && filteredWorkspaceGroups.length === 0) {
    const hasHiddenProjects =
      !!serverId && (hiddenSessionGroupKeysByServerId[serverId] ?? []).length > 0;
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.emptyScrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
        testID="sidebar-sessions"
      >
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>
            {projectSearchQuery.length > 0
              ? t("sidebarV2.noSearchResults")
              : t("sidebar.noSessions")}
          </Text>
          {onAddProject && projectSearchQuery.length === 0 ? (
            <Button variant="ghost" size="sm" onPress={onAddProject}>
              {t("sidebar.addProject")}
            </Button>
          ) : null}
          {hasHiddenProjects && projectSearchQuery.length === 0 ? (
            <Button variant="ghost" size="sm" onPress={handleShowHiddenProjects}>
              {t("sidebar.showHiddenProjects")}
            </Button>
          ) : null}
        </View>
        {renameModal}
        {renameProjectModal}
      </ScrollView>
    );
  }

  const defaultGroupStyle = isCompact ? styles.group : styles.desktopGroup;

  return (
    <View style={styles.container} testID="sidebar-sessions">
      <ScrollView
        style={styles.container}
        contentContainerStyle={projectScrollContentStyle}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}
      >
        {filteredPinnedForRender ? (
          <SidebarSessionGroupView
            group={filteredPinnedForRender}
            groupStyle={isCompact && showGroupTitles ? styles.pinnedGroup : defaultGroupStyle}
            serverId={serverId}
            isCompact={isCompact}
            showGroupTitles={showGroupTitles}
            collapsed={false}
            selectedAgentId={resolvedSelectedAgentId}
            onAgentPress={onAgentPress}
            onTogglePin={handleTogglePin}
            onRename={handleRename}
            onArchive={handleArchive}
            onDelete={handleDelete}
            onSnooze={handleSnooze}
            onWake={handleWake}
            onSettle={handleSettle}
            onUnsettle={handleUnsettle}
            onRegenerateTitle={handleRegenerateTitle}
            onMarkUnread={handleMarkUnread}
            nowIso={lifecycleNowIso}
            pinningAgentKey={pinningAgentKey}
            deletingAgentKey={deletingAgentKey}
            isArchivingAgent={isArchivingAgent}
            onToggleCollapsed={toggleCollapsedGroup}
            onReorderAgents={handleReorderAgents}
            pinnedProjectGroupKeys={pinnedProjectGroupKeys}
            archivingProjectGroupKey={archivingProjectGroupKey}
            removingProjectGroupKey={removingProjectGroupKey}
            markingReadProjectGroupKey={markingReadProjectGroupKey}
            onToggleProjectPin={handleToggleProjectPin}
            onOpenProjectPath={handleOpenProjectPath}
            onRenameProject={handleRenameProject}
            onMarkProjectRead={handleMarkProjectRead}
            onArchiveProject={handleArchiveProject}
            onRemoveProject={handleRemoveProject}
          />
        ) : null}
        {filteredWorkspaceGroups.length > 0 && !isCompact && showGroupTitles ? (
          <Text style={styles.desktopSectionLabel}>{t("sidebar.projects")}</Text>
        ) : null}
        {filteredWorkspaceGroups.map((group) => (
          <SidebarSessionGroupView
            key={group.key}
            group={group}
            groupStyle={defaultGroupStyle}
            serverId={serverId}
            isCompact={isCompact}
            showGroupTitles={showGroupTitles}
            collapsed={Boolean(group.cwd && collapsedGroupKeys.has(group.key))}
            selectedAgentId={resolvedSelectedAgentId}
            onAgentPress={onAgentPress}
            onTogglePin={handleTogglePin}
            onRename={handleRename}
            onArchive={handleArchive}
            onDelete={handleDelete}
            onSnooze={handleSnooze}
            onWake={handleWake}
            onSettle={handleSettle}
            onUnsettle={handleUnsettle}
            onRegenerateTitle={handleRegenerateTitle}
            onMarkUnread={handleMarkUnread}
            nowIso={lifecycleNowIso}
            pinningAgentKey={pinningAgentKey}
            deletingAgentKey={deletingAgentKey}
            isArchivingAgent={isArchivingAgent}
            onToggleCollapsed={toggleCollapsedGroup}
            onReorderAgents={handleReorderAgents}
            pinnedProjectGroupKeys={pinnedProjectGroupKeys}
            archivingProjectGroupKey={archivingProjectGroupKey}
            removingProjectGroupKey={removingProjectGroupKey}
            markingReadProjectGroupKey={markingReadProjectGroupKey}
            onToggleProjectPin={handleToggleProjectPin}
            onOpenProjectPath={handleOpenProjectPath}
            onRenameProject={handleRenameProject}
            onMarkProjectRead={handleMarkProjectRead}
            onArchiveProject={handleArchiveProject}
            onRemoveProject={handleRemoveProject}
          />
        ))}
        {hasMore && onLoadMore ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={onLoadMore}
            loading={isLoadingMore}
            disabled={isLoadingMore}
            style={styles.loadMoreButton}
          >
            {isLoadingMore ? t("common.loading") : t("sidebar.loadMoreSessions")}
          </Button>
        ) : null}
        {renameModal}
        {renameProjectModal}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  quickArchiveSpinner: {
    width: ICON_SIZE.sm,
    height: ICON_SIZE.sm,
  },
  archiveFailureToast: {
    gap: 2,
  },
  archiveFailureTitle: {
    fontSize: 13,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  archiveFailureSub: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
  },
  scrollContent: {
    paddingTop: theme.spacing[1],
    paddingRight: theme.spacing[2],
    paddingBottom: theme.spacing[3],
    paddingLeft: theme.spacing[2],
  },
  // Soft .nav-scroll: design padding 4 8 10.
  desktopScrollContent: {
    paddingTop: 4,
    paddingRight: 8,
    paddingBottom: 10,
    paddingLeft: 8,
  },
  group: {
    marginBottom: theme.spacing[2],
  },
  desktopGroup: {
    marginBottom: 0,
  },
  pinnedGroup: {
    marginHorizontal: theme.spacing[2],
    marginBottom: theme.spacing[3],
    paddingBottom: theme.spacing[2],
    borderBottomWidth: 1,
    // Soft quiet chrome rule (--border-soft).
    borderBottomColor: theme.colors.secondary,
  },
  groupHeader: {
    minHeight: 26,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: 10,
  },
  groupHeaderLabel: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  // Soft .sec padding 10 10 4.
  desktopGroupHeader: {
    minHeight: 26,
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    paddingTop: 10,
    paddingBottom: 4,
    paddingHorizontal: 10,
  },
  desktopGroupHeaderLabel: {
    minWidth: 0,
    minHeight: 28,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  groupTitle: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
  },
  // Soft .sec: 11.5px medium muted section labels.
  desktopGroupTitle: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: 11.5,
    lineHeight: WORKBENCH_SIDEBAR_GROUP_LINE_HEIGHT,
    fontWeight: theme.fontWeight.medium,
  },
  // Soft .proj group: 12.5 muted (not body 14).
  desktopWorkspaceGroupTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
  },
  // Soft .sec: 11.5 medium muted section header.
  desktopSectionLabel: {
    marginTop: 12,
    marginRight: 10,
    marginBottom: 4,
    marginLeft: 10,
    color: theme.colors.foregroundMuted,
    fontSize: 11.5,
    lineHeight: WORKBENCH_SIDEBAR_GROUP_LINE_HEIGHT,
    fontWeight: theme.fontWeight.medium,
  },
  groupAddButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    flexShrink: 0,
  },
  groupAddButtonActive: {
    // Soft open/active chrome: surface3 (surface1 remains hover).
    backgroundColor: theme.colors.surface3,
  },
  // Compact/native: stretch the full header and center the 28px action buttons.
  groupActions: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
    backgroundColor: theme.colors.surfaceSidebar,
    zIndex: 1,
  },
  // Desktop group header uses asymmetric soft .sec padding (10/4). Pin the
  // action strip to that content box so ⋯ / new sit on the folder label row
  // instead of floating near the top padding edge (top: 1 used to misalign).
  desktopGroupActions: {
    position: "absolute",
    top: 10,
    right: 10,
    bottom: 4,
    width: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
    backgroundColor: theme.colors.surfaceSidebar,
    zIndex: 1,
  },
  groupActionsHidden: {
    opacity: 0,
  },
  groupRows: {
    gap: 0,
    paddingLeft: 0,
  },
  // Soft session rows align with the project header label; avoid an extra tree
  // indent that reads as empty space beside the selected chip.
  desktopWorkspaceGroupRows: {
    paddingLeft: 0,
  },
  row: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: 10,
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
    opacity: 1,
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowSettled: {
    opacity: 0.55,
  },
  // Soft mobile selected: soft fill, no hard accent bar.
  rowSelected: {
    // Soft fill only. No shadow/opacity — selection must not re-rasterize text.
    backgroundColor: theme.colors.surface0,
  },
  rowSelectedIndicator: {
    display: "none",
  },
  rowLeading: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  snoozeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: theme.colors.statusWarningBg,
    flexShrink: 0,
  },
  snoozeBadgeText: {
    fontSize: 11,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 16,
    color: theme.colors.statusWarning,
  },
  settledTimeLabel: {
    fontSize: 11,
    lineHeight: 16,
    color: theme.colors.foregroundFaint,
    flexShrink: 0,
  },
  // Soft .sess: min ~34, radius 10, quiet padding.
  // No right padding reserve: hover quick actions (pin/archive) are absolutely
  // positioned and float over the trailing text on hover, so the title can fill
  // the full row width when not hovered. `overflow: hidden` clips the hover
  // fade mask to the rounded corners.
  desktopRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: 7,
    paddingLeft: 10,
    paddingRight: 10,
    borderRadius: 10,
    overflow: "hidden",
  },
  desktopRowContainer: {
    position: "relative",
    // Soft .sess margin-left 4px.
    marginLeft: 4,
  },
  desktopRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
    opacity: 1,
  },
  desktopRowSelected: {
    // Soft .sess.on: white/soft fill only. No boxShadow — selection must not
    // re-composite text for every sibling row.
    backgroundColor: theme.colors.surface0,
  },
  desktopRowPressed: {
    opacity: 0.9,
  },
  desktopRowDragging: {
    backgroundColor: theme.colors.surface1,
    opacity: 0.86,
  },
  desktopRowSelectedIndicator: {
    display: "none",
  },
  desktopRowLeading: {
    width: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  desktopRowContent: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowMenuButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    flexShrink: 0,
  },
  rowMenuButtonActive: {
    // Soft open/active chrome: surface3 (surface1 remains hover).
    backgroundColor: theme.colors.surface3,
  },
  desktopRowMenuButton: {
    backgroundColor: theme.colors.surfaceSidebar,
  },
  desktopRowMenuSlot: {
    position: "absolute",
    top: 2,
    right: 2,
  },
  desktopRowMenuHidden: {
    opacity: 0,
  },
  rowQuickActions: {
    width: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  rowQuickHidden: {
    opacity: 0,
  },
  pointerEventsNone: {
    pointerEvents: "none",
  },
  rowQuickButton: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  rowQuickButtonActive: {
    // Soft open/active chrome: surface3 (surface1 remains hover).
    backgroundColor: theme.colors.surface3,
  },
  rowQuickButtonPressed: {
    opacity: 0.85,
  },
  desktopRowQuickActions: {
    position: "absolute",
    top: 3,
    right: theme.spacing[1],
    bottom: 3,
    width: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  // Hover fade mask: anchored to the row's right edge, sits under the quick
  // action icons so the trailing title text fades into the row background.
  desktopRowFadeMask: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: DESKTOP_ROW_FADE_MASK_WIDTH,
  },
  // Soft row hover wash: transparent → surfaceSidebarHover.
  desktopRowFadeMaskHovered: isWeb
    ? ({
        backgroundImage: `linear-gradient(to right, transparent 0%, ${theme.colors.surfaceSidebarHover} 55%, ${theme.colors.surfaceSidebarHover} 100%)`,
      } as object)
    : {
        backgroundColor: theme.colors.surfaceSidebarHover,
        opacity: 0.92,
      },
  // Soft selected chip: transparent → surface0.
  desktopRowFadeMaskSelected: isWeb
    ? ({
        backgroundImage: `linear-gradient(to right, transparent 0%, ${theme.colors.surface0} 55%, ${theme.colors.surface0} 100%)`,
      } as object)
    : {
        backgroundColor: theme.colors.surface0,
        opacity: 0.92,
      },
  desktopRowQuickButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  desktopRowQuickButtonActive: {
    // Soft open/active chrome: surface3 (surface1 remains hover).
    backgroundColor: theme.colors.surface3,
  },
  desktopRowQuickButtonPressed: {
    opacity: 0.9,
  },
  // Soft .sess .t: 12.5 on compact session rows too.
  rowTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: 12.5,
    lineHeight: 16,
    paddingTop: 4,
    transform: [{ translateY: 2 }],
    includeFontPadding: false,
    fontWeight: theme.fontWeight.normal,
  },
  rowTitleSelected: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.normal,
  },
  // Soft .sess .t: 12.5px text-2. Keep color stable on selection so text does
  // not re-rasterize thicker/wider when the row becomes active.
  desktopRowTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.normal,
  },
  desktopRowTitleSelected: {
    color: theme.colors.foreground,
  },
  emptyScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[8],
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[8],
  },
  emptyTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    textAlign: "center",
    lineHeight: 16,
  },
  loadMoreButton: {
    alignSelf: "center",
    marginTop: theme.spacing[1],
  },
}));
