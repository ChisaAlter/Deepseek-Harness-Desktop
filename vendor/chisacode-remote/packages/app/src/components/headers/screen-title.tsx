import { useMemo, type ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";

interface ScreenTitleProps {
  children: ReactNode;
  numberOfLines?: number;
  testID?: string;
  style?: StyleProp<TextStyle>;
}

/**
 * Canonical screen title for use inside `ScreenHeader`. One typography, one
 * color, responsive weight. Leading icons are siblings (HeaderToggleButton,
 * HeaderIconBadge) — never nested inside this component.
 */
export function ScreenTitle({ children, numberOfLines = 1, testID, style }: ScreenTitleProps) {
  const combinedStyle = useMemo(() => [styles.text, style], [style]);
  return (
    <Text style={combinedStyle} numberOfLines={numberOfLines} testID={testID}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Soft .topbar .title: 13.5 medium; compact keeps 14.5 readable.
  text: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: {
      xs: 14.5,
      md: 13.5,
    },
    lineHeight: {
      xs: 20,
      md: 18,
    },
    fontWeight: {
      xs: "500",
      md: "500",
    },
    color: theme.colors.foreground,
  },
}));
