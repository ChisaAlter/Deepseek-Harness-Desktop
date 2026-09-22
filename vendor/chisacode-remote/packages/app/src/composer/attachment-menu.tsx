import { useCallback, useMemo, type MutableRefObject } from "react";
import { Pressable, View, type GestureResponderEvent } from "react-native";
import { Github, ListTodo, Paperclip, Target } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { AgentFeature } from "@chisacode/protocol/agent-types";
import type { DaemonClient } from "@chisacode/client/internal/daemon-client";

import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import { buildToggleFeatureMenuItems } from "@/composer/agent-controls/utils";
import type { AttachmentMenuItem } from "@/composer/input/input";
import { ICON_SIZE, type Theme } from "@/styles/theme";

interface UseComposerAttachmentMenuInput {
  agentControls: DraftAgentControlsProps | undefined;
  agentFeatures: AgentFeature[];
  agentProvider: string | null;
  agentId: string;
  client: DaemonClient | null;
  focusInput: () => void;
  setUserInput: (text: string) => void;
  toastErrorRef: MutableRefObject<(message: string) => void>;
  isComposerLocked: boolean;
  onPickImage: () => void | Promise<void>;
  openGithubPicker: () => void;
}

interface FeatureMenuSwitchProps {
  value: boolean;
  featureId: string;
  label: string;
  disabled: boolean;
  onToggleFeature: (featureId: string, value: boolean) => void;
}

function FeatureMenuSwitch({
  value,
  featureId,
  label,
  disabled,
  onToggleFeature,
}: FeatureMenuSwitchProps) {
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      if (disabled) return;
      onToggleFeature(featureId, !value);
    },
    [disabled, featureId, onToggleFeature, value],
  );
  const trackStyle = useMemo(
    () => [
      styles.featureMenuSwitchTrack,
      value ? styles.featureMenuSwitchTrackOn : styles.featureMenuSwitchTrackOff,
      disabled ? styles.featureMenuSwitchDisabled : null,
    ],
    [disabled, value],
  );
  const thumbStyle = useMemo(
    () => [styles.featureMenuSwitchThumb, value ? styles.featureMenuSwitchThumbOn : null],
    [value],
  );
  const accessibilityState = useMemo(() => ({ checked: value, disabled }), [disabled, value]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={accessibilityState}
      accessibilityLabel={label}
      testID={`composer-feature-switch-${featureId}`}
    >
      <View style={trackStyle}>
        <View style={thumbStyle} />
      </View>
    </Pressable>
  );
}

export function useComposerAttachmentMenu(
  input: UseComposerAttachmentMenuInput,
): AttachmentMenuItem[] {
  const {
    agentControls,
    agentFeatures,
    agentProvider,
    agentId,
    client,
    focusInput,
    setUserInput,
    toastErrorRef,
    isComposerLocked,
    onPickImage,
    openGithubPicker,
  } = input;
  const { t } = useTranslation();
  const activeProvider = agentControls?.selectedProvider ?? agentProvider;
  const featureMenuDescriptors = useMemo(
    () => buildToggleFeatureMenuItems(agentControls?.features ?? agentFeatures),
    [agentControls?.features, agentFeatures],
  );
  const handleSetFeatureFromMenu = useCallback(
    (featureId: string, nextValue: boolean) => {
      if (agentControls?.onSetFeature) {
        agentControls.onSetFeature(featureId, nextValue);
        return;
      }
      if (!client) {
        return;
      }
      void client.setAgentFeature(agentId, featureId, nextValue).catch((error) => {
        console.warn("[Composer] setAgentFeature failed", error);
        toastErrorRef.current(error instanceof Error ? error.message : String(error));
      });
    },
    [agentControls, agentId, client, toastErrorRef],
  );
  const handleOpenGoalCommand = useCallback(() => {
    setUserInput("/goal ");
    focusInput();
  }, [focusInput, setUserInput]);

  return useMemo(() => {
    const items: AttachmentMenuItem[] = [
      {
        id: "image",
        label: t("composer.addPhotosAndFiles"),
        icon: <ThemedPaperclip size={ICON_SIZE.md} style={styles.iconMuted} />,
        onSelect: () => {
          void onPickImage();
        },
      },
      {
        id: "github",
        label: t("composer.addIssueOrPr"),
        icon: <ThemedGithub size={ICON_SIZE.md} style={styles.iconMuted} />,
        onSelect: openGithubPicker,
      },
    ];

    for (const feature of featureMenuDescriptors) {
      items.push({
        id: `feature-${feature.id}`,
        label: feature.label,
        icon: <ThemedListTodo size={ICON_SIZE.md} style={styles.iconMuted} />,
        trailing: (
          <FeatureMenuSwitch
            value={feature.selected}
            featureId={feature.id}
            label={feature.label}
            disabled={isComposerLocked}
            onToggleFeature={handleSetFeatureFromMenu}
          />
        ),
        disabled: isComposerLocked,
        closeOnSelect: false,
        onSelect: () => handleSetFeatureFromMenu(feature.id, !feature.selected),
      });
    }

    if (activeProvider === "codex") {
      items.push({
        id: "goal",
        label: t("composer.pursueGoal"),
        icon: <ThemedTarget size={ICON_SIZE.md} style={styles.iconMuted} />,
        onSelect: handleOpenGoalCommand,
      });
    }

    return items;
  }, [
    activeProvider,
    featureMenuDescriptors,
    handleOpenGoalCommand,
    handleSetFeatureFromMenu,
    isComposerLocked,
    onPickImage,
    openGithubPicker,
    t,
  ]);
}

const styles = StyleSheet.create((theme: Theme) => ({
  featureMenuSwitchTrack: {
    width: 34,
    height: 20,
    borderRadius: 10,
    padding: 2,
    justifyContent: "center",
  },
  featureMenuSwitchTrackOn: {
    backgroundColor: theme.colors.accent,
  },
  featureMenuSwitchTrackOff: {
    backgroundColor: theme.colors.surfaceWorkspace,
  },
  featureMenuSwitchDisabled: {
    opacity: theme.opacity[50],
  },
  featureMenuSwitchThumb: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.palette.white,
    shadowColor: "rgba(20, 23, 31, 0.12)",
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    shadowOpacity: 1,
    elevation: 2,
  },
  featureMenuSwitchThumbOn: {
    transform: [{ translateX: 14 }],
  },
  iconMuted: {
    color: theme.colors.foregroundMuted,
  },
})) as unknown as Record<string, object>;

const ThemedPaperclip = withUnistyles(Paperclip);
const ThemedGithub = withUnistyles(Github);
const ThemedListTodo = withUnistyles(ListTodo);
const ThemedTarget = withUnistyles(Target);
