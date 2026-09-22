import { forwardRef, useMemo, type ComponentProps, type ReactElement, type ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  type ScrollViewProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from "react-native";
import Animated from "react-native-reanimated";
import { GlassSurface, type GlassSurfaceVariant } from "@/components/ui/glass-surface";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

export interface FloatingSurfaceProps extends Omit<
  ComponentProps<typeof Animated.View>,
  "children" | "style"
> {
  children?: ReactNode;
  fillContent?: boolean;
  fillFrame?: boolean;
  frameStyle?: StyleProp<ViewStyle>;
  glassVariant?: GlassSurfaceVariant;
  style?: StyleProp<ViewStyle>;
}

export const FloatingSurface = forwardRef<View, FloatingSurfaceProps>(function FloatingSurface(
  {
    children,
    fillContent = false,
    fillFrame = false,
    frameStyle,
    glassVariant = "popover",
    style,
    ...props
  },
  ref,
): ReactElement {
  const inlineFrameStyle = useMemo(() => {
    const flattened = StyleSheet.flatten(frameStyle);
    return flattened || undefined;
  }, [frameStyle]);
  const surfaceStyle = useMemo(
    () => [style, fillFrame ? styles.frameFill : null],
    [fillFrame, style],
  );
  return (
    <Animated.View {...props} ref={ref} style={inlineFrameStyle}>
      <GlassSurface fillContent={fillContent} variant={glassVariant} style={surfaceStyle}>
        {children}
      </GlassSurface>
    </Animated.View>
  );
});

export interface FloatingScrollViewProps {
  bounces?: boolean;
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  keyboardShouldPersistTaps?: ScrollViewProps["keyboardShouldPersistTaps"];
  showsVerticalScrollIndicator?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function FloatingScrollView({
  bounces,
  children,
  contentContainerStyle,
  keyboardShouldPersistTaps,
  showsVerticalScrollIndicator,
  style,
}: FloatingScrollViewProps): ReactElement {
  const inlineStyle = useMemo(() => {
    const flattened = StyleSheet.flatten(style);
    return flattened ? inlineUnistylesStyle(flattened) : undefined;
  }, [style]);

  return (
    <ScrollView
      bounces={bounces}
      contentContainerStyle={contentContainerStyle}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      style={inlineStyle}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  frameFill: {
    height: "100%",
    width: "100%",
  },
});
