import { Fragment, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ComponentType, ReactNode } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type PressableStateCallbackType,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Buffer } from "buffer";
import {
  ArrowLeft,
  Monitor,
  ChevronDown,
  Sun,
  Server,
  Keyboard,
  Activity,
  Info,
  Shield,
  Zap,
  Plus,
  Folder,
  Brain,
  Wrench,
  ChartNoAxesCombined,
  MessageSquare,
  Copy,
} from "lucide-react-native";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { SidebarSeparator } from "@/components/sidebar/sidebar-separator";
import { ScreenTitle } from "@/components/headers/screen-title";
import { HeaderIconBadge } from "@/components/headers/header-icon-badge";
import { ThemedIconHost } from "@/components/themed-icon-host";
import { SettingsSection } from "@/screens/settings/settings-section";
import {
  useSettings,
  parseTerminalScrollbackLines,
  type AppLanguage,
  type AppSettings,
  type SendBehavior,
  type ServiceUrlBehavior,
  type Settings as EffectiveSettings,
} from "@/hooks/use-settings";
import { THEME_PICKER_OPTIONS, THEME_PREVIEWS, ICON_SIZE, type ThemeName } from "@/styles/theme";
import type { Theme } from "@/styles/theme";
import {
  getHostRuntimeStore,
  isHostRuntimeConnected,
  useHostRuntimeIsConnected,
  useHostRuntimeClient,
  useHosts,
} from "@/runtime/host-runtime";
import type { HostProfile } from "@/types/host-connection";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import { confirmDialog } from "@/utils/confirm-dialog";
import { BackHeader } from "@/components/headers/back-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { AddHostMethodModal } from "@/components/add-host-method-modal";
import { AddHostModal } from "@/components/add-host-modal";
import { PairLinkModal } from "@/components/pair-link-modal";
import { KeyboardShortcutsSection } from "@/screens/settings/keyboard-shortcuts-section";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DesktopPermissionsSection } from "@/desktop/components/desktop-permissions-section";
import { IntegrationsSection } from "@/desktop/components/integrations-section";
import { isElectronRuntime } from "@/desktop/host";
import { useDesktopAppUpdater } from "@/desktop/updates/use-desktop-app-updater";
import {
  checkGitHubReleaseUpdate,
  type GitHubReleaseUpdateResult,
} from "@/updates/github-release-updates";
import { settingsStyles } from "@/styles/settings";
import { THINKING_TONE_NATIVE_PCM_BASE64 } from "@/utils/thinking-tone.native-pcm";
import { useVoiceAudioEngineOptional } from "@/contexts/voice-context";
import { HostPage, HostRenameButton } from "@/screens/settings/host-page";
import { CustomModelProvidersSection } from "@/screens/settings/custom-model-providers-section";
import { SyntheticModelsSection } from "@/screens/settings/synthetic-models-section";
import { VisionFallbackSection } from "@/screens/settings/vision-fallback-section";
import { SkillsSection } from "@/screens/settings/skills-section";
import { McpServersSection } from "@/screens/settings/mcp-servers-section";
import { UsageStatisticsSection } from "@/screens/settings/usage-statistics-section";
import ProjectsScreen from "@/screens/projects-screen";
import ProjectSettingsScreen from "@/screens/project-settings-screen";
import {
  SETTINGS_CONTROL_HEIGHT,
  SETTINGS_DESKTOP_CONTENT_OUTER_MAX_WIDTH,
  SETTINGS_DESKTOP_HEADER_HEIGHT,
  SETTINGS_DESKTOP_SIDEBAR_WIDTH,
  SETTINGS_INPUT_WIDTH,
  useIsCompactFormFactor,
} from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useWebScrollbarStyle } from "@/hooks/use-web-scrollbar-style";
import { resolveAppVersion } from "@/utils/app-version";
import { openExternalUrl } from "@/utils/open-external-url";
import { useToast } from "@/contexts/toast-context";
import { getDesktopDaemonLogs } from "@/desktop/daemon/desktop-daemon";
import { downloadTextFile } from "@/utils/download-text-file";
import {
  buildHostOpenProjectRoute,
  buildProjectsSettingsRoute,
  buildSettingsHostRoute,
  buildSettingsRoute,
  buildSettingsSectionRoute,
  normalizeSettingsReturnToRoute,
  type SettingsSectionSlug,
} from "@/utils/host-routes";
import { navigateToLastWorkspace } from "@/stores/navigation-active-workspace-store";

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export type SettingsView =
  | { kind: "root" }
  | { kind: "section"; section: SettingsSectionSlug }
  | { kind: "host"; serverId: string }
  | { kind: "projects" }
  | { kind: "project"; projectKey: string };

interface SidebarSectionItem {
  id: SettingsSectionSlug;
  labelKey: string;
  icon: ComponentType<{ size: number; color: string }>;
  desktopOnly?: boolean;
}

const SIDEBAR_SECTION_ITEMS: SidebarSectionItem[] = [
  { id: "general", labelKey: "settings.sections.general", icon: Sun },
  { id: "models", labelKey: "settings.sections.models", icon: Brain },
  { id: "usage", labelKey: "settings.sections.usage", icon: ChartNoAxesCombined },
  { id: "skills", labelKey: "settings.sections.skills", icon: Wrench },
  { id: "mcp", labelKey: "settings.sections.mcp", icon: Server },
  { id: "shortcuts", labelKey: "settings.sections.shortcuts", icon: Keyboard, desktopOnly: true },
  {
    id: "integrations",
    labelKey: "settings.sections.integrations",
    icon: Zap,
    desktopOnly: true,
  },
  { id: "permissions", labelKey: "settings.sections.permissions", icon: Shield, desktopOnly: true },
  { id: "diagnostics", labelKey: "settings.sections.diagnostics", icon: Activity },
  { id: "feedback", labelKey: "settings.sections.feedback", icon: MessageSquare },
  { id: "about", labelKey: "settings.sections.about", icon: Info },
];

// ---------------------------------------------------------------------------
// Theme helpers (General section)
// ---------------------------------------------------------------------------

// Lucide icons receive theme-reactive colors through `ThemedIconHost`, which
// keeps styling props away from the underlying SVG DOM node. The screen header
// remains wrapped because it is a regular React component, not an SVG leaf.
const ThemedScreenHeader = withUnistyles(ScreenHeader);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const accentColorMapping = (theme: Theme) => ({
  color: theme.colors.accent,
});
const glassHeaderBackgroundMapping = (theme: Theme) => ({
  backgroundColor: theme.glass.enabled ? "transparent" : undefined,
});

function ThemeIcon({ theme, size }: { theme: AppSettings["theme"]; size: number }) {
  return theme === "auto" ? (
    <ThemedIconHost Icon={Monitor} size={size} uniProps={foregroundMutedColorMapping} />
  ) : (
    <ThemePreview theme={theme} width={size + 4} height={size} />
  );
}

function ThemePreview({
  theme,
  width,
  height,
}: {
  theme: ThemeName;
  width: number;
  height: number;
}) {
  const preview = THEME_PREVIEWS[theme];
  const previewStyle = useMemo(
    () => ({
      width,
      height,
      borderRadius: 8,
      backgroundColor: preview.surface,
      borderWidth: 1,
      borderColor: preview.border,
      overflow: "hidden" as const,
    }),
    [height, preview.border, preview.surface, width],
  );
  const accentStyle = useMemo(
    () => ({
      position: "absolute" as const,
      right: 0,
      bottom: 0,
      left: 0,
      height: 4,
      backgroundColor: preview.accent,
    }),
    [preview.accent],
  );
  return (
    <View style={previewStyle}>
      <View style={accentStyle} />
    </View>
  );
}

function themeTriggerStyle({ pressed }: PressableStateCallbackType) {
  return [styles.themeTrigger, pressed && { opacity: 0.85 }];
}

function sidebarItemStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [sidebarStyles.item, Boolean(hovered) && sidebarStyles.itemHovered];
}

function selectedSidebarItemStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    sidebarStyles.item,
    Boolean(hovered) && sidebarStyles.itemHovered,
    sidebarStyles.itemSelected,
  ];
}

function hostSidebarItemStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    sidebarStyles.item,
    sidebarStyles.hostItem,
    Boolean(hovered) && sidebarStyles.itemHovered,
  ];
}

function selectedHostSidebarItemStyle({
  hovered,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    sidebarStyles.item,
    sidebarStyles.hostItem,
    Boolean(hovered) && sidebarStyles.itemHovered,
    sidebarStyles.itemSelected,
  ];
}

const ROW_WITH_BORDER_STYLE = [settingsStyles.row, settingsStyles.rowBorder];

const SERVICE_URL_BEHAVIOR_VALUES: ServiceUrlBehavior[] = ["ask", "in-app", "external"];
const APP_LANGUAGE_VALUES: AppLanguage[] = ["zh-CN", "en"];

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

interface GeneralSectionProps {
  settings: AppSettings;
  isDesktopApp: boolean;
  handleThemeChange: (theme: AppSettings["theme"]) => void;
  handleLanguageChange: (language: AppLanguage) => void;
  handleSendBehaviorChange: (behavior: SendBehavior) => void;
  handleServiceUrlBehaviorChange: (behavior: ServiceUrlBehavior) => void;
  handleTerminalScrollbackLinesChange: (lines: number) => void;
  handleShowReasoningChange: (showReasoning: boolean) => void;
}

interface ThemeMenuItemProps {
  themeValue: AppSettings["theme"];
  selected: boolean;
  previewHeight: number;
  label: string;
  onChange: (theme: AppSettings["theme"]) => void;
}

function ThemeMenuItem({
  themeValue,
  selected,
  previewHeight,
  label,
  onChange,
}: ThemeMenuItemProps) {
  const handleSelect = useCallback(() => {
    onChange(themeValue);
  }, [onChange, themeValue]);
  const leading = useMemo(
    () => <ThemeIcon theme={themeValue} size={previewHeight} />,
    [themeValue, previewHeight],
  );
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect} leading={leading}>
      {label}
    </DropdownMenuItem>
  );
}

interface LanguageMenuItemProps {
  value: AppLanguage;
  selected: boolean;
  label: string;
  onChange: (value: AppLanguage) => void;
}

function LanguageMenuItem({ value, selected, label, onChange }: LanguageMenuItemProps) {
  const handleSelect = useCallback(() => {
    onChange(value);
  }, [onChange, value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

interface ServiceUrlBehaviorMenuItemProps {
  value: ServiceUrlBehavior;
  selected: boolean;
  label: string;
  onChange: (value: ServiceUrlBehavior) => void;
}

function ServiceUrlBehaviorMenuItem({
  value,
  selected,
  label,
  onChange,
}: ServiceUrlBehaviorMenuItemProps) {
  const handleSelect = useCallback(() => {
    onChange(value);
  }, [onChange, value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

function GeneralSection({
  settings,
  isDesktopApp,
  handleThemeChange,
  handleLanguageChange,
  handleSendBehaviorChange,
  handleServiceUrlBehaviorChange,
  handleTerminalScrollbackLinesChange,
  handleShowReasoningChange,
}: GeneralSectionProps) {
  const { t } = useTranslation();
  const themePreviewHeight = 18;
  const [terminalScrollbackValue, setTerminalScrollbackValue] = useState(
    String(settings.terminalScrollbackLines),
  );
  const sendBehaviorOptions = useMemo(
    () => [
      { value: "interrupt" as const, label: t("settings.general.defaultSend.options.interrupt") },
      { value: "queue" as const, label: t("settings.general.defaultSend.options.queue") },
    ],
    [t],
  );

  const handleTerminalScrollbackChangeText = useCallback((value: string) => {
    setTerminalScrollbackValue(value.replace(/[^\d]/g, ""));
  }, []);

  const commitTerminalScrollback = useCallback(() => {
    const parsed = parseTerminalScrollbackLines(terminalScrollbackValue);
    const nextValue = parsed ?? settings.terminalScrollbackLines;
    setTerminalScrollbackValue(String(nextValue));
    if (nextValue !== settings.terminalScrollbackLines) {
      handleTerminalScrollbackLinesChange(nextValue);
    }
  }, [
    handleTerminalScrollbackLinesChange,
    settings.terminalScrollbackLines,
    terminalScrollbackValue,
  ]);

  useEffect(() => {
    setTerminalScrollbackValue(String(settings.terminalScrollbackLines));
  }, [settings.terminalScrollbackLines]);

  return (
    <SettingsSection title={t("settings.general.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.general.theme.title")}</Text>
          </View>
          <DropdownMenu>
            <DropdownMenuTrigger style={themeTriggerStyle}>
              <ThemeIcon theme={settings.theme} size={ICON_SIZE.md} />
              <Text style={styles.themeTriggerText}>
                {t(`settings.general.theme.options.${settings.theme}`)}
              </Text>
              <ThemedIconHost
                Icon={ChevronDown}
                size={ICON_SIZE.sm}
                uniProps={foregroundMutedColorMapping}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" width={200}>
              {THEME_PICKER_OPTIONS.map((themeValue) => (
                <ThemeMenuItem
                  key={themeValue}
                  themeValue={themeValue}
                  selected={settings.theme === themeValue}
                  previewHeight={themePreviewHeight}
                  label={t(`settings.general.theme.options.${themeValue}`)}
                  onChange={handleThemeChange}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
        <View style={ROW_WITH_BORDER_STYLE}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.general.language.title")}</Text>
          </View>
          <DropdownMenu>
            <DropdownMenuTrigger style={themeTriggerStyle}>
              <Text style={styles.themeTriggerText}>
                {t(`settings.general.language.options.${settings.language}`)}
              </Text>
              <ThemedIconHost
                Icon={ChevronDown}
                size={ICON_SIZE.sm}
                uniProps={foregroundMutedColorMapping}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" width={200}>
              {APP_LANGUAGE_VALUES.map((value) => (
                <LanguageMenuItem
                  key={value}
                  value={value}
                  selected={settings.language === value}
                  label={t(`settings.general.language.options.${value}`)}
                  onChange={handleLanguageChange}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
        <View style={ROW_WITH_BORDER_STYLE}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.general.defaultSend.title")}</Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.general.defaultSend.description")}
            </Text>
          </View>
          <SegmentedControl
            size="sm"
            compact
            value={settings.sendBehavior}
            onValueChange={handleSendBehaviorChange}
            options={sendBehaviorOptions}
          />
        </View>
        <View style={ROW_WITH_BORDER_STYLE}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.general.showReasoning.title")}</Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.general.showReasoning.description")}
            </Text>
          </View>
          <Switch
            value={settings.showReasoning}
            onValueChange={handleShowReasoningChange}
            accessibilityLabel={t("settings.general.showReasoning.accessibilityLabel")}
          />
        </View>
        {isDesktopApp ? (
          <View style={ROW_WITH_BORDER_STYLE}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.general.serviceUrls.title")}</Text>
            </View>
            <DropdownMenu>
              <DropdownMenuTrigger style={themeTriggerStyle}>
                <Text style={styles.themeTriggerText}>
                  {t(`settings.general.serviceUrls.options.${settings.serviceUrlBehavior}`)}
                </Text>
                <ThemedIconHost
                  Icon={ChevronDown}
                  size={ICON_SIZE.sm}
                  uniProps={foregroundMutedColorMapping}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="end" width={200}>
                {SERVICE_URL_BEHAVIOR_VALUES.map((value) => (
                  <ServiceUrlBehaviorMenuItem
                    key={value}
                    value={value}
                    selected={settings.serviceUrlBehavior === value}
                    label={t(`settings.general.serviceUrls.options.${value}`)}
                    onChange={handleServiceUrlBehaviorChange}
                  />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </View>
        ) : null}
        <View style={ROW_WITH_BORDER_STYLE}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.general.terminalScrollback.title")}
            </Text>
          </View>
          <TextInput
            value={terminalScrollbackValue}
            onChangeText={handleTerminalScrollbackChangeText}
            onBlur={commitTerminalScrollback}
            onSubmitEditing={commitTerminalScrollback}
            keyboardType="number-pad"
            inputMode="numeric"
            selectTextOnFocus
            style={styles.terminalScrollbackInput}
            accessibilityLabel={t("settings.general.terminalScrollback.accessibilityLabel")}
          />
        </View>
      </View>
    </SettingsSection>
  );
}

interface DiagnosticsSectionProps {
  serverId: string | null;
  voiceAudioEngine: ReturnType<typeof useVoiceAudioEngineOptional>;
  isPlaybackTestRunning: boolean;
  playbackTestResult: string | null;
  handlePlaybackTest: () => Promise<void>;
}

function DiagnosticsSection({
  serverId,
  voiceAudioEngine,
  isPlaybackTestRunning,
  playbackTestResult,
  handlePlaybackTest,
}: DiagnosticsSectionProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId ?? "");
  const [includeLogs, setIncludeLogs] = useState(false);
  const [isCopyingReport, setIsCopyingReport] = useState(false);
  const handlePlayPress = useCallback(() => {
    void handlePlaybackTest();
  }, [handlePlaybackTest]);
  const handleCopyReport = useCallback(async () => {
    if (!client || isCopyingReport) {
      return;
    }
    setIsCopyingReport(true);
    try {
      const result = await client.getDiagnostics({ includeLogs });
      await Clipboard.setStringAsync(result.diagnostic);
      toast.show(t("settings.diagnostics.reportCopied"), { variant: "success" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t("settings.diagnostics.reportFailed", { message }));
    } finally {
      setIsCopyingReport(false);
    }
  }, [client, includeLogs, isCopyingReport, t, toast]);
  const handleCopyReportPress = useCallback(() => {
    void handleCopyReport();
  }, [handleCopyReport]);
  return (
    <>
      <SettingsSection title={t("settings.diagnostics.reportTitle")}>
        <View style={settingsStyles.card}>
          <View style={ROW_WITH_BORDER_STYLE}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.diagnostics.copyReport")}</Text>
              <Text style={settingsStyles.rowHint}>
                {client
                  ? t("settings.diagnostics.reportHint")
                  : t("settings.diagnostics.reportUnavailable")}
              </Text>
            </View>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={Copy}
              onPress={handleCopyReportPress}
              loading={isCopyingReport}
              disabled={!client}
            >
              {isCopyingReport
                ? t("settings.diagnostics.copyingReport")
                : t("settings.diagnostics.copyReportAction")}
            </Button>
          </View>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.diagnostics.includeLogs")}</Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.diagnostics.includeLogsHint")}
              </Text>
            </View>
            <Switch
              value={includeLogs}
              onValueChange={setIncludeLogs}
              disabled={!client || isCopyingReport}
              accessibilityLabel={t("settings.diagnostics.includeLogs")}
            />
          </View>
        </View>
      </SettingsSection>
      <SettingsSection title={t("settings.diagnostics.title")}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.diagnostics.testAudio")}</Text>
              {playbackTestResult ? (
                <Text style={settingsStyles.rowHint}>{playbackTestResult}</Text>
              ) : null}
            </View>
            <Button
              variant="secondary"
              size="sm"
              onPress={handlePlayPress}
              disabled={!voiceAudioEngine || isPlaybackTestRunning}
            >
              {isPlaybackTestRunning
                ? t("settings.diagnostics.playing")
                : t("settings.diagnostics.playTest")}
            </Button>
          </View>
        </View>
      </SettingsSection>
    </>
  );
}

function FeedbackSection({ isDesktopApp }: { isDesktopApp: boolean }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [isExporting, setIsExporting] = useState(false);

  const handleReportIssue = useCallback(() => {
    void openExternalUrl("https://github.com/ChisaAlter/ChisaCode/issues/new/choose");
  }, []);

  const handleExportLogs = useCallback(async () => {
    if (!isDesktopApp) {
      toast.error(t("settings.feedback.exportLogsDesktopOnly"));
      return;
    }
    setIsExporting(true);
    try {
      const logs = await getDesktopDaemonLogs();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `chisacode-daemon-${timestamp}.log`;
      const exported = await downloadTextFile(fileName, logs.contents ?? "");
      if (exported) {
        toast.show(t("settings.feedback.exportSuccess"), { variant: "success" });
      } else {
        toast.error(t("settings.feedback.shareUnavailable"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Settings] Failed to export daemon logs", error);
      toast.error(t("settings.feedback.exportFailed", { message }));
    } finally {
      setIsExporting(false);
    }
  }, [isDesktopApp, t, toast]);

  return (
    <SettingsSection title={t("settings.feedback.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.feedback.reportIssue")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.feedback.reportIssueHint")}</Text>
          </View>
          <Button variant="outline" size="sm" onPress={handleReportIssue}>
            {t("settings.feedback.openIssues")}
          </Button>
        </View>
        <View style={ROW_WITH_BORDER_STYLE}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.feedback.exportLogs")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.feedback.exportLogsHint")}</Text>
          </View>
          <Button
            variant="secondary"
            size="sm"
            onPress={handleExportLogs}
            disabled={isExporting || !isDesktopApp}
          >
            {isExporting ? t("settings.feedback.exporting") : t("settings.feedback.export")}
          </Button>
        </View>
      </View>
    </SettingsSection>
  );
}

function AboutSection({ isDesktopApp }: { isDesktopApp: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <SettingsSection title={t("settings.about.title")}>
        <View style={settingsStyles.card}>
          {isDesktopApp ? <DesktopAppUpdateRow /> : <GitHubReleaseUpdateRow />}
        </View>
      </SettingsSection>
      <ConnectedHostsSection />
    </>
  );
}

function ConnectedHostsSection() {
  const { t } = useTranslation();
  const hosts = useHosts();
  if (hosts.length === 0) {
    return null;
  }
  return (
    <SettingsSection title={t("settings.about.connectedHosts")}>
      <View style={settingsStyles.card}>
        {hosts.map((host, index) => (
          <HostVersionRow key={host.serverId} host={host} showBorder={index > 0} />
        ))}
      </View>
    </SettingsSection>
  );
}

function HostVersionRow({ host, showBorder }: { host: HostProfile; showBorder: boolean }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(host.serverId);

  const rowStyle = useMemo(
    () => [settingsStyles.row, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {host.label}
        </Text>
        <Text style={settingsStyles.rowHint}>{t("settings.about.thisDevice")}</Text>
      </View>
      <Text style={styles.aboutValue}>
        {isConnected ? t("settings.about.online") : t("settings.about.offline")}
      </Text>
    </View>
  );
}

function getUpdateButtonLabel(
  isInstalling: boolean,
  latestVersion: string | null | undefined,
  t: TFunction,
): string {
  if (isInstalling) return t("settings.updates.installing");
  if (latestVersion) return t("settings.updates.installConfirm");
  return t("settings.updates.update");
}

function DesktopAppUpdateRow() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const {
    isDesktopApp,
    statusText,
    availableUpdate,
    lastCheckResult,
    errorMessage,
    isChecking,
    isInstalling,
    checkForUpdates,
    installUpdate,
  } = useDesktopAppUpdater();

  useFocusEffect(
    useCallback(() => {
      if (!isDesktopApp) {
        return undefined;
      }
      void checkForUpdates({ silent: true });
      return undefined;
    }, [checkForUpdates, isDesktopApp]),
  );

  const handleCheckForUpdates = useCallback(() => {
    if (!isDesktopApp) {
      return;
    }
    void checkForUpdates();
  }, [checkForUpdates, isDesktopApp]);

  const handleReleaseChannelChange = useCallback(
    (releaseChannel: EffectiveSettings["releaseChannel"]) => {
      void updateSettings({ releaseChannel });
    },
    [updateSettings],
  );

  const handleInstallUpdate = useCallback(() => {
    if (!isDesktopApp) {
      return;
    }

    void confirmDialog({
      title: t("settings.updates.installTitle"),
      message: t("settings.updates.installMessage"),
      confirmLabel: t("settings.updates.installConfirm"),
      cancelLabel: t("common.cancel"),
    })
      .then((confirmed) => {
        if (!confirmed) {
          return;
        }
        void installUpdate();
        return;
      })
      .catch((error) => {
        console.error("[Settings] Failed to open app update confirmation", error);
        Alert.alert(t("common.error"), t("settings.updates.confirmOpenFailed"));
      });
  }, [installUpdate, isDesktopApp, t]);

  const releaseChannelOptions = useMemo(
    () => [
      { value: "stable" as const, label: t("settings.updates.stable") },
      { value: "beta" as const, label: t("settings.updates.beta") },
    ],
    [t],
  );

  if (!isDesktopApp) {
    return null;
  }

  return (
    <>
      <View style={ROW_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.updates.releaseChannel")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.updates.releaseChannelHint")}</Text>
        </View>
        <SegmentedControl
          size="sm"
          value={settings.releaseChannel}
          onValueChange={handleReleaseChannelChange}
          options={releaseChannelOptions}
        />
      </View>
      <View style={ROW_WITH_BORDER_STYLE}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.updates.appUpdates")}</Text>
          <Text style={settingsStyles.rowHint}>{statusText}</Text>
          {lastCheckResult?.currentVersion ? (
            <Text style={settingsStyles.rowHint}>
              {t("settings.updates.appCurrentVersion", {
                version: formatVersionLabel(lastCheckResult.currentVersion),
              })}
            </Text>
          ) : null}
          {lastCheckResult?.latestVersion ? (
            <Text style={settingsStyles.rowHint}>
              {t("settings.updates.appLatestVersion", {
                version: formatVersionLabel(lastCheckResult.latestVersion),
              })}
            </Text>
          ) : null}
          {errorMessage ? <Text style={styles.aboutErrorText}>{errorMessage}</Text> : null}
        </View>
        <View style={styles.aboutUpdateActions}>
          <Button
            variant="outline"
            size="sm"
            onPress={handleCheckForUpdates}
            disabled={isChecking || isInstalling}
          >
            {isChecking ? t("settings.updates.checking") : t("settings.updates.check")}
          </Button>
          <Button
            variant="default"
            size="sm"
            onPress={handleInstallUpdate}
            disabled={isChecking || isInstalling || !availableUpdate}
          >
            {getUpdateButtonLabel(isInstalling, availableUpdate?.latestVersion, t)}
          </Button>
        </View>
      </View>
    </>
  );
}

function formatVersionLabel(version: string | null | undefined): string {
  const trimmed = version?.trim();
  if (!trimmed) {
    return "\u2014";
  }
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

function getGitHubReleaseStatusText({
  isChecking,
  result,
  errorMessage,
  t,
}: {
  isChecking: boolean;
  result: GitHubReleaseUpdateResult | null;
  errorMessage: string | null;
  t: TFunction;
}): string {
  if (isChecking) {
    return t("settings.updates.githubChecking");
  }
  if (errorMessage) {
    return t("settings.updates.githubFailed");
  }
  if (!result) {
    return t("settings.updates.githubNotChecked");
  }
  if (result.status === "available") {
    return t("settings.updates.githubAvailable", {
      version: formatVersionLabel(result.latestVersion),
    });
  }
  if (result.status === "up-to-date") {
    return t("settings.updates.githubUpToDate");
  }
  return t("settings.updates.githubLatest", {
    version: formatVersionLabel(result.latestVersion),
  });
}

function GitHubReleaseUpdateRow() {
  const { t } = useTranslation();
  const currentVersion = useMemo(() => resolveAppVersion(), []);
  const [result, setResult] = useState<GitHubReleaseUpdateResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const runCheck = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) {
        setIsChecking(true);
      }
      setErrorMessage(null);
      try {
        const nextResult = await checkGitHubReleaseUpdate({ currentVersion });
        setResult(nextResult);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!silent) {
          setErrorMessage(message);
        }
      } finally {
        if (!silent) {
          setIsChecking(false);
        }
      }
    },
    [currentVersion],
  );

  useFocusEffect(
    useCallback(() => {
      void runCheck({ silent: true });
      return undefined;
    }, [runCheck]),
  );

  const handleCheck = useCallback(() => {
    void runCheck();
  }, [runCheck]);

  const handleOpenRelease = useCallback(() => {
    const url = result?.releaseUrl;
    if (!url) {
      return;
    }
    void openExternalUrl(url);
  }, [result?.releaseUrl]);

  const handleDownloadApk = useCallback(() => {
    const url = result?.androidApkUrl ?? result?.releaseUrl;
    if (!url) {
      return;
    }
    void openExternalUrl(url);
  }, [result?.androidApkUrl, result?.releaseUrl]);

  const statusText = getGitHubReleaseStatusText({ isChecking, result, errorMessage, t });
  const canOpenRelease = Boolean(result?.releaseUrl);
  const canDownloadApk = Boolean(result?.androidApkUrl);

  return (
    <View style={settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.updates.githubReleases")}</Text>
        <Text style={settingsStyles.rowHint}>{statusText}</Text>
        <Text style={settingsStyles.rowHint}>
          {t("settings.updates.githubCurrentVersion", {
            version: formatVersionLabel(currentVersion),
          })}
        </Text>
        {errorMessage ? <Text style={styles.aboutErrorText}>{errorMessage}</Text> : null}
      </View>
      <View style={styles.aboutUpdateActions}>
        <Button variant="outline" size="sm" onPress={handleCheck} disabled={isChecking}>
          {isChecking ? t("settings.updates.checking") : t("settings.updates.check")}
        </Button>
        {canDownloadApk ? (
          <Button variant="outline" size="sm" onPress={handleDownloadApk}>
            {t("settings.updates.downloadAndroidApk")}
          </Button>
        ) : null}
        <Button variant="default" size="sm" onPress={handleOpenRelease} disabled={!canOpenRelease}>
          {t("settings.updates.openRelease")}
        </Button>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function useAnyOnlineHostServerId(serverIds: string[]): string | null {
  const runtime = getHostRuntimeStore();
  return useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => {
      let firstOnlineServerId: string | null = null;
      let firstOnlineAt: string | null = null;
      for (const serverId of serverIds) {
        const snapshot = runtime.getSnapshot(serverId);
        const lastOnlineAt = snapshot?.lastOnlineAt ?? null;
        if (!isHostRuntimeConnected(snapshot) || !lastOnlineAt) {
          continue;
        }
        if (!firstOnlineAt || lastOnlineAt < firstOnlineAt) {
          firstOnlineAt = lastOnlineAt;
          firstOnlineServerId = serverId;
        }
      }
      return firstOnlineServerId;
    },
    () => null,
  );
}

interface SidebarSectionButtonProps {
  itemId: SettingsSectionSlug;
  label: string;
  icon: ComponentType<{ size: number; color: string }>;
  isSelected: boolean;
  onSelect: (section: SettingsSectionSlug) => void;
}

function SidebarSectionButton({
  itemId,
  label,
  icon: IconComponent,
  isSelected,
  onSelect,
}: SidebarSectionButtonProps) {
  const handlePress = useCallback(() => {
    onSelect(itemId);
  }, [onSelect, itemId]);
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  const labelStyle = useMemo(
    () => [sidebarStyles.navigationLabel, isSelected && sidebarStyles.navigationLabelSelected],
    [isSelected],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={handlePress}
      testID={`settings-section-${itemId}`}
      style={isSelected ? selectedSidebarItemStyle : sidebarItemStyle}
    >
      <ThemedIconHost
        Icon={IconComponent}
        size={ICON_SIZE.md}
        uniProps={foregroundMutedColorMapping}
      />
      <Text style={labelStyle} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

interface SidebarProjectsButtonProps {
  isSelected: boolean;
  onSelect: () => void;
}

function SidebarProjectsButton({ isSelected, onSelect }: SidebarProjectsButtonProps) {
  const { t } = useTranslation();
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  const labelStyle = useMemo(
    () => [sidebarStyles.navigationLabel, isSelected && sidebarStyles.navigationLabelSelected],
    [isSelected],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={onSelect}
      testID="settings-projects"
      style={isSelected ? selectedSidebarItemStyle : sidebarItemStyle}
    >
      <ThemedIconHost Icon={Folder} size={ICON_SIZE.md} uniProps={foregroundMutedColorMapping} />
      <Text style={labelStyle} numberOfLines={1}>
        {t("settings.projects")}
      </Text>
    </Pressable>
  );
}

interface SidebarHostItemProps {
  serverId: string;
  label: string;
  isSelected: boolean;
  isLocal: boolean;
  onSelect: (serverId: string) => void;
}

function SidebarHostItem({ serverId, label, isSelected, isLocal, onSelect }: SidebarHostItemProps) {
  const handlePress = useCallback(() => {
    onSelect(serverId);
  }, [onSelect, serverId]);
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  const labelStyle = useMemo(
    () => [sidebarStyles.label, isSelected && sidebarStyles.labelSelected],
    [isSelected],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={handlePress}
      testID={`settings-host-entry-${serverId}`}
      style={isSelected ? selectedHostSidebarItemStyle : hostSidebarItemStyle}
    >
      {isLocal ? (
        <View style={sidebarStyles.localDot} />
      ) : (
        <ThemedIconHost
          Icon={Server}
          size={ICON_SIZE.md}
          uniProps={isSelected ? accentColorMapping : foregroundMutedColorMapping}
        />
      )}
      <Text style={labelStyle} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

interface SettingsSidebarProps {
  view: SettingsView;
  onSelectSection: (section: SettingsSectionSlug) => void;
  onSelectHost: (serverId: string) => void;
  onSelectProjects: () => void;
  onAddHost: () => void;
  onBackToWorkspace: () => void;
  layout: "desktop" | "mobile";
}

function SettingsSidebar({
  view,
  onSelectSection,
  onSelectHost,
  onSelectProjects,
  onAddHost,
  onBackToWorkspace,
  layout,
}: SettingsSidebarProps) {
  const { t } = useTranslation();
  const hosts = useHosts();
  const localServerId = useLocalDaemonServerId();
  const sortedHosts = useMemo(() => {
    if (!localServerId) {
      return hosts;
    }
    const localIndex = hosts.findIndex((host) => host.serverId === localServerId);
    if (localIndex <= 0) {
      return hosts;
    }
    const next = hosts.slice();
    const [local] = next.splice(localIndex, 1);
    next.unshift(local);
    return next;
  }, [hosts, localServerId]);
  const isDesktopApp = isElectronRuntime();
  const items = SIDEBAR_SECTION_ITEMS.filter((item) => !item.desktopOnly || isDesktopApp);
  const insets = useSafeAreaInsets();
  const padding = useWindowControlsPadding("sidebar");
  const webScrollbarStyle = useWebScrollbarStyle();
  const isDesktop = layout === "desktop";
  const containerStyle = useMemo(
    () => [
      isDesktop ? sidebarStyles.desktopContainer : sidebarStyles.mobileContainer,
      isDesktop ? { paddingTop: insets.top } : null,
    ],
    [insets.top, isDesktop],
  );
  const sidebarScrollStyle = useMemo(
    () => [sidebarStyles.scrollView, webScrollbarStyle],
    [webScrollbarStyle],
  );
  const selectedSectionId = view.kind === "section" ? view.section : null;
  const selectedServerId = view.kind === "host" ? view.serverId : null;
  const isProjectsSelected = view.kind === "projects" || view.kind === "project";
  const paddingTopStyle = useMemo(() => ({ height: padding.top }), [padding.top]);

  const backButton = isDesktop ? (
    <SidebarHeaderRow
      compact
      icon={ArrowLeft}
      label={t("settings.back")}
      onPress={onBackToWorkspace}
      testID="settings-back-to-workspace"
    />
  ) : null;

  const sectionList = (
    <View style={sidebarStyles.list}>
      {items.map((item) => (
        <Fragment key={item.id}>
          <SidebarSectionButton
            itemId={item.id}
            label={t(item.labelKey)}
            icon={item.icon}
            isSelected={selectedSectionId === item.id}
            onSelect={onSelectSection}
          />
          {item.id === "general" ? (
            <SidebarProjectsButton isSelected={isProjectsSelected} onSelect={onSelectProjects} />
          ) : null}
        </Fragment>
      ))}
    </View>
  );

  const hostList = (
    <View style={sidebarStyles.list}>
      {sortedHosts.map((host) => (
        <SidebarHostItem
          key={host.serverId}
          serverId={host.serverId}
          label={host.label}
          isSelected={selectedServerId === host.serverId}
          isLocal={localServerId !== null && host.serverId === localServerId}
          onSelect={onSelectHost}
        />
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("settings.addHost")}
        onPress={onAddHost}
        testID="settings-add-host"
        style={sidebarStyles.addHostItem}
      >
        <ThemedIconHost Icon={Plus} size={ICON_SIZE.sm} uniProps={accentColorMapping} />
        <Text style={sidebarStyles.addHostLabel} numberOfLines={1}>
          {t("settings.addHost")}
        </Text>
      </Pressable>
    </View>
  );

  const scrollableContent = (
    <>
      {backButton}
      {sectionList}
      <SidebarSeparator />
      {hostList}
    </>
  );

  const innerContent = isDesktop ? (
    <>
      <TitlebarDragRegion />
      {padding.top > 0 ? <View style={paddingTopStyle} /> : null}
      {backButton}
      <View style={sidebarStyles.desktopBody}>
        <ScrollView style={sidebarScrollStyle} contentContainerStyle={sidebarStyles.scrollContent}>
          {sectionList}
        </ScrollView>
        <SidebarSeparator />
        <View style={sidebarStyles.hostFooter}>{hostList}</View>
      </View>
    </>
  ) : (
    scrollableContent
  );

  return (
    <View style={containerStyle} testID="settings-sidebar">
      {innerContent}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export interface SettingsScreenProps {
  view: SettingsView;
}

export default function SettingsScreen({ view }: SettingsScreenProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const voiceAudioEngine = useVoiceAudioEngineOptional();
  const { settings, isLoading: settingsLoading, updateSettings } = useSettings();
  const [isAddHostMethodVisible, setIsAddHostMethodVisible] = useState(false);
  const [isDirectHostVisible, setIsDirectHostVisible] = useState(false);
  const [isPasteLinkVisible, setIsPasteLinkVisible] = useState(false);
  const [isPlaybackTestRunning, setIsPlaybackTestRunning] = useState(false);
  const [playbackTestResult, setPlaybackTestResult] = useState<string | null>(null);
  const isDesktopApp = isElectronRuntime();
  const isCompactLayout = useIsCompactFormFactor();
  const insets = useSafeAreaInsets();
  const insetBottomStyle = useMemo(() => ({ paddingBottom: insets.bottom }), [insets.bottom]);
  const webScrollbarStyle = useWebScrollbarStyle();
  const scrollViewStyle = useMemo(
    () => [styles.scrollView, webScrollbarStyle],
    [webScrollbarStyle],
  );
  const hosts = useHosts();
  const routeParams = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnToRoute = normalizeSettingsReturnToRoute(routeParams.returnTo);
  const localServerId = useLocalDaemonServerId();
  const hostServerIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const anyOnlineServerId = useAnyOnlineHostServerId(hostServerIds);

  const handleThemeChange = useCallback(
    (nextTheme: AppSettings["theme"]) => {
      void updateSettings({ theme: nextTheme });
    },
    [updateSettings],
  );

  const handleLanguageChange = useCallback(
    (language: AppLanguage) => {
      void updateSettings({ language });
    },
    [updateSettings],
  );

  const handleSendBehaviorChange = useCallback(
    (behavior: SendBehavior) => {
      void updateSettings({ sendBehavior: behavior });
    },
    [updateSettings],
  );

  const handleServiceUrlBehaviorChange = useCallback(
    (behavior: ServiceUrlBehavior) => {
      void updateSettings({ serviceUrlBehavior: behavior });
    },
    [updateSettings],
  );

  const handleTerminalScrollbackLinesChange = useCallback(
    (terminalScrollbackLines: number) => {
      void updateSettings({ terminalScrollbackLines });
    },
    [updateSettings],
  );

  const handleShowReasoningChange = useCallback(
    (showReasoning: boolean) => {
      void updateSettings({ showReasoning });
    },
    [updateSettings],
  );

  const handlePlaybackTest = useCallback(async () => {
    if (!voiceAudioEngine || isPlaybackTestRunning) {
      return;
    }

    setIsPlaybackTestRunning(true);
    setPlaybackTestResult(null);

    try {
      const bytes = Buffer.from(THINKING_TONE_NATIVE_PCM_BASE64, "base64");
      await voiceAudioEngine.initialize();
      voiceAudioEngine.stop();
      await voiceAudioEngine.play({
        type: "audio/pcm;rate=16000;bits=16",
        size: bytes.byteLength,
        async arrayBuffer() {
          return Uint8Array.from(bytes).buffer;
        },
      });
      setPlaybackTestResult(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Settings] Playback test failed", error);
      setPlaybackTestResult(t("settings.diagnostics.playbackFailed", { message }));
    } finally {
      setIsPlaybackTestRunning(false);
    }
  }, [isPlaybackTestRunning, t, voiceAudioEngine]);

  const closeAddConnectionFlow = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsDirectHostVisible(false);
    setIsPasteLinkVisible(false);
  }, []);

  const goBackToAddConnectionMethods = useCallback(() => {
    setIsDirectHostVisible(false);
    setIsPasteLinkVisible(false);
    setIsAddHostMethodVisible(true);
  }, []);

  const handleAddHost = useCallback(() => {
    setIsAddHostMethodVisible(true);
  }, []);

  const handleSelectDirectConnection = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsDirectHostVisible(true);
  }, []);

  const handleSelectPasteLink = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsPasteLinkVisible(true);
  }, []);

  const handleHostAdded = useCallback(
    ({ serverId }: { serverId: string }) => {
      const target = buildSettingsHostRoute(serverId, { returnTo: returnToRoute }) as Href;
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [isCompactLayout, returnToRoute, router],
  );

  const handleSelectSection = useCallback(
    (section: SettingsSectionSlug) => {
      const target = buildSettingsSectionRoute(section, { returnTo: returnToRoute }) as Href;
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [isCompactLayout, returnToRoute, router],
  );

  const handleSelectHost = useCallback(
    (serverId: string) => {
      const target = buildSettingsHostRoute(serverId, { returnTo: returnToRoute }) as Href;
      if (isCompactLayout) {
        router.push(target);
      } else {
        router.replace(target);
      }
    },
    [isCompactLayout, returnToRoute, router],
  );

  const handleSelectProjects = useCallback(() => {
    const target = buildProjectsSettingsRoute({ returnTo: returnToRoute }) as Href;
    if (isCompactLayout) {
      router.push(target);
    } else {
      router.replace(target);
    }
  }, [isCompactLayout, returnToRoute, router]);

  const handleScanQr = useCallback(() => {
    closeAddConnectionFlow();
    router.push({
      pathname: "/pair-scan",
      params: { source: "settings" },
    });
  }, [closeAddConnectionFlow, router]);

  const handleHostRemoved = useCallback(() => {
    const fallback = buildSettingsSectionRoute("general", { returnTo: returnToRoute }) as Href;
    if (isCompactLayout) {
      router.replace(buildSettingsRoute({ returnTo: returnToRoute }) as Href);
    } else {
      router.replace(fallback);
    }
  }, [isCompactLayout, returnToRoute, router]);

  const handleBackToRoot = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(buildSettingsRoute({ returnTo: returnToRoute }) as Href);
    }
  }, [returnToRoute, router]);

  const handleBackToWorkspace = useCallback(() => {
    if (returnToRoute) {
      router.dismissTo(returnToRoute as Href);
      return;
    }
    if (navigateToLastWorkspace()) {
      return;
    }
    if (anyOnlineServerId) {
      router.replace(buildHostOpenProjectRoute(anyOnlineServerId));
      return;
    }
    router.replace("/");
  }, [anyOnlineServerId, returnToRoute, router]);

  const detailHeader: {
    title: string;
    Icon: ComponentType<{ size: number; color: string }>;
    titleAccessory?: ReactNode;
  } | null = (() => {
    if (view.kind === "host") {
      const host = hosts.find((h) => h.serverId === view.serverId);
      if (!host) return null;
      return {
        title: host.label,
        Icon: Server,
        titleAccessory: <HostRenameButton host={host} />,
      };
    }
    if (view.kind === "section") {
      const item = SIDEBAR_SECTION_ITEMS.find((s) => s.id === view.section);
      if (!item) return null;
      return { title: t(item.labelKey), Icon: item.icon };
    }
    if (view.kind === "project" || view.kind === "projects") {
      return { title: t("settings.projects"), Icon: Folder };
    }
    return null;
  })();

  const detailHeaderIcon = detailHeader?.Icon ?? null;

  // eslint-disable-next-line complexity
  const content = (() => {
    if (view.kind === "host") {
      return <HostPage serverId={view.serverId} onHostRemoved={handleHostRemoved} />;
    }
    if (view.kind === "projects") {
      return <ProjectsScreen view={view} returnTo={returnToRoute} />;
    }
    if (view.kind === "project") {
      return <ProjectSettingsScreen projectKey={view.projectKey} returnTo={returnToRoute} />;
    }
    if (view.kind === "section") {
      switch (view.section) {
        case "general":
          return (
            <GeneralSection
              settings={settings}
              isDesktopApp={isDesktopApp}
              handleThemeChange={handleThemeChange}
              handleLanguageChange={handleLanguageChange}
              handleSendBehaviorChange={handleSendBehaviorChange}
              handleServiceUrlBehaviorChange={handleServiceUrlBehaviorChange}
              handleTerminalScrollbackLinesChange={handleTerminalScrollbackLinesChange}
              handleShowReasoningChange={handleShowReasoningChange}
            />
          );
        case "shortcuts":
          return isDesktopApp ? <KeyboardShortcutsSection /> : null;
        case "models":
          return anyOnlineServerId ? (
            <>
              <CustomModelProvidersSection serverId={localServerId ?? anyOnlineServerId} />
              <VisionFallbackSection serverId={localServerId ?? anyOnlineServerId} />
              <SyntheticModelsSection serverId={localServerId ?? anyOnlineServerId} />
            </>
          ) : (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>{t("settings.models.noHost")}</Text>
            </View>
          );
        case "usage":
          return <UsageStatisticsSection serverId={localServerId} />;
        case "skills":
          return anyOnlineServerId ? (
            <SkillsSection serverId={localServerId ?? anyOnlineServerId} />
          ) : (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>{t("settings.skills.noHost")}</Text>
            </View>
          );
        case "mcp":
          return anyOnlineServerId ? (
            <McpServersSection serverId={localServerId ?? anyOnlineServerId} />
          ) : (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>{t("settings.mcpServers.noHost")}</Text>
            </View>
          );
        case "integrations":
          return isDesktopApp ? <IntegrationsSection /> : null;
        case "permissions":
          return isDesktopApp ? <DesktopPermissionsSection /> : null;
        case "diagnostics":
          return (
            <DiagnosticsSection
              serverId={anyOnlineServerId}
              voiceAudioEngine={voiceAudioEngine}
              isPlaybackTestRunning={isPlaybackTestRunning}
              playbackTestResult={playbackTestResult}
              handlePlaybackTest={handlePlaybackTest}
            />
          );
        case "feedback":
          return <FeedbackSection isDesktopApp={isDesktopApp} />;
        case "about":
          return <AboutSection isDesktopApp={isDesktopApp} />;
      }
    }
    return null;
  })();

  if (settingsLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>{t("settings.loading")}</Text>
      </View>
    );
  }

  const addHostModals = (
    <>
      <AddHostMethodModal
        visible={isAddHostMethodVisible}
        onClose={closeAddConnectionFlow}
        onDirectConnection={handleSelectDirectConnection}
        onPasteLink={handleSelectPasteLink}
        onScanQr={handleScanQr}
      />
      <AddHostModal
        visible={isDirectHostVisible}
        onClose={closeAddConnectionFlow}
        onCancel={goBackToAddConnectionMethods}
        onSaved={handleHostAdded}
      />
      <PairLinkModal
        visible={isPasteLinkVisible}
        onClose={closeAddConnectionFlow}
        onCancel={goBackToAddConnectionMethods}
        onSaved={handleHostAdded}
      />
    </>
  );

  // Mobile root: full-screen sidebar-as-list.
  if (isCompactLayout && view.kind === "root") {
    return (
      <View style={styles.container}>
        <BackHeader title={t("settings.title")} onBack={handleBackToWorkspace} />
        <ScrollView style={scrollViewStyle} contentContainerStyle={insetBottomStyle}>
          <SettingsSidebar
            view={view}
            onSelectSection={handleSelectSection}
            onSelectHost={handleSelectHost}
            onSelectProjects={handleSelectProjects}
            onAddHost={handleAddHost}
            onBackToWorkspace={handleBackToWorkspace}
            layout="mobile"
          />
        </ScrollView>
        {addHostModals}
      </View>
    );
  }

  // Mobile detail: full-screen content with a back header. Project detail uses
  // an app-level back (out of settings, to the workspace) since the in-body
  // "Back to projects" ghost button handles list-level back; other detail views
  // step back to the settings root.
  const detailBackHandler = view.kind === "project" ? handleBackToWorkspace : handleBackToRoot;
  if (isCompactLayout) {
    return (
      <View style={styles.container}>
        <BackHeader
          title={detailHeader?.title}
          titleAccessory={detailHeader?.titleAccessory}
          onBack={detailBackHandler}
        />
        <ScrollView style={scrollViewStyle} contentContainerStyle={insetBottomStyle}>
          <View style={styles.content}>{content}</View>
        </ScrollView>
        {addHostModals}
      </View>
    );
  }

  // Desktop split view — mirrors AppContainer: sidebar owns the titlebar drag
  // region + traffic-light padding; detail pane renders whatever header the
  // selected section provides.
  return (
    <View style={styles.container}>
      <View style={desktopStyles.row}>
        <SettingsSidebar
          view={view}
          onSelectSection={handleSelectSection}
          onSelectHost={handleSelectHost}
          onSelectProjects={handleSelectProjects}
          onAddHost={handleAddHost}
          onBackToWorkspace={handleBackToWorkspace}
          layout="desktop"
        />
        <View style={desktopStyles.contentPane}>
          <ThemedScreenHeader
            uniProps={glassHeaderBackgroundMapping}
            borderless={!detailHeader}
            height={SETTINGS_DESKTOP_HEADER_HEIGHT}
            horizontalPadding={20}
            windowControlsPaddingRole="detailHeader"
            left={
              detailHeader ? (
                <>
                  <HeaderIconBadge variant="settings">
                    {detailHeaderIcon ? (
                      <ThemedIconHost
                        Icon={detailHeaderIcon}
                        size={ICON_SIZE.sm}
                        uniProps={accentColorMapping}
                      />
                    ) : null}
                  </HeaderIconBadge>
                  <ScreenTitle
                    testID="settings-detail-header-title"
                    style={desktopStyles.detailTitle}
                  >
                    {detailHeader.title}
                  </ScreenTitle>
                  {detailHeader.titleAccessory}
                </>
              ) : null
            }
            leftStyle={desktopStyles.detailLeft}
          />
          <ScrollView style={scrollViewStyle} contentContainerStyle={insetBottomStyle}>
            <View style={desktopStyles.content}>{content}</View>
          </ScrollView>
        </View>
      </View>
      {addHostModals}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create((theme) => ({
  loadingContainer: {
    flex: 1,
    backgroundColor: theme.glass.enabled ? "transparent" : theme.colors.surface0,
    alignItems: "center",
    justifyContent: "center",
  },
  // Soft loading copy: body-adjacent.
  loadingText: {
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 22,
  },
  container: {
    flex: 1,
    backgroundColor: theme.glass.enabled ? "transparent" : theme.colors.surfaceWorkspace,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: theme.spacing[3],
    paddingTop: theme.spacing[4],
    width: "100%",
    maxWidth: SETTINGS_DESKTOP_CONTENT_OUTER_MAX_WIDTH,
    alignSelf: "center",
  },
  aboutValue: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  aboutVersionMismatch: {
    color: theme.colors.palette.amber[500],
  },
  aboutErrorText: {
    color: theme.colors.palette.red[300],
    fontSize: 12.5,
    lineHeight: 16,
    marginTop: theme.spacing[1],
  },
  aboutUpdateActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  // Soft settings control: quiet pill trigger.
  themeTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    height: SETTINGS_CONTROL_HEIGHT,
    paddingVertical: 0,
    paddingHorizontal: 10,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  themeTriggerText: {
    color: theme.colors.foreground,
    fontSize: 13,
    lineHeight: 18,
  },
  terminalScrollbackInput: {
    width: SETTINGS_INPUT_WIDTH,
    height: 30,
    paddingVertical: 0,
    paddingHorizontal: theme.spacing[1.5],
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[8],
  },
  placeholderText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
}));

const desktopStyles = StyleSheet.create((theme) => ({
  row: {
    flex: 1,
    flexDirection: "row",
  },
  // Soft settings main: soft shell canvas behind detail cards.
  contentPane: {
    flex: 1,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  content: {
    width: "100%",
    maxWidth: SETTINGS_DESKTOP_CONTENT_OUTER_MAX_WIDTH,
    alignSelf: "center",
    // Soft .set-body padding.
    paddingTop: 22,
    paddingRight: 28,
    paddingBottom: 36,
    paddingLeft: 28,
  },
  detailLeft: {
    gap: theme.spacing[2],
  },
  detailTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: theme.fontWeight.semibold,
  },
}));

const sidebarStyles = StyleSheet.create((theme) => ({
  // Soft .set-nav column.
  desktopContainer: {
    width: SETTINGS_DESKTOP_SIDEBAR_WIDTH,
    flexShrink: 0,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
    overflow: "hidden",
  },
  mobileContainer: {
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  // Soft .set-list.
  list: {
    paddingVertical: 10,
    paddingHorizontal: { xs: 0, md: 10 },
    gap: 2,
  },
  desktopBody: {
    flex: 1,
    minHeight: 0,
  },
  hostFooter: {
    flexShrink: 0,
  },
  scrollView: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: theme.spacing[3],
  },
  // Soft .set-item: h38, r10, pad 0 12, gap 10, text-2.
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: { xs: 44, md: 38 },
    paddingVertical: 0,
    paddingHorizontal: { xs: theme.spacing[4], md: 12 },
    borderRadius: 10,
  },
  itemHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  // Soft .set-item.on: elevated surface chip + Soft-ink shadow.
  itemSelected: {
    backgroundColor: theme.colors.surface0,
    ...(isWeb
      ? ({
          boxShadow: "0 1px 2px rgba(20, 23, 31, 0.04)",
        } as object)
      : {}),
  },
  hostItem: {
    minHeight: 34,
    paddingHorizontal: 12,
  },
  addHostItem: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingHorizontal: 12,
  },
  // Soft .set-item label: 13px text-2 until selected.
  navigationLabel: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.normal,
    flex: 1,
  },
  // Soft .set-item.on: text + medium weight, not accent ink.
  navigationLabelSelected: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.normal,
    flex: 1,
  },
  // Soft .set-item.on host chip: foreground + medium, not accent.
  labelSelected: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  addHostLabel: {
    color: theme.colors.accent,
    fontSize: 13,
    lineHeight: 18,
  },
  localDot: {
    width: 7,
    height: 7,
    flexShrink: 0,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.success,
    shadowColor: theme.colors.success,
    shadowRadius: 6,
    shadowOpacity: 1,
  },
}));
