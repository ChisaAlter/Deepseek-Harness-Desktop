import { memo, useMemo, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { ConversationAspectColumn } from "@/components/conversation-aspect-column";
import type { Theme } from "@/styles/theme";
import { resolveThemeWorkbenchSurfaceRoles } from "@/styles/workbench-surface-roles";
import { WorkspaceFocusProvider } from "@/workspace/focus";
import {
  WorkspacePaneContent,
  type WorkspacePaneContentModel,
} from "@/screens/workspace/workspace-pane-content";
import {
  WorkspaceHeaderRightControls,
  WorkspaceHeaderTitleBar,
} from "@/screens/workspace/workspace-header";
import { WorkspaceEnvironmentPanelRail } from "@/screens/workspace/workspace-environment-panel";
import { WorkspaceGitActions } from "@/git/workspace-actions";
import type { WorkspaceTabTarget } from "@/workspace-tabs/identity";
import { getIsElectron } from "@/constants/platform";
import { isWeb } from "@/constants/platform";
import { isAbsolutePath } from "@/utils/path";

const COMPACT_WEB_GESTURE_TOUCH_ACTION = isWeb ? "auto" : "pan-y";
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const GATED_WORKSPACE_HEADER_LEFT = <SidebarMenuToggle />;

type WorkspaceHeaderTitleBarInput = Omit<
  ComponentProps<typeof WorkspaceHeaderTitleBar>,
  | "activeTarget"
  | "normalizedServerId"
  | "normalizedWorkspaceId"
  | "showCreateBrowserTab"
  | "isMobile"
  | "createTerminalDisabled"
  | "browserContextDockDisabled"
>;

type WorkspaceHeaderRightControlsInput = Omit<
  ComponentProps<typeof WorkspaceHeaderRightControls>,
  "isMobile" | "isEnvironmentPanelVisible"
>;

type WorkspaceEnvironmentPanelInput = Omit<
  ComponentProps<typeof WorkspaceEnvironmentPanelRail>,
  "visible"
>;

interface WorkspaceContentInput {
  isMissingWorkspaceExecutionAuthority: boolean;
  hasHydratedAgents: boolean;
  contentModel: WorkspacePaneContentModel | null;
  isRouteFocused: boolean;
}

const WorkspaceContent = memo(function WorkspaceContent({
  isMissingWorkspaceExecutionAuthority,
  hasHydratedAgents,
  contentModel,
  isRouteFocused,
}: WorkspaceContentInput) {
  const { t } = useTranslation();

  if (isMissingWorkspaceExecutionAuthority) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyStateText}>{t("workspace.screen.workspaceExecutionMissing")}</Text>
      </View>
    );
  }
  if (!contentModel && !hasHydratedAgents) {
    return (
      <View style={styles.emptyState}>
        <ThemedActivityIndicator uniProps={mutedColorMapping} />
      </View>
    );
  }
  if (!contentModel) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyStateText}>{t("workspace.screen.noTabsAvailable")}</Text>
      </View>
    );
  }
  // Host ConversationAspectColumn on the center-column shell (outside the keyed
  // panel). Agent/draft switches remount WorkspacePaneContent only; the column
  // instance stays mounted so measured maxWidth never re-falls back to 800.
  // Terminal/browser/file/setup stay full-width (their own layout model).
  if (contentModel.kind === "agent" || contentModel.kind === "draft") {
    return (
      <ConversationAspectColumn>
        <WorkspacePaneContent
          content={contentModel}
          isWorkspaceFocused={isRouteFocused}
          isPaneFocused={isRouteFocused}
        />
      </ConversationAspectColumn>
    );
  }
  return (
    <WorkspacePaneContent
      content={contentModel}
      isWorkspaceFocused={isRouteFocused}
      isPaneFocused={isRouteFocused}
    />
  );
});

interface WorkspaceCenterColumnProps {
  isMobile: boolean;
  isRouteFocused: boolean;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  activeTarget: WorkspaceTabTarget | null;
  isMissingWorkspaceExecutionAuthority: boolean;
  hasHydratedAgents: boolean;
  contentModel: WorkspacePaneContentModel | null;
  explorerOpenGesture: ComponentProps<typeof GestureDetector>["gesture"];
  onCenterContentLayout: ComponentProps<typeof View>["onLayout"];
  isEnvironmentPanelVisible: boolean;
  isCreateTerminalPending: boolean;
  hasEnvironmentBrowserContext: boolean;
  headerTitleBar: WorkspaceHeaderTitleBarInput;
  headerRightControls: WorkspaceHeaderRightControlsInput;
  environmentPanel: WorkspaceEnvironmentPanelInput;
  /** Optional bottom terminal drawer (desktop production chrome). */
  terminalDrawer?: ReactNode;
}

/**
 * Renders the responsive workspace center column across mobile, web, and Electron.
 * @param props Prepared header, content, and environment view models
 * @returns The center-column view
 */
export function WorkspaceCenterColumn({
  isMobile,
  isRouteFocused,
  normalizedServerId,
  normalizedWorkspaceId,
  activeTarget,
  isMissingWorkspaceExecutionAuthority,
  hasHydratedAgents,
  contentModel,
  explorerOpenGesture,
  onCenterContentLayout,
  isEnvironmentPanelVisible,
  isCreateTerminalPending,
  hasEnvironmentBrowserContext,
  headerTitleBar,
  headerRightControls,
  environmentPanel,
  terminalDrawer = null,
}: WorkspaceCenterColumnProps) {
  const showCreateBrowserTab = getIsElectron();
  const environmentRailVisible = !isMobile && isEnvironmentPanelVisible;

  const headerRight = useMemo(() => {
    if (!isMobile) {
      return null;
    }
    const openInCwd = isAbsolutePath(normalizedWorkspaceId) ? normalizedWorkspaceId : "";
    return (
      <View style={styles.mobileHeaderRight} testID="workspace-mobile-header-actions">
        {headerRightControls.isGitCheckout && openInCwd.length > 0 ? (
          <WorkspaceGitActions serverId={normalizedServerId} cwd={openInCwd} hideLabels />
        ) : null}
        <WorkspaceHeaderRightControls
          {...headerRightControls}
          isMobile
          isEnvironmentPanelVisible={isEnvironmentPanelVisible}
          createTerminalDisabled={isCreateTerminalPending}
          onCreateTerminal={headerTitleBar.onCreateTerminal}
        />
      </View>
    );
  }, [
    headerRightControls,
    headerTitleBar.onCreateTerminal,
    isCreateTerminalPending,
    isEnvironmentPanelVisible,
    isMobile,
    normalizedServerId,
    normalizedWorkspaceId,
  ]);

  const content = useMemo(
    () => (
      <WorkspaceContent
        isMissingWorkspaceExecutionAuthority={isMissingWorkspaceExecutionAuthority}
        hasHydratedAgents={hasHydratedAgents}
        contentModel={contentModel}
        isRouteFocused={isRouteFocused}
      />
    ),
    [contentModel, hasHydratedAgents, isMissingWorkspaceExecutionAuthority, isRouteFocused],
  );

  return (
    <View style={styles.centerColumn}>
      {isMobile ? (
        <ScreenHeader
          left={
            <>
              <SidebarMenuToggle />
              <WorkspaceHeaderTitleBar
                {...headerTitleBar}
                activeTarget={activeTarget}
                normalizedServerId={normalizedServerId}
                normalizedWorkspaceId={normalizedWorkspaceId}
                showCreateBrowserTab={showCreateBrowserTab}
                isMobile={isMobile}
                createTerminalDisabled={isCreateTerminalPending}
                browserContextDockDisabled={!hasEnvironmentBrowserContext}
              />
            </>
          }
          right={headerRight}
        />
      ) : null}

      <View
        style={styles.centerContent}
        testID="workspace-main-panel"
        onLayout={onCenterContentLayout}
      >
        {isMobile ? (
          <GestureDetector
            gesture={explorerOpenGesture}
            touchAction={COMPACT_WEB_GESTURE_TOUCH_ACTION}
          >
            <View style={styles.content}>{content}</View>
          </GestureDetector>
        ) : (
          <View style={styles.content}>{content}</View>
        )}
        {!isMobile ? terminalDrawer : null}
      </View>
      {/* Floating goal / plan / subagents inspector (center-column overlay; exclusive with right panel). */}
      {!isMobile ? (
        <WorkspaceEnvironmentPanelRail {...environmentPanel} visible={environmentRailVisible} />
      ) : null}
    </View>
  );
}

/**
 * Renders a route-state gate inside the standard workspace shell.
 * @param props Gate content and optional workspace focus key
 * @returns The gate shell, or null when no gate is active
 */
export function WorkspaceScreenGateShell({
  gate,
  workspaceKey,
}: {
  gate: ReactNode;
  workspaceKey: string | null;
}): ReactElement | null {
  if (!gate) {
    return null;
  }

  return (
    <WorkspaceFocusProvider workspaceKey={workspaceKey}>
      <View style={styles.container}>
        <View style={styles.threePaneRow}>
          <View style={styles.centerColumn}>
            <ScreenHeader left={GATED_WORKSPACE_HEADER_LEFT} />
            <View style={styles.centerContent}>{gate}</View>
          </View>
        </View>
      </View>
    </WorkspaceFocusProvider>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: resolveThemeWorkbenchSurfaceRoles(theme).content,
  },
  threePaneRow: {
    flex: 1,
    minHeight: 0,
    position: "relative",
    flexDirection: "row",
    alignItems: "stretch",
    gap: 0,
    backgroundColor: "transparent",
    overflow: "hidden",
  },
  centerColumn: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    position: "relative",
  },
  centerContent: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    position: "relative",

    backgroundColor: resolveThemeWorkbenchSurfaceRoles(theme).content,
    overflow: "hidden",
  },
  content: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: resolveThemeWorkbenchSurfaceRoles(theme).content,
    position: "relative",
  },
  mobileHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
  },
  emptyStateText: {
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
}));
