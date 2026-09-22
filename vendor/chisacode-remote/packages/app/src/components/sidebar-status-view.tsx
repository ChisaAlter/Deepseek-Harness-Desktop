import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  AlarmClock,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Plus,
  Undo2,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ThemedIconHost } from "@/components/themed-icon-host";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { WORKBENCH_META_LINE_HEIGHT } from "@/constants/layout";
import { Button } from "@/components/ui/button";
import { getProviderIcon } from "@/components/provider-icons";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { isWeb } from "@/constants/platform";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { rememberArchivedAgentDetail } from "@/utils/agent-history-navigation";
import { agentToSidebarThread, type SidebarV2Thread } from "@/sidebar-v2/agent-adapter";
import {
  pageSettledThreads,
  partitionThreadsForSidebarV2,
  SETTLED_TAIL_PAGE_COUNT,
} from "@/sidebar-v2/shelves";
import {
  canSettle,
  canSnooze,
  resolveSnoozePresets,
  snoozeWakeLabel,
  threadWokeAt,
  type SnoozePreset,
} from "@/sidebar-v2/snooze";
import { sidebarV2ThreadKey, useSidebarV2Store } from "@/sidebar-v2/store";
import {
  formatRelativeTimeLabel,
  resolveSidebarV2TopStatus,
  shouldSidebarRowRecede,
} from "@/sidebar-v2/presentation";
import { resolveSidebarV2Status } from "@/sidebar-v2/logic";
import { resolveSelectedThreads } from "@/sidebar-v2/actions";
import { shortProjectName } from "@/sidebar-v2/projects";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const AUTO_SETTLE_AFTER_DAYS = 3;

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const statusWarningColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

interface SidebarStatusViewProps {
  agents: AggregatedAgent[];
  serverId: string | null;
  selectedAgentId?: string;
  onAgentPress?: () => void;
  onSnooze: (agent: AggregatedAgent, untilIso: string) => void;
  onWake: (agent: AggregatedAgent) => void;
  onSettle: (agent: AggregatedAgent) => void;
  onUnsettle: (agent: AggregatedAgent) => void;
  onRegenerateTitle: (agent: AggregatedAgent) => void;
  onMarkUnread: (agent: AggregatedAgent) => void;
  onDelete: (agent: AggregatedAgent) => void;
  onRename: (agent: AggregatedAgent) => void;
  onAddProject?: () => void;
  searchQuery?: string;
  /**
   * Worktree hash → project identity hints so cwd-derived placements that
   * stripped a CHISACODE_HOME worktree into the home directory resolve to the
   * real project instead of a fake home group.
   */
  worktreeProjectHints?: ReadonlyMap<string, { projectKey: string | null }>;
}

function normalizeSelectedAgentId(selectedAgentId: string | undefined): string | null {
  if (!selectedAgentId) {
    return null;
  }
  const trimmed = selectedAgentId.trim();
  if (!trimmed) {
    return null;
  }
  const separator = trimmed.indexOf(":");
  if (separator <= 0) {
    return trimmed;
  }
  return trimmed.slice(separator + 1);
}

function extractModifierKeys(event: GestureResponderEvent | undefined): {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
} {
  const native = event?.nativeEvent as
    | { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }
    | undefined;
  return {
    metaKey: Boolean(native?.metaKey),
    ctrlKey: Boolean(native?.ctrlKey),
    shiftKey: Boolean(native?.shiftKey),
  };
}

/**
 * Lifecycle-shelf presentation of the session list (Active / Snoozed / Settled),
 * rendered with T3-style cards for active rows and slim settled/snoozed rows.
 */
// eslint-disable-next-line complexity -- shelf view owns search/scope/partition/render branches
export function SidebarStatusView({
  agents,
  serverId,
  selectedAgentId,
  onAgentPress,
  onSnooze,
  onWake,
  onSettle,
  onUnsettle,
  onRegenerateTitle,
  onMarkUnread,
  onDelete,
  onRename,
  onAddProject,
  searchQuery = "",
  worktreeProjectHints,
}: SidebarStatusViewProps) {
  const { t } = useTranslation();
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  const normalizedSelectedAgentId = useMemo(
    () => normalizeSelectedAgentId(selectedAgentId),
    [selectedAgentId],
  );

  const uiState = useSidebarV2Store((state) =>
    serverId ? state.getServerUiState(serverId) : null,
  );
  const setSettledShelfExpanded = useSidebarV2Store((state) => state.setSettledShelfExpanded);
  const setSnoozedShelfExpanded = useSidebarV2Store((state) => state.setSnoozedShelfExpanded);
  const setSettledVisibleCount = useSidebarV2Store((state) => state.setSettledVisibleCount);
  const setScopeProjectKey = useSidebarV2Store((state) => state.setScopeProjectKey);
  const localUnreadCompletedAtByKey = useSidebarV2Store(
    (state) => state.localUnreadCompletedAtByKey,
  );
  const selectedThreadKeys = useSidebarV2Store((state) => state.selectedThreadKeys);
  const toggleThreadSelected = useSidebarV2Store((state) => state.toggleThreadSelected);
  const rangeSelectThreads = useSidebarV2Store((state) => state.rangeSelectThreads);
  const clearSelection = useSidebarV2Store((state) => state.clearSelection);

  const threads = useMemo(
    () =>
      agents
        .filter((agent) => !agent.archivedAt)
        .map((agent) => agentToSidebarThread(agent, null, undefined, worktreeProjectHints)),
    [agents, worktreeProjectHints],
  );

  const agentById = useMemo(() => {
    const map = new Map<string, AggregatedAgent>();
    for (const agent of agents) {
      map.set(agent.id, agent);
    }
    return map;
  }, [agents]);

  // T3-style project scope list: one logical project per key, used by the
  // "All projects" dropdown (not chip pills). Labels use the short basename
  // (owner/repo → repo) to match the T3 scope menu — never the raw owner/repo.
  const projectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const thread of threads) {
      if (!thread.projectKey) {
        continue;
      }
      if (!seen.has(thread.projectKey)) {
        seen.set(thread.projectKey, shortProjectName(thread.projectName ?? thread.projectKey));
      }
    }
    return [...seen.entries()]
      .map(([projectKey, displayName]) => ({
        projectKey,
        displayName,
      }))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }, [threads]);

  const scopedThreads = useMemo(() => {
    const scope = uiState?.scopeProjectKey ?? null;
    if (!scope) {
      return threads;
    }
    return threads.filter((thread) => thread.projectKey === scope);
  }, [threads, uiState?.scopeProjectKey]);

  const partition = useMemo(
    () =>
      partitionThreadsForSidebarV2({
        threads: scopedThreads,
        now: nowIso,
        snoozeNow: nowIso,
        autoSettleAfterDays: AUTO_SETTLE_AFTER_DAYS,
      }),
    [nowIso, scopedThreads],
  );

  useEffect(() => {
    if (!partition.nextSnoozeWakeAt) {
      return;
    }
    const wakeMs = Date.parse(partition.nextSnoozeWakeAt);
    if (Number.isNaN(wakeMs)) {
      return;
    }
    const delayMs = Math.max(25, wakeMs - Date.now() + 25);
    const timer = setTimeout(() => setNowIso(new Date().toISOString()), delayMs);
    return () => clearTimeout(timer);
  }, [partition.nextSnoozeWakeAt]);

  const settledPaging = useMemo(
    () =>
      pageSettledThreads({
        settledThreads: partition.settledThreads,
        settledVisibleCount: uiState?.settledVisibleCount ?? 10,
        settledShelfExpanded: uiState?.settledShelfExpanded ?? true,
        routeThreadKey: normalizedSelectedAgentId,
      }),
    [
      normalizedSelectedAgentId,
      partition.settledThreads,
      uiState?.settledShelfExpanded,
      uiState?.settledVisibleCount,
    ],
  );

  const visibleSnoozed = useMemo(() => {
    if (uiState?.snoozedShelfExpanded ?? false) {
      return partition.snoozedThreads;
    }
    if (!normalizedSelectedAgentId) {
      return [];
    }
    return partition.snoozedThreads.filter((thread) => thread.id === normalizedSelectedAgentId);
  }, [normalizedSelectedAgentId, partition.snoozedThreads, uiState?.snoozedShelfExpanded]);

  const isSearching = searchQuery.trim().length > 0;
  const searchResults = useMemo(() => {
    if (!isSearching) {
      return [];
    }
    const query = searchQuery.trim().toLowerCase();
    return threads.filter((thread) => thread.title.toLowerCase().includes(query));
  }, [isSearching, searchQuery, threads]);

  const handleToggleSettled = useCallback(() => {
    if (!serverId) {
      return;
    }
    setSettledShelfExpanded(serverId, !(uiState?.settledShelfExpanded ?? true));
  }, [serverId, setSettledShelfExpanded, uiState?.settledShelfExpanded]);

  const handleToggleSnoozed = useCallback(() => {
    if (!serverId) {
      return;
    }
    setSnoozedShelfExpanded(serverId, !(uiState?.snoozedShelfExpanded ?? false));
  }, [serverId, setSnoozedShelfExpanded, uiState?.snoozedShelfExpanded]);

  const handleShowMoreSettled = useCallback(() => {
    if (!serverId) {
      return;
    }
    setSettledVisibleCount(
      serverId,
      (uiState?.settledVisibleCount ?? 10) + SETTLED_TAIL_PAGE_COUNT,
    );
  }, [serverId, setSettledVisibleCount, uiState?.settledVisibleCount]);

  const handleSelectAllProjects = useCallback(() => {
    if (!serverId) {
      return;
    }
    setScopeProjectKey(serverId, null);
  }, [serverId, setScopeProjectKey]);

  const handleSelectProjectScope = useCallback(
    (projectKey: string) => {
      if (!serverId) {
        return;
      }
      setScopeProjectKey(serverId, projectKey);
    },
    [serverId, setScopeProjectKey],
  );

  const handleOpenThread = useCallback(
    (thread: SidebarV2Thread) => {
      const agent = agentById.get(thread.id);
      if (!agent) {
        return;
      }
      rememberArchivedAgentDetail(agent);
      onAgentPress?.();
      navigateToAgent({
        serverId: agent.serverId,
        agentId: agent.id,
        pin: Boolean(agent.archivedAt),
      });
    },
    [agentById, onAgentPress],
  );

  const resolveAgent = useCallback(
    (thread: SidebarV2Thread) => agentById.get(thread.id) ?? null,
    [agentById],
  );

  const orderedThreadKeys = useMemo(
    () =>
      [...partition.activeThreads, ...partition.snoozedThreads, ...partition.settledThreads].map(
        (thread) => sidebarV2ThreadKey(thread.serverId, thread.id),
      ),
    [partition.activeThreads, partition.settledThreads, partition.snoozedThreads],
  );

  const threadByKey = useMemo(() => {
    const map = new Map<string, SidebarV2Thread>();
    for (const thread of threads) {
      map.set(sidebarV2ThreadKey(thread.serverId, thread.id), thread);
    }
    return map;
  }, [threads]);

  const selectedCount = selectedThreadKeys.length;
  const isMultiSelectMode = selectedCount > 0;
  const bulkDeleteButtonStyle = useMemo(() => [styles.bulkButton, styles.bulkButtonDanger], []);
  const bulkDeleteTextStyle = useMemo(
    () => [styles.bulkButtonText, styles.bulkButtonDangerText],
    [],
  );
  const addProjectButtonStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.scopeAddButton,
      (Boolean(hovered) || pressed) && styles.scopeAddButtonHovered,
    ],
    [],
  );

  const handleToggleSelect = useCallback(
    (thread: SidebarV2Thread) => {
      toggleThreadSelected(sidebarV2ThreadKey(thread.serverId, thread.id));
    },
    [toggleThreadSelected],
  );

  const handleRangeSelect = useCallback(
    (thread: SidebarV2Thread) => {
      rangeSelectThreads(sidebarV2ThreadKey(thread.serverId, thread.id), orderedThreadKeys);
    },
    [orderedThreadKeys, rangeSelectThreads],
  );

  const handleBulkSettle = useCallback(() => {
    for (const thread of resolveSelectedThreads(selectedThreadKeys, threadByKey)) {
      const agent = agentById.get(thread.id);
      if (agent) {
        onSettle(agent);
      }
    }
    clearSelection();
  }, [agentById, clearSelection, onSettle, selectedThreadKeys, threadByKey]);

  const handleBulkSnoozeHour = useCallback(() => {
    const presets = resolveSnoozePresets(new Date());
    const hourPreset = presets.find((preset) => preset.id === "hour") ?? presets[0];
    if (!hourPreset) {
      return;
    }
    for (const thread of resolveSelectedThreads(selectedThreadKeys, threadByKey)) {
      const agent = agentById.get(thread.id);
      if (agent) {
        onSnooze(agent, hourPreset.snoozedUntil);
      }
    }
    clearSelection();
  }, [agentById, clearSelection, onSnooze, selectedThreadKeys, threadByKey]);

  const handleBulkMarkUnread = useCallback(() => {
    for (const thread of resolveSelectedThreads(selectedThreadKeys, threadByKey)) {
      const agent = agentById.get(thread.id);
      if (agent) {
        onMarkUnread(agent);
      }
    }
    clearSelection();
  }, [agentById, clearSelection, onMarkUnread, selectedThreadKeys, threadByKey]);

  const handleBulkDelete = useCallback(() => {
    for (const thread of resolveSelectedThreads(selectedThreadKeys, threadByKey)) {
      const agent = agentById.get(thread.id);
      if (agent) {
        onDelete(agent);
      }
    }
    clearSelection();
  }, [agentById, clearSelection, onDelete, selectedThreadKeys, threadByKey]);

  const scopeLabel = useMemo(() => {
    if (!uiState?.scopeProjectKey) {
      return t("sidebarV2.allProjects");
    }
    return (
      projectOptions.find((project) => project.projectKey === uiState.scopeProjectKey)
        ?.displayName ?? t("sidebarV2.allProjects")
    );
  }, [projectOptions, t, uiState?.scopeProjectKey]);

  // T3 SidebarV2: active shelf has no "Sessions" header — only Snoozed/Settled
  // render collapsible shelf labels.
  const showScopeRow = projectOptions.length > 0 || Boolean(onAddProject);

  if (!serverId) {
    return (
      <View style={styles.emptyContainer} testID="sidebar-status-view">
        <Text style={styles.emptyTitle}>{t("sidebar.noHost")}</Text>
      </View>
    );
  }

  if (isSearching) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        testID="sidebar-status-view"
      >
        {searchResults.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>{t("sidebarV2.noSearchResults")}</Text>
          </View>
        ) : (
          searchResults.map((thread) => {
            const agent = resolveAgent(thread);
            if (!agent) {
              return null;
            }
            const threadKey = sidebarV2ThreadKey(thread.serverId, thread.id);
            return (
              <StatusSlimRow
                key={thread.id}
                thread={thread}
                agent={agent}
                isActive={normalizedSelectedAgentId === thread.id}
                isSelected={selectedThreadKeys.includes(threadKey)}
                isMultiSelectMode={isMultiSelectMode}
                nowIso={nowIso}
                variant="search"
                onOpen={handleOpenThread}
                onToggleSelect={handleToggleSelect}
                onRangeSelect={handleRangeSelect}
                onWake={onWake}
                onUnsettle={onUnsettle}
                onSnooze={onSnooze}
                onSettle={onSettle}
                onRegenerateTitle={onRegenerateTitle}
                onMarkUnread={onMarkUnread}
                onDelete={onDelete}
                onRename={onRename}
              />
            );
          })
        )}
      </ScrollView>
    );
  }

  const hasAnyThread =
    partition.activeThreads.length > 0 ||
    partition.snoozedThreads.length > 0 ||
    partition.settledThreads.length > 0;

  if (!hasAnyThread) {
    const emptyTitle = uiState?.scopeProjectKey
      ? t("sidebarV2.noThreadsInScope")
      : t("sidebarV2.noThreadsYet");
    return (
      <View style={styles.emptyContainer} testID="sidebar-status-view">
        <Text style={styles.emptyTitle}>{emptyTitle}</Text>
        {onAddProject && !uiState?.scopeProjectKey ? (
          <Button variant="ghost" size="sm" onPress={onAddProject}>
            {t("sidebarV2.addProject")}
          </Button>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.container} testID="sidebar-status-view">
      {selectedCount > 0 ? (
        <View style={styles.bulkBar} testID="sidebar-status-bulk-bar">
          <Text style={styles.bulkCount}>{selectedCount}</Text>
          <Pressable
            style={styles.bulkButton}
            onPress={handleBulkSettle}
            testID="sidebar-status-bulk-settle"
          >
            <Text style={styles.bulkButtonText}>
              {t("sidebarV2.bulkSettle", { count: selectedCount })}
            </Text>
          </Pressable>
          <Pressable
            style={styles.bulkButton}
            onPress={handleBulkSnoozeHour}
            testID="sidebar-status-bulk-snooze"
          >
            <Text style={styles.bulkButtonText}>
              {t("sidebarV2.bulkSnooze", { count: selectedCount })}
            </Text>
          </Pressable>
          <Pressable
            style={styles.bulkButton}
            onPress={handleBulkMarkUnread}
            testID="sidebar-status-bulk-mark-unread"
          >
            <Text style={styles.bulkButtonText}>
              {t("sidebarV2.bulkMarkUnread", { count: selectedCount })}
            </Text>
          </Pressable>
          <Pressable
            style={bulkDeleteButtonStyle}
            onPress={handleBulkDelete}
            testID="sidebar-status-bulk-delete"
          >
            <Text style={bulkDeleteTextStyle}>
              {t("sidebarV2.bulkDelete", { count: selectedCount })}
            </Text>
          </Pressable>
          <Pressable
            style={styles.bulkButtonGhost}
            onPress={clearSelection}
            testID="sidebar-status-bulk-clear"
          >
            <Text style={styles.bulkButtonGhostText}>{t("common.cancel")}</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        style={styles.scrollFlex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {showScopeRow ? (
          <View style={styles.scopeRow} testID="sidebar-status-scope-row">
            {projectOptions.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  accessibilityLabel={t("sidebarV2.allProjects")}
                  style={scopeTriggerStyle}
                  testID="sidebar-status-scope-trigger"
                >
                  <ThemedIconHost
                    Icon={Folder}
                    size={ICON_SIZE.sm}
                    uniProps={foregroundMutedColorMapping}
                  />
                  <Text style={styles.scopeLabel} numberOfLines={1}>
                    {scopeLabel}
                  </Text>
                  <ThemedIconHost
                    Icon={ChevronDown}
                    size={ICON_SIZE.xs}
                    uniProps={foregroundMutedColorMapping}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" width={240}>
                  <DropdownMenuItem
                    selected={!uiState?.scopeProjectKey}
                    onSelect={handleSelectAllProjects}
                    showSelectedCheck
                    testID="sidebar-status-scope-all"
                  >
                    {t("sidebarV2.allProjects")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {projectOptions.map((project) => (
                    <ProjectScopeMenuItem
                      key={project.projectKey}
                      projectKey={project.projectKey}
                      displayName={project.displayName}
                      selected={uiState?.scopeProjectKey === project.projectKey}
                      onSelect={handleSelectProjectScope}
                    />
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <View style={styles.scopeTriggerStatic} testID="sidebar-status-scope-trigger">
                <ThemedIconHost
                  Icon={Folder}
                  size={ICON_SIZE.sm}
                  uniProps={foregroundMutedColorMapping}
                />
                <Text style={styles.scopeLabel} numberOfLines={1}>
                  {scopeLabel}
                </Text>
              </View>
            )}
            {onAddProject ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("sidebarV2.newProject")}
                onPress={onAddProject}
                style={addProjectButtonStyle}
                testID="sidebar-status-new-project"
              >
                <ThemedIconHost
                  Icon={FolderPlus}
                  size={ICON_SIZE.sm}
                  uniProps={foregroundMutedColorMapping}
                />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {partition.activeThreads.map((thread) => {
          const agent = resolveAgent(thread);
          if (!agent) {
            return null;
          }
          const threadKey = sidebarV2ThreadKey(thread.serverId, thread.id);
          const isUnread = Boolean(localUnreadCompletedAtByKey[threadKey]);
          return (
            <StatusCardRow
              key={thread.id}
              thread={thread}
              agent={agent}
              isActive={normalizedSelectedAgentId === thread.id}
              isSelected={selectedThreadKeys.includes(threadKey)}
              isMultiSelectMode={isMultiSelectMode}
              isUnread={isUnread}
              nowIso={nowIso}
              onOpen={handleOpenThread}
              onToggleSelect={handleToggleSelect}
              onRangeSelect={handleRangeSelect}
              onWake={onWake}
              onUnsettle={onUnsettle}
              onSnooze={onSnooze}
              onSettle={onSettle}
              onRegenerateTitle={onRegenerateTitle}
              onMarkUnread={onMarkUnread}
              onDelete={onDelete}
              onRename={onRename}
            />
          );
        })}

        {partition.snoozedThreads.length > 0 ? (
          <>
            <ShelfHeader
              label={t("sidebarV2.snoozed")}
              count={partition.snoozedThreads.length}
              expanded={uiState?.snoozedShelfExpanded ?? false}
              onToggle={handleToggleSnoozed}
              tone="snoozed"
            />
            {visibleSnoozed.map((thread) => {
              const agent = resolveAgent(thread);
              if (!agent) {
                return null;
              }
              const threadKey = sidebarV2ThreadKey(thread.serverId, thread.id);
              return (
                <StatusSlimRow
                  key={thread.id}
                  thread={thread}
                  agent={agent}
                  isActive={normalizedSelectedAgentId === thread.id}
                  isSelected={selectedThreadKeys.includes(threadKey)}
                  isMultiSelectMode={isMultiSelectMode}
                  nowIso={nowIso}
                  variant="snoozed"
                  onOpen={handleOpenThread}
                  onToggleSelect={handleToggleSelect}
                  onRangeSelect={handleRangeSelect}
                  onWake={onWake}
                  onUnsettle={onUnsettle}
                  onSnooze={onSnooze}
                  onSettle={onSettle}
                  onRegenerateTitle={onRegenerateTitle}
                  onMarkUnread={onMarkUnread}
                  onDelete={onDelete}
                  onRename={onRename}
                />
              );
            })}
          </>
        ) : null}

        {partition.settledThreads.length > 0 || settledPaging.hiddenSettledCount > 0 ? (
          <>
            <ShelfHeader
              label={t("sidebarV2.settled")}
              count={partition.settledThreads.length}
              expanded={uiState?.settledShelfExpanded ?? true}
              onToggle={handleToggleSettled}
            />
            {settledPaging.visibleSettledThreads.map((thread) => {
              const agent = resolveAgent(thread);
              if (!agent) {
                return null;
              }
              const threadKey = sidebarV2ThreadKey(thread.serverId, thread.id);
              return (
                <StatusSlimRow
                  key={thread.id}
                  thread={thread}
                  agent={agent}
                  isActive={normalizedSelectedAgentId === thread.id}
                  isSelected={selectedThreadKeys.includes(threadKey)}
                  isMultiSelectMode={isMultiSelectMode}
                  nowIso={nowIso}
                  variant="settled"
                  onOpen={handleOpenThread}
                  onToggleSelect={handleToggleSelect}
                  onRangeSelect={handleRangeSelect}
                  onWake={onWake}
                  onUnsettle={onUnsettle}
                  onSnooze={onSnooze}
                  onSettle={onSettle}
                  onRegenerateTitle={onRegenerateTitle}
                  onMarkUnread={onMarkUnread}
                  onDelete={onDelete}
                  onRename={onRename}
                />
              );
            })}
            {settledPaging.hiddenSettledCount > 0 ? (
              <Pressable style={styles.showMore} onPress={handleShowMoreSettled}>
                <ThemedIconHost
                  Icon={Plus}
                  size={ICON_SIZE.xs}
                  uniProps={foregroundMutedColorMapping}
                />
                <Text style={styles.showMoreLabel}>
                  {t("sidebarV2.showMore", {
                    count: Math.min(settledPaging.hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT),
                  })}
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ProjectScopeMenuItem({
  projectKey,
  displayName,
  selected,
  onSelect,
}: {
  projectKey: string;
  displayName: string;
  selected: boolean;
  onSelect: (projectKey: string) => void;
}) {
  const handleSelect = useCallback(() => onSelect(projectKey), [onSelect, projectKey]);
  return (
    <DropdownMenuItem
      selected={selected}
      onSelect={handleSelect}
      showSelectedCheck
      testID={`sidebar-status-scope-${projectKey}`}
    >
      {displayName}
    </DropdownMenuItem>
  );
}

/**
 * T3 shelf header for Snoozed / Settled only.
 * Active threads render without a header (matches T3 SidebarV2).
 */
function ShelfHeader({
  label,
  count,
  expanded,
  onToggle,
  tone,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  tone?: "snoozed" | "settled";
}) {
  const labelStyle = useMemo(
    () => [styles.shelfHeaderLabel, tone === "snoozed" ? styles.shelfHeaderSnoozed : null],
    [tone],
  );
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);

  return (
    <Pressable
      style={styles.shelfHeader}
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      testID={`sidebar-status-shelf-${label}`}
    >
      <Text style={labelStyle}>{expanded || count === 0 ? label : `${label} (${count})`}</Text>
      <View style={styles.shelfHeaderDivider} />
      <ThemedIconHost
        Icon={expanded ? ChevronDown : ChevronRight}
        size={ICON_SIZE.xs}
        uniProps={tone === "snoozed" ? statusWarningColorMapping : foregroundMutedColorMapping}
      />
    </Pressable>
  );
}

function StatusCardRow({
  thread,
  agent,
  isActive,
  isSelected,
  isMultiSelectMode,
  isUnread,
  nowIso,
  onOpen,
  onToggleSelect,
  onRangeSelect,
  onWake,
  onUnsettle,
  onSnooze,
  onSettle,
  onRegenerateTitle,
  onMarkUnread,
  onDelete,
  onRename,
}: {
  thread: SidebarV2Thread;
  agent: AggregatedAgent;
  isActive: boolean;
  isSelected: boolean;
  isMultiSelectMode: boolean;
  isUnread: boolean;
  nowIso: string;
  onOpen: (thread: SidebarV2Thread) => void;
  onToggleSelect: (thread: SidebarV2Thread) => void;
  onRangeSelect: (thread: SidebarV2Thread) => void;
  onWake: (agent: AggregatedAgent) => void;
  onUnsettle: (agent: AggregatedAgent) => void;
  onSnooze: (agent: AggregatedAgent, untilIso: string) => void;
  onSettle: (agent: AggregatedAgent) => void;
  onRegenerateTitle: (agent: AggregatedAgent) => void;
  onMarkUnread: (agent: AggregatedAgent) => void;
  onDelete: (agent: AggregatedAgent) => void;
  onRename: (agent: AggregatedAgent) => void;
}) {
  const isWoke = Boolean(threadWokeAt(thread, { now: nowIso }));
  const status = resolveSidebarV2Status(thread);
  const topStatus = resolveSidebarV2TopStatus({
    status,
    workingStartedAt: thread.lastActivityAt,
    woke: isWoke,
    unseenCompletion: isUnread,
  });
  // Keep recede based on lifecycle only — do NOT restore full opacity when the
  // row becomes active/selected. Opacity jumps make glyphs re-rasterize wider.
  const shouldRecede = shouldSidebarRowRecede({
    status,
    isUnread,
    isWoke,
    isActive: false,
    isSelected: false,
  });
  const timeLabel = formatRelativeTimeLabel(thread.lastActivityAt, new Date(nowIso));
  const canSettleThread = canSettle(thread, { now: nowIso });
  const canSnoozeThread = canSnooze(thread, { now: nowIso });
  const snoozePresets = useMemo(() => resolveSnoozePresets(new Date(nowIso)), [nowIso]);

  // No inline hover actions on status cards. T3's hover-revealed Settle/Snooze
  // replaced the status/time label on hover, which made the row content jump
  // horizontally on every pointer move — removed per product decision. Settle
  // and Snooze stay in the right-click menu only; hover must never change the
  // row's content or layout, only (optionally) its background.
  let statusNode: React.ReactNode = null;
  if (topStatus) {
    statusNode = <Text style={statusTextStyle(topStatus.color)}>{topStatus.label}</Text>;
  } else if (timeLabel) {
    statusNode = <Text style={styles.cardTime}>{timeLabel}</Text>;
  }

  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.card,
      isActive && styles.cardActive,
      isSelected && styles.cardMultiSelected,
      // Active/selected fill is stable chrome — do not recolor or dim on hover.
      !(isActive || isSelected) && Boolean(hovered) && styles.cardHovered,
      shouldRecede && styles.cardReceded,
      !(isActive || isSelected) && pressed && styles.cardPressed,
    ],
    [isActive, isSelected, shouldRecede],
  );

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      const mods = extractModifierKeys(event);
      if (mods.shiftKey) {
        onRangeSelect(thread);
        return;
      }
      if (mods.metaKey || mods.ctrlKey || isMultiSelectMode) {
        onToggleSelect(thread);
        return;
      }
      onOpen(thread);
    },
    [isMultiSelectMode, onOpen, onRangeSelect, onToggleSelect, thread],
  );
  const accessibilityLabel = thread.projectName
    ? `${thread.projectName}: ${thread.title}`
    : thread.title;
  const ProviderIcon = getProviderIcon(agent.provider);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        style={rowStyle}
        onPress={handlePress}
        testID={`sidebar-v2-thread-${thread.id}`}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        aria-selected={isActive || isSelected}
      >
        <View style={styles.cardLine1}>
          <View style={styles.cardProject}>
            <ThemedIconHost
              Icon={Folder}
              size={ICON_SIZE.xs}
              uniProps={foregroundMutedColorMapping}
            />
            <Text style={styles.cardProjectName} numberOfLines={1}>
              {shortProjectName(thread.projectName ?? "Local")}
            </Text>
          </View>
          {statusNode}
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {thread.title}
        </Text>
        <View style={styles.cardLine3}>
          {thread.branch ? (
            <Text style={styles.cardBranchText} numberOfLines={1}>
              {thread.branch}
            </Text>
          ) : (
            <View style={styles.cardBranchSpacer} />
          )}
          <View style={styles.cardProviderIcon}>
            <ThemedIconHost
              Icon={ProviderIcon}
              size={ICON_SIZE.sm}
              uniProps={foregroundMutedColorMapping}
            />
          </View>
        </View>
      </ContextMenuTrigger>
      <StatusRowMenu
        agent={agent}
        canSettleThread={canSettleThread}
        canSnoozeThread={canSnoozeThread}
        isSnoozed={false}
        isSettled={false}
        snoozePresets={snoozePresets}
        onWake={onWake}
        onUnsettle={onUnsettle}
        onSnooze={onSnooze}
        onSettle={onSettle}
        onRegenerateTitle={onRegenerateTitle}
        onMarkUnread={onMarkUnread}
        onDelete={onDelete}
        onRename={onRename}
      />
    </ContextMenu>
  );
}

function StatusSlimRow({
  thread,
  agent,
  isActive,
  isSelected,
  isMultiSelectMode,
  nowIso,
  variant,
  onOpen,
  onToggleSelect,
  onRangeSelect,
  onWake,
  onUnsettle,
  onSnooze,
  onSettle,
  onRegenerateTitle,
  onMarkUnread,
  onDelete,
  onRename,
}: {
  thread: SidebarV2Thread;
  agent: AggregatedAgent;
  isActive: boolean;
  isSelected: boolean;
  isMultiSelectMode: boolean;
  nowIso: string;
  variant: "snoozed" | "settled" | "search";
  onOpen: (thread: SidebarV2Thread) => void;
  onToggleSelect: (thread: SidebarV2Thread) => void;
  onRangeSelect: (thread: SidebarV2Thread) => void;
  onWake: (agent: AggregatedAgent) => void;
  onUnsettle: (agent: AggregatedAgent) => void;
  onSnooze: (agent: AggregatedAgent, untilIso: string) => void;
  onSettle: (agent: AggregatedAgent) => void;
  onRegenerateTitle: (agent: AggregatedAgent) => void;
  onMarkUnread: (agent: AggregatedAgent) => void;
  onDelete: (agent: AggregatedAgent) => void;
  onRename: (agent: AggregatedAgent) => void;
}) {
  const wakeLabel =
    variant === "snoozed" && thread.snoozedUntil
      ? snoozeWakeLabel(thread.snoozedUntil, { now: nowIso })
      : null;
  const timeLabel = formatRelativeTimeLabel(
    thread.settledAt ?? thread.lastActivityAt,
    new Date(nowIso),
  );
  const canSettleThread = canSettle(thread, { now: nowIso });
  const canSnoozeThread = canSnooze(thread, { now: nowIso });
  const snoozePresets = useMemo(() => resolveSnoozePresets(new Date(nowIso)), [nowIso]);

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      const mods = extractModifierKeys(event);
      if (mods.shiftKey) {
        onRangeSelect(thread);
        return;
      }
      if (mods.metaKey || mods.ctrlKey || isMultiSelectMode) {
        onToggleSelect(thread);
        return;
      }
      onOpen(thread);
    },
    [isMultiSelectMode, onOpen, onRangeSelect, onToggleSelect, thread],
  );
  const handleWake = useCallback(() => onWake(agent), [agent, onWake]);
  const handleUnsettle = useCallback(() => onUnsettle(agent), [agent, onUnsettle]);
  const ProviderIcon = getProviderIcon(agent.provider);

  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.slimRow,
      isActive && styles.cardActive,
      isSelected && styles.cardMultiSelected,
      // Active/selected fill is stable chrome — do not recolor or dim on hover.
      !(isActive || isSelected) && Boolean(hovered) && styles.cardHovered,
      // Keep settled dimming even when selected/active so text width does not jump.
      variant === "settled" && styles.cardReceded,
      !(isActive || isSelected) && pressed && styles.cardPressed,
    ],
    [isActive, isSelected, variant],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger
        style={rowStyle}
        onPress={handlePress}
        testID={`sidebar-v2-thread-${thread.id}`}
        accessibilityRole="button"
        accessibilityLabel={thread.title}
        aria-selected={isActive || isSelected}
      >
        {variant === "settled" || variant === "search" ? (
          <View style={styles.slimProviderIcon}>
            <ThemedIconHost
              Icon={ProviderIcon}
              size={ICON_SIZE.sm}
              uniProps={foregroundMutedColorMapping}
            />
          </View>
        ) : null}
        {variant === "snoozed" ? (
          <ThemedIconHost
            Icon={AlarmClock}
            size={ICON_SIZE.xs}
            uniProps={statusWarningColorMapping}
          />
        ) : null}
        <Text style={styles.slimTitle} numberOfLines={1}>
          {thread.title}
        </Text>
        {wakeLabel ? <Text style={styles.slimWake}>{wakeLabel}</Text> : null}
        {!wakeLabel && timeLabel ? <Text style={styles.slimTime}>{timeLabel}</Text> : null}
        {variant === "snoozed" ? (
          <Pressable
            style={styles.slimAction}
            onPress={handleWake}
            hitSlop={8}
            testID={`sidebar-status-wake-${thread.id}`}
          >
            <ThemedIconHost
              Icon={Check}
              size={ICON_SIZE.sm}
              uniProps={foregroundMutedColorMapping}
            />
          </Pressable>
        ) : null}
        {variant === "settled" ? (
          <Pressable
            style={styles.slimAction}
            onPress={handleUnsettle}
            hitSlop={8}
            testID={`sidebar-status-unsettle-${thread.id}`}
          >
            <ThemedIconHost
              Icon={Undo2}
              size={ICON_SIZE.sm}
              uniProps={foregroundMutedColorMapping}
            />
          </Pressable>
        ) : null}
      </ContextMenuTrigger>
      <StatusRowMenu
        agent={agent}
        canSettleThread={canSettleThread}
        canSnoozeThread={canSnoozeThread}
        isSnoozed={variant === "snoozed"}
        isSettled={variant === "settled"}
        snoozePresets={snoozePresets}
        onWake={onWake}
        onUnsettle={onUnsettle}
        onSnooze={onSnooze}
        onSettle={onSettle}
        onRegenerateTitle={onRegenerateTitle}
        onMarkUnread={onMarkUnread}
        onDelete={onDelete}
        onRename={onRename}
      />
    </ContextMenu>
  );
}

function StatusRowMenu({
  agent,
  canSettleThread,
  canSnoozeThread,
  isSnoozed,
  isSettled,
  snoozePresets,
  onWake,
  onUnsettle,
  onSnooze,
  onSettle,
  onRegenerateTitle,
  onMarkUnread,
  onDelete,
  onRename,
}: {
  agent: AggregatedAgent;
  canSettleThread: boolean;
  canSnoozeThread: boolean;
  isSnoozed: boolean;
  isSettled: boolean;
  snoozePresets: ReadonlyArray<SnoozePreset>;
  onWake: (agent: AggregatedAgent) => void;
  onUnsettle: (agent: AggregatedAgent) => void;
  onSnooze: (agent: AggregatedAgent, untilIso: string) => void;
  onSettle: (agent: AggregatedAgent) => void;
  onRegenerateTitle: (agent: AggregatedAgent) => void;
  onMarkUnread: (agent: AggregatedAgent) => void;
  onDelete: (agent: AggregatedAgent) => void;
  onRename: (agent: AggregatedAgent) => void;
}) {
  const { t } = useTranslation();
  const handleUnsettle = useCallback(() => onUnsettle(agent), [agent, onUnsettle]);
  const handleSettle = useCallback(() => onSettle(agent), [agent, onSettle]);
  const handleWake = useCallback(() => onWake(agent), [agent, onWake]);
  const handleRename = useCallback(() => onRename(agent), [agent, onRename]);
  const handleRegenerateTitle = useCallback(
    () => onRegenerateTitle(agent),
    [agent, onRegenerateTitle],
  );
  const handleMarkUnread = useCallback(() => onMarkUnread(agent), [agent, onMarkUnread]);
  const handleDelete = useCallback(() => onDelete(agent), [agent, onDelete]);

  return (
    <ContextMenuContent mobileMode="sheet" minWidth={220}>
      {isSettled ? (
        <ContextMenuItem onSelect={handleUnsettle}>{t("sidebarV2.unsettle")}</ContextMenuItem>
      ) : (
        <ContextMenuItem onSelect={handleSettle} disabled={!canSettleThread}>
          {t("sidebarV2.settle")}
        </ContextMenuItem>
      )}
      {isSnoozed ? (
        <ContextMenuItem onSelect={handleWake}>{t("sidebarV2.wake")}</ContextMenuItem>
      ) : (
        <>
          <ContextMenuLabel>{t("sidebarV2.snooze")}</ContextMenuLabel>
          {snoozePresets.map((preset) => (
            <SnoozePresetMenuItem
              key={preset.id}
              agent={agent}
              preset={preset}
              disabled={!canSnoozeThread}
              onSnooze={onSnooze}
            />
          ))}
        </>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={handleRename}>{t("sidebarV2.rename")}</ContextMenuItem>
      <ContextMenuItem onSelect={handleRegenerateTitle}>
        {t("sidebarV2.regenerateTitle")}
      </ContextMenuItem>
      <ContextMenuItem onSelect={handleMarkUnread}>{t("sidebarV2.markUnread")}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={handleDelete} destructive>
        {t("sidebarV2.delete")}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function SnoozePresetMenuItem({
  agent,
  preset,
  disabled,
  onSnooze,
}: {
  agent: AggregatedAgent;
  preset: SnoozePreset;
  disabled: boolean;
  onSnooze: (agent: AggregatedAgent, untilIso: string) => void;
}) {
  const handleSelect = useCallback(
    () => onSnooze(agent, preset.snoozedUntil),
    [agent, onSnooze, preset.snoozedUntil],
  );
  return (
    <ContextMenuItem onSelect={handleSelect} disabled={disabled}>
      {preset.label}
    </ContextMenuItem>
  );
}

function statusTextStyle(color: "sky" | "amber" | "indigo" | "red" | "emerald") {
  switch (color) {
    case "sky":
      return styles.statusSky;
    case "amber":
      return styles.statusAmber;
    case "indigo":
      return styles.statusIndigo;
    case "red":
      return styles.statusRed;
    case "emerald":
      return styles.statusEmerald;
  }
}

const scopeTriggerStyle = ({
  hovered = false,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }): StyleProp<ViewStyle> => [
  styles.scopeTrigger,
  (Boolean(hovered) || pressed) && styles.scopeTriggerHovered,
];

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  scrollFlex: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 4,
    paddingRight: 8,
    paddingBottom: 10,
    paddingLeft: 8,
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
  bulkBar: {
    marginHorizontal: 8,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    ...(isWeb
      ? ({
          boxShadow: "inset 0 0 0 1px rgba(20, 23, 31, 0.04)",
        } as object)
      : {}),
  },
  bulkCount: {
    fontSize: 12,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    minWidth: 18,
  },
  bulkButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: theme.colors.surface3,
  },
  bulkButtonText: {
    fontSize: 11.5,
    color: theme.colors.foreground,
  },
  bulkButtonDanger: {
    backgroundColor: theme.colors.surface3,
  },
  bulkButtonDangerText: {
    color: theme.colors.destructive,
  },
  bulkButtonGhost: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "transparent",
  },
  bulkButtonGhostText: {
    fontSize: 11.5,
    color: theme.colors.foregroundMuted,
  },
  // T3: "All projects" dropdown + FolderPlus on one row.
  scopeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 6,
    minHeight: 34,
  },
  scopeTrigger: {
    flex: 1,
    minWidth: 0,
    minHeight: 34,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  scopeTriggerStatic: {
    flex: 1,
    minWidth: 0,
    minHeight: 34,
    paddingHorizontal: 8,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  scopeTriggerHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  scopeLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  scopeAddButton: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  scopeAddButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  shelfHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    // T3: mb-1 mt-3 px-2.5
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 0,
  },
  shelfHeaderLabel: {
    // T3: text-xs font-medium muted → calibrated to by-project .cc-group 12.5.
    fontSize: 12.5,
    fontWeight: theme.fontWeight.medium,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
    color: theme.colors.foregroundMuted,
  },
  shelfHeaderSnoozed: {
    // T3: text-blue-600
    color: theme.colors.accent,
  },
  shelfHeaderDivider: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  card: {
    // T3 card density: h ~ 4.875rem, px/py content inset, no permanent fill.
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 78,
    borderRadius: 8,
    justifyContent: "center",
    gap: 4,
    position: "relative",
  },
  cardActive: {
    // Fill only. Avoid boxShadow on selection — it re-composites nearby text.
    backgroundColor: theme.colors.surface0,
  },
  cardMultiSelected: {
    backgroundColor: theme.colors.surface3,
  },
  cardHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  cardReceded: {
    opacity: 0.72,
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardLine1: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 18,
  },
  cardProject: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cardProjectName: {
    flex: 1,
    // T3: text-xs muted → calibrated to by-project workspace group title 12.5.
    fontSize: 12.5,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  cardTime: {
    // T3: text-xs muted time/status slot
    fontSize: 12,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
    color: theme.colors.foregroundMuted,
    marginLeft: 8,
  },
  cardTitle: {
    // T3: text-sm medium → calibrated per roadmap: 13 medium card title.
    fontSize: 13,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 18,
    color: theme.colors.foreground,
    paddingRight: 4,
  },
  cardLine3: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 18,
    gap: 6,
  },
  cardBranchSpacer: {
    flex: 1,
  },
  cardBranchText: {
    flex: 1,
    minWidth: 0,
    // T3: branch plain text, no leading git icon
    fontSize: 12,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
    color: theme.colors.foregroundMuted,
  },
  // T3 trailing provider/agent icon (replaces hollow settle circle).
  cardProviderIcon: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    opacity: 0.7,
    pointerEvents: "none",
  },
  slimRow: {
    // T3 slim: h-9, gap-2.5, px-2.5
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  slimProviderIcon: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    opacity: 0.55,
  },
  slimTitle: {
    flex: 1,
    // T3: text-sm → calibrated to by-project row title 12.5.
    fontSize: 12.5,
    lineHeight: 18,
    color: theme.colors.foreground,
  },
  slimWake: {
    fontSize: 12,
    color: theme.colors.statusWarning,
  },
  slimTime: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
  },
  slimAction: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  showMore: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[0.5],
    // T3: h-9 text-sm muted
    minHeight: 36,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.sm,
  },
  showMoreLabel: {
    fontSize: 13,
    color: theme.colors.foregroundMuted,
  },
  statusSky: {
    fontSize: 12,
    fontWeight: theme.fontWeight.medium,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
    marginLeft: 8,
    color: theme.colors.accentBright,
  },
  statusAmber: {
    fontSize: 12,
    fontWeight: theme.fontWeight.medium,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
    marginLeft: 8,
    color: theme.colors.statusWarning,
  },
  statusIndigo: {
    fontSize: 12,
    fontWeight: theme.fontWeight.medium,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
    marginLeft: 8,
    color: theme.colors.accent,
  },
  statusRed: {
    fontSize: 12,
    fontWeight: theme.fontWeight.medium,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
    marginLeft: 8,
    color: theme.colors.destructive,
  },
  statusEmerald: {
    fontSize: 12,
    fontWeight: theme.fontWeight.medium,
    lineHeight: WORKBENCH_META_LINE_HEIGHT,
    marginLeft: 8,
    color: theme.colors.success,
  },
}));
