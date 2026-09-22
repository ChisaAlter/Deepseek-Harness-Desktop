import { useMemo, useState, useCallback, useEffect } from "react";
import { View, Text } from "react-native";
import { router, useIsFocused } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronLeft } from "lucide-react-native";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { AgentList } from "@/components/agent-list";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { buildHostOpenProjectRoute } from "@/utils/host-routes";
import { type Theme } from "@/styles/theme";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const SESSION_SKELETON_KEYS = ["one", "two", "three", "four", "five"] as const;
const SLOW_LOADING_DELAY_MS = 4_000;

export function SessionsScreen({ serverId }: { serverId: string }) {
  const isFocused = useIsFocused();

  if (!isFocused) {
    return <View style={styles.container} />;
  }

  return <SessionsScreenContent serverId={serverId} />;
}

function SessionsScreenContent({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { agents, hasMore, isInitialLoad, isLoadingMore, isRevalidating, loadMore, refreshAll } =
    useAgentHistory({
      serverId,
    });

  // Track user-initiated refresh to avoid showing spinner on background revalidation
  const [isManualRefresh, setIsManualRefresh] = useState(false);
  const [showSlowLoadingStatus, setShowSlowLoadingStatus] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    refreshAll();
  }, [refreshAll]);

  // Reset manual refresh flag when revalidation completes
  useEffect(() => {
    if (!isRevalidating && isManualRefresh) {
      setIsManualRefresh(false);
    }
  }, [isRevalidating, isManualRefresh]);

  useEffect(() => {
    if (!isInitialLoad) {
      setShowSlowLoadingStatus(false);
      return;
    }
    const timeout = setTimeout(() => setShowSlowLoadingStatus(true), SLOW_LOADING_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [isInitialLoad]);

  const sortedAgents = useMemo(() => {
    return [...agents].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [agents]);

  const handleBack = useCallback(() => {
    router.navigate(buildHostOpenProjectRoute(serverId));
  }, [serverId]);

  const listFooterComponent = useMemo(
    () =>
      hasMore ? (
        <View style={styles.footer}>
          <Button variant="ghost" onPress={loadMore} disabled={isLoadingMore}>
            {isLoadingMore ? t("common.loading") : t("common.loadMore")}
          </Button>
        </View>
      ) : null,
    [hasMore, loadMore, isLoadingMore, t],
  );

  return (
    <View style={styles.container}>
      <MenuHeader title={t("sidebar.sessions")} />
      {isInitialLoad ? (
        <View style={styles.loadingContainer}>
          <View style={styles.loadingList} accessibilityLabel={t("session.loadingRecentSessions")}>
            {SESSION_SKELETON_KEYS.map((key) => (
              <View key={key} style={styles.loadingRow}>
                <View style={styles.loadingIcon} />
                <View style={styles.loadingTextColumn}>
                  <View style={styles.loadingTitle} />
                  <View style={styles.loadingMeta} />
                </View>
              </View>
            ))}
          </View>
          <View style={styles.loadingStatusRow}>
            <ThemedLoadingSpinner size={14} uniProps={foregroundMutedColorMapping} />
            <Text style={styles.loadingStatusText}>{t("session.loadingRecentSessions")}</Text>
            {showSlowLoadingStatus ? (
              <Button variant="ghost" size="sm" onPress={refreshAll}>
                {t("common.retry")}
              </Button>
            ) : null}
          </View>
        </View>
      ) : null}
      {!isInitialLoad && sortedAgents.length === 0 ? (
        <View style={styles.emptyContainer} testID="sessions-empty-state">
          <Text style={styles.emptyText}>{t("sidebar.noSessions")}</Text>
          <Button variant="ghost" leftIcon={ChevronLeft} onPress={handleBack}>
            {t("common.back")}
          </Button>
        </View>
      ) : null}
      {!isInitialLoad && sortedAgents.length > 0 ? (
        <AgentList
          agents={sortedAgents}
          showCheckoutInfo={false}
          isRefreshing={isManualRefresh && isRevalidating}
          onRefresh={handleRefresh}
          listFooterComponent={listFooterComponent}
          showAttentionIndicator={false}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Soft list canvas for recent sessions.
  container: {
    flex: 1,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: theme.spacing[6],
    padding: theme.spacing[6],
  },
  // Soft empty copy: body-adjacent muted.
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: 14.5,
    lineHeight: 22,
  },
  // Soft .m-list pad for loading skeleton.
  loadingContainer: {
    flex: 1,
    alignItems: "stretch",
    gap: theme.spacing[3],
    paddingHorizontal: {
      xs: 12,
      md: theme.spacing[6],
    },
    paddingVertical: {
      xs: 8,
      md: theme.spacing[4],
    },
  },
  loadingList: {
    gap: 10,
  },
  loadingRow: {
    // Soft .m-card skeleton: r14 surface card.
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  loadingIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  loadingTextColumn: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[2],
  },
  loadingTitle: {
    width: "46%",
    height: 12,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  loadingMeta: {
    width: "28%",
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  loadingStatusRow: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  loadingStatusText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  footer: {
    alignItems: "center",
    paddingVertical: theme.spacing[4],
  },
}));
