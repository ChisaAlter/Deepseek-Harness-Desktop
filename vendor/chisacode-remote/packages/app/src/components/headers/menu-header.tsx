import { useCallback, useMemo, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ScreenHeader } from "./screen-header";
import { ScreenTitle } from "./screen-title";
import { HeaderToggleButton } from "./header-toggle-button";
import { selectIsAgentListOpen, usePanelStore } from "@/stores/panel-store";
import { useIsCompactFormFactor } from "@/constants/layout";
import { getShortcutOs } from "@/utils/shortcut-platform";
import type { Theme } from "@/styles/theme";

interface MenuHeaderProps {
  title?: string;
  rightContent?: ReactNode;
  borderless?: boolean;
}

interface SidebarMenuToggleProps {
  style?: StyleProp<ViewStyle>;
  tooltipSide?: "left" | "right" | "top" | "bottom";
  testID?: string;
  nativeID?: string;
}

const MOBILE_MENU_LINE_WIDTH = 16;
const MOBILE_MENU_LINE_SHORT_WIDTH = 8;
const MOBILE_MENU_LINE_HEIGHT = 2;

function MobileMenuIcon({ color }: { color: string }) {
  const lineStyle = useMemo(() => [styles.mobileMenuLine, { backgroundColor: color }], [color]);
  const shortLineStyle = useMemo(
    () => [styles.mobileMenuLine, styles.mobileMenuLineShort, { backgroundColor: color }],
    [color],
  );
  return (
    <View style={styles.mobileMenuIcon} pointerEvents="none">
      <View style={lineStyle} />
      <View style={lineStyle} />
      <View style={shortLineStyle} />
    </View>
  );
}

// The mobile menu glyph takes its theme color through a `color` prop, so wrap
// the renderer with `withUnistyles` and feed the theme-reactive color through
// `uniProps`.
const ThemedMobileMenuIcon = withUnistyles(MobileMenuIcon);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

/**
 * Compact-only agent-list toggle. Desktop open/close is the shell-level
 * `DesktopSidebarControl` (T3 SidebarTrigger) so Soft Home / workspace / focus
 * mode cannot lose the affordance when a page forgets to mount a header toggle.
 */
export function SidebarMenuToggle({
  style,
  tooltipSide = "right",
  testID = "menu-button",
  nativeID = "menu-button",
}: SidebarMenuToggleProps = {}) {
  const isMobile = useIsCompactFormFactor();
  const isOpen = usePanelStore((state) => selectIsAgentListOpen(state, { isCompact: isMobile }));
  const toggleAgentListForLayout = usePanelStore((state) => state.toggleAgentListForLayout);
  const toggleShortcutKeys = useMemo(
    () => (getShortcutOs() === "mac" ? ["mod", "B"] : ["mod", "."]),
    [],
  );

  const handlePress = useCallback(() => {
    toggleAgentListForLayout({ isCompact: isMobile });
  }, [toggleAgentListForLayout, isMobile]);

  const { t } = useTranslation();
  const accessibilityState = useMemo(() => ({ expanded: isOpen }), [isOpen]);

  // Desktop: shell owns the single open/close control. Page headers must not
  // mount a second toggle that can disappear with route chrome.
  if (!isMobile) {
    return null;
  }

  return (
    <HeaderToggleButton
      onPress={handlePress}
      tooltipLabel={t("common.toggleSidebar")}
      tooltipKeys={toggleShortcutKeys}
      tooltipSide={tooltipSide}
      testID={testID}
      nativeID={nativeID}
      style={style}
      accessible
      accessibilityRole="button"
      accessibilityLabel={isOpen ? t("common.closeMenu") : t("common.openMenu")}
      accessibilityState={accessibilityState}
    >
      <ThemedMobileMenuIcon uniProps={foregroundMutedColorMapping} />
    </HeaderToggleButton>
  );
}

export function MenuHeader({ title, rightContent, borderless }: MenuHeaderProps) {
  return (
    <ScreenHeader
      left={
        <>
          <SidebarMenuToggle />
          {title && <ScreenTitle>{title}</ScreenTitle>}
        </>
      }
      right={rightContent}
      leftStyle={styles.left}
      borderless={borderless}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  left: {
    gap: theme.spacing[2],
  },
  mobileMenuIcon: {
    width: MOBILE_MENU_LINE_WIDTH,
    height: 12,
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  mobileMenuLine: {
    width: MOBILE_MENU_LINE_WIDTH,
    height: MOBILE_MENU_LINE_HEIGHT,
    borderRadius: theme.borderRadius.full,
  },
  mobileMenuLineShort: {
    width: MOBILE_MENU_LINE_SHORT_WIDTH,
  },
}));
