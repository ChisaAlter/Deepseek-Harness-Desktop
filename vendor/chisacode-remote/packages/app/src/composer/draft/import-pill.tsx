import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Import as ImportIcon } from "lucide-react-native";
import type { Theme } from "@/styles/theme";

// Bake color into the mapper. On web, withUnistyles merges call-site props
// onto the child, so passing `uniProps` leaks onto lucide/DOM nodes.
const ThemedImportIcon = withUnistyles(ImportIcon, (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
}));

interface ComposerImportPillProps {
  onPress: () => void;
  disabled?: boolean;
}

export function ComposerImportPill({ onPress, disabled = false }: ComposerImportPillProps) {
  const [isHovered, setIsHovered] = useState(false);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);
  const bodyStyle = useMemo(() => [styles.body, isHovered && styles.bodyHovered], [isHovered]);
  return (
    <View style={styles.row}>
      <Pressable
        testID="new-workspace-import-session-card"
        accessibilityRole="button"
        accessibilityLabel="导入会话"
        onPress={onPress}
        disabled={disabled}
        onHoverIn={handleHoverIn}
        onHoverOut={handleHoverOut}
        style={bodyStyle}
      >
        <ThemedImportIcon size={14} />
        <Text style={styles.label} numberOfLines={1}>
          导入会话
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
  },
  // Soft .foot-chip: pill, transparent, muted, hover surface.
  body: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 30,
    paddingHorizontal: 12,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: "transparent",
  },
  bodyHovered: {
    backgroundColor: theme.colors.surface0,
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
}));
