import { router, usePathname, type Href } from "expo-router";
import {
  FolderOpen,
  GitCompare,
  House,
  ListFilter,
  MessageSquareText,
  MessagesSquare,
  PanelLeftClose,
  Search,
  Settings,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react-native";
import {
  type Dispatch,
  memo,
  type ReactElement,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Pressable,
  StyleSheet as RNStyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  createAnimatedComponent,
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { ThemedIconHost } from "@/components/themed-icon-host";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { useTranslation } from "react-i18next";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { GlassSurface } from "@/components/ui/glass-surface";
import {
  useIsCompactFormFactor,
  DESKTOP_SIDEBAR_GAP,
  MIN_CHAT_WIDTH,
  SIDEBAR_FOOTER_HEIGHT,
} from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useSidebarAnimation } from "@/contexts/sidebar-animation-context";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { useSuppressedArchiveAgentIds } from "@/hooks/use-archive-agent";
import { useOpenProjectPicker } from "@/hooks/use-open-project-picker";
import { useSessionStore } from "@/stores/session-store";
import { useResolveWorkspaceIdByCwd, useWorkspaceFields } from "@/stores/session-store-hooks";
import { useHostRuntimeSnapshot, useHosts } from "@/runtime/host-runtime";
import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  selectIsAgentListOpen,
  usePanelStore,
} from "@/stores/panel-store";
import { resolveActiveHost } from "@/utils/active-host";
import { formatConnectionStatus } from "@/utils/daemons";
import {
  buildMobileSidebarQuickActionButtons,
  buildMobileSidebarQuickActionModel,
  resolveMobileSidebarQuickActionAgentLabel,
  resolveMobileSidebarQuickActionAgentTarget,
  selectMobileSidebarQuickActionAgent,
  type MobileSidebarQuickActionButtonModel,
  type MobileSidebarQuickActionId,
} from "@/utils/mobile-sidebar-quick-actions";
import {
  getDesktopSidebarResizeState,
  getMobileSidebarWidth,
} from "@/utils/sidebar-animation-state";
import { resolveSidebarViewSwitcherLayout } from "@/utils/sidebar-view-switcher-layout";
import {
  buildHostSessionsRoute,
  buildSettingsRoute,
  mapPathnameToServer,
} from "@/utils/host-routes";
import {
  resolveLeftSidebarHomeRoute,
  resolveLeftSidebarNewConversationRoute,
} from "@/utils/left-sidebar-drafts";
import { useLastDraftDirectory } from "@/stores/last-draft-directory-store";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { buildSidebarLiveAgents, mergeSidebarSessionSources } from "@/utils/sidebar-session-source";
import { useSidebarOrderStore, type SidebarViewMode } from "@/stores/sidebar-order-store";
import { useSidebarV2Store } from "@/sidebar-v2/store";
import { SidebarAgentListSkeleton } from "./sidebar-agent-list-skeleton";
import { SidebarSessionList } from "./sidebar-session-list";

const DESKTOP_SIDEBAR_ANIMATION_CONFIG = {
  duration: 180,
  easing: Easing.out(Easing.cubic),
};
const AnimatedPressable = createAnimatedComponent(Pressable);

interface LeftSidebarProps {
  selectedAgentId?: string;
}

interface SidebarSharedProps {
  activeServerId: string | null;
  activeHostLabel: string;
  activeHostStatus: "online" | "connecting" | "error" | "idle";
  hostOptions: ComboboxOption[];
  hostTriggerRef: RefObject<View | null>;
  isHostPickerOpen: boolean;
  setIsHostPickerOpen: Dispatch<SetStateAction<boolean>>;
  agents: ReturnType<typeof useAgentHistory>["agents"];
  selectedAgentId?: string;
  isInitialLoad: boolean;
  isRevalidating: boolean;
  isLoadingMore: boolean;
  isManualRefresh: boolean;
  hasMore: boolean;
  handleRefresh: () => void;
  handleLoadMore: () => void;
  handleHostSelect: (nextServerId: string) => void;
  handleOpenProject: () => void;
  handleHome: () => void;
  handleSearch: () => void;
  handleSettings: () => void;
  sidebarViewMode: SidebarViewMode;
  setSidebarViewMode: (mode: SidebarViewMode) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;
  renderHostOption: (input: {
    option: ComboboxOption;
    selected: boolean;
    active: boolean;
    onPress: () => void;
  }) => ReactElement;
}

interface MobileSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  insetsBottom: number;
  isOpen: boolean;
  closeToAgent: () => void;
  handleViewMoreNavigate: () => void;
}

interface DesktopSidebarProps extends SidebarSharedProps {
  insetsTop: number;
  isOpen: boolean;
}

export const LeftSidebar = memo(function LeftSidebar({ selectedAgentId }: LeftSidebarProps) {
  const insets = useSafeAreaInsets();
  const isCompactLayout = useIsCompactFormFactor();
  const isOpen = usePanelStore((state) =>
    selectIsAgentListOpen(state, { isCompact: isCompactLayout }),
  );
  const showMobileAgent = usePanelStore((state) => state.showMobileAgent);
  const pathname = usePathname();
  const daemons = useHosts();
  const activeDaemon = useMemo(
    () => resolveActiveHost({ hosts: daemons, pathname }),
    [daemons, pathname],
  );
  const activeServerId = activeDaemon?.serverId ?? null;
  const activeHostLabel = useMemo(() => {
    if (!activeDaemon) return "No host";
    const trimmed = activeDaemon.label?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : activeDaemon.serverId;
  }, [activeDaemon]);
  const activeHostSnapshot = useHostRuntimeSnapshot(activeServerId ?? "");
  const activeHostStatus = activeServerId
    ? (activeHostSnapshot?.connectionStatus ?? "connecting")
    : "idle";
  const suppressedArchiveAgentIds = useSuppressedArchiveAgentIds(activeServerId ?? "");
  let resolvedHostStatus: "online" | "connecting" | "error" | "idle";
  if (activeHostStatus === "online") resolvedHostStatus = "online";
  else if (activeHostStatus === "connecting") resolvedHostStatus = "connecting";
  else if (activeHostStatus === "idle") resolvedHostStatus = "idle";
  else resolvedHostStatus = "error";
  const hostOptions = useMemo(
    () =>
      daemons.map((daemon) => ({
        id: daemon.serverId,
        label: daemon.label?.trim() || daemon.serverId,
      })),
    [daemons],
  );
  const renderHostOption = useCallback(
    ({
      option,
      selected,
      active,
      onPress,
    }: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }) => (
      <HostSwitchOption
        serverId={option.id}
        label={option.label}
        selected={selected}
        active={active}
        onPress={onPress}
      />
    ),
    [],
  );
  const hostTriggerRef = useRef<View | null>(null);
  const [isHostPickerOpen, setIsHostPickerOpen] = useState(false);

  const {
    agents: historyAgents,
    isInitialLoad: isHistoryInitialLoad,
    isRevalidating,
    isLoadingMore,
    hasMore,
    refreshAll,
    loadMore,
  } = useAgentHistory({
    serverId: activeServerId,
    enabled: isCompactLayout || isOpen,
    // Soft sidebar hides archived rows; keep hasMore aligned with what is listed.
    includeArchived: false,
  });
  const liveSessionAgents = useSessionStore((state) =>
    activeServerId ? state.sessions[activeServerId]?.agents : undefined,
  );
  const liveAgents = useMemo(
    () =>
      buildSidebarLiveAgents({
        agents: liveSessionAgents,
        serverId: activeServerId,
        serverLabel: activeHostLabel,
      }),
    [activeHostLabel, activeServerId, liveSessionAgents],
  );
  const suppressedAgentIds = useMemo(() => {
    const next = new Set<string>(suppressedArchiveAgentIds);
    if (liveSessionAgents) {
      for (const agent of liveSessionAgents.values()) {
        if (agent.archivedAt) {
          next.add(agent.id);
        }
      }
    }
    return next;
  }, [liveSessionAgents, suppressedArchiveAgentIds]);
  const sidebarSessionSource = useMemo(
    () =>
      mergeSidebarSessionSources({
        liveAgents,
        historyAgents,
        suppressedAgentIds,
        selectedAgentId,
      }),
    [historyAgents, liveAgents, selectedAgentId, suppressedAgentIds],
  );
  const agents = sidebarSessionSource.agents;
  const resolvedSelectedAgentId = sidebarSessionSource.selectedAgentId;
  const isInitialLoad = isHistoryInitialLoad && agents.length === 0;
  const [isManualRefresh, setIsManualRefresh] = useState(false);

  const handleRefresh = useCallback(() => {
    setIsManualRefresh(true);
    refreshAll();
  }, [refreshAll]);

  const handleLoadMore = useCallback(() => {
    loadMore();
  }, [loadMore]);

  useEffect(() => {
    if (!isRevalidating && isManualRefresh) {
      setIsManualRefresh(false);
    }
  }, [isRevalidating, isManualRefresh]);

  const openProjectPicker = useOpenProjectPicker(activeServerId);
  const lastDraftDirectory = useLastDraftDirectory(activeServerId);

  const openNewConversationStart = useCallback(() => {
    const draftRoute = resolveLeftSidebarNewConversationRoute({
      activeServerId,
      pathname,
      lastDraftDirectory,
    });
    if (!draftRoute) {
      return false;
    }
    router.push(draftRoute);
    return true;
  }, [activeServerId, lastDraftDirectory, pathname]);

  const handleOpenProjectMobile = useCallback(() => {
    showMobileAgent();
    if (openNewConversationStart()) {
      return;
    }
    void openProjectPicker();
  }, [openNewConversationStart, openProjectPicker, showMobileAgent]);

  const handleOpenProjectDesktop = useCallback(() => {
    if (openNewConversationStart()) {
      return;
    }
    void openProjectPicker();
  }, [openNewConversationStart, openProjectPicker]);

  const sidebarViewMode = useSidebarOrderStore((state) => state.sidebarViewMode);
  const setSidebarViewMode = useSidebarOrderStore((state) => state.setSidebarViewMode);
  const searchQuery = useSidebarV2Store((state) => state.searchQuery);
  const setSearchQuery = useSidebarV2Store((state) => state.setSearchQuery);
  const clearSearch = useSidebarV2Store((state) => state.clearSearch);

  const handleSearch = useCallback(() => {
    // Desktop command center remains available as a power-user path; the
    // in-sidebar search box is the primary filter for the session list.
    void import("@/desktop/electron/command-center-window-controls").then(({ openCommandCenter }) =>
      openCommandCenter(),
    );
  }, []);

  const handleSettingsMobile = useCallback(() => {
    showMobileAgent();
    router.push(buildSettingsRoute({ returnTo: pathname }) as Href);
  }, [pathname, showMobileAgent]);

  const handleSettingsDesktop = useCallback(() => {
    router.push(buildSettingsRoute({ returnTo: pathname }) as Href);
  }, [pathname]);

  const handleHomeMobile = useCallback(() => {
    const homeRoute = resolveLeftSidebarHomeRoute(activeServerId);
    if (!homeRoute) {
      return;
    }
    showMobileAgent();
    router.push(homeRoute);
  }, [activeServerId, showMobileAgent]);

  const handleHomeDesktop = useCallback(() => {
    const homeRoute = resolveLeftSidebarHomeRoute(activeServerId);
    if (!homeRoute) {
      return;
    }
    router.push(homeRoute);
  }, [activeServerId]);

  const handleViewMoreNavigate = useCallback(() => {
    if (!activeServerId) {
      return;
    }
    router.push(buildHostSessionsRoute(activeServerId));
  }, [activeServerId]);

  const handleHostSelect = useCallback(
    (nextServerId: string) => {
      if (!nextServerId) {
        return;
      }
      const nextPath = mapPathnameToServer(pathname, nextServerId);
      setIsHostPickerOpen(false);
      router.push(nextPath);
    },
    [pathname],
  );

  const sharedProps = {
    activeServerId,
    activeHostLabel,
    activeHostStatus: resolvedHostStatus,
    hostOptions,
    hostTriggerRef,
    isHostPickerOpen,
    setIsHostPickerOpen,
    agents,
    selectedAgentId: resolvedSelectedAgentId,
    isInitialLoad,
    isRevalidating,
    isLoadingMore,
    isManualRefresh,
    hasMore,
    handleRefresh,
    handleLoadMore,
    handleHostSelect,
    renderHostOption,
    handleSearch,
    sidebarViewMode,
    setSidebarViewMode,
    searchQuery,
    setSearchQuery,
    clearSearch,
  };

  if (isCompactLayout) {
    return (
      <MobileSidebar
        {...sharedProps}
        insetsTop={insets.top}
        insetsBottom={insets.bottom}
        isOpen={isOpen}
        closeToAgent={showMobileAgent}
        handleOpenProject={handleOpenProjectMobile}
        handleHome={handleHomeMobile}
        handleSettings={handleSettingsMobile}
        handleViewMoreNavigate={handleViewMoreNavigate}
      />
    );
  }

  return (
    <DesktopSidebar
      {...sharedProps}
      insetsTop={insets.top}
      isOpen={isOpen}
      handleOpenProject={handleOpenProjectDesktop}
      handleHome={handleHomeDesktop}
      handleSettings={handleSettingsDesktop}
    />
  );
});

interface HostPickerTriggerProps {
  triggerRef: React.Ref<View>;
  setIsHostPickerOpen: Dispatch<SetStateAction<boolean>>;
  hostOptionsEmpty: boolean;
  hostStatusDotStyle: StyleProp<ViewStyle>;
  activeHostLabel: string;
  variant?: "mobile" | "desktop";
}

function HostPickerTrigger({
  triggerRef,
  setIsHostPickerOpen,
  hostOptionsEmpty,
  hostStatusDotStyle,
  activeHostLabel,
  variant = "mobile",
}: HostPickerTriggerProps) {
  const pressableStyle = useCallback(
    ({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.hostTrigger,
      variant === "desktop" && styles.desktopHostTrigger,
      hovered && styles.hostTriggerHovered,
    ],
    [variant],
  );
  const handlePress = useCallback(() => setIsHostPickerOpen(true), [setIsHostPickerOpen]);
  return (
    <Pressable
      ref={triggerRef}
      style={pressableStyle}
      onPress={handlePress}
      disabled={hostOptionsEmpty}
    >
      <View style={hostStatusDotStyle} />
      <Text style={styles.hostTriggerText} numberOfLines={1}>
        {activeHostLabel}
      </Text>
    </Pressable>
  );
}

function HostSwitchOption({
  serverId,
  label,
  selected,
  active,
  onPress,
}: {
  serverId: string;
  label: string;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const snapshot = useHostRuntimeSnapshot(serverId);
  const connectionStatus = snapshot?.connectionStatus ?? "connecting";

  return (
    <ComboboxItem
      label={label}
      description={formatConnectionStatus(connectionStatus, t)}
      selected={selected}
      active={active}
      onPress={onPress}
    />
  );
}

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function footerIconColorMapping(hovered: boolean) {
  if (hovered) return foregroundColorMapping;
  return foregroundMutedColorMapping;
}

function FooterIconButton({
  onPress,
  testID,
  accessibilityLabel,
  icon: Icon,
  variant = "mobile",
}: {
  onPress: () => void;
  testID: string;
  accessibilityLabel: string;
  icon: LucideIcon;
  variant?: "mobile" | "desktop";
}) {
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.footerIconButton,
      variant === "desktop" && styles.desktopFooterIconButton,
      (hovered || pressed) && styles.footerIconButtonHovered,
    ],
    [variant],
  );
  return (
    <Pressable
      style={buttonStyle}
      testID={testID}
      nativeID={testID}
      collapsable={false}
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
    >
      {({ hovered }) => (
        <ThemedIconHost
          Icon={Icon}
          size={ICON_SIZE.md}
          uniProps={footerIconColorMapping(Boolean(hovered))}
        />
      )}
    </Pressable>
  );
}

function SidebarTopActions({
  onCloseSidebar,
  onNewConversation,
  onSearch,
  sidebarViewMode,
  setSidebarViewMode,
  searchQuery,
  setSearchQuery,
  clearSearch,
  variant = "mobile",
  railWidth,
}: {
  onCloseSidebar: () => void;
  onNewConversation: () => void;
  onSearch: () => void;
  sidebarViewMode: SidebarViewMode;
  setSidebarViewMode: (mode: SidebarViewMode) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  clearSearch: () => void;
  variant?: "mobile" | "desktop";
  /** Painted rail width used for switcher density (minWidth + abbreviate). */
  railWidth: number;
}) {
  const { t } = useTranslation();
  // Desktop open rail: shell control is fixed over the empty left of the top row only.
  // Do NOT left-pad the whole top area — that shortens the full-width「新对话」CTA.
  const topAreaStyle = useMemo(
    () => [styles.sidebarTopArea, variant === "desktop" && styles.desktopSidebarTopArea],
    [variant],
  );
  const primaryActionsStyle = useMemo(
    () => [
      styles.sidebarPrimaryActions,
      variant === "desktop" && styles.desktopSidebarPrimaryActions,
    ],
    [variant],
  );
  // Switcher sits on its own row under search — full rail width minus padding.
  const switcherLayout = useMemo(
    () =>
      resolveSidebarViewSwitcherLayout({
        sidebarWidth: railWidth,
        placement: "full-width",
        variant,
      }),
    [railWidth, variant],
  );
  const viewSwitcherStyle = useMemo(
    () => [styles.viewSwitcher, { minWidth: switcherLayout.switcherMinWidth }],
    [switcherLayout.switcherMinWidth],
  );
  const handleSelectByProject = useCallback(
    () => setSidebarViewMode("by-project"),
    [setSidebarViewMode],
  );
  const handleSelectByStatus = useCallback(
    () => setSidebarViewMode("by-status"),
    [setSidebarViewMode],
  );
  const byProjectSelected = sidebarViewMode === "by-project";
  const byStatusSelected = sidebarViewMode === "by-status";
  // Sliding highlight under the active 项目/状态 tab. Plain View (not
  // Animated) so Unistyles theme colors are safe; web eases the transform
  // via RNW CSS transitions, native swaps the transform statically.
  const thumbStyle = useMemo(() => {
    if (!isWeb) {
      return [styles.viewTabThumb, byStatusSelected ? styles.viewTabThumbShiftedNative : null];
    }
    return [
      styles.viewTabThumb,
      {
        transform: [{ translateX: byStatusSelected ? "100%" : "0%" }],
        transitionProperty: "transform",
        transitionDuration: "180ms",
        transitionTimingFunction: "cubic-bezier(0.33, 1, 0.68, 1)",
      } as object,
    ];
  }, [byStatusSelected]);
  const byProjectAccessibilityState = useMemo(
    () => ({ selected: byProjectSelected }),
    [byProjectSelected],
  );
  const byStatusAccessibilityState = useMemo(
    () => ({ selected: byStatusSelected }),
    [byStatusSelected],
  );
  const byProjectTabStyle = useMemo(
    () => [
      styles.viewTab,
      switcherLayout.density === "icon" && styles.viewTabIconOnly,
      byProjectSelected && styles.viewTabActive,
    ],
    [byProjectSelected, switcherLayout.density],
  );
  const byStatusTabStyle = useMemo(
    () => [
      styles.viewTab,
      switcherLayout.density === "icon" && styles.viewTabIconOnly,
      byStatusSelected && styles.viewTabActive,
    ],
    [byStatusSelected, switcherLayout.density],
  );
  const byProjectTextStyle = useMemo(
    () => [styles.viewTabText, byProjectSelected && styles.viewTabTextActive],
    [byProjectSelected],
  );
  const byStatusTextStyle = useMemo(
    () => [styles.viewTabText, byStatusSelected && styles.viewTabTextActive],
    [byStatusSelected],
  );
  const byProjectIconColor = byProjectSelected
    ? foregroundColorMapping
    : foregroundMutedColorMapping;
  const byStatusIconColor = byStatusSelected ? foregroundColorMapping : foregroundMutedColorMapping;
  const byProjectLabel = switcherLayout.useShortLabels
    ? t("sidebar.byProjectShort")
    : t("sidebar.byProject");
  const byStatusLabel = switcherLayout.useShortLabels
    ? t("sidebar.byStatusShort")
    : t("sidebar.byStatus");
  // Full names stay on accessibility even when the chrome is short/icon-only.
  const byProjectA11yLabel = t("sidebar.byProject");
  const byStatusA11yLabel = t("sidebar.byStatus");

  // Desktop: shell DesktopSidebarControl owns open/close (T3 SidebarTrigger).
  // Keep the close tile only on compact so the mobile drawer can still dismiss.
  // Order: top chrome (shell + search icon) → 新对话 → 搜索会话 → 项目/状态.
  return (
    <View style={topAreaStyle}>
      <View style={styles.sidebarTopActions}>
        {/* Empty left clearance under the fixed shell control (top row only). */}
        {variant === "desktop" ? <View style={styles.desktopSidebarControlSpacer} /> : null}
        <View style={styles.sidebarTopHeadingSpacer} />
        <View style={styles.sidebarTopIconCluster}>
          <SidebarTopAction
            icon={Search}
            label={t("common.search")}
            onPress={onSearch}
            testID="sidebar-search"
          />
          {variant === "desktop" ? null : (
            <SidebarTopAction
              icon={PanelLeftClose}
              label={t("sidebar.closeSidebar")}
              onPress={onCloseSidebar}
              testID="sidebar-close"
            />
          )}
        </View>
      </View>
      <View style={primaryActionsStyle}>
        <SidebarPrimaryAction
          label={t("sidebar.newConversation")}
          onPress={onNewConversation}
          testID="sidebar-new-conversation"
        />
      </View>
      <View style={styles.searchRow} testID="sidebar-search-row">
        <ThemedIconHost Icon={Search} size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t("sidebar.searchSessions")}
          style={styles.searchInput}
          placeholderTextColor={undefined}
          accessibilityRole="search"
          testID="sidebar-search-input"
        />
        {searchQuery.length > 0 ? (
          <Pressable onPress={clearSearch} hitSlop={8} testID="sidebar-search-clear">
            <Text style={styles.searchClear}>×</Text>
          </Pressable>
        ) : null}
      </View>
      <View
        style={viewSwitcherStyle}
        testID="sidebar-view-switcher"
        nativeID={`sidebar-view-switcher-${switcherLayout.density}`}
      >
        <View style={thumbStyle} pointerEvents="none" />
        <View testID="sidebar-v2-scope-trigger" collapsable={false} style={styles.scopeTriggerShim}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={byProjectA11yLabel}
            accessibilityState={byProjectAccessibilityState}
            onPress={handleSelectByProject}
            style={byProjectTabStyle}
            testID="sidebar-view-by-project"
          >
            {switcherLayout.showIcons ? (
              <ThemedIconHost Icon={FolderOpen} size={ICON_SIZE.xs} uniProps={byProjectIconColor} />
            ) : null}
            {switcherLayout.showLabels ? (
              <Text style={byProjectTextStyle} numberOfLines={1} ellipsizeMode="clip">
                {byProjectLabel}
              </Text>
            ) : null}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={byStatusA11yLabel}
            accessibilityState={byStatusAccessibilityState}
            onPress={handleSelectByStatus}
            style={byStatusTabStyle}
            testID="sidebar-view-by-status"
          >
            {switcherLayout.showIcons ? (
              <ThemedIconHost Icon={ListFilter} size={ICON_SIZE.xs} uniProps={byStatusIconColor} />
            ) : null}
            {switcherLayout.showLabels ? (
              <Text style={byStatusTextStyle} numberOfLines={1} ellipsizeMode="clip">
                {byStatusLabel}
              </Text>
            ) : null}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function SidebarTopAction({
  icon: Icon,
  label,
  onPress,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const actionStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.sidebarTopAction,
      (Boolean(hovered) || pressed) && styles.sidebarTopActionHovered,
    ],
    [],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={actionStyle}
      testID={testID}
    >
      {({ hovered, pressed }) => (
        <View style={styles.sidebarTopActionIconSlot}>
          <ThemedIconHost
            Icon={Icon}
            size={ICON_SIZE.sm}
            uniProps={footerIconColorMapping(Boolean(hovered) || Boolean(pressed))}
          />
        </View>
      )}
    </Pressable>
  );
}

function SidebarPrimaryAction({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const actionStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.sidebarPrimaryAction,
      (Boolean(hovered) || pressed) && styles.sidebarPrimaryActionHovered,
    ],
    [],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={actionStyle}
      testID={testID}
    >
      {/* Dual testids: production new-conversation + legacy SidebarV2 e2e hydration gate. */}
      <View testID="sidebar-v2-new-project" collapsable={false}>
        <Text style={styles.sidebarPrimaryActionText} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function SidebarFooter({
  activeServerId,
  activeHostLabel,
  hostStatusDotStyle,
  hostOptions,
  hostTriggerRef,
  isHostPickerOpen,
  setIsHostPickerOpen,
  handleHostSelect,
  renderHostOption,
  handleHome,
  handleOpenProject,
  handleSettings,
  variant = "mobile",
}: {
  activeServerId: string | null;
  activeHostLabel: string;
  hostStatusDotStyle: StyleProp<ViewStyle>;
  hostOptions: ComboboxOption[];
  hostTriggerRef: RefObject<View | null>;
  isHostPickerOpen: boolean;
  setIsHostPickerOpen: Dispatch<SetStateAction<boolean>>;
  handleHostSelect: (nextServerId: string) => void;
  renderHostOption: SidebarSharedProps["renderHostOption"];
  handleHome: () => void;
  handleOpenProject: () => void;
  handleSettings: () => void;
  variant?: "mobile" | "desktop";
}) {
  const { t } = useTranslation();
  const footerStyle = useMemo(
    () => [styles.sidebarFooter, variant === "desktop" && styles.desktopSidebarFooter],
    [variant],
  );
  const iconRowStyle = useMemo(
    () => [styles.footerIconRow, variant === "desktop" && styles.desktopFooterIconRow],
    [variant],
  );
  const hostSlotStyle = useMemo(
    () => [styles.footerHostSlot, variant === "desktop" && styles.desktopFooterHostSlot],
    [variant],
  );
  return (
    <View style={footerStyle}>
      <View style={hostSlotStyle}>
        <HostPickerTrigger
          triggerRef={hostTriggerRef}
          setIsHostPickerOpen={setIsHostPickerOpen}
          hostOptionsEmpty={hostOptions.length === 0}
          hostStatusDotStyle={hostStatusDotStyle}
          activeHostLabel={activeHostLabel}
          variant={variant}
        />
      </View>
      <View style={iconRowStyle}>
        <FooterIconButton
          onPress={handleOpenProject}
          testID="sidebar-open-project"
          accessibilityLabel={t("sidebar.addProject")}
          icon={FolderOpen}
          variant={variant}
        />
        <FooterIconButton
          onPress={handleHome}
          testID="sidebar-home"
          accessibilityLabel={t("sidebar.home")}
          icon={House}
          variant={variant}
        />
        <FooterIconButton
          onPress={handleSettings}
          testID="sidebar-settings"
          accessibilityLabel={t("sidebar.settings")}
          icon={Settings}
          variant={variant}
        />
      </View>
      <Combobox
        options={hostOptions}
        value={activeServerId ?? ""}
        onSelect={handleHostSelect}
        renderOption={renderHostOption}
        searchable={false}
        title={t("host.switchHost")}
        searchPlaceholder={t("sidebar.searchHosts")}
        desktopMinWidth={280}
        open={isHostPickerOpen}
        onOpenChange={setIsHostPickerOpen}
        anchorRef={hostTriggerRef}
      />
    </View>
  );
}

function MobileSidebarQuickActions({
  agent,
  buttons,
  onOpenAgent,
  onViewChanges,
  onOpenTerminal,
  onViewMore,
  onClose,
}: {
  agent: SidebarSharedProps["agents"][number] | null;
  buttons: MobileSidebarQuickActionButtonModel[];
  onOpenAgent: () => void;
  onViewChanges: () => void;
  onOpenTerminal: () => void;
  onViewMore: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!agent) {
    return null;
  }
  const agentLabel = resolveMobileSidebarQuickActionAgentLabel(agent);
  const actions = {
    resume: {
      icon: MessageSquareText,
      label: t("sidebar.resumeSession"),
      accessibilityLabel: t("sidebar.resumeSessionLabel", { title: agentLabel }),
      testID: "mobile-sidebar-quick-resume",
      onPress: onOpenAgent,
    },
    changes: {
      icon: GitCompare,
      label: t("sidebar.viewChanges"),
      accessibilityLabel: t("sidebar.viewChangesLabel", { title: agentLabel }),
      testID: "mobile-sidebar-quick-changes",
      onPress: onViewChanges,
    },
    terminal: {
      icon: SquareTerminal,
      label: t("sidebar.openTerminal"),
      accessibilityLabel: t("sidebar.openTerminalLabel", { title: agentLabel }),
      testID: "mobile-sidebar-quick-terminal",
      onPress: onOpenTerminal,
    },
    sessions: {
      icon: MessagesSquare,
      label: t("sidebar.sessions"),
      accessibilityLabel: t("sidebar.allSessionsLabel", { title: agentLabel }),
      testID: "mobile-sidebar-quick-sessions",
      onPress: onViewMore,
    },
    close: {
      icon: PanelLeftClose,
      label: t("sidebar.closeSidebar"),
      accessibilityLabel: t("sidebar.closeSidebar"),
      testID: "mobile-sidebar-quick-close",
      onPress: onClose,
    },
  } satisfies Record<
    MobileSidebarQuickActionId,
    {
      icon: LucideIcon;
      label: string;
      accessibilityLabel: string;
      testID: string;
      onPress: () => void;
    }
  >;

  return (
    <View style={styles.mobileQuickActions} testID="mobile-sidebar-quick-actions">
      <View style={styles.mobileQuickActionsTextGroup}>
        <Text style={styles.mobileQuickActionsLabel}>{t("sidebar.currentFocus")}</Text>
        <Text style={styles.mobileQuickActionsTitle} numberOfLines={1}>
          {agentLabel}
        </Text>
      </View>
      <View style={styles.mobileQuickActionsButtons}>
        {buttons.map((button) => {
          const action = actions[button.id];
          return (
            <MobileQuickActionButton
              key={button.id}
              icon={action.icon}
              label={action.label}
              accessibilityLabel={action.accessibilityLabel}
              testID={action.testID}
              variant={button.variant}
              onPress={action.onPress}
            />
          );
        })}
      </View>
    </View>
  );
}

function MobileQuickActionButton({
  icon: Icon,
  label,
  accessibilityLabel,
  testID,
  variant = "secondary",
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  accessibilityLabel?: string;
  testID: string;
  variant?: "primary" | "secondary";
  onPress: () => void;
}) {
  const resolveIconColorMapping = useCallback(
    (hovered?: boolean, pressed?: boolean) => {
      if (variant === "primary" || hovered || pressed) {
        return foregroundColorMapping;
      }
      return foregroundMutedColorMapping;
    },
    [variant],
  );
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.mobileQuickActionButton,
      variant === "primary" && styles.mobileQuickActionPrimaryButton,
      variant === "secondary" && styles.mobileQuickActionSecondaryButton,
      (hovered || pressed) && styles.mobileQuickActionButtonHovered,
    ],
    [variant],
  );
  const textStyle = useMemo(
    () => [
      styles.mobileQuickActionText,
      variant === "primary" && styles.mobileQuickActionPrimaryText,
    ],
    [variant],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={buttonStyle}
      testID={testID}
    >
      {({ hovered, pressed }) => (
        <>
          <View style={styles.mobileQuickActionIcon}>
            <ThemedIconHost
              Icon={Icon}
              size={ICON_SIZE.sm}
              uniProps={resolveIconColorMapping(hovered, pressed)}
            />
          </View>
          <Text style={textStyle} numberOfLines={1} ellipsizeMode="tail">
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

function MobileSidebar({
  activeServerId,
  activeHostLabel,
  activeHostStatus,
  hostOptions,
  hostTriggerRef,
  isHostPickerOpen,
  setIsHostPickerOpen,
  agents,
  selectedAgentId,
  isInitialLoad,
  isRevalidating,
  isLoadingMore,
  isManualRefresh,
  hasMore,
  handleRefresh,
  handleLoadMore,
  handleHostSelect,
  renderHostOption,
  handleOpenProject,
  handleHome,
  handleSearch,
  handleSettings,
  sidebarViewMode,
  setSidebarViewMode,
  searchQuery,
  setSearchQuery,
  clearSearch,
  insetsTop,
  insetsBottom,
  isOpen,
  closeToAgent,
  handleViewMoreNavigate,
}: MobileSidebarProps) {
  const { t } = useTranslation();
  const {
    translateX,
    backdropOpacity,
    windowWidth,
    animateToOpen,
    animateToClose,
    isGesturing,
    gestureAnimatingRef,
    closeGestureRef,
  } = useSidebarAnimation();
  const mobileSidebarWidth = useMemo(() => getMobileSidebarWidth(windowWidth), [windowWidth]);
  const closeTouchStartX = useSharedValue(0);
  const closeTouchStartY = useSharedValue(0);

  const handleCloseFromGesture = useCallback(() => {
    gestureAnimatingRef.current = true;
    closeToAgent();
  }, [closeToAgent, gestureAnimatingRef]);

  const handleViewMore = useCallback(() => {
    if (!activeServerId) {
      return;
    }
    translateX.value = -mobileSidebarWidth;
    backdropOpacity.value = 0;
    closeToAgent();
    handleViewMoreNavigate();
  }, [
    activeServerId,
    backdropOpacity,
    closeToAgent,
    handleViewMoreNavigate,
    translateX,
    mobileSidebarWidth,
  ]);

  const handleAgentPress = useCallback(() => {
    closeToAgent();
  }, [closeToAgent]);
  const quickActionAgent = useMemo(() => {
    return selectMobileSidebarQuickActionAgent(agents, selectedAgentId, activeServerId);
  }, [activeServerId, agents, selectedAgentId]);
  const quickActionAgentTarget = useMemo(
    () => resolveMobileSidebarQuickActionAgentTarget(quickActionAgent),
    [quickActionAgent],
  );
  const quickActionWorkspaceId = useResolveWorkspaceIdByCwd(
    quickActionAgentTarget?.serverId ?? activeServerId,
    quickActionAgent?.cwd,
  );
  const quickActionProjectKind = useWorkspaceFields(
    quickActionAgentTarget?.serverId ?? activeServerId,
    quickActionWorkspaceId,
    (workspace) => workspace.projectKind,
  );
  const quickActionModel = useMemo(
    () =>
      buildMobileSidebarQuickActionModel({
        serverId: quickActionAgentTarget?.serverId ?? activeServerId,
        workspaceId: quickActionWorkspaceId,
        projectKind: quickActionProjectKind,
      }),
    [
      activeServerId,
      quickActionAgentTarget?.serverId,
      quickActionProjectKind,
      quickActionWorkspaceId,
    ],
  );
  const handleOpenQuickAgent = useCallback(() => {
    if (!quickActionAgentTarget) {
      return;
    }
    translateX.value = -mobileSidebarWidth;
    backdropOpacity.value = 0;
    closeToAgent();
    navigateToAgent({
      serverId: quickActionAgentTarget.serverId,
      agentId: quickActionAgentTarget.agentId,
      pin: true,
    });
  }, [backdropOpacity, closeToAgent, mobileSidebarWidth, quickActionAgentTarget, translateX]);
  const handleOpenQuickRoute = useCallback(
    (route: string | null) => {
      if (!route) {
        return;
      }
      translateX.value = -mobileSidebarWidth;
      backdropOpacity.value = 0;
      closeToAgent();
      router.push(route as never);
    },
    [backdropOpacity, closeToAgent, mobileSidebarWidth, translateX],
  );
  const handleViewQuickChanges = useCallback(() => {
    handleOpenQuickRoute(quickActionModel.changesRoute);
  }, [handleOpenQuickRoute, quickActionModel.changesRoute]);
  const handleOpenQuickTerminal = useCallback(() => {
    handleOpenQuickRoute(quickActionModel.terminalRoute);
  }, [handleOpenQuickRoute, quickActionModel.terminalRoute]);
  const quickActionButtons = useMemo(
    () =>
      buildMobileSidebarQuickActionButtons({
        hasAgentTarget: quickActionAgentTarget !== null,
        changesRoute: quickActionModel.changesRoute,
        terminalRoute: quickActionModel.terminalRoute,
        canViewSessions: activeServerId !== null,
      }),
    [
      activeServerId,
      quickActionAgentTarget,
      quickActionModel.changesRoute,
      quickActionModel.terminalRoute,
    ],
  );

  const closeGesture = useMemo(
    () =>
      Gesture.Pan()
        .withRef(closeGestureRef)
        .enabled(isOpen)
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

          if (deltaX >= 10) {
            stateManager.fail();
            return;
          }
          if (absDeltaY > 10 && absDeltaY > absDeltaX) {
            stateManager.fail();
            return;
          }
          if (deltaX <= -15 && absDeltaX > absDeltaY) {
            stateManager.activate();
          }
        })
        .onStart(() => {
          isGesturing.value = true;
        })
        .onUpdate((event) => {
          const newTranslateX = Math.min(0, Math.max(-mobileSidebarWidth, event.translationX));
          translateX.value = newTranslateX;
          backdropOpacity.value = interpolate(
            newTranslateX,
            [-mobileSidebarWidth, 0],
            [0, 1],
            Extrapolation.CLAMP,
          );
        })
        .onEnd((event) => {
          isGesturing.value = false;
          const shouldClose =
            event.translationX < -mobileSidebarWidth / 3 || event.velocityX < -500;
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
      isOpen,
      closeGestureRef,
      closeTouchStartX,
      closeTouchStartY,
      isGesturing,
      mobileSidebarWidth,
      translateX,
      backdropOpacity,
      animateToClose,
      animateToOpen,
      handleCloseFromGesture,
    ],
  );

  const mobileSidebarInsetStyle = useMemo(
    () => ({
      width: mobileSidebarWidth,
      paddingTop: insetsTop,
      paddingBottom: insetsBottom,
    }),
    [mobileSidebarWidth, insetsTop, insetsBottom],
  );

  const hostStatusDotStyle = useMemo(() => {
    if (activeHostStatus === "online") return [styles.hostStatusDot, styles.hostStatusDotOnline];
    if (activeHostStatus === "connecting")
      return [styles.hostStatusDot, styles.hostStatusDotConnecting];
    if (activeHostStatus === "idle") return [styles.hostStatusDot, styles.hostStatusDotIdle];
    return [styles.hostStatusDot, styles.hostStatusDotError];
  }, [activeHostStatus]);

  const sidebarAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
    pointerEvents: backdropOpacity.value > 0.01 ? "auto" : "none",
  }));

  let overlayPointerEvents: "auto" | "none" | "box-none";
  if (!isWeb) overlayPointerEvents = "box-none";
  else if (isOpen) overlayPointerEvents = "auto";
  else overlayPointerEvents = "none";

  const backdropStyle = useMemo(
    () => [staticStyles.backdrop, backdropAnimatedStyle],
    [backdropAnimatedStyle],
  );
  // Soft .drawer: --nav surface, not workspace shell wash.
  const mobileSidebarStyle = useMemo(
    () => [
      staticStyles.mobileSidebar,
      styles.mobileSidebarSurface,
      mobileSidebarInsetStyle,
      sidebarAnimatedStyle,
    ],
    [mobileSidebarInsetStyle, sidebarAnimatedStyle],
  );
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents={overlayPointerEvents}>
      <AnimatedPressable
        accessible={isOpen}
        accessibilityRole="button"
        accessibilityLabel={t("sidebar.closeSidebar")}
        importantForAccessibility={isOpen ? "auto" : "no-hide-descendants"}
        onPress={closeToAgent}
        style={backdropStyle}
        testID="mobile-sidebar-backdrop"
      />

      <GestureDetector gesture={closeGesture} touchAction="pan-y">
        <Animated.View style={mobileSidebarStyle} pointerEvents="auto">
          <GlassSurface variant="chrome" style={styles.sidebarContent}>
            <SidebarTopActions
              onCloseSidebar={closeToAgent}
              onNewConversation={handleOpenProject}
              onSearch={handleSearch}
              sidebarViewMode={sidebarViewMode}
              setSidebarViewMode={setSidebarViewMode}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              clearSearch={clearSearch}
              railWidth={mobileSidebarWidth}
            />

            <MobileSidebarQuickActions
              agent={quickActionAgent}
              buttons={quickActionButtons}
              onOpenAgent={handleOpenQuickAgent}
              onViewChanges={handleViewQuickChanges}
              onOpenTerminal={handleOpenQuickTerminal}
              onViewMore={handleViewMore}
              onClose={closeToAgent}
            />

            {isInitialLoad ? (
              <SidebarAgentListSkeleton />
            ) : (
              <SidebarSessionList
                serverId={activeServerId}
                agents={agents}
                selectedAgentId={selectedAgentId}
                isRefreshing={isManualRefresh && isRevalidating}
                onRefresh={handleRefresh}
                hasMore={hasMore}
                isLoadingMore={isLoadingMore}
                onLoadMore={handleLoadMore}
                onAgentPress={handleAgentPress}
                onAddProject={handleOpenProject}
                viewMode={sidebarViewMode}
                searchQuery={searchQuery}
              />
            )}

            <SidebarFooter
              activeServerId={activeServerId}
              activeHostLabel={activeHostLabel}
              hostStatusDotStyle={hostStatusDotStyle}
              hostOptions={hostOptions}
              hostTriggerRef={hostTriggerRef}
              isHostPickerOpen={isHostPickerOpen}
              setIsHostPickerOpen={setIsHostPickerOpen}
              handleHostSelect={handleHostSelect}
              renderHostOption={renderHostOption}
              handleHome={handleHome}
              handleOpenProject={handleOpenProject}
              handleSettings={handleSettings}
            />
          </GlassSurface>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function DesktopSidebar({
  activeServerId,
  activeHostLabel,
  activeHostStatus,
  hostOptions,
  hostTriggerRef,
  isHostPickerOpen,
  setIsHostPickerOpen,
  agents,
  selectedAgentId,
  isInitialLoad,
  isRevalidating,
  isLoadingMore,
  isManualRefresh,
  hasMore,
  handleRefresh,
  handleLoadMore,
  handleHostSelect,
  renderHostOption,
  handleOpenProject,
  handleHome,
  handleSearch,
  handleSettings,
  sidebarViewMode,
  setSidebarViewMode,
  searchQuery,
  setSearchQuery,
  clearSearch,
  isOpen,
}: DesktopSidebarProps) {
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const setSidebarWidth = usePanelStore((state) => state.setSidebarWidth);
  const closeDesktopAgentList = usePanelStore((state) => state.closeDesktopAgentList);
  const { t } = useTranslation();
  const { width: viewportWidth } = useWindowDimensions();
  const desktopSidebarResizeState = useMemo(
    () =>
      getDesktopSidebarResizeState({
        storedWidth: sidebarWidth,
        viewportWidth,
        minWidth: MIN_SIDEBAR_WIDTH,
        maxWidth: MAX_SIDEBAR_WIDTH,
        minContentWidth: MIN_CHAT_WIDTH,
      }),
    [sidebarWidth, viewportWidth],
  );
  const desktopSidebarWidth = desktopSidebarResizeState.width;
  const desktopSidebarMaxWidth = desktopSidebarResizeState.maxWidth;
  const hostStatusDotStyle = useMemo(() => {
    if (activeHostStatus === "online") return [styles.hostStatusDot, styles.hostStatusDotOnline];
    if (activeHostStatus === "connecting")
      return [styles.hostStatusDot, styles.hostStatusDotConnecting];
    if (activeHostStatus === "idle") return [styles.hostStatusDot, styles.hostStatusDotIdle];
    return [styles.hostStatusDot, styles.hostStatusDotError];
  }, [activeHostStatus]);

  const startWidthRef = useRef(desktopSidebarWidth);
  const resizeWidth = useSharedValue(desktopSidebarWidth);
  const openProgress = useSharedValue(isOpen ? 1 : 0);

  useEffect(() => {
    resizeWidth.value = withTiming(
      isOpen ? desktopSidebarWidth : 0,
      DESKTOP_SIDEBAR_ANIMATION_CONFIG,
    );
    openProgress.value = withTiming(isOpen ? 1 : 0, DESKTOP_SIDEBAR_ANIMATION_CONFIG);
  }, [desktopSidebarWidth, isOpen, openProgress, resizeWidth]);

  const resizeGesture = useMemo(
    () =>
      Gesture.Pan()
        .hitSlop({ left: 8, right: 8, top: 0, bottom: 0 })
        .onStart(() => {
          startWidthRef.current = desktopSidebarWidth;
          resizeWidth.value = desktopSidebarWidth;
        })
        .onUpdate((event) => {
          // Dragging right (positive translationX) increases width
          const newWidth = startWidthRef.current + event.translationX;
          const clampedWidth = Math.max(
            MIN_SIDEBAR_WIDTH,
            Math.min(desktopSidebarMaxWidth, newWidth),
          );
          resizeWidth.value = clampedWidth;
        })
        .onEnd(() => {
          runOnJS(setSidebarWidth)(resizeWidth.value);
        }),
    [desktopSidebarMaxWidth, desktopSidebarWidth, resizeWidth, setSidebarWidth],
  );

  const resizeAnimatedStyle = useAnimatedStyle(() => ({
    width: resizeWidth.value,
    marginRight: DESKTOP_SIDEBAR_GAP * openProgress.value,
    opacity: openProgress.value,
    // Hide the panel's right divider while collapsed so no 1px gray stub remains.
    overflow: "hidden" as const,
  }));

  const desktopSidebarStyle = useMemo(
    () => [staticStyles.desktopSidebar, resizeAnimatedStyle],
    [resizeAnimatedStyle],
  );
  const desktopSidebarBorderStyle = useMemo(() => [styles.desktopSidebarBorder, { flex: 1 }], []);
  const resizeHandleStyle = useMemo(
    () => [styles.resizeHandle, isWeb && ({ cursor: "col-resize" } as object)],
    [],
  );
  // Collapsed: no rail / gray strip — shell DesktopSidebarControl owns open/close.
  // Open: full panel; close is the fixed shell trigger (T3 SidebarTrigger).
  return (
    <Animated.View
      style={desktopSidebarStyle}
      testID="desktop-left-sidebar"
      pointerEvents={isOpen ? "auto" : "none"}
    >
      <View style={desktopSidebarBorderStyle}>
        <View style={styles.desktopSidebarDragArea}>
          <TitlebarDragRegion />
          <SidebarTopActions
            onCloseSidebar={closeDesktopAgentList}
            onNewConversation={handleOpenProject}
            onSearch={handleSearch}
            sidebarViewMode={sidebarViewMode}
            setSidebarViewMode={setSidebarViewMode}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            clearSearch={clearSearch}
            variant="desktop"
            railWidth={sidebarWidth}
          />
        </View>

        {isInitialLoad ? (
          <SidebarAgentListSkeleton />
        ) : (
          <SidebarSessionList
            serverId={activeServerId}
            agents={agents}
            selectedAgentId={selectedAgentId}
            isRefreshing={isManualRefresh && isRevalidating}
            onRefresh={handleRefresh}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            onLoadMore={handleLoadMore}
            onAddProject={handleOpenProject}
            viewMode={sidebarViewMode}
            searchQuery={searchQuery}
          />
        )}

        <SidebarFooter
          activeServerId={activeServerId}
          activeHostLabel={activeHostLabel}
          hostStatusDotStyle={hostStatusDotStyle}
          hostOptions={hostOptions}
          hostTriggerRef={hostTriggerRef}
          isHostPickerOpen={isHostPickerOpen}
          setIsHostPickerOpen={setIsHostPickerOpen}
          handleHostSelect={handleHostSelect}
          renderHostOption={renderHostOption}
          handleHome={handleHome}
          handleOpenProject={handleOpenProject}
          handleSettings={handleSettings}
          variant="desktop"
        />

        {/* Resize handle - absolutely positioned over right border */}
        <GestureDetector gesture={resizeGesture}>
          <View
            style={resizeHandleStyle}
            accessibilityRole="adjustable"
            accessibilityLabel={t("sidebar.dragResizeWidth")}
          />
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

// Static styles for Animated.Views — must NOT use Unistyles dynamic theme to
// avoid the "Unable to find node on an unmounted component" crash when Unistyles
// tries to patch the native node that Reanimated also manages.
const staticStyles = RNStyleSheet.create({
  backdrop: {
    // Soft .drawer-bg: dimmer over workspace.
    ...RNStyleSheet.absoluteFill,
    backgroundColor: "rgba(15, 18, 25, 0.4)",
  },
  mobileSidebar: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    bottom: 0,
    overflow: "hidden" as const,
  },
  desktopSidebar: {
    position: "relative" as const,
  },
});

const styles = StyleSheet.create((theme) => ({
  sidebarContent: {
    flex: 1,
    minHeight: 0,
  },
  // Soft .quick mobile card: r12 surface + border.
  mobileQuickActions: {
    marginHorizontal: 10,
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    gap: theme.spacing[2],
  },
  mobileQuickActionsTextGroup: {
    minWidth: 0,
    paddingRight: theme.spacing[8],
    gap: 2,
  },
  // Soft .quick .ql: 11 medium muted.
  mobileQuickActionsLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: theme.fontWeight.medium,
  },
  // Soft .quick .qt: 13 medium.
  mobileQuickActionsTitle: {
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
  },
  // Soft .quick-grid: 2-col, gap 6.
  mobileQuickActionsButtons: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  // Soft .qb: h34 r10 shell wash, 12px text-2 (HTML .qb).
  mobileQuickActionButton: {
    minHeight: 34,
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  // Soft .qb.primary: --active surface3 wash, full row (surface1 hover-only).
  mobileQuickActionPrimaryButton: {
    flexBasis: "100%",
    flexGrow: 1,
    minWidth: 0,
    borderColor: "transparent",
    backgroundColor: theme.colors.surface3,
  },
  // Soft .quick-grid secondary: two columns with shared gap 6.
  mobileQuickActionSecondaryButton: {
    flexGrow: 1,
    flexBasis: "48%",
    minWidth: 0,
  },
  mobileQuickActionButtonHovered: {
    backgroundColor: theme.colors.surface1,
  },
  mobileQuickActionIcon: {
    flexShrink: 0,
  },
  mobileQuickActionText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
  },
  // Soft .qb.primary label weight.
  mobileQuickActionPrimaryText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  desktopSidebarBorder: {
    borderRightWidth: theme.borderWidth[1],
    borderRightColor: theme.colors.border,
    // Soft Workbench: soft nav column, not hard chrome rail.
    backgroundColor: theme.colors.surfaceSidebar,
    overflow: "hidden",
  },
  resizeHandle: {
    position: "absolute",
    right: -5,
    top: 0,
    bottom: 0,
    width: 10,
    zIndex: 10,
  },
  sidebarDragArea: {
    position: "relative",
  },
  desktopSidebarDragArea: {
    position: "relative",
    marginHorizontal: 0,
    marginTop: 0,
    marginBottom: 0,
  },
  sidebarTopArea: {
    paddingTop: theme.spacing[2],
    paddingRight: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    gap: theme.spacing[1],
    userSelect: "none",
  },
  desktopSidebarTopArea: {
    // Soft .nav-top: padding 12 12 8. Shell control overlays top-row spacer only.
    paddingTop: 12,
    paddingRight: 12,
    paddingBottom: 8,
    paddingLeft: 12,
    gap: 10,
  },
  sidebarTopActions: {
    // Soft .nav-top-row: gap 6.
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  // Fixed shell control is 32@left 12; reserve that tile on the top row only.
  desktopSidebarControlSpacer: {
    width: 32,
    height: 32,
    flexShrink: 0,
  },
  sidebarTopHeadingSpacer: {
    flex: 1,
    minWidth: 0,
  },
  viewSwitcher: {
    // Full-width row under search — does not share the shell/search top strip.
    alignSelf: "stretch",
    // minWidth is set inline from resolveSidebarViewSwitcherLayout.
    minWidth: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: theme.colors.surface1,
    borderRadius: 8,
    padding: 2,
    overflow: "hidden",
    position: "relative",
  },
  // Sliding highlight under the active 项目/状态 tab (plain View — safe for
  // Unistyles theme colors; see thumbStyle for the web CSS transition).
  viewTabThumb: {
    position: "absolute",
    top: 2,
    left: 2,
    bottom: 2,
    width: "50%",
    marginRight: 2,
    borderRadius: 6,
    backgroundColor: theme.colors.surface0,
    ...(isWeb
      ? ({
          boxShadow: "inset 0 0 0 1px rgba(20, 23, 31, 0.04)",
        } as object)
      : theme.shadow.sm),
  },
  // Native fallback for the switched thumb.
  viewTabThumbShiftedNative: {
    transform: [{ translateX: "100%" }],
  },
  scopeTriggerShim: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "stretch",
  },
  viewTab: {
    flex: 1,
    minWidth: 0,
    minHeight: 28,
    maxHeight: 28,
    borderRadius: 6,
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "transparent",
    overflow: "hidden",
  },
  viewTabIconOnly: {
    paddingHorizontal: 4,
  },
  viewTabActive: {
    backgroundColor: "transparent",
  },
  viewTabText: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    ...(isWeb
      ? ({
          whiteSpace: "nowrap",
        } as object)
      : {}),
  },
  viewTabTextActive: {
    color: theme.colors.foreground,
  },
  searchRow: {
    minHeight: 34,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    color: theme.colors.foreground,
    paddingVertical: 0,
  },
  searchClear: {
    fontSize: 18,
    lineHeight: 18,
    color: theme.colors.foregroundFaint,
    paddingHorizontal: 4,
  },
  sidebarTopIconCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  // Soft .ni / .icon-btn: 32 tile r10, transparent, hover fill only.
  sidebarTopAction: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  sidebarTopActionHovered: {
    backgroundColor: theme.colors.surface1,
    borderColor: "transparent",
  },
  sidebarTopActionIconSlot: {
    alignItems: "center",
    justifyContent: "center",
  },
  sidebarPrimaryActions: {
    gap: theme.spacing[1],
  },
  desktopSidebarPrimaryActions: {
    minHeight: 40,
    paddingHorizontal: 0,
  },
  // Soft .new-btn: etched light ring, no plus chip / drop shadow.
  sidebarPrimaryAction: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "transparent",
    justifyContent: "flex-start",
    ...(isWeb
      ? ({
          // Quiet score-line ring (no drop shadow).
          boxShadow: "inset 0 0 0 1px rgba(20, 23, 31, 0.04)",
        } as object)
      : {}),
  },
  sidebarPrimaryActionHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  sidebarPrimaryActionText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: 13.5,
    fontWeight: theme.fontWeight.medium,
  },
  hostTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: theme.spacing[2],
    minWidth: 0,
    minHeight: 28,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: 10,
  },
  // Soft .host: h36, etched light ring (same score-line as new-conversation).
  desktopHostTrigger: {
    minHeight: 36,
    height: 36,
    paddingVertical: 0,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "transparent",
    ...(isWeb
      ? ({
          boxShadow: "inset 0 0 0 1px rgba(20, 23, 31, 0.04)",
        } as object)
      : {}),
  },
  hostTriggerHovered: {
    backgroundColor: theme.colors.surface1,
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
  hostStatusDotIdle: {
    backgroundColor: theme.colors.palette.red[500],
  },
  hostStatusDotError: {
    backgroundColor: theme.colors.palette.red[500],
  },
  // Soft .drawer: --nav surface for the animated mobile shell.
  mobileSidebarSurface: {
    backgroundColor: theme.colors.surfaceSidebar,
  },
  // Soft .host .lbl: 12.5px.
  hostTriggerText: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
    minWidth: 0,
  },
  sidebarFooter: {
    // Soft .nav-foot family: quiet border-soft top rule.
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.secondary,
  },
  desktopSidebarFooter: {
    // Soft .nav-foot: pad 10 10 12, host + icons, --border-soft top rule.
    height: SIDEBAR_FOOTER_HEIGHT,
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 10,
    paddingBottom: 12,
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "flex-start",
    gap: 8,
    marginHorizontal: 0,
    marginBottom: 0,
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.secondary,
    borderRadius: 0,
    backgroundColor: "transparent",
  },
  footerHostSlot: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
    marginRight: theme.spacing[2],
  },
  desktopFooterHostSlot: {
    width: "100%",
    height: 36,
    marginRight: 0,
  },
  footerIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  desktopFooterIconRow: {
    alignSelf: "stretch",
    justifyContent: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  footerIconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
    borderRadius: 10,
  },
  footerIconButtonHovered: {
    backgroundColor: theme.colors.surface1,
  },
  // Soft .foot-icons .icon-btn: 34 tile, etched light ring (match host / new-conversation).
  desktopFooterIconButton: {
    width: 34,
    height: 34,
    flexGrow: 0,
    flexShrink: 0,
    paddingVertical: 0,
    paddingHorizontal: 0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    backgroundColor: "transparent",
    ...(isWeb
      ? ({
          boxShadow: "inset 0 0 0 1px rgba(20, 23, 31, 0.04)",
        } as object)
      : {}),
  },
  hostPickerList: {
    gap: theme.spacing[2],
  },
  hostPickerOption: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: 12,
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  hostPickerOptionText: {
    color: theme.colors.foreground,
    // Soft host picker option: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 16,
  },
  hostPickerCancel: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: 12,
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  hostPickerCancelText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
}));
