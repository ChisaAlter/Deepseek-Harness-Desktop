import type { StyleProp, TextStyle } from "react-native";
import { useMemo } from "react";
import { TextInput, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";

const ThemedTextInput = withUnistyles(TextInput);

const placeholderTextColorMapping = (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
});

interface SettingsTextAreaProps {
  accessibilityLabel: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  testID?: string;
  style?: StyleProp<TextStyle>;
}

export function SettingsTextArea({
  accessibilityLabel,
  value,
  onChangeText,
  placeholder,
  testID,
  style,
}: SettingsTextAreaProps) {
  const inputStyle = useMemo(() => [styles.input, style], [style]);

  return (
    <ThemedTextInput
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      multiline
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      uniProps={placeholderTextColorMapping}
      style={inputStyle}
    />
  );
}

export function SettingsTextAreaCard(props: SettingsTextAreaProps) {
  return (
    <View style={settingsStyles.card}>
      <SettingsTextArea {...props} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  input: {
    color: theme.colors.foreground,
    // Soft settings field: 13 lead-scale body.
    fontSize: 13,
    lineHeight: 18,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    minHeight: 96,
    textAlignVertical: "top",
  },
}));
