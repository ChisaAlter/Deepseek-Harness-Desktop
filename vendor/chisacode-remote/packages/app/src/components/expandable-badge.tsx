import {
  Pressable,
  StyleSheet as RNStyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import * as React from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import MaskedView from "@react-native-masked-view/masked-view";
import { ChevronRight, FileSymlink, TriangleAlertIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from "react-native-svg";
import { StyleSheet } from "react-native-unistyles";

import { ThemedIconHost } from "@/components/themed-icon-host";
import { isNative, isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { getExpandableBadgeLayoutStyles } from "./message-layout";

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const mutedForegroundColorMapping = (theme: Theme) => ({
  color: theme.colors.mutedForeground,
});
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });
const MessageOuterSpacingContext = createContext(false);

/** Provides a default outer-spacing policy for grouped timeline messages. */
export function MessageOuterSpacingProvider({
  disableOuterSpacing,
  children,
}: {
  disableOuterSpacing: boolean;
  children: ReactNode;
}) {
  return (
    <MessageOuterSpacingContext.Provider value={disableOuterSpacing}>
      {children}
    </MessageOuterSpacingContext.Provider>
  );
}

/** Resolves explicit message spacing against the nearest provider default. */
export function useDisableOuterSpacing(disableOuterSpacing: boolean | undefined) {
  const contextValue = useContext(MessageOuterSpacingContext);
  return disableOuterSpacing ?? contextValue;
}

const WEB_TOOLCALL_SHIMMER_KEYFRAME_ID = "chisacode-toolcall-shimmer-keyframes";
const WEB_TOOLCALL_SHIMMER_ANIMATION_NAME = "chisacode-toolcall-shimmer";
const WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS = `
  @keyframes ${WEB_TOOLCALL_SHIMMER_ANIMATION_NAME} {
    0% {
      background-position: var(--chisacode-shimmer-start, -200px) 0;
    }
    100% {
      background-position: var(--chisacode-shimmer-end, 200px) 0;
    }
  }
`;
let webToolCallShimmerRegistered = false;
const SCROLL_EDGE_EPSILON = 0.5;

type ScrollAxis = "x" | "y";

function ensureWebToolCallShimmerKeyframes() {
  if (isNative) {
    return;
  }
  if (typeof document === "undefined") {
    return;
  }
  const existing = document.getElementById(WEB_TOOLCALL_SHIMMER_KEYFRAME_ID);
  if (existing) {
    if (existing.textContent !== WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS) {
      existing.textContent = WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS;
    }
    webToolCallShimmerRegistered = true;
    return;
  }
  if (webToolCallShimmerRegistered) {
    return;
  }
  const styleElement = document.createElement("style");
  styleElement.id = WEB_TOOLCALL_SHIMMER_KEYFRAME_ID;
  styleElement.textContent = WEB_TOOLCALL_SHIMMER_KEYFRAME_CSS;
  document.head.appendChild(styleElement);
  webToolCallShimmerRegistered = true;
}

function getWheelEventElementTarget(event: WheelEvent, fallback: HTMLElement): HTMLElement {
  const { target } = event;
  if (target instanceof HTMLElement) {
    return target;
  }
  if (target instanceof Node && target.parentElement) {
    return target.parentElement;
  }
  return fallback;
}

function canElementScrollInDirection(
  element: HTMLElement,
  axis: ScrollAxis,
  delta: number,
): boolean {
  if (delta === 0) {
    return false;
  }

  const computedStyle = window.getComputedStyle(element);
  const overflow = axis === "x" ? computedStyle.overflowX : computedStyle.overflowY;
  const isScrollableOverflow =
    overflow === "auto" || overflow === "scroll" || overflow === "overlay";
  if (!isScrollableOverflow) {
    return false;
  }

  const scrollPosition = axis === "x" ? element.scrollLeft : element.scrollTop;
  const scrollSize =
    axis === "x"
      ? element.scrollWidth - element.clientWidth
      : element.scrollHeight - element.clientHeight;
  if (scrollSize <= SCROLL_EDGE_EPSILON) {
    return false;
  }

  if (delta > 0) {
    return scrollPosition < scrollSize - SCROLL_EDGE_EPSILON;
  }
  return scrollPosition > SCROLL_EDGE_EPSILON;
}

function canScrollInsideDetailFromTarget(
  detailRoot: HTMLElement,
  startElement: HTMLElement,
  axis: ScrollAxis,
  delta: number,
): boolean {
  if (delta === 0) {
    return false;
  }

  let current: HTMLElement | null = startElement;
  while (current) {
    if (canElementScrollInDirection(current, axis, delta)) {
      return true;
    }
    if (current === detailRoot) {
      break;
    }
    current = current.parentElement;
  }
  return false;
}

function shouldStopDetailWheelPropagation(detailRoot: HTMLElement, event: WheelEvent): boolean {
  const startElement = getWheelEventElementTarget(event, detailRoot);
  const verticalDelta = event.deltaY;
  let horizontalDelta: number;
  if (event.deltaX !== 0) horizontalDelta = event.deltaX;
  else if (event.shiftKey) horizontalDelta = event.deltaY;
  else horizontalDelta = 0;

  const hasVerticalIntent = Math.abs(verticalDelta) > SCROLL_EDGE_EPSILON;
  const hasHorizontalIntent = Math.abs(horizontalDelta) > SCROLL_EDGE_EPSILON;
  if (!hasVerticalIntent && !hasHorizontalIntent) {
    return false;
  }

  const canScrollVertically = hasVerticalIntent
    ? canScrollInsideDetailFromTarget(detailRoot, startElement, "y", verticalDelta)
    : false;
  const canScrollHorizontally = hasHorizontalIntent
    ? canScrollInsideDetailFromTarget(detailRoot, startElement, "x", horizontalDelta)
    : false;

  if (hasVerticalIntent && hasHorizontalIntent) {
    const isVerticalDominant = Math.abs(verticalDelta) >= Math.abs(horizontalDelta);
    return isVerticalDominant
      ? canScrollVertically || canScrollHorizontally
      : canScrollHorizontally || canScrollVertically;
  }

  if (hasVerticalIntent) {
    return canScrollVertically;
  }
  return canScrollHorizontally;
}

const expandableBadgeBaseLayout = getExpandableBadgeLayoutStyles();

const expandableBadgeStylesheet = StyleSheet.create((theme) => ({
  container: {
    ...expandableBadgeBaseLayout.container,
  },
  workbenchContainer: {
    width: "auto",
    maxWidth: 220,
    alignSelf: "flex-start",
  },
  containerSpacing: {
    marginBottom: theme.spacing[1],
  },
  containerLastInSequence: {
    marginBottom: theme.spacing[4],
  },
  // Soft .tool: pad 12 14, r-md, surface + --shadow-soft, 13px body.
  pressable: {
    borderRadius: 12,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    paddingHorizontal: 14,
    paddingVertical: 12,
    overflow: "hidden",
    ...(isWeb
      ? ({
          boxShadow: "0 1px 2px rgba(20, 23, 31, 0.04), 0 8px 24px rgba(20, 23, 31, 0.06)",
        } as object)
      : {}),
  },
  workbenchPressable: {
    height: 28,
    minHeight: 28,
    paddingHorizontal: 7,
    paddingVertical: 0,
    borderRadius: 10,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceWorkspace,
    ...(isWeb ? ({ boxShadow: "none" } as object) : {}),
  },
  pressablePressed: {
    opacity: 0.9,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  workbenchHeaderRow: {
    height: 28,
  },
  labelRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  iconBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginRight: theme.spacing[1],
    backgroundColor: "transparent",
  },
  workbenchIconBadge: {
    width: 12,
    height: 28,
    borderRadius: 0,
    marginRight: 4,
  },
  // Soft .tool .th / body: 13px.
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: theme.fontWeight.normal,
    flexShrink: 0,
  },
  workbenchLabel: {
    fontFamily: isWeb ? "system-ui" : undefined,
    fontSize: 12.5,
    lineHeight: 16,
  },
  labelActive: {
    color: theme.colors.foreground,
  },
  labelLoading: {
    color: theme.colors.foreground,
    opacity: 0.72,
  },
  // Soft .tool .meta: mono-ish muted 12.
  secondaryLabel: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
    marginLeft: theme.spacing[2],
  },
  workbenchSecondaryLabel: {
    fontFamily: isWeb ? "system-ui" : undefined,
    fontSize: 12.5,
    lineHeight: 16,
    marginLeft: 4,
  },
  secondaryLabelActive: {
    color: theme.colors.foreground,
  },
  shimmerText: {
    color: "transparent",
    fontSize: 14.5,
    fontWeight: theme.fontWeight.normal,
  },
  spacer: {
    flex: 1,
  },
  chevron: {
    flexShrink: 0,
    transform: [{ scale: 1.3 }],
  },
  openFileButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: theme.spacing[1],
    borderRadius: 10,
    flexShrink: 0,
  },
  openFileButtonPlaceholderIcon: {
    width: 14,
    height: 14,
  },
  chevronExpanded: {
    transform: [{ scale: 1.3 }, { rotate: "90deg" }],
  },
  detailWrapper: {
    ...expandableBadgeBaseLayout.detailWrapper,
    // Soft .tool expanded: match --r-md (12).
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    borderWidth: theme.borderWidth[1],
    borderTopWidth: 0,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    padding: 0,
    gap: 0,
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
    ...(isWeb ? { cursor: "auto" as const, userSelect: "text" as const } : {}),
  },
  pressableExpanded: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  shimmerOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  shimmerMaskRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    height: "100%",
  },
  nativeShimmerTrack: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: "hidden",
  },
}));

interface NativeExpandableBadgeShimmerProps {
  label: string;
  secondaryLabel?: string;
  rowWidth: number;
  rowHeight: number;
  peakWidth: number;
  durationSeconds: number;
  gradientId: string;
}

const NativeExpandableBadgeShimmer = memo(function NativeExpandableBadgeShimmer({
  label,
  secondaryLabel,
  rowWidth,
  rowHeight,
  peakWidth,
  durationSeconds,
  gradientId,
}: NativeExpandableBadgeShimmerProps) {
  const shimmerTranslateX = useSharedValue(0);

  useEffect(() => {
    const startPosition = -peakWidth;
    const endPosition = rowWidth + peakWidth;
    shimmerTranslateX.value = startPosition;
    shimmerTranslateX.value = withRepeat(
      withTiming(endPosition, {
        duration: durationSeconds * 1000,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(shimmerTranslateX);
    };
  }, [durationSeconds, peakWidth, rowWidth, shimmerTranslateX]);

  const nativeShimmerPeakStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerTranslateX.value }],
  }));

  const nativeShimmerTrackStyle = useMemo(
    () => [expandableBadgeStylesheet.nativeShimmerTrack, { width: rowWidth, height: rowHeight }],
    [rowHeight, rowWidth],
  );

  const nativeShimmerMaskStyle = useMemo(
    () => [expandableBadgeStylesheet.shimmerMaskRow, { width: rowWidth, height: rowHeight }],
    [rowHeight, rowWidth],
  );

  const nativeLabelMaskStyle = useMemo(
    () => [expandableBadgeStylesheet.label, { color: "#000000", opacity: 1 }],
    [],
  );

  const nativeSecondaryMaskStyle = useMemo(
    () => [expandableBadgeStylesheet.secondaryLabel, { color: "#000000", opacity: 1 }],
    [],
  );

  const nativeShimmerPeakCombinedStyle = useMemo(
    () => [
      staticStyles.nativeShimmerPeak,
      nativeShimmerPeakStyle,
      { width: peakWidth, height: rowHeight },
    ],
    [nativeShimmerPeakStyle, peakWidth, rowHeight],
  );

  const maskElement = useMemo(
    () => (
      <View pointerEvents="none" style={nativeShimmerMaskStyle}>
        <Text style={nativeLabelMaskStyle} numberOfLines={1}>
          {label}
        </Text>
        {secondaryLabel ? (
          <Text style={nativeSecondaryMaskStyle} numberOfLines={1}>
            {secondaryLabel}
          </Text>
        ) : (
          <View style={expandableBadgeStylesheet.spacer} />
        )}
      </View>
    ),
    [nativeShimmerMaskStyle, nativeLabelMaskStyle, nativeSecondaryMaskStyle, label, secondaryLabel],
  );

  return (
    <View style={expandableBadgeStylesheet.shimmerOverlay} pointerEvents="none">
      <MaskedView pointerEvents="none" style={nativeShimmerTrackStyle} maskElement={maskElement}>
        <View pointerEvents="none" style={nativeShimmerTrackStyle}>
          <Animated.View pointerEvents="none" style={nativeShimmerPeakCombinedStyle}>
            <NativeShimmerPeakSvg gradientId={gradientId} />
          </Animated.View>
        </View>
      </MaskedView>
    </View>
  );
});

const staticStyles = RNStyleSheet.create({
  nativeShimmerPeak: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
});

function NativeShimmerPeakSvg({ gradientId }: { gradientId: string }) {
  return (
    <Svg width="100%" height="100%" preserveAspectRatio="none">
      <Defs>
        <SvgLinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <Stop offset="0%" stopColor="#ffffff" stopOpacity={0} />
          <Stop offset="50%" stopColor="#ffffff" stopOpacity={1} />
          <Stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
        </SvgLinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

interface ExpandableBadgeProps {
  label: string;
  secondaryLabel?: string;
  icon?: ComponentType<{ size?: number; color?: string }>;
  isExpanded: boolean;
  style?: StyleProp<ViewStyle>;
  presentation?: "default" | "workbench";
  onToggle?: () => void;
  onOpenFile?: () => void;
  onDetailHoverChange?: (hovered: boolean) => void;
  renderDetails?: () => ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  isLastInSequence?: boolean;
  disableOuterSpacing?: boolean;
  testID?: string;
}

interface ExpandableBadgeSecondaryLabelProps {
  secondaryLabel?: string;
  secondaryLabelStyle: StyleProp<TextStyle>;
  shouldMeasureWebShimmer: boolean;
  onSecondaryLayout: (event: LayoutChangeEvent) => void;
}

function ExpandableBadgeSecondaryLabel({
  secondaryLabel,
  secondaryLabelStyle,
  shouldMeasureWebShimmer,
  onSecondaryLayout,
}: ExpandableBadgeSecondaryLabelProps) {
  if (!secondaryLabel) {
    return null;
  }
  return (
    <Text
      style={secondaryLabelStyle}
      numberOfLines={1}
      onLayout={shouldMeasureWebShimmer ? onSecondaryLayout : undefined}
    >
      {secondaryLabel}
    </Text>
  );
}

interface ExpandableBadgeWebShimmerOverlayProps {
  label: string;
  secondaryLabel?: string;
  shimmerLabelTextStyle: StyleProp<TextStyle>;
  shimmerSecondaryTextStyle: StyleProp<TextStyle>;
  showOpenFileButton: boolean;
}

function ExpandableBadgeWebShimmerOverlay({
  label,
  secondaryLabel,
  shimmerLabelTextStyle,
  shimmerSecondaryTextStyle,
  showOpenFileButton,
}: ExpandableBadgeWebShimmerOverlayProps) {
  return (
    <View style={expandableBadgeStylesheet.shimmerOverlay} pointerEvents="none">
      <Text style={shimmerLabelTextStyle} numberOfLines={1}>
        {label}
      </Text>
      {secondaryLabel ? (
        <Text style={shimmerSecondaryTextStyle} numberOfLines={1}>
          {secondaryLabel}
        </Text>
      ) : null}
      {showOpenFileButton ? (
        <View style={expandableBadgeStylesheet.openFileButton}>
          <View style={expandableBadgeStylesheet.openFileButtonPlaceholderIcon} />
        </View>
      ) : null}
      {!secondaryLabel && !showOpenFileButton ? (
        <View style={expandableBadgeStylesheet.spacer} />
      ) : null}
    </View>
  );
}

interface ExpandableBadgeLabelRowProps {
  label: string;
  labelStyle: StyleProp<TextStyle>;
  secondaryLabel?: string;
  secondaryLabelStyle: StyleProp<TextStyle>;
  shouldMeasureWebShimmer: boolean;
  shouldMeasureNativeShimmer: boolean;
  isWebShimmer: boolean;
  isNativeShimmer: boolean;
  shimmerLabelTextStyle: StyleProp<TextStyle>;
  shimmerSecondaryTextStyle: StyleProp<TextStyle>;
  labelRowWidth: number;
  labelRowHeight: number;
  nativeShimmerPeakWidth: number;
  shimmerDuration: number;
  nativeGradientId: string;
  onLabelRowLayout: (event: LayoutChangeEvent) => void;
  onLabelLayout: (event: LayoutChangeEvent) => void;
  onSecondaryLayout: (event: LayoutChangeEvent) => void;
  showOpenFileButton: boolean;
  isOpenFileHovered: boolean;
  onOpenFilePress: (event: GestureResponderEvent) => void;
  onOpenFileHoverIn: () => void;
  onOpenFileHoverOut: () => void;
}

function ExpandableBadgeLabelRow({
  label,
  labelStyle,
  secondaryLabel,
  secondaryLabelStyle,
  shouldMeasureWebShimmer,
  shouldMeasureNativeShimmer,
  isWebShimmer,
  isNativeShimmer,
  shimmerLabelTextStyle,
  shimmerSecondaryTextStyle,
  labelRowWidth,
  labelRowHeight,
  nativeShimmerPeakWidth,
  shimmerDuration,
  nativeGradientId,
  onLabelRowLayout,
  onLabelLayout,
  onSecondaryLayout,
  showOpenFileButton,
  isOpenFileHovered,
  onOpenFilePress,
  onOpenFileHoverIn,
  onOpenFileHoverOut,
}: ExpandableBadgeLabelRowProps) {
  const { t } = useTranslation();
  return (
    <View
      style={expandableBadgeStylesheet.labelRow}
      onLayout={shouldMeasureNativeShimmer ? onLabelRowLayout : undefined}
    >
      <Text
        style={labelStyle}
        numberOfLines={1}
        onLayout={shouldMeasureWebShimmer ? onLabelLayout : undefined}
      >
        {label}
      </Text>
      <ExpandableBadgeSecondaryLabel
        secondaryLabel={secondaryLabel}
        secondaryLabelStyle={secondaryLabelStyle}
        shouldMeasureWebShimmer={shouldMeasureWebShimmer}
        onSecondaryLayout={onSecondaryLayout}
      />
      {showOpenFileButton ? (
        <Pressable
          onPress={onOpenFilePress}
          onHoverIn={onOpenFileHoverIn}
          onHoverOut={onOpenFileHoverOut}
          accessibilityRole="button"
          accessibilityLabel={t("message.openFile")}
          testID="tool-call-open-file"
          style={expandableBadgeStylesheet.openFileButton}
          hitSlop={6}
        >
          <ThemedIconHost
            Icon={FileSymlink}
            size={14}
            uniProps={isOpenFileHovered ? foregroundColorMapping : foregroundMutedColorMapping}
          />
        </Pressable>
      ) : null}
      {isWebShimmer ? (
        <ExpandableBadgeWebShimmerOverlay
          label={label}
          secondaryLabel={secondaryLabel}
          shimmerLabelTextStyle={shimmerLabelTextStyle}
          shimmerSecondaryTextStyle={shimmerSecondaryTextStyle}
          showOpenFileButton={showOpenFileButton}
        />
      ) : null}
      {isNativeShimmer ? (
        <NativeExpandableBadgeShimmer
          label={label}
          secondaryLabel={secondaryLabel}
          rowWidth={labelRowWidth}
          rowHeight={labelRowHeight}
          peakWidth={nativeShimmerPeakWidth}
          durationSeconds={shimmerDuration}
          gradientId={nativeGradientId}
        />
      ) : null}
    </View>
  );
}

// HACK: lucide ships every icon inside a 24×24 viewBox where the path
// doesn't touch the edges — there's per-icon internal padding. The layout
// already places the SVG element's box on the rail, but the visible glyph
// inside the SVG sits inset by a few pixels (and the inset amount differs
// per icon — chevron-right paints only in the right half of its viewBox,
// regular tool icons paint roughly the full viewBox minus ~1 unit margin).
//
// Lucide has no viewBox knob, so the only way to nudge the visible glyph
// flush with the rail is a per-icon negative margin. Cosmetic; not exact —
// every lucide icon has slightly different padding and we're not measuring
// each one. Two buckets is the compromise:
//   - LUCIDE_TOOL_ICON_NUDGE_LEFT: regular tool icons (path mostly fills
//     the viewBox); needs ~1px left shift.
//   - LUCIDE_CHEVRON_NUDGE_LEFT: chevron-right (path in right half of
//     viewBox, and we scale it 1.3×); needs ~4px left shift.
// If we ever want this exact, the principled fix is a custom <Svg> wrapper
// with a tight viewBox per icon — see option (2) in the design discussion.
const LUCIDE_TOOL_ICON_NUDGE_LEFT: ViewStyle = { marginLeft: -1 };
const LUCIDE_CHEVRON_NUDGE_LEFT: ViewStyle = { marginLeft: -4 };
const ERROR_ICON_STYLE: ViewStyle = { marginLeft: -1, opacity: 0.8 };
const WORKBENCH_CHEVRON_DOWN_STYLE: ViewStyle = {
  marginLeft: -1,
  transform: [{ rotate: "90deg" }],
};

type ThemedBadgeIcon = ComponentType<{ size?: number; color?: string }>;

function renderExpandableBadgeIcon({
  isError,
  isActive,
  icon,
}: {
  isError: boolean;
  isActive: boolean;
  icon: ThemedBadgeIcon | undefined;
}): ReactNode {
  if (isError) {
    return (
      <View style={ERROR_ICON_STYLE}>
        <ThemedIconHost Icon={TriangleAlertIcon} size={12} uniProps={destructiveColorMapping} />
      </View>
    );
  }
  if (icon) {
    return (
      <View style={LUCIDE_TOOL_ICON_NUDGE_LEFT}>
        <ThemedIconHost
          Icon={icon as ComponentType<{ color: string; size: number }>}
          size={12}
          uniProps={isActive ? foregroundColorMapping : mutedForegroundColorMapping}
        />
      </View>
    );
  }
  return null;
}

function renderExpandableBadgeIconSlot({
  showChevron,
  chevronStyle,
  iconNode,
}: {
  showChevron: boolean;
  chevronStyle: StyleProp<ViewStyle>;
  iconNode: ReactNode;
}): ReactNode {
  if (showChevron) {
    return (
      <View style={chevronStyle}>
        <ThemedIconHost Icon={ChevronRight} size={12} uniProps={foregroundColorMapping} />
      </View>
    );
  }
  return iconNode;
}

function computeShimmerMetrics(input: {
  label: string;
  secondaryLabel: string | undefined;
  isLoading: boolean;
  labelRowWidth: number;
  labelRowHeight: number;
  labelOffsetX: number;
  labelWidth: number;
  secondaryOffsetX: number;
  secondaryWidth: number;
}) {
  const totalShimmerChars = input.label.trim().length + (input.secondaryLabel?.trim().length ?? 0);
  const shortTextDurationAdjustment = totalShimmerChars <= 12 ? 0.25 : 0;
  const shimmerDuration = Math.max(
    1,
    Math.min(2.3, 1.25 + totalShimmerChars * 0.008 - shortTextDurationAdjustment),
  );
  const nativeShimmerPeakWidth = Math.max(
    32,
    Math.min(120, input.labelRowWidth > 0 ? input.labelRowWidth * 0.28 : 0),
  );
  const isWebShimmer = input.isLoading && isWeb;
  const shouldMeasureWebShimmer = isWebShimmer;
  const shouldMeasureNativeShimmer = input.isLoading && isNative;
  const isNativeShimmer =
    shouldMeasureNativeShimmer && input.labelRowWidth > 0 && input.labelRowHeight > 0;
  const webShimmerSpanStartX = input.labelOffsetX;
  const webShimmerSpanEndX = input.secondaryLabel
    ? input.secondaryOffsetX + input.secondaryWidth
    : input.labelOffsetX + input.labelWidth;
  const webShimmerSpanWidth = Math.max(1, webShimmerSpanEndX - webShimmerSpanStartX);
  const webShimmerPeakWidth = Math.max(42, Math.min(120, webShimmerSpanWidth * 0.22));
  const webShimmerTrackStart = webShimmerSpanStartX - webShimmerPeakWidth;
  const webShimmerTrackEnd = webShimmerSpanEndX;
  return {
    shimmerDuration,
    nativeShimmerPeakWidth,
    isWebShimmer,
    shouldMeasureWebShimmer,
    shouldMeasureNativeShimmer,
    isNativeShimmer,
    webShimmerPeakWidth,
    webShimmerTrackStart,
    webShimmerTrackEnd,
  };
}

function useDetailWheelPropagationBlocker(input: {
  detailWrapperRef: React.RefObject<View | null>;
  enabled: boolean;
}): void {
  const { detailWrapperRef, enabled } = input;
  useEffect(() => {
    if (!enabled) {
      return () => {};
    }
    const rawRef: unknown = detailWrapperRef.current;
    if (!(rawRef instanceof HTMLElement)) {
      return () => {};
    }
    const node = rawRef;
    const stopWheelPropagation = (event: WheelEvent) => {
      if (shouldStopDetailWheelPropagation(node, event)) {
        event.stopPropagation();
      }
    };
    node.addEventListener("wheel", stopWheelPropagation, { passive: true });
    return () => {
      node.removeEventListener("wheel", stopWheelPropagation);
    };
  }, [detailWrapperRef, enabled]);
}

const SHIMMER_GRADIENT =
  "linear-gradient(90deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.45) 24%, #ffffff 40%, #ffffff 60%, rgba(255, 255, 255, 0.45) 76%, rgba(255, 255, 255, 0) 100%)";

function buildShimmerTextStyle(input: {
  isWebShimmer: boolean;
  webShimmerPeakWidth: number;
  shimmerDuration: number;
  webShimmerTrackStart: number;
  webShimmerTrackEnd: number;
  offsetX: number;
}): object | null {
  if (!input.isWebShimmer) return null;
  return {
    opacity: 1,
    color: "transparent",
    backgroundImage: SHIMMER_GRADIENT,
    backgroundSize: `${input.webShimmerPeakWidth}px 100%`,
    backgroundRepeat: "no-repeat",
    backgroundClip: "text",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    animation: `${WEB_TOOLCALL_SHIMMER_ANIMATION_NAME} ${input.shimmerDuration}s linear infinite`,
    "--chisacode-shimmer-start": `${input.webShimmerTrackStart - input.offsetX}px`,
    "--chisacode-shimmer-end": `${input.webShimmerTrackEnd - input.offsetX}px`,
  };
}

/** Renders a compact expandable row shared by tool calls and task summaries. */
export const ExpandableBadge = memo(function ExpandableBadge({
  label,
  style,
  presentation = "default",
  secondaryLabel,
  icon,
  isExpanded,
  onToggle,
  onOpenFile,
  onDetailHoverChange,
  renderDetails,
  isLoading = false,
  isError = false,
  isLastInSequence = false,
  disableOuterSpacing,
  testID,
}: ExpandableBadgeProps) {
  const resolvedDisableOuterSpacing = useDisableOuterSpacing(disableOuterSpacing);
  const [isHovered, setIsHovered] = useState(false);
  const [isOpenFileHovered, setIsOpenFileHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const isInteractive = Boolean(onToggle);
  const hasDetailContent = Boolean(renderDetails);
  const detailContent = hasDetailContent && isExpanded ? renderDetails?.() : null;
  const detailWrapperRef = useRef<View | null>(null);

  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => {
    setIsHovered(false);
    setIsPressed(false);
  }, []);
  const handlePressIn = useCallback(() => setIsPressed(true), []);
  const handlePressOut = useCallback(() => setIsPressed(false), []);
  const handleDetailHoverIn = useCallback(() => onDetailHoverChange?.(true), [onDetailHoverChange]);
  const handleDetailHoverOut = useCallback(
    () => onDetailHoverChange?.(false),
    [onDetailHoverChange],
  );
  const handleOpenFilePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation?.();
      onOpenFile?.();
    },
    [onOpenFile],
  );
  const handleOpenFileHoverIn = useCallback(() => setIsOpenFileHovered(true), []);
  const handleOpenFileHoverOut = useCallback(() => setIsOpenFileHovered(false), []);

  const nativeGradientIdRef = useRef(
    `shimmer-gradient-${Math.random().toString(36).substring(2, 9)}`,
  );
  const [labelRowWidth, setLabelRowWidth] = useState(0);
  const [labelRowHeight, setLabelRowHeight] = useState(0);
  const [labelOffsetX, setLabelOffsetX] = useState(0);
  const [labelWidth, setLabelWidth] = useState(0);
  const [secondaryOffsetX, setSecondaryOffsetX] = useState(0);
  const [secondaryWidth, setSecondaryWidth] = useState(0);

  const {
    shimmerDuration,
    nativeShimmerPeakWidth,
    isWebShimmer,
    shouldMeasureWebShimmer,
    shouldMeasureNativeShimmer,
    isNativeShimmer,
    webShimmerPeakWidth,
    webShimmerTrackStart,
    webShimmerTrackEnd,
  } = computeShimmerMetrics({
    label,
    secondaryLabel,
    isLoading,
    labelRowWidth,
    labelRowHeight,
    labelOffsetX,
    labelWidth,
    secondaryOffsetX,
    secondaryWidth,
  });

  const handleLabelRowLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (!shouldMeasureNativeShimmer) {
        return;
      }
      const { width, height } = event.nativeEvent.layout;
      setLabelRowWidth((previous) => (Math.abs(previous - width) > 0.5 ? width : previous));
      setLabelRowHeight((previous) => (Math.abs(previous - height) > 0.5 ? height : previous));
    },
    [shouldMeasureNativeShimmer],
  );

  const handleLabelLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (!shouldMeasureWebShimmer) {
        return;
      }
      const { x, width } = event.nativeEvent.layout;
      setLabelOffsetX((previous) => (Math.abs(previous - x) > 0.5 ? x : previous));
      setLabelWidth((previous) => (Math.abs(previous - width) > 0.5 ? width : previous));
    },
    [shouldMeasureWebShimmer],
  );

  const handleSecondaryLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (!shouldMeasureWebShimmer || !secondaryLabel) {
        return;
      }
      const { x, width } = event.nativeEvent.layout;
      setSecondaryOffsetX((previous) => (Math.abs(previous - x) > 0.5 ? x : previous));
      setSecondaryWidth((previous) => (Math.abs(previous - width) > 0.5 ? width : previous));
    },
    [shouldMeasureWebShimmer, secondaryLabel],
  );

  useEffect(() => {
    if (!isWebShimmer) {
      return;
    }
    ensureWebToolCallShimmerKeyframes();
  }, [isWebShimmer]);

  useDetailWheelPropagationBlocker({
    detailWrapperRef,
    enabled: !isNative && isExpanded && hasDetailContent,
  });

  const shimmerLabelStyle = useMemo<StyleProp<TextStyle>>(
    () =>
      buildShimmerTextStyle({
        isWebShimmer,
        webShimmerPeakWidth,
        shimmerDuration,
        webShimmerTrackStart,
        webShimmerTrackEnd,
        offsetX: labelOffsetX,
      }),
    [
      isWebShimmer,
      webShimmerPeakWidth,
      shimmerDuration,
      webShimmerTrackStart,
      webShimmerTrackEnd,
      labelOffsetX,
    ],
  );

  const shimmerSecondaryStyle = useMemo<StyleProp<TextStyle>>(
    () =>
      buildShimmerTextStyle({
        isWebShimmer,
        webShimmerPeakWidth,
        shimmerDuration,
        webShimmerTrackStart,
        webShimmerTrackEnd,
        offsetX: secondaryOffsetX,
      }),
    [
      isWebShimmer,
      webShimmerPeakWidth,
      shimmerDuration,
      webShimmerTrackStart,
      webShimmerTrackEnd,
      secondaryOffsetX,
    ],
  );

  const containerStyle = useMemo(
    () => [
      expandableBadgeStylesheet.container,
      presentation === "workbench" && !isExpanded
        ? expandableBadgeStylesheet.workbenchContainer
        : null,
      !resolvedDisableOuterSpacing &&
        (isLastInSequence
          ? expandableBadgeStylesheet.containerLastInSequence
          : expandableBadgeStylesheet.containerSpacing),
      style,
    ],
    [isExpanded, isLastInSequence, presentation, resolvedDisableOuterSpacing, style],
  );

  const pressableStyle = useMemo(
    () => [
      expandableBadgeStylesheet.pressable,
      presentation === "workbench" ? expandableBadgeStylesheet.workbenchPressable : null,
      isPressed && isInteractive ? expandableBadgeStylesheet.pressablePressed : null,
      isExpanded && expandableBadgeStylesheet.pressableExpanded,
    ],
    [isExpanded, isInteractive, isPressed, presentation],
  );

  const headerRowStyle = useMemo(
    () => [
      expandableBadgeStylesheet.headerRow,
      presentation === "workbench" ? expandableBadgeStylesheet.workbenchHeaderRow : null,
    ],
    [presentation],
  );
  const iconBadgeStyle = useMemo(
    () => [
      expandableBadgeStylesheet.iconBadge,
      presentation === "workbench" ? expandableBadgeStylesheet.workbenchIconBadge : null,
    ],
    [presentation],
  );

  const accessibilityState = useMemo(
    () => (isInteractive ? { expanded: isExpanded } : undefined),
    [isExpanded, isInteractive],
  );

  const isActive = isHovered || isExpanded;

  const labelStyle = useMemo(
    () => [
      expandableBadgeStylesheet.label,
      presentation === "workbench" ? expandableBadgeStylesheet.workbenchLabel : null,
      isActive && expandableBadgeStylesheet.labelActive,
      isLoading && expandableBadgeStylesheet.labelLoading,
    ],
    [isActive, isLoading, presentation],
  );

  const secondaryLabelStyle = useMemo(
    () => [
      expandableBadgeStylesheet.secondaryLabel,
      presentation === "workbench" ? expandableBadgeStylesheet.workbenchSecondaryLabel : null,
      isActive && expandableBadgeStylesheet.secondaryLabelActive,
    ],
    [isActive, presentation],
  );

  const shimmerLabelTextStyle = useMemo(
    () => [
      expandableBadgeStylesheet.label,
      isLoading && expandableBadgeStylesheet.labelLoading,
      expandableBadgeStylesheet.shimmerText,
      shimmerLabelStyle,
    ],
    [isLoading, shimmerLabelStyle],
  );

  const shimmerSecondaryTextStyle = useMemo(
    () => [
      expandableBadgeStylesheet.secondaryLabel,
      expandableBadgeStylesheet.shimmerText,
      shimmerSecondaryStyle,
    ],
    [shimmerSecondaryStyle],
  );

  const chevronStyle = useMemo(
    () => [
      expandableBadgeStylesheet.chevron,
      isExpanded && expandableBadgeStylesheet.chevronExpanded,
      LUCIDE_CHEVRON_NUDGE_LEFT,
    ],
    [isExpanded],
  );

  const iconNode = renderExpandableBadgeIcon({ isError, isActive, icon });
  const iconSlotNode =
    presentation === "workbench" && !isExpanded ? (
      <View style={WORKBENCH_CHEVRON_DOWN_STYLE}>
        <ThemedIconHost Icon={ChevronRight} size={10} uniProps={mutedForegroundColorMapping} />
      </View>
    ) : (
      renderExpandableBadgeIconSlot({
        showChevron: isInteractive && isHovered,
        chevronStyle,
        iconNode,
      })
    );

  const pressHandlers = isInteractive
    ? {
        onPress: onToggle,
        onPressIn: handlePressIn,
        onPressOut: handlePressOut,
        accessibilityRole: "button" as const,
      }
    : {};

  return (
    <View
      style={containerStyle}
      testID={testID}
      onPointerEnter={isWeb ? handleHoverIn : undefined}
      onPointerLeave={isWeb ? handleHoverOut : undefined}
    >
      <Pressable
        {...pressHandlers}
        disabled={!isInteractive}
        accessibilityState={accessibilityState}
        style={pressableStyle}
      >
        <View style={headerRowStyle}>
          <View style={iconBadgeStyle}>{iconSlotNode}</View>
          <ExpandableBadgeLabelRow
            label={label}
            labelStyle={labelStyle}
            secondaryLabel={secondaryLabel}
            secondaryLabelStyle={secondaryLabelStyle}
            shouldMeasureWebShimmer={shouldMeasureWebShimmer}
            shouldMeasureNativeShimmer={shouldMeasureNativeShimmer}
            isWebShimmer={isWebShimmer}
            isNativeShimmer={isNativeShimmer}
            shimmerLabelTextStyle={shimmerLabelTextStyle}
            shimmerSecondaryTextStyle={shimmerSecondaryTextStyle}
            labelRowWidth={labelRowWidth}
            labelRowHeight={labelRowHeight}
            nativeShimmerPeakWidth={nativeShimmerPeakWidth}
            shimmerDuration={shimmerDuration}
            nativeGradientId={nativeGradientIdRef.current}
            onLabelRowLayout={handleLabelRowLayout}
            onLabelLayout={handleLabelLayout}
            onSecondaryLayout={handleSecondaryLayout}
            // Native has no hover; keep the open-file control always discoverable there.
            showOpenFileButton={Boolean(onOpenFile && (isHovered || isNative))}
            isOpenFileHovered={isOpenFileHovered}
            onOpenFilePress={handleOpenFilePress}
            onOpenFileHoverIn={handleOpenFileHoverIn}
            onOpenFileHoverOut={handleOpenFileHoverOut}
          />
        </View>
      </Pressable>
      {detailContent ? (
        <Pressable
          ref={detailWrapperRef}
          style={expandableBadgeStylesheet.detailWrapper}
          onHoverIn={handleDetailHoverIn}
          onHoverOut={handleDetailHoverOut}
        >
          {detailContent}
        </Pressable>
      ) : null}
    </View>
  );
}, areExpandableBadgePropsEqual);

function areExpandableBadgePropsEqual(previous: ExpandableBadgeProps, next: ExpandableBadgeProps) {
  if (previous.label !== next.label) return false;
  if (previous.secondaryLabel !== next.secondaryLabel) return false;
  if (previous.icon !== next.icon) return false;
  if (previous.isExpanded !== next.isExpanded) return false;
  if (previous.style !== next.style) return false;
  if (previous.presentation !== next.presentation) return false;
  if (previous.isLoading !== next.isLoading) return false;
  if (previous.isError !== next.isError) return false;
  if (previous.isLastInSequence !== next.isLastInSequence) return false;
  if (previous.disableOuterSpacing !== next.disableOuterSpacing) return false;
  if (previous.testID !== next.testID) return false;
  if (previous.onToggle !== next.onToggle) return false;
  if (previous.onOpenFile !== next.onOpenFile) return false;
  if (previous.onDetailHoverChange !== next.onDetailHoverChange) return false;
  if (previous.renderDetails !== next.renderDetails) return false;
  return true;
}
