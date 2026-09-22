import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { ArrowUpRight, Terminal, Blocks, Check, Download } from "lucide-react-native";
import { settingsStyles } from "@/styles/settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { getProviderIcon } from "@/components/provider-icons";
import { openExternalUrl } from "@/utils/open-external-url";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  shouldUseDesktopDaemon,
  type SkillOp,
  type SkillsStatus,
} from "@/desktop/daemon/desktop-daemon";
import { useCliInstall, useSkillsStatus } from "@/desktop/hooks/use-install-status";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useToast } from "@/contexts/toast-context";
import {
  getAcpProviderCatalog,
  type AcpProviderCatalogItem,
} from "@/hooks/use-acp-provider-catalog";
import { useTranslation } from "react-i18next";
import type { ProviderSnapshotEntry } from "@chisacode/protocol/agent-types";

const ThemedArrowUpRight = withUnistyles(ArrowUpRight);
const ThemedTerminal = withUnistyles(Terminal);
const ThemedBlocks = withUnistyles(Blocks);
const ThemedCheck = withUnistyles(Check);
const ThemedDownload = withUnistyles(Download);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const CLI_DOCS_URL = "https://github.com/ChisaAlter/ChisaCode/blob/cn-main/docs/cli.md";
const SKILLS_DOCS_URL = "https://github.com/ChisaAlter/ChisaCode/blob/cn-main/docs/skills.md";
const ROW_WITH_BORDER_STYLE = [settingsStyles.row, settingsStyles.rowBorder];

const OP_KIND_ORDER: Record<SkillOp["kind"], number> = { add: 0, update: 1, delete: 2 };

export type AgentToolAction = "check" | "install" | "update" | "reinstall";
type AgentToolStatus = "checking" | "not-installed" | "current" | "outdated" | "unknown";
type AgentToolVersionValue = string | "not-installed" | "not-checked" | "unknown";

export interface AgentToolVersionView {
  currentVersion: AgentToolVersionValue;
  latestVersion: AgentToolVersionValue;
  status: AgentToolStatus;
  actions: AgentToolAction[];
  checkedAt: string | null;
}

function formatUpdateMessage(
  ops: readonly SkillOp[],
  labels: Record<SkillOp["kind"], string>,
): string {
  const sorted = [...ops].sort((a, b) => {
    const kindOrder = OP_KIND_ORDER[a.kind] - OP_KIND_ORDER[b.kind];
    return kindOrder !== 0 ? kindOrder : a.name.localeCompare(b.name);
  });
  return sorted.map((op) => `${labels[op.kind]} ${op.name}`).join("\n");
}

export function IntegrationsSection() {
  const { t } = useTranslation();
  const showSection = shouldUseDesktopDaemon();
  const {
    status: cliStatus,
    isInstalling: isInstallingCli,
    install: installCli,
    refresh: refreshCliStatus,
  } = useCliInstall();
  const {
    status: skillsStatus,
    isWorking: isSkillsWorking,
    install: installSkills,
    update: updateSkills,
    uninstall: uninstallSkills,
    refresh: refreshSkillsStatus,
  } = useSkillsStatus();

  useFocusEffect(
    useCallback(() => {
      if (!showSection) return undefined;
      refreshCliStatus();
      void refreshSkillsStatus();
      return undefined;
    }, [refreshCliStatus, refreshSkillsStatus, showSection]),
  );

  const handleInstallCli = useCallback(() => {
    if (isInstallingCli) return;
    installCli();
  }, [installCli, isInstallingCli]);

  const handleInstallSkills = useCallback(() => {
    if (isSkillsWorking) return;
    void installSkills();
  }, [installSkills, isSkillsWorking]);

  const handleUpdateSkills = useCallback(async () => {
    if (isSkillsWorking) return;
    const ops = skillsStatus?.ops ?? [];
    const confirmed = await confirmDialog({
      title: t("settings.integrations.updateSkillsTitle"),
      message:
        ops.length > 0
          ? formatUpdateMessage(ops, {
              add: t("settings.integrations.opAdd"),
              update: t("settings.integrations.opUpdate"),
              delete: t("settings.integrations.opDelete"),
            })
          : t("settings.integrations.syncBundledSkills"),
      confirmLabel: t("settings.integrations.update"),
    });
    if (!confirmed) return;
    await updateSkills();
  }, [isSkillsWorking, skillsStatus, updateSkills, t]);

  const handleUninstallSkills = useCallback(async () => {
    if (isSkillsWorking) return;
    const confirmed = await confirmDialog({
      title: t("settings.integrations.uninstallSkillsTitle"),
      message: t("settings.integrations.uninstallSkillsMessage"),
      confirmLabel: t("settings.integrations.uninstall"),
      destructive: true,
    });
    if (!confirmed) return;
    await uninstallSkills();
  }, [isSkillsWorking, uninstallSkills, t]);

  const handleOpenCliDocs = useCallback(() => {
    void openExternalUrl(CLI_DOCS_URL);
  }, []);

  const handleOpenSkillsDocs = useCallback(() => {
    void openExternalUrl(SKILLS_DOCS_URL);
  }, []);

  const arrowIcon = useMemo(
    () => <ThemedArrowUpRight size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />,
    [],
  );

  const trailing = useMemo(
    () => (
      <View style={styles.headerLinks}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={arrowIcon}
          textStyle={settingsStyles.sectionHeaderLinkText}
          style={settingsStyles.sectionHeaderLink}
          onPress={handleOpenCliDocs}
          accessibilityLabel={t("settings.integrations.openCliDocs")}
        >
          {t("settings.integrations.cliDocs")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={arrowIcon}
          textStyle={settingsStyles.sectionHeaderLinkText}
          style={settingsStyles.sectionHeaderLink}
          onPress={handleOpenSkillsDocs}
          accessibilityLabel={t("settings.integrations.openSkillsDocs")}
        >
          {t("settings.integrations.skillsDocs")}
        </Button>
      </View>
    ),
    [arrowIcon, handleOpenCliDocs, handleOpenSkillsDocs, t],
  );

  if (!showSection) {
    return null;
  }

  const skillsState = skillsStatus?.state ?? null;

  return (
    <>
      <SettingsSection title={t("settings.integrations.title")} trailing={trailing}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <View style={styles.rowTitleRow}>
                <ThemedTerminal size={ICON_SIZE.md} uniProps={foregroundColorMapping} />
                <Text style={settingsStyles.rowTitle}>
                  {t("settings.integrations.commandLine")}
                </Text>
              </View>
              <Text style={settingsStyles.rowHint}>
                {t("settings.integrations.commandLineHint")}
              </Text>
            </View>
            {cliStatus?.installed ? (
              <View style={styles.installedLabel}>
                <ThemedCheck size={14} uniProps={foregroundMutedColorMapping} />
                <Text style={styles.mutedText}>{t("settings.integrations.installed")}</Text>
              </View>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onPress={handleInstallCli}
                disabled={isInstallingCli}
              >
                {isInstallingCli
                  ? t("settings.integrations.installing")
                  : t("settings.integrations.install")}
              </Button>
            )}
          </View>
          <View style={ROW_WITH_BORDER_STYLE}>
            <View style={settingsStyles.rowContent}>
              <View style={styles.rowTitleRow}>
                <ThemedBlocks size={ICON_SIZE.md} uniProps={foregroundColorMapping} />
                <Text style={settingsStyles.rowTitle}>
                  {t("settings.integrations.orchestrationSkills")}
                </Text>
              </View>
              <Text style={settingsStyles.rowHint}>
                {skillsState === "drift"
                  ? t("settings.integrations.skillsDriftHint")
                  : t("settings.integrations.skillsUpToDateHint")}
              </Text>
            </View>
            <SkillsActions
              state={skillsState}
              isWorking={isSkillsWorking}
              onInstall={handleInstallSkills}
              onUpdate={handleUpdateSkills}
              onUninstall={handleUninstallSkills}
            />
          </View>
        </View>
      </SettingsSection>
      <AgentToolsSection />
    </>
  );
}

interface SkillsActionsProps {
  state: SkillsStatus["state"] | null;
  isWorking: boolean;
  onInstall: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
}

function SkillsActions({ state, isWorking, onInstall, onUpdate, onUninstall }: SkillsActionsProps) {
  const { t } = useTranslation();

  if (state === "up-to-date") {
    return (
      <View style={styles.actionsRow}>
        <View style={styles.installedLabel}>
          <ThemedCheck size={14} uniProps={foregroundMutedColorMapping} />
          <Text style={styles.mutedText}>{t("settings.integrations.installed")}</Text>
        </View>
        <Button variant="outline" size="sm" onPress={onUninstall} disabled={isWorking}>
          {t("settings.integrations.uninstall")}
        </Button>
      </View>
    );
  }

  if (state === "drift") {
    return (
      <View style={styles.actionsRow}>
        <Button variant="outline" size="sm" onPress={onUpdate} disabled={isWorking}>
          {isWorking ? t("settings.integrations.updating") : t("settings.integrations.update")}
        </Button>
        <Button variant="outline" size="sm" onPress={onUninstall} disabled={isWorking}>
          {t("settings.integrations.uninstall")}
        </Button>
      </View>
    );
  }

  return (
    <Button variant="outline" size="sm" onPress={onInstall} disabled={isWorking}>
      {isWorking ? t("settings.integrations.installing") : t("settings.integrations.install")}
    </Button>
  );
}

function cleanVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function hasInstalledVersion(entry: ProviderSnapshotEntry): boolean {
  return cleanVersion(entry.installedVersion) !== null;
}

export function getAgentToolVersionView(
  entry: ProviderSnapshotEntry | undefined,
): AgentToolVersionView {
  if (!entry) {
    return {
      currentVersion: "unknown",
      latestVersion: "not-checked",
      status: "checking",
      actions: ["check"],
      checkedAt: null,
    };
  }

  const installedVersion = cleanVersion(entry.installedVersion);
  const latestVersion = cleanVersion(entry.latestVersion);
  const resolvedLatestVersion =
    latestVersion ?? (installedVersion !== null || entry.checkedAt ? "unknown" : "not-checked");
  const isNotInstalled =
    entry.status === "unavailable" ||
    entry.versionStatus === "not-installed" ||
    (entry.installAvailable === true && installedVersion === null);

  if (isNotInstalled) {
    return {
      currentVersion: "not-installed",
      latestVersion: resolvedLatestVersion,
      status: "not-installed",
      actions: ["check", "install"],
      checkedAt: entry.checkedAt ?? null,
    };
  }

  if (entry.versionStatus === "outdated" || entry.updateAvailable === true) {
    return {
      currentVersion: installedVersion ?? "unknown",
      latestVersion: resolvedLatestVersion,
      status: "outdated",
      actions: ["check", "update", "reinstall"],
      checkedAt: entry.checkedAt ?? null,
    };
  }

  if (entry.versionStatus === "current") {
    return {
      currentVersion: installedVersion ?? "unknown",
      latestVersion: resolvedLatestVersion,
      status: "current",
      actions: ["check", "reinstall"],
      checkedAt: entry.checkedAt ?? null,
    };
  }

  return {
    currentVersion: installedVersion ?? "unknown",
    latestVersion: resolvedLatestVersion,
    status: "unknown",
    actions: ["check", hasInstalledVersion(entry) ? "reinstall" : "install"],
    checkedAt: entry.checkedAt ?? null,
  };
}

function formatAgentToolVersion(
  version: AgentToolVersionValue,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (version === "not-installed") return t("providers.notInstalled");
  if (version === "not-checked") return t("settings.integrations.versionNotChecked");
  if (version === "unknown") return t("settings.integrations.versionUnknown");
  return version.startsWith("v") ? version : `v${version}`;
}

function getAgentToolStatusLabel(
  status: AgentToolStatus,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (status) {
    case "checking":
      return t("settings.integrations.checkingLatestVersion");
    case "not-installed":
      return t("providers.notInstalled");
    case "current":
      return t("settings.integrations.versionCurrent");
    case "outdated":
      return t("settings.integrations.versionOutdated");
    case "unknown":
      return t("settings.integrations.versionUnknown");
  }
}

function formatCheckedAt(
  checkedAt: string | null,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  if (!checkedAt) return null;
  const date = new Date(checkedAt);
  if (Number.isNaN(date.getTime())) return null;
  return t("settings.integrations.checkedAt", {
    time: date.toLocaleString(),
  });
}

interface AgentToolRowProps {
  catalogEntry: AcpProviderCatalogItem;
  providerEntry: ProviderSnapshotEntry | undefined;
  isFirst: boolean;
  isWorking: boolean;
  onCheck: (providerId: string) => void;
  onToolingAction: (providerId: string, action: "install" | "update" | "reinstall") => void;
}

function AgentToolRow({
  catalogEntry,
  providerEntry,
  isFirst,
  isWorking,
  onCheck,
  onToolingAction,
}: AgentToolRowProps) {
  const { t } = useTranslation();
  const ProviderIcon = getProviderIcon(catalogEntry.id);
  const ThemedProviderIcon = useMemo(() => withUnistyles(ProviderIcon), [ProviderIcon]);
  const versionView = getAgentToolVersionView(providerEntry);
  const rowStyle = useMemo(
    () => [settingsStyles.row, !isFirst && settingsStyles.rowBorder],
    [isFirst],
  );
  const status = getAgentToolStatusLabel(versionView.status, t);
  const currentVersion = formatAgentToolVersion(versionView.currentVersion, t);
  const latestVersion = formatAgentToolVersion(versionView.latestVersion, t);
  const checkedAt = formatCheckedAt(versionView.checkedAt, t);
  const hasAction = useCallback(
    (action: AgentToolAction) => versionView.actions.includes(action),
    [versionView.actions],
  );
  const handleCheck = useCallback(() => onCheck(catalogEntry.id), [catalogEntry.id, onCheck]);
  const handleInstall = useCallback(
    () => onToolingAction(catalogEntry.id, "install"),
    [catalogEntry.id, onToolingAction],
  );
  const handleUpdate = useCallback(
    () => onToolingAction(catalogEntry.id, "update"),
    [catalogEntry.id, onToolingAction],
  );
  const handleReinstall = useCallback(
    () => onToolingAction(catalogEntry.id, "reinstall"),
    [catalogEntry.id, onToolingAction],
  );
  const downloadIcon = useMemo(
    () => <ThemedDownload size={14} uniProps={foregroundColorMapping} />,
    [],
  );

  return (
    <View style={rowStyle} accessibilityLabel={`${catalogEntry.title} agent tool`}>
      <View style={settingsStyles.rowContent}>
        <View style={styles.rowTitleRow}>
          <ThemedProviderIcon size={ICON_SIZE.md} uniProps={foregroundColorMapping} />
          <Text style={settingsStyles.rowTitle}>{catalogEntry.title}</Text>
        </View>
        <View style={styles.versionColumn}>
          <Text style={settingsStyles.rowHint}>
            {t("settings.integrations.currentVersion", { version: currentVersion })}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {t("settings.integrations.latestVersion", { version: latestVersion })}
          </Text>
          <Text style={styles.statusText}>{status}</Text>
          {checkedAt ? <Text style={styles.checkedAtText}>{checkedAt}</Text> : null}
        </View>
      </View>
      <View style={styles.actionsRow}>
        {isWorking ? (
          <ThemedLoadingSpinner size={14} uniProps={foregroundMutedColorMapping} />
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onPress={handleCheck}
          disabled={isWorking}
          accessibilityLabel={t("settings.integrations.checkAgentLatestVersion", {
            provider: catalogEntry.title,
          })}
        >
          {t("settings.integrations.checkLatestVersion")}
        </Button>
        {hasAction("update") ? (
          <Button
            variant="outline"
            size="sm"
            onPress={handleUpdate}
            disabled={isWorking}
            accessibilityLabel={t("settings.integrations.updateAgentTool", {
              provider: catalogEntry.title,
            })}
          >
            {t("providers.update")}
          </Button>
        ) : null}
        {hasAction("install") ? (
          <Button
            variant="outline"
            size="sm"
            leftIcon={downloadIcon}
            onPress={handleInstall}
            disabled={isWorking}
            accessibilityLabel={t("settings.integrations.installAgentTool", {
              provider: catalogEntry.title,
            })}
          >
            {t("providers.install")}
          </Button>
        ) : null}
        {hasAction("reinstall") ? (
          <Button
            variant="outline"
            size="sm"
            onPress={handleReinstall}
            disabled={isWorking}
            accessibilityLabel={t("settings.integrations.reinstallAgentTool", {
              provider: catalogEntry.title,
            })}
          >
            {t("settings.integrations.reinstall")}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

function AgentToolsSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const localServerId = useLocalDaemonServerId();
  const client = useHostRuntimeClient(localServerId ?? "");
  const isConnected = useHostRuntimeIsConnected(localServerId ?? "");
  const { entries, refresh } = useProvidersSnapshot(localServerId, {
    enabled: Boolean(localServerId),
  });
  const [workingProviderId, setWorkingProviderId] = useState<string | null>(null);
  const [checkingProviderId, setCheckingProviderId] = useState<string | null>(null);
  const catalogEntries = useMemo(() => getAcpProviderCatalog(), []);
  const entryByProvider = useMemo(
    () => new Map((entries ?? []).map((entry) => [entry.provider, entry])),
    [entries],
  );
  const handleCheck = useCallback(
    (providerId: string) => {
      if (checkingProviderId || workingProviderId) return;
      setCheckingProviderId(providerId);
      void refresh([providerId]).finally(() => {
        setCheckingProviderId((current) => (current === providerId ? null : current));
      });
    },
    [checkingProviderId, refresh, workingProviderId],
  );
  const handleToolingAction = useCallback(
    (providerId: string, action: "install" | "update" | "reinstall") => {
      if (!client || workingProviderId || checkingProviderId) return;
      setWorkingProviderId(providerId);
      void client
        .runProviderToolingAction(providerId, action)
        .then((result) => {
          if (!result.success) {
            toast.error(result.stderr || result.stdout || t("providers.installFailed"));
          }
          return refresh([providerId]);
        })
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          setWorkingProviderId((current) => (current === providerId ? null : current));
        });
    },
    [checkingProviderId, client, refresh, toast, t, workingProviderId],
  );

  return (
    <SettingsSection title={t("settings.integrations.agentTools")}>
      {!localServerId || !isConnected ? (
        <View style={EMPTY_CARD_STYLE}>
          <Text style={styles.emptyText}>{t("settings.integrations.connectLocalDaemon")}</Text>
        </View>
      ) : (
        <View style={settingsStyles.card}>
          {catalogEntries.map((catalogEntry, index) => (
            <AgentToolRow
              key={catalogEntry.id}
              catalogEntry={catalogEntry}
              providerEntry={entryByProvider.get(catalogEntry.id)}
              isFirst={index === 0}
              isWorking={
                workingProviderId === catalogEntry.id || checkingProviderId === catalogEntry.id
              }
              onCheck={handleCheck}
              onToolingAction={handleToolingAction}
            />
          ))}
        </View>
      )}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  headerLinks: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[0],
  },
  rowTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  installedLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  versionColumn: {
    gap: theme.spacing[1],
  },
  statusText: {
    color: theme.colors.foreground,
    fontSize: 12.5,
    lineHeight: 16,
  },
  checkedAtText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    // Soft empty integrations: 12.5 muted.
    fontSize: 12.5,
    lineHeight: 18,
  },
}));

const EMPTY_CARD_STYLE = [settingsStyles.card, styles.emptyCard];
