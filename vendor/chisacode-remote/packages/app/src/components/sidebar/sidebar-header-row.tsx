import { useCallback, useMemo, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { LucideIcon } from "lucide-react-native";
import {
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  SETTINGS_DESKTOP_BACK_HEIGHT,
} from "@/constants/layout";
import { ThemedIconHost } from "@/components/themed-icon-host";
import { ICON_SIZE, type Theme } from "@/styles/theme";

interface SidebarHeaderRowProps {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  isActive?: boolean;
  testID?: string;
  nativeID?: string;
  accessibilityLabel?: string;
  trailing?: ReactNode;
  compact?: boolean;
}

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

/**
 * Top-of-sidebar header row: a sidebar-height pressable with an icon + label
 * and a full-width border separator beneath. Used as the first element of a
 * sidebar (workspace "Sessions", settings "Back to workspace"). Owns its own
 * separator line so both sidebars converge on the same edge and padding.
 */
export function SidebarHeaderRow({
  icon: Icon,
  label,
  onPress,
  isActive = false,
  testID,
  nativeID,
  accessibilityLabel,
  trailing,
  compact = false,
}: SidebarHeaderRowProps) {
  const buttonStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.button,
      compact && styles.compactButton,
      (Boolean(hovered) || isActive) && styles.buttonHovered,
    ],
    [compact, isActive],
  );

  const renderChildren = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) => {
      const isHighlighted = Boolean(state.hovered) || isActive;
      return (
        <>
          <View style={styles.titleGroup}>
            <ThemedIconHost
              Icon={Icon}
              size={ICON_SIZE.md}
              uniProps={isHighlighted ? foregroundColorMapping : foregroundMutedColorMapping}
            />
            <SidebarHeaderRowLabel label={label} isHighlighted={isHighlighted} compact={compact} />
          </View>
          {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
        </>
      );
    },
    [Icon, compact, isActive, label, trailing],
  );

  const containerStyle = useMemo(
    () => [styles.container, compact && styles.compactContainer],
    [compact],
  );

  return (
    <View style={containerStyle}>
      <Pressable
        onPress={onPress}
        testID={testID}
        nativeID={nativeID}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        style={buttonStyle}
      >
        {renderChildren}
      </Pressable>
    </View>
  );
}

function SidebarHeaderRowLabel({
  label,
  isHighlighted,
  compact,
}: {
  label: string;
  isHighlighted: boolean;
  compact: boolean;
}) {
  const labelStyle = useMemo(
    () => [styles.label, compact && styles.compactLabel, isHighlighted && styles.labelHighlighted],
    [compact, isHighlighted],
  );
  return <Text style={labelStyle}>{label}</Text>;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    height: {
      xs: HEADER_INNER_HEIGHT_MOBILE,
      md: HEADER_INNER_HEIGHT,
    },
    paddingHorizontal: theme.spacing[2],
    justifyContent: "center",
    borderBottomWidth: 1,
    // Soft quiet chrome rule (--border-soft).
    borderBottomColor: theme.colors.secondary,
    userSelect: "none",
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    // Soft nav header hover pill: r10.
    borderRadius: 10,
  },
  titleGroup: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  trailing: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  // Soft nav header label: 13.5 medium muted / on = foreground.
  label: {
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
  },
  labelHighlighted: {
    color: theme.colors.foreground,
  },
  compactContainer: {
    height: SETTINGS_DESKTOP_BACK_HEIGHT,
    paddingHorizontal: theme.spacing[3],
  },
  compactButton: {
    flex: 1,
    paddingVertical: 0,
    paddingHorizontal: 0,
    borderRadius: 0,
  },
  compactLabel: {
    // Soft sidebar header chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
  },
}));
