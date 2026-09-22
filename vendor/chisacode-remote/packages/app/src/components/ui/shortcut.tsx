import React, { useMemo, type ReactElement } from "react";
import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { formatShortcut, type ShortcutKey } from "@/utils/format-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";

const EMPTY_CHORD: ShortcutKey[][] = [];

export function Shortcut({
  keys,
  chord,
  style,
  textStyle,
}: {
  keys?: ShortcutKey[];
  chord?: ShortcutKey[][];
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}): ReactElement {
  const displayChord = useMemo(() => chord ?? (keys ? [keys] : EMPTY_CHORD), [chord, keys]);
  const shortcutOs = getShortcutOs();
  const singleCombo = displayChord[0];

  const badgeStyle = useMemo(() => [styles.badge, style], [style]);
  const textCombinedStyle = useMemo(() => [styles.text, textStyle], [textStyle]);
  const sequenceStyle = useMemo(() => [styles.sequence, style], [style]);

  const accessibilityLabel = useMemo(
    () => displayChord.map((combo) => formatShortcut(combo, shortcutOs)).join(", "),
    [displayChord, shortcutOs],
  );

  if (!singleCombo) {
    return <View style={style} />;
  }

  if (displayChord.length === 1) {
    return (
      <View style={badgeStyle} accessibilityLabel={accessibilityLabel}>
        <Text style={textCombinedStyle}>{formatShortcut(singleCombo, shortcutOs)}</Text>
      </View>
    );
  }

  return (
    <View style={sequenceStyle} accessibilityLabel={accessibilityLabel}>
      {displayChord.map(function (combo) {
        return (
          <View key={combo.join("+")} style={styles.badge}>
            <Text style={textCombinedStyle}>{formatShortcut(combo, shortcutOs)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Soft kbd chip — r8 + workspace wash, 12.5 meta.
  badge: {
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[0.5],
    borderRadius: 8,
    backgroundColor: theme.colors.surfaceWorkspace,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sequence: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  text: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
}));
