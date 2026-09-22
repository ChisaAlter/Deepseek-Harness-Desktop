import { ChevronRight, Globe, Monitor, Pencil, RotateCw, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { LocalDaemonSection } from "@/desktop/components/desktop-updates-section";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useUserVisibleErrorReporter } from "@/hooks/use-user-visible-error";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import {
  getHostRuntimeStore,
  isHostRuntimeConnected,
  useHostMutations,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
  useHosts,
} from "@/runtime/host-runtime";
import { CindyModulesSection } from "@/screens/settings/cindy-modules-section";
import { CustomModelsSection } from "@/screens/settings/custom-models-section";
import { ProvidersSection } from "@/screens/settings/providers-section";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import type { HostConnection, HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import { useToast } from "@/contexts/toast-context";
import { formatConnectionStatus, getConnectionStatusTone } from "@/utils/daemons";
import { formatLatency } from "@/utils/latency";

function formatHostConnectionLabel(connection: HostConnection): string {
  if (connection.type === "relay") {
    return `Relay (${connection.relayEndpoint})`;
  }
  if (connection.type === "directSocket" || connection.type === "directPipe") {
    return `Local (${connection.path})`;
  }
  return `TCP (${connection.endpoint})`;
}

// Lucide icons only accept `color`/`size` as non-style props, so wrap each one
// with `withUnistyles` and feed theme-reactive values through `uniProps`. Only
// the icon node re-renders on theme changes; the surrounding tree does not.
const ThemedGlobe = withUnistyles(Globe);
const ThemedMonitor = withUnistyles(Monitor);
const ThemedPencil = withUnistyles(Pencil);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedTrash2 = withUnistyles(Trash2);

const foregroundMutedSmIconMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});
const foregroundSmIconMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
  size: theme.iconSize.sm,
});
const destructiveSmIconMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
  size: theme.iconSize.sm,
});

function formatActiveConnectionBadge(
  activeConnection: { type: HostConnection["type"]; display: string } | null,
  t: (key: string) => string,
): { icon: React.ReactNode; text: string } | null {
  if (!activeConnection) return null;
  if (activeConnection.type === "relay") {
    return {
      icon: <ThemedGlobe uniProps={foregroundMutedSmIconMapping} />,
      text: t("settings.hostPage.connectionType.relay"),
    };
  }
  if (activeConnection.type === "directSocket" || activeConnection.type === "directPipe") {
    return {
      icon: <ThemedMonitor uniProps={foregroundMutedSmIconMapping} />,
      text: t("settings.hostPage.connectionType.local"),
    };
  }
  return {
    icon: <ThemedMonitor uniProps={foregroundMutedSmIconMapping} />,
    text: activeConnection.display,
  };
}

function formatDaemonVersionBadge(version: string | null): string | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function RemoveConnectionSheetHeader(t: (key: string) => string): SheetHeader {
  return { title: t("settings.hostPage.removeConnection.title") };
}

function RemoveHostSheetHeader(t: (key: string) => string): SheetHeader {
  return { title: t("settings.hostPage.removeHost.title") };
}

export interface HostPageProps {
  serverId: string;
  onHostRemoved?: () => void;
}

export function HostPage({ serverId, onHostRemoved }: HostPageProps) {
  const { t } = useTranslation();
  const daemons = useHosts();
  const host = daemons.find((entry) => entry.serverId === serverId) ?? null;
  const snapshot = useHostRuntimeSnapshot(serverId);
  const isLocalDaemon = useIsLocalDaemon(serverId);

  const daemonVersion = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.version ?? null,
  );

  // COMPAT(cindyModules): only show the Agent Intelligence section when the daemon
  // advertises the Cindy modules. Drop the gate when floor >= v0.1.X.
  const cindyModulesEnabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.cindyModules === true,
  );

  const connectionStatus = snapshot?.connectionStatus ?? "connecting";
  const activeConnection = snapshot?.activeConnection ?? null;
  const lastError = snapshot?.lastError ?? null;
  const statusLabel = formatConnectionStatus(connectionStatus, t);
  const statusTone = getConnectionStatusTone(connectionStatus);
  let statusPillVariantStyle;
  let statusDotVariantStyle;
  let statusTextVariantStyle;
  if (statusTone === "success") {
    statusPillVariantStyle = styles.statusPillSuccess;
    statusDotVariantStyle = styles.statusDotSuccess;
    statusTextVariantStyle = styles.statusTextSuccess;
  } else if (statusTone === "warning") {
    statusPillVariantStyle = styles.statusPillWarning;
    statusDotVariantStyle = styles.statusDotWarning;
    statusTextVariantStyle = styles.statusTextWarning;
  } else if (statusTone === "error") {
    statusPillVariantStyle = styles.statusPillError;
    statusDotVariantStyle = styles.statusDotError;
    statusTextVariantStyle = styles.statusTextError;
  } else {
    statusPillVariantStyle = styles.statusPillDefault;
    statusDotVariantStyle = styles.statusDotDefault;
    statusTextVariantStyle = styles.statusTextDefault;
  }
  const connectionBadge = formatActiveConnectionBadge(activeConnection, t);
  const versionBadgeText = formatDaemonVersionBadge(daemonVersion);
  const connectionError =
    typeof lastError === "string" && lastError.trim().length > 0 ? lastError.trim() : null;

  const statusPillStyle = useMemo(
    () => [styles.statusPill, statusPillVariantStyle],
    [statusPillVariantStyle],
  );
  const statusDotStyle = useMemo(
    () => [styles.statusDot, statusDotVariantStyle],
    [statusDotVariantStyle],
  );
  const statusTextStyle = useMemo(
    () => [styles.statusText, statusTextVariantStyle],
    [statusTextVariantStyle],
  );

  if (!host) {
    return (
      <View testID={`settings-host-page-${serverId}`}>
        <View style={EMPTY_CARD_STYLE}>
          <Text style={styles.emptyText}>{t("settings.hostPage.hostNotFound")}</Text>
        </View>
      </View>
    );
  }

  return (
    <View testID={`settings-host-page-${serverId}`}>
      <View style={styles.identityBadges} testID="host-page-identity">
        <View style={statusPillStyle}>
          <View style={statusDotStyle} />
          <Text style={statusTextStyle}>{statusLabel}</Text>
        </View>
        {connectionBadge ? (
          <View style={styles.badgePill}>
            {connectionBadge.icon}
            <Text style={styles.badgeText} numberOfLines={1}>
              {connectionBadge.text}
            </Text>
          </View>
        ) : null}
        {versionBadgeText ? (
          <View style={styles.badgePill}>
            <Text style={styles.badgeText} numberOfLines={1}>
              {versionBadgeText}
            </Text>
          </View>
        ) : null}
      </View>
      {connectionError ? <Text style={styles.errorText}>{connectionError}</Text> : null}

      <ConnectionsSection host={host} />

      <DaemonSection host={host} isLocalDaemon={isLocalDaemon} />

      <ProvidersSection serverId={serverId} />

      <CustomModelsSection serverId={serverId} />

      {cindyModulesEnabled ? <CindyModulesSection serverId={serverId} /> : null}

      <RemoveHostSection host={host} onRemoved={onHostRemoved} />
    </View>
  );
}

export function HostRenameButton({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const { renameHost } = useHostMutations();
  const [isEditing, setIsEditing] = useState(false);

  const handleSubmit = useCallback(
    async (value: string) => {
      const nextLabel = value.trim();
      if (nextLabel === host.label.trim()) return;
      await renameHost(host.serverId, nextLabel);
    },
    [host.label, host.serverId, renameHost],
  );

  const openEditor = useCallback(() => setIsEditing(true), []);
  const closeEditor = useCallback(() => setIsEditing(false), []);

  return (
    <>
      <Pressable
        onPress={openEditor}
        hitSlop={8}
        style={styles.identityEditButton}
        accessibilityRole="button"
        accessibilityLabel={t("settings.hostPage.editLabel")}
        testID="host-page-label-edit-button"
      >
        <ThemedPencil uniProps={foregroundMutedSmIconMapping} />
      </Pressable>

      <AdaptiveRenameModal
        visible={isEditing}
        title={t("settings.hostPage.renameHost.title")}
        initialValue={host.label}
        placeholder={t("settings.hostPage.renameHost.placeholder")}
        submitLabel={t("settings.hostPage.renameHost.submit")}
        onClose={closeEditor}
        onSubmit={handleSubmit}
        testID="host-page-rename-modal"
      />
    </>
  );
}

function ConnectionsSection({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const reportError = useUserVisibleErrorReporter();
  const { removeConnection } = useHostMutations();
  const snapshot = useHostRuntimeSnapshot(host.serverId);
  const probeByConnectionId = snapshot?.probeByConnectionId ?? new Map();
  const [pendingRemoveConnection, setPendingRemoveConnection] = useState<{
    connectionId: string;
    title: string;
  } | null>(null);
  const [isRemovingConnection, setIsRemovingConnection] = useState(false);

  const handleRequestRemove = useCallback((connection: HostConnection) => {
    setPendingRemoveConnection({
      connectionId: connection.id,
      title: formatHostConnectionLabel(connection),
    });
  }, []);

  const handleCloseConfirm = useCallback(() => {
    if (isRemovingConnection) return;
    setPendingRemoveConnection(null);
  }, [isRemovingConnection]);

  const handleCancelConfirm = useCallback(() => {
    setPendingRemoveConnection(null);
  }, []);

  const handleConfirmRemove = useCallback(() => {
    if (!pendingRemoveConnection) return;
    const { connectionId } = pendingRemoveConnection;
    setIsRemovingConnection(true);
    void removeConnection(host.serverId, connectionId)
      .then(() => setPendingRemoveConnection(null))
      .catch((error) => {
        reportError({
          error,
          logLabel: "[HostPage] Failed to remove connection",
          message: t("settings.hostPage.removeConnection.failed"),
        });
      })
      .finally(() => setIsRemovingConnection(false));
  }, [pendingRemoveConnection, removeConnection, host.serverId, reportError, t]);

  return (
    <SettingsSection title={t("settings.hostPage.connections.title")}>
      <View style={settingsStyles.card} testID="host-page-connections-card">
        {host.connections.map((conn, index) => {
          const probe = probeByConnectionId.get(conn.id);
          return (
            <ConnectionRow
              key={conn.id}
              connection={conn}
              showBorder={index > 0}
              latencyMs={probe?.status === "available" ? probe.latencyMs : undefined}
              latencyLoading={!probe || probe.status === "pending"}
              latencyError={probe?.status === "unavailable"}
              onRemove={handleRequestRemove}
            />
          );
        })}
      </View>

      {pendingRemoveConnection ? (
        <AdaptiveModalSheet
          header={RemoveConnectionSheetHeader(t)}
          visible
          onClose={handleCloseConfirm}
          testID="remove-connection-confirm-modal"
        >
          <Text style={styles.confirmText}>
            {t("settings.hostPage.removeConnection.confirm", {
              name: pendingRemoveConnection.title,
            })}
          </Text>
          <View style={styles.confirmActions}>
            <Button
              variant="secondary"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleCancelConfirm}
              disabled={isRemovingConnection}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleConfirmRemove}
              disabled={isRemovingConnection}
              testID="remove-connection-confirm"
            >
              {t("common.remove")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </SettingsSection>
  );
}

function ConnectionRow({
  connection,
  showBorder,
  latencyMs,
  latencyLoading,
  latencyError,
  onRemove,
}: {
  connection: HostConnection;
  showBorder: boolean;
  latencyMs: number | null | undefined;
  latencyLoading: boolean;
  latencyError: boolean;
  onRemove: (connection: HostConnection) => void;
}) {
  const { t } = useTranslation();
  const title = formatHostConnectionLabel(connection);

  const latencyText = (() => {
    if (latencyLoading) return "...";
    if (latencyError) return t("settings.hostPage.latency.timeout");
    if (latencyMs != null) return formatLatency(latencyMs);
    return "—";
  })();
  let latencyVariantStyle;
  if (latencyError) {
    latencyVariantStyle = styles.connectionLatencyError;
  } else {
    latencyVariantStyle = styles.connectionLatencyDefault;
  }

  const handlePressRemove = useCallback(() => {
    onRemove(connection);
  }, [onRemove, connection]);

  const rowStyle = useMemo(
    () => [settingsStyles.row, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  const latencyTextStyle = useMemo(
    () => [styles.connectionLatency, latencyVariantStyle],
    [latencyVariantStyle],
  );

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <Text style={latencyTextStyle}>{latencyText}</Text>
      <Button
        variant="ghost"
        size="sm"
        textStyle={styles.destructiveText}
        onPress={handlePressRemove}
      >
        {t("common.remove")}
      </Button>
    </View>
  );
}

function DaemonSection({ host, isLocalDaemon }: { host: HostProfile; isLocalDaemon: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <SettingsSection title={t("settings.hostPage.daemonSettings.title")}>
        <InjectChisaCodeToolsCard serverId={host.serverId} />
        <AppendSystemPromptCard serverId={host.serverId} />
      </SettingsSection>
      {isLocalDaemon ? (
        <SettingsSection title={t("settings.hostPage.pairDevice.sectionTitle")}>
          <PairDeviceRow />
        </SettingsSection>
      ) : null}
      {isLocalDaemon ? <LocalDaemonSection /> : null}
    </>
  );
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function RestartDaemonCard({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const toast = useToast();
  const reportError = useUserVisibleErrorReporter();
  const daemonClient = useHostRuntimeClient(host.serverId);
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const runtime = getHostRuntimeStore();
  const [isRestarting, setIsRestarting] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isHostConnected = useCallback(
    () => isHostRuntimeConnected(runtime.getSnapshot(host.serverId)),
    [host.serverId, runtime],
  );

  const waitForCondition = useCallback(
    async (predicate: () => boolean, timeoutMs: number, intervalMs = 250) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!isMountedRef.current) return false;
        if (predicate()) return true;
        await delay(intervalMs);
      }
      return predicate();
    },
    [],
  );

  const waitForDaemonRestart = useCallback(async () => {
    const disconnectTimeoutMs = 7000;
    const reconnectTimeoutMs = 30000;
    if (isHostConnected()) {
      await waitForCondition(() => !isHostConnected(), disconnectTimeoutMs);
    }
    const reconnected = await waitForCondition(() => isHostConnected(), reconnectTimeoutMs);
    if (isMountedRef.current) {
      setIsRestarting(false);
      if (!reconnected) {
        toast.error(t("settings.hostPage.restart.notRestored", { host: host.label }));
      }
    }
  }, [host.label, isHostConnected, waitForCondition, toast, t]);

  const handleRestart = useCallback(() => {
    if (!daemonClient) {
      toast.error(t("settings.hostPage.restart.notConnected"));
      return;
    }
    if (!isHostConnected()) {
      toast.error(t("settings.hostPage.restart.offline"));
      return;
    }

    void confirmDialog({
      title: t("settings.hostPage.restart.confirmTitle", { host: host.label }),
      message: t("settings.hostPage.restart.confirmationMessage"),
      confirmLabel: t("settings.hostPage.restart.confirmLabel"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    })
      .then((confirmed) => {
        if (!confirmed) return;
        setIsRestarting(true);
        void daemonClient
          .restartServer(`settings_daemon_restart_${host.serverId}`)
          .catch((error) => {
            const notify = isMountedRef.current;
            if (notify) setIsRestarting(false);
            reportError({
              error,
              logLabel: `[HostPage] Failed to restart daemon ${host.label}`,
              message: t("settings.hostPage.restart.requestFailed"),
              notify,
            });
          });
        void waitForDaemonRestart();
        return;
      })
      .catch((error) => {
        reportError({
          error,
          logLabel: `[HostPage] Failed to open restart confirmation for ${host.label}`,
          message: t("settings.hostPage.restart.dialogFailed"),
        });
      });
  }, [
    daemonClient,
    host.label,
    host.serverId,
    isHostConnected,
    reportError,
    waitForDaemonRestart,
    toast,
    t,
  ]);

  const restartIcon = useMemo(() => <ThemedRotateCw uniProps={foregroundSmIconMapping} />, []);

  return (
    <View style={settingsStyles.card} testID="host-page-restart-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.hostPage.restart.title")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.hostPage.restart.hint")}</Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          leftIcon={restartIcon}
          onPress={handleRestart}
          disabled={isRestarting || !daemonClient || !isConnected}
          testID="host-page-restart-button"
        >
          {isRestarting
            ? t("settings.hostPage.restart.restarting")
            : t("settings.hostPage.restart.button")}
        </Button>
      </View>
    </View>
  );
}

function InjectChisaCodeToolsCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({
        mcp: {
          injectIntoAgents: next,
        },
      });
    },
    [patchConfig],
  );

  if (!isConnected) return null;

  return (
    <View style={settingsStyles.card} testID="host-page-inject-mcp-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.hostPage.injectTools.title")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.hostPage.injectTools.hint")}</Text>
        </View>
        <Switch
          value={config?.mcp.injectIntoAgents !== false}
          onValueChange={handleValueChange}
          accessibilityLabel={t("settings.hostPage.injectTools.a11yLabel")}
        />
      </View>
    </View>
  );
}

function AppendSystemPromptCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const reportError = useUserVisibleErrorReporter();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const persistedPrompt = config?.appendSystemPrompt ?? "";
  const [draft, setDraft] = useState(persistedPrompt);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.hostPage.systemPrompt.sheetTitle") }),
    [t],
  );

  useEffect(() => {
    setDraft(persistedPrompt);
  }, [persistedPrompt]);

  const hasChanges = draft !== persistedPrompt;

  const handleOpen = useCallback(() => {
    setDraft(persistedPrompt);
    setIsEditing(true);
  }, [persistedPrompt]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    setDraft(persistedPrompt);
    setIsEditing(false);
  }, [isSaving, persistedPrompt]);

  const handleSave = useCallback(() => {
    setIsSaving(true);
    void patchConfig({ appendSystemPrompt: draft })
      .then(() => {
        setIsEditing(false);
        return;
      })
      .catch((error) => {
        reportError({
          error,
          logLabel: "[HostPage] Failed to save append system prompt",
          message: t("settings.hostPage.systemPrompt.saveFailed"),
        });
      })
      .finally(() => setIsSaving(false));
  }, [draft, patchConfig, reportError, t]);

  const handleReset = useCallback(() => {
    setDraft(persistedPrompt);
  }, [persistedPrompt]);

  if (!isConnected) return null;

  return (
    <>
      <View style={settingsStyles.card} testID="host-page-append-system-prompt-card">
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.hostPage.systemPrompt.title")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.hostPage.systemPrompt.hint")}</Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            onPress={handleOpen}
            testID="host-page-append-system-prompt-edit"
          >
            {t("settings.hostPage.systemPrompt.edit")}
          </Button>
        </View>
      </View>

      {isEditing ? (
        <AdaptiveModalSheet
          header={header}
          visible
          onClose={handleClose}
          testID="host-page-append-system-prompt-sheet"
          desktopMaxWidth={560}
        >
          <SettingsTextAreaCard
            testID="host-page-append-system-prompt-input"
            accessibilityLabel={t("settings.hostPage.systemPrompt.a11yLabel")}
            value={draft}
            onChangeText={setDraft}
            placeholder="Always keep replies concise."
          />
          <View style={styles.appendPromptActions}>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleReset}
              disabled={!hasChanges || isSaving}
              testID="host-page-append-system-prompt-reset"
            >
              {t("settings.hostPage.systemPrompt.reset")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onPress={handleSave}
              disabled={!hasChanges || isSaving}
              testID="host-page-append-system-prompt-save"
            >
              {isSaving
                ? t("settings.hostPage.systemPrompt.saving")
                : t("settings.hostPage.systemPrompt.save")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </>
  );
}

function PairDeviceRow() {
  const { t } = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpen = useCallback(() => setIsModalOpen(true), []);
  const handleClose = useCallback(() => setIsModalOpen(false), []);

  return (
    <View style={settingsStyles.card}>
      <Pressable
        style={settingsStyles.row}
        onPress={handleOpen}
        accessibilityRole="button"
        testID="host-page-pair-device-row"
      >
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.hostPage.pairDevice.rowTitle")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.hostPage.pairDevice.rowHint")}</Text>
        </View>
        <ThemedChevronRight uniProps={foregroundMutedSmIconMapping} />
      </Pressable>

      <PairDeviceModal
        visible={isModalOpen}
        onClose={handleClose}
        testID="host-page-pair-device-card"
      />
    </View>
  );
}

function RemoveHostSection({ host, onRemoved }: { host: HostProfile; onRemoved?: () => void }) {
  const { t } = useTranslation();
  const reportError = useUserVisibleErrorReporter();
  const { removeHost } = useHostMutations();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  const handleOpenConfirm = useCallback(() => setIsConfirming(true), []);
  const handleCloseConfirm = useCallback(() => {
    if (isRemoving) return;
    setIsConfirming(false);
  }, [isRemoving]);
  const handleCancel = useCallback(() => setIsConfirming(false), []);
  const handleConfirmRemove = useCallback(() => {
    setIsRemoving(true);
    void removeHost(host.serverId)
      .then(() => {
        setIsConfirming(false);
        onRemoved?.();
        return;
      })
      .catch((error) => {
        reportError({
          error,
          logLabel: "[HostPage] Failed to remove host",
          message: t("settings.hostPage.removeHost.failed"),
        });
      })
      .finally(() => setIsRemoving(false));
  }, [host.serverId, onRemoved, removeHost, reportError, t]);

  const removeIcon = useMemo(() => <ThemedTrash2 uniProps={destructiveSmIconMapping} />, []);

  return (
    <SettingsSection
      title={t("settings.hostPage.dangerZone.title")}
      testID="host-page-remove-host-card"
    >
      <RestartDaemonCard host={host} />

      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.hostPage.removeHost.rowTitle")}
            </Text>
            <Text style={settingsStyles.rowHint}>{t("settings.hostPage.removeHost.rowHint")}</Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            leftIcon={removeIcon}
            textStyle={styles.destructiveText}
            onPress={handleOpenConfirm}
            testID="host-page-remove-host-button"
          >
            {t("common.remove")}
          </Button>
        </View>
      </View>

      {isConfirming ? (
        <AdaptiveModalSheet
          header={RemoveHostSheetHeader(t)}
          visible
          onClose={handleCloseConfirm}
          testID="remove-host-confirm-modal"
        >
          <Text style={styles.confirmText}>
            {t("settings.hostPage.removeHost.confirmMessage", { host: host.label })}
          </Text>
          <View style={styles.confirmActions}>
            <Button
              variant="secondary"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleCancel}
              disabled={isRemoving}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleConfirmRemove}
              disabled={isRemoving}
              testID="remove-host-confirm"
            >
              {t("common.remove")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  identityEditButton: {
    width: 28,
    height: 28,
    padding: theme.spacing[1],
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  identityBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexWrap: "wrap",
    marginBottom: theme.spacing[6],
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
  },
  statusText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
  },
  // Connection-status color variants (selected via if-else on status tone).
  statusPillSuccess: {
    backgroundColor: theme.colors.statusSuccessBg,
  },
  statusPillWarning: {
    backgroundColor: theme.colors.statusWarningBg,
  },
  statusPillError: {
    backgroundColor: theme.colors.statusDangerBg,
  },
  statusPillDefault: {
    backgroundColor: "rgba(161, 161, 170, 0.1)",
  },
  statusDotSuccess: {
    backgroundColor: theme.colors.palette.green[400],
  },
  statusDotWarning: {
    backgroundColor: theme.colors.palette.amber[500],
  },
  statusDotError: {
    backgroundColor: theme.colors.destructive,
  },
  statusDotDefault: {
    backgroundColor: theme.colors.foregroundMuted,
  },
  statusTextSuccess: {
    color: theme.colors.palette.green[400],
  },
  statusTextWarning: {
    color: theme.colors.palette.amber[500],
  },
  statusTextError: {
    color: theme.colors.destructive,
  },
  statusTextDefault: {
    color: theme.colors.foregroundMuted,
  },
  destructiveText: {
    color: theme.colors.destructive,
  },
  // Soft quiet host badge.
  badgePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceWorkspace,
    maxWidth: 200,
  },
  badgeText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: 12.5,
    lineHeight: 16,
    marginBottom: theme.spacing[2],
  },
  connectionLatency: {
    fontSize: 13,
    lineHeight: 18,
    marginRight: theme.spacing[2],
  },
  connectionLatencyError: {
    color: theme.colors.palette.red[300],
  },
  connectionLatencyDefault: {
    color: theme.colors.foregroundMuted,
  },
  confirmText: {
    color: theme.colors.foregroundMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  confirmActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[4],
  },
  appendPromptActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
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
}));

const FLEX_1_STYLE = { flex: 1 };
const EMPTY_CARD_STYLE = [settingsStyles.card, styles.emptyCard];
