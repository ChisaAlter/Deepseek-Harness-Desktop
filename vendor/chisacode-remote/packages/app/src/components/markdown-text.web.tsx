import { useMemo, type ReactNode } from "react";
import {
  Text,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";

interface MarkdownTextSpanProps {
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  /** Accepted for Paseo renderer parity; unused on web (no dataSet mono surface yet). */
  monoSurface?: boolean;
  // Web links use the <a>/Pressable path in link.tsx, not this span, so these
  // are accepted for prop-shape parity with the native variants and forwarded
  // harmlessly.
  onPress?: TextProps["onPress"];
  accessibilityRole?: TextProps["accessibilityRole"];
}

// Paseo-aligned: plain inline Text — no forced block/full-width layout.
// react-native-web already applies user-select via markdown styles.
export function MarkdownTextSpan({
  style,
  children,
  monoSurface: _monoSurface,
  onPress,
  accessibilityRole,
}: MarkdownTextSpanProps) {
  return (
    <Text style={style} onPress={onPress} accessibilityRole={accessibilityRole}>
      {children}
    </Text>
  );
}

// Kept for tests/call sites that previously imported the forced layout flag.
export const MARKDOWN_TEXT_SPAN_WEB_STYLE = {
  display: "inline",
} as const;

interface MarkdownParagraphViewProps {
  paragraphStyle: ViewStyle;
  /** Accepted for Paseo renderer parity; web layout does not branch on it yet. */
  containsImage?: boolean;
  children: ReactNode;
}

const MARKDOWN_PARAGRAPH_RESET: ViewStyle = {};

// Same shape as Android — paragraph is a View so block-level children (images)
// keep their natural layout. Web text selection already spans nested inline
// elements via CSS user-select, so no UITextView equivalent is needed.
export function MarkdownParagraphView({
  paragraphStyle,
  containsImage: _containsImage,
  children,
}: MarkdownParagraphViewProps) {
  const style = useMemo(() => [paragraphStyle, MARKDOWN_PARAGRAPH_RESET], [paragraphStyle]);
  return <View style={style}>{children}</View>;
}
