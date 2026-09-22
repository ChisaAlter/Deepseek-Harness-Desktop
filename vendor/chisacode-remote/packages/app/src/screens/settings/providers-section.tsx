/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { settingsStyles } from "@/styles/settings";
import { useHostRuntimeIsConnected, useHostRuntimeClient } from "@/runtime/host-runtime";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import { getProviderIcon } from "@/components/provider-icons";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useUserVisibleErrorReporter } from "@/hooks/use-user-visible-error";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";
import { useIsCompactFormFactor } from "@/constants/layout";
import { ChevronRight, Download, RefreshCw } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import {
  runProviderToolingAction,
  type ProviderToolingAction,
} from "@/screens/settings/provider-tooling-action";

const ThemedDownload = withUnistyles(Download);
const ThemedRefreshCw = withUnistyles(RefreshCw);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedChevronRight = withUnistyles(ChevronRight);

const accentColorMapping = (theme: Theme) => ({ color: theme.colors.accent });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const chevronHoveredColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const chevronIdleColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type ProviderDefinition = ReturnType<typeof buildProviderDefinitions>[number];
type ProviderEntry = NonNullable<ReturnType<typeof useProvidersSnapshot>["entries"]>[number];
type ProviderStatusReason = NonNullable<ProviderEntry["statusReason"]>;

type StatusTone = "success" | "warning" | "danger" | "muted" | "loading";

interface ProviderStatus {
  tone: StatusTone;
  label: string;
  modelCount: number | null;
  versionLabel: string | null;
}

function getProviderStatus(
  status: string,
  enabled: boolean,
  modelCount: number,
  installedVersion: string | null | undefined,
  statusReason: ProviderStatusReason | undefined,
  t: TFunction,
): ProviderStatus {
  const versionLabel = installedVersion ? `v${installedVersion}` : null;
  const reasonLabel = (fallbackKey: string): string => {
    switch (statusReason) {
      case "disabled":
        return t("providers.disabled");
      case "command_unavailable":
        return t("providers.commandUnavailable");
      case "runtime_unavailable":
        return t("providers.runtimeUnavailable");
      case "model_discovery_failed":
        return t("providers.modelDiscoveryFailed");
      case "refresh_failed":
        return t("providers.refreshFailed");
      case "configuration_changed":
        return t("providers.configurationChanged");
      default:
        return t(fallbackKey);
    }
  };
  if (!enabled)
    return { tone: "muted", label: t("providers.disabled"), modelCount: null, versionLabel };
  if (status === "loading")
    return {
      tone: "loading",
      label:
        statusReason === "configuration_changed"
          ? t("providers.configurationChanged")
          : t("providers.loading"),
      modelCount: null,
      versionLabel,
    };
  if (status === "error")
    return {
      tone: "danger",
      label: reasonLabel("providers.error"),
      modelCount: null,
      versionLabel,
    };
  if (status === "ready") {
    return {
      tone: "success",
      label: t("providers.ready"),
      modelCount: modelCount > 0 ? modelCount : null,
      versionLabel,
    };
  }
  return {
    tone: "warning",
    label: reasonLabel("providers.missing"),
    modelCount: null,
    versionLabel,
  };
}

interface ProviderRowProps {
  def: ProviderDefinition;
  entry: ProviderEntry;
  enabled: boolean;
  isToggling: boolean;
  isFirst: boolean;
  serverId: string;
  onPress: (providerId: string) => void;
  onToggleEnabled: (providerId: string, enabled: boolean) => void;
}

function ProviderRow({
  def,
  entry,
  enabled,
  isToggling,
  isFirst,
  serverId,
  onPress,
  onToggleEnabled,
}: ProviderRowProps) {
  const { t } = useTranslation();
  const reportError = useUserVisibleErrorReporter();
  const isCompact = useIsCompactFormFactor();
  const client = useHostRuntimeClient(serverId);
  const [toolingAction, setToolingAction] = useState<ProviderToolingAction | null>(null);
  const ProviderIcon = getProviderIcon(def.id);
  const providerError =
    enabled &&
    entry.status === "error" &&
    typeof entry.error === "string" &&
    entry.error.trim().length > 0
      ? entry.error.trim()
      : null;
  const modelCount = entry.models?.length ?? 0;
  const providerStatus = getProviderStatus(
    entry.status,
    enabled,
    modelCount,
    entry.installedVersion,
    entry.statusReason,
    t,
  );

  const handlePress = useCallback(() => {
    onPress(def.id);
  }, [def.id, onPress]);
  const handleToggleValueChange = useCallback(
    (value: boolean) => {
      onToggleEnabled(def.id, value);
    },
    [def.id, onToggleEnabled],
  );
  const handleRunToolingAction = useCallback(
    (action: ProviderToolingAction) => {
      if (!client || toolingAction) return;
      setToolingAction(action);
      void runProviderToolingAction({
        client,
        providerId: def.id,
        action,
        reportError,
        fallbackMessage:
          action === "update" ? t("providers.updateFailed") : t("providers.installFailed"),
      }).finally(() => {
        setToolingAction(null);
      });
    },
    [client, def.id, reportError, t, toolingAction],
  );
  const canInstall = enabled && entry.installAvailable === true;
  const canUpdate = enabled && entry.updateAvailable === true;
  const canReinstall =
    enabled &&
    Boolean(entry.packageName) &&
    Boolean(entry.installedVersion) &&
    entry.versionStatus !== "not-installed";
  const handleInstall = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      handleRunToolingAction("install");
    },
    [handleRunToolingAction],
  );
  const handleUpdate = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      handleRunToolingAction("update");
    },
    [handleRunToolingAction],
  );
  const handleReinstall = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      handleRunToolingAction("reinstall");
    },
    [handleRunToolingAction],
  );
  const rowStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      !isFirst && settingsStyles.rowBorder,
      styles.row,
      isCompact && styles.compactRow,
      hovered && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isFirst, isCompact],
  );
  const providerSwitch = (
    <Switch
      value={enabled}
      onValueChange={handleToggleValueChange}
      disabled={isToggling}
      accessibilityLabel={t("providers.enableLabel", { provider: def.label })}
    />
  );
  const maintenanceActions = (
    <ProviderMaintenanceActions
      providerLabel={def.label}
      compact={isCompact}
      canInstall={canInstall && !canUpdate}
      canUpdate={canUpdate}
      canReinstall={canReinstall}
      toolingAction={toolingAction}
      onInstall={handleInstall}
      onUpdate={handleUpdate}
      onReinstall={handleReinstall}
    />
  );

  return (
    <Pressable
      style={rowStyle}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t("providers.detailsLabel", { provider: def.label })}
    >
      {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) =>
        isCompact ? (
          <>
            <View style={styles.compactHeaderRow}>
              <ProviderSummary
                hovered={hovered === true}
                label={def.label}
                providerStatus={providerStatus}
                providerError={providerError}
                ProviderIcon={ProviderIcon}
              />
              {providerSwitch}
            </View>
            {maintenanceActions}
          </>
        ) : (
          <>
            <ProviderSummary
              hovered={hovered === true}
              label={def.label}
              providerStatus={providerStatus}
              providerError={providerError}
              ProviderIcon={ProviderIcon}
            />
            {maintenanceActions}
            {providerSwitch}
          </>
        )
      }
    </Pressable>
  );
}

function ProviderMaintenanceActions({
  providerLabel,
  compact,
  canInstall,
  canUpdate,
  canReinstall,
  toolingAction,
  onInstall,
  onUpdate,
  onReinstall,
}: {
  providerLabel: string;
  compact: boolean;
  canInstall: boolean;
  canUpdate: boolean;
  canReinstall: boolean;
  toolingAction: "install" | "update" | "reinstall" | null;
  onInstall: (event: GestureResponderEvent) => void;
  onUpdate: (event: GestureResponderEvent) => void;
  onReinstall: (event: GestureResponderEvent) => void;
}) {
  const { t } = useTranslation();
  const rowStyle = useMemo(
    () => [styles.actionsRow, compact && styles.compactActionsRow],
    [compact],
  );
  if (!canInstall && !canUpdate && !canReinstall) return null;
  return (
    <View style={rowStyle}>
      {canInstall ? (
        <Pressable
          onPress={onInstall}
          disabled={toolingAction !== null}
          accessibilityLabel={t("providers.install")}
          style={styles.actionButton}
        >
          {toolingAction === "install" ? (
            <ThemedLoadingSpinner size={14} uniProps={accentColorMapping} />
          ) : (
            <ThemedDownload size={14} uniProps={accentColorMapping} />
          )}
          <Text style={styles.actionLabel}>{t("providers.install")}</Text>
        </Pressable>
      ) : null}
      {canUpdate ? (
        <Pressable
          onPress={onUpdate}
          disabled={toolingAction !== null}
          accessibilityLabel={t("providers.update")}
          style={styles.actionButton}
        >
          {toolingAction === "update" ? (
            <ThemedLoadingSpinner size={14} uniProps={accentColorMapping} />
          ) : (
            <ThemedRefreshCw size={14} uniProps={accentColorMapping} />
          )}
          <Text style={styles.actionLabel}>{t("providers.update")}</Text>
        </Pressable>
      ) : null}
      {canReinstall ? (
        <Pressable
          onPress={onReinstall}
          disabled={toolingAction !== null}
          accessibilityLabel={t("settings.integrations.reinstallAgentTool", {
            provider: providerLabel,
          })}
          style={styles.actionButton}
        >
          {toolingAction === "reinstall" ? (
            <ThemedLoadingSpinner size={14} uniProps={accentColorMapping} />
          ) : (
            <ThemedRefreshCw size={14} uniProps={accentColorMapping} />
          )}
          <Text style={styles.actionLabel}>{t("settings.integrations.reinstall")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function ProviderSummary({
  hovered,
  label,
  providerStatus,
  providerError,
  ProviderIcon,
}: {
  hovered: boolean;
  label: string;
  providerStatus: ProviderStatus;
  providerError: string | null;
  ProviderIcon: ReturnType<typeof getProviderIcon>;
}) {
  const isCompact = useIsCompactFormFactor();
  const titleRowStyle = useMemo(
    () => [styles.titleRow, isCompact && styles.compactTitleRow],
    [isCompact],
  );
  const titleStyle = useMemo(() => [settingsStyles.rowTitle, styles.providerTitle], []);
  const ThemedProviderIcon = useMemo(() => withUnistyles(ProviderIcon), [ProviderIcon]);
  let chevronMapping;
  if (hovered) {
    chevronMapping = chevronHoveredColorMapping;
  } else {
    chevronMapping = chevronIdleColorMapping;
  }
  return (
    <View style={styles.rowContent}>
      <ThemedChevronRight size={ICON_SIZE.sm} uniProps={chevronMapping} />
      <ThemedProviderIcon size={ICON_SIZE.md} uniProps={foregroundColorMapping} />
      <View style={styles.textColumn}>
        <View style={titleRowStyle}>
          <Text style={titleStyle} numberOfLines={1}>
            {label}
          </Text>
          {!isCompact ? <Text style={styles.separator}>·</Text> : null}
          <StatusIndicator status={providerStatus} compact={isCompact} />
        </View>
        {providerError ? (
          <Text style={styles.errorText} numberOfLines={isCompact ? 4 : 3}>
            {providerError}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function getDotStyle(tone: StatusTone) {
  switch (tone) {
    case "success":
      return styles.statusDotSuccess;
    case "warning":
      return styles.statusDotWarning;
    case "danger":
      return styles.statusDotDanger;
    default:
      return styles.statusDotMuted;
  }
}

function StatusIndicator({
  status,
  compact = false,
}: {
  status: ProviderStatus;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const rowStyle = useMemo(() => [styles.statusRow, compact && styles.compactStatusRow], [compact]);
  const dotStyle = useMemo(() => [styles.statusDot, getDotStyle(status.tone)], [status.tone]);

  return (
    <View style={rowStyle}>
      {status.tone === "loading" ? (
        <ThemedLoadingSpinner size={10} uniProps={foregroundMutedColorMapping} />
      ) : (
        <View style={dotStyle} />
      )}
      <Text style={styles.statusLabel}>{status.label}</Text>
      {status.modelCount !== null ? (
        <>
          <Text style={styles.separator}>·</Text>
          <Text style={styles.statusLabel}>
            {t("providers.modelCount", { count: status.modelCount })}
          </Text>
        </>
      ) : null}
      {status.versionLabel ? (
        <>
          <Text style={styles.separator}>·</Text>
          <Text style={styles.statusLabel}>{status.versionLabel}</Text>
        </>
      ) : null}
    </View>
  );
}

export interface ProvidersSectionProps {
  serverId: string;
}

function ProviderSnapshotStatusView({
  hasServer,
  isConnected,
  supportsSnapshot,
  isLoading,
  isFetching,
  error,
  refreshError,
  onRetry,
  connectLabel,
  unsupportedLabel,
  loadingLabel,
  retryLabel,
}: {
  hasServer: boolean;
  isConnected: boolean;
  supportsSnapshot: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  refreshError: string | null;
  onRetry: () => void;
  connectLabel: string;
  unsupportedLabel: string;
  loadingLabel: string;
  retryLabel: string;
}) {
  if (!hasServer || !isConnected) {
    return (
      <View style={EMPTY_CARD_STYLE}>
        <Text style={styles.emptyText}>{connectLabel}</Text>
      </View>
    );
  }
  if (!supportsSnapshot) {
    return (
      <View style={EMPTY_CARD_STYLE}>
        <Text style={styles.emptyText}>{unsupportedLabel}</Text>
      </View>
    );
  }
  if (isLoading) {
    return (
      <View style={EMPTY_CARD_STYLE}>
        <Text style={styles.emptyText}>{loadingLabel}</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={EMPTY_CARD_STYLE}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable
          onPress={onRetry}
          disabled={isFetching}
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          style={styles.actionButton}
        >
          {isFetching ? <ThemedLoadingSpinner size={14} uniProps={accentColorMapping} /> : null}
          <Text style={styles.actionLabel}>{retryLabel}</Text>
        </Pressable>
      </View>
    );
  }
  if (refreshError) {
    return (
      <View style={EMPTY_CARD_STYLE}>
        <Text style={styles.errorText}>{refreshError}</Text>
        <Pressable
          onPress={onRetry}
          disabled={isFetching}
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          style={styles.actionButton}
        >
          {isFetching ? <ThemedLoadingSpinner size={14} uniProps={accentColorMapping} /> : null}
          <Text style={styles.actionLabel}>{retryLabel}</Text>
        </Pressable>
      </View>
    );
  }
  return null;
}

export function ProvidersSection({ serverId }: ProvidersSectionProps) {
  const { t } = useTranslation();
  const reportError = useUserVisibleErrorReporter();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { entries, isLoading, isFetching, error, refresh, refreshError, supportsSnapshot } =
    useProvidersSnapshot(serverId);
  const { patchConfig } = useDaemonConfig(serverId);
  const openProviderSettings = useProviderSettingsStore((state) => state.open);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);

  const providerDefinitions = useMemo(() => buildProviderDefinitions(entries), [entries]);
  const hasServer = serverId.length > 0;

  const handleOpenProviderSettings = useCallback(
    (providerId: string) => {
      openProviderSettings({ serverId, provider: providerId });
    },
    [openProviderSettings, serverId],
  );
  const handleToggleEnabled = useCallback(
    async (providerId: string, nextEnabled: boolean) => {
      setPendingProviderId(providerId);
      try {
        await patchConfig({ providers: { [providerId]: { enabled: nextEnabled } } });
        await refresh([providerId]);
      } catch (patchError) {
        reportError({
          error: patchError,
          logLabel: `[ProvidersSettings] Failed to update provider ${providerId}`,
          fallbackMessage: t("providers.updateFailed"),
        });
      } finally {
        setPendingProviderId((current) => (current === providerId ? null : current));
      }
    },
    [patchConfig, refresh, reportError, t],
  );
  const handleRetry = useCallback(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  return (
    <SettingsSection
      title={t("providers.title")}
      testID="host-page-providers-card"
      style={styles.sectionSpacing}
    >
      <ProviderSnapshotStatusView
        hasServer={hasServer}
        isConnected={isConnected}
        supportsSnapshot={supportsSnapshot}
        isLoading={isLoading}
        isFetching={isFetching}
        error={error}
        refreshError={refreshError}
        onRetry={handleRetry}
        connectLabel={t("providers.connectToView")}
        unsupportedLabel={t("providers.unsupported")}
        loadingLabel={t("common.loading")}
        retryLabel={t("common.retry")}
      />
      {hasServer &&
      isConnected &&
      supportsSnapshot &&
      !isLoading &&
      !error &&
      !refreshError &&
      providerDefinitions.length > 0 ? (
        <View style={settingsStyles.card}>
          {providerDefinitions.map((def, index) => {
            const entry = entries?.find((candidate) => candidate.provider === def.id);
            if (!entry) return null;
            return (
              <ProviderRow
                key={def.id}
                def={def}
                entry={entry}
                enabled={entry.enabled ?? true}
                isToggling={pendingProviderId === def.id}
                isFirst={index === 0}
                serverId={serverId}
                onPress={handleOpenProviderSettings}
                onToggleEnabled={handleToggleEnabled}
              />
            );
          })}
        </View>
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  sectionSpacing: {
    marginBottom: theme.spacing[4],
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  row: {
    gap: theme.spacing[3],
    minHeight: 56,
  },
  compactRow: {
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "flex-start",
    gap: theme.spacing[3],
    minHeight: 0,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface1,
  },
  rowContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  compactHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    minWidth: 0,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  compactTitleRow: {
    flexDirection: "column",
    alignItems: "flex-start",
    gap: theme.spacing[1],
  },
  providerTitle: {
    flexShrink: 1,
    minWidth: 0,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minWidth: 0,
  },
  compactStatusRow: {
    flexWrap: "wrap",
    alignItems: "center",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotSuccess: {
    backgroundColor: theme.colors.statusSuccess,
  },
  statusDotWarning: {
    backgroundColor: theme.colors.statusWarning,
  },
  statusDotDanger: {
    backgroundColor: theme.colors.statusDanger,
  },
  statusDotMuted: {
    backgroundColor: theme.colors.foregroundMuted,
  },
  statusLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  separator: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: 12.5,
    lineHeight: 16,
    marginTop: theme.spacing[1],
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  compactActionsRow: {
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  actionLabel: {
    color: theme.colors.accent,
    fontSize: 12.5,
    lineHeight: 16,
  },
}));

const EMPTY_CARD_STYLE = [settingsStyles.card, styles.emptyCard];
