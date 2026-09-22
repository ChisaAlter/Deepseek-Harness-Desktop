import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { router, type Href } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronDown, MoreVertical, Pencil, Plus, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ProjectIconView } from "@/components/project-icon-view";
import { projectIconToDataUri, useProjectIconQuery } from "@/hooks/use-project-icon-query";
import type {
  ChisaCodeConfigRaw,
  ChisaCodeConfigRevision,
  ProjectConfigRpcError,
} from "@chisacode/protocol/messages";
import type { DaemonClient } from "@chisacode/client/internal/daemon-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Alert } from "@/components/ui/alert";
import { ExternalLink } from "@/components/ui/external-link";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Switch } from "@/components/ui/switch";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { SettingsGroup } from "@/screens/settings/settings-group";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useProjects } from "@/hooks/use-projects";
import { useHostRuntimeClient, useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  applyDraftToConfig,
  configToDraft,
  METADATA_PROMPT_KEYS,
  type LifecycleOriginalKind,
  type MetadataPromptKey,
  type ProjectConfigDraft,
  type ProjectScriptDraft,
} from "@/utils/project-config-form";
import { buildProjectsSettingsRoute } from "@/utils/host-routes";
import type { ProjectHostEntry, ProjectSummary } from "@/utils/projects";

const SCRIPT_SERVICE_TYPE = "service";

const ICON_SIZE = 14;

interface MetadataPromptField {
  titleKey: string;
  placeholderKey: string;
  sectionTestID: string;
  inputTestID: string;
}

const METADATA_PROMPT_FIELDS: Record<MetadataPromptKey, MetadataPromptField> = {
  agentTitle: {
    titleKey: "projectSettings.metadata.agentTitle",
    placeholderKey: "projectSettings.metadata.agentTitlePlaceholder",
    sectionTestID: "metadata-prompt-agent-title-section",
    inputTestID: "metadata-prompt-agent-title-input",
  },
  branchName: {
    titleKey: "projectSettings.metadata.branchName",
    placeholderKey: "projectSettings.metadata.branchNamePlaceholder",
    sectionTestID: "metadata-prompt-branch-name-section",
    inputTestID: "metadata-prompt-branch-name-input",
  },
  commitMessage: {
    titleKey: "projectSettings.metadata.commitMessage",
    placeholderKey: "projectSettings.metadata.commitMessagePlaceholder",
    sectionTestID: "metadata-prompt-commit-message-section",
    inputTestID: "metadata-prompt-commit-message-input",
  },
  pullRequest: {
    titleKey: "projectSettings.metadata.pullRequest",
    placeholderKey: "projectSettings.metadata.pullRequestPlaceholder",
    sectionTestID: "metadata-prompt-pull-request-section",
    inputTestID: "metadata-prompt-pull-request-input",
  },
};

const WORKTREE_DOCS_URL = "https://chisacode.sh/docs/worktrees";

type ReadProjectConfigData = Awaited<ReturnType<DaemonClient["readProjectConfig"]>>;
type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface ProjectSettingsScreenProps {
  projectKey: string;
  returnTo?: string | null;
}

export default function ProjectSettingsScreen({
  projectKey,
  returnTo,
}: ProjectSettingsScreenProps) {
  const { projects } = useProjects();
  const project = useMemo(
    () => projects.find((entry) => entry.projectKey === projectKey),
    [projects, projectKey],
  );
  const editableHosts = useMemo(() => filterEditableHosts(project), [project]);

  const [selectedServerId, setSelectedServerId] = useState<string>(
    () => editableHosts[0]?.serverId ?? "",
  );

  useEffect(() => {
    const stillValid = editableHosts.some((host) => host.serverId === selectedServerId);
    if (!stillValid) {
      setSelectedServerId(editableHosts[0]?.serverId ?? "");
    }
  }, [editableHosts, selectedServerId]);

  const selectedSnapshot = useHostRuntimeSnapshot(selectedServerId);
  const isHostGone =
    Boolean(selectedServerId) &&
    (selectedSnapshot?.connectionStatus === "offline" ||
      selectedSnapshot?.connectionStatus === "error");

  const selectedHost = editableHosts.find((host) => host.serverId === selectedServerId);
  const client = useHostRuntimeClient(selectedHost?.serverId ?? "");

  if (!project || editableHosts.length === 0 || !selectedHost || !client) {
    return <NoEditableTarget returnTo={returnTo} />;
  }

  return (
    <ProjectSettingsBody
      project={project}
      hosts={editableHosts}
      selectedHost={selectedHost}
      onSelectHost={setSelectedServerId}
      client={client}
      isHostGone={isHostGone}
      returnTo={returnTo}
    />
  );
}

function filterEditableHosts(project: ProjectSummary | undefined): ProjectHostEntry[] {
  if (!project) return [];
  return project.hosts.filter(
    (host) => host.isOnline && host.serverId.trim().length > 0 && host.repoRoot.trim().length > 0,
  );
}

function navigateBackToProjects(returnTo?: string | null) {
  router.navigate(buildProjectsSettingsRoute({ returnTo }) as Href);
}

function NoEditableTarget({ returnTo }: { returnTo?: string | null }) {
  const { t } = useTranslation();
  const handleBack = useCallback(() => navigateBackToProjects(returnTo), [returnTo]);
  return (
    <View style={styles.noTargetContainer}>
      <BackToProjectsButton returnTo={returnTo} />
      <Text style={styles.noTargetText}>{t("projectSettings.noEditableTarget")}</Text>
      <Button
        testID="project-settings-back-button"
        onPress={handleBack}
        variant="secondary"
        size="md"
      >
        {t("projectSettings.backToProjects")}
      </Button>
    </View>
  );
}

function BackToProjectsButton({ returnTo }: { returnTo?: string | null }) {
  const { t } = useTranslation();
  const handleBack = useCallback(() => navigateBackToProjects(returnTo), [returnTo]);
  return (
    <Button
      testID="project-settings-back-link"
      accessibilityLabel={t("projectSettings.backToProjects")}
      onPress={handleBack}
      variant="ghost"
      size="sm"
      leftIcon={ArrowLeft}
      style={styles.backButton}
    >
      {t("projectSettings.backToProjects")}
    </Button>
  );
}

interface ProjectSettingsBodyProps {
  project: ProjectSummary;
  hosts: ProjectHostEntry[];
  selectedHost: ProjectHostEntry;
  onSelectHost: (serverId: string) => void;
  client: DaemonClient;
  isHostGone: boolean;
  returnTo?: string | null;
}

function ProjectSettingsBody({
  project,
  hosts,
  selectedHost,
  onSelectHost,
  client,
  isHostGone,
  returnTo,
}: ProjectSettingsBodyProps) {
  const queryKey = useMemo(
    () => ["project-config", selectedHost.serverId, selectedHost.repoRoot] as const,
    [selectedHost.serverId, selectedHost.repoRoot],
  );

  const readQuery = useQuery({
    queryKey,
    queryFn: () => client.readProjectConfig(selectedHost.repoRoot),
    retry: false,
  });

  const data = readQuery.data;
  const loadedConfig: ChisaCodeConfigRaw | null = data?.ok ? (data.config ?? {}) : null;
  const loadedRevision: ChisaCodeConfigRevision | null = data?.ok ? data.revision : null;
  const readError: ProjectConfigRpcError | null = data && !data.ok ? data.error : null;

  const handleReload = useCallback(() => {
    void readQuery.refetch();
  }, [readQuery]);

  const hasMultipleHosts = hosts.length > 1;

  return (
    <View style={styles.body}>
      <BackToProjectsButton returnTo={returnTo} />

      <View style={styles.headerBlock}>
        <View style={styles.titleRow}>
          <ProjectTitleIcon
            host={selectedHost}
            projectName={project.projectName}
            projectKey={project.projectKey}
          />
          <ProjectNameEditor project={project} client={client} />
        </View>
        <HostContext hosts={hosts} selectedHost={selectedHost} onSelectHost={onSelectHost} />
      </View>

      {renderContent({
        readQuery,
        loadedConfig,
        loadedRevision,
        readError,
        selectedHost,
        queryKey,
        client,
        onReload: handleReload,
        hasMultipleHosts,
        isHostGone,
        returnTo,
      })}
    </View>
  );
}

interface RenderContentInput {
  readQuery: ReturnType<typeof useQuery<ReadProjectConfigData>>;
  loadedConfig: ChisaCodeConfigRaw | null;
  loadedRevision: ChisaCodeConfigRevision | null;
  readError: ProjectConfigRpcError | null;
  selectedHost: ProjectHostEntry;
  queryKey: readonly [string, string, string];
  client: DaemonClient;
  onReload: () => void;
  hasMultipleHosts: boolean;
  isHostGone: boolean;
  returnTo?: string | null;
}

function renderContent({
  readQuery,
  loadedConfig,
  loadedRevision,
  readError,
  selectedHost,
  queryKey,
  client,
  onReload,
  hasMultipleHosts,
  isHostGone,
  returnTo,
}: RenderContentInput) {
  if (readQuery.isLoading) {
    return (
      <View style={styles.centered}>
        <LoadingSpinner color={ResolveSpinnerColor()} />
      </View>
    );
  }

  if (readQuery.isError) {
    return (
      <ReadFailureCallout
        kind="transport"
        error={readQuery.error}
        onReload={onReload}
        hasMultipleHosts={hasMultipleHosts}
      />
    );
  }

  if (readError) {
    return (
      <ReadFailureCallout
        kind={readError.code}
        error={null}
        onReload={onReload}
        hasMultipleHosts={hasMultipleHosts}
      />
    );
  }

  if (isHostGone) {
    return <NoEditableTarget returnTo={returnTo} />;
  }

  if (!loadedConfig) {
    return (
      <View style={styles.centered}>
        <LoadingSpinner color={ResolveSpinnerColor()} />
      </View>
    );
  }

  const formKey = `${selectedHost.serverId}::${selectedHost.repoRoot}::${revisionToKey(loadedRevision)}`;
  return (
    <ProjectConfigForm
      key={formKey}
      baseConfig={loadedConfig}
      revision={loadedRevision}
      repoRoot={selectedHost.repoRoot}
      queryKey={queryKey}
      client={client}
      onReload={onReload}
    />
  );
}

function revisionToKey(revision: ChisaCodeConfigRevision | null): string {
  if (!revision) return "none";
  return `${revision.mtimeMs}-${revision.size}`;
}

interface ReadFailureCalloutProps {
  kind: "transport" | ProjectConfigRpcError["code"];
  error: unknown;
  onReload: () => void;
  hasMultipleHosts: boolean;
}

function ReadFailureCallout({ kind, error, onReload, hasMultipleHosts }: ReadFailureCalloutProps) {
  const { t } = useTranslation();
  const { testID, title, description } = resolveReadFailureCopy(
    { kind, error, hasMultipleHosts },
    t,
  );
  return (
    <View style={styles.errorBlock}>
      <Alert testID={testID} variant="error" title={title} description={description}>
        <Button testID={`${testID}-action-0`} onPress={onReload} variant="outline" size="sm">
          {t("projectSettings.reload")}
        </Button>
      </Alert>
    </View>
  );
}

function resolveReadFailureCopy(
  input: {
    kind: ReadFailureCalloutProps["kind"];
    error: unknown;
    hasMultipleHosts: boolean;
  },
  t: Translate,
): { testID: string; title: string; description: string } {
  if (input.kind === "invalid_project_config") {
    return {
      testID: "invalid-callout",
      title: t("projectSettings.invalidConfigTitle"),
      description: t("projectSettings.invalidConfigDescription"),
    };
  }
  if (input.kind === "project_not_found") {
    return {
      testID: "project-not-found-callout",
      title: t("projectSettings.projectNotFoundTitle"),
      description: input.hasMultipleHosts
        ? t("projectSettings.projectNotFoundMultipleHosts")
        : t("projectSettings.projectNotFoundSingleHost"),
    };
  }
  if (input.kind === "transport") {
    const detail = errorToDetail(input.error);
    return {
      testID: "read-transport-callout",
      title: t("projectSettings.readFailedTitle"),
      description: detail ?? t("projectSettings.hostNoResponse"),
    };
  }
  return {
    testID: "read-failed-callout",
    title: t("projectSettings.readFailedTitle"),
    description: t("projectSettings.readFailedRetry"),
  };
}

function errorToDetail(error: unknown): string | null {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return null;
}

interface ProjectConfigFormProps {
  baseConfig: ChisaCodeConfigRaw;
  revision: ChisaCodeConfigRevision | null;
  repoRoot: string;
  queryKey: readonly [string, string, string];
  client: DaemonClient;
  onReload: () => void;
}

function ProjectConfigForm({
  baseConfig,
  revision,
  repoRoot,
  queryKey,
  client,
  onReload,
}: ProjectConfigFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [draft, setDraft] = useState<ProjectConfigDraft>(() => configToDraft(baseConfig));
  const [writeError, setWriteError] = useState<ProjectConfigRpcError | null>(null);
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (input: {
      config: ChisaCodeConfigRaw;
      expectedRevision: ChisaCodeConfigRevision | null;
    }) => {
      return client.writeProjectConfig({
        repoRoot,
        config: input.config,
        expectedRevision: input.expectedRevision,
      });
    },
    onSuccess: (result) => {
      if (result.ok) {
        const cachedResult: ReadProjectConfigData = {
          ok: true,
          config: result.config,
          revision: result.revision,
          requestId: "local-cache",
          repoRoot,
        };
        queryClient.setQueryData<ReadProjectConfigData>(queryKey, cachedResult);
        setWriteError(null);
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        toast.show(t("projectSettings.saved"), { variant: "success" });
      } else {
        setWriteError(result.error);
      }
    },
  });

  const handleSave = useCallback(() => {
    if (writeError?.code === "stale_project_config") return;
    const config = applyDraftToConfig({ draft, base: baseConfig });
    saveMutation.mutate({ config, expectedRevision: revision });
  }, [draft, baseConfig, revision, writeError, saveMutation]);

  const handleReload = useCallback(() => {
    setWriteError(null);
    onReload();
  }, [onReload]);

  const updateDraft = useCallback((updater: (draft: ProjectConfigDraft) => ProjectConfigDraft) => {
    setDraft((prev) => updater(prev));
  }, []);

  const handleSetupChange = useCallback(
    (text: string) => updateDraft((d) => ({ ...d, setupText: text })),
    [updateDraft],
  );
  const handleTeardownChange = useCallback(
    (text: string) => updateDraft((d) => ({ ...d, teardownText: text })),
    [updateDraft],
  );

  const handleMetadataPromptChange = useCallback(
    (key: MetadataPromptKey, text: string) =>
      updateDraft((d) => ({
        ...d,
        metadataPrompts: { ...d.metadataPrompts, [key]: text },
      })),
    [updateDraft],
  );

  const handleRemoveScript = useCallback(
    async (script: ProjectScriptDraft) => {
      const ok = await confirmDialog({
        title: t("projectSettings.removeScriptTitle"),
        message: t("projectSettings.removeScriptMessage", {
          script: script.name || t("projectSettings.unnamedScript"),
        }),
        confirmLabel: t("common.remove"),
        cancelLabel: t("common.cancel"),
        destructive: true,
      });
      if (!ok) return;
      updateDraft((d) => ({
        ...d,
        scripts: d.scripts.filter((entry) => entry.id !== script.id),
      }));
    },
    [t, updateDraft],
  );

  const handleEditScript = useCallback((script: ProjectScriptDraft) => {
    setEditingScriptId(script.id);
  }, []);

  const handleAddScript = useCallback(() => {
    const id = `script-draft-new-${Date.now()}`;
    updateDraft((d) => ({
      ...d,
      scripts: [
        ...d.scripts,
        {
          id,
          name: "",
          commandText: "",
          commandOriginalKind: "missing" satisfies LifecycleOriginalKind,
          type: "",
          portText: "",
          rawEntry: {},
        },
      ],
    }));
    setEditingScriptId(id);
  }, [updateDraft]);

  const handleEditingDraftChange = useCallback(
    (next: ProjectScriptDraft) => {
      updateDraft((d) => ({
        ...d,
        scripts: d.scripts.map((entry) => (entry.id === next.id ? next : entry)),
      }));
    },
    [updateDraft],
  );

  const handleCancelEditing = useCallback(() => {
    if (!editingScriptId) {
      return;
    }
    updateDraft((d) => {
      const entry = d.scripts.find((row) => row.id === editingScriptId);
      if (!entry) return d;
      const isEmpty =
        entry.name.trim().length === 0 &&
        entry.commandText.trim().length === 0 &&
        entry.type.trim().length === 0 &&
        entry.portText.trim().length === 0;
      if (!isEmpty) return d;
      return { ...d, scripts: d.scripts.filter((row) => row.id !== editingScriptId) };
    });
    setEditingScriptId(null);
  }, [editingScriptId, updateDraft]);

  const handleSaveEditing = useCallback(() => {
    setEditingScriptId(null);
  }, []);

  const editingScript = draft.scripts.find((entry) => entry.id === editingScriptId);

  const hasInvalidScripts = useMemo(
    () =>
      draft.scripts.some(
        (script) =>
          validateScript(script, {
            nameRequired: t("projectSettings.scriptNameRequired"),
            commandRequired: t("projectSettings.scriptCommandRequired"),
          }).hasErrors,
      ),
    [draft.scripts, t],
  );

  const scriptsTrailing = useMemo(
    () => (
      <Pressable
        onPress={handleAddScript}
        hitSlop={8}
        style={settingsStyles.sectionHeaderLink}
        accessibilityRole="button"
        accessibilityLabel={t("projectSettings.addScript")}
        testID="scripts-add-button"
      >
        <Plus size={ICON_SIZE} color={styles.iconColor.color} />
      </Pressable>
    ),
    [handleAddScript, t],
  );

  const setupDocsLink = useMemo(
    () => (
      <ExternalLink
        href={WORKTREE_DOCS_URL}
        label={t("projectSettings.docs")}
        tooltip={t("projectSettings.worktreeDocsTooltip")}
        testID="worktree-setup-docs-link"
      />
    ),
    [t],
  );
  const teardownDocsLink = useMemo(
    () => (
      <ExternalLink
        href={WORKTREE_DOCS_URL}
        label={t("projectSettings.docs")}
        tooltip={t("projectSettings.worktreeDocsTooltip")}
        testID="worktree-teardown-docs-link"
      />
    ),
    [t],
  );

  const isStale = writeError?.code === "stale_project_config";
  const isWriteFailed = writeError?.code === "write_failed";
  const saveDisabled = saveMutation.isPending || isStale || hasInvalidScripts;

  return (
    <View>
      <SettingsGroup
        title={t("projectSettings.worktreeGroupTitle")}
        info={t("projectSettings.worktreeGroupInfo")}
        testID="worktree-group"
      >
        <SettingsSection
          title={t("projectSettings.setup")}
          testID="worktree-setup-section"
          trailing={setupDocsLink}
        >
          <SettingsTextAreaCard
            testID="worktree-setup-input"
            accessibilityLabel={t("projectSettings.worktreeSetupCommand")}
            value={draft.setupText}
            onChangeText={handleSetupChange}
            placeholder="npm install"
          />
        </SettingsSection>

        <SettingsSection
          title={t("projectSettings.cleanup")}
          testID="worktree-teardown-section"
          trailing={teardownDocsLink}
          flush
        >
          <SettingsTextAreaCard
            testID="worktree-teardown-input"
            accessibilityLabel={t("projectSettings.worktreeCleanupCommand")}
            value={draft.teardownText}
            onChangeText={handleTeardownChange}
            placeholder="docker compose down"
          />
        </SettingsSection>
      </SettingsGroup>

      <SettingsGroup
        title={t("projectSettings.scripts")}
        info={t("projectSettings.scriptsGroupInfo")}
        trailing={scriptsTrailing}
        testID="scripts-group"
      >
        <View style={settingsStyles.card} testID="scripts-list">
          {draft.scripts.length === 0 ? (
            <View style={settingsStyles.row}>
              <Text style={styles.emptyScripts}>{t("projectSettings.noScripts")}</Text>
            </View>
          ) : (
            draft.scripts.map((script, index) => (
              <ScriptRow
                key={script.id}
                script={script}
                isFirst={index === 0}
                onEdit={handleEditScript}
                onRemove={handleRemoveScript}
              />
            ))
          )}
        </View>
      </SettingsGroup>

      <SettingsGroup
        title={t("projectSettings.metadataGroupTitle")}
        info={t("projectSettings.metadataGroupInfo")}
        testID="metadata-group"
      >
        {METADATA_PROMPT_KEYS.map((key, index) => (
          <MetadataPromptSection
            key={key}
            promptKey={key}
            value={draft.metadataPrompts[key]}
            onChange={handleMetadataPromptChange}
            flush={index === METADATA_PROMPT_KEYS.length - 1}
          />
        ))}
      </SettingsGroup>

      {isStale ? (
        <View style={styles.calloutWrap}>
          <Alert
            testID="stale-callout"
            variant="error"
            title={t("projectSettings.staleTitle")}
            description={t("projectSettings.staleDescription")}
          >
            <Button
              testID="stale-callout-action-0"
              onPress={handleReload}
              variant="outline"
              size="sm"
            >
              {t("projectSettings.reload")}
            </Button>
          </Alert>
        </View>
      ) : null}

      {isWriteFailed ? (
        <View style={styles.calloutWrap}>
          <Alert
            testID="write-failed-callout"
            variant="error"
            title={t("projectSettings.writeFailedTitle")}
            description={t("projectSettings.writeFailedDescription")}
          >
            <Button
              testID="write-failed-callout-action-0"
              onPress={handleSave}
              variant="outline"
              size="sm"
            >
              {t("common.retry")}
            </Button>
            <Button
              testID="write-failed-callout-action-1"
              onPress={handleReload}
              variant="outline"
              size="sm"
            >
              {t("projectSettings.reload")}
            </Button>
          </Alert>
        </View>
      ) : null}

      <View style={styles.footer}>
        <Button
          testID="save-button"
          accessibilityLabel={t("projectSettings.saveProjectConfig")}
          variant="default"
          size="md"
          disabled={saveDisabled}
          loading={saveMutation.isPending}
          onPress={handleSave}
        >
          {saveMutation.isPending ? t("projectSettings.saving") : t("common.save")}
        </Button>
      </View>

      {editingScript ? (
        <ScriptEditModal
          script={editingScript}
          onChange={handleEditingDraftChange}
          onCancel={handleCancelEditing}
          onSave={handleSaveEditing}
        />
      ) : null}
    </View>
  );
}

function ResolveSpinnerColor(): string {
  return styles.spinnerColor.color;
}

interface ProjectNameEditorProps {
  project: ProjectSummary;
  client: DaemonClient;
}

function ProjectNameEditor({ project, client }: ProjectNameEditorProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(project.projectCustomName ?? "");

  const renameMutation = useMutation({
    mutationFn: (customName: string | null) => client.renameProject(project.projectKey, customName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setIsEditing(false);
      toast.show(t("projectSettings.renamed"), { variant: "success" });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t("projectSettings.renameFailed");
      toast.show(message, { variant: "error" });
    },
  });

  const handleStartEdit = useCallback(() => {
    setValue(project.projectCustomName ?? "");
    setIsEditing(true);
  }, [project.projectCustomName]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setValue(project.projectCustomName ?? "");
  }, [project.projectCustomName]);

  const handleSave = useCallback(() => {
    const trimmed = value.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    if (next === (project.projectCustomName ?? null)) {
      setIsEditing(false);
      return;
    }
    renameMutation.mutate(next);
  }, [value, project.projectCustomName, renameMutation]);

  const handleReset = useCallback(() => {
    renameMutation.mutate(null);
  }, [renameMutation]);

  if (!isEditing) {
    return (
      <View style={styles.nameEditorRow}>
        <Text style={styles.projectTitle} numberOfLines={1}>
          {project.projectName}
        </Text>
        <Pressable
          testID="project-name-edit-button"
          accessibilityLabel={t("projectSettings.renameProject")}
          onPress={handleStartEdit}
          hitSlop={8}
          style={styles.nameEditorIconButton}
        >
          <Pencil size={ICON_SIZE} color={styles.iconColor.color} />
        </Pressable>
        {project.projectCustomName ? (
          <Pressable
            testID="project-name-reset-button"
            accessibilityLabel={t("projectSettings.resetProjectName")}
            onPress={handleReset}
            disabled={renameMutation.isPending}
            hitSlop={8}
            style={styles.nameEditorResetButton}
          >
            <Text style={styles.nameEditorResetText}>{t("projectSettings.reset")}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.nameEditorRow}>
      <TextInput
        testID="project-name-input"
        accessibilityLabel={t("projectSettings.projectName")}
        value={value}
        onChangeText={setValue}
        placeholder={project.projectName}
        placeholderTextColor={styles.placeholderColor.color}
        autoFocus
        style={styles.nameEditorInput}
        editable={!renameMutation.isPending}
        onSubmitEditing={handleSave}
        returnKeyType="done"
      />
      <Pressable
        testID="project-name-save-button"
        accessibilityLabel={t("projectSettings.saveProjectName")}
        onPress={handleSave}
        disabled={renameMutation.isPending}
        hitSlop={8}
        style={styles.nameEditorIconButton}
      >
        <Check size={ICON_SIZE} color={styles.iconColor.color} />
      </Pressable>
      <Pressable
        testID="project-name-cancel-button"
        accessibilityLabel={t("projectSettings.cancelRename")}
        onPress={handleCancel}
        disabled={renameMutation.isPending}
        hitSlop={8}
        style={styles.nameEditorIconButton}
      >
        <X size={ICON_SIZE} color={styles.iconColor.color} />
      </Pressable>
    </View>
  );
}

function ProjectTitleIcon({
  host,
  projectName,
  projectKey,
}: {
  host: ProjectHostEntry;
  projectName: string;
  projectKey: string;
}) {
  const initial = projectName.trim().charAt(0).toUpperCase() || "?";
  const { icon } = useProjectIconQuery({ serverId: host.serverId, cwd: host.repoRoot });
  return (
    <ProjectIconView
      iconDataUri={projectIconToDataUri(icon)}
      initial={initial}
      projectKey={projectKey}
      imageStyle={styles.titleIcon}
      fallbackStyle={styles.titleIconFallback}
      textStyle={styles.titleIconFallbackText}
    />
  );
}

interface HostContextProps {
  hosts: ProjectHostEntry[];
  selectedHost: ProjectHostEntry;
  onSelectHost: (serverId: string) => void;
}

function HostContext({ hosts, selectedHost, onSelectHost }: HostContextProps) {
  if (hosts.length > 1) {
    return <HostPicker hosts={hosts} selectedHost={selectedHost} onSelectHost={onSelectHost} />;
  }
  return (
    <View testID="host-indicator" style={styles.hostIndicator}>
      <HostStatusDot serverId={selectedHost.serverId} />
      <Text style={styles.hostName} numberOfLines={1}>
        {selectedHost.serverName}
      </Text>
    </View>
  );
}

function HostStatusDot({ serverId }: { serverId: string }) {
  const snapshot = useHostRuntimeSnapshot(serverId);
  const status = snapshot?.connectionStatus ?? "connecting";
  let statusStyle: { backgroundColor: string };
  if (status === "online") {
    statusStyle = styles.hostStatusDotOnline;
  } else if (status === "connecting") {
    statusStyle = styles.hostStatusDotConnecting;
  } else {
    statusStyle = styles.hostStatusDotOffline;
  }
  const dotStyle = useMemo(() => [styles.hostStatusDot, statusStyle], [statusStyle]);
  return <View style={dotStyle} />;
}

interface HostPickerProps {
  hosts: ProjectHostEntry[];
  selectedHost: ProjectHostEntry;
  onSelectHost: (serverId: string) => void;
}

function HostPicker({ hosts, selectedHost, onSelectHost }: HostPickerProps) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        accessibilityLabel={t("projectSettings.hostSwitcher")}
        testID="host-picker"
        style={styles.hostIndicator}
      >
        <HostStatusDot serverId={selectedHost.serverId} />
        <Text style={styles.hostName} numberOfLines={1}>
          {selectedHost.serverName}
        </Text>
        <ChevronDown size={ICON_SIZE} color={styles.chevronColor.color} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" minWidth={240}>
        {hosts.map((host) => (
          <HostPickerItem
            key={host.serverId}
            host={host}
            isSelected={host.serverId === selectedHost.serverId}
            onSelectHost={onSelectHost}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface HostPickerItemProps {
  host: ProjectHostEntry;
  isSelected: boolean;
  onSelectHost: (serverId: string) => void;
}

function HostPickerItem({ host, isSelected, onSelectHost }: HostPickerItemProps) {
  const handleSelect = useCallback(
    () => onSelectHost(host.serverId),
    [host.serverId, onSelectHost],
  );
  return (
    <DropdownMenuItem
      testID={`host-picker-item-${host.serverId}`}
      selected={isSelected}
      onSelect={handleSelect}
    >
      {host.serverName}
    </DropdownMenuItem>
  );
}

interface MetadataPromptSectionProps {
  promptKey: MetadataPromptKey;
  value: string;
  onChange: (key: MetadataPromptKey, text: string) => void;
  flush?: boolean;
}

function MetadataPromptSection({ promptKey, value, onChange, flush }: MetadataPromptSectionProps) {
  const { t } = useTranslation();
  const meta = METADATA_PROMPT_FIELDS[promptKey];
  const handleChange = useCallback(
    (text: string) => onChange(promptKey, text),
    [onChange, promptKey],
  );
  return (
    <SettingsSection title={t(meta.titleKey)} testID={meta.sectionTestID} flush={flush}>
      <SettingsTextAreaCard
        testID={meta.inputTestID}
        accessibilityLabel={t(meta.titleKey)}
        value={value}
        onChangeText={handleChange}
        placeholder={t(meta.placeholderKey)}
      />
    </SettingsSection>
  );
}

interface ScriptRowProps {
  script: ProjectScriptDraft;
  isFirst: boolean;
  onEdit: (script: ProjectScriptDraft) => void;
  onRemove: (script: ProjectScriptDraft) => void;
}

function ScriptRow({ script, isFirst, onEdit, onRemove }: ScriptRowProps) {
  const { t } = useTranslation();
  const handleEdit = useCallback(() => onEdit(script), [onEdit, script]);
  const handleRemove = useCallback(() => onRemove(script), [onRemove, script]);
  const rowStyle = isFirst ? styles.scriptRow : styles.scriptRowWithBorder;

  return (
    <View style={rowStyle} testID={`script-row-${script.id}`}>
      <Pressable style={styles.scriptRowMain} onPress={handleEdit}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {script.name || t("projectSettings.unnamedScriptRow")}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {scriptHint(script)}
        </Text>
      </Pressable>
      <DropdownMenu>
        <DropdownMenuTrigger
          accessibilityLabel={t("projectSettings.openScriptMenu")}
          testID={`script-row-menu-${script.id}`}
          style={styles.scriptKebab}
        >
          <MoreVertical size={ICON_SIZE} color={styles.chevronColor.color} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" minWidth={160}>
          <DropdownMenuItem testID={`script-action-${script.id}-edit`} onSelect={handleEdit}>
            {t("projectSettings.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem
            testID={`script-action-${script.id}-remove`}
            destructive
            onSelect={handleRemove}
          >
            {t("common.remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

function scriptHint(script: ProjectScriptDraft): string {
  const pieces: string[] = [];
  if (script.type) pieces.push(script.type);
  if (script.portText) pieces.push(`port ${script.portText}`);
  if (script.commandText) pieces.push(script.commandText.split("\n")[0] ?? "");
  return pieces.join(" · ");
}

interface ScriptValidation {
  hasErrors: boolean;
  nameError: string | null;
  commandError: string | null;
}

function validateScript(
  script: ProjectScriptDraft,
  copy: { nameRequired: string; commandRequired: string },
): ScriptValidation {
  const nameError = script.name.trim().length === 0 ? copy.nameRequired : null;
  const commandError = script.commandText.trim().length === 0 ? copy.commandRequired : null;
  return {
    hasErrors: Boolean(nameError || commandError),
    nameError,
    commandError,
  };
}

interface ScriptEditModalProps {
  script: ProjectScriptDraft;
  onChange: (next: ProjectScriptDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}

interface ScriptFieldsTouched {
  name: boolean;
  command: boolean;
}

const ALL_TOUCHED: ScriptFieldsTouched = { name: true, command: true };
const NONE_TOUCHED: ScriptFieldsTouched = { name: false, command: false };

function ScriptEditModal({ script, onChange, onCancel, onSave }: ScriptEditModalProps) {
  const { t } = useTranslation();
  const [touched, setTouched] = useState<ScriptFieldsTouched>(NONE_TOUCHED);

  useEffect(() => {
    setTouched(NONE_TOUCHED);
  }, [script.id]);

  const markTouched = useCallback((field: keyof ScriptFieldsTouched) => {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }, []);

  const handleNameChange = useCallback(
    (text: string) => onChange({ ...script, name: text }),
    [onChange, script],
  );
  const handleCommandChange = useCallback(
    (text: string) => onChange({ ...script, commandText: text }),
    [onChange, script],
  );
  const handleServiceToggle = useCallback(
    (next: boolean) => onChange({ ...script, type: next ? SCRIPT_SERVICE_TYPE : "" }),
    [onChange, script],
  );

  const handleNameBlur = useCallback(() => markTouched("name"), [markTouched]);
  const handleCommandBlur = useCallback(() => markTouched("command"), [markTouched]);

  const validation = validateScript(script, {
    nameRequired: t("projectSettings.scriptNameRequired"),
    commandRequired: t("projectSettings.scriptCommandRequired"),
  });

  const handleSavePress = useCallback(() => {
    if (validation.hasErrors) {
      setTouched(ALL_TOUCHED);
      return;
    }
    onSave();
  }, [validation.hasErrors, onSave]);

  const showNameError = touched.name && validation.nameError;
  const showCommandError = touched.command && validation.commandError;
  const isService = script.type === SCRIPT_SERVICE_TYPE;
  const sheetHeader = useMemo<SheetHeader>(
    () => ({
      title: script.name
        ? t("projectSettings.editScriptTitle", { script: script.name })
        : t("projectSettings.newScriptTitle"),
    }),
    [script.name, t],
  );

  return (
    <AdaptiveModalSheet
      visible
      header={sheetHeader}
      onClose={onCancel}
      testID="script-edit-modal"
      desktopMaxWidth={560}
    >
      <View style={styles.modalSection}>
        <Text style={styles.modalLabel}>{t("projectSettings.name")}</Text>
        <TextInput
          testID="script-edit-name"
          accessibilityLabel={t("projectSettings.scriptName")}
          value={script.name}
          onChangeText={handleNameChange}
          onBlur={handleNameBlur}
          placeholder="dev"
          placeholderTextColor={styles.placeholderColor.color}
          style={styles.modalInput}
        />
        {showNameError ? (
          <Text testID="script-edit-name-error" style={styles.fieldError}>
            {validation.nameError}
          </Text>
        ) : null}
      </View>
      <View style={styles.modalSection}>
        <Text style={styles.modalLabel}>{t("projectSettings.command")}</Text>
        <TextInput
          testID="script-edit-command"
          accessibilityLabel={t("projectSettings.scriptCommand")}
          multiline
          value={script.commandText}
          onChangeText={handleCommandChange}
          onBlur={handleCommandBlur}
          placeholder="npm run dev"
          placeholderTextColor={styles.placeholderColor.color}
          style={styles.modalMultilineInput}
        />
        {showCommandError ? (
          <Text testID="script-edit-command-error" style={styles.fieldError}>
            {validation.commandError}
          </Text>
        ) : null}
      </View>
      <View style={styles.modalSection}>
        <View style={styles.serviceToggleRow}>
          <View style={styles.serviceToggleText}>
            <Text style={styles.serviceToggleLabel}>{t("projectSettings.runAsService")}</Text>
            <Text style={styles.modalHint}>{t("projectSettings.runAsServiceHint")}</Text>
          </View>
          <Switch
            value={isService}
            onValueChange={handleServiceToggle}
            accessibilityLabel={t("projectSettings.runAsService")}
            testID="script-edit-service-toggle"
          />
        </View>
      </View>
      <View style={styles.modalFooter}>
        <Button onPress={onCancel} variant="ghost" size="md" testID="script-edit-cancel">
          {t("common.cancel")}
        </Button>
        <Button onPress={handleSavePress} variant="default" size="md" testID="script-edit-save">
          {t("common.save")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  noTargetContainer: {
    padding: theme.spacing[4],
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  noTargetText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  body: {
    padding: theme.spacing[4],
    gap: theme.spacing[2],
  },
  backButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 0,
  },
  headerBlock: {
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[4],
    gap: theme.spacing[2],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  // Soft project title: near .topbar title scale.
  projectTitle: {
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
  },
  nameEditorRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  nameEditorIconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  // Soft name editor: match project title scale.
  nameEditorInput: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.medium,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    minWidth: 0,
  },
  nameEditorResetButton: {
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  nameEditorResetText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  titleIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
  },
  titleIconFallback: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  titleIconFallbackText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  // Soft host chip: quiet r10 set-item family.
  hostIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: 10,
    alignSelf: "flex-start",
    minWidth: 0,
  },
  hostStatusDot: {
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
  },
  hostStatusDotOnline: {
    backgroundColor: theme.colors.palette.green[400],
  },
  hostStatusDotConnecting: {
    backgroundColor: theme.colors.palette.amber[500],
  },
  hostStatusDotOffline: {
    backgroundColor: theme.colors.palette.red[500],
  },
  hostName: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    flexShrink: 1,
    minWidth: 0,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  errorBlock: {
    marginTop: theme.spacing[2],
  },
  emptyScripts: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  scriptRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  scriptRowWithBorder: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: 1,
    // Soft quiet list divider (--border-soft).
    borderTopColor: theme.colors.secondary,
  },
  scriptRowMain: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  scriptKebab: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  calloutWrap: {
    marginTop: theme.spacing[3],
  },
  footer: {
    marginTop: theme.spacing[4],
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  modalSection: {
    gap: theme.spacing[2],
  },
  modalLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  modalInput: {
    color: theme.colors.foreground,
    // Soft chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  modalMultilineInput: {
    color: theme.colors.foreground,
    // Soft chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    minHeight: 100,
    textAlignVertical: "top",
  },
  modalFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  fieldError: {
    color: theme.colors.palette.red[300],
    fontSize: 12.5,
    lineHeight: 16,
  },
  serviceToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  serviceToggleText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  serviceToggleLabel: {
    color: theme.colors.foreground,
    // Soft chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
  },
  modalHint: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  placeholderColor: {
    color: theme.colors.foregroundMuted,
  },
  chevronColor: {
    color: theme.colors.foregroundMuted,
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
}));
