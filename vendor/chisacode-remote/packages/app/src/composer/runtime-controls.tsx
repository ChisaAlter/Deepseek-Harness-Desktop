import {
  useCallback,
  useMemo,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
} from "react";
import { ActivityIndicator, Text, View, type PressableStateCallbackType } from "react-native";
import { AudioLines, Square } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { ThemedIconHost } from "@/components/themed-icon-host";
import { useTranslation } from "react-i18next";

import { ContextWindowMeter } from "@/components/context-window-meter";
import { Shortcut } from "@/components/ui/shortcut";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isWeb } from "@/constants/platform";
import { WORKBENCH_COMPOSER_CONTROL_HEIGHT } from "@/constants/layout";
import { useVoiceOptional } from "@/contexts/voice-context";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { COMPOSER_VOICE_UI_VISIBLE } from "./voice-visibility";

interface UseComposerRuntimeControlsInput {
  voice: ReturnType<typeof useVoiceOptional>;
  serverId: string;
  agentId: string;
  isConnected: boolean;
  hasAgent: boolean;
  isAgentRunning: boolean;
  hasSendableContent: boolean;
  isProcessing: boolean;
  isCompact: boolean;
  isCancellingAgent: boolean;
  handleCancelAgent: () => void;
  toastErrorRef: MutableRefObject<(message: string) => void>;
  contextWindowMaxTokens: number | null;
  contextWindowUsedTokens: number | null;
  totalCostUsd: number | null;
}

interface ComposerRuntimeControlsResult {
  beforeVoiceContent: ReactNode;
  footerRight: ReactNode;
  rightContent: ReactNode;
}

interface ComposerCancelButtonProps {
  buttonIconSize: number;
  cancelButtonStyle: (object | undefined)[];
  handleCancelAgent: () => void;
  isConnected: boolean;
  isCancellingAgent: boolean;
  agentInterruptKeys: ReturnType<typeof useShortcutKeys>;
}

interface ComposerCancelButtonSlotProps extends ComposerCancelButtonProps {
  isAgentRunning: boolean;
  hasSendableContent: boolean;
  isProcessing: boolean;
}

interface ComposerVoiceModeButtonProps {
  buttonIconSize: number;
  handleToggleRealtimeVoice: () => void;
  isConnected: boolean;
  isVoiceSwitching: boolean;
  realtimeVoiceButtonStyle: (
    state: PressableStateCallbackType & { hovered?: boolean },
  ) => (object | undefined)[];
  voiceToggleKeys: ReturnType<typeof useShortcutKeys>;
}

interface ComposerRightControlsSlotProps extends ComposerVoiceModeButtonProps {
  isVoiceModeForAgent: boolean;
  hasAgent: boolean;
  isAgentRunning: boolean;
  hasSendableContent: boolean;
  isProcessing: boolean;
  isCompact: boolean;
  cancelButton: ReactElement;
}

function resolveComposerButtonIconSize(): number {
  return isWeb ? ICON_SIZE.md : ICON_SIZE.lg;
}

function resolveVoiceStartErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return null;
}

function attemptStartRealtimeVoice(input: {
  voice: ReturnType<typeof useVoiceOptional>;
  isConnected: boolean;
  hasAgent: boolean;
  serverId: string;
  agentId: string;
  toastErrorRef: MutableRefObject<(message: string) => void>;
}): void {
  const { voice, isConnected, hasAgent, serverId, agentId, toastErrorRef } = input;
  if (!voice || !isConnected || !hasAgent) return;
  if (voice.isVoiceSwitching) return;
  if (voice.isVoiceModeForAgent(serverId, agentId)) return;
  void voice.startVoice(serverId, agentId).catch((error) => {
    console.error("[Composer] Failed to start voice mode", error);
    const message = resolveVoiceStartErrorMessage(error);
    if (message && message.trim().length > 0) {
      toastErrorRef.current(message);
    }
  });
}

function buildCancelButtonStyle(isConnected: boolean, isCancellingAgent: boolean): object[] {
  const disabled = !isConnected || isCancellingAgent ? styles.buttonDisabled : undefined;
  return [styles.cancelButton, disabled].filter((value): value is object => Boolean(value));
}

function buildRealtimeVoiceButtonStyle(
  hovered: boolean | undefined,
  voiceButtonDisabled: boolean,
): object[] {
  const hoveredStyle = hovered ? styles.iconButtonHovered : undefined;
  const disabledStyle = voiceButtonDisabled ? styles.buttonDisabled : undefined;
  return [styles.realtimeVoiceButton, hoveredStyle, disabledStyle].filter(
    (value): value is object => Boolean(value),
  );
}

function resolveContextWindowValues(
  rawMax: number | null,
  rawUsed: number | null,
): { contextWindowMaxTokens: number | null; contextWindowUsedTokens: number | null } {
  if (typeof rawMax === "number" && typeof rawUsed === "number") {
    return { contextWindowMaxTokens: rawMax, contextWindowUsedTokens: rawUsed };
  }
  return { contextWindowMaxTokens: null, contextWindowUsedTokens: null };
}

function renderContextWindowMeter(
  contextWindowMaxTokens: number | null,
  contextWindowUsedTokens: number | null,
  totalCostUsd: number | null,
): ReactElement | null {
  if (contextWindowMaxTokens === null || contextWindowUsedTokens === null) {
    return null;
  }
  return (
    <ContextWindowMeter
      maxTokens={contextWindowMaxTokens}
      usedTokens={contextWindowUsedTokens}
      totalCostUsd={totalCostUsd}
    />
  );
}

function resolveContextWindowPlacement(
  meter: ReactElement | null,
  isCompact: boolean,
): { beforeVoiceContent: ReactNode; footerRight: ReactNode } {
  if (isCompact) {
    return { beforeVoiceContent: null, footerRight: meter };
  }
  return {
    beforeVoiceContent: <View style={styles.contextWindowMeterSlot}>{meter}</View>,
    footerRight: null,
  };
}

function ComposerCancelButton({
  buttonIconSize,
  cancelButtonStyle,
  handleCancelAgent,
  isConnected,
  isCancellingAgent,
  agentInterruptKeys,
}: ComposerCancelButtonProps) {
  const { t } = useTranslation();
  const accessibilityLabel = isCancellingAgent
    ? t("composer.cancellingAgent")
    : t("composer.stopAgent");
  const icon = isCancellingAgent ? (
    <ActivityIndicator size="small" color="white" />
  ) : (
    <Square size={buttonIconSize} color="white" fill="white" />
  );
  const shortcutNode = agentInterruptKeys ? <Shortcut chord={agentInterruptKeys} /> : null;
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={handleCancelAgent}
        disabled={!isConnected || isCancellingAgent}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        style={cancelButtonStyle}
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <View style={styles.tooltipRow}>
          <Text style={styles.tooltipText}>{t("composer.interrupt")}</Text>
          {shortcutNode}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

function ComposerCancelButtonSlot({
  isAgentRunning,
  hasSendableContent,
  isProcessing,
  ...rest
}: ComposerCancelButtonSlotProps) {
  if (!isAgentRunning || hasSendableContent || isProcessing) return null;
  return <ComposerCancelButton {...rest} />;
}

function ComposerVoiceModeButton({
  buttonIconSize,
  handleToggleRealtimeVoice,
  isConnected,
  isVoiceSwitching,
  realtimeVoiceButtonStyle,
  voiceToggleKeys,
}: ComposerVoiceModeButtonProps) {
  const { t } = useTranslation();
  const shortcutNode = voiceToggleKeys ? <Shortcut chord={voiceToggleKeys} /> : null;
  const renderTriggerContent = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => {
      if (isVoiceSwitching) {
        return <ActivityIndicator size="small" color="white" />;
      }
      const colorMapping = hovered ? iconForegroundMapping : iconForegroundMutedMapping;
      return <ThemedIconHost Icon={AudioLines} size={buttonIconSize} uniProps={colorMapping} />;
    },
    [buttonIconSize, isVoiceSwitching],
  );
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={handleToggleRealtimeVoice}
        disabled={!isConnected || isVoiceSwitching}
        accessibilityLabel={t("composer.enableVoiceMode")}
        accessibilityRole="button"
        style={realtimeVoiceButtonStyle}
      >
        {renderTriggerContent}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <View style={styles.tooltipRow}>
          <Text style={styles.tooltipText}>{t("composer.voiceMode")}</Text>
          {shortcutNode}
        </View>
      </TooltipContent>
    </Tooltip>
  );
}

function ComposerRightControlsSlot({
  isVoiceModeForAgent,
  hasAgent,
  isAgentRunning,
  hasSendableContent,
  isProcessing,
  isCompact,
  cancelButton,
  ...voiceProps
}: ComposerRightControlsSlotProps) {
  const hideVoiceForCompactInput = isCompact && hasSendableContent;
  const showVoiceModeButton =
    COMPOSER_VOICE_UI_VISIBLE &&
    !isVoiceModeForAgent &&
    hasAgent &&
    !isAgentRunning &&
    !hideVoiceForCompactInput;
  const shouldShowCancelButton = isAgentRunning && !hasSendableContent && !isProcessing;
  if (!showVoiceModeButton && !shouldShowCancelButton) return null;
  return (
    <View style={styles.rightControls}>
      {showVoiceModeButton ? <ComposerVoiceModeButton {...voiceProps} /> : null}
      {cancelButton}
    </View>
  );
}

export function useComposerRuntimeControls(
  input: UseComposerRuntimeControlsInput,
): ComposerRuntimeControlsResult {
  const {
    voice,
    serverId,
    agentId,
    isConnected,
    hasAgent,
    isAgentRunning,
    hasSendableContent,
    isProcessing,
    isCompact,
    isCancellingAgent,
    handleCancelAgent,
    toastErrorRef,
    contextWindowMaxTokens: rawContextWindowMaxTokens,
    contextWindowUsedTokens: rawContextWindowUsedTokens,
    totalCostUsd,
  } = input;
  const buttonIconSize = resolveComposerButtonIconSize();
  const voiceToggleKeys = useShortcutKeys("voice-toggle");
  const agentInterruptKeys = useShortcutKeys("agent-interrupt");
  const isVoiceModeForAgent = voice?.isVoiceModeForAgent(serverId, agentId) ?? false;
  const isVoiceSwitching = voice?.isVoiceSwitching ?? false;
  const voiceButtonDisabled = !isConnected || isVoiceSwitching;

  const handleToggleRealtimeVoice = useCallback(() => {
    attemptStartRealtimeVoice({
      voice,
      isConnected,
      hasAgent,
      serverId,
      agentId,
      toastErrorRef,
    });
  }, [agentId, hasAgent, isConnected, serverId, toastErrorRef, voice]);
  const cancelButtonStyle = useMemo(
    () => buildCancelButtonStyle(isConnected, isCancellingAgent),
    [isCancellingAgent, isConnected],
  );
  const realtimeVoiceButtonStyle = useCallback(
    (state: PressableStateCallbackType & { hovered?: boolean }) =>
      buildRealtimeVoiceButtonStyle(state.hovered, voiceButtonDisabled),
    [voiceButtonDisabled],
  );
  const cancelButton = useMemo(
    () => (
      <ComposerCancelButtonSlot
        isAgentRunning={isAgentRunning}
        hasSendableContent={hasSendableContent}
        isProcessing={isProcessing}
        buttonIconSize={buttonIconSize}
        cancelButtonStyle={cancelButtonStyle}
        handleCancelAgent={handleCancelAgent}
        isConnected={isConnected}
        isCancellingAgent={isCancellingAgent}
        agentInterruptKeys={agentInterruptKeys}
      />
    ),
    [
      agentInterruptKeys,
      buttonIconSize,
      cancelButtonStyle,
      handleCancelAgent,
      hasSendableContent,
      isAgentRunning,
      isCancellingAgent,
      isConnected,
      isProcessing,
    ],
  );
  const rightContent = useMemo(
    () => (
      <ComposerRightControlsSlot
        isVoiceModeForAgent={isVoiceModeForAgent}
        hasAgent={hasAgent}
        isAgentRunning={isAgentRunning}
        hasSendableContent={hasSendableContent}
        isProcessing={isProcessing}
        isCompact={isCompact}
        buttonIconSize={buttonIconSize}
        handleToggleRealtimeVoice={handleToggleRealtimeVoice}
        isConnected={isConnected}
        isVoiceSwitching={isVoiceSwitching}
        realtimeVoiceButtonStyle={realtimeVoiceButtonStyle}
        voiceToggleKeys={voiceToggleKeys}
        cancelButton={cancelButton}
      />
    ),
    [
      buttonIconSize,
      cancelButton,
      handleToggleRealtimeVoice,
      hasAgent,
      hasSendableContent,
      isAgentRunning,
      isCompact,
      isConnected,
      isProcessing,
      isVoiceModeForAgent,
      isVoiceSwitching,
      realtimeVoiceButtonStyle,
      voiceToggleKeys,
    ],
  );
  const { contextWindowMaxTokens, contextWindowUsedTokens } = resolveContextWindowValues(
    rawContextWindowMaxTokens,
    rawContextWindowUsedTokens,
  );
  const contextWindowMeter = useMemo(
    () => renderContextWindowMeter(contextWindowMaxTokens, contextWindowUsedTokens, totalCostUsd),
    [contextWindowMaxTokens, contextWindowUsedTokens, totalCostUsd],
  );
  const { beforeVoiceContent, footerRight } = useMemo(
    () => resolveContextWindowPlacement(contextWindowMeter, isCompact),
    [contextWindowMeter, isCompact],
  );

  return { beforeVoiceContent, footerRight, rightContent };
}

const styles = StyleSheet.create((theme: Theme) => ({
  cancelButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.palette.red[600],
    alignItems: "center",
    justifyContent: "center",
    marginLeft: theme.spacing[1],
  },
  rightControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  contextWindowMeterSlot: {
    width: WORKBENCH_COMPOSER_CONTROL_HEIGHT,
    height: WORKBENCH_COMPOSER_CONTROL_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  realtimeVoiceButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surface1,
  },
  tooltipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  tooltipText: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.popoverForeground,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
})) as unknown as Record<string, object>;

const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
