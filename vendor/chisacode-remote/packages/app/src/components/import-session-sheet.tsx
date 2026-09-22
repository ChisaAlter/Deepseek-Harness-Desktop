import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import type {
  DaemonClient,
  FetchRecentProviderSessionEntry,
} from "@chisacode/client/internal/daemon-client";
import type { AgentProvider } from "@chisacode/protocol/agent-types";
import { Inbox, RotateCw } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { getProviderIcon } from "@/components/provider-icons";
import { useIsCompactFormFactor } from "@/constants/layout";
import { formatTimeAgo } from "@/utils/time";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import {
  aggregateSessionEntries,
  ALL_FILTER_VALUE,
  buildProviderLabelMap,
  collectErroredProviderLabels,
  computeEmptyState,
  getPromptPreview,
  getSessionTitle,
  PER_PROVIDER_LIMIT,
  resolveProvidersToFetch,
  sumFilteredAlreadyImportedCount,
} from "@/components/import-session-sheet-view-model";

const IMPORT_SHEET_SNAP_POINTS = ["70%", "92%"];
const DISABLED_ACCESSIBILITY_STATE = { disabled: true };

const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedInbox = withUnistyles(Inbox);
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const mutedIconLgMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: ICON_SIZE.lg,
});

type RecentProviderSessionsClient = Pick<
  DaemonClient,
  "fetchRecentProviderSessions" | "importAgent"
>;

type ImportedAgent = Awaited<ReturnType<RecentProviderSessionsClient["importAgent"]>>;

interface ImportSessionSheetProps {
  visible: boolean;
  client: RecentProviderSessionsClient | null;
  serverId: string | null;
  cwd?: string | null;
  onClose: () => void;
  onImportedAgent?: (agentId: string) => void;
  onImported?: (agent: ImportedAgent) => void;
}

type RecentSessionsResponse = Awaited<
  ReturnType<RecentProviderSessionsClient["fetchRecentProviderSessions"]>
>;

interface SessionsQueryConfig {
  queryKey: ReadonlyArray<string | null>;
  enabled: boolean;
  queryFn: () => Promise<RecentSessionsResponse>;
}

function buildSessionsQueriesConfig(args: {
  providersToFetch: AgentProvider[] | null;
  sessionsQueryRoot: ReadonlyArray<string | null>;
  visible: boolean;
  client: RecentProviderSessionsClient | null;
  cwd: string | null | undefined;
}): SessionsQueryConfig[] {
  const { providersToFetch, sessionsQueryRoot, visible, client, cwd } = args;
  if (providersToFetch === null) return [];
  const enabled = visible && Boolean(client);
  return providersToFetch.map((provider) => ({
    queryKey: [...sessionsQueryRoot, provider],
    enabled,
    queryFn: async () => {
      if (!client) {
        throw new Error("Host is not connected");
      }
      return await client.fetchRecentProviderSessions({
        ...(cwd ? { cwd } : {}),
        providers: [provider],
        limit: PER_PROVIDER_LIMIT,
      });
    },
  }));
}

interface SheetStatusMessagesProps {
  isClientReady: boolean;
  isSnapshotUnsupported: boolean;
  hasNoImportableProviders: boolean;
  isLoadingSessions: boolean;
  allQueriesErrored: boolean;
  erroredProviderLabels: ReadonlyArray<string>;
  importErrored: boolean;
}

function SheetStatusMessages({
  isClientReady,
  isSnapshotUnsupported,
  hasNoImportableProviders,
  isLoadingSessions,
  allQueriesErrored,
  erroredProviderLabels,
  importErrored,
}: SheetStatusMessagesProps) {
  const { t } = useTranslation();
  if (!isClientReady) {
    return <Text style={styles.statusText}>{t("session.connectToImport")}</Text>;
  }
  if (isSnapshotUnsupported) {
    return <Text style={styles.statusText}>{t("session.updateHostToImport")}</Text>;
  }
  return (
    <>
      {hasNoImportableProviders ? (
        <Text style={styles.statusText}>{t("session.noImportableProviders")}</Text>
      ) : null}
      {isLoadingSessions ? (
        <View style={styles.statusRow}>
          <ThemedActivityIndicator size="small" uniProps={foregroundMutedColorMapping} />
          <Text style={styles.statusText}>{t("session.loadingRecentSessions")}</Text>
        </View>
      ) : null}
      {allQueriesErrored ? (
        <Text style={styles.statusText}>{t("session.loadSessionsFailed")}</Text>
      ) : null}
      {!allQueriesErrored && erroredProviderLabels.length > 0 ? (
        <Text style={styles.statusText}>
          {t("session.couldNotLoadSessionsFor", { providers: erroredProviderLabels.join(", ") })}
        </Text>
      ) : null}
      {importErrored ? <Text style={styles.statusText}>{t("session.importFailed")}</Text> : null}
    </>
  );
}

function RefreshAction({ isRefreshing, onPress }: { isRefreshing: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const pressableStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.refreshButton,
      pressed && styles.refreshButtonPressed,
    ],
    [],
  );
  return (
    <Pressable
      onPress={onPress}
      disabled={isRefreshing}
      accessibilityLabel={t("session.refreshSessions")}
      accessibilityRole="button"
      testID="import-session-refresh"
      style={pressableStyle}
    >
      <View style={styles.refreshIconSlot}>
        {isRefreshing ? (
          <ThemedActivityIndicator size="small" uniProps={foregroundMutedColorMapping} />
        ) : (
          <ThemedRotateCw size={16} uniProps={foregroundMutedColorMapping} />
        )}
      </View>
    </Pressable>
  );
}

function SheetEmptyState({ title }: { title: string }) {
  return (
    <View style={styles.emptyState} testID="import-session-empty-state">
      <View style={styles.emptyStateIcon}>
        <ThemedInbox uniProps={mutedIconLgMapping} strokeWidth={1.5} />
      </View>
      <Text style={styles.emptyStateTitle}>{title}</Text>
    </View>
  );
}

function buildProviderFilterOptions(
  providers: ReadonlyArray<string>,
  providerLabelById: ReadonlyMap<string, string>,
  t: (key: string) => string,
): SegmentedControlOption<string>[] {
  const options: SegmentedControlOption<string>[] = [
    { value: ALL_FILTER_VALUE, label: t("session.filterAll"), testID: "import-session-filter-all" },
  ];
  for (const provider of providers) {
    const ProviderIcon = getProviderIcon(provider);
    options.push({
      value: provider,
      label: providerLabelById.get(provider) ?? provider,
      testID: `import-session-filter-${provider}`,
      icon: ({ color, size }) => <ProviderIcon color={color} size={size} />,
    });
  }
  return options;
}

function ImportSessionSheetRow({
  entry,
  disabled,
  importing,
  showCwd,
  onImportSession,
}: {
  entry: FetchRecentProviderSessionEntry;
  disabled: boolean;
  importing: boolean;
  showCwd: boolean;
  onImportSession: (entry: FetchRecentProviderSessionEntry) => void;
}) {
  const { t } = useTranslation();
  const title = getSessionTitle(entry);
  const promptPreview = getPromptPreview(entry);
  const lastActivity = formatTimeAgo(new Date(entry.lastActivityAt));
  const ProviderIcon = getProviderIcon(entry.providerId);
  const accessibilityState = useMemo(
    () => (disabled ? DISABLED_ACCESSIBILITY_STATE : undefined),
    [disabled],
  );
  const handlePress = useCallback(() => {
    onImportSession(entry);
  }, [entry, onImportSession]);
  const pressableStyle = useCallback(
    ({ pressed, hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      Boolean(hovered) && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [],
  );

  return (
    <Pressable
      disabled={disabled}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      style={pressableStyle}
      testID={`import-session-session-${entry.providerId}-${entry.providerHandleId}`}
    >
      <View style={styles.rowIconWrap}>
        <ProviderIcon size={ICON_SIZE.md} color={styles.iconMuted.color} />
      </View>
      <View style={styles.rowContent}>
        <View style={styles.rowHeader}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.rowMeta}>{importing ? t("session.importing") : lastActivity}</Text>
        </View>
        <Text style={styles.rowPreview} numberOfLines={2}>
          {promptPreview}
        </Text>
        {showCwd && entry.cwd ? (
          <Text style={styles.rowCwd} numberOfLines={1}>
            {entry.cwd}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function ImportSessionSheet({
  visible,
  client,
  serverId,
  cwd,
  onClose,
  onImportedAgent,
  onImported,
}: ImportSessionSheetProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isCompact = useIsCompactFormFactor();
  const ResultsScrollView = isCompact ? BottomSheetScrollView : ScrollView;

  const { entries: snapshotEntries, supportsSnapshot } = useProvidersSnapshot(serverId, {
    cwd,
    enabled: visible,
  });

  const providersToFetch = useMemo(
    () => resolveProvidersToFetch(supportsSnapshot, snapshotEntries),
    [supportsSnapshot, snapshotEntries],
  );

  const providerLabelById = useMemo(
    () => buildProviderLabelMap(snapshotEntries),
    [snapshotEntries],
  );

  const sessionsQueryRoot = useMemo(
    () => ["recent-provider-sessions", cwd ?? null] as const,
    [cwd],
  );

  const queriesConfig = useMemo(
    () =>
      buildSessionsQueriesConfig({
        providersToFetch,
        sessionsQueryRoot,
        visible,
        client,
        cwd,
      }),
    [providersToFetch, sessionsQueryRoot, visible, client, cwd],
  );

  const queries = useQueries({ queries: queriesConfig });

  const aggregatedEntries = useMemo(() => aggregateSessionEntries(queries), [queries]);
  const totalAlreadyImportedCount = useMemo(
    () => sumFilteredAlreadyImportedCount(queries),
    [queries],
  );

  const filterProviders = useMemo(() => [...(providersToFetch ?? [])].sort(), [providersToFetch]);

  const [selectedProvider, setSelectedProvider] = useState<string>(ALL_FILTER_VALUE);

  useEffect(() => {
    if (
      !visible ||
      (selectedProvider !== ALL_FILTER_VALUE && !filterProviders.includes(selectedProvider))
    ) {
      setSelectedProvider(ALL_FILTER_VALUE);
    }
  }, [visible, filterProviders, selectedProvider]);

  const visibleEntries = useMemo(() => {
    if (selectedProvider === ALL_FILTER_VALUE) return aggregatedEntries;
    return aggregatedEntries.filter((entry) => entry.providerId === selectedProvider);
  }, [aggregatedEntries, selectedProvider]);

  const filterOptions = useMemo(
    () => buildProviderFilterOptions(filterProviders, providerLabelById, t),
    [filterProviders, providerLabelById, t],
  );

  const importMutation = useMutation({
    mutationFn: async (entry: FetchRecentProviderSessionEntry) => {
      if (!client) {
        throw new Error(t("session.hostNotConnected"));
      }
      const effectiveCwd = cwd ?? entry.cwd;
      if (!effectiveCwd) {
        throw new Error(t("session.missingCwd"));
      }
      const agent = await client.importAgent({
        providerId: entry.providerId,
        providerHandleId: entry.providerHandleId,
        cwd: effectiveCwd,
      });
      return agent;
    },
    onSuccess: async (agent) => {
      await queryClient.invalidateQueries({ queryKey: sessionsQueryRoot });
      onClose();
      onImportedAgent?.(agent.id);
      onImported?.(agent);
    },
  });

  const importingSessionKey =
    importMutation.isPending && importMutation.variables
      ? `${importMutation.variables.providerId}:${importMutation.variables.providerHandleId}`
      : null;

  const handleImportSession = useCallback(
    (entry: FetchRecentProviderSessionEntry) => {
      importMutation.mutate(entry);
    },
    [importMutation],
  );

  const erroredProviderLabels = useMemo(
    () => collectErroredProviderLabels(providersToFetch, queries, providerLabelById),
    [queries, providersToFetch, providerLabelById],
  );

  const isRefreshing = queries.some((query) => query.isFetching);

  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: sessionsQueryRoot });
  }, [queryClient, sessionsQueryRoot]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("session.importSession"),
      actions: <RefreshAction isRefreshing={isRefreshing} onPress={handleRefresh} />,
    }),
    [isRefreshing, handleRefresh, t],
  );

  const isSnapshotUnsupported = !supportsSnapshot;
  const isWaitingForSnapshot = supportsSnapshot && snapshotEntries === undefined;
  const hasNoImportableProviders = providersToFetch !== null && providersToFetch.length === 0;
  const isQueryingProviders = queries.length > 0;
  const isLoadingSessions =
    isWaitingForSnapshot ||
    (isQueryingProviders && queries.some((query) => query.isLoading || query.isPending));
  const allQueriesErrored = isQueryingProviders && queries.every((query) => query.isError);
  const allQueriesSettled =
    isQueryingProviders && queries.every((query) => !query.isLoading && !query.isPending);
  const { showEmptyState, emptyStateTitle } = computeEmptyState({
    isLoadingSessions,
    allQueriesErrored,
    isQueryingProviders,
    allQueriesSettled,
    selectedProvider,
    aggregatedCount: aggregatedEntries.length,
    visibleCount: visibleEntries.length,
    totalAlreadyImportedCount,
    providerLabelById,
  });
  const showFilter = filterProviders.length > 1;

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      testID="import-session-sheet"
      desktopMaxWidth={560}
      snapPoints={IMPORT_SHEET_SNAP_POINTS}
      scrollable={false}
    >
      <View style={styles.sheetBody}>
        {showFilter ? (
          <ScrollView
            testID="import-session-filter-scroll"
            horizontal
            showsHorizontalScrollIndicator
            style={styles.filterScroll}
            contentContainerStyle={styles.filterRow}
          >
            <SegmentedControl
              testID="import-session-filters"
              size="sm"
              options={filterOptions}
              value={selectedProvider}
              onValueChange={setSelectedProvider}
            />
          </ScrollView>
        ) : null}
        <SheetStatusMessages
          isClientReady={Boolean(client)}
          isSnapshotUnsupported={isSnapshotUnsupported}
          hasNoImportableProviders={hasNoImportableProviders}
          isLoadingSessions={isLoadingSessions}
          allQueriesErrored={allQueriesErrored}
          erroredProviderLabels={erroredProviderLabels}
          importErrored={importMutation.isError}
        />
        <ResultsScrollView
          testID="import-session-results-scroll"
          style={styles.resultsScroll}
          contentContainerStyle={styles.resultsContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
        >
          {visibleEntries.length > 0 ? (
            <View style={styles.list}>
              {visibleEntries.map((entry) => (
                <ImportSessionSheetRow
                  key={`${entry.providerId}:${entry.providerHandleId}`}
                  entry={entry}
                  disabled={importMutation.isPending}
                  importing={
                    importingSessionKey === `${entry.providerId}:${entry.providerHandleId}`
                  }
                  showCwd={!cwd}
                  onImportSession={handleImportSession}
                />
              ))}
            </View>
          ) : null}
          {showEmptyState ? <SheetEmptyState title={emptyStateTitle} /> : null}
        </ResultsScrollView>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  iconMuted: {
    color: theme.colors.foregroundMuted,
  },
  sheetBody: {
    flex: 1,
    minHeight: 0,
    gap: theme.spacing[3],
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  filterScroll: {
    flexGrow: 0,
    flexShrink: 0,
    height: 40,
    maxHeight: 40,
    minHeight: 0,
  },
  resultsScroll: {
    flex: 1,
    minHeight: 0,
  },
  resultsContent: {
    flexGrow: 1,
    paddingBottom: theme.spacing[2],
  },
  list: {
    gap: theme.spacing[1],
  },
  // Soft list rows inside import sheet.
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    marginHorizontal: 0,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceWorkspace,
    borderColor: theme.colors.border,
  },
  rowPressed: {
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  rowIconWrap: {
    width: theme.iconSize.md,
    paddingTop: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
  },
  rowMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  rowPreview: {
    color: theme.colors.foregroundMuted,
    // Soft import row preview: 12.5 muted.
    fontSize: 12.5,
    lineHeight: 18,
  },
  rowCwd: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    // Soft status chrome: 12.5 muted.
    fontSize: 12.5,
    lineHeight: 18,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[8],
    paddingHorizontal: theme.spacing[4],
  },
  emptyStateIcon: {
    opacity: 0.6,
    marginBottom: theme.spacing[1],
  },
  emptyStateTitle: {
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
    textAlign: "center",
  },
  refreshButton: {
    padding: theme.spacing[2],
    marginRight: theme.spacing[1],
    borderRadius: 10,
  },
  refreshButtonPressed: {
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  refreshIconSlot: {
    width: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
}));
