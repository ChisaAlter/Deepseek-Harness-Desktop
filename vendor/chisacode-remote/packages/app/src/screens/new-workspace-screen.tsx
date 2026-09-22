import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Folder,
  GitBranch,
  GitPullRequest,
  Inbox,
  X,
} from "lucide-react-native";

import { useRouter, type Href } from "expo-router";
import { Composer } from "@/composer";
import { DraftAgentModeControl } from "@/composer/agent-controls/mode-control";
import {
  SoftHomeEmpty,
  softHomeComposerInputAreaStyle,
  softHomeComposerInputWrapperStyle,
} from "@/composer/draft/soft-home-empty";
import { splitComposerAttachmentsForSubmit } from "@/composer/attachments/submit";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { FileDropZone } from "@/components/file-drop-zone";
import { Combobox, ComboboxItem } from "@/components/ui/combobox";
import type { ComboboxOption as ComboboxOptionType } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { useDesktopSidebarControlContentPad } from "@/components/desktop/desktop-sidebar-control";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import {
  DESKTOP_WINDOW_CONTROLS_WIDTH,
  getIsElectronRuntime,
  useIsCompactFormFactor,
} from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import { useOpenProject } from "@/hooks/use-open-project";
import { useRecommendedProjectPaths } from "@/stores/session-store-hooks";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import { useGithubSearchQuery } from "@/git/use-github-search-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { rememberLastDraftDirectory } from "@/stores/last-draft-directory-store";
import { normalizeWorkspaceDescriptor, useSessionStore } from "@/stores/session-store";
import { generateDraftId } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import { generateMessageId } from "@/types/stream";
import { toErrorMessage } from "@/utils/error-messages";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { pickDirectory } from "@/desktop/pick-directory";
import { shortenPath } from "@/utils/shorten-path";
import { navigateToPreparedWorkspaceTab } from "@/utils/workspace-navigation";
import type { ComposerAttachment, UserComposerAttachment } from "@/attachments/types";
import type { ImageAttachment, MessagePayload } from "@/composer/types";
import type { AgentAttachment, GitHubSearchItem } from "@chisacode/protocol/messages";
import type { AgentProvider } from "@chisacode/protocol/agent-types";
import { validateBranchSlug } from "@chisacode/protocol/branch-slug";
import {
  buildNewWorkspaceDirectoryOptions,
  NEW_WORKSPACE_ADD_PROJECT_OPTION_ID,
} from "./new-workspace-directory-options";
import { resolveNewWorkspaceDraftReset } from "./new-workspace-draft-reset";
import { isEmptyWorkspaceSubmission, runCreateEmptyWorkspace } from "./new-workspace-empty";
import {
  resolveBranchPickerEmptyText,
  seedCurrentBranchDetails,
} from "./new-workspace-branch-picker";
import { planNewWorkspaceSendOpen } from "./new-workspace-ensure";
import { pickerOptionToRenderModel, type PickerItem } from "./new-workspace-picker-item";
import { findCheckoutHintPrAttachment, syncPickerPrAttachment } from "./new-workspace-picker-state";
import { useTranslation } from "react-i18next";

// Bake theme colors into withUnistyles mappers — do NOT pass `uniProps` at the
// call site. On web/Electron, lucide icons forward unknown props onto DOM
// nodes, which triggers: React does not recognize the `uniProps` prop.
const ThemedGitPullRequest = withUnistyles(GitPullRequest, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedGitBranch = withUnistyles(GitBranch, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedChevronDown = withUnistyles(ChevronDown, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedCheck = withUnistyles(Check, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedX = withUnistyles(X, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));
const ThemedFolder = withUnistyles(Folder, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));

interface NewWorkspaceScreenProps {
  serverId: string;
  sourceDirectory: string | null;
  projectId?: string;
  displayName?: string;
  resetKey?: string;
}

interface PickerOptionData {
  options: ComboboxOptionType[];
  itemById: Map<string, PickerItem>;
}

interface PickerSelection {
  item: PickerItem;
  attachedPrNumber: number | null;
}

const BRANCH_OPTION_PREFIX = "branch:";
const PR_OPTION_PREFIX = "github-pr:";

function RefPickerBadgeContent({
  selectedItem,
  triggerLabel,
  iconSize,
}: {
  selectedItem: PickerItem | null;
  triggerLabel: string;
  iconSize: number;
}) {
  return (
    <>
      <View style={styles.badgeIconBox}>
        {selectedItem?.kind === "github-pr" ? (
          <ThemedGitPullRequest size={iconSize} />
        ) : (
          <ThemedGitBranch size={iconSize} />
        )}
      </View>
      <Text style={styles.badgeText} numberOfLines={1}>
        {triggerLabel}
      </Text>
      <ThemedChevronDown size={iconSize} />
    </>
  );
}

function RefPickerTrigger({
  pickerAnchorRef,
  onPress,
  disabled,
  badgePressableStyle,
  selectedItem,
  triggerLabel,
  iconSize,
}: {
  pickerAnchorRef: React.RefObject<View | null>;
  onPress: () => void;
  disabled: boolean;
  badgePressableStyle: React.ComponentProps<typeof Pressable>["style"];
  selectedItem: PickerItem | null;
  triggerLabel: string;
  iconSize: number;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild triggerRefProp="ref">
        <Pressable
          ref={pickerAnchorRef}
          testID="new-workspace-ref-picker-trigger"
          onPress={onPress}
          disabled={disabled}
          style={badgePressableStyle}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.startRef")}
        >
          <RefPickerBadgeContent
            selectedItem={selectedItem}
            triggerLabel={triggerLabel}
            iconSize={iconSize}
          />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{t("workspace.chooseStartRef")}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function CheckoutHintBadge({
  prNumber,
  onAccept,
  onDismiss,
  iconSize,
}: {
  prNumber: number;
  onAccept: () => void;
  onDismiss: () => void;
  iconSize: number;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.checkoutHintBadge}>
      <Text style={styles.badgeText} numberOfLines={1}>
        {t("workspace.checkoutPrPrompt", { number: prNumber })}
      </Text>
      <Pressable
        testID="new-workspace-checkout-hint-accept"
        onPress={onAccept}
        style={styles.checkoutHintAction}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.checkoutPr", { number: prNumber })}
      >
        <ThemedCheck size={iconSize} />
      </Pressable>
      <Pressable
        testID="new-workspace-checkout-hint-dismiss"
        onPress={onDismiss}
        style={styles.checkoutHintAction}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.dismissCheckoutHint", { number: prNumber })}
      >
        <ThemedX size={iconSize} />
      </Pressable>
    </View>
  );
}

function DirectoryTrigger({
  anchorRef,
  directory,
  onPress,
  disabled,
  badgePressableStyle,
  iconSize,
}: {
  anchorRef: React.RefObject<View | null>;
  directory: string | null;
  onPress: () => void;
  disabled: boolean;
  badgePressableStyle: React.ComponentProps<typeof Pressable>["style"];
  iconSize: number;
}) {
  const { t } = useTranslation();
  const label = directory ? shortenPath(directory) : t("workspace.directoryPicker.select");
  return (
    <Tooltip>
      <TooltipTrigger asChild triggerRefProp="ref">
        <Pressable
          ref={anchorRef}
          testID="new-workspace-directory-trigger"
          onPress={onPress}
          disabled={disabled}
          style={badgePressableStyle}
          accessibilityRole="button"
          accessibilityLabel={t("workspace.directoryPicker.select")}
        >
          <View style={styles.badgeIconBox}>
            <ThemedFolder size={iconSize} />
          </View>
          <Text style={styles.badgeText} numberOfLines={1}>
            {label}
          </Text>
          <ThemedChevronDown size={iconSize} />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{t("workspace.directoryPicker.select")}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function ImportSessionAction({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <Button
      testID="new-workspace-import-session-card"
      accessibilityLabel={t("openProject.importSession.title")}
      onPress={onPress}
      disabled={disabled}
      variant="ghost"
      size="sm"
      leftIcon={Inbox}
      style={styles.importAction}
    >
      {t("openProject.importSession.title")}
    </Button>
  );
}

function NewWorkspaceComposerFooter({
  directoryAnchorRef,
  normalizedSelectedDirectory,
  openDirectoryPicker,
  isPending,
  badgePressableStyle,
  iconSize,
  isLocalDaemon,
  directoryOptions,
  handleSelectDirectoryOption,
  directoryPickerOpen,
  handleDirectoryPickerOpenChange,
  setDirectorySearchQuery,
  pickerAnchorRef,
  openPicker,
  refPickerDisabled,
  selectedItem,
  triggerLabel,
  options,
  selectedOptionId,
  handleSelectOption,
  pickerOpen,
  handlePickerOpenChange,
  setPickerSearchQuery,
  pickerEmptyText,
  renderPickerOption,
  agentControls,
  checkoutHintPrAttachment,
  acceptCheckoutHint,
  dismissCheckoutHint,
  onImportPress,
}: {
  directoryAnchorRef: React.RefObject<View | null>;
  normalizedSelectedDirectory: string | null;
  openDirectoryPicker: () => void;
  isPending: boolean;
  badgePressableStyle: React.ComponentProps<typeof Pressable>["style"];
  iconSize: number;
  isLocalDaemon: boolean;
  directoryOptions: ComboboxOptionType[];
  handleSelectDirectoryOption: (directory: string) => void;
  directoryPickerOpen: boolean;
  handleDirectoryPickerOpenChange: (open: boolean) => void;
  setDirectorySearchQuery: (query: string) => void;
  pickerAnchorRef: React.RefObject<View | null>;
  openPicker: () => void;
  refPickerDisabled: boolean;
  selectedItem: PickerItem | null;
  triggerLabel: string;
  options: ComboboxOptionType[];
  selectedOptionId: string;
  handleSelectOption: (id: string) => void;
  pickerOpen: boolean;
  handlePickerOpenChange: (open: boolean) => void;
  setPickerSearchQuery: (query: string) => void;
  pickerEmptyText: string;
  renderPickerOption: NonNullable<React.ComponentProps<typeof Combobox>["renderOption"]>;
  agentControls: Omit<React.ComponentProps<typeof DraftAgentModeControl>, "placement"> | undefined;
  checkoutHintPrAttachment: ReturnType<typeof findCheckoutHintPrAttachment>;
  acceptCheckoutHint: () => void;
  dismissCheckoutHint: () => void;
  onImportPress?: (() => void) | null;
}) {
  const { t } = useTranslation();
  return (
    <View testID="new-workspace-ref-picker-row" style={styles.composerContextRow}>
      <View style={styles.composerContextPills}>
        <View>
          <DirectoryTrigger
            anchorRef={directoryAnchorRef}
            directory={normalizedSelectedDirectory}
            onPress={openDirectoryPicker}
            disabled={isPending}
            badgePressableStyle={badgePressableStyle}
            iconSize={iconSize}
          />
          <Combobox
            options={directoryOptions}
            value={normalizedSelectedDirectory ?? ""}
            onSelect={handleSelectDirectoryOption}
            searchable
            allowCustomValue={!isLocalDaemon}
            customValuePrefix={t("workspace.directoryPicker.customValuePrefix")}
            customValueDescription={t("workspace.directoryPicker.customValueDescription")}
            customValueKind="directory"
            searchPlaceholder={
              isLocalDaemon
                ? t("workspace.directoryPicker.searchProjects")
                : t("workspace.directoryPicker.searchOrInputDirectory")
            }
            title={t("workspace.directoryPicker.title")}
            open={directoryPickerOpen}
            onOpenChange={handleDirectoryPickerOpenChange}
            onSearchQueryChange={setDirectorySearchQuery}
            desktopPlacement="top-start"
            desktopMinWidth={440}
            desktopFixedHeight={340}
            anchorRef={directoryAnchorRef}
            emptyText={t("workspace.directoryPicker.empty")}
          />
        </View>
        <View>
          <RefPickerTrigger
            pickerAnchorRef={pickerAnchorRef}
            onPress={openPicker}
            disabled={refPickerDisabled}
            badgePressableStyle={badgePressableStyle}
            selectedItem={selectedItem}
            triggerLabel={triggerLabel}
            iconSize={iconSize}
          />
          <Combobox
            options={options}
            value={selectedOptionId}
            onSelect={handleSelectOption}
            searchable
            allowCustomValue
            customValuePrefix={t("workspace.createBranch")}
            customValueDescription={t("workspace.createBranchDescription")}
            searchPlaceholder={t("workspace.searchBranchesAndPrs")}
            title={t("workspace.startFrom")}
            open={pickerOpen}
            onOpenChange={handlePickerOpenChange}
            onSearchQueryChange={setPickerSearchQuery}
            desktopPlacement="top-start"
            desktopMinWidth={400}
            desktopFixedHeight={340}
            anchorRef={pickerAnchorRef}
            emptyText={pickerEmptyText}
            renderOption={renderPickerOption}
          />
        </View>
        {checkoutHintPrAttachment ? (
          <CheckoutHintBadge
            prNumber={checkoutHintPrAttachment.item.number}
            onAccept={acceptCheckoutHint}
            onDismiss={dismissCheckoutHint}
            iconSize={iconSize}
          />
        ) : null}
      </View>
      {onImportPress ? <ImportSessionAction onPress={onImportPress} disabled={isPending} /> : null}
      {/* Mode control stays in the composer footer; keep slot for compact flows. */}
      {agentControls ? <DraftAgentModeControl placement="footer" {...agentControls} /> : null}
    </View>
  );
}

function PickerOptionItem({
  testID,
  label,
  description,
  selected,
  active,
  disabled,
  onPress,
  isBranch,
  iconSize,
}: {
  testID: string;
  label: string;
  description: string | undefined;
  selected: boolean;
  active: boolean;
  disabled: boolean;
  onPress: () => void;
  isBranch: boolean;
  iconSize: number;
}) {
  const leadingSlot = useMemo(
    () => (
      <View style={styles.rowIconBox}>
        {isBranch ? <ThemedGitBranch size={iconSize} /> : <ThemedGitPullRequest size={iconSize} />}
      </View>
    ),
    [isBranch, iconSize],
  );
  return (
    <ComboboxItem
      testID={testID}
      label={label}
      description={description}
      selected={selected}
      active={active}
      disabled={disabled}
      onPress={onPress}
      leadingSlot={leadingSlot}
    />
  );
}

function branchOptionId(name: string): string {
  return `${BRANCH_OPTION_PREFIX}${name}`;
}

function prOptionId(number: number): string {
  return `${PR_OPTION_PREFIX}${number}`;
}

function formatPrLabel(item: { number: number; title: string }): string {
  return `#${item.number} ${item.title}`;
}

function pickerItemTriggerLabel(item: PickerItem): string {
  return item.kind === "github-pr" ? formatPrLabel(item.item) : item.name;
}

function computePickerOptionData(
  branchDetails: ReadonlyArray<{ name: string; committerDate: number }>,
  prItems: ReadonlyArray<GitHubSearchItem>,
): PickerOptionData {
  const idMap = new Map<string, PickerItem>();

  interface TimedOption {
    option: ComboboxOptionType;
    timestamp: number;
  }
  const timedOptions: TimedOption[] = [];

  for (const branch of branchDetails) {
    const id = branchOptionId(branch.name);
    const option = { id, label: branch.name };
    idMap.set(id, { kind: "branch", name: branch.name });
    timedOptions.push({ option, timestamp: branch.committerDate });
  }

  for (const pr of prItems) {
    if (!pr.headRefName) continue;
    const id = prOptionId(pr.number);
    const option = { id, label: formatPrLabel(pr) };
    idMap.set(id, { kind: "github-pr", item: pr });
    const updatedAtMs = pr.updatedAt ? Date.parse(pr.updatedAt) : 0;
    const timestamp = Number.isNaN(updatedAtMs) ? 0 : Math.floor(updatedAtMs / 1000);
    timedOptions.push({ option, timestamp });
  }

  timedOptions.sort((a, b) => b.timestamp - a.timestamp);
  return { options: timedOptions.map((t) => t.option), itemById: idMap };
}

function normalizeBranchDetails(
  data:
    | { branchDetails?: Array<{ name: string; committerDate: number }>; branches?: string[] }
    | undefined,
): Array<{ name: string; committerDate: number }> {
  const details = data?.branchDetails;
  if (details && details.length > 0) return details;
  const names = data?.branches ?? [];
  return names.map((name) => ({ name, committerDate: 0 }));
}

interface SubmitDraftInput {
  serverId: string;
  draftKey: string;
  workspaceId: string;
  workspaceDirectory: string;
  text: string;
  attachments: ComposerAttachment[];
  provider: AgentProvider;
  composerState: NonNullable<ReturnType<typeof useAgentInputDraft>["composerState"]>;
}

async function openAndMergeWorkspace(input: {
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
  cwd: string;
  mergeWorkspaces: (
    serverId: string,
    workspaces: ReturnType<typeof normalizeWorkspaceDescriptor>[],
  ) => void;
  serverId: string;
}): Promise<ReturnType<typeof normalizeWorkspaceDescriptor>> {
  const payload = await input.client.openProject(input.cwd);
  if (payload.error || !payload.workspace) {
    throw new Error(payload.error ?? "Failed to open workspace");
  }
  const normalizedWorkspace = normalizeWorkspaceDescriptor(payload.workspace);
  input.mergeWorkspaces(input.serverId, [normalizedWorkspace]);
  return normalizedWorkspace;
}

interface CreateChatAgentInput {
  payload: MessagePayload;
  composerState: ReturnType<typeof useAgentInputDraft>["composerState"];
  ensureWorkspace: (input: {
    cwd: string;
    prompt: string;
    attachments: AgentAttachment[];
  }) => Promise<ReturnType<typeof normalizeWorkspaceDescriptor>>;
  serverId: string;
  draftKey: string;
}

async function runCreateChatAgent(input: CreateChatAgentInput): Promise<void> {
  const { payload, composerState, ensureWorkspace, serverId, draftKey } = input;
  const { text, attachments, cwd } = payload;
  if (!composerState) {
    throw new Error("Composer state is required");
  }
  const provider = composerState.selectedProvider;
  if (!provider) {
    throw new Error("Select a model");
  }
  const { attachments: reviewAttachments } = splitComposerAttachmentsForSubmit(attachments);
  const ensuredWorkspace = await ensureWorkspace({
    cwd,
    prompt: text,
    attachments: reviewAttachments,
  });
  submitWorkspaceDraft({
    serverId,
    draftKey,
    workspaceId: ensuredWorkspace.id,
    workspaceDirectory: ensuredWorkspace.workspaceDirectory,
    text,
    attachments,
    provider,
    composerState,
  });
}

function buildComposerConfig(input: {
  serverId: string;
  isConnected: boolean;
  workingDirectory: string | null;
}): Parameters<typeof useAgentInputDraft>[0]["composer"] {
  const { serverId, isConnected, workingDirectory } = input;
  return {
    initialServerId: serverId || null,
    initialValues: workingDirectory ? { workingDir: workingDirectory } : undefined,
    isVisible: true,
    onlineServerIds: isConnected && serverId ? [serverId] : [],
    lockedWorkingDir: workingDirectory || undefined,
  };
}

function computeWorkspaceTitle(
  workspace: ReturnType<typeof normalizeWorkspaceDescriptor> | null,
  displayName: string,
  sourceDirectory: string | null,
): string {
  return (
    workspace?.name ||
    workspace?.projectDisplayName ||
    displayName ||
    sourceDirectory?.split(/[\\/]/).findLast(Boolean) ||
    sourceDirectory ||
    "New conversation"
  );
}

function collectAttachedPrNumbers(attachments: ReadonlyArray<UserComposerAttachment>): Set<number> {
  const numbers = new Set<number>();
  for (const attachment of attachments) {
    if (attachment.kind === "github_pr") {
      numbers.add(attachment.item.number);
    }
  }
  return numbers;
}

function pruneDismissedCheckoutHintPrNumbers(
  dismissed: ReadonlySet<number>,
  attached: ReadonlySet<number>,
): ReadonlySet<number> {
  let changed = false;
  const next = new Set<number>();
  for (const prNumber of dismissed) {
    if (attached.has(prNumber)) {
      next.add(prNumber);
    } else {
      changed = true;
    }
  }
  return changed ? next : dismissed;
}

function useDebouncedText(value: string, delayMs: number): string {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const trimmed = value.trim();
    const timer = setTimeout(() => setDebouncedValue(trimmed), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);
  return debouncedValue;
}

function useCheckoutHintDismissals(attachments: ReadonlyArray<UserComposerAttachment>) {
  const [dismissedPrNumbers, setDismissedPrNumbers] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const attachedPrNumbers = useMemo(() => collectAttachedPrNumbers(attachments), [attachments]);

  useEffect(() => {
    setDismissedPrNumbers((current) =>
      pruneDismissedCheckoutHintPrNumbers(current, attachedPrNumbers),
    );
  }, [attachedPrNumbers]);

  return [dismissedPrNumbers, setDismissedPrNumbers] as const;
}

function useNewWorkspaceDirectoryPicker(input: {
  client: ReturnType<typeof useHostRuntimeClient>;
  isConnected: boolean;
  isLocalDaemon: boolean;
  isPending: boolean;
  recommendedPaths: string[];
  serverId: string;
  normalizedSelectedDirectory: string | null;
  onDirectorySelected: (directory: string) => void;
  onError: (message: string) => void;
}) {
  const {
    client,
    isConnected,
    isLocalDaemon,
    isPending,
    recommendedPaths,
    serverId,
    normalizedSelectedDirectory,
    onDirectorySelected,
    onError,
  } = input;
  const [directoryPickerOpen, setDirectoryPickerOpen] = useState(false);
  const [directorySearchQuery, setDirectorySearchQuery] = useState("");
  const debouncedDirectorySearchQuery = useDebouncedText(directorySearchQuery, 180);

  const directorySuggestionsQuery = useQuery({
    queryKey: ["new-workspace-directory-suggestions", serverId, debouncedDirectorySearchQuery],
    queryFn: async () => {
      if (!client) return [];
      const result = await client.getDirectorySuggestions({
        query: debouncedDirectorySearchQuery,
        includeDirectories: true,
        includeFiles: false,
        limit: 30,
      });
      return (
        result.entries?.flatMap((entry) => (entry.kind === "directory" ? [entry.path] : [])) ?? []
      );
    },
    enabled: Boolean(client) && isConnected && directoryPickerOpen,
    staleTime: 15_000,
    retry: false,
  });

  const directoryOptions = useMemo<ComboboxOptionType[]>(() => {
    return buildNewWorkspaceDirectoryOptions({
      recommendedPaths,
      serverPaths: directorySuggestionsQuery.data ?? [],
      query: directorySearchQuery,
      selectedDirectory: normalizedSelectedDirectory,
      canPickLocalDirectory: isLocalDaemon,
    });
  }, [
    directorySearchQuery,
    directorySuggestionsQuery.data,
    isLocalDaemon,
    normalizedSelectedDirectory,
    recommendedPaths,
  ]);

  const openDirectoryPicker = useCallback(() => {
    if (isPending) {
      return;
    }
    setDirectoryPickerOpen(true);
  }, [isPending]);

  const handleAddLocalProject = useCallback(() => {
    void (async () => {
      try {
        const path = await pickDirectory();
        const trimmed = path?.trim();
        if (!trimmed) {
          return;
        }
        onDirectorySelected(trimmed);
      } catch (error) {
        onError(toErrorMessage(error));
      }
    })();
  }, [onDirectorySelected, onError]);

  const handleSelectDirectoryOption = useCallback(
    (directory: string) => {
      if (directory === NEW_WORKSPACE_ADD_PROJECT_OPTION_ID) {
        handleAddLocalProject();
        setDirectoryPickerOpen(false);
        setDirectorySearchQuery("");
        return;
      }
      const trimmed = directory.trim();
      if (!trimmed) {
        return;
      }
      onDirectorySelected(trimmed);
      setDirectoryPickerOpen(false);
      setDirectorySearchQuery("");
    },
    [handleAddLocalProject, onDirectorySelected],
  );

  const handleDirectoryPickerOpenChange = useCallback((nextOpen: boolean) => {
    setDirectoryPickerOpen(nextOpen);
    if (!nextOpen) {
      setDirectorySearchQuery("");
    }
  }, []);

  return {
    directoryOptions,
    directoryPickerOpen,
    handleDirectoryPickerOpenChange,
    handleSelectDirectoryOption,
    openDirectoryPicker,
    setDirectorySearchQuery,
  };
}

function submitWorkspaceDraft(input: SubmitDraftInput): void {
  const {
    serverId,
    draftKey,
    workspaceId,
    workspaceDirectory,
    text,
    attachments,
    provider,
    composerState,
  } = input;
  const draftId = generateDraftId();
  const clientMessageId = generateMessageId();
  const timestamp = Date.now();
  const wirePayload = splitComposerAttachmentsForSubmit(attachments);
  useCreateFlowStore.getState().setPending({
    serverId,
    draftId,
    agentId: null,
    clientMessageId,
    text: text.trim(),
    timestamp,
    ...(wirePayload.images.length > 0 ? { images: wirePayload.images } : {}),
    ...(wirePayload.attachments.length > 0 ? { attachments: wirePayload.attachments } : {}),
  });
  useWorkspaceDraftSubmissionStore.getState().setPending({
    serverId,
    workspaceId,
    draftId,
    text: text.trim(),
    attachments,
    cwd: workspaceDirectory,
    provider,
    ...(composerState.selectedRuntimeProvider &&
    composerState.selectedRuntimeProvider !== composerState.selectedProvider
      ? { runtimeProvider: composerState.selectedRuntimeProvider }
      : {}),
    clientMessageId,
    timestamp,
    ...(composerState.modeOptions.length > 0 && composerState.selectedMode !== ""
      ? { modeId: composerState.selectedMode }
      : {}),
    ...(composerState.effectiveModelId ? { model: composerState.effectiveModelId } : {}),
    ...(composerState.effectiveThinkingOptionId
      ? { thinkingOptionId: composerState.effectiveThinkingOptionId }
      : {}),
    ...(composerState.featureValues ? { featureValues: composerState.featureValues } : {}),
    allowEmptyText: true,
  });
  navigateToPreparedWorkspaceTab({
    serverId,
    workspaceId,
    target: { kind: "draft", draftId },
  });
  useDraftStore.getState().clearDraftInput({ draftKey, lifecycle: "sent" });
}

// eslint-disable-next-line complexity
export function NewWorkspaceScreen({
  serverId,
  sourceDirectory,
  displayName: displayNameProp,
  resetKey,
}: NewWorkspaceScreenProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const isCompact = useIsCompactFormFactor();
  // Shell DesktopSidebarControl is fixed; Soft Home topbar clears it when collapsed.
  const sidebarControlContentPad = useDesktopSidebarControlContentPad();
  const desktopSoftTopBarInnerStyle = useMemo(
    () => [
      styles.desktopSoftTopBarInner,
      sidebarControlContentPad > 0 ? { paddingLeft: sidebarControlContentPad } : null,
    ],
    [sidebarControlContentPad],
  );
  const toast = useToast();
  const openProject = useOpenProject(serverId);
  const mergeWorkspaces = useSessionStore((state) => state.mergeWorkspaces);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdWorkspace, setCreatedWorkspace] = useState<ReturnType<
    typeof normalizeWorkspaceDescriptor
  > | null>(null);
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(
    () => sourceDirectory?.trim() || null,
  );
  const [isImportSheetOpen, setIsImportSheetOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"chat" | "empty" | null>(null);
  const [manualPickerSelection, setManualPickerSelection] = useState<PickerSelection | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearchQuery, setPickerSearchQuery] = useState("");
  const debouncedPickerSearchQuery = useDebouncedText(pickerSearchQuery, 180);
  const pickerAnchorRef = useRef<View>(null);
  const directoryAnchorRef = useRef<View>(null);
  const resetKeyRef = useRef<string | null>(null);

  const displayName = displayNameProp?.trim() ?? "";
  const workspace = createdWorkspace;
  const isPending = pendingAction !== null;
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const recommendedPaths = useRecommendedProjectPaths(serverId);
  const draftKey = `new-workspace:${serverId}`;
  const chatDraft = useAgentInputDraft({
    draftKey,
    composer: buildComposerConfig({
      serverId,
      isConnected,
      workingDirectory: workspace?.workspaceDirectory ?? selectedDirectory,
    }),
  });
  const composerState = chatDraft.composerState;
  const clearDraft = chatDraft.clear;
  const [dismissedCheckoutHintPrNumbers, setDismissedCheckoutHintPrNumbers] =
    useCheckoutHintDismissals(chatDraft.attachments);

  const selectedItem = manualPickerSelection?.item ?? null;
  const normalizedSourceDirectory = sourceDirectory?.trim() || null;
  const normalizedSelectedDirectory = selectedDirectory?.trim() || null;

  const handleDirectorySelected = useCallback((directory: string) => {
    setSelectedDirectory(directory);
    setCreatedWorkspace(null);
    setManualPickerSelection(null);
    setErrorMessage(null);
  }, []);

  const handleDirectoryPickerError = useCallback(
    (message: string) => {
      setErrorMessage(message);
      toast.error(message);
    },
    [toast],
  );

  // Remember the directory the user most recently picked for a draft so the
  // next Soft Home draft (startup, 新对话) opens where this one left off.
  // Triggers on initial sourceDirectory, manual picker changes, and resets —
  // matching "the last draft the user opened, even if no message was sent".
  useEffect(() => {
    if (!serverId || !normalizedSelectedDirectory) {
      return;
    }
    rememberLastDraftDirectory(serverId, normalizedSelectedDirectory);
  }, [normalizedSelectedDirectory, serverId]);

  const {
    directoryOptions,
    directoryPickerOpen,
    handleDirectoryPickerOpenChange,
    handleSelectDirectoryOption,
    openDirectoryPicker,
    setDirectorySearchQuery,
  } = useNewWorkspaceDirectoryPicker({
    client,
    isConnected,
    isLocalDaemon,
    isPending,
    recommendedPaths,
    serverId,
    normalizedSelectedDirectory,
    onDirectorySelected: handleDirectorySelected,
    onError: handleDirectoryPickerError,
  });

  useEffect(() => {
    const reset = resolveNewWorkspaceDraftReset({
      currentResetKey: resetKeyRef.current,
      resetKey,
      sourceDirectory: normalizedSourceDirectory,
      pendingAction,
    });
    if (reset.kind === "unchanged") {
      return;
    }
    resetKeyRef.current = reset.nextResetKey;
    if (reset.kind === "pending") {
      return;
    }
    setCreatedWorkspace(null);
    setManualPickerSelection(null);
    setPickerOpen(false);
    setPickerSearchQuery("");
    setErrorMessage(null);
    setSelectedDirectory(reset.selectedDirectory);
    clearDraft("abandoned");
  }, [clearDraft, normalizedSourceDirectory, pendingAction, resetKey]);

  const withConnectedClient = useCallback(() => {
    if (!client || !isConnected) {
      throw new Error("Host is not connected");
    }
    return client;
  }, [client, isConnected]);

  const clientReady = isConnected && Boolean(client);
  const directoryReady = Boolean(normalizedSelectedDirectory);
  const branchQueryEnabled = clientReady && directoryReady;
  const pickerQueryEnabled = pickerOpen && clientReady && directoryReady;

  const checkoutStatusQuery = useQuery({
    queryKey: ["checkout-status", serverId, normalizedSelectedDirectory],
    queryFn: async () => {
      const connectedClient = withConnectedClient();
      if (!normalizedSelectedDirectory) {
        throw new Error("Select a working directory");
      }
      return connectedClient.getCheckoutStatus(normalizedSelectedDirectory);
    },
    enabled: clientReady && directoryReady,
    staleTime: Infinity,
    retry: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  const currentBranch = checkoutStatusQuery.data?.currentBranch ?? null;

  const branchSuggestionsQuery = useQuery({
    queryKey: [
      "branch-suggestions",
      serverId,
      normalizedSelectedDirectory,
      debouncedPickerSearchQuery,
    ],
    queryFn: async () => {
      const connectedClient = withConnectedClient();
      if (!normalizedSelectedDirectory) {
        throw new Error("Select a working directory");
      }
      return connectedClient.getBranchSuggestions({
        cwd: normalizedSelectedDirectory,
        query: debouncedPickerSearchQuery || undefined,
        limit: 20,
      });
    },
    enabled: branchQueryEnabled,
    staleTime: 15_000,
    retry: false,
  });

  const githubPrSearchQuery = useGithubSearchQuery({
    client,
    serverId,
    cwd: normalizedSelectedDirectory ?? "",
    query: debouncedPickerSearchQuery,
    kinds: ["github-pr"],
    enabled: pickerQueryEnabled,
  });

  const branchDetails = useMemo(
    () =>
      seedCurrentBranchDetails(currentBranch, normalizeBranchDetails(branchSuggestionsQuery.data)),
    [branchSuggestionsQuery.data, currentBranch],
  );
  const githubFeaturesEnabled = githubPrSearchQuery.data?.githubFeaturesEnabled !== false;
  const prItems: GitHubSearchItem[] = useMemo(() => {
    if (!githubFeaturesEnabled) return [];
    return githubPrSearchQuery.data?.items ?? [];
  }, [githubFeaturesEnabled, githubPrSearchQuery.data?.items]);

  const { options, itemById }: PickerOptionData = useMemo(
    () => computePickerOptionData(branchDetails, prItems),
    [branchDetails, prItems],
  );

  const triggerLabel = useMemo(() => {
    if (selectedItem) return pickerItemTriggerLabel(selectedItem);
    return currentBranch ?? "main";
  }, [currentBranch, selectedItem]);

  const selectedOptionId = useMemo(() => {
    if (!selectedItem) return "";
    if (selectedItem.kind === "branch") return branchOptionId(selectedItem.name);
    if (selectedItem.kind === "new-branch") return selectedItem.name;
    return prOptionId(selectedItem.item.number);
  }, [selectedItem]);

  const selectPickerItem = useCallback(
    (item: PickerItem) => {
      const next = syncPickerPrAttachment({
        attachments: chatDraft.attachments,
        previousPickerPrNumber: manualPickerSelection?.attachedPrNumber ?? null,
        item,
      });

      setManualPickerSelection({
        item,
        attachedPrNumber: next.attachedPrNumber,
      });
      if (next.attachments !== chatDraft.attachments) {
        chatDraft.setAttachments(next.attachments);
      }
      setPickerOpen(false);
    },
    [chatDraft, manualPickerSelection?.attachedPrNumber],
  );

  const handleSelectOption = useCallback(
    (id: string) => {
      const item = itemById.get(id);
      if (item) {
        selectPickerItem(item);
        return;
      }
      const branchName = id.trim();
      const validation = validateBranchSlug(branchName);
      if (!validation.valid) {
        toast.error(t("sidebar.invalidBranchName"));
        return;
      }
      selectPickerItem({ kind: "new-branch", name: branchName, baseRefName: currentBranch });
    },
    [currentBranch, itemById, selectPickerItem, t, toast],
  );

  const checkoutHintPrAttachment = useMemo(
    () =>
      findCheckoutHintPrAttachment({
        attachments: chatDraft.attachments,
        selectedItem,
        dismissedPrNumbers: dismissedCheckoutHintPrNumbers,
      }),
    [chatDraft.attachments, dismissedCheckoutHintPrNumbers, selectedItem],
  );

  const acceptCheckoutHint = useCallback(() => {
    if (!checkoutHintPrAttachment) return;
    selectPickerItem({ kind: "github-pr", item: checkoutHintPrAttachment.item });
  }, [checkoutHintPrAttachment, selectPickerItem]);

  const dismissCheckoutHint = useCallback(() => {
    if (!checkoutHintPrAttachment) return;
    const prNumber = checkoutHintPrAttachment.item.number;
    setDismissedCheckoutHintPrNumbers((current) => {
      if (current.has(prNumber)) return current;
      const next = new Set(current);
      next.add(prNumber);
      return next;
    });
  }, [checkoutHintPrAttachment, setDismissedCheckoutHintPrNumbers]);

  const openPicker = useCallback(() => {
    setPickerOpen(true);
  }, []);

  const handleClearDraft = useCallback(() => {
    // No-op: screen navigates away on success, text should stay for retry on error
  }, []);

  const badgePressableStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.badge,
      Boolean(hovered) && !isPending && styles.badgeHovered,
      pressed && !isPending && styles.badgePressed,
      isPending && styles.badgeDisabled,
    ],
    [isPending],
  );

  const handlePickerOpenChange = useCallback((nextOpen: boolean) => {
    setPickerOpen(nextOpen);
    if (!nextOpen) {
      setPickerSearchQuery("");
    }
  }, []);

  const ensureWorkspace = useCallback(
    async (input: { cwd: string; prompt: string; attachments: AgentAttachment[] }) => {
      if (createdWorkspace) {
        return createdWorkspace;
      }
      const workspaces = useSessionStore.getState().sessions[serverId]?.workspaces;
      const plan = planNewWorkspaceSendOpen({
        cwd: input.cwd,
        openWorkspaces: workspaces
          ? Array.from(workspaces.values()).map((openWorkspace) => ({
              id: openWorkspace.id,
              workspaceDirectory: openWorkspace.workspaceDirectory,
            }))
          : [],
      });
      if (plan.mode === "reuse-open") {
        const existing = useSessionStore
          .getState()
          .sessions[serverId]?.workspaces.get(plan.workspaceId);
        if (existing) {
          setCreatedWorkspace(existing);
          return existing;
        }
      }
      const normalizedWorkspace = await openAndMergeWorkspace({
        client: withConnectedClient(),
        cwd: input.cwd,
        mergeWorkspaces,
        serverId,
      });
      setCreatedWorkspace(normalizedWorkspace);
      return normalizedWorkspace;
    },
    [createdWorkspace, mergeWorkspaces, serverId, withConnectedClient],
  );

  const handleSubmitNewWorkspace = useCallback(
    async (payload: MessagePayload) => {
      try {
        setErrorMessage(null);
        if (!normalizedSelectedDirectory) {
          throw new Error(t("workspace.directoryPicker.required"));
        }
        const payloadWithDirectory = {
          ...payload,
          cwd: normalizedSelectedDirectory,
        };
        if (isEmptyWorkspaceSubmission(payload)) {
          setPendingAction("empty");
          await runCreateEmptyWorkspace({
            payload: payloadWithDirectory,
            ensureWorkspace,
            serverId,
            navigate: navigateToWorkspace,
          });
          return;
        }

        setPendingAction("chat");
        await runCreateChatAgent({
          payload: payloadWithDirectory,
          composerState,
          ensureWorkspace,
          serverId,
          draftKey,
        });
      } catch (error) {
        const message = toErrorMessage(error);
        setPendingAction(null);
        setErrorMessage(message);
        toast.error(message);
      }
    },
    [composerState, draftKey, ensureWorkspace, normalizedSelectedDirectory, serverId, t, toast],
  );

  const workspaceTitle = computeWorkspaceTitle(workspace, displayName, sourceDirectory);

  const addImagesRef = useRef<((images: ImageAttachment[]) => void) | null>(null);
  const handleAddImagesCallback = useCallback((addImages: (images: ImageAttachment[]) => void) => {
    addImagesRef.current = addImages;
  }, []);
  const handleFilesDropped = useCallback((files: ImageAttachment[]) => {
    addImagesRef.current?.(files);
  }, []);
  const handleOpenImportSheet = useCallback(() => setIsImportSheetOpen(true), []);
  const handleCloseImportSheet = useCallback(() => setIsImportSheetOpen(false), []);
  const handleImported = useCallback(
    (agent: { id: string; cwd: string }) => {
      void (async () => {
        await openProject(agent.cwd);
        router.push(buildHostAgentDetailRoute(serverId, agent.id) as Href);
      })();
    },
    [openProject, router, serverId],
  );

  const renderPickerOption = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOptionType;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => {
      const item = itemById.get(option.id);
      const description =
        item?.kind === "github-pr" && item.item.baseRefName
          ? t("workspace.intoBaseRef", { baseRefName: item.item.baseRefName })
          : undefined;
      const renderModel = pickerOptionToRenderModel(option, item, description);

      return (
        <PickerOptionItem
          testID={renderModel.testID}
          label={renderModel.label}
          description={renderModel.description}
          selected={selected}
          active={active}
          disabled={isPending}
          onPress={onPress}
          isBranch={renderModel.isBranch}
          iconSize={ICON_SIZE.sm}
        />
      );
    },
    [isPending, itemById, t],
  );

  const agentControlsWithDisabled = useMemo(
    () =>
      composerState
        ? {
            ...composerState.agentControls,
            disabled: isPending,
          }
        : undefined,
    [composerState, isPending],
  );

  const pickerEmptyText = resolveBranchPickerEmptyText({
    hasBranchOptions: branchDetails.length > 0,
    branchesFetching: branchSuggestionsQuery.isFetching,
    searchingLabel: t("workspace.searching"),
    noMatchLabel: t("workspace.noMatchingRefs"),
  });

  const workspaceControls = useMemo(
    () => (
      <NewWorkspaceComposerFooter
        directoryAnchorRef={directoryAnchorRef}
        normalizedSelectedDirectory={normalizedSelectedDirectory}
        openDirectoryPicker={openDirectoryPicker}
        isPending={isPending}
        badgePressableStyle={badgePressableStyle}
        iconSize={ICON_SIZE.sm}
        isLocalDaemon={isLocalDaemon}
        directoryOptions={directoryOptions}
        handleSelectDirectoryOption={handleSelectDirectoryOption}
        directoryPickerOpen={directoryPickerOpen}
        handleDirectoryPickerOpenChange={handleDirectoryPickerOpenChange}
        setDirectorySearchQuery={setDirectorySearchQuery}
        pickerAnchorRef={pickerAnchorRef}
        openPicker={openPicker}
        refPickerDisabled={
          isPending || !normalizedSelectedDirectory || checkoutStatusQuery.data?.isGit === false
        }
        selectedItem={selectedItem}
        triggerLabel={triggerLabel}
        options={options}
        selectedOptionId={selectedOptionId}
        handleSelectOption={handleSelectOption}
        pickerOpen={pickerOpen}
        handlePickerOpenChange={handlePickerOpenChange}
        setPickerSearchQuery={setPickerSearchQuery}
        pickerEmptyText={pickerEmptyText}
        renderPickerOption={renderPickerOption}
        // Keep mode control inside the composer input footer (not this context row).
        agentControls={undefined}
        checkoutHintPrAttachment={checkoutHintPrAttachment}
        acceptCheckoutHint={acceptCheckoutHint}
        dismissCheckoutHint={dismissCheckoutHint}
        onImportPress={isPending ? null : handleOpenImportSheet}
      />
    ),
    [
      acceptCheckoutHint,
      badgePressableStyle,
      checkoutHintPrAttachment,
      checkoutStatusQuery.data?.isGit,
      directoryOptions,
      directoryPickerOpen,
      dismissCheckoutHint,
      handleDirectoryPickerOpenChange,
      handleOpenImportSheet,
      handlePickerOpenChange,
      handleSelectDirectoryOption,
      handleSelectOption,
      isLocalDaemon,
      isPending,
      normalizedSelectedDirectory,
      openDirectoryPicker,
      openPicker,
      options,
      pickerEmptyText,
      pickerOpen,
      renderPickerOption,
      selectedItem,
      selectedOptionId,
      setDirectorySearchQuery,
      setPickerSearchQuery,
      triggerLabel,
    ],
  );

  // Soft Home context is path/branch/import only — hero owns the compact title stack.
  const softHomeContextSlot = useMemo(() => workspaceControls, [workspaceControls]);

  const softHomeComposer = (
    <SoftHomeEmpty
      formErrorMessage={errorMessage}
      compact={isCompact}
      contextSlot={softHomeContextSlot}
    >
      <Composer
        agentId={`new-workspace:${serverId}:${sourceDirectory}`}
        serverId={serverId}
        isPaneFocused={true}
        onSubmitMessage={handleSubmitNewWorkspace}
        allowEmptySubmit={true}
        submitButtonAccessibilityLabel={t("workspace.create")}
        submitIcon="return"
        isSubmitLoading={pendingAction !== null}
        submitBehavior="preserve-and-lock"
        blurOnSubmit={true}
        value={chatDraft.text}
        onChangeText={chatDraft.setText}
        attachments={chatDraft.attachments}
        onChangeAttachments={chatDraft.setAttachments}
        cwd={normalizedSelectedDirectory ?? ""}
        clearDraft={handleClearDraft}
        autoFocus
        commandDraftConfig={composerState?.commandDraftConfig}
        agentControls={agentControlsWithDisabled}
        onAddImages={handleAddImagesCallback}
        placeholder={t("workspace.softHomeComposerPlaceholder")}
        inputWrapperStyle={styles.draftComposerInputWrapper}
        // Soft Home host owns horizontal inset; zero Composer dock pad on all form factors.
        inputAreaStyle={softHomeComposerInputAreaStyle}
      />
    </SoftHomeEmpty>
  );

  return (
    <FileDropZone onFilesDropped={handleFilesDropped}>
      <View style={styles.container}>
        {isCompact ? (
          <ScreenHeader
            left={
              <>
                <SidebarMenuToggle />
                <View style={styles.headerTitleContainer}>
                  <Text style={styles.headerTitle} numberOfLines={1}>
                    {t("workspace.newWorkspace")}
                  </Text>
                  <Text style={styles.headerProjectTitle} numberOfLines={1}>
                    {workspaceTitle}
                  </Text>
                </View>
              </>
            }
            leftStyle={styles.headerLeft}
            borderless
          />
        ) : (
          <View style={styles.desktopSoftTopBar}>
            <TitlebarDragRegion />
            {/* Desktop open/close is shell DesktopSidebarControl (T3 SidebarTrigger). */}
            <View style={desktopSoftTopBarInnerStyle}>
              <View style={styles.desktopSoftTopSpacer} />
            </View>
          </View>
        )}
        <View style={styles.content}>{softHomeComposer}</View>
        <ImportSessionSheet
          visible={isImportSheetOpen}
          client={client}
          serverId={serverId}
          cwd={normalizedSelectedDirectory}
          onClose={handleCloseImportSheet}
          onImported={handleImported}
        />
      </View>
    </FileDropZone>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surfaceWorkspace,
    userSelect: "none",
  },
  content: {
    position: "relative",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    width: "100%",
    // Explicit column so vertical spacers and compact flex-end placement work.
    flexDirection: "column",
  },
  desktopSoftTopBar: {
    height: 48,
    position: "relative",
    // Match Soft shell canvas so caption overlay and content share one continuous band.
    backgroundColor: theme.colors.surfaceWorkspace,
    justifyContent: "center",
  },
  desktopSoftTopBarInner: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: theme.spacing[4],
    // Keep “导入会话” clear of native caption buttons (Electron overlay).
    paddingRight: theme.spacing[4] + (getIsElectronRuntime() ? DESKTOP_WINDOW_CONTROLS_WIDTH : 0),
    gap: theme.spacing[2],
  },
  desktopSoftTopSpacer: {
    flex: 1,
  },
  importAction: {
    minHeight: 30,
    height: 30,
    paddingVertical: 0,
    paddingHorizontal: 12,
    flexShrink: 0,
  },
  // Soft Workbench: large floating pen-bar (shared Soft Home shell).
  draftComposerInputWrapper: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    ...softHomeComposerInputWrapperStyle,
  },
  headerLeft: {
    gap: theme.spacing[2],
  },
  headerTitleContainer: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  headerTitle: {
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: {
      xs: "400",
      md: "300",
    },
    color: theme.colors.foreground,
    flexShrink: 0,
  },
  headerProjectTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: 14.5,
    lineHeight: 20,
    flexShrink: 1,
  },
  optionsRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  // Soft home: pills sit just above the pen-bar and must not exceed composer width.
  composerContextRow: {
    width: "100%",
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  composerContextPills: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    height: 30,
    maxWidth: 220,
    paddingHorizontal: 10,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    gap: theme.spacing[1],
  },
  checkoutHintBadge: {
    flexDirection: "row",
    alignItems: "center",
    height: 28,
    maxWidth: 240,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    gap: theme.spacing[1],
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  checkoutHintAction: {
    width: ICON_SIZE.md,
    height: ICON_SIZE.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.full,
  },
  badgeHovered: {
    backgroundColor: theme.colors.surface1,
  },
  badgePressed: {
    backgroundColor: theme.colors.surface1,
  },
  badgeDisabled: {
    opacity: 0.6,
  },
  badgeText: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  tooltipText: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.popoverForeground,
  },
  badgeIconBox: {
    width: ICON_SIZE.md,
    height: ICON_SIZE.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowIconBox: {
    width: ICON_SIZE.md,
    height: ICON_SIZE.md,
    alignItems: "center",
    justifyContent: "center",
  },
}));
