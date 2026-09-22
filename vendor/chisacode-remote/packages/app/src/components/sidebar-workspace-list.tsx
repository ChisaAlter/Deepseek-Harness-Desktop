import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { slugify, validateBranchSlug, MAX_SLUG_LENGTH } from "@chisacode/protocol/branch-slug";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { invalidateCheckoutGitQueriesForClient } from "@/git/query-keys";
import {
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  type ReactElement,
  type MutableRefObject,
  type Ref,
} from "react";
import { router, usePathname, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { type GestureType } from "react-native-gesture-handler";
import * as Clipboard from "expo-clipboard";
import { DiffStat } from "@/components/diff-stat";
import { FolderPlus, Globe, SquareTerminal, Plus } from "lucide-react-native";
import { NestableScrollContainer } from "react-native-draggable-flatlist";
import { DraggableList, type DraggableRenderItemInfo } from "./draggable-list";
import type { DraggableListDragHandleProps } from "./draggable-list.types";
import { getHostRuntimeStore, isHostRuntimeConnected } from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";
import { projectIconQueryKey, projectIconToDataUri } from "@/hooks/use-project-icon-query";
import {
  buildHostNewWorkspaceRoute,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";
import {
  createSidebarWorkspaceEntry,
  type SidebarProjectEntry,
  type SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useShowShortcutBadges } from "@/hooks/use-show-shortcut-badges";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  useContextMenu,
} from "@/components/ui/context-menu";

import { useToast } from "@/contexts/toast-context";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { hasVisibleOrderChanged, mergeWithRemainder } from "@/utils/sidebar-reorder";
import { useSidebarLongPressDragInteraction } from "@/hooks/use-sidebar-long-press-drag";
import { useSidebarWorkspaceHide } from "@/hooks/use-sidebar-workspace-hide";
import { confirmDialog } from "@/utils/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { PrHint } from "@/git/use-pr-status-query";
import { buildSidebarProjectRowModel } from "@/utils/sidebar-project-row-model";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import {
  requireWorkspaceExecutionDirectory,
  resolveWorkspaceExecutionDirectory,
} from "@/utils/workspace-execution";
import { confirmRiskyWorktreeArchive } from "@/git/worktree-archive-warning";
import { archiveWorkspacesOptimistically } from "@/workspace/workspace-archive";
import { WorkspaceHoverCard } from "@/components/workspace-hover-card";
import { PrBadge } from "@/components/pr-badge";
import { ProjectKebabMenu, WorkspaceKebabMenu } from "@/components/sidebar-workspace-menus";
import {
  ProjectLeadingVisual,
  WORKSPACE_STATUS_DOT_WIDTH,
  WorkspaceStatusIndicator,
} from "@/components/sidebar-workspace-status-visuals";
import { GitHubIcon } from "@/components/icons/github-icon";
import { isWeb as platformIsWeb, isNative as platformIsNative } from "@/constants/platform";
import { generateDraftId } from "@/stores/draft-keys";

const workspaceKeyExtractor = (workspace: SidebarWorkspaceEntry) => workspace.workspaceKey;

const projectKeyExtractor = (project: SidebarProjectEntry) => project.projectKey;

const ThemedGitHubIcon = withUnistyles(GitHubIcon);
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedFolderPlus = withUnistyles(FolderPlus);
const ThemedGlobe = withUnistyles(Globe);
const ThemedSquareTerminal = withUnistyles(SquareTerminal);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const redColorMapping = (theme: Theme) => ({ color: theme.colors.palette.red[500] });
const blueColorMapping = (theme: Theme) => ({ color: theme.colors.palette.blue[500] });
interface SidebarWorkspaceListProps {
  projects: SidebarProjectEntry[];
  serverId: string | null;
  collapsedProjectKeys: ReadonlySet<string>;
  onToggleProjectCollapsed: (projectKey: string) => void;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  onWorkspacePress?: () => void;
  onAddProject?: () => void;
  listFooterComponent?: ReactElement | null;
  /** Gesture ref for coordinating with parent gestures (e.g., sidebar close) */
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
}

interface ProjectHeaderRowProps {
  project: SidebarProjectEntry;
  displayName: string;
  iconDataUri: string | null;
  workspace: SidebarWorkspaceEntry | null;
  selected?: boolean;
  chevron: "expand" | "collapse" | null;
  onPress: () => void;
  serverId: string | null;
  canCreateWorktree: boolean;
  isProjectActive?: boolean;
  onWorkspacePress?: () => void;
  onWorktreeCreated?: (workspaceId: string) => void;
  shortcutNumber?: number | null;
  showShortcutBadge?: boolean;
  drag: () => void;
  isDragging: boolean;
  isArchiving?: boolean;
  menuController: ReturnType<typeof useContextMenu> | null;
  onRemoveProject?: () => void;
  removeProjectStatus?: "idle" | "pending";
  dragHandleProps?: DraggableListDragHandleProps;
}

interface WorkspaceRowInnerProps {
  workspace: SidebarWorkspaceEntry;
  selected: boolean;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  onPress: () => void;
  drag: () => void;
  isDragging: boolean;
  isArchiving: boolean;
  isCreating?: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  menuController: ReturnType<typeof useContextMenu> | null;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  onArchive?: () => void;
  onCopyBranchName?: () => void;
  onCopyPath?: () => void;
  onRename?: () => void;
  archiveShortcutKeys?: ShortcutKey[][] | null;
}

function getWorkspaceArchiveStatus(
  isWorktree: boolean,
  archiveStatus: "idle" | "pending" | "success",
  isHidingWorkspace: boolean,
): "idle" | "pending" | "success" {
  if (isWorktree) return archiveStatus;
  if (isHidingWorkspace) return "pending";
  return "idle";
}

function useSidebarWorkspaceEntry(
  serverId: string | null,
  workspaceId: string | null,
): SidebarWorkspaceEntry | null {
  const projectWorkspaceEntry = useCallback(
    (workspace: WorkspaceDescriptor): SidebarWorkspaceEntry =>
      createSidebarWorkspaceEntry({ serverId: serverId ?? "", workspace }),
    [serverId],
  );

  return useWorkspaceFields(serverId, workspaceId, projectWorkspaceEntry);
}

function noop() {}

function ChecksBadge({ checks }: { checks: PrHint["checks"] }): ReactElement | null {
  if (!checks || checks.length === 0) return null;

  const failed = checks.filter((c) => c.status === "failure").length;
  if (failed === 0) return null;

  const label = `${failed} failed`;

  return (
    <View style={checksBadgeStyles.badge}>
      <ThemedGitHubIcon size={10} uniProps={redColorMapping} />
      <Text style={checksBadgeStyles.text}>{label}</Text>
    </View>
  );
}

const checksBadgeStyles = StyleSheet.create((theme) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  text: {
    fontSize: 12.5,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 16,
    color: theme.colors.palette.red[500],
  },
}));

function ProjectRowTrailingActions({
  project,
  displayName,
  canCreateWorktree,
  isHovered,
  isMobileBreakpoint,
  isProjectActive,
  onBeginWorkspaceSetup,
  onRemoveProject,
  removeProjectStatus,
}: {
  project: SidebarProjectEntry;
  displayName: string;
  canCreateWorktree: boolean;
  isHovered: boolean;
  isMobileBreakpoint: boolean;
  isProjectActive: boolean;
  onBeginWorkspaceSetup: () => void;
  onRemoveProject?: () => void;
  removeProjectStatus: "idle" | "pending" | "success";
}) {
  const actionsVisible = isHovered || platformIsNative || isMobileBreakpoint;
  return (
    <View style={styles.projectTrailingActions}>
      {canCreateWorktree ? (
        <NewWorktreeButton
          displayName={displayName}
          onPress={onBeginWorkspaceSetup}
          visible={actionsVisible}
          showShortcutHint={isProjectActive}
          testID={`sidebar-project-new-worktree-${project.projectKey}`}
        />
      ) : null}
      {onRemoveProject ? (
        <View
          style={!actionsVisible && styles.projectKebabButtonHidden}
          pointerEvents={actionsVisible ? "auto" : "none"}
        >
          <ProjectKebabMenu
            projectKey={project.projectKey}
            onRemoveProject={onRemoveProject}
            removeProjectStatus={removeProjectStatus}
          />
        </View>
      ) : null}
    </View>
  );
}

function WorkspaceRowRightGroup({
  workspace,
  isHovered,
  isTouchPlatform,
  isMobileBreakpoint,
  showScriptsIcon,
  hasRunningService,
  isCreating,
  showShortcutBadge,
  shortcutNumber,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  onArchive,
  onCopyBranchName,
  onCopyPath,
  onRename,
}: {
  workspace: SidebarWorkspaceEntry;
  isHovered: boolean;
  isTouchPlatform: boolean;
  isMobileBreakpoint: boolean;
  showScriptsIcon: boolean;
  hasRunningService: boolean;
  isCreating: boolean;
  showShortcutBadge: boolean;
  shortcutNumber: number | null;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  onArchive?: () => void;
  onCopyBranchName?: () => void;
  onCopyPath?: () => void;
  onRename?: () => void;
}) {
  const { t } = useTranslation();
  const showKebab = Boolean(onArchive && (isHovered || isTouchPlatform || isMobileBreakpoint));
  return (
    <View style={styles.workspaceRowRight}>
      {showScriptsIcon ? (
        <View testID="workspace-globe-icon" accessibilityLabel={t("sidebar.scriptsAvailable")}>
          {hasRunningService ? (
            <ThemedGlobe size={12} uniProps={blueColorMapping} />
          ) : (
            <ThemedSquareTerminal size={12} uniProps={blueColorMapping} />
          )}
        </View>
      ) : null}
      {isCreating ? (
        <Text style={styles.workspaceCreatingText}>{t("sidebar.creating")}</Text>
      ) : null}
      {showKebab && onArchive ? (
        <WorkspaceKebabMenu
          workspaceKey={workspace.workspaceKey}
          onCopyPath={onCopyPath}
          onCopyBranchName={onCopyBranchName}
          onRename={onRename}
          onArchive={onArchive}
          archiveLabel={archiveLabel}
          archiveStatus={archiveStatus}
          archivePendingLabel={archivePendingLabel}
          archiveShortcutKeys={archiveShortcutKeys}
        />
      ) : null}
      {!showKebab && workspace.diffStat ? (
        <DiffStat
          additions={workspace.diffStat.additions}
          deletions={workspace.diffStat.deletions}
        />
      ) : null}
      {showShortcutBadge && shortcutNumber !== null ? (
        <View style={styles.shortcutBadge}>
          <Text style={styles.shortcutBadgeText}>{shortcutNumber}</Text>
        </View>
      ) : null}
    </View>
  );
}

function NewWorktreeButton({
  displayName,
  onPress,
  visible,
  loading = false,
  testID,
  showShortcutHint = false,
}: {
  displayName: string;
  onPress: () => void;
  visible: boolean;
  loading?: boolean;
  testID: string;
  showShortcutHint?: boolean;
}) {
  const { t } = useTranslation();
  const newWorktreeKeys = useShortcutKeys("new-worktree");

  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.projectIconActionButton,
      !visible && styles.projectIconActionButtonHidden,
      (Boolean(hovered) || pressed) && !loading && styles.projectIconActionButtonHovered,
    ],
    [visible, loading],
  );

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onPress();
    },
    [onPress],
  );

  return (
    <View style={styles.projectTrailingControlSlot} pointerEvents={visible ? "auto" : "none"}>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild disabled={!visible}>
          <Pressable
            style={pressableStyle}
            onPress={handlePress}
            disabled={loading}
            accessibilityRole={platformIsWeb ? undefined : "button"}
            accessibilityLabel={t("sidebar.createWorkspaceForProject", { project: displayName })}
            testID={testID}
          >
            {({ hovered, pressed }) =>
              loading ? (
                <ThemedActivityIndicator size={14} uniProps={foregroundMutedColorMapping} />
              ) : (
                <ThemedFolderPlus
                  size={15}
                  uniProps={
                    hovered || pressed ? foregroundColorMapping : foregroundMutedColorMapping
                  }
                />
              )
            }
          </Pressable>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={8}>
          <View style={styles.projectActionTooltipRow}>
            <Text style={styles.projectActionTooltipText}>{t("sidebar.newWorkspace")}</Text>
            {showShortcutHint && newWorktreeKeys ? (
              <Shortcut chord={newWorktreeKeys} style={styles.projectActionTooltipShortcut} />
            ) : null}
          </View>
        </TooltipContent>
      </Tooltip>
    </View>
  );
}

function ProjectHeaderRow({
  project,
  displayName,
  iconDataUri,
  workspace,
  selected = false,
  chevron,
  onPress,
  serverId,
  canCreateWorktree,
  isProjectActive = false,
  onWorkspacePress,
  onWorktreeCreated: _onWorktreeCreated,
  shortcutNumber = null,
  showShortcutBadge = false,
  drag,
  isDragging,
  isArchiving = false,
  menuController,
  onRemoveProject,
  removeProjectStatus = "idle",
  dragHandleProps,
}: ProjectHeaderRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const isMobileBreakpoint = useIsCompactFormFactor();
  const handleBeginWorkspaceSetup = useCallback(() => {
    if (!serverId) {
      return;
    }
    router.navigate(
      buildHostNewWorkspaceRoute(serverId, project.iconWorkingDir, {
        displayName,
        projectId: project.projectKey,
        draftKey: generateDraftId(),
      }) as Href,
    );
    onWorkspacePress?.();
  }, [displayName, onWorkspacePress, project.iconWorkingDir, project.projectKey, serverId]);
  const _mergeWorkspaces = useSessionStore((state) => state.mergeWorkspaces);
  const _toast = useToast();

  const interaction = useSidebarLongPressDragInteraction({
    drag,
    menuController,
  });
  const {
    role: _dragRole,
    tabIndex: _dragTabIndex,
    "aria-roledescription": _dragRoleDescription,
    ...dragAttributes
  } = dragHandleProps?.attributes ?? {};

  const handlePress = useCallback(() => {
    if (interaction.didLongPressRef.current) {
      interaction.didLongPressRef.current = false;
      return;
    }
    onPress();
  }, [interaction.didLongPressRef, onPress]);

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const projectRowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.projectRow,
      isDragging && styles.projectRowDragging,
      selected && styles.sidebarRowSelected,
      isHovered && styles.projectRowHovered,
      pressed && styles.projectRowPressed,
    ],
    [isDragging, selected, isHovered],
  );

  const rowChildren = (
    <>
      <View style={styles.projectRowLeft}>
        <ProjectLeadingVisual
          displayName={displayName}
          iconDataUri={iconDataUri}
          workspace={workspace}
          projectKey={project.projectKey}
          chevron={chevron}
          showChevron={isHovered && chevron !== null}
          isArchiving={isArchiving}
        />

        <View style={styles.projectTitleGroup}>
          <Text style={styles.projectTitle} numberOfLines={1}>
            {displayName}
          </Text>
        </View>
      </View>
      <ProjectRowTrailingActions
        project={project}
        displayName={displayName}
        canCreateWorktree={canCreateWorktree}
        isHovered={isHovered}
        isMobileBreakpoint={isMobileBreakpoint}
        isProjectActive={isProjectActive}
        onBeginWorkspaceSetup={handleBeginWorkspaceSetup}
        onRemoveProject={onRemoveProject}
        removeProjectStatus={removeProjectStatus}
      />
      {showShortcutBadge && shortcutNumber !== null ? (
        <View style={styles.shortcutBadge}>
          <Text style={styles.shortcutBadgeText}>{shortcutNumber}</Text>
        </View>
      ) : null}
    </>
  );

  if (menuController) {
    return (
      <View
        {...dragAttributes}
        {...dragHandleProps?.listeners}
        ref={dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <ContextMenuTrigger
          enabledOnMobile={false}
          accessibilityRole="button"
          style={projectRowStyle}
          onPressIn={interaction.handlePressIn}
          onTouchMove={interaction.handleTouchMove}
          onPressOut={interaction.handlePressOut}
          onPress={handlePress}
          testID={`sidebar-project-row-${project.projectKey}`}
        >
          {rowChildren}
        </ContextMenuTrigger>
      </View>
    );
  }

  return (
    <View
      {...dragAttributes}
      {...dragHandleProps?.listeners}
      ref={dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Pressable
        accessibilityRole="button"
        style={projectRowStyle}
        onPressIn={interaction.handlePressIn}
        onTouchMove={interaction.handleTouchMove}
        onPressOut={interaction.handlePressOut}
        onPress={handlePress}
        testID={`sidebar-project-row-${project.projectKey}`}
      >
        {rowChildren}
      </Pressable>
    </View>
  );
}

function WorkspaceRowInner({
  workspace,
  selected,
  shortcutNumber,
  showShortcutBadge,
  onPress,
  drag,
  isDragging,
  isArchiving,
  isCreating = false,
  dragHandleProps,
  menuController,
  archiveLabel,
  archiveStatus = "idle",
  archivePendingLabel,
  onArchive,
  onCopyBranchName,
  onCopyPath,
  onRename,
  archiveShortcutKeys,
}: WorkspaceRowInnerProps) {
  const isMobileBreakpoint = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const isTouchPlatform = platformIsNative;
  const prHint = workspace.prHint;
  const interaction = useSidebarLongPressDragInteraction({
    drag,
    menuController,
  });
  const {
    role: _dragRole,
    tabIndex: _dragTabIndex,
    "aria-roledescription": _dragRoleDescription,
    ...dragAttributes
  } = dragHandleProps?.attributes ?? {};

  const handlePress = useCallback(() => {
    if (interaction.didLongPressRef.current) {
      interaction.didLongPressRef.current = false;
      return;
    }
    onPress();
  }, [interaction.didLongPressRef, onPress]);

  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);

  const workspaceRowStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.workspaceRow,
      isDragging && styles.workspaceRowDragging,
      selected && styles.sidebarRowSelected,
      isHovered && styles.workspaceRowHovered,
      pressed && styles.workspaceRowPressed,
    ],
    [isDragging, selected, isHovered],
  );

  const isDesktop = !isTouchPlatform;
  const showScriptsIcon = isDesktop && workspace.hasRunningScripts;
  const hasRunningService = workspace.scripts.some(
    (s) => s.lifecycle === "running" && (s.type ?? "service") === "service",
  );

  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const workspaceBranchTextStyle = useMemo(
    () => [
      styles.workspaceBranchText,
      isHovered && styles.workspaceBranchTextHovered,
      isCreating && styles.workspaceBranchTextCreating,
    ],
    [isHovered, isCreating],
  );
  return (
    <WorkspaceHoverCard workspace={workspace} prHint={prHint} isDragging={isDragging}>
      <View
        {...dragAttributes}
        {...dragHandleProps?.listeners}
        ref={dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>}
        style={styles.workspaceRowContainer}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <Pressable
          disabled={isArchiving}
          aria-selected={selected}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          style={workspaceRowStyle}
          onPressIn={interaction.handlePressIn}
          onTouchMove={interaction.handleTouchMove}
          onPressOut={interaction.handlePressOut}
          onPress={handlePress}
          testID={`sidebar-workspace-row-${workspace.workspaceKey}`}
        >
          <View style={styles.workspaceRowMain}>
            <View style={styles.workspaceRowLeft}>
              <WorkspaceStatusIndicator
                bucket={workspace.statusBucket}
                workspaceKind={workspace.workspaceKind}
                loading={isArchiving || isCreating}
              />
              <Text style={workspaceBranchTextStyle} numberOfLines={1}>
                {workspace.name}
              </Text>
            </View>
            <WorkspaceRowRightGroup
              workspace={workspace}
              isHovered={isHovered}
              isTouchPlatform={isTouchPlatform}
              isMobileBreakpoint={isMobileBreakpoint}
              showScriptsIcon={showScriptsIcon}
              hasRunningService={hasRunningService}
              isCreating={isCreating}
              showShortcutBadge={showShortcutBadge}
              shortcutNumber={shortcutNumber}
              archiveLabel={archiveLabel}
              archiveStatus={archiveStatus}
              archivePendingLabel={archivePendingLabel}
              archiveShortcutKeys={archiveShortcutKeys}
              onArchive={onArchive}
              onCopyBranchName={onCopyBranchName}
              onCopyPath={onCopyPath}
              onRename={onRename}
            />
          </View>
          {prHint ? (
            <View style={styles.workspacePrBadgeRow}>
              <PrBadge hint={prHint} />
              <ChecksBadge checks={prHint.checks} />
            </View>
          ) : null}
        </Pressable>
      </View>
    </WorkspaceHoverCard>
  );
}

function WorkspaceRowWithMenu({
  workspace,
  selected,
  shortcutNumber,
  showShortcutBadge,
  onPress,
  drag,
  isDragging,
  dragHandleProps,
  canCopyBranchName,
  isCreating = false,
}: {
  workspace: SidebarWorkspaceEntry;
  selected: boolean;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  onPress: () => void;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  canCopyBranchName: boolean;
  isCreating?: boolean;
}) {
  const toast = useToast();
  const { t } = useTranslation();
  const archiveWorktree = useCheckoutGitActionsStore((state) => state.archiveWorktree);
  const queryClient = useQueryClient();
  const { hideWorkspace, isHidingWorkspace, redirectAfterArchive } =
    useSidebarWorkspaceHide(workspace);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const workspaceDirectory = resolveWorkspaceExecutionDirectory({
    workspaceDirectory: workspace.workspaceDirectory,
  });
  const archiveStatus = useCheckoutGitActionsStore((state) =>
    workspaceDirectory
      ? state.getStatus({
          serverId: workspace.serverId,
          cwd: workspaceDirectory,
          actionId: "archive-worktree",
        })
      : "idle",
  );
  const isWorktree = workspace.workspaceKind === "worktree";
  const isArchiving = isWorktree ? workspace.archivingAt !== null : isHidingWorkspace;
  const worktreeArchiveCopy = useMemo(
    () => ({
      addedLines: (count: number) => t("git.archiveAddedLines", { count }),
      deletedLines: (count: number) => t("git.archiveDeletedLines", { count }),
      uncommittedChanges: t("git.archiveUncommittedChanges"),
      uncommittedChangesWithStat: (diffStat: string) =>
        t("git.archiveUncommittedChangesWithStat", { diffStat }),
      unpushedCommits: (count: number) => t("git.archiveUnpushedCommits", { count }),
      archiveTitle: (worktreeName: string) => t("git.archiveTitle", { worktreeName }),
      archiveConfirm: t("git.archiveConfirm"),
      cancel: t("common.cancel"),
    }),
    [t],
  );

  const archiveWorktreeAfterConfirmation = useCallback(async () => {
    if (isArchiving) {
      return;
    }

    const confirmed = await confirmRiskyWorktreeArchive({
      worktreeName: workspace.name,
      isDirty: workspace.archiveHasUncommittedChanges,
      aheadOfOrigin: workspace.archiveUnpushedCommitCount,
      diffStat: workspace.diffStat,
      copy: worktreeArchiveCopy,
    });

    if (!confirmed) {
      return;
    }
    let archiveDirectory: string;
    try {
      archiveDirectory = requireWorkspaceExecutionDirectory({
        workspaceId: workspace.workspaceId,
        workspaceDirectory: workspace.workspaceDirectory,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("workspace.pathUnavailable"));
      return;
    }

    if (!archiveDirectory) {
      toast.error(t("workspace.pathUnavailable"));
      return;
    }

    redirectAfterArchive();

    void archiveWorktree({
      serverId: workspace.serverId,
      cwd: archiveDirectory,
      worktreePath: archiveDirectory,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : t("sidebar.archiveWorktreeFailed");
      toast.error(message);
    });
  }, [
    archiveWorktree,
    isArchiving,
    redirectAfterArchive,
    t,
    toast,
    workspace,
    worktreeArchiveCopy,
  ]);

  const handleArchiveWorktree = useCallback(() => {
    void archiveWorktreeAfterConfirmation();
  }, [archiveWorktreeAfterConfirmation]);

  const handleCopyPath = useCallback(() => {
    let copyTargetDirectory: string;
    try {
      copyTargetDirectory = requireWorkspaceExecutionDirectory({
        workspaceId: workspace.workspaceId,
        workspaceDirectory: workspace.workspaceDirectory,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sidebar.workspacePathUnavailable"));
      return;
    }
    void Clipboard.setStringAsync(copyTargetDirectory);
    toast.copied(t("sidebar.pathCopied"));
  }, [t, toast, workspace.workspaceDirectory, workspace.workspaceId]);

  const handleCopyBranchName = useCallback(() => {
    void Clipboard.setStringAsync(workspace.name);
    toast.copied(t("sidebar.branchNameCopied"));
  }, [t, toast, workspace.name]);

  const renameMutation = useMutation({
    mutationFn: async (branch: string) => {
      const client = getHostRuntimeStore().getClient(workspace.serverId);
      if (!client) {
        throw new Error(t("sidebar.hostDisconnected"));
      }
      const targetCwd = requireWorkspaceExecutionDirectory({
        workspaceId: workspace.workspaceId,
        workspaceDirectory: workspace.workspaceDirectory,
      });
      const payload = await client.renameBranch({ cwd: targetCwd, branch });
      if (!payload.success || payload.error) {
        throw new Error(payload.error?.message ?? t("sidebar.renameBranchFailed"));
      }
      return { targetCwd };
    },
    onSuccess: async ({ targetCwd }) => {
      await invalidateCheckoutGitQueriesForClient(queryClient, {
        serverId: workspace.serverId,
        cwd: targetCwd,
      });
    },
  });

  const handleOpenRename = useCallback(() => {
    setIsRenameOpen(true);
  }, []);

  const handleCloseRename = useCallback(() => {
    setIsRenameOpen(false);
  }, []);

  const handleSubmitRename = useCallback(
    async (value: string) => {
      await renameMutation.mutateAsync(slugify(value));
    },
    [renameMutation],
  );

  const validateRenameSlug = useCallback(
    (value: string): string | null => {
      const result = validateBranchSlug(slugify(value));
      if (result.valid) return null;
      return result.error ?? t("sidebar.invalidBranchName");
    },
    [t],
  );

  const archiveShortcutKeys = useShortcutKeys("archive-worktree");

  useKeyboardActionHandler({
    handlerId: `worktree-archive-${workspace.workspaceKey}`,
    actions: ["worktree.archive"],
    enabled: selected && !isArchiving,
    priority: 0,
    handle: () => {
      if (isWorktree) {
        void archiveWorktreeAfterConfirmation();
      } else {
        hideWorkspace();
      }
      return true;
    },
  });

  return (
    <>
      <WorkspaceRowInner
        workspace={workspace}
        selected={selected}
        shortcutNumber={shortcutNumber}
        showShortcutBadge={showShortcutBadge}
        onPress={onPress}
        drag={drag}
        isDragging={isDragging}
        isArchiving={isArchiving}
        isCreating={isCreating}
        dragHandleProps={dragHandleProps}
        menuController={null}
        archiveLabel={isWorktree ? t("git.archiveWorktree") : t("sidebar.hideWorkspace")}
        archiveStatus={getWorkspaceArchiveStatus(isWorktree, archiveStatus, isHidingWorkspace)}
        archivePendingLabel={isWorktree ? t("sidebar.archiving") : t("sidebar.hiding")}
        onArchive={isWorktree ? handleArchiveWorktree : hideWorkspace}
        onCopyBranchName={canCopyBranchName ? handleCopyBranchName : undefined}
        onCopyPath={handleCopyPath}
        onRename={canCopyBranchName ? handleOpenRename : undefined}
        archiveShortcutKeys={selected ? archiveShortcutKeys : null}
      />
      <AdaptiveRenameModal
        visible={isRenameOpen}
        title={t("sidebar.renameWorkspace")}
        initialValue={workspace.name}
        placeholder="branch-name"
        submitLabel={t("sidebar.renameWorkspace")}
        validate={validateRenameSlug}
        maxLength={MAX_SLUG_LENGTH}
        onClose={handleCloseRename}
        onSubmit={handleSubmitRename}
        testID={`sidebar-workspace-rename-modal-${workspace.workspaceKey}`}
      />
    </>
  );
}

function NonGitProjectRowWithMenuContent({
  project,
  displayName,
  iconDataUri,
  workspace,
  selected,
  onPress,
  shortcutNumber,
  showShortcutBadge,
  drag,
  isDragging,
  dragHandleProps,
}: {
  project: SidebarProjectEntry;
  displayName: string;
  iconDataUri: string | null;
  workspace: SidebarWorkspaceEntry;
  selected: boolean;
  onPress: () => void;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}) {
  const { t } = useTranslation();
  const contextMenu = useContextMenu();
  const { hideWorkspace, isHidingWorkspace } = useSidebarWorkspaceHide(workspace);
  return (
    <>
      <ProjectHeaderRow
        project={project}
        displayName={displayName}
        iconDataUri={iconDataUri}
        workspace={workspace}
        selected={selected}
        chevron={null}
        onPress={onPress}
        serverId={null}
        canCreateWorktree={false}
        shortcutNumber={shortcutNumber}
        showShortcutBadge={showShortcutBadge}
        drag={drag}
        isDragging={isDragging}
        isArchiving={isHidingWorkspace}
        menuController={contextMenu}
        dragHandleProps={dragHandleProps}
      />
      <ContextMenuContent
        align="start"
        width={220}
        mobileMode="sheet"
        testID={`sidebar-workspace-context-${workspace.workspaceKey}`}
      >
        <ContextMenuItem
          testID={`sidebar-workspace-context-${workspace.workspaceKey}-archive`}
          status={isHidingWorkspace ? "pending" : "idle"}
          pendingLabel={t("sidebar.hiding")}
          destructive
          onSelect={hideWorkspace}
        >
          {t("sidebar.hideWorkspace")}
        </ContextMenuItem>
      </ContextMenuContent>
    </>
  );
}

function NonGitProjectRowWithMenu(props: {
  project: SidebarProjectEntry;
  displayName: string;
  iconDataUri: string | null;
  workspace: SidebarWorkspaceEntry;
  selected: boolean;
  onPress: () => void;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}) {
  return (
    <ContextMenu>
      <NonGitProjectRowWithMenuContent {...props} />
    </ContextMenu>
  );
}

function FlattenedProjectRow({
  project,
  displayName,
  iconDataUri,
  rowModel,
  onPress,
  serverId,
  onWorkspacePress,
  onWorktreeCreated,
  shortcutNumber,
  showShortcutBadge,
  drag,
  isDragging,
  dragHandleProps,
  isProjectActive = false,
  onRemoveProject,
  removeProjectStatus,
  selectionEnabled,
}: {
  project: SidebarProjectEntry;
  displayName: string;
  iconDataUri: string | null;
  rowModel: Extract<ReturnType<typeof buildSidebarProjectRowModel>, { kind: "workspace_link" }>;
  onPress: () => void;
  serverId: string | null;
  onWorkspacePress?: () => void;
  onWorktreeCreated?: (workspaceId: string) => void;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  isProjectActive?: boolean;
  onRemoveProject?: () => void;
  removeProjectStatus?: "idle" | "pending";
  selectionEnabled: boolean;
}) {
  const workspace = useSidebarWorkspaceEntry(serverId, rowModel.workspace.workspaceId);
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const selected =
    selectionEnabled &&
    activeWorkspaceSelection?.serverId === serverId &&
    activeWorkspaceSelection.workspaceId === rowModel.workspace.workspaceId;

  if (!workspace) {
    return null;
  }

  if (project.projectKind === "directory") {
    return (
      <NonGitProjectRowWithMenu
        project={project}
        displayName={displayName}
        iconDataUri={iconDataUri}
        workspace={workspace}
        selected={selected}
        onPress={onPress}
        shortcutNumber={shortcutNumber}
        showShortcutBadge={showShortcutBadge}
        drag={drag}
        isDragging={isDragging}
        dragHandleProps={dragHandleProps}
      />
    );
  }

  return (
    <ProjectHeaderRow
      project={project}
      displayName={displayName}
      iconDataUri={iconDataUri}
      workspace={workspace}
      selected={selected}
      chevron={rowModel.chevron}
      onPress={onPress}
      serverId={serverId}
      canCreateWorktree={rowModel.trailingAction === "new_worktree"}
      isProjectActive={isProjectActive}
      onWorkspacePress={onWorkspacePress}
      onWorktreeCreated={onWorktreeCreated}
      shortcutNumber={shortcutNumber}
      showShortcutBadge={showShortcutBadge}
      drag={drag}
      isDragging={isDragging}
      menuController={null}
      onRemoveProject={onRemoveProject}
      removeProjectStatus={removeProjectStatus}
      dragHandleProps={dragHandleProps}
    />
  );
}

interface WorkspaceRowItemProps {
  workspace: SidebarWorkspaceEntry;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  canCopyBranchName: boolean;
  isCreating?: boolean;
  selectionEnabled: boolean;
  serverId: string | null;
  currentPathname: string | null;
  onWorkspacePress?: () => void;
  drag?: () => void;
  isDragging?: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}

function WorkspaceRowItem({
  workspace,
  shortcutNumber,
  showShortcutBadge,
  canCopyBranchName,
  isCreating = false,
  selectionEnabled,
  serverId,
  currentPathname,
  onWorkspacePress,
  drag,
  isDragging = false,
  dragHandleProps,
}: WorkspaceRowItemProps) {
  const handlePress = useCallback(() => {
    if (!serverId) {
      return;
    }
    onWorkspacePress?.();
    navigateToWorkspace(serverId, workspace.workspaceId, { currentPathname });
  }, [serverId, onWorkspacePress, workspace.workspaceId, currentPathname]);

  return (
    <WorkspaceRow
      workspace={workspace}
      shortcutNumber={shortcutNumber}
      showShortcutBadge={showShortcutBadge}
      canCopyBranchName={canCopyBranchName}
      isCreating={isCreating}
      selectionEnabled={selectionEnabled}
      onPress={handlePress}
      drag={drag ?? noop}
      isDragging={isDragging}
      dragHandleProps={dragHandleProps}
    />
  );
}

function WorkspaceRow({
  workspace,
  shortcutNumber,
  showShortcutBadge,
  onPress,
  drag,
  isDragging,
  dragHandleProps,
  canCopyBranchName,
  isCreating = false,
  selectionEnabled,
}: {
  workspace: SidebarWorkspaceEntry;
  shortcutNumber: number | null;
  showShortcutBadge: boolean;
  onPress: () => void;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  canCopyBranchName: boolean;
  isCreating?: boolean;
  selectionEnabled: boolean;
}) {
  const hydratedWorkspace = useSidebarWorkspaceEntry(workspace.serverId, workspace.workspaceId);
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const selected =
    selectionEnabled &&
    activeWorkspaceSelection?.serverId === workspace.serverId &&
    activeWorkspaceSelection.workspaceId === workspace.workspaceId;

  if (!hydratedWorkspace) {
    return null;
  }

  return (
    <WorkspaceRowWithMenu
      workspace={hydratedWorkspace}
      selected={selected}
      shortcutNumber={shortcutNumber}
      showShortcutBadge={showShortcutBadge}
      onPress={onPress}
      drag={drag}
      isDragging={isDragging}
      dragHandleProps={dragHandleProps}
      canCopyBranchName={canCopyBranchName}
      isCreating={isCreating}
    />
  );
}

function ProjectBlock({
  project,
  collapsed,
  displayName,
  iconDataUri,
  serverId,
  selectionEnabled,
  showShortcutBadges,
  shortcutIndexByWorkspaceKey,
  parentGestureRef,
  onToggleCollapsed,
  onWorkspacePress,
  onWorkspaceReorder,
  onWorktreeCreated,
  currentPathname,
  drag,
  isDragging,
  dragHandleProps,
  useNestable,
  creatingWorkspaceIds,
}: {
  project: SidebarProjectEntry;
  collapsed: boolean;
  displayName: string;
  iconDataUri: string | null;
  serverId: string | null;
  selectionEnabled: boolean;
  showShortcutBadges: boolean;
  shortcutIndexByWorkspaceKey: Map<string, number>;
  parentGestureRef?: MutableRefObject<GestureType | undefined>;
  onToggleCollapsed: (projectKey: string) => void;
  onWorkspacePress?: () => void;
  onWorkspaceReorder: (projectKey: string, workspaces: SidebarWorkspaceEntry[]) => void;
  onWorktreeCreated?: (workspaceId: string) => void;
  currentPathname: string | null;
  drag: () => void;
  isDragging: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  useNestable: boolean;
  creatingWorkspaceIds: ReadonlySet<string>;
}) {
  const rowModel = useMemo(
    () =>
      buildSidebarProjectRowModel({
        project,
        collapsed,
      }),
    [collapsed, project],
  );

  const projectWorkspaceIds = useMemo(
    () => project.workspaces.map((workspace) => workspace.workspaceId),
    [project.workspaces],
  );
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const isProjectActive =
    selectionEnabled &&
    activeWorkspaceSelection?.serverId === serverId &&
    projectWorkspaceIds.includes(activeWorkspaceSelection.workspaceId);

  const renderWorkspaceRow = useCallback(
    (
      item: SidebarWorkspaceEntry,
      input?: {
        drag?: () => void;
        isDragging?: boolean;
        dragHandleProps?: DraggableListDragHandleProps;
      },
    ) => {
      return (
        <WorkspaceRowItem
          workspace={item}
          shortcutNumber={shortcutIndexByWorkspaceKey.get(item.workspaceKey) ?? null}
          showShortcutBadge={showShortcutBadges}
          canCopyBranchName={project.projectKind === "git"}
          isCreating={creatingWorkspaceIds.has(item.workspaceId)}
          selectionEnabled={selectionEnabled}
          serverId={serverId}
          currentPathname={currentPathname}
          onWorkspacePress={onWorkspacePress}
          drag={input?.drag}
          isDragging={input?.isDragging}
          dragHandleProps={input?.dragHandleProps}
        />
      );
    },
    [
      project.projectKind,
      creatingWorkspaceIds,
      currentPathname,
      onWorkspacePress,
      serverId,
      selectionEnabled,
      shortcutIndexByWorkspaceKey,
      showShortcutBadges,
    ],
  );

  const renderWorkspace = useCallback(
    ({
      item,
      drag: workspaceDrag,
      isActive,
      dragHandleProps: workspaceDragHandleProps,
    }: DraggableRenderItemInfo<SidebarWorkspaceEntry>) => {
      return renderWorkspaceRow(item, {
        drag: workspaceDrag,
        isDragging: isActive,
        dragHandleProps: workspaceDragHandleProps,
      });
    },
    [renderWorkspaceRow],
  );

  const handleWorkspaceDragEnd = useCallback(
    (workspaces: SidebarWorkspaceEntry[]) => {
      onWorkspaceReorder(project.projectKey, workspaces);
    },
    [onWorkspaceReorder, project.projectKey],
  );

  const toast = useToast();
  const { t } = useTranslation();
  const [isRemovingProject, setIsRemovingProject] = useState(false);

  const handleRemoveProject = useCallback(() => {
    if (isRemovingProject || !serverId) {
      return;
    }

    void (async () => {
      const confirmed = await confirmDialog({
        title: t("sidebar.removeProjectTitle"),
        message: t("sidebar.removeProjectMessage", { name: displayName }),
        confirmLabel: t("sidebar.removeProject"),
        cancelLabel: t("common.cancel"),
        destructive: true,
      });
      if (!confirmed) {
        return;
      }

      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) {
        toast.error(t("sidebar.hostDisconnected"));
        return;
      }

      setIsRemovingProject(true);
      void archiveWorkspacesOptimistically({
        client,
        workspaces: project.workspaces,
      }).then((failures) => {
        if (failures.length > 0) {
          toast.error(t("sidebar.removeSomeWorkspacesFailed"));
        }
        setIsRemovingProject(false);
        return;
      });
    })();
  }, [displayName, isRemovingProject, project.workspaces, serverId, t, toast]);

  const flattenedRowWorkspaceId =
    rowModel.kind === "workspace_link" ? rowModel.workspace.workspaceId : null;
  const handleFlattenedRowPress = useCallback(() => {
    if (!serverId || !flattenedRowWorkspaceId) {
      return;
    }
    onWorkspacePress?.();
    navigateToWorkspace(serverId, flattenedRowWorkspaceId, {
      currentPathname,
    });
  }, [serverId, flattenedRowWorkspaceId, onWorkspacePress, currentPathname]);

  const handleToggleCollapsed = useCallback(() => {
    onToggleCollapsed(project.projectKey);
  }, [onToggleCollapsed, project.projectKey]);

  return (
    <View style={styles.projectBlock}>
      {rowModel.kind === "workspace_link" ? (
        <FlattenedProjectRow
          project={project}
          displayName={displayName}
          iconDataUri={iconDataUri}
          rowModel={rowModel}
          onPress={handleFlattenedRowPress}
          serverId={serverId}
          onWorkspacePress={onWorkspacePress}
          onWorktreeCreated={onWorktreeCreated}
          shortcutNumber={shortcutIndexByWorkspaceKey.get(rowModel.workspace.workspaceKey) ?? null}
          showShortcutBadge={showShortcutBadges}
          drag={drag}
          isDragging={isDragging}
          dragHandleProps={dragHandleProps}
          isProjectActive={isProjectActive}
          onRemoveProject={handleRemoveProject}
          removeProjectStatus={isRemovingProject ? "pending" : "idle"}
          selectionEnabled={selectionEnabled}
        />
      ) : (
        <>
          <ProjectHeaderRow
            project={project}
            displayName={displayName}
            iconDataUri={iconDataUri}
            workspace={null}
            selected={false}
            chevron={rowModel.chevron}
            onPress={handleToggleCollapsed}
            serverId={serverId}
            canCreateWorktree={rowModel.trailingAction === "new_worktree"}
            isProjectActive={isProjectActive}
            onWorkspacePress={onWorkspacePress}
            onWorktreeCreated={onWorktreeCreated}
            drag={drag}
            isDragging={isDragging}
            isArchiving={isRemovingProject}
            menuController={null}
            onRemoveProject={handleRemoveProject}
            removeProjectStatus={isRemovingProject ? "pending" : "idle"}
            dragHandleProps={dragHandleProps}
          />

          {!collapsed ? (
            <DraggableList
              testID={`sidebar-workspace-list-${project.projectKey}`}
              data={project.workspaces}
              keyExtractor={workspaceKeyExtractor}
              renderItem={renderWorkspace}
              onDragEnd={handleWorkspaceDragEnd}
              scrollEnabled={false}
              useDragHandle
              nestable={useNestable}
              simultaneousGestureRef={parentGestureRef}
              containerStyle={styles.workspaceListContainer}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

export function SidebarWorkspaceList({
  projects,
  serverId,
  collapsedProjectKeys,
  onToggleProjectCollapsed,
  shortcutIndexByWorkspaceKey,
  isRefreshing: _isRefreshing = false,
  onRefresh: _onRefresh,
  onWorkspacePress,
  onAddProject,
  listFooterComponent,
  parentGestureRef,
}: SidebarWorkspaceListProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const [creatingWorkspaceIds, setCreatingWorkspaceIds] = useState<Set<string>>(() => new Set());
  const creatingWorkspaceTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const showShortcutBadges = useShowShortcutBadges();

  const getProjectOrder = useSidebarOrderStore((state) => state.getProjectOrder);
  const setProjectOrder = useSidebarOrderStore((state) => state.setProjectOrder);
  const getWorkspaceOrder = useSidebarOrderStore((state) => state.getWorkspaceOrder);
  const setWorkspaceOrder = useSidebarOrderStore((state) => state.setWorkspaceOrder);

  const isWorkspaceRoute = useMemo(
    () => Boolean(pathname && parseHostWorkspaceRouteFromPathname(pathname)),
    [pathname],
  );
  const selectionEnabled = isWorkspaceRoute;

  const projectIconRequests = useMemo(() => {
    if (!serverId) {
      return [];
    }
    const unique = new Map<string, { serverId: string; cwd: string }>();
    for (const project of projects) {
      const cwd = project.iconWorkingDir.trim();
      if (!cwd) {
        continue;
      }
      unique.set(`${serverId}:${cwd}`, { serverId, cwd });
    }
    return Array.from(unique.values());
  }, [projects, serverId]);

  const projectIconQueries = useQueries({
    queries: projectIconRequests.map((request) => ({
      queryKey: projectIconQueryKey(request.serverId, request.cwd),
      queryFn: async () => {
        const client = getHostRuntimeStore().getClient(request.serverId);
        if (!client) {
          return null;
        }
        const result = await client.requestProjectIcon(request.cwd);
        return result.icon;
      },
      select: projectIconToDataUri,
      enabled: Boolean(
        getHostRuntimeStore().getClient(request.serverId) &&
        isHostRuntimeConnected(getHostRuntimeStore().getSnapshot(request.serverId)) &&
        request.cwd,
      ),
      staleTime: Infinity,
      gcTime: 1000 * 60 * 60,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    })),
  });

  const projectIconByProjectKey = useMemo(() => {
    const iconByServerAndCwd = new Map<string, string | null>();
    for (let index = 0; index < projectIconRequests.length; index += 1) {
      const request = projectIconRequests[index];
      if (!request) {
        continue;
      }
      iconByServerAndCwd.set(
        `${request.serverId}:${request.cwd}`,
        projectIconQueries[index]?.data ?? null,
      );
    }

    const byProject = new Map<string, string | null>();
    for (const project of projects) {
      const cwd = project.iconWorkingDir.trim();
      if (!cwd || !serverId) {
        byProject.set(project.projectKey, null);
        continue;
      }
      byProject.set(project.projectKey, iconByServerAndCwd.get(`${serverId}:${cwd}`) ?? null);
    }

    return byProject;
  }, [projectIconQueries, projectIconRequests, projects, serverId]);

  useEffect(() => {
    const timeouts = creatingWorkspaceTimeoutsRef.current;
    return () => {
      for (const timeout of timeouts.values()) {
        clearTimeout(timeout);
      }
      timeouts.clear();
    };
  }, []);

  useEffect(() => {
    if (creatingWorkspaceIds.size === 0) {
      return;
    }

    const visibleWorkspaceIds = new Set<string>();
    for (const project of projects) {
      for (const workspace of project.workspaces) {
        visibleWorkspaceIds.add(workspace.workspaceId);
      }
    }

    const removedWorkspaceIds = Array.from(creatingWorkspaceIds).filter(
      (workspaceId) => !visibleWorkspaceIds.has(workspaceId),
    );
    if (removedWorkspaceIds.length === 0) {
      return;
    }

    for (const workspaceId of removedWorkspaceIds) {
      const timeout = creatingWorkspaceTimeoutsRef.current.get(workspaceId);
      if (timeout) {
        clearTimeout(timeout);
        creatingWorkspaceTimeoutsRef.current.delete(workspaceId);
      }
    }

    setCreatingWorkspaceIds((current) => {
      const next = new Set(current);
      for (const workspaceId of removedWorkspaceIds) {
        next.delete(workspaceId);
      }
      return next;
    });
  }, [creatingWorkspaceIds, projects]);

  const handleProjectDragEnd = useCallback(
    (reorderedProjects: SidebarProjectEntry[]) => {
      if (!serverId) {
        return;
      }

      const reorderedProjectKeys = reorderedProjects.map((project) => project.projectKey);
      const currentProjectOrder = getProjectOrder(serverId);
      if (
        !hasVisibleOrderChanged({
          currentOrder: currentProjectOrder,
          reorderedVisibleKeys: reorderedProjectKeys,
        })
      ) {
        return;
      }

      setProjectOrder(
        serverId,
        mergeWithRemainder({
          currentOrder: currentProjectOrder,
          reorderedVisibleKeys: reorderedProjectKeys,
        }),
      );
    },
    [getProjectOrder, serverId, setProjectOrder],
  );

  const handleWorkspaceReorder = useCallback(
    (projectKey: string, reorderedWorkspaces: SidebarWorkspaceEntry[]) => {
      if (!serverId) {
        return;
      }

      const reorderedWorkspaceKeys = reorderedWorkspaces.map((workspace) => workspace.workspaceKey);
      const currentWorkspaceOrder = getWorkspaceOrder(serverId, projectKey);
      if (
        !hasVisibleOrderChanged({
          currentOrder: currentWorkspaceOrder,
          reorderedVisibleKeys: reorderedWorkspaceKeys,
        })
      ) {
        return;
      }

      setWorkspaceOrder(
        serverId,
        projectKey,
        mergeWithRemainder({
          currentOrder: currentWorkspaceOrder,
          reorderedVisibleKeys: reorderedWorkspaceKeys,
        }),
      );
    },
    [getWorkspaceOrder, serverId, setWorkspaceOrder],
  );

  const handleWorktreeCreated = useCallback((workspaceId: string) => {
    setCreatingWorkspaceIds((current) => {
      const next = new Set(current);
      next.add(workspaceId);
      return next;
    });
    const existingTimeout = creatingWorkspaceTimeoutsRef.current.get(workspaceId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    creatingWorkspaceTimeoutsRef.current.set(
      workspaceId,
      setTimeout(() => {
        creatingWorkspaceTimeoutsRef.current.delete(workspaceId);
        setCreatingWorkspaceIds((current) => {
          if (!current.has(workspaceId)) {
            return current;
          }
          const next = new Set(current);
          next.delete(workspaceId);
          return next;
        });
      }, 3000),
    );
  }, []);

  const renderProject = useCallback(
    ({ item, drag, isActive, dragHandleProps }: DraggableRenderItemInfo<SidebarProjectEntry>) => {
      return (
        <ProjectBlock
          project={item}
          collapsed={collapsedProjectKeys.has(item.projectKey)}
          displayName={item.projectName}
          iconDataUri={projectIconByProjectKey.get(item.projectKey) ?? null}
          serverId={serverId}
          selectionEnabled={selectionEnabled}
          showShortcutBadges={showShortcutBadges}
          shortcutIndexByWorkspaceKey={shortcutIndexByWorkspaceKey}
          parentGestureRef={parentGestureRef}
          onToggleCollapsed={onToggleProjectCollapsed}
          onWorkspacePress={onWorkspacePress}
          onWorkspaceReorder={handleWorkspaceReorder}
          onWorktreeCreated={handleWorktreeCreated}
          currentPathname={pathname}
          drag={drag}
          isDragging={isActive}
          dragHandleProps={dragHandleProps}
          useNestable={platformIsNative}
          creatingWorkspaceIds={creatingWorkspaceIds}
        />
      );
    },
    [
      collapsedProjectKeys,
      handleWorktreeCreated,
      handleWorkspaceReorder,
      onWorkspacePress,
      onToggleProjectCollapsed,
      parentGestureRef,
      pathname,
      projectIconByProjectKey,
      selectionEnabled,
      serverId,
      shortcutIndexByWorkspaceKey,
      showShortcutBadges,
      creatingWorkspaceIds,
    ],
  );

  const content = (
    <>
      {projects.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>{t("sidebar.noProjects")}</Text>
          <Text style={styles.emptyText}>{t("sidebar.addProjectHint")}</Text>
          <Button variant="ghost" size="sm" leftIcon={Plus} onPress={onAddProject}>
            {t("sidebar.addProject")}
          </Button>
        </View>
      ) : (
        <DraggableList
          testID="sidebar-project-list"
          data={projects}
          keyExtractor={projectKeyExtractor}
          renderItem={renderProject}
          onDragEnd={handleProjectDragEnd}
          scrollEnabled={false}
          useDragHandle
          nestable={platformIsNative}
          simultaneousGestureRef={parentGestureRef}
          containerStyle={styles.projectListContainer}
        />
      )}
      {listFooterComponent}
    </>
  );

  return (
    <View style={styles.container}>
      {platformIsNative ? (
        <NestableScrollContainer
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          testID="sidebar-project-workspace-list-scroll"
        >
          {content}
        </NestableScrollContainer>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          testID="sidebar-project-workspace-list-scroll"
        >
          {content}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  // Soft nav list inset.
  listContent: {
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: 12,
  },
  projectListContainer: {
    width: "100%",
  },
  projectBlock: {
    marginBottom: theme.spacing[1],
  },
  workspaceListContainer: {},
  // Soft empty project card: r14 quiet surface.
  emptyContainer: {
    marginHorizontal: theme.spacing[2],
    marginTop: theme.spacing[4],
    paddingTop: theme.spacing[6],
    paddingBottom: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderRadius: 14,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    gap: theme.spacing[3],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    textAlign: "center",
  },
  // Soft .space-h: quiet project header.
  projectRow: {
    minHeight: 32,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  projectRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  projectRowPressed: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  projectRowDragging: {
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    transform: [{ scale: 1.02 }],
    zIndex: 3,
    ...theme.shadow.sm,
  },
  projectRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
  },
  projectTitleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flex: 1,
    minWidth: 0,
  },
  // Soft .proj: 12.5 text-2 project label.
  projectTitle: {
    color: theme.colors.foreground,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: "400",
    minWidth: 0,
    flexShrink: 1,
  },
  projectActionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    borderRadius: 10,
    flexShrink: 0,
  },
  projectActionButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  projectActionButtonText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  projectIconActionButton: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  projectIconActionButtonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  projectIconActionButtonHidden: {
    opacity: 0,
  },
  projectTrailingActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
  },
  projectKebabButtonHidden: {
    opacity: 0,
  },
  projectTrailingControlSlot: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  projectActionTooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  projectActionTooltipText: {
    color: theme.colors.foreground,
    fontSize: 12.5,
    lineHeight: 16,
  },
  projectActionTooltipShortcut: {},
  // Soft nested workspace / session-like row.
  workspaceRow: {
    minHeight: 34,
    marginBottom: 2,
    paddingVertical: 7,
    paddingLeft: 18,
    paddingRight: 10,
    borderRadius: 10,
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "center",
    gap: theme.spacing[1],
    userSelect: "none",
  },
  workspaceRowMain: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    width: "100%",
  },
  workspaceRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    minWidth: 0,
  },
  workspaceRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  workspaceRowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  workspaceRowPressed: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  workspaceRowDragging: {
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    transform: [{ scale: 1.02 }],
    zIndex: 3,
    ...theme.shadow.sm,
  },
  // Soft selected: elevated chip, not hard hover wash.
  sidebarRowSelected: {
    backgroundColor: theme.colors.surface0,
    ...(platformIsWeb
      ? ({
          boxShadow: "0 1px 2px rgba(20, 23, 31, 0.04)",
        } as object)
      : {}),
  },
  workspaceRowContainer: {
    position: "relative",
  },
  workspaceArchivingOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
    backgroundColor: `${theme.colors.surface0}cc`,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: theme.spacing[2],
    zIndex: 1,
  },
  workspaceArchivingText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: "500",
  },
  // Soft workspace branch meta: 12.5 muted-adjacent.
  workspaceBranchText: {
    color: theme.colors.foreground,
    fontSize: 12.5,
    fontWeight: "400",
    lineHeight: 16,
    opacity: 0.76,
    flex: 1,
    minWidth: 0,
  },
  workspaceBranchTextCreating: {
    opacity: 0.92,
  },
  workspaceBranchTextHovered: {
    opacity: 1,
  },
  workspacePrBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: WORKSPACE_STATUS_DOT_WIDTH + theme.spacing[2],
  },
  workspaceCreatingText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
    flexShrink: 0,
  },
  shortcutBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    flexShrink: 0,
  },
  shortcutBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 16,
  },
}));
