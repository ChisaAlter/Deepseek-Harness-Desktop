import { useCallback, useMemo, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { SETTINGS_CONTROL_HEIGHT } from "@/constants/layout";
import { ICON_SIZE, type Theme } from "@/styles/theme";

type SegmentedControlSize = "sm" | "md";

type SegmentedControlIconRenderer = (props: { color: string; size: number }) => ReactNode;

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  icon?: SegmentedControlIconRenderer;
  disabled?: boolean;
  testID?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  size?: SegmentedControlSize;
  hideLabels?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  compact?: boolean;
}

const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

/** Host that injects a theme-reactive `color` into the caller's icon renderer. */
function SegmentIconHost({
  color,
  size,
  icon,
}: {
  color: string;
  size: number;
  icon: SegmentedControlIconRenderer;
}) {
  return <>{icon({ color, size })}</>;
}

const ThemedSegmentIconHost = withUnistyles(SegmentIconHost);

export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  size = "md",
  hideLabels = false,
  style,
  testID,
  compact = false,
}: SegmentedControlProps<T>) {
  const containerSizeStyle = size === "sm" ? styles.containerSm : styles.containerMd;
  const segmentSizeStyle = size === "sm" ? styles.segmentSm : styles.segmentMd;
  const labelSizeStyle = size === "sm" ? styles.labelSm : styles.labelMd;
  const iconSize = size === "sm" ? ICON_SIZE.sm : ICON_SIZE.md;

  const containerStyle = useMemo(
    () => [styles.container, containerSizeStyle, compact && styles.containerCompact, style],
    [compact, containerSizeStyle, style],
  );
  const segmentStyle = useMemo(
    () => [segmentSizeStyle, compact && styles.segmentCompact],
    [compact, segmentSizeStyle],
  );
  const labelStyle = useMemo(
    () => [labelSizeStyle, compact && styles.labelCompact],
    [compact, labelSizeStyle],
  );

  return (
    <View style={containerStyle} testID={testID}>
      {options.map((option) => {
        const isSelected = option.value === value;

        return (
          <SegmentItem
            key={option.value}
            option={option}
            isSelected={isSelected}
            iconSize={iconSize}
            hideLabels={hideLabels}
            segmentSizeStyle={segmentStyle}
            labelSizeStyle={labelStyle}
            currentValue={value}
            onValueChange={onValueChange}
          />
        );
      })}
    </View>
  );
}

function SegmentItem<T extends string>({
  option,
  isSelected,
  iconSize,
  hideLabels,
  segmentSizeStyle,
  labelSizeStyle,
  currentValue,
  onValueChange,
}: {
  option: SegmentedControlOption<T>;
  isSelected: boolean;
  iconSize: number;
  hideLabels: boolean;
  segmentSizeStyle: StyleProp<ViewStyle>;
  labelSizeStyle: StyleProp<TextStyle>;
  currentValue: T;
  onValueChange: (value: T) => void;
}) {
  const labelStyle = useMemo(
    () => [styles.label, labelSizeStyle, isSelected && styles.labelSelected],
    [labelSizeStyle, isSelected],
  );
  const handlePress = useCallback(() => {
    if (!option.disabled && option.value !== currentValue) {
      onValueChange(option.value);
    }
  }, [option.disabled, option.value, currentValue, onValueChange]);
  const pressableStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.segment,
      segmentSizeStyle,
      isSelected && styles.segmentSelected,
      Boolean(hovered) && !isSelected && styles.segmentHover,
      pressed && !isSelected && styles.segmentPressed,
      option.disabled && styles.segmentDisabled,
    ],
    [isSelected, option.disabled, segmentSizeStyle],
  );
  const accessibilityState = useMemo(
    () => ({ selected: isSelected, disabled: option.disabled }),
    [isSelected, option.disabled],
  );

  let iconColorMapping = foregroundMutedColorMapping;
  if (isSelected) {
    iconColorMapping = foregroundColorMapping;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      disabled={option.disabled}
      testID={option.testID}
      onPress={handlePress}
      style={pressableStyle}
    >
      {option.icon ? (
        <View style={styles.iconContainer}>
          <ThemedSegmentIconHost size={iconSize} icon={option.icon} uniProps={iconColorMapping} />
        </View>
      ) : null}
      {hideLabels ? null : (
        <Text style={labelStyle} numberOfLines={1}>
          {option.label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Soft .seg track: shell wash + quiet border.
  container: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: theme.colors.surfaceWorkspace,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 2,
  },
  containerSm: {
    padding: 2,
  },
  containerMd: {
    padding: 3,
  },
  containerCompact: {
    height: SETTINGS_CONTROL_HEIGHT,
    padding: 0,
    gap: 0,
    overflow: "hidden",
  },
  segment: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderRadius: theme.borderRadius.full,
    gap: theme.spacing[1],
  },
  segmentSm: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  segmentMd: {
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
  },
  segmentCompact: {
    // Soft .seg span: h28.
    height: 28,
    paddingVertical: 0,
    paddingHorizontal: theme.spacing[3],
    borderRadius: 0,
  },
  segmentSelected: {
    backgroundColor: theme.colors.surface0,
    ...(isWeb
      ? ({
          boxShadow: "0 1px 2px rgba(20, 23, 31, 0.04)",
        } as object)
      : {}),
  },
  segmentHover: {
    backgroundColor: theme.colors.surface0,
  },
  segmentPressed: {
    backgroundColor: theme.colors.surface0,
  },
  segmentDisabled: {
    opacity: theme.opacity[50],
  },
  iconContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.normal,
  },
  labelSm: {
    // Soft .seg span: 12 meta.
    fontSize: 12,
    lineHeight: 16,
  },
  labelMd: {
    fontSize: 14.5,
    lineHeight: 20,
  },
  labelCompact: {
    // Soft .seg span: 12 meta.
    fontSize: 12,
    lineHeight: 16,
  },
  labelSelected: {
    color: theme.colors.foreground,
    // Soft .seg span.on: medium, not heavy semibold.
    fontWeight: theme.fontWeight.medium,
  },
}));
