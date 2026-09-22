import { BlurView } from "expo-blur";
import { type ReactNode, useId, useMemo } from "react";
import { StyleSheet as RNStyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, {
  Defs,
  FeDisplacementMap,
  FeTurbulence,
  Filter,
  LinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import { isWeb } from "@/constants/platform";

export type GlassSurfaceVariant = "panel" | "popover" | "sheet" | "chrome";

export interface GlassSurfaceProps {
  children?: ReactNode;
  fillContent?: boolean;
  style?: StyleProp<ViewStyle>;
  variant: GlassSurfaceVariant;
}

const ThemedBlurView = withUnistyles(BlurView, (theme) => ({
  intensity: theme.glass.blurIntensity,
  tint: theme.colorScheme === "light" ? ("light" as const) : ("dark" as const),
}));

export function GlassSurface({ children, fillContent = false, style, variant }: GlassSurfaceProps) {
  const surfaceStyle = useMemo(() => [style, styles.root, styles[variant]], [style, variant]);
  const webBlurLayerStyle = useMemo(() => [styles.blurLayer, styles.webBlurLayer], []);
  const contentLayerStyle = useMemo(
    () => [styles.contentLayer, (fillContent || variant !== "popover") && styles.contentLayerFill],
    [fillContent, variant],
  );

  return (
    <View style={surfaceStyle}>
      {isWeb ? (
        <View pointerEvents="none" style={webBlurLayerStyle} />
      ) : (
        <ThemedBlurView pointerEvents="none" style={styles.blurLayer} />
      )}
      <View pointerEvents="none" style={styles.materialTint} />
      {isWeb && variant !== "popover" && variant !== "sheet" ? <WebRefractionLayer /> : null}
      <GlassEdgeLayer />
      <View pointerEvents="none" style={styles.innerShadow} />
      <View style={contentLayerStyle}>{children}</View>
    </View>
  );
}

export function createGlassSurfaceStyle(
  variant: GlassSurfaceVariant,
): (typeof styles)[GlassSurfaceVariant] {
  return styles[variant];
}

const absoluteFill = RNStyleSheet.absoluteFill;

function WebRefractionLayer() {
  const idBase = useSvgId("liquid-glass-refraction");
  const filterId = `${idBase}-filter`;
  const strokeId = `${idBase}-stroke`;

  return (
    <View pointerEvents="none" style={styles.svgLayer}>
      <Svg height="100%" preserveAspectRatio="none" width="100%">
        <Defs>
          <Filter id={filterId} x="-8%" y="-8%" width="116%" height="116%">
            <FeTurbulence baseFrequency="0.018 0.032" numOctaves="2" seed="7" type="fractalNoise" />
            <FeDisplacementMap
              in="SourceGraphic"
              scale="5"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </Filter>
          <LinearGradient id={strokeId} x1="0%" x2="100%" y1="0%" y2="100%">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <Stop offset="28%" stopColor="#ffffff" stopOpacity="0.30" />
            <Stop offset="54%" stopColor="#adc9ea" stopOpacity="0.10" />
            <Stop offset="78%" stopColor="#ffffff" stopOpacity="0.24" />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Path
          d="M-8 36 C 22 6, 80 8, 130 20 S 240 40, 300 18"
          filter={`url(#${filterId})`}
          fill="none"
          stroke={`url(#${strokeId})`}
          strokeWidth="14"
          strokeLinecap="round"
          opacity="0.24"
        />
        <Path
          d="M8 96 C 70 118, 142 72, 208 92 S 304 130, 360 88"
          filter={`url(#${filterId})`}
          fill="none"
          stroke={`url(#${strokeId})`}
          strokeWidth="10"
          strokeLinecap="round"
          opacity="0.14"
        />
      </Svg>
    </View>
  );
}

function GlassEdgeLayer() {
  const idBase = useSvgId("liquid-glass-edge");
  const topSheenId = `${idBase}-top`;
  const bottomShadeId = `${idBase}-bottom`;
  const sideShadeId = `${idBase}-side`;
  const causticId = `${idBase}-caustic`;

  return (
    <View pointerEvents="none" style={styles.svgLayer}>
      <Svg height="100%" preserveAspectRatio="none" width="100%">
        <Defs>
          <LinearGradient id={topSheenId} x1="0%" x2="100%" y1="0%" y2="0%">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity="0.08" />
            <Stop offset="20%" stopColor="#ffffff" stopOpacity="0.72" />
            <Stop offset="58%" stopColor="#ffffff" stopOpacity="0.24" />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity="0.02" />
          </LinearGradient>
          <LinearGradient id={bottomShadeId} x1="0%" x2="100%" y1="100%" y2="0%">
            <Stop offset="0%" stopColor="#3c3c43" stopOpacity="0.16" />
            <Stop offset="52%" stopColor="#ffffff" stopOpacity="0.04" />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id={sideShadeId} x1="0%" x2="100%" y1="0%" y2="0%">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity="0.24" />
            <Stop offset="50%" stopColor="#ffffff" stopOpacity="0" />
            <Stop offset="100%" stopColor="#3c3c43" stopOpacity="0.08" />
          </LinearGradient>
          <LinearGradient id={causticId} x1="0%" x2="100%" y1="0%" y2="100%">
            <Stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <Stop offset="45%" stopColor="#ffffff" stopOpacity="0.28" />
            <Stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="2" fill={`url(#${topSheenId})`} />
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${sideShadeId})`} opacity="0.48" />
        <Rect x="0" y="98%" width="100%" height="2%" fill={`url(#${bottomShadeId})`} />
        <Path
          d="M-20 18 C 48 2, 118 14, 178 7 S 284 0, 360 16"
          fill="none"
          stroke={`url(#${causticId})`}
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.30"
        />
        <Path
          d="M-12 54 C 52 72, 112 36, 180 52 S 284 84, 368 46"
          fill="none"
          stroke={`url(#${causticId})`}
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.16"
        />
      </Svg>
    </View>
  );
}

function useSvgId(prefix: string) {
  const reactId = useId();
  return `${prefix}-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

const styles = StyleSheet.create((theme) => ({
  root: theme.glass.enabled
    ? {
        position: "relative" as const,
        borderWidth: theme.borderWidth[1],
        borderColor: theme.glass.border,
        overflow: "hidden" as const,
        ...theme.shadow.sm,
      }
    : {},
  panel: theme.glass.enabled
    ? {
        backgroundColor: theme.glass.panel,
      }
    : {},
  popover: theme.glass.enabled
    ? {
        backgroundColor: theme.glass.popover,
        borderColor: theme.glass.border,
      }
    : {},
  sheet: theme.glass.enabled
    ? {
        backgroundColor: theme.glass.sheet,
      }
    : {},
  chrome: theme.glass.enabled
    ? {
        backgroundColor: theme.glass.chrome,
      }
    : {},
  blurLayer: {
    ...absoluteFill,
    display: theme.glass.enabled ? "flex" : "none",
  },
  webBlurLayer: {
    backgroundColor: "rgba(255, 255, 255, 0.015)",
    backdropFilter:
      "blur(30px) saturate(1.18) brightness(1.03)" as unknown as ViewStyle["backfaceVisibility"],
  },
  materialTint: {
    ...absoluteFill,
    display: theme.glass.enabled ? "flex" : "none",
    backgroundColor: theme.glass.tint,
  },
  svgLayer: {
    ...absoluteFill,
    display: theme.glass.enabled ? "flex" : "none",
  },
  innerShadow: {
    ...absoluteFill,
    display: theme.glass.enabled ? "flex" : "none",
    borderWidth: theme.borderWidth[1],
    borderTopColor: theme.glass.highlight,
    borderLeftColor: theme.glass.highlight,
    borderRightColor: theme.glass.edge,
    borderBottomColor: theme.glass.innerShadow,
    opacity: 0.86,
  },
  contentLayer: {
    position: "relative",
    zIndex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  contentLayerFill: {
    flex: 1,
  },
}));
