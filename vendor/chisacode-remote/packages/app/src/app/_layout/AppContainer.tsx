import { type CSSProperties, type ReactNode, useCallback, useMemo } from "react";
import { View } from "react-native";
import { usePathname } from "expo-router";
import { StyleSheet } from "react-native-unistyles";
import { getIsElectronRuntime, useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useActiveWorktreeNewAction } from "@/hooks/use-active-worktree-new-action";
import { useGlobalNewWorkspaceAction } from "@/hooks/use-global-new-workspace-action";
import { useCompactWebViewportZoomLock } from "@/hooks/use-compact-web-viewport-zoom-lock";
import { useAppSettings } from "@/hooks/use-settings";
import { useHosts } from "@/runtime/host-runtime";
import { usePanelStore } from "@/stores/panel-store";
import { ACTIVE_THEME_NAMES, type ThemeName } from "@/styles/theme";
import { toggleDesktopSidebarsWithCheckoutIntent } from "@/utils/desktop-sidebar-toggle";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import { resolveActiveHost } from "@/utils/active-host";
import { LeftSidebar } from "@/components/left-sidebar";
import { DesktopSidebarControl } from "@/components/desktop/desktop-sidebar-control";
import { DesktopWindowControls } from "@/components/desktop/window-controls";
import { LiquidNeonBackdrop } from "@/components/liquid-neon-backdrop";
import { FloatingPanelPortalHost } from "@/components/ui/floating-panel-portal";
import { DownloadToast } from "@/components/download-toast";
import { RosettaCalloutSource } from "@/desktop/updates/rosetta-callout-source";
import { UpdateCalloutSource } from "@/desktop/updates/update-callout-source";
import { WorktreeSetupCalloutSource } from "@/components/worktree-setup-callout-source";
import { CommandCenter } from "@/components/command-center";
import { ProjectPickerModal } from "@/components/project-picker-modal";
import { ProviderSettingsHost } from "@/components/provider-settings-host";
import { WorkspaceShortcutTargetsSubscriber } from "@/components/workspace-shortcut-targets-subscriber";
import { WorkspaceSetupDialog } from "@/components/workspace-setup-dialog";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { QuittingOverlay } from "@/components/quitting-overlay";
import { keyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher";
import { MobileGestureWrapper } from "./MobileGesture";

export interface AppContainerProps {
  children: ReactNode;
  selectedAgentId?: string;
  chromeEnabled?: boolean;
}

export const THEME_CYCLE_ORDER: readonly ThemeName[] = ACTIVE_THEME_NAMES;

// Reference system font for the desktop workspace content only. Scoped to
// app-content (the routed workspace subtree) so shell surfaces — the sidebar,
// sidebar control, command center — keep their own font stack. The previous
// whole-app-surface selector also overrode the sidebar: on Windows
// `system-ui` resolves to Segoe UI Variable, whose glyph metrics differ from
// Segoe UI, so selecting a session (entering /workspace/) made the entire
// session list re-render wider. See roadmap entry
// 「侧栏 项目/状态 视图字体校准 + 切换丝滑化」.
const DESKTOP_WORKBENCH_FONT_CSS = `[data-testid="app-content"] * {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
}`;

function AppContainer({
  children,
  selectedAgentId,
  chromeEnabled: chromeEnabledOverride,
}: AppContainerProps) {
  const isCompactLayout = useIsCompactFormFactor();
  const frameEnabled = !isCompactLayout && getIsElectronRuntime();
  const surfaceFillStyle = useMemo(
    () => [
      layoutStyles.surfaceFill,
      frameEnabled ? layoutStyles.surfaceFillFrame : layoutStyles.surfaceFillNoFrame,
    ],
    [frameEnabled],
  );
  const daemons = useHosts();
  const { settings, updateSettings } = useAppSettings();
  const toggleMobileAgentList = usePanelStore((state) => state.toggleMobileAgentList);
  const toggleDesktopAgentList = usePanelStore((state) => state.toggleDesktopAgentList);
  const openDesktopAgentList = usePanelStore((state) => state.openDesktopAgentList);
  const closeDesktopAgentList = usePanelStore((state) => state.closeDesktopAgentList);
  const closeDesktopFileExplorer = usePanelStore((state) => state.closeDesktopFileExplorer);
  const toggleFocusMode = usePanelStore((state) => state.toggleFocusMode);
  const isFocusModeEnabled = usePanelStore((state) => state.desktop.focusModeEnabled);

  const cycleTheme = useCallback(() => {
    const currentIndex = THEME_CYCLE_ORDER.indexOf(settings.theme as ThemeName);
    const nextIndex = (currentIndex + 1) % THEME_CYCLE_ORDER.length;
    void updateSettings({ theme: THEME_CYCLE_ORDER[nextIndex] });
  }, [settings.theme, updateSettings]);

  useCompactWebViewportZoomLock(isCompactLayout);
  const chromeEnabled = chromeEnabledOverride ?? daemons.length > 0;
  const pathname = usePathname();
  const activeServerId = useMemo(
    () => resolveActiveHost({ hosts: daemons, pathname })?.serverId ?? null,
    [daemons, pathname],
  );
  const toggleAgentList = isCompactLayout ? toggleMobileAgentList : toggleDesktopAgentList;
  const toggleDesktopSidebars = useCallback(() => {
    const { desktop } = usePanelStore.getState();
    toggleDesktopSidebarsWithCheckoutIntent({
      isAgentListOpen: desktop.agentListOpen,
      isFileExplorerOpen: desktop.fileExplorerOpen,
      openAgentList: openDesktopAgentList,
      closeAgentList: closeDesktopAgentList,
      closeFileExplorer: closeDesktopFileExplorer,
      toggleFocusedFileExplorer: () =>
        keyboardActionDispatcher.dispatch({
          id: "sidebar.toggle.right",
          scope: "sidebar",
        }),
    });
  }, [closeDesktopAgentList, closeDesktopFileExplorer, openDesktopAgentList]);
  // TODO: stop matching pathname here as a branch. `chromeEnabled` should not
  // conflate workspace/project-specific chrome (sidebar, mobile gesture) with
  // global concerns like keyboard shortcuts. Split those out so settings (and
  // other non-workspace routes) don't need a special-case to keep shortcuts alive.
  const keyboardShortcutsEnabled = chromeEnabled || pathname.startsWith("/settings");
  const desktopWorkbenchFontEnabled =
    !isCompactLayout && getIsElectronRuntime() && pathname.includes("/workspace/");
  const appRowStyle = useMemo(
    () => [layoutStyles.appRow, !isCompactLayout && layoutStyles.appRowDesktop],
    [isCompactLayout],
  );

  useKeyboardShortcuts({
    enabled: keyboardShortcutsEnabled,
    isMobile: isCompactLayout,
    toggleAgentList,
    toggleBothSidebars: toggleDesktopSidebars,
    toggleFocusMode,
    cycleTheme,
  });

  useActiveWorktreeNewAction();
  useGlobalNewWorkspaceAction();

  const appRowContent = (
    <>
      {!isCompactLayout && chromeEnabled && !isFocusModeEnabled && (
        <LeftSidebar selectedAgentId={selectedAgentId} />
      )}
      <View style={layoutStyles.appContent} testID="app-content">
        {children}
      </View>
    </>
  );

  const content = (
    <View style={surfaceFillStyle} testID="app-surface">
      <DesktopWorkbenchFontStyle enabled={desktopWorkbenchFontEnabled} />
      <LiquidNeonBackdrop />
      <DesktopTitlebarDragStrip />
      <View style={appRowStyle}>{appRowContent}</View>
      {/* T3 SidebarControl: one shell-level open/close that survives every route. */}
      <DesktopSidebarControl enabled={chromeEnabled} />
      <FloatingPanelPortalHost />
      {isCompactLayout && chromeEnabled && <LeftSidebar selectedAgentId={selectedAgentId} />}
      <DownloadToast />
      <RosettaCalloutSource />
      <UpdateCalloutSource />
      <WorktreeSetupCalloutSource />
      {/* Win/Linux custom −□× under Command Center so the dimmer covers them. */}
      <DesktopWindowControls />
      <CommandCenter />
      <ProjectPickerModal />
      <ProviderSettingsHost />
      <WorkspaceShortcutTargetsSubscriber enabled={false} serverId={activeServerId} />
      <WorkspaceSetupDialog />
      <KeyboardShortcutsDialog />
      <QuittingOverlay />
    </View>
  );

  if (!isCompactLayout) {
    return content;
  }

  return <MobileGestureWrapper chromeEnabled={chromeEnabled}>{content}</MobileGestureWrapper>;
}

function DesktopWorkbenchFontStyle({ enabled }: { enabled: boolean }) {
  if (isNative || !enabled) {
    return null;
  }

  return <style>{DESKTOP_WORKBENCH_FONT_CSS}</style>;
}

function DesktopTitlebarDragStrip() {
  const padding = useWindowControlsPadding("titlebar");
  const stripStyle = useMemo<CSSProperties>(
    () => ({
      position: "absolute",
      top: 0,
      left: 0,
      right: padding.right,
      height: padding.top,
      WebkitAppRegion: "drag",
    }),
    [padding.right, padding.top],
  );

  if (isNative || !getIsElectronRuntime() || padding.top <= 0) {
    return null;
  }

  return <div style={stripStyle} />;
}

export const layoutStyles = StyleSheet.create((theme) => ({
  surfaceFill: {
    flex: 1,
    position: "relative",
    // Soft Workbench root: glass shell is transparent over LiquidNeonBackdrop;
    // solid themes paint the workspace canvas.
    backgroundColor: theme.glass.enabled ? "transparent" : theme.colors.surfaceWorkspace,
  },
  surfaceFillFrame: {
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  surfaceFillNoFrame: {
    borderWidth: 0,
    borderColor: "transparent",
  },
  // Soft: spacer is transparent clearance only (no white band / no hard divider).
  desktopTitlebarSpacer: {
    flexShrink: 0,
    backgroundColor: "transparent",
    borderBottomWidth: 0,
  },
  appRow: {
    flex: 1,
    flexDirection: "row",
  },
  appRowDesktop: {
    backgroundColor: theme.glass.enabled ? theme.glass.shell : theme.colors.surfaceWorkspace,
  },
  appContent: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
}));

export { AppContainer, DesktopTitlebarDragStrip };
