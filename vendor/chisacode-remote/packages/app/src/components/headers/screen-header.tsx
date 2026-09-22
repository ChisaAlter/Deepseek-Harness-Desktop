import { useMemo, type ReactNode } from "react";
import type { LayoutChangeEvent } from "react-native";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import {
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
  useIsCompactFormFactor,
  WORKBENCH_HEADER_HORIZONTAL_PADDING,
} from "@/constants/layout";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { useDesktopSidebarControlContentPad } from "@/components/desktop/desktop-sidebar-control";
import { SPACING } from "@/styles/theme";
import { resolveThemeWorkbenchSurfaceRoles } from "@/styles/workbench-surface-roles";

interface ScreenHeaderProps {
  left?: ReactNode;
  right?: ReactNode;
  leftStyle?: StyleProp<ViewStyle>;
  rightStyle?: StyleProp<ViewStyle>;
  borderless?: boolean;
  windowControlsPaddingRole?: "header" | "detailHeader";
  onRowLayout?: (event: LayoutChangeEvent) => void;
  height?: number;
  horizontalPadding?: number;
  backgroundColor?: string;
}

/**
 * Shared frame for the home/back headers so we only maintain padding, border,
 * and safe-area logic in one place.
 */
export function ScreenHeader({
  left,
  right,
  leftStyle,
  rightStyle,
  borderless,
  windowControlsPaddingRole = "header",
  onRowLayout,
  height,
  horizontalPadding,
  backgroundColor,
}: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const isMobile = useIsCompactFormFactor();
  const padding = useWindowControlsPadding(windowControlsPaddingRole);
  // Shell DesktopSidebarControl is fixed; clear titles when the left rail is collapsed.
  const sidebarControlContentPad = useDesktopSidebarControlContentPad();
  // Only add extra padding on mobile for better touch targets; on desktop, only use safe area insets
  const topPadding = isMobile ? HEADER_TOP_PADDING_MOBILE : 0;
  // `spacing` is the static `SPACING` scale shared by every theme, so the
  // constant is imported directly instead of read from a hook.
  const baseHorizontalPadding =
    horizontalPadding ?? (isMobile ? SPACING[2] : WORKBENCH_HEADER_HORIZONTAL_PADDING);

  const innerStyle = useMemo(
    () => [styles.inner, { paddingTop: insets.top + topPadding }],
    [insets.top, topPadding],
  );
  const rowStyle = useMemo(
    () => [
      styles.row,
      height === undefined ? null : { height },
      {
        paddingLeft: Math.max(
          baseHorizontalPadding + padding.left,
          // Collapsed desktop: clear the fixed shell trigger (T3 content-left).
          isMobile ? 0 : sidebarControlContentPad,
        ),
        paddingRight: baseHorizontalPadding + padding.right,
      },
      borderless && styles.borderless,
    ],
    [
      baseHorizontalPadding,
      borderless,
      height,
      isMobile,
      padding.left,
      padding.right,
      sidebarControlContentPad,
    ],
  );
  const headerStyle = useMemo(
    () => [styles.header, backgroundColor ? { backgroundColor } : null],
    [backgroundColor],
  );
  const leftCombinedStyle = useMemo(() => [styles.left, leftStyle], [leftStyle]);
  const rightCombinedStyle = useMemo(() => [styles.right, rightStyle], [rightStyle]);

  return (
    <View style={headerStyle}>
      <View style={innerStyle}>
        <View onLayout={onRowLayout} style={rowStyle}>
          <TitlebarDragRegion />
          <View style={leftCombinedStyle}>{left}</View>
          <View style={rightCombinedStyle}>{right}</View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    backgroundColor: resolveThemeWorkbenchSurfaceRoles(theme).content,
  },
  inner: {},
  row: {
    position: "relative",
    height: {
      xs: HEADER_INNER_HEIGHT_MOBILE,
      md: HEADER_INNER_HEIGHT,
    },
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    // Soft .set-main-h / .topbar: quiet border-soft rule.
    borderBottomColor: theme.colors.secondary,
    userSelect: "none",
  },
  left: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minWidth: 0,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  borderless: {
    borderBottomColor: "transparent",
  },
}));
