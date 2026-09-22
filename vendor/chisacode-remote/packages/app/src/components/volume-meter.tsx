import { useEffect, useMemo } from "react";
import { StyleSheet as RNStyleSheet, View } from "react-native";
import ReanimatedAnimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";

interface VolumeMeterProps {
  volume: number;
  isMuted?: boolean;
  isSpeaking?: boolean;
  orientation?: "vertical" | "horizontal";
  variant?: "default" | "compact";
  /** Explicit hex/rgb override. Prefer `tone` for theme-reactive fills. */
  color?: string;
  /** Theme-backed bar fill. Defaults to `foreground`. */
  tone?: "foreground" | "accentForeground";
}

export function VolumeMeter({
  volume,
  isMuted = false,
  isSpeaking = false,
  orientation = "vertical",
  variant = "default",
  color,
  tone = "foreground",
}: VolumeMeterProps) {
  const isCompact = variant === "compact";

  // Base dimensions
  const LINE_SPACING = isCompact ? 6 : 8;
  const LINE_WIDTH = isCompact ? 6 : 8;
  let MAX_HEIGHT: number;
  if (orientation === "horizontal") {
    MAX_HEIGHT = isCompact ? 18 : 30;
  } else {
    MAX_HEIGHT = isCompact ? 32 : 50;
  }
  let MIN_HEIGHT: number;
  if (orientation === "horizontal") {
    MIN_HEIGHT = isCompact ? 8 : 12;
  } else {
    MIN_HEIGHT = isCompact ? 14 : 20;
  }

  // Create shared values for 3 dots unconditionally
  const animatedVolume = useSharedValue(0);
  const line1Pulse = useSharedValue(1);
  const line2Pulse = useSharedValue(1);
  const line3Pulse = useSharedValue(1);

  // Start idle animations with different phases for all dots
  useEffect(() => {
    if (isMuted) {
      // When muted, set all pulses to 1 (no animation)
      line1Pulse.value = 1;
      line2Pulse.value = 1;
      line3Pulse.value = 1;
      return;
    }

    // Animate each dot with different phases and durations
    line1Pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 0 }),
        withTiming(1.15, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );

    line2Pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 200 }),
        withTiming(1.2, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );

    line3Pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 400 }),
        withTiming(1.25, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [isMuted, line1Pulse, line2Pulse, line3Pulse]);

  // Drive a single animated volume value and derive the individual bar heights
  // on the UI thread instead of scheduling three independent springs per sample.
  useEffect(() => {
    if (isMuted) {
      animatedVolume.value = 0;
      return;
    }

    animatedVolume.value = withTiming(volume, {
      duration: volume > animatedVolume.value ? 70 : 140,
      easing: Easing.out(Easing.cubic),
    });
  }, [animatedVolume, isMuted, volume]);

  let containerHeight: number;
  if (orientation === "horizontal") {
    containerHeight = isCompact ? 32 : 60;
  } else {
    containerHeight = isCompact ? 64 : 100;
  }

  // Create animated styles unconditionally at top level
  const line1Style = useAnimatedStyle(() => {
    const isActive = isSpeaking;
    let baseOpacity: number;
    if (isMuted) baseOpacity = 0.3;
    else if (isActive) baseOpacity = 0.9;
    else baseOpacity = 0.5;
    const currentVolume = isMuted ? 0 : animatedVolume.value;
    const currentHeight = MIN_HEIGHT + MAX_HEIGHT * currentVolume * 1.2;
    const volumeBoost = isMuted || !isActive ? 0 : currentVolume * 0.3;
    return {
      height: currentHeight * (isMuted || currentVolume > 0.001 ? 1 : line1Pulse.value),
      opacity: baseOpacity + volumeBoost,
    };
  });

  const line2Style = useAnimatedStyle(() => {
    const isActive = isSpeaking;
    let baseOpacity: number;
    if (isMuted) baseOpacity = 0.3;
    else if (isActive) baseOpacity = 0.9;
    else baseOpacity = 0.5;
    const currentVolume = isMuted ? 0 : animatedVolume.value;
    const currentHeight = MIN_HEIGHT + MAX_HEIGHT * currentVolume * 1.05;
    const volumeBoost = isMuted || !isActive ? 0 : currentVolume * 0.3;
    return {
      height: currentHeight * (isMuted || currentVolume > 0.001 ? 1 : line2Pulse.value),
      opacity: baseOpacity + volumeBoost,
    };
  });

  const line3Style = useAnimatedStyle(() => {
    const isActive = isSpeaking;
    let baseOpacity: number;
    if (isMuted) baseOpacity = 0.3;
    else if (isActive) baseOpacity = 0.9;
    else baseOpacity = 0.5;
    const currentVolume = isMuted ? 0 : animatedVolume.value;
    const currentHeight = MIN_HEIGHT + MAX_HEIGHT * currentVolume * 0.9;
    const volumeBoost = isMuted || !isActive ? 0 : currentVolume * 0.3;
    return {
      height: currentHeight * (isMuted || currentVolume > 0.001 ? 1 : line3Pulse.value),
      opacity: baseOpacity + volumeBoost,
    };
  });

  const containerStyle = useMemo(
    () => [staticStyles.container, { height: containerHeight }],
    [containerHeight],
  );
  const lineWidthStyle = useMemo(() => ({ width: LINE_WIDTH }), [LINE_WIDTH]);
  const spacerStyle = useMemo(() => ({ width: LINE_SPACING }), [LINE_SPACING]);
  // Explicit `color` overrides the themed fill. Theme fill lives on a plain View
  // child so Reanimated never receives Unistyles StyleSheet styles (see docs).
  let themedFillStyle = styles.lineFillForeground;
  if (tone === "accentForeground") {
    themedFillStyle = styles.lineFillAccentForeground;
  }
  const lineFillStyle = useMemo(
    () => (color ? [staticStyles.lineFill, { backgroundColor: color }] : themedFillStyle),
    [color, themedFillStyle],
  );
  const line1OuterStyle = useMemo(
    () => [staticStyles.line, lineWidthStyle, line1Style],
    [lineWidthStyle, line1Style],
  );
  const line2OuterStyle = useMemo(
    () => [staticStyles.line, lineWidthStyle, line2Style],
    [lineWidthStyle, line2Style],
  );
  const line3OuterStyle = useMemo(
    () => [staticStyles.line, lineWidthStyle, line3Style],
    [lineWidthStyle, line3Style],
  );

  return (
    <View style={containerStyle}>
      <ReanimatedAnimated.View style={line1OuterStyle}>
        <View style={lineFillStyle} />
      </ReanimatedAnimated.View>
      <View style={spacerStyle} />
      <ReanimatedAnimated.View style={line2OuterStyle}>
        <View style={lineFillStyle} />
      </ReanimatedAnimated.View>
      <View style={spacerStyle} />
      <ReanimatedAnimated.View style={line3OuterStyle}>
        <View style={lineFillStyle} />
      </ReanimatedAnimated.View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  lineFillForeground: {
    ...RNStyleSheet.absoluteFill,
    backgroundColor: theme.colors.foreground,
    borderRadius: 9999,
  },
  lineFillAccentForeground: {
    ...RNStyleSheet.absoluteFill,
    backgroundColor: theme.colors.accentForeground,
    borderRadius: 9999,
  },
}));

const staticStyles = RNStyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  line: {
    borderRadius: 9999,
    overflow: "hidden",
  },
  lineFill: {
    ...RNStyleSheet.absoluteFill,
    borderRadius: 9999,
  },
});
