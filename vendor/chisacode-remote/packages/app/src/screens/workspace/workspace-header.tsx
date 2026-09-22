import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import {
  Copy,
  Ellipsis,
  EllipsisVertical,
  Folder,
  Globe,
  Layers,
  PanelRight,
  Settings,
  SquarePen,
  SquareTerminal,
} from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import { BranchSwitcher } from "@/components/branch-switcher";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import { SourceControlPanelIcon } from "@/components/icons/source-control-panel-icon";
import { ThemedIconHost } from "@/components/themed-icon-host";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TitlebarDragRegion,
  TITLEBAR_NO_DRAG_VIEW_STYLE,
} from "@/components/desktop/titlebar-drag-region";
import { useDesktopSidebarControlContentPad } from "@/components/desktop/desktop-sidebar-control";
import { WorkspaceGitActions } from "@/git/workspace-actions";
import { WorkspaceOpenInEditorButton } from "@/screens/workspace/workspace-open-in-editor-button";
import { WorkspaceScriptsButton } from "@/screens/workspace/workspace-scripts-button";
import { WorkspaceTabPresentationResolver } from "@/screens/workspace/workspace-tab-presentation";
import type { WorkspaceTabTarget } from "@/workspace-tabs/identity";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { isAbsolutePath } from "@/utils/path";
import { DESKTOP_WINDOW_CONTROLS_WIDTH } from "@/constants/layout";
import { getIsElectron, isWeb } from "@/constants/platform";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const sourceControlPanelStrokeWidth15 = { strokeWidth: 1.5 };

const MENU_NEW_AGENT_ICON = (
  <ThemedIconHost Icon={SquarePen} size={16} uniProps={mutedColorMapping} />
);
const MENU_NEW_TERMINAL_ICON = (
  <ThemedIconHost Icon={SquareTerminal} size={16} uniProps={mutedColorMapping} />
);
const MENU_NEW_BROWSER_ICON = (
  <ThemedIconHost Icon={Globe} size={16} uniProps={mutedColorMapping} />
);
const MENU_COPY_ICON = <ThemedIconHost Icon={Copy} size={16} uniProps={mutedColorMapping} />;
const MENU_SETTINGS_ICON = (
  <ThemedIconHost Icon={Settings} size={16} uniProps={mutedColorMapping} />
);
const MENU_GIT_DOCK_ICON = (
  <ThemedIconHost Icon={SourceControlPanelIcon} size={16} uniProps={mutedColorMapping} />
);
const MENU_BROWSER_CONTEXT_ICON = (
  <ThemedIconHost Icon={Globe} size={16} uniProps={mutedColorMapping} />
);

const EXPLORER_TOGGLE_KEYS: ShortcutKey[] = ["mod", "E"];
const TERMINAL_TOGGLE_KEYS: ShortcutKey[] = ["mod", "`"];
// Environment panel has no keyboard shortcut yet; keep a stable empty array so
// HeaderToggleButton still receives the required prop without inline [].
const ENVIRONMENT_TOGGLE_KEYS: ShortcutKey[] = [];

interface WorkspaceHeaderMenuProps {
  normalizedWorkspaceId: string;
  currentBranchName: string | null;
  showWorkspaceSetup: boolean;
  showCreateBrowserTab: boolean;
  isMobile: boolean;
  createTerminalDisabled: boolean;
  browserContextDockDisabled: boolean;
  onCreateDraftTab: () => void;
  onCreateTerminal: () => void;
  onCreateBrowser: () => void;
  onOpenGitDock: () => void;
  onOpenBrowserContextDock: () => void;
  onCopyWorkspacePath: () => void;
  onCopyBranchName: () => void;
  onOpenSetupTab: () => void;
}

function WorkspaceHeaderMenuTriggerIcon({
  hovered,
  open,
  isMobile,
}: {
  hovered: boolean;
  open: boolean;
  isMobile: boolean;
}) {
  const Icon = isMobile ? EllipsisVertical : Ellipsis;
  const colorMapping = hovered || open ? foregroundColorMapping : mutedColorMapping;
  return <ThemedIconHost Icon={Icon} size={16} uniProps={colorMapping} />;
}

function WorkspaceHeaderMenu({
  normalizedWorkspaceId,
  currentBranchName,
  showWorkspaceSetup,
  showCreateBrowserTab,
  isMobile,
  createTerminalDisabled,
  browserContextDockDisabled,
  onCreateDraftTab,
  onCreateTerminal,
  onCreateBrowser,
  onOpenGitDock,
  onOpenBrowserContextDock,
  onCopyWorkspacePath,
  onCopyBranchName,
  onOpenSetupTab,
}: WorkspaceHeaderMenuProps) {
  const { t } = useTranslation();
  const renderTriggerIcon = useCallback(
    ({ hovered, open }: { hovered: boolean; open: boolean }) => (
      <WorkspaceHeaderMenuTriggerIcon hovered={hovered} open={open} isMobile={isMobile} />
    ),
    [isMobile],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        testID="workspace-header-menu-trigger"
        style={isMobile ? styles.compactHeaderActionButton : styles.headerActionButton}
        accessibilityRole="button"
        accessibilityLabel={t("workspace.actions")}
      >
        {renderTriggerIcon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width={220} testID="workspace-header-menu">
        <DropdownMenuItem
          testID="workspace-header-new-agent"
          leading={MENU_NEW_AGENT_ICON}
          onSelect={onCreateDraftTab}
        >
          {t("workspace.newAgent")}
        </DropdownMenuItem>
        <DropdownMenuItem
          testID="workspace-header-new-terminal"
          leading={MENU_NEW_TERMINAL_ICON}
          disabled={createTerminalDisabled}
          description={
            createTerminalDisabled ? t("workspace.routeState.creatingTerminal") : undefined
          }
          tooltip={createTerminalDisabled ? t("workspace.routeState.creatingTerminal") : undefined}
          onSelect={onCreateTerminal}
        >
          {t("workspace.newTerminal")}
        </DropdownMenuItem>
        {showCreateBrowserTab ? (
          <DropdownMenuItem
            testID="workspace-header-new-browser"
            leading={MENU_NEW_BROWSER_ICON}
            onSelect={onCreateBrowser}
          >
            {t("workspace.newBrowserTab")}
          </DropdownMenuItem>
        ) : null}
        {!isMobile ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              testID="workspace-header-open-git-dock"
              leading={MENU_GIT_DOCK_ICON}
              onSelect={onOpenGitDock}
            >
              {t("workspace.openGitDock")}
            </DropdownMenuItem>
            <DropdownMenuItem
              testID="workspace-header-open-browser-context-dock"
              leading={MENU_BROWSER_CONTEXT_ICON}
              disabled={browserContextDockDisabled}
              description={
                browserContextDockDisabled ? t("workspace.noBrowserContextDock") : undefined
              }
              tooltip={browserContextDockDisabled ? t("workspace.noBrowserContextDock") : undefined}
              onSelect={onOpenBrowserContextDock}
            >
              {t("workspace.openBrowserContextDock")}
            </DropdownMenuItem>
          </>
        ) : null}
        {/* Import session lives on Soft Home draft only — hide on active conversation chrome. */}
        <DropdownMenuItem
          testID="workspace-header-copy-path"
          leading={MENU_COPY_ICON}
          disabled={!isAbsolutePath(normalizedWorkspaceId)}
          description={
            !isAbsolutePath(normalizedWorkspaceId)
              ? t("workspace.screen.workspacePathUnavailable")
              : undefined
          }
          tooltip={
            !isAbsolutePath(normalizedWorkspaceId)
              ? t("workspace.screen.workspacePathUnavailable")
              : undefined
          }
          onSelect={onCopyWorkspacePath}
        >
          {t("workspace.screen.copyWorkspacePath")}
        </DropdownMenuItem>
        {currentBranchName ? (
          <DropdownMenuItem
            testID="workspace-header-copy-branch-name"
            leading={MENU_COPY_ICON}
            onSelect={onCopyBranchName}
          >
            {t("workspace.screen.copyBranchName")}
          </DropdownMenuItem>
        ) : null}
        {showWorkspaceSetup ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              testID="workspace-header-show-setup"
              leading={MENU_SETTINGS_ICON}
              onSelect={onOpenSetupTab}
            >
              {t("workspace.screen.showSetup")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface WorkspaceHeaderTitleBarProps {
  isLoading: boolean;
  title: string;
  subtitle: string;
  showSubtitle: boolean;
  activeTarget: WorkspaceTabTarget | null;
  currentBranchName: string | null;
  isGitCheckout: boolean;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  workspaceScripts: WorkspaceDescriptor["scripts"];
  liveTerminalIds: string[];
  showWorkspaceSetup: boolean;
  showCreateBrowserTab: boolean;
  isMobile: boolean;
  createTerminalDisabled: boolean;
  browserContextDockDisabled: boolean;
  onCreateDraftTab: () => void;
  onCreateTerminal: () => void;
  onCreateBrowser: () => void;
  onOpenGitDock: () => void;
  onOpenBrowserContextDock: () => void;
  onCopyWorkspacePath: () => void;
  onCopyBranchName: () => void;
  onOpenSetupTab: () => void;
  onScriptTerminalStarted: (terminalId: string) => void;
  onViewScriptTerminal: (terminalId: string) => void;
  onOpenUrlInBrowserTab: (url: string) => void;
}

/**
 * Renders the workspace title, action menu, and optional mobile script control.
 * @param props Workspace title state and command callbacks
 * @returns The responsive workspace header title bar
 */
export function WorkspaceHeaderTitleBar({
  isLoading,
  title,
  subtitle,
  showSubtitle,
  activeTarget,
  currentBranchName,
  isGitCheckout,
  normalizedServerId,
  normalizedWorkspaceId,
  workspaceScripts,
  liveTerminalIds,
  showWorkspaceSetup,
  showCreateBrowserTab,
  isMobile,
  createTerminalDisabled,
  browserContextDockDisabled,
  onCreateDraftTab,
  onCreateTerminal,
  onCreateBrowser,
  onOpenGitDock,
  onOpenBrowserContextDock,
  onCopyWorkspacePath,
  onCopyBranchName,
  onOpenSetupTab,
  onScriptTerminalStarted,
  onViewScriptTerminal,
  onOpenUrlInBrowserTab,
}: WorkspaceHeaderTitleBarProps) {
  return (
    <View style={styles.headerTitleContainer}>
      {isLoading ? (
        <View style={styles.headerTitleTextGroup}>
          <View style={styles.headerTitleSkeleton} />
        </View>
      ) : (
        <View style={styles.headerTitleTextGroup}>
          {isMobile ? (
            <>
              {/* Soft .m-header: title + optional branch pill on one row; subtitle below. */}
              <View style={styles.compactHeaderTitleRow}>
                <Text testID="workspace-header-title" style={styles.headerTitle} numberOfLines={1}>
                  {title}
                </Text>
                {isGitCheckout && currentBranchName ? (
                  <BranchSwitcher
                    currentBranchName={currentBranchName}
                    title={currentBranchName}
                    serverId={normalizedServerId}
                    workspaceId={normalizedWorkspaceId}
                    isGitCheckout={isGitCheckout}
                    presentation="soft-pill"
                  />
                ) : null}
              </View>
              {showSubtitle ? (
                <Text
                  testID="workspace-header-subtitle"
                  style={styles.headerProjectTitle}
                  numberOfLines={1}
                >
                  {subtitle}
                </Text>
              ) : null}
            </>
          ) : (
            <DesktopWorkspaceHeaderTitle
              activeTarget={activeTarget}
              fallbackTitle={title}
              serverId={normalizedServerId}
              workspaceId={normalizedWorkspaceId}
            />
          )}
        </View>
      )}
      <View style={styles.compactHeaderMenuCluster}>
        <WorkspaceHeaderMenu
          normalizedWorkspaceId={normalizedWorkspaceId}
          currentBranchName={currentBranchName}
          showWorkspaceSetup={showWorkspaceSetup}
          showCreateBrowserTab={showCreateBrowserTab}
          isMobile={isMobile}
          createTerminalDisabled={createTerminalDisabled}
          browserContextDockDisabled={browserContextDockDisabled}
          onCreateDraftTab={onCreateDraftTab}
          onCreateTerminal={onCreateTerminal}
          onCreateBrowser={onCreateBrowser}
          onOpenGitDock={onOpenGitDock}
          onOpenBrowserContextDock={onOpenBrowserContextDock}
          onCopyWorkspacePath={onCopyWorkspacePath}
          onCopyBranchName={onCopyBranchName}
          onOpenSetupTab={onOpenSetupTab}
        />
        {isMobile && workspaceScripts.length > 0 ? (
          <WorkspaceScriptsButton
            serverId={normalizedServerId}
            workspaceId={normalizedWorkspaceId}
            scripts={workspaceScripts}
            liveTerminalIds={liveTerminalIds}
            onScriptTerminalStarted={onScriptTerminalStarted}
            onViewTerminal={onViewScriptTerminal}
            onOpenUrlInBrowserTab={onOpenUrlInBrowserTab}
            hideLabels
            presentation="ghost"
          />
        ) : null}
      </View>
    </View>
  );
}

function DesktopWorkspaceHeaderTitle({
  activeTarget,
  fallbackTitle,
  serverId,
  workspaceId,
}: {
  activeTarget: WorkspaceTabTarget | null;
  fallbackTitle: string;
  serverId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();

  if (!activeTarget) {
    return (
      <View style={styles.desktopHeaderTitleRow}>
        <Text testID="workspace-header-title" style={styles.headerTitle} numberOfLines={1}>
          {fallbackTitle}
        </Text>
      </View>
    );
  }

  return (
    <WorkspaceTabPresentationResolver
      target={activeTarget}
      serverId={serverId}
      workspaceId={workspaceId}
    >
      {(presentation) => (
        <View style={styles.desktopHeaderTitleRow}>
          <Text testID="workspace-header-title" style={styles.headerTitle} numberOfLines={1}>
            {presentation.titleState === "loading"
              ? t("workspace.screen.loading")
              : presentation.label}
          </Text>
        </View>
      )}
    </WorkspaceTabPresentationResolver>
  );
}

/**
 * Soft `.ctx` workspace label: project short name only (design "ChisaCode").
 * Never fall back to a label that equals the branch (avoids master/master twin pills
 * when workspace.name is a worktree/branch folder).
 */
function resolveSoftWorkspaceCtxLabel(
  workspaceName: string,
  projectDisplayName: string,
  branchName: string | null,
): string {
  const project = projectDisplayName.trim();
  if (project.length > 0) {
    const slash = Math.max(project.lastIndexOf("/"), project.lastIndexOf("\\"));
    return slash >= 0 ? project.slice(slash + 1) : project;
  }
  const name = workspaceName.trim();
  const branch = branchName?.trim() ?? "";
  if (
    name.length > 0 &&
    branch.length > 0 &&
    name.toLocaleLowerCase() === branch.toLocaleLowerCase()
  ) {
    return "";
  }
  return name;
}

/**
 * Desktop topbar aligned to T3 ChatHeader:
 * left project/session breadcrumb, right action cluster, then panel toggles.
 * Env/explorer icons sit immediately left of window-control reserve (user request).
 */
export function WorkspaceDesktopSoftTopbar({
  isLoading,
  title,
  subtitle,
  showSubtitle: _showSubtitle,
  activeTarget,
  currentBranchName,
  isGitCheckout,
  normalizedServerId,
  normalizedWorkspaceId,
  workspaceScripts,
  liveTerminalIds,
  showWorkspaceSetup,
  showCreateBrowserTab,
  createTerminalDisabled,
  browserContextDockDisabled,
  isExplorerOpen,
  canToggleExplorer,
  isEnvironmentPanelVisible,
  canShowEnvironmentPanel,
  isTerminalDrawerOpen = false,
  isRightPanelOpen = false,
  explorerToggleAccessibilityState,
  onToggleExplorer,
  onToggleEnvironmentPanel,
  onToggleTerminalDrawer,
  onToggleRightPanel,
  onCreateDraftTab,
  onCreateTerminal,
  onCreateBrowser,
  onOpenGitDock,
  onOpenBrowserContextDock,
  onCopyWorkspacePath,
  onCopyBranchName,
  onOpenSetupTab,
  onScriptTerminalStarted,
  onViewScriptTerminal,
  onOpenUrlInBrowserTab,
}: {
  isLoading: boolean;
  title: string;
  subtitle: string;
  showSubtitle: boolean;
  activeTarget: WorkspaceTabTarget | null;
  currentBranchName: string | null;
  isGitCheckout: boolean;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  workspaceScripts: WorkspaceDescriptor["scripts"];
  liveTerminalIds: string[];
  showWorkspaceSetup: boolean;
  showCreateBrowserTab: boolean;
  createTerminalDisabled: boolean;
  browserContextDockDisabled: boolean;
  isExplorerOpen: boolean;
  canToggleExplorer: boolean;
  isEnvironmentPanelVisible: boolean;
  canShowEnvironmentPanel: boolean;
  isTerminalDrawerOpen?: boolean;
  isRightPanelOpen?: boolean;
  explorerToggleAccessibilityState: { expanded: boolean };
  onToggleExplorer: () => void;
  onToggleEnvironmentPanel: () => void;
  onToggleTerminalDrawer?: () => void;
  onToggleRightPanel?: () => void;
  onCreateDraftTab: () => void;
  onCreateTerminal: () => void;
  onCreateBrowser: () => void;
  onOpenGitDock: () => void;
  onOpenBrowserContextDock: () => void;
  onCopyWorkspacePath: () => void;
  onCopyBranchName: () => void;
  onOpenSetupTab: () => void;
  onScriptTerminalStarted: (terminalId: string) => void;
  onViewScriptTerminal: (terminalId: string) => void;
  onOpenUrlInBrowserTab: (url: string) => void;
}) {
  const { t } = useTranslation();
  // Project short name leads the breadcrumb (T3: project always leads the header).
  const projectLabel = resolveSoftWorkspaceCtxLabel(title, subtitle, currentBranchName);
  const titleFallback = title.trim().length > 0 ? title : "";
  const showProjectLead = projectLabel.length > 0;
  const openInCwd = isAbsolutePath(normalizedWorkspaceId) ? normalizedWorkspaceId : "";
  const showScripts = workspaceScripts.length > 0;
  // Reserve Git geometry whenever we have a cwd and either know it's git or are still loading.
  const showGitSlot = openInCwd.length > 0 && (isGitCheckout || isLoading);
  // Shell DesktopSidebarControl is fixed; clear breadcrumb when the rail is collapsed.
  const sidebarControlContentPad = useDesktopSidebarControlContentPad();
  // Native caption buttons overlay the right of this 48px row (no separate white titlebar).
  const softTopbarStyle = useMemo(() => {
    const base = getIsElectron()
      ? [styles.softTopbar, SOFT_TOPBAR_ELECTRON_RIGHT_PAD]
      : [styles.softTopbar];
    if (sidebarControlContentPad <= 0) {
      return base;
    }
    return [...base, { paddingLeft: sidebarControlContentPad }];
  }, [sidebarControlContentPad]);
  const projectLeadStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.softBreadcrumbProject,
      (Boolean(hovered) || pressed) && styles.softBreadcrumbProjectHovered,
    ],
    [],
  );

  return (
    <View style={softTopbarStyle} testID="workspace-desktop-soft-topbar">
      {/* Soft topbar owns window drag when the desktop tab strip is hidden. */}
      <TitlebarDragRegion />
      <View style={styles.softTopbarTitleCluster}>
        {isLoading && !activeTarget && titleFallback.length === 0 ? (
          <View style={styles.headerTitleSkeleton} />
        ) : (
          <View style={styles.softBreadcrumbRow} testID="workspace-header-breadcrumb">
            {showProjectLead ? (
              <>
                <Pressable
                  testID="workspace-header-workspace-ctx"
                  accessibilityRole="button"
                  accessibilityLabel={t("workspace.newAgentCurrentWorkspace")}
                  onPress={onCreateDraftTab}
                  style={projectLeadStyle}
                >
                  <ThemedIconHost Icon={Folder} size={14} uniProps={mutedColorMapping} />
                  <Text style={styles.softBreadcrumbProjectText} numberOfLines={1}>
                    {projectLabel}
                  </Text>
                </Pressable>
                <Text style={styles.softBreadcrumbSeparator} accessibilityElementsHidden>
                  /
                </Text>
              </>
            ) : null}
            <DesktopWorkspaceHeaderTitle
              activeTarget={activeTarget}
              fallbackTitle={titleFallback}
              serverId={normalizedServerId}
              workspaceId={normalizedWorkspaceId}
            />
          </View>
        )}
      </View>

      <View style={SOFT_TOPBAR_RIGHT_CLUSTER_STYLE}>
        <View style={SOFT_TOP_ACTIONS_STYLE} testID="workspace-header-actions">
          {showScripts ? (
            <WorkspaceScriptsButton
              serverId={normalizedServerId}
              workspaceId={normalizedWorkspaceId}
              scripts={workspaceScripts}
              liveTerminalIds={liveTerminalIds}
              onScriptTerminalStarted={onScriptTerminalStarted}
              onViewTerminal={onViewScriptTerminal}
              onOpenUrlInBrowserTab={onOpenUrlInBrowserTab}
              presentation="split"
            />
          ) : null}
          {openInCwd.length > 0 ? (
            <WorkspaceOpenInEditorButton serverId={normalizedServerId} cwd={openInCwd} />
          ) : null}
          {isGitCheckout && currentBranchName && openInCwd.length > 0 ? (
            <BranchSwitcher
              currentBranchName={currentBranchName}
              title={currentBranchName}
              serverId={normalizedServerId}
              workspaceId={openInCwd}
              isGitCheckout={isGitCheckout}
              presentation="soft-pill"
            />
          ) : null}
          {showGitSlot ? (
            <WorkspaceGitActions
              serverId={normalizedServerId}
              cwd={openInCwd}
              forceLoading={isLoading}
              hideIdlePrimary={Boolean(currentBranchName)}
            />
          ) : null}
        </View>

        {/* T3 layout slot: terminal drawer + right panel (P1 skeleton → existing surfaces). */}
        <View style={SOFT_TOP_TOOLS_STYLE}>
          <WorkspaceHeaderRightControls
            isMobile={false}
            isGitCheckout={isGitCheckout}
            isExplorerOpen={isExplorerOpen}
            canToggleExplorer={canToggleExplorer}
            isEnvironmentPanelVisible={isEnvironmentPanelVisible}
            canShowEnvironmentPanel={canShowEnvironmentPanel}
            createTerminalDisabled={createTerminalDisabled}
            isTerminalDrawerOpen={isTerminalDrawerOpen}
            isRightPanelOpen={isRightPanelOpen}
            explorerToggleAccessibilityState={explorerToggleAccessibilityState}
            onToggleExplorer={onToggleExplorer}
            onToggleEnvironmentPanel={onToggleEnvironmentPanel}
            onToggleTerminalDrawer={onToggleTerminalDrawer}
            onToggleRightPanel={onToggleRightPanel}
            onCreateTerminal={onCreateTerminal}
          />
          <WorkspaceHeaderMenu
            normalizedWorkspaceId={normalizedWorkspaceId}
            currentBranchName={currentBranchName}
            showWorkspaceSetup={showWorkspaceSetup}
            showCreateBrowserTab={showCreateBrowserTab}
            isMobile={false}
            createTerminalDisabled={createTerminalDisabled}
            browserContextDockDisabled={browserContextDockDisabled}
            onCreateDraftTab={onCreateDraftTab}
            onCreateTerminal={onCreateTerminal}
            onCreateBrowser={onCreateBrowser}
            onOpenGitDock={onOpenGitDock}
            onOpenBrowserContextDock={onOpenBrowserContextDock}
            onCopyWorkspacePath={onCopyWorkspacePath}
            onCopyBranchName={onCopyBranchName}
            onOpenSetupTab={onOpenSetupTab}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * Desktop layout controls (T3 titlebar cluster skeleton):
 * terminal drawer + right panel. Mobile keeps explorer toggle only.
 * @param props Toggle visibility, availability, and callbacks
 * @returns The workspace header action controls
 */
export function WorkspaceHeaderRightControls({
  isMobile,
  isGitCheckout,
  isExplorerOpen,
  canToggleExplorer,
  isEnvironmentPanelVisible,
  canShowEnvironmentPanel,
  createTerminalDisabled = false,
  isTerminalDrawerOpen = false,
  isRightPanelOpen = false,
  explorerToggleAccessibilityState,
  onToggleExplorer,
  onToggleEnvironmentPanel,
  onToggleTerminalDrawer,
  onToggleRightPanel,
  onCreateTerminal,
}: {
  isMobile: boolean;
  isGitCheckout: boolean;
  isExplorerOpen: boolean;
  canToggleExplorer: boolean;
  isEnvironmentPanelVisible: boolean;
  canShowEnvironmentPanel: boolean;
  createTerminalDisabled?: boolean;
  isTerminalDrawerOpen?: boolean;
  isRightPanelOpen?: boolean;
  explorerToggleAccessibilityState: { expanded: boolean };
  onToggleExplorer: () => void;
  onToggleEnvironmentPanel: () => void;
  /** Production: toggle bottom terminal drawer (creates terminal if needed). */
  onToggleTerminalDrawer?: () => void;
  /** Production: toggle unified right surface panel. */
  onToggleRightPanel?: () => void;
  /** @deprecated Prefer onToggleTerminalDrawer. Kept for older call sites. */
  onCreateTerminal?: () => void;
}) {
  const { t } = useTranslation();
  const rightPanelOpen = isRightPanelOpen || isExplorerOpen;
  const handleTerminalToggle = useCallback(() => {
    if (onToggleTerminalDrawer) {
      onToggleTerminalDrawer();
      return;
    }
    onCreateTerminal?.();
  }, [onCreateTerminal, onToggleTerminalDrawer]);
  const handleRightPanelToggle = useCallback(() => {
    if (onToggleRightPanel) {
      onToggleRightPanel();
      return;
    }
    onToggleExplorer();
  }, [onToggleExplorer, onToggleRightPanel]);
  const terminalToggleAccessibilityState = useMemo(
    () => ({ expanded: isTerminalDrawerOpen }),
    [isTerminalDrawerOpen],
  );
  const environmentToggleAccessibilityState = useMemo(
    () => ({ expanded: isEnvironmentPanelVisible }),
    [isEnvironmentPanelVisible],
  );
  const rightPanelToggleAccessibilityState = useMemo(
    () => ({ expanded: rightPanelOpen }),
    [rightPanelOpen],
  );
  const terminalToggleDisabled =
    createTerminalDisabled || (!onToggleTerminalDrawer && !onCreateTerminal);

  // Unified right panel toggle (Files/Diff/Terminal/Browser host).
  const rightPanelButton = (
    <HeaderToggleButton
      testID="workspace-right-panel-toggle"
      onPress={handleRightPanelToggle}
      tooltipLabel={t("workspace.rightPanel.title")}
      tooltipKeys={EXPLORER_TOGGLE_KEYS}
      tooltipSide="left"
      style={styles.headerActionButton}
      disabled={!canToggleExplorer && !onToggleRightPanel}
      accessible
      accessibilityRole="button"
      accessibilityLabel={
        rightPanelOpen ? t("workspace.rightPanel.close") : t("workspace.rightPanel.title")
      }
      accessibilityState={rightPanelToggleAccessibilityState}
    >
      {({ hovered }) => {
        const colorMapping = rightPanelOpen || hovered ? foregroundColorMapping : mutedColorMapping;
        return isGitCheckout ? (
          <ThemedIconHost
            Icon={SourceControlPanelIcon}
            size={16}
            uniProps={colorMapping}
            {...sourceControlPanelStrokeWidth15}
          />
        ) : (
          <ThemedIconHost Icon={PanelRight} size={16} uniProps={colorMapping} />
        );
      }}
    </HeaderToggleButton>
  );

  // Compat test id for mobile/explorer consumers that still query the old name.
  const mobileExplorerButton = (
    <HeaderToggleButton
      testID="workspace-explorer-toggle"
      onPress={onToggleExplorer}
      tooltipLabel={t("workspace.screen.toggleExplorer")}
      tooltipKeys={EXPLORER_TOGGLE_KEYS}
      tooltipSide="left"
      style={styles.headerActionButton}
      disabled={!canToggleExplorer}
      accessible
      accessibilityRole="button"
      accessibilityLabel={
        isExplorerOpen ? t("workspace.screen.closeExplorer") : t("workspace.screen.openExplorer")
      }
      accessibilityState={explorerToggleAccessibilityState}
    >
      {({ hovered }) => {
        const colorMapping = isExplorerOpen || hovered ? foregroundColorMapping : mutedColorMapping;
        return isGitCheckout ? (
          <ThemedIconHost
            Icon={SourceControlPanelIcon}
            size={16}
            uniProps={colorMapping}
            {...sourceControlPanelStrokeWidth15}
          />
        ) : (
          <ThemedIconHost Icon={PanelRight} size={16} uniProps={colorMapping} />
        );
      }}
    </HeaderToggleButton>
  );

  if (isMobile) {
    return <View style={styles.headerRight}>{mobileExplorerButton}</View>;
  }

  // T3-style layout cluster: terminal drawer + floating inspector + right panel.
  return (
    <View style={styles.headerRight} testID="workspace-layout-controls">
      <HeaderToggleButton
        testID="workspace-terminal-drawer-toggle"
        onPress={handleTerminalToggle}
        tooltipLabel={
          isTerminalDrawerOpen ? t("workspace.terminalDrawer.hide") : t("workspace.newTerminal")
        }
        tooltipKeys={TERMINAL_TOGGLE_KEYS}
        tooltipSide="left"
        style={styles.headerActionButton}
        disabled={terminalToggleDisabled}
        accessible
        accessibilityRole="button"
        accessibilityLabel={
          isTerminalDrawerOpen ? t("workspace.terminalDrawer.hide") : t("workspace.newTerminal")
        }
        accessibilityState={terminalToggleAccessibilityState}
      >
        {({ hovered }) => {
          const colorMapping =
            isTerminalDrawerOpen || hovered ? foregroundColorMapping : mutedColorMapping;
          return <ThemedIconHost Icon={SquareTerminal} size={16} uniProps={colorMapping} />;
        }}
      </HeaderToggleButton>
      {canShowEnvironmentPanel ? (
        <HeaderToggleButton
          testID="workspace-environment-panel-toggle"
          onPress={onToggleEnvironmentPanel}
          tooltipLabel={
            isEnvironmentPanelVisible
              ? t("workspace.environment.hideFloatingPanel")
              : t("workspace.environment.showFloatingPanel")
          }
          tooltipKeys={ENVIRONMENT_TOGGLE_KEYS}
          tooltipSide="left"
          style={styles.headerActionButton}
          accessible
          accessibilityRole="button"
          accessibilityLabel={
            isEnvironmentPanelVisible
              ? t("workspace.environment.hideFloatingPanel")
              : t("workspace.environment.showFloatingPanel")
          }
          accessibilityState={environmentToggleAccessibilityState}
        >
          {({ hovered }) => {
            const colorMapping =
              isEnvironmentPanelVisible || hovered ? foregroundColorMapping : mutedColorMapping;
            return <ThemedIconHost Icon={Layers} size={16} uniProps={colorMapping} />;
          }}
        </HeaderToggleButton>
      ) : null}
      {rightPanelButton}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Soft .topbar .title: 13.5 medium; compact keeps 14.5 readable.
  headerTitle: {
    fontSize: {
      xs: 14.5,
      md: 13.5,
    },
    lineHeight: {
      xs: 20,
      md: 18,
    },
    fontWeight: {
      xs: "500",
      md: "500",
    },
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  headerTitleContainer: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: {
      xs: theme.spacing[1],
      md: theme.spacing[2],
    },
    overflow: "hidden",
  },
  headerTitleTextGroup: {
    minWidth: 0,
    overflow: "hidden",
    flexShrink: 1,
    flexGrow: {
      xs: 1,
      md: 0,
    },
    flexDirection: {
      xs: "column",
      md: "row",
    },
    alignItems: {
      xs: "flex-start",
      md: "center",
    },
    justifyContent: "flex-start",
    gap: {
      xs: 0,
      md: theme.spacing[2],
    },
  },
  // Soft .m-header title row: session label + quiet branch ctx pill.
  compactHeaderTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    maxWidth: "100%",
    flexShrink: 1,
  },
  // Soft .topbar .title: plain session label, no icon chip, flex fills remaining space.
  desktopHeaderTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
    flex: 1,
    flexShrink: 1,
  },
  headerProjectTitle: {
    color: theme.colors.foregroundMuted,
    // Soft topbar project label: 13 compact / 14.5 desktop.
    fontSize: {
      xs: 13,
      md: 14.5,
    },
    lineHeight: {
      xs: 18,
      md: 20,
    },
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "60%",
  },
  headerTitleSkeleton: {
    width: 220,
    maxWidth: "100%",
    height: 22,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surfaceWorkspace,
    opacity: 0.45,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  // Soft .top-tools .icon-btn: 32 r10.
  headerActionButton: {
    width: 32,
    height: 32,
    padding: 0,
    borderRadius: 10,
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    ...(isWeb
      ? { boxShadow: "none" as const }
      : {
          shadowOpacity: 0,
          elevation: 0,
        }),
  },
  // Soft compact header action: quiet r10 pill (32 family).
  compactHeaderActionButton: {
    width: theme.spacing[8],
    height: theme.spacing[8],
    padding: 0,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  compactHeaderMenuCluster: {
    marginLeft: {
      xs: 0,
      md: "auto",
    },
    flexDirection: "row",
    alignItems: "center",
    gap: {
      xs: 0,
      md: theme.spacing[2],
    },
  },
  // Soft .topbar: 48h, pad 0 12 0 16, title left, ctx+tools right.
  softTopbar: {
    position: "relative",
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 16,
    paddingRight: 12,
    borderBottomWidth: theme.borderWidth[1],
    // design --border-soft
    borderBottomColor: theme.colors.surface2,
    backgroundColor: theme.colors.surfaceWorkspace,
    width: "100%",
    minWidth: 0,
    zIndex: 30,
  },
  softTopbarTitleCluster: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    marginRight: 6,
  },
  softTopbarRightCluster: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  // T3 ChatHeader left: project lead + "/" + session title.
  softBreadcrumbRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    overflow: "hidden",
  },
  softBreadcrumbProject: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    maxWidth: 160,
    minWidth: 0,
    borderRadius: 6,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  softBreadcrumbProjectHovered: {
    opacity: 0.85,
  },
  softBreadcrumbProjectText: {
    color: theme.colors.foregroundMuted,
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: "500",
    flexShrink: 1,
    minWidth: 0,
  },
  softBreadcrumbSeparator: {
    color: theme.colors.foregroundSubtleText,
    fontSize: 13.5,
    lineHeight: 18,
    opacity: 0.55,
    flexShrink: 0,
  },
  softTopActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  softTopTools: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
  },
}));

const SOFT_TOPBAR_RIGHT_CLUSTER_STYLE = [
  styles.softTopbarRightCluster,
  TITLEBAR_NO_DRAG_VIEW_STYLE,
];
const SOFT_TOP_ACTIONS_STYLE = [styles.softTopActions, TITLEBAR_NO_DRAG_VIEW_STYLE];
const SOFT_TOP_TOOLS_STYLE = [styles.softTopTools, TITLEBAR_NO_DRAG_VIEW_STYLE];
const SOFT_TOPBAR_ELECTRON_RIGHT_PAD = {
  paddingRight: 12 + DESKTOP_WINDOW_CONTROLS_WIDTH,
} as const;
