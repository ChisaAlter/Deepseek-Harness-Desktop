/* eslint-disable react-hooks/exhaustive-deps */
import React, { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  // Alert.alert is retained for blocking uninstall confirm dialogs;
  // toasts are used for transient error/success feedback only.
  Alert,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { type Theme } from "@/styles/theme";
import { Download, FolderInput, Plus, RefreshCw, Search, Trash2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useUserVisibleErrorReporter } from "@/hooks/use-user-visible-error";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type {
  AgentSkillPayload,
  AgentSkillScopePayload,
  AgentSkillStatus,
  SkillManagementConfig,
} from "@chisacode/protocol/messages";

const ThemedSearch = withUnistyles(Search);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedTextInput = withUnistyles(TextInput);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const placeholderTextColorMapping = (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
});

type SelectedScope =
  | { type: "global" }
  | { type: "provider"; provider: string }
  | { type: "agent"; agentId: string };

interface ScopeButtonItem {
  value: SelectedScope;
  label: string;
}

type InstallMode = "url" | "local";

interface CreateMenuFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

const CREATE_MENU_WIDTH = 220;
const CREATE_MENU_GAP = 8;

interface SkillsSectionProps {
  serverId: string;
}

function sameScope(a: SelectedScope, b: SelectedScope): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "global") return true;
  if (a.type === "provider" && b.type === "provider") return a.provider === b.provider;
  if (a.type === "agent" && b.type === "agent") return a.agentId === b.agentId;
  return false;
}

function scopeKey(scope: SelectedScope): string {
  if (scope.type === "global") return "global";
  if (scope.type === "provider") return `provider:${scope.provider}`;
  return `agent:${scope.agentId}`;
}

function statusForScope(skill: AgentSkillPayload, scope: SelectedScope): AgentSkillStatus {
  if (scope.type === "global") return skill.statusByScope.global;
  if (scope.type === "provider") {
    return skill.statusByScope.providers?.[scope.provider] ?? skill.statusByScope.global;
  }
  return skill.statusByScope.agents[scope.agentId] ?? skill.statusByScope.global;
}

function isEnabled(status: AgentSkillStatus): boolean {
  return status === "enabled" || status === "agent-enabled";
}

function withoutName(values: readonly string[], name: string): string[] {
  return values.filter((value) => value !== name);
}

function withName(values: readonly string[], name: string): string[] {
  return [...new Set([...values, name])].sort();
}

function statusLabel(status: AgentSkillStatus): string {
  switch (status) {
    case "agent-disabled":
      return "Agent disabled";
    case "agent-enabled":
      return "Agent enabled";
    case "global-disabled":
      return "Global disabled";
    case "enabled":
      return "Enabled";
  }
}

function skillMatchesQuery(skill: AgentSkillPayload, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    skill.name,
    skill.description ?? "",
    ...skill.sources.flatMap((source) => [source.path, source.type]),
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(needle);
}

interface ScopeButtonProps {
  scope: SelectedScope;
  label: string;
  selected: boolean;
  onSelect: (scope: SelectedScope) => void;
}

function ScopeButton({ scope, label, selected, onSelect }: ScopeButtonProps) {
  const handlePress = useCallback(() => onSelect(scope), [onSelect, scope]);
  return (
    <Button
      variant={selected ? "default" : "ghost"}
      size="sm"
      style={styles.scopeButton}
      onPress={handlePress}
    >
      {label}
    </Button>
  );
}

interface SkillRowProps {
  skill: AgentSkillPayload;
  index: number;
  selectedScope: SelectedScope;
  working: boolean;
  onToggle: (skill: AgentSkillPayload, value: boolean) => void;
  onUninstall: (sourceId: string) => void;
}

function SkillRow({ skill, index, selectedScope, working, onToggle, onUninstall }: SkillRowProps) {
  const { t } = useTranslation();
  const status = statusForScope(skill, selectedScope);
  const removableSource = skill.sources.find(
    (source) => source.removable && source.installedSourceId,
  );
  const rowStyle = useMemo(
    () => [settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null],
    [index],
  );
  const handleToggle = useCallback((value: boolean) => onToggle(skill, value), [onToggle, skill]);
  const handleUninstall = useCallback(() => {
    if (removableSource?.installedSourceId) {
      onUninstall(removableSource.installedSourceId);
    }
  }, [onUninstall, removableSource]);

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{skill.name}</Text>
        <Text style={settingsStyles.rowHint}>
          {skill.description ?? t("settings.skills.noDescription")}
        </Text>
        <Text style={styles.statusText}>
          {statusLabel(status)} · {t("settings.skills.nextLoad")}
        </Text>
      </View>
      <View style={styles.rowActions}>
        {selectedScope.type === "global" && removableSource?.installedSourceId ? (
          <Button variant="ghost" size="sm" leftIcon={Trash2} onPress={handleUninstall}>
            {t("settings.skills.uninstall")}
          </Button>
        ) : null}
        <Switch value={isEnabled(status)} disabled={working} onValueChange={handleToggle} />
      </View>
    </View>
  );
}

export function SkillsSection({ serverId }: SkillsSectionProps) {
  const { t } = useTranslation();
  const reportError = useUserVisibleErrorReporter();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const [scopes, setScopes] = useState<AgentSkillScopePayload[]>([]);
  const [skills, setSkills] = useState<AgentSkillPayload[]>([]);
  const [policy, setPolicy] = useState<SkillManagementConfig | null>(null);
  const [selectedScope, setSelectedScope] = useState<SelectedScope>({ type: "global" });
  const [isLoading, setIsLoading] = useState(false);
  const [workingSkill, setWorkingSkill] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [installMode, setInstallMode] = useState<InstallMode | null>(null);
  const [installValue, setInstallValue] = useState("");
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [createMenuFrame, setCreateMenuFrame] = useState<CreateMenuFrame | null>(null);
  const createButtonRef = useRef<View>(null);

  const refresh = useCallback(async () => {
    if (!client || !connected) return;
    setIsLoading(true);
    try {
      const response = await client.listAgentSkills();
      setScopes(response.scopes);
      setSkills(response.skills);
      setPolicy(response.policy);
      if (
        selectedScope.type === "agent" &&
        !response.scopes.some(
          (scope) => scope.type === "agent" && scope.agentId === selectedScope.agentId,
        )
      ) {
        setSelectedScope({ type: "global" });
      } else if (
        selectedScope.type === "provider" &&
        !response.scopes.some(
          (scope) => scope.type === "provider" && scope.provider === selectedScope.provider,
        )
      ) {
        setSelectedScope({ type: "global" });
      }
    } catch (error) {
      reportError({
        error,
        logLabel: "[SkillsSettings] Failed to load skills",
        fallbackMessage: t("settings.skills.loadFailed"),
      });
    } finally {
      setIsLoading(false);
    }
  }, [client, connected, reportError, selectedScope, t]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return undefined;
    }, [refresh]),
  );

  const handleToggle = useCallback(
    async (skill: AgentSkillPayload, nextValue: boolean) => {
      if (!client || !policy) return;
      setWorkingSkill(skill.name);
      try {
        if (selectedScope.type === "global") {
          const disabledSkillNames = nextValue
            ? withoutName(policy.global.disabledSkillNames, skill.name)
            : withName(policy.global.disabledSkillNames, skill.name);
          const response = await client.patchAgentSkillPolicy({
            scope: { type: "global" },
            policy: { disabledSkillNames },
          });
          setPolicy(response.policy);
        } else {
          const current =
            selectedScope.type === "provider"
              ? (policy.providers[selectedScope.provider] ?? {
                  enabledSkillNames: [],
                  disabledSkillNames: [],
                })
              : (policy.agents[selectedScope.agentId] ?? {
                  enabledSkillNames: [],
                  disabledSkillNames: [],
                });
          const enabledSkillNames = nextValue
            ? withName(current.enabledSkillNames, skill.name)
            : withoutName(current.enabledSkillNames, skill.name);
          const disabledSkillNames = nextValue
            ? withoutName(current.disabledSkillNames, skill.name)
            : withName(current.disabledSkillNames, skill.name);
          const response = await client.patchAgentSkillPolicy({
            scope:
              selectedScope.type === "provider"
                ? { type: "provider", provider: selectedScope.provider }
                : { type: "agent", agentId: selectedScope.agentId },
            policy: { enabledSkillNames, disabledSkillNames },
          });
          setPolicy(response.policy);
        }
      } catch (error) {
        reportError({
          error,
          logLabel: "[SkillsSettings] Failed to update skill policy",
          fallbackMessage: t("settings.skills.saveFailed"),
        });
      } finally {
        setWorkingSkill(null);
      }
    },
    [client, policy, reportError, selectedScope, t],
  );

  const handleOpenInstall = useCallback((mode: InstallMode) => {
    setIsCreateMenuOpen(false);
    setInstallMode(mode);
    setInstallValue("");
  }, []);

  const handleOpenUrlInstall = useCallback(() => {
    handleOpenInstall("url");
  }, [handleOpenInstall]);

  const handleOpenLocalInstall = useCallback(() => {
    handleOpenInstall("local");
  }, [handleOpenInstall]);

  const handleCloseCreateMenu = useCallback(() => {
    setIsCreateMenuOpen(false);
  }, []);

  const handleToggleCreateMenu = useCallback(() => {
    if (isCreateMenuOpen) {
      setIsCreateMenuOpen(false);
      return;
    }

    const fallbackFrame = {
      x: Dimensions.get("window").width - 108,
      y: 48,
      width: 92,
      height: 36,
    };
    const maybeMeasurable = createButtonRef.current as
      | (View & {
          measureInWindow?: (
            callback: (x: number, y: number, width: number, height: number) => void,
          ) => void;
        })
      | null;

    if (!maybeMeasurable?.measureInWindow) {
      setCreateMenuFrame(fallbackFrame);
      setIsCreateMenuOpen(true);
      return;
    }

    maybeMeasurable.measureInWindow((x, y, width, height) => {
      setCreateMenuFrame({ x, y, width, height });
      setIsCreateMenuOpen(true);
    });
  }, [isCreateMenuOpen]);

  const createMenuSurfaceStyle = useMemo(() => {
    if (!createMenuFrame) return styles.createMenuSurface;
    const screenWidth = Dimensions.get("window").width;
    const maxLeft = Math.max(8, screenWidth - CREATE_MENU_WIDTH - 8);
    const left = Math.max(
      8,
      Math.min(createMenuFrame.x + createMenuFrame.width - CREATE_MENU_WIDTH, maxLeft),
    );
    const top = createMenuFrame.y + createMenuFrame.height + CREATE_MENU_GAP;
    return [styles.createMenuSurface, { left, top }];
  }, [createMenuFrame]);

  const createMenu = useMemo(() => {
    if (!isCreateMenuOpen) return null;
    return (
      <Modal
        transparent
        visible={isCreateMenuOpen}
        animationType="none"
        onRequestClose={handleCloseCreateMenu}
      >
        <View style={styles.createMenuOverlay}>
          <Pressable style={styles.createMenuBackdrop} onPress={handleCloseCreateMenu} />
          <View style={createMenuSurfaceStyle}>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={Download}
              style={styles.createMenuItem}
              onPress={handleOpenUrlInstall}
            >
              {t("settings.skills.installUrl")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={FolderInput}
              style={styles.createMenuItem}
              onPress={handleOpenLocalInstall}
            >
              {t("settings.skills.installLocal")}
            </Button>
          </View>
        </View>
      </Modal>
    );
  }, [
    createMenuSurfaceStyle,
    handleCloseCreateMenu,
    handleOpenLocalInstall,
    handleOpenUrlInstall,
    isCreateMenuOpen,
    t,
  ]);

  const createButton = useMemo(() => {
    return (
      <View ref={createButtonRef}>
        <Button size="sm" leftIcon={Plus} onPress={handleToggleCreateMenu}>
          {t("settings.skills.create")}
        </Button>
      </View>
    );
  }, [handleToggleCreateMenu, t]);

  const handleCloseInstall = useCallback(() => {
    setInstallMode(null);
    setInstallValue("");
  }, []);

  const handleInstallSubmit = useCallback(async () => {
    if (!client || !installMode || !installValue.trim()) return;
    setIsLoading(true);
    try {
      await client.installAgentSkills({
        source:
          installMode === "url"
            ? { type: "github", value: installValue.trim() }
            : { type: "local", path: installValue.trim() },
      });
      handleCloseInstall();
      await refresh();
    } catch (error) {
      reportError({
        error,
        logLabel: "[SkillsSettings] Failed to install skill",
        fallbackMessage: t("settings.skills.installFailed"),
      });
    } finally {
      setIsLoading(false);
    }
  }, [client, handleCloseInstall, installMode, installValue, refresh, reportError, t]);

  const handleUninstall = useCallback(
    async (sourceId: string) => {
      if (!client) return;
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(t("settings.skills.uninstallTitle"), t("settings.skills.uninstallMessage"), [
          { text: t("common.cancel"), style: "cancel", onPress: () => resolve(false) },
          {
            text: t("settings.skills.uninstall"),
            style: "destructive",
            onPress: () => resolve(true),
          },
        ]);
      });
      if (!confirmed) return;
      setIsLoading(true);
      try {
        await client.uninstallAgentSkill({ sourceId });
        await refresh();
      } catch (error) {
        reportError({
          error,
          logLabel: "[SkillsSettings] Failed to uninstall skill",
          fallbackMessage: t("settings.skills.uninstallFailed"),
        });
      } finally {
        setIsLoading(false);
      }
    },
    [client, refresh, reportError, t],
  );

  const selectedScopeLabel = useMemo(() => {
    if (selectedScope.type === "global") return t("settings.skills.all");
    const scope = scopes.find((entry) =>
      selectedScope.type === "provider"
        ? entry.type === "provider" && entry.provider === selectedScope.provider
        : entry.type === "agent" && entry.agentId === selectedScope.agentId,
    );
    if (scope?.label) return scope.label;
    return selectedScope.type === "provider" ? selectedScope.provider : selectedScope.agentId;
  }, [scopes, selectedScope, t]);

  const installModalHeader = useMemo(
    () => ({
      title:
        installMode === "url"
          ? t("settings.skills.installUrlTitle")
          : t("settings.skills.installLocalTitle"),
    }),
    [installMode, t],
  );
  const installModalFooter = useMemo(
    () => (
      <View style={styles.modalFooter}>
        <Button variant="ghost" onPress={handleCloseInstall}>
          {t("common.cancel")}
        </Button>
        <Button onPress={handleInstallSubmit} disabled={!installValue.trim() || isLoading}>
          {t("settings.skills.install")}
        </Button>
      </View>
    ),
    [handleCloseInstall, handleInstallSubmit, installValue, isLoading, t],
  );

  const headerActions = useMemo(
    () => (
      <View style={styles.headerActions}>
        <Button variant="ghost" size="sm" leftIcon={RefreshCw} onPress={refresh}>
          {t("settings.skills.refresh")}
        </Button>
        {createButton}
        {createMenu}
      </View>
    ),
    [createButton, createMenu, refresh, t],
  );
  const scopeButtons = useMemo<ScopeButtonItem[]>(() => {
    const buttons: ScopeButtonItem[] = [
      { value: { type: "global" }, label: t("settings.skills.all") },
    ];
    for (const scope of scopes) {
      if (scope.type === "global") continue;
      if (scope.type === "provider") {
        buttons.push({
          value: { type: "provider", provider: scope.provider },
          label: scope.label,
        });
        continue;
      }
      buttons.push({
        value: { type: "agent", agentId: scope.agentId },
        label: scope.label,
      });
    }
    return buttons;
  }, [scopes, t]);

  const filteredSkills = useMemo(
    () => skills.filter((skill) => skillMatchesQuery(skill, searchValue)),
    [searchValue, skills],
  );

  let skillContent: ReactNode;
  if (isLoading) {
    skillContent = (
      <View style={settingsStyles.row}>
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
      </View>
    );
  } else if (filteredSkills.length === 0) {
    skillContent = (
      <View style={settingsStyles.row}>
        <Text style={settingsStyles.rowHint}>
          {skills.length === 0 ? t("settings.skills.empty") : t("settings.skills.noSearchResults")}
        </Text>
      </View>
    );
  } else {
    skillContent = filteredSkills.map((skill, index) => (
      <SkillRow
        key={skill.name}
        skill={skill}
        index={index}
        selectedScope={selectedScope}
        working={workingSkill === skill.name}
        onToggle={handleToggle}
        onUninstall={handleUninstall}
      />
    ));
  }

  if (!connected) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>{t("settings.skills.noHost")}</Text>
      </View>
    );
  }

  return (
    <SettingsSection title={t("settings.skills.title")} trailing={headerActions}>
      <View style={styles.mainColumn}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scopeList}
          style={styles.scopeScroller}
        >
          {scopeButtons.map((scope) => (
            <ScopeButton
              key={scopeKey(scope.value)}
              scope={scope.value}
              label={scope.label}
              selected={sameScope(scope.value, selectedScope)}
              onSelect={setSelectedScope}
            />
          ))}
        </ScrollView>
        <View style={styles.contentToolbar}>
          <View style={styles.searchBox}>
            <ThemedSearch size={16} uniProps={foregroundMutedColorMapping} />
            <ThemedTextInput
              value={searchValue}
              onChangeText={setSearchValue}
              placeholder={t("settings.skills.searchPlaceholder")}
              uniProps={placeholderTextColorMapping}
              style={styles.searchInput}
            />
          </View>
        </View>
        <Text style={styles.scopeTitle}>{selectedScopeLabel}</Text>
        <View style={settingsStyles.card}>{skillContent}</View>
      </View>
      <AdaptiveModalSheet
        visible={installMode !== null}
        onClose={handleCloseInstall}
        header={installModalHeader}
        desktopMaxWidth={520}
        footer={installModalFooter}
      >
        <ThemedTextInput
          value={installValue}
          onChangeText={setInstallValue}
          placeholder={
            installMode === "url"
              ? t("settings.skills.urlPlaceholder")
              : t("settings.skills.localPlaceholder")
          }
          uniProps={placeholderTextColorMapping}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </AdaptiveModalSheet>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  placeholder: {
    padding: theme.spacing[6],
  },
  placeholderText: {
    color: theme.colors.foregroundMuted,
  },
  scopeScroller: {
    flexGrow: 0,
  },
  scopeList: {
    flexDirection: "row",
    gap: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  scopeButton: {
    minWidth: 92,
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  createMenuOverlay: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  createMenuBackdrop: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  createMenuSurface: {
    // Soft floating menu: r14 card + quiet Soft-ink shadow.
    backgroundColor: theme.colors.surface0,
    borderColor: theme.colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: theme.spacing[1],
    overflow: "hidden",
    padding: theme.spacing[2],
    position: "absolute",
    width: CREATE_MENU_WIDTH,
    zIndex: 1,
    ...theme.shadow.sm,
  },
  createMenuItem: {
    justifyContent: "flex-start",
    width: "100%",
  },
  mainColumn: {
    flex: 1,
    gap: theme.spacing[3],
  },
  contentToolbar: {
    flexDirection: "row",
  },
  searchBox: {
    alignItems: "center",
    borderColor: theme.colors.border,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: theme.colors.surface0,
    flexDirection: "row",
    gap: theme.spacing[2],
    maxWidth: 320,
    minHeight: 36,
    paddingHorizontal: theme.spacing[3],
    width: "100%",
  },
  input: {
    minHeight: 34,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    paddingHorizontal: theme.spacing[3],
  },
  searchInput: {
    color: theme.colors.foreground,
    flex: 1,
    minHeight: 34,
    paddingVertical: 0,
  },
  modalFooter: {
    flexDirection: "row",
    gap: theme.spacing[2],
    justifyContent: "flex-end",
  },
  scopeTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    marginTop: theme.spacing[1],
  },
  rowActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[2],
  },
}));
