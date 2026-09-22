import {
  View,
  Text,
  Pressable,
  Modal,
  RefreshControl,
  FlatList,
  type ListRenderItem,
  type PressableStateCallbackType,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { AgentStatusIndicator } from "@/components/ui/agent-status-indicator";
import { formatTimeAgo } from "@/utils/time";
import { shortenPath } from "@/utils/shorten-path";
import { type AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useSessionStore } from "@/stores/session-store";
import { Archive } from "lucide-react-native";
import { getProviderIcon } from "@/components/provider-icons";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { useTranslation } from "react-i18next";
import { rememberArchivedAgentDetail } from "@/utils/agent-history-navigation";
import { FONT_SIZE, ICON_SIZE, SPACING, type Theme } from "@/styles/theme";

// Lucide icons only accept `color` (a non-style prop), so wrap each one with
// `withUnistyles` and feed the theme-reactive color through `uniProps`. Only the
// icon node re-renders on theme changes — the surrounding row tree does not.
const ThemedArchive = withUnistyles(Archive);
// `RefreshControl.tintColor`/`colors` are non-style props Unistyles does not
// track via the `style` prop, so wrap RefreshControl and map them through
// `uniProps`.
const ThemedRefreshControl = withUnistyles(RefreshControl);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const refreshControlColorMapping = (theme: Theme) => ({
  tintColor: theme.colors.foregroundMuted,
  colors: [theme.colors.foregroundMuted],
});

interface AgentListProps {
  agents: AggregatedAgent[];
  showCheckoutInfo?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  selectedAgentId?: string;
  onAgentSelect?: () => void;
  listFooterComponent?: ReactElement | null;
  showAttentionIndicator?: boolean;
}

type FlatListItem =
  | { type: "header"; key: string; title: string }
  | { type: "agent"; key: string; agent: AggregatedAgent };

type DateSectionKey = "today" | "yesterday" | "thisWeek" | "thisMonth" | "older";

function deriveDateSectionKey(lastActivityAt: Date): DateSectionKey {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const activityStart = new Date(
    lastActivityAt.getFullYear(),
    lastActivityAt.getMonth(),
    lastActivityAt.getDate(),
  );

  if (activityStart.getTime() >= todayStart.getTime()) {
    return "today";
  }
  if (activityStart.getTime() >= yesterdayStart.getTime()) {
    return "yesterday";
  }

  const diffTime = todayStart.getTime() - activityStart.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) {
    return "thisWeek";
  }
  if (diffDays <= 30) {
    return "thisMonth";
  }
  return "older";
}

function formatStatusLabel(status: AggregatedAgent["status"]): string {
  switch (status) {
    case "initializing":
      return "Starting";
    case "idle":
      return "Idle";
    case "running":
      return "Running";
    case "error":
      return "Error";
    case "closed":
      return "Closed";
    default:
      return status;
  }
}

function SessionBadge({
  label,
  icon,
  tone = "neutral",
}: {
  label: string;
  icon?: ReactElement;
  tone?: "neutral" | "warning" | "danger";
}) {
  const badgeStyle = useMemo(
    () => [
      styles.badge,
      tone === "warning" && styles.badgeWarning,
      tone === "danger" && styles.badgeDanger,
    ],
    [tone],
  );
  const badgeTextStyle = useMemo(
    () => [
      styles.badgeText,
      tone === "warning" && styles.badgeTextWarning,
      tone === "danger" && styles.badgeTextDanger,
    ],
    [tone],
  );
  return (
    <View style={badgeStyle}>
      {icon}
      <Text style={badgeTextStyle}>{label}</Text>
    </View>
  );
}

function SessionRow({
  agent,
  isMobile,
  selectedAgentId,
  showAttentionIndicator,
  onPress,
  onLongPress,
}: {
  agent: AggregatedAgent;
  isMobile: boolean;
  selectedAgentId?: string;
  showAttentionIndicator: boolean;
  onPress: (agent: AggregatedAgent) => void;
  onLongPress: (agent: AggregatedAgent) => void;
}) {
  const { t } = useTranslation();
  const timeAgo = formatTimeAgo(agent.lastActivityAt);
  const agentKey = `${agent.serverId}:${agent.id}`;
  const isSelected = selectedAgentId === agentKey;
  const statusLabel = t(`session.status.${agent.status}`, {
    defaultValue: formatStatusLabel(agent.status),
  });
  const projectPath = shortenPath(agent.cwd);
  const ProviderIcon = getProviderIcon(agent.provider);
  // Provider icons are dynamic per row; wrap with `withUnistyles` so the
  // theme-reactive `color` flows through `uniProps` without a `useUnistyles`
  // hook call.
  const ThemedProviderIcon = useMemo(() => withUnistyles(ProviderIcon), [ProviderIcon]);

  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      isSelected && styles.rowSelected,
      Boolean(hovered) && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isSelected],
  );

  const handlePress = useCallback(() => onPress(agent), [onPress, agent]);
  const handleLongPress = useCallback(() => onLongPress(agent), [onLongPress, agent]);

  const sessionTitleStyle = useMemo(
    () => [styles.sessionTitle, isSelected && styles.sessionTitleHighlighted],
    [isSelected],
  );

  const archivedIcon = useMemo(
    () => <ThemedArchive size={FONT_SIZE.xs} uniProps={foregroundMutedColorMapping} />,
    [],
  );

  return (
    <Pressable
      style={pressableStyle}
      onPress={handlePress}
      onLongPress={handleLongPress}
      testID={`agent-row-${agent.serverId}-${agent.id}`}
    >
      <View style={styles.rowContent}>
        <View style={styles.rowTitleRow}>
          <View style={styles.providerIconWrap}>
            <ThemedProviderIcon size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
          </View>
          <Text style={sessionTitleStyle} numberOfLines={1}>
            {agent.title || t("session.newSession")}
          </Text>
          {agent.archivedAt ? (
            <SessionBadge label={t("session.archived")} icon={archivedIcon} />
          ) : null}
          {(agent.pendingPermissionCount ?? 0) > 0 ? (
            <SessionBadge
              label={t("session.pendingCount", { count: agent.pendingPermissionCount ?? 0 })}
              tone="warning"
            />
          ) : null}
          {!isMobile && showAttentionIndicator && agent.requiresAttention ? (
            <SessionBadge label={t("session.needsAttention")} tone="danger" />
          ) : null}
        </View>
        {isMobile && (
          <View style={styles.rowMetaRow}>
            <Text style={styles.sessionMetaText} numberOfLines={1}>
              {projectPath}
            </Text>
            <Text style={styles.sessionMetaSeparator}>·</Text>
            <AgentStatusIndicator
              status={agent.status}
              requiresAttention={agent.requiresAttention}
              attentionReason={agent.attentionReason}
              pendingPermissionCount={agent.pendingPermissionCount}
              size="md"
            />
            <Text style={styles.sessionMetaText}>{statusLabel}</Text>
            <Text style={styles.sessionMetaSeparator}>·</Text>
            <Text style={styles.sessionMetaText}>{timeAgo}</Text>
            {agent.serverLabel ? (
              <>
                <Text style={styles.sessionMetaSeparator}>·</Text>
                <Text style={styles.sessionMetaText} numberOfLines={1}>
                  {agent.serverLabel}
                </Text>
              </>
            ) : null}
          </View>
        )}
      </View>
      {!isMobile && (
        <>
          <Text style={styles.columnMeta} numberOfLines={1}>
            {projectPath}
          </Text>
          <View style={styles.columnStatusCell}>
            <AgentStatusIndicator
              status={agent.status}
              requiresAttention={agent.requiresAttention}
              attentionReason={agent.attentionReason}
              pendingPermissionCount={agent.pendingPermissionCount}
              size="md"
            />
            <Text style={styles.columnMetaFixed}>{statusLabel}</Text>
          </View>
          <Text style={styles.columnMetaFixed}>{timeAgo}</Text>
        </>
      )}
      {isMobile && showAttentionIndicator && agent.requiresAttention ? (
        <View style={styles.rowTrailing}>
          <SessionBadge label={t("session.needsAttention")} tone="danger" />
        </View>
      ) : null}
    </Pressable>
  );
}

export function AgentList({
  agents,
  isRefreshing = false,
  onRefresh,
  selectedAgentId,
  onAgentSelect,
  listFooterComponent,
  showAttentionIndicator = true,
}: AgentListProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [actionAgent, setActionAgent] = useState<AggregatedAgent | null>(null);
  const isMobile = useIsCompactFormFactor();
  const { archiveAgent } = useArchiveAgent();

  const actionClient = useSessionStore((state) =>
    actionAgent?.serverId ? (state.sessions[actionAgent.serverId]?.client ?? null) : null,
  );

  const isActionSheetVisible = actionAgent !== null;
  const isActionDaemonUnavailable = Boolean(actionAgent?.serverId && !actionClient);

  const handleAgentPress = useCallback(
    (agent: AggregatedAgent) => {
      if (isActionSheetVisible) {
        return;
      }

      const serverId = agent.serverId;
      const agentId = agent.id;

      onAgentSelect?.();

      rememberArchivedAgentDetail(agent);
      navigateToAgent({
        serverId,
        agentId,
        pin: Boolean(agent.archivedAt),
      });
    },
    [isActionSheetVisible, onAgentSelect],
  );

  const handleAgentLongPress = useCallback(
    (agent: AggregatedAgent) => {
      const isRunning = agent.status === "running" || agent.status === "initializing";
      if (isRunning) {
        setActionAgent(agent);
        return;
      }

      const client = useSessionStore.getState().sessions[agent.serverId]?.client ?? null;
      if (!client) {
        setActionAgent(agent);
        return;
      }
      void archiveAgent({ serverId: agent.serverId, agentId: agent.id }).catch(() => {});
    },
    [archiveAgent],
  );

  const handleCloseActionSheet = useCallback(() => {
    setActionAgent(null);
  }, []);

  const handleArchiveAgent = useCallback(() => {
    if (!actionAgent || !actionClient) {
      return;
    }
    // Timeout errors are swallowed — the daemon will still process the archive
    void archiveAgent({ serverId: actionAgent.serverId, agentId: actionAgent.id }).catch(() => {});
    setActionAgent(null);
  }, [actionAgent, actionClient, archiveAgent]);

  const flatItems = useMemo((): FlatListItem[] => {
    const order: DateSectionKey[] = ["today", "yesterday", "thisWeek", "thisMonth", "older"];
    const buckets = new Map<DateSectionKey, AggregatedAgent[]>();
    for (const agent of agents) {
      const sectionKey = deriveDateSectionKey(agent.lastActivityAt);
      const existing = buckets.get(sectionKey) ?? [];
      existing.push(agent);
      buckets.set(sectionKey, existing);
    }

    const result: FlatListItem[] = [];
    for (const sectionKey of order) {
      const data = buckets.get(sectionKey);
      if (!data || data.length === 0) {
        continue;
      }
      result.push({
        type: "header",
        key: `header:${sectionKey}`,
        title: t(`session.dateSections.${sectionKey}`),
      });
      for (const agent of data) {
        result.push({ type: "agent", key: `${agent.serverId}:${agent.id}`, agent });
      }
    }
    return result;
  }, [agents, t]);

  const renderItem: ListRenderItem<FlatListItem> = useCallback(
    ({ item }) => {
      if (item.type === "header") {
        return (
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>{item.title}</Text>
          </View>
        );
      }
      return (
        <SessionRow
          agent={item.agent}
          isMobile={isMobile}
          selectedAgentId={selectedAgentId}
          showAttentionIndicator={showAttentionIndicator}
          onPress={handleAgentPress}
          onLongPress={handleAgentLongPress}
        />
      );
    },
    [handleAgentLongPress, handleAgentPress, isMobile, selectedAgentId, showAttentionIndicator],
  );

  const keyExtractor = useCallback((item: FlatListItem) => item.key, []);

  const sheetContainerStyle = useMemo(
    () => [styles.sheetContainer, { paddingBottom: Math.max(insets.bottom, SPACING[6]) }],
    [insets.bottom],
  );
  const sheetArchiveTextStyle = useMemo(
    () => [styles.sheetArchiveText, isActionDaemonUnavailable && styles.sheetArchiveTextDisabled],
    [isActionDaemonUnavailable],
  );

  const refreshControl = useMemo(
    () =>
      onRefresh ? (
        <ThemedRefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          uniProps={refreshControlColorMapping}
        />
      ) : undefined,
    [onRefresh, isRefreshing],
  );

  return (
    <>
      <FlatList
        data={flatItems}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={listFooterComponent}
        refreshControl={refreshControl}
      />

      <Modal
        visible={isActionSheetVisible}
        animationType="fade"
        transparent
        onRequestClose={handleCloseActionSheet}
      >
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={handleCloseActionSheet} />
          <View style={sheetContainerStyle}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>
              {isActionDaemonUnavailable
                ? t("session.hostOffline")
                : t("session.stillRunningArchiveWarning")}
            </Text>
            <View style={styles.sheetButtonRow}>
              <Pressable
                style={SHEET_CANCEL_BUTTON_STYLE}
                onPress={handleCloseActionSheet}
                testID="agent-action-cancel"
              >
                <Text style={styles.sheetCancelText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                disabled={isActionDaemonUnavailable}
                style={SHEET_ARCHIVE_BUTTON_STYLE}
                onPress={handleArchiveAgent}
                testID="agent-action-archive"
              >
                <Text style={sheetArchiveTextStyle}>{t("common.archive")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    flex: 1,
    minHeight: 0,
  },
  // Soft .m-list: 8 12 20 on compact; desktop keeps roomier pad.
  listContent: {
    paddingHorizontal: {
      xs: 12,
      md: theme.spacing[6],
    },
    paddingTop: {
      xs: 8,
      md: theme.spacing[4],
    },
    paddingBottom: {
      xs: 20,
      md: theme.spacing[6],
    },
    gap: theme.spacing[1],
  },
  sectionHeading: {
    marginTop: theme.spacing[2],
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[2],
  },
  // Soft .sec / .m-sec group label (no tracking).
  sectionTitle: {
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    letterSpacing: 0,
  },
  // Soft desktop .sess chips; Soft .m-card/.m-row cards on compact.
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: {
      xs: 52,
      md: 44,
    },
    paddingVertical: {
      xs: 12,
      md: 10,
    },
    paddingHorizontal: {
      xs: 14,
      md: theme.spacing[3],
    },
    borderRadius: {
      xs: 14,
      md: 10,
    },
    marginBottom: {
      xs: 10,
      md: theme.spacing[1],
    },
    backgroundColor: {
      xs: theme.colors.surface0,
      md: "transparent",
    },
    borderWidth: {
      xs: 1,
      md: 0,
    },
    borderColor: theme.colors.border,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
  },
  rowTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  providerIconWrap: {
    width: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
  },
  rowMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[1],
    marginTop: 2,
  },
  rowTrailing: {
    marginLeft: theme.spacing[2],
  },
  // Soft .sess.on: elevated white chip.
  rowSelected: {
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...(isWeb
      ? ({
          boxShadow: "0 1px 2px rgba(20, 23, 31, 0.04)",
        } as object)
      : {}),
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowPressed: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  // Soft .sess title 12.5; Soft .m-row .t 14 medium on compact.
  sessionTitle: {
    flexShrink: 1,
    fontSize: {
      xs: 14,
      md: 12.5,
    },
    lineHeight: {
      xs: 20,
      md: 18,
    },
    fontWeight: {
      xs: "500",
      md: "400",
    },
    color: theme.colors.foreground,
    opacity: 0.9,
  },
  sessionTitleHighlighted: {
    opacity: 1,
  },
  // Soft .sess .m: 11 faint meta.
  sessionMetaText: {
    maxWidth: "100%",
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.foregroundMuted,
  },
  sessionMetaSeparator: {
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.foregroundMuted,
    opacity: 0.7,
  },
  columnMeta: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
    minWidth: 60,
    maxWidth: 200,
    marginLeft: theme.spacing[4],
  },
  columnMetaFixed: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
    flexShrink: 0,
    width: 72,
    textAlign: "right" as const,
  },
  columnStatusCell: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
    flexShrink: 0,
    width: 72,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  badgeWarning: {
    backgroundColor: theme.colors.statusWarningBg,
  },
  badgeDanger: {
    backgroundColor: theme.colors.statusDangerBg,
  },
  badgeText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  badgeTextWarning: {
    color: theme.colors.palette.amber[500],
  },
  badgeTextDanger: {
    color: theme.colors.palette.red[300],
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: theme.colors.overlay,
  },
  sheetContainer: {
    backgroundColor: theme.colors.surface0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[4],
    gap: theme.spacing[4],
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundMuted,
    opacity: 0.3,
  },
  // Soft sheet title: near .topbar title scale.
  sheetTitle: {
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    textAlign: "center",
  },
  sheetButtonRow: {
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  // Soft sheet action: r12 quiet control.
  sheetButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: theme.spacing[4],
    alignItems: "center",
    justifyContent: "center",
  },
  sheetArchiveButton: {
    backgroundColor: theme.colors.primary,
  },
  sheetArchiveText: {
    color: theme.colors.primaryForeground,
    fontWeight: theme.fontWeight.semibold,
    fontSize: 14.5,
    lineHeight: 20,
  },
  sheetArchiveTextDisabled: {
    opacity: 0.5,
  },
  sheetCancelButton: {
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  sheetCancelText: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.semibold,
    fontSize: 14.5,
    lineHeight: 20,
  },
}));

const SHEET_CANCEL_BUTTON_STYLE = [styles.sheetButton, styles.sheetCancelButton];
const SHEET_ARCHIVE_BUTTON_STYLE = [styles.sheetButton, styles.sheetArchiveButton];
