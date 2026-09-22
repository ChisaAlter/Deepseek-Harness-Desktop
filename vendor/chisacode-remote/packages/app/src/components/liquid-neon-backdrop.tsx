import { useEffect, useMemo } from "react";
import { Platform, StyleSheet as RNStyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";

import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { buildLiquidNeonBackdropStyle } from "./liquid-neon-backdrop-style";
/**
 * Returns true on Android devices with limited GPU / memory where the
 * three-band animated SVG backdrop is likely to cause jank.
 *
 * Heuristic: Android API < 27, or total system memory < 3 GiB.
 */
function isAndroidLowEndDevice(): boolean {
  if (Platform.OS !== "android") return false;
  if (typeof Platform.Version === "number" && Platform.Version < 27) return true;

  const totalMemoryBytes: unknown = (Platform.constants as { DeviceTotalMemory?: number })
    .DeviceTotalMemory;
  if (typeof totalMemoryBytes === "number" && totalMemoryBytes < 3 * 1024 * 1024 * 1024) {
    return true;
  }

  return false;
}

// Theme-reactive values (glass toggle + surface colors) flow into this leaf
// through `uniProps` so only the backdrop node re-renders on theme changes;
// no `useUnistyles()` in the surrounding tree. See docs/unistyles.md.
const ThemedLiquidNeonBackdropGate = withUnistyles(LiquidNeonBackdropGate);

const liquidNeonBackdropUniProps = (theme: Theme) => ({
  enabled: theme.glass.enabled,
  backgroundCss: theme.colors.backgroundCss,
  surface0: theme.colors.surface0,
});

export function LiquidNeonBackdrop() {
  if (isAndroidLowEndDevice()) return null;
  return <ThemedLiquidNeonBackdropGate uniProps={liquidNeonBackdropUniProps} />;
}

function LiquidNeonBackdropGate({
  enabled,
  backgroundCss,
  surface0,
}: {
  enabled: boolean;
  backgroundCss: string;
  surface0: string;
}) {
  if (!enabled) return null;
  return <LiquidNeonBackdropAnimated backgroundCss={backgroundCss} surface0={surface0} />;
}

function LiquidNeonBackdropAnimated({
  backgroundCss,
  surface0,
}: {
  backgroundCss: string;
  surface0: string;
}) {
  const driftA = useSharedValue(0);
  const driftB = useSharedValue(0);
  const driftC = useSharedValue(0);
  const pulse = useSharedValue(0);

  useEffect(() => {
    driftA.value = withRepeat(
      withTiming(1, { duration: 18000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    driftB.value = withRepeat(
      withTiming(1, { duration: 22000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    driftC.value = withRepeat(
      withTiming(1, { duration: 26000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    pulse.value = withRepeat(
      withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [driftA, driftB, driftC, pulse]);

  const bandAStyle = useAnimatedStyle(() => ({
    opacity: 0.08 + pulse.value * 0.025,
    transform: [
      { translateX: -64 + driftA.value * 112 },
      { translateY: -18 + driftA.value * 32 },
      { scale: 1.02 + pulse.value * 0.04 },
    ],
  }));
  const bandBStyle = useAnimatedStyle(() => ({
    opacity: 0.07 + pulse.value * 0.02,
    transform: [
      { translateX: 72 - driftB.value * 128 },
      { translateY: 42 - driftB.value * 46 },
      { scale: 1.04 - pulse.value * 0.03 },
    ],
  }));
  const bandCStyle = useAnimatedStyle(() => ({
    opacity: 0.06 + pulse.value * 0.018,
    transform: [
      { translateX: -34 + driftC.value * 76 },
      { translateY: 58 - driftC.value * 74 },
      { scale: 1.08 + pulse.value * 0.025 },
    ],
  }));
  const bandACombinedStyle = useMemo(() => [staticStyles.band, bandAStyle], [bandAStyle]);
  const bandBCombinedStyle = useMemo(
    () => [staticStyles.band, staticStyles.bandB, bandBStyle],
    [bandBStyle],
  );
  const bandCCombinedStyle = useMemo(
    () => [staticStyles.band, staticStyles.bandC, bandCStyle],
    [bandCStyle],
  );
  const rootStyle = useMemo(
    () => [
      staticStyles.root,
      inlineUnistylesStyle(buildLiquidNeonBackdropStyle({ isWeb, surface0, backgroundCss })),
    ],
    [backgroundCss, surface0],
  );

  return (
    <View pointerEvents="none" style={rootStyle}>
      <Animated.View style={bandACombinedStyle}>
        <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 1200 760" width="100%">
          <Defs>
            <LinearGradient id="liquidNeonA" x1="0%" x2="100%" y1="0%" y2="100%">
              <Stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
              <Stop offset="30%" stopColor="#ffffff" stopOpacity="0.68" />
              <Stop offset="58%" stopColor="#dfe6ef" stopOpacity="0.18" />
              <Stop offset="78%" stopColor="#edf5ff" stopOpacity="0.12" />
              <Stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Path
            d="M-80 420 C 140 250, 280 620, 520 430 S 920 260, 1280 390 L 1280 610 C 940 470, 760 650, 520 560 S 120 520, -80 690 Z"
            fill="url(#liquidNeonA)"
          />
        </Svg>
      </Animated.View>
      <Animated.View style={bandBCombinedStyle}>
        <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 1200 760" width="100%">
          <Defs>
            <LinearGradient id="liquidNeonB" x1="100%" x2="0%" y1="0%" y2="100%">
              <Stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
              <Stop offset="34%" stopColor="#ffffff" stopOpacity="0.48" />
              <Stop offset="64%" stopColor="#dfe6ef" stopOpacity="0.16" />
              <Stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Path
            d="M-60 140 C 200 30, 360 280, 610 170 S 930 60, 1260 170 L 1260 320 C 940 250, 760 380, 540 300 S 160 220, -60 350 Z"
            fill="url(#liquidNeonB)"
          />
        </Svg>
      </Animated.View>
      <Animated.View style={bandCCombinedStyle}>
        <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 1200 760" width="100%">
          <Defs>
            <LinearGradient id="liquidNeonC" x1="0%" x2="100%" y1="100%" y2="0%">
              <Stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
              <Stop offset="36%" stopColor="#ffffff" stopOpacity="0.40" />
              <Stop offset="62%" stopColor="#edf5ff" stopOpacity="0.10" />
              <Stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Path
            d="M-90 520 C 150 440, 310 520, 520 470 S 880 410, 1290 480 L 1290 650 C 910 600, 710 690, 480 630 S 120 590, -90 720 Z"
            fill="url(#liquidNeonC)"
          />
        </Svg>
      </Animated.View>
      <View style={staticStyles.noiseVeil} />
    </View>
  );
}

const staticStyles = RNStyleSheet.create({
  root: {
    ...RNStyleSheet.absoluteFill,
    overflow: "hidden",
  },
  noiseVeil: {
    ...RNStyleSheet.absoluteFill,
    display: "none",
    backgroundColor: "rgba(255, 255, 255, 0.58)",
  },
  band: {
    position: "absolute",
    top: -120,
    display: "none",
    left: -120,
    width: "125%",
    height: "125%",
  },
  bandB: {
    top: 140,
    left: 160,
    width: "120%",
    height: "120%",
  },
  bandC: {
    top: 260,
    left: 80,
    width: "118%",
    height: "118%",
  },
});
