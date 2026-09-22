import { useCallback, useMemo } from "react";
import {
  Pressable,
  StyleSheet as RNStyleSheet,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SETTINGS_SWITCH_HEIGHT, SETTINGS_SWITCH_WIDTH } from "@/constants/layout";
import type { Theme } from "@/styles/theme";

interface SwitchProps {
  value: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

interface SwitchViewProps extends SwitchProps {
  trackOff: string;
  trackOn: string;
  thumbColor: string;
}

const TRACK = { width: SETTINGS_SWITCH_WIDTH, height: SETTINGS_SWITCH_HEIGHT };
const THUMB = 20;

const TIMING = { duration: 180, easing: Easing.inOut(Easing.ease) };

const switchColorMapping = (theme: Theme) => ({
  // Soft .toggle off: --active surface3; on: accent.
  trackOff: theme.colors.surface3,
  trackOn: theme.colors.accent,
  thumbColor: theme.colors.palette.white,
});

function SwitchView({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
  testID,
  style,
  trackOff,
  trackOn,
  thumbColor,
}: SwitchViewProps) {
  const track = TRACK;
  const thumb = THUMB;
  const padding = (track.height - thumb) / 2;
  const thumbTravel = track.width - thumb - padding * 2;

  const progress = useDerivedValue(() => withTiming(value ? 1 : 0, TIMING));

  const trackAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [trackOff, trackOn]),
    borderColor: interpolateColor(progress.value, [0, 1], [trackOff, trackOn]),
  }));

  const thumbAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * thumbTravel }],
  }));

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      if (disabled) return;
      onValueChange?.(!value);
    },
    [disabled, onValueChange, value],
  );

  const accessibilityState = useMemo(() => ({ checked: value, disabled }), [value, disabled]);
  const pressableStyle = useMemo(
    () => [disabled ? styles.disabled : null, style],
    [disabled, style],
  );
  const trackStyle = useMemo(
    () => [
      staticStyles.track,
      {
        width: track.width,
        height: track.height,
        borderRadius: track.height / 2,
        padding,
      },
      trackAnimatedStyle,
    ],
    [track.width, track.height, padding, trackAnimatedStyle],
  );
  const thumbStyle = useMemo(
    () => [
      staticStyles.thumb,
      {
        width: thumb,
        height: thumb,
        borderRadius: thumb / 2,
        backgroundColor: thumbColor,
      },
      thumbAnimatedStyle,
    ],
    [thumbColor, thumb, thumbAnimatedStyle],
  );

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      aria-checked={value}
      testID={testID}
      style={pressableStyle}
    >
      <Animated.View style={trackStyle}>
        <Animated.View style={thumbStyle} />
      </Animated.View>
    </Pressable>
  );
}

const ThemedSwitchView = withUnistyles(SwitchView);

export function Switch(props: SwitchProps) {
  return <ThemedSwitchView {...props} uniProps={switchColorMapping} />;
}

const styles = StyleSheet.create((theme) => ({
  disabled: {
    opacity: theme.opacity[50],
  },
}));

const staticStyles = RNStyleSheet.create({
  track: {
    justifyContent: "center",
    borderWidth: 1,
  },
  thumb: {
    shadowColor: "rgba(20, 23, 31, 0.12)",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    shadowOpacity: 1,
    elevation: 2,
  },
});
