import { Image as ImageIcon } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";

import type { MutableDaemonConfig } from "@chisacode/protocol/messages";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useUserVisibleErrorReporter } from "@/hooks/use-user-visible-error";
import { SettingsSection } from "@/screens/settings/settings-section";
import { collectSavedModels } from "@/screens/settings/custom-model-providers";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";

interface VisionFallbackSectionProps {
  serverId: string | null;
}

const ThemedImageIcon = withUnistyles(ImageIcon);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

function modelSupportsImages(model: { supportsImages?: boolean }): boolean {
  return model.supportsImages === true;
}

function visionOptionKey(provider: string, modelId: string): string {
  return `${provider}::${modelId}`;
}

interface VisionCandidate {
  key: string;
  provider: string;
  modelId: string;
  label: string;
}

function VisionFallbackOption({
  candidate,
  selected,
  selectedLabel,
  onSelect,
}: {
  candidate: VisionCandidate;
  selected: boolean;
  selectedLabel: string;
  onSelect: (candidate: VisionCandidate) => void;
}) {
  const handlePress = useCallback(() => {
    onSelect(candidate);
  }, [candidate, onSelect]);

  return (
    <Pressable
      onPress={handlePress}
      style={selected ? styles.optionSelected : styles.option}
      testID={`vision-fallback-option-${candidate.modelId}`}
    >
      <Text style={selected ? styles.optionTextSelected : styles.optionText}>
        {candidate.label}
      </Text>
      {selected ? <Text style={styles.selectedMark}>{selectedLabel}</Text> : null}
    </Pressable>
  );
}

export function VisionFallbackSection({ serverId }: VisionFallbackSectionProps) {
  const { t } = useTranslation();
  const reportError = useUserVisibleErrorReporter();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [saving, setSaving] = useState(false);

  const visionCandidates = useMemo(() => {
    const saved = collectSavedModels(config?.modelGateways).filter((model) =>
      modelSupportsImages(model),
    );
    return saved.map((model) => {
      const provider = model.providerIds[0] ?? `${model.gatewayId}-opencode`;
      return {
        key: visionOptionKey(provider, model.modelId),
        provider,
        modelId: model.modelId,
        label: `${model.gatewayLabel} · ${model.modelId}`,
      };
    });
  }, [config?.modelGateways]);

  const selected = config?.visionFallbackModel ?? null;
  const selectedKey =
    selected?.provider && selected.modelId
      ? visionOptionKey(selected.provider, selected.modelId)
      : null;

  const handleSelect = useCallback(
    async (next: MutableDaemonConfig["visionFallbackModel"]) => {
      if (saving) {
        return;
      }
      setSaving(true);
      try {
        const updated = await patchConfig({ visionFallbackModel: next });
        if (!updated) {
          throw new Error(t("visionFallback.saveUnavailable"));
        }
      } catch (error) {
        reportError({
          error,
          logLabel: "[VisionFallback] Failed to save vision fallback model",
          fallbackMessage: t("visionFallback.saveFailed"),
        });
      } finally {
        setSaving(false);
      }
    },
    [patchConfig, reportError, saving, t],
  );

  const handleSelectCandidate = useCallback(
    (candidate: VisionCandidate) => {
      void handleSelect({
        provider: candidate.provider,
        modelId: candidate.modelId,
      });
    },
    [handleSelect],
  );

  const handleClear = useCallback(() => {
    void handleSelect(null);
  }, [handleSelect]);

  return (
    <SettingsSection title={t("visionFallback.title")} testID="vision-fallback-section">
      <Text style={styles.hint}>{t("visionFallback.hint")}</Text>
      {visionCandidates.length === 0 ? (
        <View style={EMPTY_CARD_STYLE} testID="vision-fallback-empty">
          <View style={styles.emptyIconWrap}>
            <ThemedImageIcon size={ICON_SIZE.md} uniProps={foregroundMutedColorMapping} />
          </View>
          <Text style={styles.emptyTitle}>{t("visionFallback.emptyTitle")}</Text>
          <Text style={styles.emptyText}>{t("visionFallback.empty")}</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {visionCandidates.map((candidate) => (
            <VisionFallbackOption
              key={candidate.key}
              candidate={candidate}
              selected={selectedKey === candidate.key}
              selectedLabel={t("visionFallback.selected")}
              onSelect={handleSelectCandidate}
            />
          ))}
          {selected ? (
            <Pressable
              onPress={handleClear}
              style={styles.clearButton}
              testID="vision-fallback-clear"
            >
              <Text style={styles.clearText}>{t("visionFallback.clear")}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 17,
    marginBottom: theme.spacing[2],
  },
  emptyCard: {
    paddingVertical: theme.spacing[6],
    paddingHorizontal: theme.spacing[4],
    gap: theme.spacing[2],
    alignItems: "center",
  },
  emptyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing[1],
  },
  emptyTitle: {
    color: theme.colors.foreground,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 17,
    textAlign: "center",
    maxWidth: 320,
  },
  list: {
    gap: theme.spacing[2],
  },
  option: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.base,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    backgroundColor: theme.colors.surface0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  optionSelected: {
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: theme.borderRadius.base,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  optionText: {
    color: theme.colors.foreground,
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  optionTextSelected: {
    color: theme.colors.primary,
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
    fontWeight: theme.fontWeight.medium,
  },
  selectedMark: {
    color: theme.colors.primary,
    fontSize: 12,
    lineHeight: 16,
  },
  clearButton: {
    alignSelf: "flex-start",
    paddingVertical: theme.spacing[1],
  },
  clearText: {
    color: theme.colors.foregroundMuted,
    fontSize: 12.5,
    lineHeight: 16,
  },
}));

const EMPTY_CARD_STYLE = [settingsStyles.card, styles.emptyCard];
