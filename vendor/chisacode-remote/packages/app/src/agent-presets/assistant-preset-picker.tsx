import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Bot, ChevronDown, TriangleAlert } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { AgentPreset } from "@chisacode/protocol/agent-presets";
import type { Theme } from "@/styles/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ThemedBot = withUnistyles(Bot);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedTriangleAlert = withUnistyles(TriangleAlert);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

interface PresetMenuItemProps {
  preset: AgentPreset;
  selected: boolean;
  onSelect: (preset: AgentPreset) => void;
}

function PresetMenuItem({ preset, selected, onSelect }: PresetMenuItemProps) {
  const handleSelect = useCallback(() => onSelect(preset), [onSelect, preset]);
  return (
    <DropdownMenuItem
      testID={`assistant-preset-${preset.id}`}
      description={preset.description}
      selected={selected}
      onSelect={handleSelect}
    >
      {preset.label}
    </DropdownMenuItem>
  );
}

interface AssistantPresetPickerProps {
  presets: AgentPreset[];
  selectedPresetId: string | null;
  isLoading: boolean;
  isError: boolean;
  disabled?: boolean;
  warningText?: string | null;
  onSelect: (preset: AgentPreset | null) => void;
}

export function AssistantPresetPicker({
  presets,
  selectedPresetId,
  isLoading,
  isError,
  disabled = false,
  warningText = null,
  onSelect,
}: AssistantPresetPickerProps) {
  const { t } = useTranslation();
  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [presets, selectedPresetId],
  );
  const handleClear = useCallback(() => onSelect(null), [onSelect]);
  const triggerLabel = isLoading
    ? t("workspace.presets.loading")
    : (selectedPreset?.label ?? t("workspace.presets.label"));

  return (
    <View style={styles.container}>
      <DropdownMenu>
        <DropdownMenuTrigger
          accessibilityLabel={t("workspace.presets.select")}
          disabled={disabled || isLoading || isError}
          testID="assistant-preset-picker"
          style={styles.trigger}
        >
          <ThemedBot size={16} uniProps={foregroundMutedColorMapping} />
          <Text style={styles.triggerText} numberOfLines={1}>
            {triggerLabel}
          </Text>
          <ThemedChevronDown size={16} uniProps={foregroundMutedColorMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" minWidth={280} maxWidth={420} scrollable maxHeight={360}>
          <DropdownMenuItem selected={selectedPresetId === null} onSelect={handleClear}>
            {t("workspace.presets.none")}
          </DropdownMenuItem>
          {presets.map((preset) => (
            <PresetMenuItem
              key={preset.id}
              preset={preset}
              selected={preset.id === selectedPresetId}
              onSelect={onSelect}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {selectedPreset ? (
        <View style={styles.details}>
          <Text style={styles.description}>{selectedPreset.description}</Text>
          {selectedPreset.systemPrompt ? (
            <Text style={styles.meta}>{t("workspace.presets.systemPromptActive")}</Text>
          ) : null}
          {warningText ? (
            <View style={styles.warningRow}>
              <ThemedTriangleAlert size={14} uniProps={foregroundMutedColorMapping} />
              <Text style={styles.warningText}>{warningText}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {isError ? <Text style={styles.errorText}>{t("workspace.presets.unavailable")}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    // Parent ConversationAspectColumn owns horizontal bounds; stay left-aligned.
    width: "100%",
    alignSelf: "stretch",
    gap: theme.spacing[2],
  },
  trigger: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    backgroundColor: theme.colors.surface0,
  },
  triggerText: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.foreground,
    // Soft preset chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
  },
  details: {
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  meta: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[1],
  },
  warningText: {
    minWidth: 0,
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: 12.5,
    lineHeight: 16,
  },
}));
