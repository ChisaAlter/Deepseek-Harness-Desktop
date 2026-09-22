import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  useWindowDimensions,
  StyleSheet as RNStyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useIsFocused } from "expo-router";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  runOnJS,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { X } from "lucide-react-native";
import { GitHubIcon } from "@/components/icons/github-icon";
import type { Theme } from "@/styles/theme";
import { SPACING } from "@/styles/theme";
import { PrPane } from "@/git/pr-pane";
import { usePrPaneData } from "@/hooks/use-pr-pane-data";
import {
  usePanelStore,
  selectIsFileExplorerOpen,
  MIN_EXPLORER_SIDEBAR_WIDTH,
  MAX_EXPLORER_SIDEBAR_WIDTH,
  type ExplorerTab,
} from "@/stores/panel-store";
import { useExplorerSidebarAnimation } from "@/contexts/explorer-sidebar-animation-context";
import {
  HEADER_INNER_HEIGHT,
  MIN_CHAT_WIDTH,
  WORKBENCH_ENVIRONMENT_PANEL_INSET,
  WORKBENCH_ENVIRONMENT_PANEL_SHADOW,
  WORKSPACE_SECONDARY_HEADER_HEIGHT,
  useIsCompactFormFactor,
} from "@/constants/layout";
import { GitDiffPane } from "@/git/diff-pane";
import { FileExplorerPane } from "./file-explorer-pane";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { isWeb } from "@/constants/platform";
import { useTranslation } from "react-i18next";
import { getMobileSidebarWidth } from "@/utils/sidebar-animation-state";
import { ErrorBoundary, SectionErrorFallback } from "@/components/error-boundary";

const DESKTOP_SIDEBAR_ANIMATION_CONFIG = {
  duration: 180,
  easing: Easing.out(Easing.cubic),
};
function logExplorerSidebar(_event: string, _details: Record<string, unknown>): void {}

// Icons take `color` as a non-style prop, so wrap each one with `withUnistyles`
// and feed the theme-reactive color through `uniProps`. Only the icon node
// re-renders on theme changes; the surrounding tree does not.
const ThemedX = withUnistyles(X);
const ThemedGitHubIcon = withUnistyles(GitHubIcon);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});

interface ExplorerSidebarProps {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  isGit: boolean;
  onOpenFile?: (filePath: string) => void;
}

export function ExplorerSidebar({
  serverId,
  workspaceId,
  workspaceRoot,
  isGit,
  onOpenFile,
}: ExplorerSidebarProps) {
  const { t: sidebarT } = useTranslation();
  const isScreenFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const isMobile = useIsCompactFormFactor();
  const isOpen = usePanelStore((state) => selectIsFileExplorerOpen(state, { isCompact: isMobile }));
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const closeDesktopFileExplorer = usePanelStore((state) => state.closeDesktopFileExplorer);
  const explorerTab = usePanelStore((state) => state.explorerTab);
  const explorerWidth = usePanelStore((state) => state.explorerWidth);
  const setExplorerTabForCheckout = usePanelStore((state) => state.setExplorerTabForCheckout);
  const setExplorerWidth = usePanelStore((state) => state.setExplorerWidth);
  const { width: viewportWidth } = useWindowDimensions();
  const desktopWindowControlsPadding = useWindowControlsPadding("explorerSidebar");
  const closeTouchStartX = useSharedValue(0);
  const closeTouchStartY = useSharedValue(0);

  const { style: mobileKeyboardInsetStyle } = useKeyboardShiftStyle({
    mode: "padding",
    enabled: isMobile,
  });

  useEffect(() => {
    if (isMobile) {
      return;
    }
    const maxWidth = Math.max(
      MIN_EXPLORER_SIDEBAR_WIDTH,
      Math.min(MAX_EXPLORER_SIDEBAR_WIDTH, viewportWidth - MIN_CHAT_WIDTH),
    );
    if (explorerWidth > maxWidth) {
      setExplorerWidth(maxWidth);
    }
  }, [explorerWidth, isMobile, setExplorerWidth, viewportWidth]);

  const {
    translateX,
    backdropOpacity,
    windowWidth,
    animateToOpen,
    animateToClose,
    isGesturing,
    gestureAnimatingRef,
    closeGestureRef,
  } = useExplorerSidebarAnimation();
  const mobileSidebarWidth = useMemo(() => getMobileSidebarWidth(windowWidth), [windowWidth]);

  // For resize drag, track the starting width
  const startWidthRef = useRef(explorerWidth);
  const resizeWidth = useSharedValue(explorerWidth);
  const desktopOpenProgress = useSharedValue(isOpen ? 1 : 0);

  const handleClose = useCallback(
    (reason: string) => {
      logExplorerSidebar("handleClose", {
        reason,
        isOpen,
      });
      if (isMobile) {
        showMobileAgent();
        return;
      }
      closeDesktopFileExplorer();
    },
    [closeDesktopFileExplorer, isMobile, isOpen, showMobileAgent],
  );

  const handleCloseFromGesture = useCallback(() => {
    gestureAnimatingRef.current = true;
    showMobileAgent();
  }, [gestureAnimatingRef, showMobileAgent]);

  const enableSidebarCloseGesture = isMobile && isOpen;

  const handleTabPress = useCallback(
    (tab: ExplorerTab) => {
      setExplorerTabForCheckout({ serverId, cwd: workspaceRoot, isGit, tab });
    },
    [isGit, serverId, setExplorerTabForCheckout, workspaceRoot],
  );

  const handleHeaderClose = useCallback(() => handleClose("header-close-button"), [handleClose]);
  const handleDesktopClose = useCallback(() => handleClose("desktop-close-button"), [handleClose]);

  // Swipe gesture to close (swipe right on mobile)
  const closeGesture = useMemo(
    () =>
      Gesture.Pan()
        .withRef(closeGestureRef)
        .enabled(enableSidebarCloseGesture)
        // Use manual activation so child views keep touch streams
        // unless we detect an intentional right-swipe close.
        .manualActivation(true)
        .onTouchesDown((event) => {
          const touch = event.changedTouches[0];
          if (!touch) {
            return;
          }
          closeTouchStartX.value = touch.absoluteX;
          closeTouchStartY.value = touch.absoluteY;
        })
        .onTouchesMove((event, stateManager) => {
          const touch = event.changedTouches[0];
          if (!touch || event.numberOfTouches !== 1) {
            stateManager.fail();
            return;
          }

          const deltaX = touch.absoluteX - closeTouchStartX.value;
          const deltaY = touch.absoluteY - closeTouchStartY.value;
          const absDeltaX = Math.abs(deltaX);
          const absDeltaY = Math.abs(deltaY);

          // Fail quickly on clear leftward or vertical intent so child views keep control.
          if (deltaX <= -10) {
            stateManager.fail();
            return;
          }
          if (absDeltaY > 10 && absDeltaY > absDeltaX) {
            stateManager.fail();
            return;
          }

          // Activate only on intentional rightward movement.
          if (deltaX >= 15 && absDeltaX > absDeltaY) {
            stateManager.activate();
          }
        })
        .onStart(() => {
          isGesturing.value = true;
        })
        .onUpdate((event) => {
          // Right sidebar: swipe right to close (positive translationX)
          const newTranslateX = Math.max(0, Math.min(mobileSidebarWidth, event.translationX));
          translateX.value = newTranslateX;
          const progress = 1 - newTranslateX / mobileSidebarWidth;
          backdropOpacity.value = Math.max(0, Math.min(1, progress));
        })
        .onEnd((event) => {
          isGesturing.value = false;
          const shouldClose = event.translationX > mobileSidebarWidth / 3 || event.velocityX > 500;
          runOnJS(logExplorerSidebar)("closeGestureEnd", {
            translationX: event.translationX,
            velocityX: event.velocityX,
            shouldClose,
            windowWidth: mobileSidebarWidth,
          });
          if (shouldClose) {
            animateToClose();
            runOnJS(handleCloseFromGesture)();
          } else {
            animateToOpen();
          }
        })
        .onFinalize(() => {
          isGesturing.value = false;
        }),
    [
      enableSidebarCloseGesture,
      mobileSidebarWidth,
      translateX,
      backdropOpacity,
      animateToOpen,
      animateToClose,
      handleCloseFromGesture,
      isGesturing,
      closeGestureRef,
      closeTouchStartX,
      closeTouchStartY,
    ],
  );

  // Desktop resize gesture (drag left edge)
  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isMobile)
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onStart(() => {
          startWidthRef.current = explorerWidth;
          resizeWidth.value = explorerWidth;
        })
        .onUpdate((event) => {
          // Dragging left (negative translationX) increases width
          const newWidth = startWidthRef.current - event.translationX;
          const maxWidth = Math.max(
            MIN_EXPLORER_SIDEBAR_WIDTH,
            Math.min(MAX_EXPLORER_SIDEBAR_WIDTH, viewportWidth - MIN_CHAT_WIDTH),
          );
          const clampedWidth = Math.max(MIN_EXPLORER_SIDEBAR_WIDTH, Math.min(maxWidth, newWidth));
          resizeWidth.value = clampedWidth;
        })
        .onEnd(() => {
          runOnJS(setExplorerWidth)(resizeWidth.value);
        }),
    [isMobile, explorerWidth, resizeWidth, setExplorerWidth, viewportWidth],
  );

  useEffect(() => {
    if (isMobile) {
      resizeWidth.value = explorerWidth;
      desktopOpenProgress.value = isOpen ? 1 : 0;
      return;
    }
    resizeWidth.value = explorerWidth;
    desktopOpenProgress.value = withTiming(isOpen ? 1 : 0, DESKTOP_SIDEBAR_ANIMATION_CONFIG);
  }, [desktopOpenProgress, explorerWidth, isMobile, isOpen, resizeWidth]);

  const sidebarAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
    pointerEvents: backdropOpacity.value > 0.01 ? "auto" : "none",
  }));

  const resizeAnimatedStyle = useAnimatedStyle(() => ({
    width: resizeWidth.value,
    opacity: desktopOpenProgress.value,
    transform: [{ translateX: (1 - desktopOpenProgress.value) * (resizeWidth.value + 16) }],
  }));

  const backdropCombinedStyle = useMemo(
    () => [explorerStaticStyles.backdrop, backdropAnimatedStyle],
    [backdropAnimatedStyle],
  );
  // The theme background is painted by `styles.mobileSidebarBackground` on a
  // plain child View: the Animated.View itself must stay free of Unistyles
  // dynamic styles (see the crash note above `explorerStaticStyles`).
  const mobileSidebarStyle = useMemo(
    () => [
      explorerStaticStyles.mobileSidebar,
      {
        width: mobileSidebarWidth,
        paddingTop: insets.top,
      },
      sidebarAnimatedStyle,
      mobileKeyboardInsetStyle,
    ],
    [mobileSidebarWidth, insets.top, sidebarAnimatedStyle, mobileKeyboardInsetStyle],
  );
  // Soft topbar owns the first 48px of the center column. Explorer is a sibling overlay
  // on threePaneRow and would cover top-tools if it starts at top:0 — match environment panel inset.
  const desktopSidebarStyle = useMemo(
    () => [
      explorerStaticStyles.desktopSidebar,
      resizeAnimatedStyle,
      {
        top:
          WORKSPACE_SECONDARY_HEADER_HEIGHT +
          WORKBENCH_ENVIRONMENT_PANEL_INSET +
          insets.top +
          desktopWindowControlsPadding.top,
      },
    ],
    [desktopWindowControlsPadding.top, insets.top, resizeAnimatedStyle],
  );

  const renderErrorFallback = useCallback(
    (error: unknown, resetError: () => void) => (
      <SectionErrorFallback
        error={error}
        onReset={resetError}
        sectionLabel={sidebarT("errors.sectionSidebar")}
        compact
      />
    ),
    [sidebarT],
  );

  // Mobile: full-screen overlay with gesture.
  // On web, keep it interactive only while open so closed sidebars don't eat taps.
  let overlayPointerEvents: "auto" | "none" | "box-none";
  if (!isWeb) overlayPointerEvents = "box-none";
  else if (isOpen) overlayPointerEvents = "auto";
  else overlayPointerEvents = "none";

  // Navigation stacks can keep previous screens mounted; hide sidebars for unfocused
  // screens so only the active screen exposes explorer/terminal surfaces.
  if (!isScreenFocused) {
    return null;
  }

  if (isMobile) {
    return (
      <View style={StyleSheet.absoluteFillObject} pointerEvents={overlayPointerEvents}>
        {/* Backdrop */}
        <Animated.View style={backdropCombinedStyle} />

        <GestureDetector gesture={closeGesture} touchAction="pan-y">
          <Animated.View style={mobileSidebarStyle} pointerEvents="auto">
            <View style={styles.mobileSidebarBackground} pointerEvents="none" />
            <SidebarContent
              activeTab={explorerTab}
              onTabPress={handleTabPress}
              onClose={handleHeaderClose}
              serverId={serverId}
              workspaceId={workspaceId}
              workspaceRoot={workspaceRoot}
              isGit={isGit}
              isMobile={isMobile}
              isOpen={isOpen}
              onOpenFile={onOpenFile}
            />
          </Animated.View>
        </GestureDetector>
      </View>
    );
  }

  return (
    <ErrorBoundary fallback={renderErrorFallback}>
      <Animated.View style={desktopSidebarStyle} pointerEvents={isOpen ? "auto" : "none"}>
        <View style={DESKTOP_SIDEBAR_SHADOW_STYLE}>
          <View style={DESKTOP_SIDEBAR_BORDER_STYLE}>
            {/* Resize handle - absolutely positioned over left border */}
            <GestureDetector gesture={resizeGesture}>
              <View style={RESIZE_HANDLE_STYLE} />
            </GestureDetector>

            <SidebarContent
              activeTab={explorerTab}
              onTabPress={handleTabPress}
              onClose={handleDesktopClose}
              serverId={serverId}
              workspaceId={workspaceId}
              workspaceRoot={workspaceRoot}
              isGit={isGit}
              isMobile={false}
              isOpen={isOpen}
              onOpenFile={onOpenFile}
            />
          </View>
        </View>
      </Animated.View>
    </ErrorBoundary>
  );
}

interface ExplorerTabButtonProps {
  tab: ExplorerTab;
  active: boolean;
  isMobile: boolean;
  label?: string;
  onTabPress: (tab: ExplorerTab) => void;
  testID: string;
  children?: React.ReactNode;
}

function ExplorerTabButton({
  tab,
  active,
  isMobile,
  label,
  onTabPress,
  testID,
  children,
}: ExplorerTabButtonProps) {
  const handlePress = useCallback(() => onTabPress(tab), [onTabPress, tab]);
  const tabStyle = useMemo(
    () => [
      styles.tab,
      !isMobile && styles.desktopTab,
      active && (isMobile ? styles.tabActive : styles.desktopTabActive),
    ],
    [active, isMobile],
  );
  const tabTextStyle = useMemo(
    () => [
      styles.tabText,
      !isMobile && styles.desktopTabText,
      active && (isMobile ? styles.tabTextActive : styles.desktopTabTextActive),
    ],
    [active, isMobile],
  );
  return (
    <Pressable testID={testID} style={tabStyle} onPress={handlePress}>
      {children}
      {label !== undefined ? <Text style={tabTextStyle}>{label}</Text> : null}
    </Pressable>
  );
}

interface SidebarContentProps {
  activeTab: ExplorerTab;
  onTabPress: (tab: ExplorerTab) => void;
  onClose: () => void;
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
  isGit: boolean;
  isMobile: boolean;
  isOpen: boolean;
  onOpenFile?: (filePath: string) => void;
}

function ExplorerSidebarTabs({
  isGit,
  isMobile,
  hasPullRequest,
  resolvedTab,
  prTabLabel,
  onTabPress,
}: {
  isGit: boolean;
  isMobile: boolean;
  hasPullRequest: boolean;
  resolvedTab: ExplorerTab;
  prTabLabel: string;
  onTabPress: (tab: ExplorerTab) => void;
}) {
  const { t } = useTranslation();
  const tabsContainerStyle = useMemo(
    () => [styles.tabsContainer, !isMobile && styles.desktopTabsContainer],
    [isMobile],
  );

  return (
    <View style={tabsContainerStyle}>
      {isGit && (
        <ExplorerTabButton
          tab="changes"
          active={resolvedTab === "changes"}
          isMobile={isMobile}
          label={t("git.changes")}
          onTabPress={onTabPress}
          testID="explorer-tab-changes"
        />
      )}
      <ExplorerTabButton
        tab="files"
        active={resolvedTab === "files"}
        isMobile={isMobile}
        label={t("git.files")}
        onTabPress={onTabPress}
        testID="explorer-tab-files"
      />
      {isGit && hasPullRequest && (
        <ExplorerTabButton
          tab="pr"
          active={resolvedTab === "pr"}
          isMobile={isMobile}
          label={prTabLabel}
          onTabPress={onTabPress}
          testID="explorer-tab-pr"
        >
          <ThemedGitHubIcon
            size={13}
            uniProps={resolvedTab === "pr" ? foregroundColorMapping : foregroundMutedColorMapping}
          />
        </ExplorerTabButton>
      )}
    </View>
  );
}

function SidebarContent({
  activeTab,
  onTabPress,
  onClose,
  serverId,
  workspaceId,
  workspaceRoot,
  isGit,
  isMobile,
  isOpen,
  onOpenFile,
}: SidebarContentProps) {
  const { t } = useTranslation();
  const padding = useWindowControlsPadding("explorerSidebar");
  const canQueryPullRequest = isGit && Boolean(workspaceRoot);
  const prPane = usePrPaneData({
    serverId,
    cwd: workspaceRoot,
    enabled: canQueryPullRequest && isOpen,
    timelineEnabled: activeTab === "pr" && canQueryPullRequest && isOpen,
  });
  const hasPullRequest = prPane.prNumber !== null;
  const requestedTab: ExplorerTab =
    !isGit && (activeTab === "changes" || activeTab === "pr") ? "files" : activeTab;
  const resolvedTab: ExplorerTab =
    requestedTab === "pr" && !hasPullRequest ? "changes" : requestedTab;
  const prTabLabel = prPane.prNumber === null ? "" : `#${prPane.prNumber}`;

  const headerStyle = useMemo(
    () => [
      styles.header,
      !isMobile && styles.desktopHeader,
      {
        marginTop: SPACING[2],
        paddingRight: padding.right,
      },
    ],
    [isMobile, padding.right],
  );
  const closeButtonStyle = useMemo(
    () => [styles.closeButton, !isMobile && styles.desktopCloseButton],
    [isMobile],
  );
  const contentAreaStyle = useMemo(
    () => [styles.contentArea, !isMobile && styles.desktopContentArea],
    [isMobile],
  );

  return (
    <View style={styles.sidebarContent} pointerEvents="auto">
      {/* Header with tabs and close button */}
      <View style={headerStyle} testID="explorer-header">
        <TitlebarDragRegion />
        <ExplorerSidebarTabs
          isGit={isGit}
          isMobile={isMobile}
          hasPullRequest={hasPullRequest}
          resolvedTab={resolvedTab}
          prTabLabel={prTabLabel}
          onTabPress={onTabPress}
        />
        <View style={styles.headerRightSection}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isMobile
                ? t("workspace.screen.closeExplorer")
                : t("workspace.screen.collapseExplorer")
            }
            onPress={onClose}
            style={closeButtonStyle}
          >
            <ThemedX size={isMobile ? 18 : 16} uniProps={foregroundMutedColorMapping} />
          </Pressable>
        </View>
      </View>

      {/* Content based on active tab */}
      <View style={contentAreaStyle} testID="explorer-content-area">
        {resolvedTab === "changes" && (
          <GitDiffPane
            serverId={serverId}
            workspaceId={workspaceId}
            cwd={workspaceRoot}
            hideHeaderRow={!isMobile}
            enabled={isOpen}
          />
        )}
        {resolvedTab === "files" && (
          <FileExplorerPane
            serverId={serverId}
            workspaceId={workspaceId}
            workspaceRoot={workspaceRoot}
            onOpenFile={onOpenFile}
          />
        )}
        {resolvedTab === "pr" && prPane.data && (
          <PrPane data={prPane.data} onRefresh={prPane.refetch} />
        )}
      </View>
    </View>
  );
}

// Static styles for Animated.Views — must NOT use Unistyles dynamic theme to
// avoid the "Unable to find node on an unmounted component" crash when Unistyles
// tries to patch the native node that Reanimated also manages.
const explorerStaticStyles = RNStyleSheet.create({
  backdrop: {
    ...RNStyleSheet.absoluteFill,
    backgroundColor: "rgba(20, 23, 31, 0.28)",
  },
  mobileSidebar: {
    position: "absolute" as const,
    top: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden" as const,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  desktopSidebar: {
    position: "absolute" as const,
    // top is set dynamically below Soft topbar (48 + inset).
    right: 0,
    bottom: 0,
    zIndex: 20,
    paddingRight: WORKBENCH_ENVIRONMENT_PANEL_INSET,
    paddingBottom: WORKBENCH_ENVIRONMENT_PANEL_INSET,
  },
});

const styles = StyleSheet.create((theme) => ({
  // Soft floating inspector: r14 card family + Soft --shadow-soft elevation.
  // Keep shadow off overflow:hidden so Electron/web boxShadow is not clipped.
  desktopSidebarBorder: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surfaceSidebar,
    overflow: "hidden",
  },
  desktopSidebarShadow: {
    flex: 1,
    borderRadius: 14,
    ...(isWeb ? ({ boxShadow: WORKBENCH_ENVIRONMENT_PANEL_SHADOW } as object) : theme.shadow.md),
  },
  resizeHandle: {
    position: "absolute",
    left: -5,
    top: 0,
    bottom: 0,
    width: 10,
    zIndex: 10,
  },
  sidebarContent: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  mobileSidebarBackground: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  // Soft nav header: sit on --nav, no grey island wash.
  header: {
    position: "relative",
    height: HEADER_INNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[2],
    marginHorizontal: theme.spacing[2],
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[1],
    // Soft quiet chrome: no heavy island radius.
    borderRadius: 10,
    backgroundColor: "transparent",
  },
  desktopHeader: {
    backgroundColor: "transparent",
    paddingLeft: theme.spacing[2],
  },
  tabsContainer: {
    flexDirection: "row",
    gap: theme.spacing[1],
    minWidth: 0,
    flexShrink: 1,
  },
  desktopTabsContainer: {
    gap: 0,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: 10,
  },
  desktopTab: {
    minHeight: 30,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: 10,
    gap: theme.spacing[1],
  },
  tabActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  desktopTabActive: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  tabText: {
    // Soft explorer chrome label: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  desktopTabText: {
    fontSize: 12.5,
    lineHeight: 16,
  },
  tabTextActive: {
    color: theme.colors.foreground,
  },
  desktopTabTextActive: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  tabTextMuted: {
    opacity: 0.8,
  },
  headerRightSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  closeButton: {
    padding: theme.spacing[2],
    borderRadius: 10,
  },
  desktopCloseButton: {
    width: 26,
    height: 26,
    padding: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  contentArea: {
    flex: 1,
    minHeight: 0,
  },
  desktopContentArea: {
    backgroundColor: theme.colors.surfaceSidebar,
  },
}));

const DESKTOP_SIDEBAR_SHADOW_STYLE = styles.desktopSidebarShadow;
const DESKTOP_SIDEBAR_BORDER_STYLE = [styles.desktopSidebarBorder, { flex: 1 }];
const RESIZE_HANDLE_STYLE = [styles.resizeHandle, isWeb && ({ cursor: "col-resize" } as object)];
