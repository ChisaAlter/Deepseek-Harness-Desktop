import { useCallback, useMemo } from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { PanelLeft, PanelLeftClose } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { ThemedIconHost } from "@/components/themed-icon-host";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DESKTOP_WINDOW_CONTROLS_HEIGHT,
  getIsElectronRuntime,
  getIsElectronRuntimeMac,
  useIsCompactFormFactor,
} from "@/constants/layout";
import { selectIsAgentListOpen, usePanelStore } from "@/stores/panel-store";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import {
  DESKTOP_SIDEBAR_CONTROL_SIZE,
  resolveDesktopSidebarControlLayout,
  resolveDesktopSidebarControlOverlayPad,
} from "@/utils/desktop-sidebar-control-layout";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import { getShortcutOs } from "@/utils/shortcut-platform";
import { TITLEBAR_NO_DRAG_VIEW_STYLE } from "@/components/desktop/titlebar-drag-region";
import type { ShortcutKey } from "@/utils/format-shortcut";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * T3-style shell SidebarTrigger: one fixed control for open/close on desktop.
 *
 * Mounted on AppContainer so Soft Home, workspace, settings, and focus mode all
 * share a single affordance. Visually clones Soft sidebar search tile
 * (`sidebarTopAction`): 32 transparent, no border, ICON_SIZE.sm muted glyph,
 * top inset matches desktopSidebarTopArea paddingTop (12).
 */
export function DesktopSidebarControl({ enabled }: { enabled: boolean }) {
  const isCompactLayout = useIsCompactFormFactor();
  const { t } = useTranslation();
  const titlebarPadding = useWindowControlsPadding("titlebar");
  const isAgentListOpen = usePanelStore((state) =>
    selectIsAgentListOpen(state, { isCompact: false }),
  );
  const isFocusModeEnabled = usePanelStore((state) => state.desktop.focusModeEnabled);
  const openDesktopAgentList = usePanelStore((state) => state.openDesktopAgentList);
  const toggleDesktopAgentList = usePanelStore((state) => state.toggleDesktopAgentList);
  const toggleFocusMode = usePanelStore((state) => state.toggleFocusMode);

  // Focus mode unmounts the left rail even when agentListOpen remains true.
  const isSidebarVisible = isAgentListOpen && !isFocusModeEnabled;
  const layout = useMemo(
    () =>
      resolveDesktopSidebarControlLayout({
        isSidebarVisible,
        trafficLightLeft:
          getIsElectronRuntime() && getIsElectronRuntimeMac() ? titlebarPadding.left : 0,
        titlebarTop:
          getIsElectronRuntime() && titlebarPadding.top > 0
            ? titlebarPadding.top
            : DESKTOP_WINDOW_CONTROLS_HEIGHT,
      }),
    [isSidebarVisible, titlebarPadding.left, titlebarPadding.top],
  );

  const toggleShortcutKeys = useMemo<ShortcutKey[]>(
    () => (getShortcutOs() === "mac" ? ["mod", "B"] : ["mod", "."]),
    [],
  );
  const accessibilityState = useMemo(() => ({ expanded: isSidebarVisible }), [isSidebarVisible]);

  const handlePress = useCallback(() => {
    if (usePanelStore.getState().desktop.focusModeEnabled) {
      // Focus mode hides the rail; restore reading chrome and force the list open.
      toggleFocusMode();
      openDesktopAgentList();
      return;
    }
    toggleDesktopAgentList();
  }, [openDesktopAgentList, toggleDesktopAgentList, toggleFocusMode]);

  const hostStyle = useMemo(
    () => [
      styles.host,
      TITLEBAR_NO_DRAG_VIEW_STYLE,
      {
        left: layout.controlInsets.left,
        top: layout.controlInsets.top,
      },
    ],
    [layout.controlInsets.left, layout.controlInsets.top],
  );

  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      (Boolean(hovered) || pressed) && styles.buttonHovered,
    ],
    [],
  );

  if (!enabled || isCompactLayout) {
    return null;
  }

  const Icon = isSidebarVisible ? PanelLeftClose : PanelLeft;
  const accessibilityLabel = isSidebarVisible
    ? t("sidebar.closeSidebar")
    : t("sidebar.openSidebar");

  return (
    <View pointerEvents="box-none" style={hostStyle} testID="desktop-sidebar-control-host">
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={accessibilityState}
          onPress={handlePress}
          style={buttonStyle}
          testID="desktop-sidebar-control"
          nativeID="desktop-sidebar-control"
        >
          {({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => (
            <View style={styles.iconSlot} pointerEvents="none">
              <ThemedIconHost
                Icon={Icon}
                size={ICON_SIZE.sm}
                uniProps={
                  Boolean(hovered) || Boolean(pressed) ? foregroundColorMapping : mutedColorMapping
                }
              />
            </View>
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom" align="center" offset={8}>
          <View style={styles.tooltipRow}>
            <Text style={styles.tooltipText}>{t("common.toggleSidebar")}</Text>
            <Shortcut keys={toggleShortcutKeys} style={styles.shortcut} />
          </View>
        </TooltipContent>
      </Tooltip>
    </View>
  );
}

function useDesktopSidebarControlTrafficLightLeft(): number {
  const titlebarPadding = useWindowControlsPadding("titlebar");
  if (getIsElectronRuntime() && getIsElectronRuntimeMac()) {
    return titlebarPadding.left;
  }
  return 0;
}

/**
 * React hook: left padding content topbars need under the shell sidebar control.
 * @returns Extra left pad in px (0 while the desktop left rail is visible)
 */
export function useDesktopSidebarControlContentPad(): number {
  const isCompactLayout = useIsCompactFormFactor();
  const titlebarPadding = useWindowControlsPadding("titlebar");
  const trafficLightLeft = useDesktopSidebarControlTrafficLightLeft();
  const isAgentListOpen = usePanelStore((state) =>
    selectIsAgentListOpen(state, { isCompact: false }),
  );
  const isFocusModeEnabled = usePanelStore((state) => state.desktop.focusModeEnabled);
  const isSidebarVisible = isAgentListOpen && !isFocusModeEnabled;

  return useMemo(() => {
    if (isCompactLayout) {
      return 0;
    }
    return resolveDesktopSidebarControlLayout({
      isSidebarVisible,
      trafficLightLeft,
      titlebarTop:
        getIsElectronRuntime() && titlebarPadding.top > 0
          ? titlebarPadding.top
          : DESKTOP_WINDOW_CONTROLS_HEIGHT,
    }).contentLeftPad;
  }, [isCompactLayout, isSidebarVisible, titlebarPadding.top, trafficLightLeft]);
}

/**
 * React hook: left pad for the open desktop left-rail header under the fixed control.
 * @returns Overlay clearance in px (0 on compact)
 */
export function useDesktopSidebarControlOverlayPad(): number {
  const isCompactLayout = useIsCompactFormFactor();
  const trafficLightLeft = useDesktopSidebarControlTrafficLightLeft();
  return useMemo(() => {
    if (isCompactLayout) {
      return 0;
    }
    return resolveDesktopSidebarControlOverlayPad(trafficLightLeft);
  }, [isCompactLayout, trafficLightLeft]);
}

const styles = StyleSheet.create((theme) => ({
  host: {
    position: "absolute",
    zIndex: 60,
    width: DESKTOP_SIDEBAR_CONTROL_SIZE,
    height: DESKTOP_SIDEBAR_CONTROL_SIZE,
  },
  // Clone Soft .ni / sidebarTopAction: 32 transparent tile, hover wash only.
  button: {
    width: DESKTOP_SIDEBAR_CONTROL_SIZE,
    height: DESKTOP_SIDEBAR_CONTROL_SIZE,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  buttonHovered: {
    backgroundColor: theme.colors.surface1,
    borderColor: "transparent",
  },
  iconSlot: {
    alignItems: "center",
    justifyContent: "center",
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.popoverForeground,
  },
  shortcut: {},
}));
