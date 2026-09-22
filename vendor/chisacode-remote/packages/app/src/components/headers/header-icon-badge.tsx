import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { headerIconSlotStyle } from "./header-toggle-button";

/**
 * Non-interactive icon slot sitting at the start of a screen header's left
 * cluster. Shares the same padding + border-radius as `HeaderToggleButton` so
 * decorative headers (settings sections, host detail) line up with the sidebar
 * toggle across screens.
 */
export function HeaderIconBadge({
  children,
  variant = "default",
}: {
  children: ReactNode;
  variant?: "default" | "settings";
}) {
  const style = useMemo(
    () => [headerIconSlotStyle.slot, variant === "settings" && styles.settings],
    [variant],
  );
  return <View style={style}>{children}</View>;
}

const styles = StyleSheet.create((theme) => ({
  settings: {
    width: 22,
    height: 22,
    padding: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceWorkspace,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 0,
    elevation: 0,
  },
}));
