/* eslint-disable react-hooks/exhaustive-deps */
import React, { type ReactElement, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useToast } from "@/contexts/toast-context";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { ArrowUpRight, Copy, FileText, Activity } from "lucide-react-native";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedArrowUpRight = withUnistyles(ArrowUpRight);
const ThemedCopy = withUnistyles(Copy);
const ThemedFileText = withUnistyles(FileText);
const ThemedActivity = withUnistyles(Activity);
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { openExternalUrl } from "@/utils/open-external-url";
import { getCliDaemonStatus, shouldUseDesktopDaemon } from "@/desktop/daemon/desktop-daemon";
import { useBuiltInDaemonManagement } from "@/desktop/hooks/use-built-in-daemon-management";
import { useDaemonStatus } from "@/desktop/hooks/use-daemon-status";
import { useDesktopSettings, type DesktopSettings } from "@/desktop/settings/desktop-settings";
import { useTranslation } from "react-i18next";

type DesktopDaemonSettings = DesktopSettings["daemon"];

function useKeepRunningAfterQuitToggle(args: {
  settings: DesktopDaemonSettings;
  updateSettings: (next: Partial<DesktopDaemonSettings>) => Promise<unknown>;
}) {
  const { settings, updateSettings } = args;
  const [isUpdatingKeepRunningAfterQuit, setIsUpdatingKeepRunningAfterQuit] = useState(false);

  const handleToggleKeepRunningAfterQuit = useCallback(() => {
    setIsUpdatingKeepRunningAfterQuit(true);
    void updateSettings({ keepRunningAfterQuit: !settings.keepRunningAfterQuit })
      .catch(() => {
        // useDesktopSettings owns the user-visible IPC error.
      })
      .finally(() => {
        setIsUpdatingKeepRunningAfterQuit(false);
      });
  }, [settings.keepRunningAfterQuit, updateSettings]);

  return { isUpdatingKeepRunningAfterQuit, handleToggleKeepRunningAfterQuit };
}

function useDaemonCliStatusModal() {
  const { t } = useTranslation();
  const toast = useToast();
  const [cliStatusOutput, setCliStatusOutput] = useState<string | null>(null);
  const [isCliStatusModalOpen, setIsCliStatusModalOpen] = useState(false);
  const [isLoadingCliStatus, setIsLoadingCliStatus] = useState(false);

  const handleOpenCliStatus = useCallback(async () => {
    setIsLoadingCliStatus(true);
    try {
      setCliStatusOutput(await getCliDaemonStatus());
      setIsCliStatusModalOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCliStatusOutput(t("settings.daemon.copyStatusFailed", { message }));
      setIsCliStatusModalOpen(true);
    } finally {
      setIsLoadingCliStatus(false);
    }
  }, [t]);

  const handleCopyCliStatus = useCallback(() => {
    if (!cliStatusOutput) {
      return;
    }
    void Clipboard.setStringAsync(cliStatusOutput)
      .then(() => {
        toast.show(t("settings.daemon.copiedStatus"), { variant: "success" });
        return;
      })
      .catch((error) => {
        console.error("[Settings] Failed to copy daemon status", error);
      });
  }, [cliStatusOutput, toast, t]);

  const handleCloseCliStatusModal = useCallback(() => setIsCliStatusModalOpen(false), []);

  return {
    cliStatusOutput,
    isCliStatusModalOpen,
    isLoadingCliStatus,
    handleCopyCliStatus,
    handleOpenCliStatus,
    handleCloseCliStatusModal,
  };
}

function useDaemonLogsModal(daemonLogs: { logPath?: string } | null) {
  const { t } = useTranslation();
  const toast = useToast();
  const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);

  const handleCopyLogPath = useCallback(() => {
    const logPath = daemonLogs?.logPath;
    if (!logPath) {
      return;
    }

    void Clipboard.setStringAsync(logPath)
      .then(() => {
        toast.show(t("settings.daemon.copiedLogPath"), { variant: "success" });
        return;
      })
      .catch((error) => {
        console.error("[Settings] Failed to copy log path", error);
        toast.error(t("settings.daemon.copyLogPathFailed"));
      });
  }, [daemonLogs?.logPath, toast, t]);

  const handleOpenLogs = useCallback(() => {
    if (!daemonLogs) {
      return;
    }
    setIsLogsModalOpen(true);
  }, [daemonLogs]);

  const handleCloseLogsModal = useCallback(() => setIsLogsModalOpen(false), []);

  return { isLogsModalOpen, handleCopyLogPath, handleOpenLogs, handleCloseLogsModal };
}

interface DaemonLogsModalProps {
  visible: boolean;
  onClose: () => void;
  daemonLogs: { logPath?: string; contents?: string } | null;
}

function DaemonLogsModal({ visible, onClose, daemonLogs }: DaemonLogsModalProps) {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(() => ({ title: t("settings.daemon.logsTitle") }), [t]);
  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      testID="managed-daemon-logs-dialog"
      snapPoints={LOGS_MODAL_SNAP_POINTS}
    >
      <View style={styles.modalBody}>
        <Text style={settingsStyles.rowHint}>
          {daemonLogs?.logPath ?? t("settings.daemon.logPathUnavailable")}
        </Text>
        <Text style={styles.logOutput} selectable>
          {daemonLogs?.contents?.length ? daemonLogs.contents : t("settings.daemon.logEmpty")}
        </Text>
      </View>
    </AdaptiveModalSheet>
  );
}

interface DaemonCliStatusModalProps {
  visible: boolean;
  onClose: () => void;
  cliStatusOutput: string | null;
  onCopy: () => void;
}

function DaemonCliStatusModal({
  visible,
  onClose,
  cliStatusOutput,
  onCopy,
}: DaemonCliStatusModalProps) {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(() => ({ title: t("settings.daemon.statusTitle") }), [t]);
  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      testID="daemon-cli-status-dialog"
      snapPoints={CLI_STATUS_MODAL_SNAP_POINTS}
    >
      <View style={styles.modalBody}>
        <Text style={styles.logOutput} selectable>
          {cliStatusOutput ?? ""}
        </Text>
        <View style={styles.modalActions}>
          <Button variant="outline" size="sm" onPress={onClose}>
            {t("common.close")}
          </Button>
          <Button size="sm" onPress={onCopy}>
            {t("common.copy")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

interface DaemonInfoCardProps {
  daemonStatusStateText: string;
  daemonStatusDetailText: string;
  isDaemonManagementPaused: boolean;
  copyIcon: ReactElement;
  fileTextIcon: ReactElement;
  activityIcon: ReactElement;
  handleToggleDaemonManagement: () => void;
  isUpdatingDaemonManagement: boolean;
  keepRunningAfterQuit: boolean;
  handleToggleKeepRunningAfterQuit: () => void;
  isUpdatingKeepRunningAfterQuit: boolean;
  daemonLogs: { logPath?: string } | null;
  handleCopyLogPath: () => void;
  handleOpenLogs: () => void;
  handleRunCliStatus: () => void;
  isLoadingCliStatus: boolean;
}

function DaemonInfoCard(props: DaemonInfoCardProps) {
  const { t } = useTranslation();
  const {
    daemonStatusStateText,
    daemonStatusDetailText,
    isDaemonManagementPaused,
    copyIcon,
    fileTextIcon,
    activityIcon,
    handleToggleDaemonManagement,
    isUpdatingDaemonManagement,
    keepRunningAfterQuit,
    handleToggleKeepRunningAfterQuit,
    isUpdatingKeepRunningAfterQuit,
    daemonLogs,
    handleCopyLogPath,
    handleOpenLogs,
    handleRunCliStatus,
    isLoadingCliStatus,
  } = props;

  return (
    <View style={settingsStyles.card}>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.daemon.status")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.daemon.builtInOnly")}</Text>
        </View>
        <View style={styles.statusValueGroup}>
          <Text style={styles.valueText}>{daemonStatusStateText}</Text>
          <Text style={styles.valueSubtext}>{daemonStatusDetailText}</Text>
        </View>
      </View>
      <View style={ROW_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.daemon.manageBuiltIn")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.daemon.manageBuiltInHint")}</Text>
        </View>
        <Switch
          value={!isDaemonManagementPaused}
          onValueChange={handleToggleDaemonManagement}
          disabled={isUpdatingDaemonManagement}
          accessibilityLabel={t("settings.daemon.manageBuiltIn")}
        />
      </View>
      <View style={ROW_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.daemon.keepRunningAfterQuit")}</Text>
          <Text style={settingsStyles.rowHint}>
            {t("settings.daemon.keepRunningAfterQuitHint")}
          </Text>
        </View>
        <Switch
          value={keepRunningAfterQuit}
          onValueChange={handleToggleKeepRunningAfterQuit}
          disabled={isUpdatingKeepRunningAfterQuit}
          accessibilityLabel={t("settings.daemon.keepRunningAfterQuit")}
        />
      </View>
      <View style={ROW_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.daemon.logs")}</Text>
          <Text style={settingsStyles.rowHint}>
            {daemonLogs?.logPath ?? t("settings.daemon.logPathUnavailable")}
          </Text>
        </View>
        <View style={styles.actionGroup}>
          {daemonLogs?.logPath ? (
            <Button variant="outline" size="sm" leftIcon={copyIcon} onPress={handleCopyLogPath}>
              {t("settings.daemon.copyPath")}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            leftIcon={fileTextIcon}
            onPress={handleOpenLogs}
            disabled={!daemonLogs}
          >
            {t("settings.daemon.openLogs")}
          </Button>
        </View>
      </View>
      <View style={ROW_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.daemon.fullStatus")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.daemon.fullStatusHint")}</Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          leftIcon={activityIcon}
          onPress={handleRunCliStatus}
          disabled={isLoadingCliStatus}
        >
          {isLoadingCliStatus
            ? t("settings.daemon.loadingStatus")
            : t("settings.daemon.viewStatus")}
        </Button>
      </View>
    </View>
  );
}

export function LocalDaemonSection() {
  const { t } = useTranslation();
  const showSection = shouldUseDesktopDaemon();
  const { settings, updateSettings, isLoading: isLoadingSettings } = useDesktopSettings();
  const daemonSettings = settings.daemon;
  const updateDaemonSettings = useCallback(
    (updates: Partial<DesktopDaemonSettings>) => updateSettings({ daemon: updates }),
    [updateSettings],
  );
  const { data, isLoading, error: statusError, setStatus, refetch } = useDaemonStatus();

  const daemonStatus = data?.status ?? null;
  const daemonLogs = data?.logs ?? null;

  const daemonStatusStateText =
    statusError ??
    (daemonStatus?.status === "running"
      ? t("settings.daemon.running")
      : t("settings.daemon.notRunning"));
  const daemonStatusDetailText = `PID ${daemonStatus?.pid ? daemonStatus.pid : "—"}`;
  const isDaemonManagementPaused = !daemonSettings.manageBuiltInDaemon;

  const { isUpdating: isUpdatingDaemonManagement, toggle: handleToggleDaemonManagement } =
    useBuiltInDaemonManagement({
      daemonStatus,
      settings: daemonSettings,
      updateSettings: updateDaemonSettings,
      setStatus,
      refreshStatus: refetch,
    });
  const { isUpdatingKeepRunningAfterQuit, handleToggleKeepRunningAfterQuit } =
    useKeepRunningAfterQuitToggle({
      settings: daemonSettings,
      updateSettings: updateDaemonSettings,
    });

  const { isLogsModalOpen, handleCopyLogPath, handleOpenLogs, handleCloseLogsModal } =
    useDaemonLogsModal(daemonLogs);

  const {
    cliStatusOutput,
    isCliStatusModalOpen,
    isLoadingCliStatus,
    handleCopyCliStatus,
    handleOpenCliStatus,
    handleCloseCliStatusModal,
  } = useDaemonCliStatusModal();
  const handleRunCliStatus = useCallback(() => {
    void handleOpenCliStatus();
  }, [handleOpenCliStatus]);

  const handleOpenAdvancedSettings = useCallback(
    () => void openExternalUrl(ADVANCED_DAEMON_SETTINGS_URL),
    [],
  );

  const advancedSettingsIcon = useMemo(
    () => <ThemedArrowUpRight size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />,
    [],
  );
  const copyIcon = useMemo(
    () => <ThemedCopy size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />,
    [],
  );
  const fileTextIcon = useMemo(
    () => <ThemedFileText size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />,
    [],
  );
  const activityIcon = useMemo(
    () => <ThemedActivity size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />,
    [],
  );

  const advancedSettingsButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={advancedSettingsIcon}
        textStyle={settingsStyles.sectionHeaderLinkText}
        style={settingsStyles.sectionHeaderLink}
        onPress={handleOpenAdvancedSettings}
        accessibilityLabel={t("settings.daemon.openAdvancedSettings")}
      >
        {t("settings.daemon.advancedSettings")}
      </Button>
    ),
    [advancedSettingsIcon, handleOpenAdvancedSettings, t],
  );

  if (!showSection) {
    return null;
  }

  return (
    <SettingsSection
      title={t("settings.daemon.title")}
      trailing={advancedSettingsButton}
      testID="host-page-daemon-lifecycle-card"
    >
      {isLoading || isLoadingSettings ? (
        <View style={LOADING_CARD_STYLE}>
          <ThemedActivityIndicator size="small" uniProps={foregroundMutedColorMapping} />
        </View>
      ) : (
        <DaemonInfoCard
          daemonStatusStateText={daemonStatusStateText}
          daemonStatusDetailText={daemonStatusDetailText}
          isDaemonManagementPaused={isDaemonManagementPaused}
          copyIcon={copyIcon}
          fileTextIcon={fileTextIcon}
          activityIcon={activityIcon}
          handleToggleDaemonManagement={handleToggleDaemonManagement}
          isUpdatingDaemonManagement={isUpdatingDaemonManagement}
          keepRunningAfterQuit={daemonSettings.keepRunningAfterQuit}
          handleToggleKeepRunningAfterQuit={handleToggleKeepRunningAfterQuit}
          isUpdatingKeepRunningAfterQuit={isUpdatingKeepRunningAfterQuit}
          daemonLogs={daemonLogs}
          handleCopyLogPath={handleCopyLogPath}
          handleOpenLogs={handleOpenLogs}
          handleRunCliStatus={handleRunCliStatus}
          isLoadingCliStatus={isLoadingCliStatus}
        />
      )}

      <DaemonLogsModal
        visible={isLogsModalOpen}
        onClose={handleCloseLogsModal}
        daemonLogs={daemonLogs}
      />

      <DaemonCliStatusModal
        visible={isCliStatusModalOpen}
        onClose={handleCloseCliStatusModal}
        cliStatusOutput={cliStatusOutput}
        onCopy={handleCopyCliStatus}
      />
    </SettingsSection>
  );
}

const ADVANCED_DAEMON_SETTINGS_URL = "https://chisacode.sh/docs/configuration";

const styles = StyleSheet.create((theme) => ({
  actionGroup: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  loadingCard: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[6],
  },
  statusValueGroup: {
    alignItems: "flex-end",
    gap: 2,
  },
  valueText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  valueSubtext: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  modalBody: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  logOutput: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    lineHeight: 18,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
}));

const LOADING_CARD_STYLE = [settingsStyles.card, styles.loadingCard];
const ROW_WITH_BORDER_STYLE = [settingsStyles.row, settingsStyles.rowBorder];
const LOGS_MODAL_SNAP_POINTS = ["70%", "92%"];
const CLI_STATUS_MODAL_SNAP_POINTS = ["60%", "85%"];
