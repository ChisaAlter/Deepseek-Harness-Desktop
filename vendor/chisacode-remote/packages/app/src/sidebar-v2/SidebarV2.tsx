import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import * as Clipboard from "expo-clipboard";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus } from "lucide-react-native";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { ThemedIconHost } from "@/components/themed-icon-host";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  getSidebarAgentLabelCacheSnapshot,
  patchAgentLabelsInSidebarCaches,
  restoreSidebarAgentLabelCacheSnapshot,
} from "@/utils/sidebar-agent-label-cache";
import { SidebarV2Row } from "./SidebarV2Row";
import { SidebarV2Search, SidebarV2NewThreadButton } from "./SidebarV2Search";
import { SidebarV2ScopeMenu, SidebarV2ProjectSettingsDialog } from "./SidebarV2ScopeMenu";
import {
  partitionThreadsForSidebarV2,
  pageSettledThreads,
  SETTLED_TAIL_INITIAL_COUNT,
  SETTLED_TAIL_PAGE_COUNT,
} from "./shelves";
import {
  buildSidebarProjectSnapshots,
  sortProjectsForSidebar,
  type SidebarV2ProjectSnapshot,
} from "./projects";
import {
  agentToSidebarThread,
  findWorkspaceForAgent,
  buildWorkspaceDirectoryIndex,
  type SidebarV2Thread,
} from "./agent-adapter";
import { sidebarV2ThreadKey, useSidebarV2Store } from "./store";
import {
  canSettle,
  canSnooze,
  SIDEBAR_LABEL_SETTLED_AT,
  SIDEBAR_LABEL_SETTLED_OVERRIDE,
  threadWokeAt,
} from "./snooze";
import { hasUnseenCompletion } from "./logic";
import { buildOrderedThreadKeys, planForwardNavigationTarget } from "./actions";
import { useSidebarV2BulkActions } from "./use-sidebar-v2-bulk-actions";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import type { WorkspaceDescriptor } from "@/stores/session-store";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface SidebarV2Props {
  agents: AggregatedAgent[];
  serverId: string | null;
  selectedAgentId?: string;
  workspaces?: ReadonlyMap<string, WorkspaceDescriptor> | null;
  onNewConversation: () => void;
  onAddProject: () => void;
}

/** Auto-settle window in days; matches T3's default. */
const AUTO_SETTLE_AFTER_DAYS = 3;

function quantizeToMinute(date: Date): string {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  return copy.toISOString();
}

function resolveVisibleSnoozedThreads(input: {
  snoozedThreads: readonly SidebarV2Thread[];
  expanded: boolean;
  selectedAgentId?: string;
}): SidebarV2Thread[] {
  if (input.expanded) return [...input.snoozedThreads];
  if (!input.selectedAgentId) return [];
  const route = input.snoozedThreads.find((thread) => thread.id === input.selectedAgentId);
  return route ? [route] : [];
}

function buildThreadKeySet(threads: readonly SidebarV2Thread[]): Set<string> {
  return new Set(threads.map((thread) => sidebarV2ThreadKey(thread.serverId, thread.id)));
}

// eslint-disable-next-line complexity -- T3 parity surface: shelves + single/bulk actions
export function SidebarV2({
  agents,
  serverId,
  selectedAgentId,
  workspaces,
  onNewConversation,
  onAddProject,
}: SidebarV2Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [projectSettingsProject, setProjectSettingsProject] =
    useState<SidebarV2ProjectSnapshot | null>(null);
  const [nowMinute, setNowMinute] = useState(() => quantizeToMinute(new Date()));
  const [snoozeWakeTick, bumpSnoozeWakeTick] = useState(0);

  const uiState = useSidebarV2Store((state) =>
    serverId ? state.getServerUiState(serverId) : null,
  );
  const setSettledShelfExpanded = useSidebarV2Store((state) => state.setSettledShelfExpanded);
  const setSnoozedShelfExpanded = useSidebarV2Store((state) => state.setSnoozedShelfExpanded);
  const setSettledVisibleCount = useSidebarV2Store((state) => state.setSettledVisibleCount);
  const resetSettledVisibleCount = useSidebarV2Store((state) => state.resetSettledVisibleCount);
  const searchQuery = useSidebarV2Store((state) => state.searchQuery);
  const selectedThreadKeys = useSidebarV2Store((state) => state.selectedThreadKeys);
  const localUnreadCompletedAtByKey = useSidebarV2Store(
    (state) => state.localUnreadCompletedAtByKey,
  );
  const markThreadUnread = useSidebarV2Store((state) => state.markThreadUnread);
  const clearThreadUnread = useSidebarV2Store((state) => state.clearThreadUnread);
  const clearSelection = useSidebarV2Store((state) => state.clearSelection);
  const rangeSelectThreads = useSidebarV2Store((state) => state.rangeSelectThreads);
  const buildSettledLabels = useSidebarV2Store((state) => state.buildSettledLabels);
  const buildSnoozedLabels = useSidebarV2Store((state) => state.buildSnoozedLabels);
  const clearSnoozedLabels = useSidebarV2Store((state) => state.clearSnoozedLabels);

  const activeServerId = serverId;
  const now = nowMinute;
  const snoozeNow = useMemo(() => {
    void snoozeWakeTick;
    return new Date().toISOString();
  }, [snoozeWakeTick]);

  // The app passes the selected agent as `${serverId}:${agentId}` (same key
  // format the classic sidebar list compared), while the thread model here is
  // keyed by the bare agent id — normalize so route-driven selection lights
  // the matching row.
  const normalizedSelectedAgentId = useMemo(() => {
    if (!selectedAgentId || !activeServerId) {
      return selectedAgentId;
    }
    const prefix = `${activeServerId}:`;
    return selectedAgentId.startsWith(prefix)
      ? selectedAgentId.slice(prefix.length)
      : selectedAgentId;
  }, [activeServerId, selectedAgentId]);

  useEffect(() => {
    const timer = setInterval(() => setNowMinute(quantizeToMinute(new Date())), 15_000);
    return () => clearInterval(timer);
  }, []);

  const workspaceIndex = useMemo(
    () => (workspaces ? buildWorkspaceDirectoryIndex(workspaces.values()) : new Map()),
    [workspaces],
  );

  const threads = useMemo<SidebarV2Thread[]>(() => {
    if (!activeServerId) return [];
    return agents
      .filter((agent) => agent.serverId === activeServerId)
      .map((agent) => agentToSidebarThread(agent, findWorkspaceForAgent(agent, workspaceIndex)));
  }, [activeServerId, agents, workspaceIndex]);

  const projectMembers = useMemo(
    () =>
      Array.from(workspaces?.values() ?? []).map((workspace) => ({
        workspaceId: workspace.id,
        physicalProjectKey: workspace.projectId,
        projectName: workspace.projectDisplayName || workspace.projectId,
        workspaceDirectory: workspace.workspaceDirectory,
        branch: workspace.gitRuntime?.currentBranch ?? null,
        kind: workspace.workspaceKind,
        status: workspace.status ?? null,
        archivedAt: workspace.archivingAt ?? null,
        changeRequestState: resolvePrState(workspace),
      })),
    [workspaces],
  );

  const projectSnapshots = useMemo(
    () => buildSidebarProjectSnapshots({ members: projectMembers }),
    [projectMembers],
  );

  const threadsByProjectKey = useMemo(() => {
    const byKey = new Map<string, SidebarV2Thread[]>();
    for (const thread of threads) {
      const key = thread.projectKey ?? "";
      const existing = byKey.get(key) ?? [];
      existing.push(thread);
      byKey.set(key, existing);
    }
    return byKey;
  }, [threads]);

  const sortedProjects = useMemo(
    () =>
      sortProjectsForSidebar({
        projects: projectSnapshots,
        threadsByProjectKey,
        preferredProjectKeys: uiState?.scopeProjectKey ? [uiState.scopeProjectKey] : undefined,
      }),
    [projectSnapshots, threadsByProjectKey, uiState?.scopeProjectKey],
  );

  const scopedThreads = useMemo(() => {
    if (!uiState?.scopeProjectKey) return threads;
    return threads.filter((thread) => thread.projectKey === uiState.scopeProjectKey);
  }, [threads, uiState?.scopeProjectKey]);

  const changeRequestStateByKey = useMemo(() => {
    const map = new Map<string, "open" | "closed" | "merged" | null>();
    for (const thread of threads) map.set(thread.id, thread.changeRequestState);
    return map;
  }, [threads]);

  const partition = useMemo(
    () =>
      partitionThreadsForSidebarV2({
        threads: scopedThreads,
        now,
        snoozeNow,
        autoSettleAfterDays: AUTO_SETTLE_AFTER_DAYS,
        changeRequestStateByKey,
      }),
    [scopedThreads, now, snoozeNow, changeRequestStateByKey],
  );

  useEffect(() => {
    if (!partition.nextSnoozeWakeAt) return;
    const wakeMs = Date.parse(partition.nextSnoozeWakeAt);
    if (Number.isNaN(wakeMs)) return;
    const delay = Math.max(0, wakeMs - Date.now()) + 25;
    const timer = setTimeout(() => bumpSnoozeWakeTick((tick) => tick + 1), delay);
    return () => clearTimeout(timer);
  }, [partition.nextSnoozeWakeAt]);

  const settledPaging = useMemo(
    () =>
      pageSettledThreads({
        settledThreads: partition.settledThreads,
        settledVisibleCount: uiState?.settledVisibleCount ?? SETTLED_TAIL_INITIAL_COUNT,
        routeThreadKey: normalizedSelectedAgentId ?? null,
        settledShelfExpanded: uiState?.settledShelfExpanded ?? true,
      }),
    [
      partition.settledThreads,
      normalizedSelectedAgentId,
      uiState?.settledVisibleCount,
      uiState?.settledShelfExpanded,
    ],
  );

  const isSearching = searchQuery.length > 0;
  const isMultiSelectMode = selectedThreadKeys.length > 0;

  const visibleSnoozedThreads = useMemo(
    () =>
      resolveVisibleSnoozedThreads({
        snoozedThreads: partition.snoozedThreads,
        expanded: uiState?.snoozedShelfExpanded ?? false,
        selectedAgentId: normalizedSelectedAgentId,
      }),
    [partition.snoozedThreads, normalizedSelectedAgentId, uiState?.snoozedShelfExpanded],
  );

  const orderedVisibleThreads = useMemo(
    () => [
      ...partition.activeThreads,
      ...visibleSnoozedThreads,
      ...settledPaging.visibleSettledThreads,
    ],
    [partition.activeThreads, visibleSnoozedThreads, settledPaging.visibleSettledThreads],
  );
  const orderedThreadKeys = useMemo(
    () => buildOrderedThreadKeys(orderedVisibleThreads),
    [orderedVisibleThreads],
  );
  const orderedThreadKeysRef = useRef(orderedThreadKeys);
  orderedThreadKeysRef.current = orderedThreadKeys;

  const threadByKey = useMemo(() => {
    const map = new Map<string, SidebarV2Thread>();
    for (const thread of orderedVisibleThreads) {
      map.set(sidebarV2ThreadKey(thread.serverId, thread.id), thread);
    }
    return map;
  }, [orderedVisibleThreads]);

  const settledThreadKeys = useMemo(
    () => buildThreadKeySet(partition.settledThreads),
    [partition.settledThreads],
  );
  const snoozedThreadKeys = useMemo(
    () => buildThreadKeySet(partition.snoozedThreads),
    [partition.snoozedThreads],
  );
  const settledThreadKeysRef = useRef(settledThreadKeys);
  settledThreadKeysRef.current = settledThreadKeys;
  const snoozedThreadKeysRef = useRef(snoozedThreadKeys);
  snoozedThreadKeysRef.current = snoozedThreadKeys;

  const routeThreadKey =
    activeServerId && normalizedSelectedAgentId
      ? sidebarV2ThreadKey(activeServerId, normalizedSelectedAgentId)
      : null;
  const routeThreadKeyRef = useRef(routeThreadKey);
  routeThreadKeyRef.current = routeThreadKey;
  const threadByKeyRef = useRef(threadByKey);
  threadByKeyRef.current = threadByKey;

  const settlingThreadKeysRef = useRef(new Set<string>());
  const snoozingThreadKeysRef = useRef(new Set<string>());

  const getClient = useCallback(() => {
    if (!activeServerId) return null;
    return useSessionStore.getState().sessions[activeServerId]?.client ?? null;
  }, [activeServerId]);

  const patchAgentLabelsLocally = useCallback(
    (thread: SidebarV2Thread, labels: Record<string, string>) => {
      if (!activeServerId) return;
      useSessionStore.getState().setAgents(activeServerId, (prev) => {
        const existing = prev.get(thread.id);
        if (!existing) return prev;
        const next = new Map(prev);
        next.set(thread.id, { ...existing, labels: { ...existing.labels, ...labels } });
        return next;
      });
      // Keep React Query caches in parity with the session store so other
      // surfaces that read sidebarAgentsList / allAgents / agentHistory still
      // see the optimistic pin / snooze / settle labels.
      patchAgentLabelsInSidebarCaches(queryClient, {
        serverId: activeServerId,
        agentId: thread.id,
        labels,
      });
    },
    [activeServerId, queryClient],
  );

  const handleUpdateLabels = useCallback(
    async (thread: SidebarV2Thread, labels: Record<string, string>) => {
      const client = getClient();
      if (!client) {
        toast.error(t("workspace.screen.hostDisconnected"));
        return false;
      }
      const previousLabels: Record<string, string> = {};
      for (const key of Object.keys(labels)) previousLabels[key] = "";
      if (activeServerId) {
        const live = useSessionStore.getState().sessions[activeServerId]?.agents.get(thread.id);
        if (live?.labels) {
          for (const key of Object.keys(labels)) previousLabels[key] = live.labels[key] ?? "";
        }
      }
      const cacheSnapshot = activeServerId
        ? getSidebarAgentLabelCacheSnapshot(queryClient, activeServerId)
        : null;
      patchAgentLabelsLocally(thread, labels);
      try {
        await client.updateAgent(thread.id, { labels });
        return true;
      } catch (error) {
        patchAgentLabelsLocally(thread, previousLabels);
        if (activeServerId && cacheSnapshot) {
          restoreSidebarAgentLabelCacheSnapshot(queryClient, activeServerId, cacheSnapshot);
        }
        toast.error(error instanceof Error ? error.message : t("sidebarV2.actionFailed"));
        return false;
      }
    },
    [activeServerId, getClient, patchAgentLabelsLocally, queryClient, t, toast],
  );

  const navigateToThreadId = useCallback(
    (threadId: string) => {
      if (!activeServerId) return;
      navigateToAgent({ serverId: activeServerId, agentId: threadId });
    },
    [activeServerId],
  );

  const planForward = useCallback(
    (parkedThreadKey: string, coParkingKeys?: ReadonlySet<string>) => {
      const nextKey = planForwardNavigationTarget({
        routeThreadKey: routeThreadKeyRef.current,
        parkedThreadKey,
        orderedThreadKeys: orderedThreadKeysRef.current,
        settledThreadKeys: settledThreadKeysRef.current,
        snoozedThreadKeys: snoozedThreadKeysRef.current,
        coParkingKeys,
      });
      if (!nextKey) return () => onNewConversation();
      const nextThread = threadByKeyRef.current.get(nextKey);
      if (!nextThread) return () => onNewConversation();
      return () => navigateToThreadId(nextThread.id);
    },
    [navigateToThreadId, onNewConversation],
  );

  const handleOpenThread = useCallback(
    (thread: SidebarV2Thread) => {
      if (!activeServerId) return;
      if (selectedThreadKeys.length > 0) clearSelection();
      clearThreadUnread(sidebarV2ThreadKey(thread.serverId, thread.id));
      navigateToAgent({ serverId: activeServerId, agentId: thread.id });
    },
    [activeServerId, clearSelection, clearThreadUnread, selectedThreadKeys.length],
  );

  const handleUnsettle = useCallback(
    (thread: SidebarV2Thread) => {
      void handleUpdateLabels(thread, {
        [SIDEBAR_LABEL_SETTLED_AT]: "",
        [SIDEBAR_LABEL_SETTLED_OVERRIDE]: "active",
      });
    },
    [handleUpdateLabels],
  );

  const handleUnsnooze = useCallback(
    (thread: SidebarV2Thread) => {
      void handleUpdateLabels(thread, clearSnoozedLabels());
    },
    [clearSnoozedLabels, handleUpdateLabels],
  );

  const handleSettle = useCallback(
    (thread: SidebarV2Thread, opts?: { coParkingKeys?: ReadonlySet<string> }) => {
      if (!canSettle(thread, { now: snoozeNow })) return;
      const threadKey = sidebarV2ThreadKey(thread.serverId, thread.id);
      if (settlingThreadKeysRef.current.has(threadKey)) return;
      settlingThreadKeysRef.current.add(threadKey);
      const navigateAfter = planForward(threadKey, opts?.coParkingKeys);
      void handleUpdateLabels(thread, buildSettledLabels(snoozeNow, true))
        .then((ok) => {
          if (ok && routeThreadKeyRef.current === threadKey) navigateAfter();
          return undefined;
        })
        .finally(() => {
          settlingThreadKeysRef.current.delete(threadKey);
        });
    },
    [buildSettledLabels, handleUpdateLabels, planForward, snoozeNow],
  );

  const handleSnooze = useCallback(
    (
      thread: SidebarV2Thread,
      untilIso: string,
      opts?: {
        coParkingKeys?: ReadonlySet<string>;
        skipUndoToast?: boolean;
        whenLabel?: string;
      },
    ) => {
      if (!canSnooze(thread, { now: snoozeNow })) return;
      const threadKey = sidebarV2ThreadKey(thread.serverId, thread.id);
      if (snoozingThreadKeysRef.current.has(threadKey)) return;
      snoozingThreadKeysRef.current.add(threadKey);
      const navigateAfter = planForward(threadKey, opts?.coParkingKeys);
      void handleUpdateLabels(thread, buildSnoozedLabels(untilIso, snoozeNow))
        .then((ok) => {
          if (!ok) return undefined;
          if (!opts?.skipUndoToast) {
            toast.show(t("sidebarV2.snoozedUntil", { when: opts?.whenLabel ?? untilIso }), {
              variant: "success",
              durationMs: 5_000,
              action: {
                label: t("sidebarV2.undo"),
                onPress: () => handleUnsnooze(thread),
              },
            });
          }
          if (routeThreadKeyRef.current === threadKey) navigateAfter();
          return undefined;
        })
        .finally(() => {
          snoozingThreadKeysRef.current.delete(threadKey);
        });
    },
    [buildSnoozedLabels, handleUnsnooze, handleUpdateLabels, planForward, snoozeNow, t, toast],
  );

  const handleRename = useCallback(
    (thread: SidebarV2Thread, title: string) => {
      const client = getClient();
      if (!client) {
        toast.error(t("workspace.screen.hostDisconnected"));
        return;
      }
      const trimmed = title.trim();
      if (!trimmed || trimmed === thread.title) return;
      void client.updateAgent(thread.id, { name: trimmed }).catch((error) => {
        toast.error(error instanceof Error ? error.message : t("sidebarV2.renameFailed"));
      });
    },
    [getClient, t, toast],
  );

  const handleCopyPath = useCallback(
    (thread: SidebarV2Thread) => {
      const path = thread.worktreePath ?? thread.cwd;
      if (!path) return;
      void Clipboard.setStringAsync(path)
        .then(() => toast.copied(t("common.copiedToClipboard")))
        .catch(() => toast.error(t("workspace.screen.copyFailed")));
    },
    [t, toast],
  );

  const handleCopyBranch = useCallback(
    (thread: SidebarV2Thread) => {
      if (!thread.branch) return;
      void Clipboard.setStringAsync(thread.branch)
        .then(() => toast.copied(t("common.copiedToClipboard")))
        .catch(() => toast.error(t("workspace.screen.copyFailed")));
    },
    [t, toast],
  );

  const handleMarkUnread = useCallback(
    (thread: SidebarV2Thread) => {
      markThreadUnread(
        sidebarV2ThreadKey(thread.serverId, thread.id),
        thread.lastActivityAt ?? new Date().toISOString(),
      );
    },
    [markThreadUnread],
  );

  const handleRegenerateTitle = useCallback(
    (thread: SidebarV2Thread) => {
      const client = getClient();
      if (!client) {
        toast.error(t("workspace.screen.hostDisconnected"));
        return;
      }
      void client.updateAgent(thread.id, { regenerateTitle: true }).catch((error) => {
        toast.error(error instanceof Error ? error.message : t("sidebarV2.regenerateTitleFailed"));
      });
    },
    [getClient, t, toast],
  );

  const handleDelete = useCallback(
    (thread: SidebarV2Thread, opts?: { skipConfirm?: boolean }) => {
      const client = getClient();
      if (!client || !activeServerId) {
        toast.error(t("workspace.screen.hostDisconnected"));
        return;
      }
      void (async () => {
        if (!opts?.skipConfirm) {
          const confirmed = await confirmDialog({
            title: t("sidebar.deleteSessionTitle"),
            message: t("sidebar.deleteSessionMessage", {
              name: thread.title || t("session.newSession"),
            }),
            confirmLabel: t("sidebar.deleteSession"),
            cancelLabel: t("common.cancel"),
            destructive: true,
          });
          if (!confirmed) return;
        }
        try {
          await client.deleteAgent(thread.id);
          useWorkspaceLayoutStore.getState().unpinAgentEverywhere(thread.id);
          useSessionStore.getState().setAgents(activeServerId, (prev) => {
            if (!prev.has(thread.id)) return prev;
            const next = new Map(prev);
            next.delete(thread.id);
            return next;
          });
          useSessionStore.getState().setAgentDetails(activeServerId, (prev) => {
            if (!prev.has(thread.id)) return prev;
            const next = new Map(prev);
            next.delete(thread.id);
            return next;
          });
          clearThreadUnread(sidebarV2ThreadKey(thread.serverId, thread.id));
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t("sidebar.deleteSessionFailed"));
        }
      })();
    },
    [activeServerId, clearThreadUnread, getClient, t, toast],
  );

  const handleShowMoreSettled = useCallback(() => {
    if (!activeServerId) return;
    const current = uiState?.settledVisibleCount ?? SETTLED_TAIL_INITIAL_COUNT;
    setSettledVisibleCount(activeServerId, current + SETTLED_TAIL_PAGE_COUNT);
  }, [activeServerId, setSettledVisibleCount, uiState?.settledVisibleCount]);

  const handleToggleSettledShelf = useCallback(() => {
    if (activeServerId) {
      setSettledShelfExpanded(activeServerId, !(uiState?.settledShelfExpanded ?? true));
    }
  }, [activeServerId, setSettledShelfExpanded, uiState?.settledShelfExpanded]);

  const handleToggleSnoozedShelf = useCallback(() => {
    if (activeServerId) {
      setSnoozedShelfExpanded(activeServerId, !(uiState?.snoozedShelfExpanded ?? false));
    }
  }, [activeServerId, setSnoozedShelfExpanded, uiState?.snoozedShelfExpanded]);

  const handleCloseProjectSettings = useCallback(() => setProjectSettingsProject(null), []);

  useEffect(() => {
    if (!activeServerId) return;
    resetSettledVisibleCount(activeServerId);
    clearSelection();
  }, [activeServerId, uiState?.scopeProjectKey, resetSettledVisibleCount, clearSelection]);

  const resolveUnseenCompletion = useCallback(
    (thread: SidebarV2Thread): boolean => {
      if (thread.requiresFinishedAttention) return true;
      const key = sidebarV2ThreadKey(thread.serverId, thread.id);
      const localCompletedAt = localUnreadCompletedAtByKey[key] ?? null;
      if (!localCompletedAt) return false;
      return hasUnseenCompletion({
        completedAt: localCompletedAt,
        lastVisitedAt: "1970-01-01T00:00:00.000Z",
      });
    },
    [localUnreadCompletedAtByKey],
  );

  const { bulkMenuCapabilities, bulkMenuCallbacks } = useSidebarV2BulkActions({
    selectedThreadKeys,
    threadByKey,
    snoozeNow,
    clearSelection,
    handleSettle,
    handleSnooze,
    handleMarkUnread,
    handleRegenerateTitle,
    handleDelete,
  });

  const handleRowModSelect = useCallback((thread: SidebarV2Thread) => {
    useSidebarV2Store
      .getState()
      .toggleThreadSelected(sidebarV2ThreadKey(thread.serverId, thread.id));
  }, []);

  const handleRowRangeSelect = useCallback(
    (thread: SidebarV2Thread) => {
      rangeSelectThreads(
        sidebarV2ThreadKey(thread.serverId, thread.id),
        orderedThreadKeysRef.current,
      );
    },
    [rangeSelectThreads],
  );

  const rowHandlers = useMemo(() => {
    const byId = new Map<string, RowHandlers>();
    const fallback: RowHandlers = {
      onPress: () => undefined,
      onRename: () => undefined,
      onSettle: () => undefined,
      onUnsettle: () => undefined,
      onSnooze: () => undefined,
      onUnsnooze: () => undefined,
      onDelete: () => undefined,
      onCopyPath: () => undefined,
      onCopyBranch: () => undefined,
      onMarkUnread: () => undefined,
      onRegenerateTitle: () => undefined,
      onModSelect: () => undefined,
      onRangeSelect: () => undefined,
    };
    for (const thread of threads) {
      byId.set(thread.id, {
        onPress: () => handleOpenThread(thread),
        onRename: (title) => handleRename(thread, title),
        onSettle: () => handleSettle(thread),
        onUnsettle: () => handleUnsettle(thread),
        onSnooze: (untilIso, whenLabel) => handleSnooze(thread, untilIso, { whenLabel }),
        onUnsnooze: () => handleUnsnooze(thread),
        onDelete: () => handleDelete(thread),
        onCopyPath: () => handleCopyPath(thread),
        onCopyBranch: () => handleCopyBranch(thread),
        onMarkUnread: () => handleMarkUnread(thread),
        onRegenerateTitle: () => handleRegenerateTitle(thread),
        onModSelect: () => handleRowModSelect(thread),
        onRangeSelect: () => handleRowRangeSelect(thread),
      });
    }
    return { byId, fallback };
  }, [
    handleCopyBranch,
    handleCopyPath,
    handleDelete,
    handleMarkUnread,
    handleOpenThread,
    handleRegenerateTitle,
    handleRename,
    handleRowModSelect,
    handleRowRangeSelect,
    handleSettle,
    handleSnooze,
    handleUnsettle,
    handleUnsnooze,
    threads,
  ]);

  const noProjects = projectSnapshots.length === 0;
  const noThreads = threads.length === 0;

  const renderActiveRow = useCallback(
    (thread: SidebarV2Thread) => (
      <SidebarV2Row
        key={thread.id}
        thread={thread}
        variant="card"
        variantAction="settle"
        isActive={normalizedSelectedAgentId === thread.id}
        isSelected={selectedThreadKeys.includes(sidebarV2ThreadKey(thread.serverId, thread.id))}
        isMultiSelectMode={isMultiSelectMode}
        isSnoozed={false}
        isSettled={false}
        isWoke={Boolean(threadWokeAt(thread, { now: snoozeNow }))}
        unseenCompletion={resolveUnseenCompletion(thread)}
        now={now}
        snoozeNow={snoozeNow}
        canSnoozeThread={canSnooze(thread, { now: snoozeNow })}
        canSettleThread={canSettle(thread, { now: snoozeNow })}
        projectLabel={thread.projectName}
        selectedCount={selectedThreadKeys.length}
        bulkMenuCapabilities={bulkMenuCapabilities}
        bulkMenuCallbacks={bulkMenuCallbacks}
        {...(rowHandlers.byId.get(thread.id) ?? rowHandlers.fallback)}
      />
    ),
    [
      bulkMenuCallbacks,
      bulkMenuCapabilities,
      isMultiSelectMode,
      now,
      resolveUnseenCompletion,
      rowHandlers,
      normalizedSelectedAgentId,
      selectedThreadKeys,
      snoozeNow,
    ],
  );

  const renderSnoozedRow = useCallback(
    (thread: SidebarV2Thread) => (
      <SidebarV2Row
        key={thread.id}
        thread={thread}
        variant="slim"
        variantAction="unsnooze"
        isActive={normalizedSelectedAgentId === thread.id}
        isSelected={selectedThreadKeys.includes(sidebarV2ThreadKey(thread.serverId, thread.id))}
        isMultiSelectMode={isMultiSelectMode}
        isSnoozed
        isSettled={false}
        isWoke={Boolean(threadWokeAt(thread, { now: snoozeNow }))}
        unseenCompletion={resolveUnseenCompletion(thread)}
        now={now}
        snoozeNow={snoozeNow}
        canSnoozeThread={false}
        canSettleThread={false}
        projectLabel={thread.projectName}
        selectedCount={selectedThreadKeys.length}
        bulkMenuCapabilities={bulkMenuCapabilities}
        bulkMenuCallbacks={bulkMenuCallbacks}
        {...(rowHandlers.byId.get(thread.id) ?? rowHandlers.fallback)}
      />
    ),
    [
      bulkMenuCallbacks,
      bulkMenuCapabilities,
      isMultiSelectMode,
      now,
      resolveUnseenCompletion,
      rowHandlers,
      normalizedSelectedAgentId,
      selectedThreadKeys,
      snoozeNow,
    ],
  );

  const renderSettledRow = useCallback(
    (thread: SidebarV2Thread) => (
      <SidebarV2Row
        key={thread.id}
        thread={thread}
        variant="slim"
        variantAction="unsettle"
        isActive={normalizedSelectedAgentId === thread.id}
        isSelected={selectedThreadKeys.includes(sidebarV2ThreadKey(thread.serverId, thread.id))}
        isMultiSelectMode={isMultiSelectMode}
        isSnoozed={false}
        isSettled
        isWoke={Boolean(threadWokeAt(thread, { now: snoozeNow }))}
        unseenCompletion={resolveUnseenCompletion(thread)}
        now={now}
        snoozeNow={snoozeNow}
        canSnoozeThread={canSnooze(thread, { now: snoozeNow })}
        canSettleThread={false}
        projectLabel={thread.projectName}
        selectedCount={selectedThreadKeys.length}
        bulkMenuCapabilities={bulkMenuCapabilities}
        bulkMenuCallbacks={bulkMenuCallbacks}
        {...(rowHandlers.byId.get(thread.id) ?? rowHandlers.fallback)}
      />
    ),
    [
      bulkMenuCallbacks,
      bulkMenuCapabilities,
      isMultiSelectMode,
      now,
      resolveUnseenCompletion,
      rowHandlers,
      normalizedSelectedAgentId,
      selectedThreadKeys,
      snoozeNow,
    ],
  );

  return (
    <View style={styles.container}>
      <View style={styles.fixedHeader}>
        <View style={styles.searchNewRow}>
          <View style={styles.searchContainer}>
            <SidebarV2Search
              threads={threads}
              isSearching={isSearching}
              activeResultIndex={0}
              onOpenThread={handleOpenThread}
            />
          </View>
          <SidebarV2NewThreadButton disabled={noProjects} onPress={onNewConversation} />
        </View>
        {projectSnapshots.length > 0 ? (
          <SidebarV2ScopeMenu
            serverId={activeServerId ?? ""}
            projects={sortedProjects}
            onAddProject={onAddProject}
            onProjectSettings={setProjectSettingsProject}
          />
        ) : null}
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        <SidebarV2Body
          isSearching={isSearching}
          noProjects={noProjects}
          noThreads={noThreads}
          scopeProjectKey={uiState?.scopeProjectKey ?? null}
          snoozedShelfExpanded={uiState?.snoozedShelfExpanded ?? false}
          settledShelfExpanded={uiState?.settledShelfExpanded ?? true}
          activeThreads={partition.activeThreads}
          snoozedThreads={partition.snoozedThreads}
          visibleSnoozedThreads={visibleSnoozedThreads}
          visibleSettledThreads={settledPaging.visibleSettledThreads}
          hiddenSettledCount={settledPaging.hiddenSettledCount}
          selectedAgentId={selectedAgentId ?? null}
          selectedThreadKeys={selectedThreadKeys}
          now={now}
          renderActiveRow={renderActiveRow}
          renderSnoozedRow={renderSnoozedRow}
          renderSettledRow={renderSettledRow}
          onAddProject={onAddProject}
          onToggleSnoozedShelf={handleToggleSnoozedShelf}
          onToggleSettledShelf={handleToggleSettledShelf}
          onShowMoreSettled={handleShowMoreSettled}
        />
      </ScrollView>

      {projectSettingsProject ? (
        <SidebarV2ProjectSettingsDialog
          project={projectSettingsProject}
          onClose={handleCloseProjectSettings}
        />
      ) : null}
    </View>
  );
}

/** Handlers passed to a row, memoized per thread id. */
interface RowHandlers {
  onPress: () => void;
  onRename: (title: string) => void;
  onSettle: () => void;
  onUnsettle: () => void;
  onSnooze: (untilIso: string, whenLabel?: string) => void;
  onUnsnooze: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
  onCopyBranch: () => void;
  onMarkUnread: () => void;
  onRegenerateTitle: () => void;
  onModSelect: () => void;
  onRangeSelect: () => void;
}

/** Renders the scroll body: search mode, empty states, or the shelf list. */
function SidebarV2Body({
  isSearching,
  noProjects,
  noThreads,
  scopeProjectKey,
  snoozedShelfExpanded,
  settledShelfExpanded,
  activeThreads,
  snoozedThreads,
  visibleSnoozedThreads,
  visibleSettledThreads,
  hiddenSettledCount,
  renderActiveRow,
  renderSnoozedRow,
  renderSettledRow,
  onAddProject,
  onToggleSnoozedShelf,
  onToggleSettledShelf,
  onShowMoreSettled,
}: {
  isSearching: boolean;
  noProjects: boolean;
  noThreads: boolean;
  scopeProjectKey: string | null;
  snoozedShelfExpanded: boolean;
  settledShelfExpanded: boolean;
  activeThreads: readonly SidebarV2Thread[];
  snoozedThreads: readonly SidebarV2Thread[];
  visibleSnoozedThreads: readonly SidebarV2Thread[];
  visibleSettledThreads: readonly SidebarV2Thread[];
  hiddenSettledCount: number;
  selectedAgentId: string | null;
  selectedThreadKeys: readonly string[];
  now: string;
  renderActiveRow: (thread: SidebarV2Thread) => ReactElement;
  renderSnoozedRow: (thread: SidebarV2Thread) => ReactElement;
  renderSettledRow: (thread: SidebarV2Thread) => ReactElement;
  onAddProject: () => void;
  onToggleSnoozedShelf: () => void;
  onToggleSettledShelf: () => void;
  onShowMoreSettled: () => void;
}) {
  const { t } = useTranslation();
  if (isSearching) {
    return null;
  }
  if (noProjects) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>{t("sidebarV2.noProjectsYet")}</Text>
        <Pressable style={styles.emptyButton} onPress={onAddProject}>
          <Text style={styles.emptyButtonLabel}>{t("sidebarV2.addProject")}</Text>
        </Pressable>
      </View>
    );
  }
  if (noThreads) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>
          {scopeProjectKey ? t("sidebarV2.noThreadsInScope") : t("sidebarV2.noThreadsYet")}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.list}>
      {activeThreads.map(renderActiveRow)}

      {snoozedThreads.length > 0 ? (
        <>
          <ShelfHeader
            label={t("sidebarV2.snoozed")}
            count={snoozedThreads.length}
            expanded={snoozedShelfExpanded}
            onToggle={onToggleSnoozedShelf}
            tone="snoozed"
          />
          {visibleSnoozedThreads.map(renderSnoozedRow)}
        </>
      ) : null}

      {visibleSettledThreads.length > 0 || hiddenSettledCount > 0 ? (
        <>
          <ShelfHeader
            label={t("sidebarV2.settled")}
            count={visibleSettledThreads.length + hiddenSettledCount}
            expanded={settledShelfExpanded}
            onToggle={onToggleSettledShelf}
            tone="settled"
          />
          {visibleSettledThreads.map(renderSettledRow)}
          {hiddenSettledCount > 0 ? (
            <Pressable style={styles.showMore} onPress={onShowMoreSettled}>
              <ThemedIconHost
                Icon={Plus}
                size={ICON_SIZE.xs}
                uniProps={foregroundMutedColorMapping}
              />
              <Text style={styles.showMoreLabel}>
                {t("sidebarV2.showMore", {
                  count: Math.min(hiddenSettledCount, SETTLED_TAIL_PAGE_COUNT),
                })}
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

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
  tone: "snoozed" | "settled";
}) {
  const labelStyle = useMemo(
    () =>
      tone === "snoozed"
        ? [styles.shelfHeaderLabel, styles.shelfHeaderSnoozed]
        : styles.shelfHeaderLabel,
    [tone],
  );
  return (
    <Pressable style={styles.shelfHeader} onPress={onToggle} accessibilityRole="button">
      <Text style={labelStyle}>
        {label}
        {count > 0 ? ` (${count})` : ""}
      </Text>
      <View style={styles.shelfHeaderDivider} />
      <ThemedIconHost
        Icon={expanded ? ChevronDown : ChevronRight}
        size={ICON_SIZE.xs}
        uniProps={foregroundMutedColorMapping}
      />
    </Pressable>
  );
}

function resolvePrState(workspace: WorkspaceDescriptor): "open" | "closed" | "merged" | null {
  const state = workspace.githubRuntime?.pullRequest?.state;
  if (state === "open" || state === "closed" || state === "merged") {
    return state;
  }
  return null;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  fixedHeader: {
    paddingHorizontal: theme.spacing[1],
    paddingTop: theme.spacing[1],
    gap: theme.spacing[0.5],
  },
  searchNewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[0.5],
  },
  searchContainer: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
  list: {
    gap: 2,
  },
  shelfHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: 8,
    paddingHorizontal: theme.spacing[0.5],
  },
  shelfHeaderLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.foregroundMuted,
  },
  shelfHeaderSnoozed: {
    color: theme.colors.accent,
  },
  shelfHeaderDivider: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  emptyState: {
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[6],
  },
  emptyTitle: {
    fontSize: 13,
    color: theme.colors.foregroundMuted,
  },
  emptyButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  emptyButtonLabel: {
    fontSize: 13,
    color: theme.colors.foreground,
  },
  showMore: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[0.5],
    paddingVertical: 8,
    borderRadius: theme.borderRadius.sm,
  },
  showMoreLabel: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
  },
}));

export type { SidebarV2Props };
