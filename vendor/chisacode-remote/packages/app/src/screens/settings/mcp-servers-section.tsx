/* eslint-disable react-hooks/exhaustive-deps */
import React, { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  // Alert.alert is retained for blocking confirm dialogs (e.g. server removal);
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
import { Edit3, Globe2, Plus, RefreshCw, Search, Terminal, Trash2 } from "lucide-react-native";
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
  AgentMcpServerPayload,
  AgentMcpServerScopePayload,
  AgentMcpServerStatus,
  McpServerManagementConfig,
  ManagedMcpServerConfig,
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

type FormMode = "stdio" | "url";
type UrlServerType = "http" | "sse";

interface CreateMenuFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface McpServersSectionProps {
  serverId: string;
}

interface ServerFormState {
  originalName: string | null;
  mode: FormMode;
  name: string;
  label: string;
  description: string;
  command: string;
  argsText: string;
  envText: string;
  urlType: UrlServerType;
  url: string;
  headersText: string;
}

const CREATE_MENU_WIDTH = 240;
const CREATE_MENU_GAP = 8;

function sameScope(a: SelectedScope, b: SelectedScope): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "global") return true;
  if (a.type === "provider" && b.type === "provider") return a.provider === b.provider;
  if (a.type === "agent" && b.type === "agent") return a.agentId === b.agentId;
  return false;
}

function statusForScope(server: AgentMcpServerPayload, scope: SelectedScope): AgentMcpServerStatus {
  if (scope.type === "global") return server.statusByScope.global;
  if (scope.type === "provider") {
    return server.statusByScope.providers?.[scope.provider] ?? server.statusByScope.global;
  }
  return server.statusByScope.agents[scope.agentId] ?? server.statusByScope.global;
}

function isEnabled(status: AgentMcpServerStatus): boolean {
  return status === "enabled" || status === "provider-enabled" || status === "agent-enabled";
}

function withoutName(values: readonly string[], name: string): string[] {
  return values.filter((value) => value !== name);
}

function withName(values: readonly string[], name: string): string[] {
  return [...new Set([...values, name])].sort();
}

function statusLabel(status: AgentMcpServerStatus): string {
  switch (status) {
    case "agent-disabled":
      return "Agent disabled";
    case "agent-enabled":
      return "Agent enabled";
    case "provider-disabled":
      return "Provider disabled";
    case "provider-enabled":
      return "Provider enabled";
    case "global-disabled":
      return "Global disabled";
    case "enabled":
      return "Enabled";
  }
}

function configSummary(server: AgentMcpServerPayload, t: (key: string) => string): string {
  if (server.source === "system") return t("mcpServers.systemSource");
  if (server.config.type === "stdio") return `stdio · ${server.config.command}`;
  return `${server.config.type.toUpperCase()} · ${server.config.url}`;
}

function serverMatchesQuery(server: AgentMcpServerPayload, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const configText =
    server.config.type === "stdio"
      ? [server.config.command, ...(server.config.args ?? [])].join("\n")
      : server.config.url;
  const haystack = [
    server.name,
    server.label ?? "",
    server.description ?? "",
    server.source,
    server.config.type,
    configText,
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(needle);
}

function parseRecordJson(
  value: string,
  fieldName: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): Record<string, string> | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(t("mcpServers.fieldMustBeJsonObject", { field: fieldName }));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(t("mcpServers.fieldMustBeJsonObject", { field: fieldName }));
  }
  const record: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(parsed)) {
    if (typeof rawValue !== "string")
      throw new Error(t("mcpServers.fieldValueMustBeString", { field: fieldName }));
    record[key] = rawValue;
  }
  return record;
}

function formFromServer(server: AgentMcpServerPayload): ServerFormState {
  const common = {
    originalName: server.name,
    name: server.name,
    label: server.label ?? "",
    description: server.description ?? "",
  };
  if (server.config.type === "stdio") {
    return {
      ...common,
      mode: "stdio",
      command: server.config.command,
      argsText: (server.config.args ?? []).join("\n"),
      envText: server.config.env ? JSON.stringify(server.config.env, null, 2) : "",
      urlType: "http",
      url: "",
      headersText: "",
    };
  }
  return {
    ...common,
    mode: "url",
    command: "",
    argsText: "",
    envText: "",
    urlType: server.config.type,
    url: server.config.url,
    headersText: server.config.headers ? JSON.stringify(server.config.headers, null, 2) : "",
  };
}

function emptyForm(mode: FormMode): ServerFormState {
  return {
    originalName: null,
    mode,
    name: "",
    label: "",
    description: "",
    command: "",
    argsText: "",
    envText: "",
    urlType: "http",
    url: "",
    headersText: "",
  };
}

function formTitle(form: ServerFormState | null, t: (key: string) => string): string {
  if (form?.originalName) return t("settings.mcpServers.editTitle");
  if (form?.mode === "stdio") return t("settings.mcpServers.createStdioTitle");
  return t("settings.mcpServers.createUrlTitle");
}

function serverFromForm(
  form: ServerFormState,
  t: (key: string, options?: Record<string, unknown>) => string,
): ManagedMcpServerConfig {
  const name = form.name.trim();
  if (!name) throw new Error(t("mcpServers.enterServerName"));
  const base = {
    name,
    ...(form.label.trim() ? { label: form.label.trim() } : {}),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
  };
  if (form.mode === "stdio") {
    if (!form.command.trim()) throw new Error(t("mcpServers.enterStdioCommand"));
    const args = form.argsText
      .split(/\r?\n/u)
      .map((arg) => arg.trim())
      .filter(Boolean);
    const env = parseRecordJson(form.envText, t("mcpServers.envVariables"), t);
    return {
      ...base,
      config: {
        type: "stdio",
        command: form.command.trim(),
        ...(args.length > 0 ? { args } : {}),
        ...(env ? { env } : {}),
      },
    };
  }
  if (!form.url.trim()) throw new Error(t("mcpServers.enterUrl"));
  const headers = parseRecordJson(form.headersText, t("mcpServers.headers"), t);
  return {
    ...base,
    config: {
      type: form.urlType,
      url: form.url.trim(),
      ...(headers ? { headers } : {}),
    },
  };
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

interface McpServerRowProps {
  server: AgentMcpServerPayload;
  index: number;
  selectedScope: SelectedScope;
  working: boolean;
  onToggle: (server: AgentMcpServerPayload, value: boolean) => void;
  onEdit: (server: AgentMcpServerPayload) => void;
  onDelete: (server: AgentMcpServerPayload) => void;
}

function McpServerRow({
  server,
  index,
  selectedScope,
  working,
  onToggle,
  onEdit,
  onDelete,
}: McpServerRowProps) {
  const { t } = useTranslation();
  const status = statusForScope(server, selectedScope);
  const rowStyle = useMemo(
    () => [settingsStyles.row, index > 0 ? settingsStyles.rowBorder : null],
    [index],
  );
  const handleToggle = useCallback((value: boolean) => onToggle(server, value), [onToggle, server]);
  const handleEdit = useCallback(() => onEdit(server), [onEdit, server]);
  const handleDelete = useCallback(() => onDelete(server), [onDelete, server]);

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{server.label || server.name}</Text>
        <Text style={settingsStyles.rowHint}>{configSummary(server, t)}</Text>
        {server.description ? (
          <Text style={settingsStyles.rowHint}>{server.description}</Text>
        ) : null}
        <Text style={styles.statusText}>
          {statusLabel(status)} · {t("settings.mcpServers.nextLoad")}
        </Text>
      </View>
      <View style={styles.rowActions}>
        {server.editable ? (
          <Button variant="ghost" size="sm" leftIcon={Edit3} onPress={handleEdit}>
            {t("settings.mcpServers.edit")}
          </Button>
        ) : null}
        {server.removable ? (
          <Button variant="ghost" size="sm" leftIcon={Trash2} onPress={handleDelete}>
            {t("settings.mcpServers.delete")}
          </Button>
        ) : null}
        <Switch value={isEnabled(status)} disabled={working} onValueChange={handleToggle} />
      </View>
    </View>
  );
}

export function McpServersSection({ serverId }: McpServersSectionProps) {
  const { t } = useTranslation();
  const reportError = useUserVisibleErrorReporter();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const [scopes, setScopes] = useState<AgentMcpServerScopePayload[]>([]);
  const [servers, setServers] = useState<AgentMcpServerPayload[]>([]);
  const [policy, setPolicy] = useState<McpServerManagementConfig | null>(null);
  const [selectedScope, setSelectedScope] = useState<SelectedScope>({ type: "global" });
  const [isLoading, setIsLoading] = useState(false);
  const [workingServer, setWorkingServer] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [form, setForm] = useState<ServerFormState | null>(null);
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [createMenuFrame, setCreateMenuFrame] = useState<CreateMenuFrame | null>(null);
  const createButtonRef = useRef<View>(null);

  const refresh = useCallback(async () => {
    if (!client || !connected) return;
    setIsLoading(true);
    try {
      const response = await client.listAgentMcpServers();
      setScopes(response.scopes);
      setServers(response.servers);
      setPolicy(response.policy);
      if (
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
        logLabel: "[McpSettings] Failed to load MCP servers",
        fallbackMessage: t("settings.mcpServers.loadFailed"),
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
    async (server: AgentMcpServerPayload, nextValue: boolean) => {
      if (!client || !policy) return;
      setWorkingServer(server.name);
      try {
        if (selectedScope.type === "global") {
          const disabledServerNames = nextValue
            ? withoutName(policy.global.disabledServerNames, server.name)
            : withName(policy.global.disabledServerNames, server.name);
          const response = await client.patchAgentMcpServerPolicy({
            scope: { type: "global" },
            policy: { disabledServerNames },
          });
          setPolicy(response.policy);
        } else {
          const current =
            selectedScope.type === "provider"
              ? (policy.providers[selectedScope.provider] ?? {
                  enabledServerNames: [],
                  disabledServerNames: [],
                })
              : (policy.agents[selectedScope.agentId] ?? {
                  enabledServerNames: [],
                  disabledServerNames: [],
                });
          const enabledServerNames = nextValue
            ? withName(current.enabledServerNames, server.name)
            : withoutName(current.enabledServerNames, server.name);
          const disabledServerNames = nextValue
            ? withoutName(current.disabledServerNames, server.name)
            : withName(current.disabledServerNames, server.name);
          const response = await client.patchAgentMcpServerPolicy({
            scope:
              selectedScope.type === "provider"
                ? { type: "provider", provider: selectedScope.provider }
                : { type: "agent", agentId: selectedScope.agentId },
            policy: { enabledServerNames, disabledServerNames },
          });
          setPolicy(response.policy);
        }
      } catch (error) {
        reportError({
          error,
          logLabel: "[McpSettings] Failed to update MCP server policy",
          fallbackMessage: t("settings.mcpServers.saveFailed"),
        });
      } finally {
        setWorkingServer(null);
      }
    },
    [client, policy, reportError, selectedScope, t],
  );

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

  const handleCreateStdio = useCallback(() => {
    setIsCreateMenuOpen(false);
    setForm(emptyForm("stdio"));
  }, []);

  const handleCreateUrl = useCallback(() => {
    setIsCreateMenuOpen(false);
    setForm(emptyForm("url"));
  }, []);

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
              leftIcon={Terminal}
              style={styles.createMenuItem}
              onPress={handleCreateStdio}
            >
              {t("settings.mcpServers.createStdio")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={Globe2}
              style={styles.createMenuItem}
              onPress={handleCreateUrl}
            >
              {t("settings.mcpServers.createUrl")}
            </Button>
          </View>
        </View>
      </Modal>
    );
  }, [
    createMenuSurfaceStyle,
    handleCloseCreateMenu,
    handleCreateStdio,
    handleCreateUrl,
    isCreateMenuOpen,
    t,
  ]);

  const createButton = useMemo(
    () => (
      <View ref={createButtonRef}>
        <Button size="sm" leftIcon={Plus} onPress={handleToggleCreateMenu}>
          {t("settings.mcpServers.create")}
        </Button>
      </View>
    ),
    [handleToggleCreateMenu, t],
  );

  const handleEdit = useCallback((server: AgentMcpServerPayload) => {
    setForm(formFromServer(server));
  }, []);

  const handleDelete = useCallback(
    async (server: AgentMcpServerPayload) => {
      if (!client || !server.removable) return;
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          t("settings.mcpServers.deleteTitle"),
          t("settings.mcpServers.deleteMessage", { name: server.label || server.name }),
          [
            { text: t("common.cancel"), style: "cancel", onPress: () => resolve(false) },
            {
              text: t("settings.mcpServers.delete"),
              style: "destructive",
              onPress: () => resolve(true),
            },
          ],
        );
      });
      if (!confirmed) return;
      setIsLoading(true);
      try {
        await client.deleteAgentMcpServer({ name: server.name });
        await refresh();
      } catch (error) {
        reportError({
          error,
          logLabel: `[McpSettings] Failed to delete MCP server ${server.name}`,
          fallbackMessage: t("settings.mcpServers.deleteFailed"),
        });
      } finally {
        setIsLoading(false);
      }
    },
    [client, refresh, reportError, t],
  );

  const handleCloseForm = useCallback(() => {
    setForm(null);
  }, []);

  const handleSaveForm = useCallback(async () => {
    if (!client || !form) return;
    setIsLoading(true);
    try {
      const server = serverFromForm(form, t);
      const response = await client.upsertAgentMcpServer({
        server,
        ...(form.originalName ? { originalName: form.originalName } : {}),
      });
      if (!response.ok) throw new Error(response.error ?? t("settings.mcpServers.saveFailed"));
      setForm(null);
      await refresh();
    } catch (error) {
      reportError({
        error,
        logLabel: "[McpSettings] Failed to save MCP server",
        fallbackMessage: t("settings.mcpServers.saveFailed"),
      });
    } finally {
      setIsLoading(false);
    }
  }, [client, form, refresh, reportError, t]);

  const selectedScopeLabel = useMemo(() => {
    if (selectedScope.type === "global") return t("settings.mcpServers.all");
    const scope = scopes.find((entry) =>
      selectedScope.type === "provider"
        ? entry.type === "provider" && entry.provider === selectedScope.provider
        : entry.type === "agent" && entry.agentId === selectedScope.agentId,
    );
    if (scope?.label) return scope.label;
    return selectedScope.type === "provider" ? selectedScope.provider : selectedScope.agentId;
  }, [scopes, selectedScope, t]);

  const headerActions = useMemo(
    () => (
      <View style={styles.headerActions}>
        <Button variant="ghost" size="sm" leftIcon={RefreshCw} onPress={refresh}>
          {t("settings.mcpServers.refresh")}
        </Button>
        {createButton}
        {createMenu}
      </View>
    ),
    [createButton, createMenu, refresh, t],
  );

  const scopeButtons = useMemo(
    () => [
      { value: { type: "global" as const }, label: t("settings.mcpServers.all") },
      ...scopes
        .filter((scope) => scope.type === "provider")
        .map((scope) => ({
          value: { type: "provider" as const, provider: scope.provider },
          label: scope.label,
        })),
    ],
    [scopes, t],
  );

  const filteredServers = useMemo(
    () => servers.filter((server) => serverMatchesQuery(server, searchValue)),
    [searchValue, servers],
  );

  const setUrlTypeHttp = useCallback(() => {
    setForm((value) => (value ? { ...value, urlType: "http" } : value));
  }, []);

  const setUrlTypeSse = useCallback(() => {
    setForm((value) => (value ? { ...value, urlType: "sse" } : value));
  }, []);

  const updateFormName = useCallback((value: string) => {
    setForm((current) => (current ? { ...current, name: value } : current));
  }, []);
  const updateFormLabel = useCallback((value: string) => {
    setForm((current) => (current ? { ...current, label: value } : current));
  }, []);
  const updateFormDescription = useCallback((value: string) => {
    setForm((current) => (current ? { ...current, description: value } : current));
  }, []);
  const updateFormCommand = useCallback((value: string) => {
    setForm((current) => (current ? { ...current, command: value } : current));
  }, []);
  const updateFormArgs = useCallback((value: string) => {
    setForm((current) => (current ? { ...current, argsText: value } : current));
  }, []);
  const updateFormEnv = useCallback((value: string) => {
    setForm((current) => (current ? { ...current, envText: value } : current));
  }, []);
  const updateFormUrl = useCallback((value: string) => {
    setForm((current) => (current ? { ...current, url: value } : current));
  }, []);
  const updateFormHeaders = useCallback((value: string) => {
    setForm((current) => (current ? { ...current, headersText: value } : current));
  }, []);

  const formHeader = useMemo(
    () => ({
      title: formTitle(form, t),
    }),
    [form, t],
  );

  const formFooter = useMemo(
    () => (
      <View style={styles.modalFooter}>
        <Button variant="ghost" onPress={handleCloseForm}>
          {t("common.cancel")}
        </Button>
        <Button onPress={handleSaveForm} disabled={!form?.name.trim() || isLoading}>
          {t("common.save")}
        </Button>
      </View>
    ),
    [form?.name, handleCloseForm, handleSaveForm, isLoading, t],
  );

  let serverContent: ReactNode;
  if (isLoading) {
    serverContent = (
      <View style={settingsStyles.row}>
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
      </View>
    );
  } else if (filteredServers.length === 0) {
    serverContent = (
      <View style={settingsStyles.row}>
        <Text style={settingsStyles.rowHint}>
          {servers.length === 0
            ? t("settings.mcpServers.empty")
            : t("settings.mcpServers.noSearchResults")}
        </Text>
      </View>
    );
  } else {
    serverContent = filteredServers.map((server, index) => (
      <McpServerRow
        key={server.name}
        server={server}
        index={index}
        selectedScope={selectedScope}
        working={workingServer === server.name}
        onToggle={handleToggle}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
    ));
  }

  if (!connected) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>{t("settings.mcpServers.noHost")}</Text>
      </View>
    );
  }

  return (
    <SettingsSection title={t("settings.mcpServers.title")} trailing={headerActions}>
      <View style={styles.mainColumn}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scopeList}
          style={styles.scopeScroller}
        >
          {scopeButtons.map((scope) => (
            <ScopeButton
              key={scope.value.type === "global" ? "global" : scope.value.provider}
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
              placeholder={t("settings.mcpServers.searchPlaceholder")}
              uniProps={placeholderTextColorMapping}
              style={styles.searchInput}
            />
          </View>
        </View>
        <Text style={styles.scopeTitle}>{selectedScopeLabel}</Text>
        <View style={settingsStyles.card}>{serverContent}</View>
      </View>
      <AdaptiveModalSheet
        visible={form !== null}
        onClose={handleCloseForm}
        header={formHeader}
        desktopMaxWidth={560}
        footer={formFooter}
      >
        {form ? (
          <View style={styles.formStack}>
            <ThemedTextInput
              value={form.name}
              onChangeText={updateFormName}
              placeholder={t("settings.mcpServers.namePlaceholder")}
              uniProps={placeholderTextColorMapping}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <ThemedTextInput
              value={form.label}
              onChangeText={updateFormLabel}
              placeholder={t("settings.mcpServers.labelPlaceholder")}
              uniProps={placeholderTextColorMapping}
              style={styles.input}
            />
            <ThemedTextInput
              value={form.description}
              onChangeText={updateFormDescription}
              placeholder={t("settings.mcpServers.descriptionPlaceholder")}
              uniProps={placeholderTextColorMapping}
              style={styles.input}
            />
            {form.mode === "stdio" ? (
              <>
                <ThemedTextInput
                  value={form.command}
                  onChangeText={updateFormCommand}
                  placeholder={t("settings.mcpServers.commandPlaceholder")}
                  uniProps={placeholderTextColorMapping}
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <ThemedTextInput
                  value={form.argsText}
                  onChangeText={updateFormArgs}
                  placeholder={t("settings.mcpServers.argsPlaceholder")}
                  uniProps={placeholderTextColorMapping}
                  style={styles.textArea}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <ThemedTextInput
                  value={form.envText}
                  onChangeText={updateFormEnv}
                  placeholder={t("settings.mcpServers.envPlaceholder")}
                  uniProps={placeholderTextColorMapping}
                  style={styles.textArea}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            ) : (
              <>
                <View style={styles.segmentedControl}>
                  <Button
                    size="sm"
                    variant={form.urlType === "http" ? "default" : "ghost"}
                    onPress={setUrlTypeHttp}
                  >
                    HTTP
                  </Button>
                  <Button
                    size="sm"
                    variant={form.urlType === "sse" ? "default" : "ghost"}
                    onPress={setUrlTypeSse}
                  >
                    SSE
                  </Button>
                </View>
                <ThemedTextInput
                  value={form.url}
                  onChangeText={updateFormUrl}
                  placeholder={t("settings.mcpServers.urlPlaceholder")}
                  uniProps={placeholderTextColorMapping}
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <ThemedTextInput
                  value={form.headersText}
                  onChangeText={updateFormHeaders}
                  placeholder={t("settings.mcpServers.headersPlaceholder")}
                  uniProps={placeholderTextColorMapping}
                  style={styles.textArea}
                  multiline
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            )}
          </View>
        ) : null}
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
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: theme.spacing[2],
    maxWidth: 320,
    minHeight: 36,
    paddingHorizontal: theme.spacing[3],
    width: "100%",
  },
  searchInput: {
    color: theme.colors.foreground,
    flex: 1,
    minHeight: 34,
    paddingVertical: 0,
  },
  input: {
    minHeight: 34,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    color: theme.colors.foreground,
    paddingHorizontal: theme.spacing[3],
  },
  textArea: {
    minHeight: 84,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    color: theme.colors.foreground,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  formStack: {
    gap: theme.spacing[3],
  },
  segmentedControl: {
    flexDirection: "row",
    gap: theme.spacing[2],
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
