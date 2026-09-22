import { useMemo } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { X, ArrowUp, RefreshCcw, Check, Mic, Pencil } from "lucide-react-native";
import { VolumeMeter } from "./volume-meter";
import { FOOTER_HEIGHT } from "@/constants/layout";
import type { DictationStatus } from "@/hooks/use-dictation";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, type Theme } from "@/styles/theme";

interface DictationControlsProps {
  volume: number;
  duration: number;
  transcript?: string;
  isRecording: boolean;
  isProcessing: boolean;
  status: DictationStatus;
  onStart: () => void;
  onCancel: () => void;
  onAccept: () => void;
  onAcceptAndSend: () => void;
  onRetry?: () => void;
  onDiscard?: () => void;
  disabled?: boolean;
}

const ThemedX = withUnistyles(X);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedRefreshCcw = withUnistyles(RefreshCcw);
const ThemedCheck = withUnistyles(Check);
const ThemedMic = withUnistyles(Mic);
const ThemedPencil = withUnistyles(Pencil);
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);

const foregroundColorMapping = (theme: Theme) => ({
  color: theme.colors.foreground,
});
const surface0ColorMapping = (theme: Theme) => ({
  color: theme.colors.surface0,
});
const accentForegroundColorMapping = (theme: Theme) => ({
  color: theme.colors.accentForeground,
});
const accentColorMapping = (theme: Theme) => ({
  color: theme.colors.accent,
});

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function DictationControls({
  volume,
  duration,
  isRecording,
  isProcessing,
  status,
  onStart,
  onCancel,
  onAccept,
  onAcceptAndSend,
  onRetry,
  onDiscard,
  disabled = false,
}: DictationControlsProps) {
  const { t } = useTranslation();
  const isFailed = status === "failed";
  const showActiveState = isRecording || isProcessing || isFailed;
  const actionsDisabled = isProcessing;
  const handleCancel = isFailed && onDiscard ? onDiscard : onCancel;

  const micButtonStyle = useMemo(
    () => [styles.micButton, disabled && styles.buttonDisabled],
    [disabled],
  );
  const cancelButtonStyle = useMemo(
    () => [
      styles.actionButton,
      styles.actionButtonCancel,
      actionsDisabled && !isFailed ? styles.buttonDisabled : undefined,
    ],
    [actionsDisabled, isFailed],
  );

  if (!showActiveState) {
    return (
      <Pressable
        onPress={onStart}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t("composer.startDictation")}
        style={micButtonStyle}
      >
        <ThemedMic size={ICON_SIZE.md} uniProps={foregroundColorMapping} />
      </Pressable>
    );
  }

  return (
    <View style={styles.activeContainer}>
      <View style={styles.meterWrapper}>
        <VolumeMeter volume={volume} isMuted={false} isSpeaking={false} orientation="horizontal" />
      </View>
      <Text style={styles.timerText}>{formatDuration(duration)}</Text>
      <View style={styles.actionGroup}>
        <Pressable
          onPress={handleCancel}
          disabled={actionsDisabled && !isFailed}
          accessibilityLabel={t("composer.cancelDictation")}
          style={cancelButtonStyle}
        >
          <ThemedX size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />
        </Pressable>
        {actionsDisabled ? (
          <View style={styles.loadingContainer}>
            <ThemedActivityIndicator size="small" uniProps={foregroundColorMapping} />
          </View>
        ) : null}
        {!actionsDisabled && isFailed ? (
          <Pressable
            onPress={onRetry}
            accessibilityLabel={t("composer.retryDictation")}
            style={ACTION_CONFIRM_STYLE}
          >
            <ThemedRefreshCcw size={ICON_SIZE.sm} uniProps={surface0ColorMapping} />
          </Pressable>
        ) : null}
        {!actionsDisabled && !isFailed ? (
          <>
            <Pressable
              onPress={onAccept}
              accessibilityLabel={t("composer.insertTranscription")}
              style={ACTION_SECONDARY_STYLE}
            >
              <ThemedCheck size={ICON_SIZE.sm} uniProps={foregroundColorMapping} />
            </Pressable>
            <Pressable
              onPress={onAcceptAndSend}
              accessibilityLabel={t("composer.insertTranscriptionAndSend")}
              style={ACTION_CONFIRM_STYLE}
            >
              <ThemedArrowUp size={ICON_SIZE.sm} uniProps={surface0ColorMapping} />
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Full-width overlay variant for the agent input footer.
 * Uses blue background with white icons.
 */
export function DictationOverlay({
  volume,
  duration,
  isRecording,
  isProcessing,
  status,
  errorText,
  onCancel,
  onAccept,
  onAcceptAndSend,
  onRetry,
  onDiscard,
}: Omit<DictationControlsProps, "onStart" | "disabled" | "transcript"> & { errorText?: string }) {
  const { t } = useTranslation();
  const isFailed = status === "failed";
  const showActiveState = isRecording || isProcessing || isFailed;
  const actionsDisabled = isProcessing;
  const handleCancel = isFailed && onDiscard ? onDiscard : onCancel;

  const overlayCancelButtonStyle = useMemo(
    () => [
      overlayStyles.cancelButton,
      actionsDisabled && !isFailed && overlayStyles.buttonDisabled,
    ],
    [actionsDisabled, isFailed],
  );

  if (!showActiveState) {
    return null;
  }

  return (
    <View style={overlayStyles.container}>
      <Pressable
        onPress={handleCancel}
        disabled={actionsDisabled && !isFailed}
        accessibilityRole="button"
        accessibilityLabel={t("composer.cancelDictation")}
        style={overlayCancelButtonStyle}
      >
        <ThemedX size={ICON_SIZE.lg} uniProps={accentForegroundColorMapping} strokeWidth={2.5} />
      </Pressable>

      <View style={overlayStyles.centerContainer}>
        <View style={overlayStyles.meterRow}>
          <VolumeMeter
            volume={volume}
            isMuted={false}
            isSpeaking={false}
            orientation="horizontal"
            tone="accentForeground"
          />
          <Text style={overlayStyles.timerText}>{formatDuration(duration)}</Text>
        </View>
        {isFailed ? (
          <Text numberOfLines={2} style={overlayStyles.transcriptText}>
            {errorText
              ? t("composer.dictationFailed", { message: errorText })
              : t("composer.dictationFailedRetry")}
          </Text>
        ) : null}
      </View>

      <View style={overlayStyles.actionButtonsContainer}>
        {actionsDisabled ? (
          <View style={overlayStyles.loadingContainer}>
            <ThemedActivityIndicator size="small" uniProps={accentForegroundColorMapping} />
          </View>
        ) : null}
        {!actionsDisabled && isFailed ? (
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel={t("composer.retryDictation")}
            style={overlayStyles.actionButtonConfirm}
          >
            <ThemedRefreshCcw size={ICON_SIZE.lg} uniProps={accentColorMapping} strokeWidth={2.5} />
          </Pressable>
        ) : null}
        {!actionsDisabled && !isFailed ? (
          <>
            <Pressable
              onPress={onAccept}
              accessibilityRole="button"
              accessibilityLabel={t("composer.insertTranscription")}
              style={OVERLAY_ACCEPT_BUTTON_STYLE}
            >
              <ThemedPencil
                size={ICON_SIZE.lg}
                uniProps={accentForegroundColorMapping}
                strokeWidth={2.5}
              />
            </Pressable>
            <Pressable
              onPress={onAcceptAndSend}
              accessibilityRole="button"
              accessibilityLabel={t("composer.insertTranscriptionAndSend")}
              style={overlayStyles.actionButtonConfirm}
            >
              <ThemedArrowUp size={ICON_SIZE.lg} uniProps={accentColorMapping} strokeWidth={2.5} />
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

const BUTTON_SIZE = 32;

const styles = StyleSheet.create((theme) => ({
  micButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  activeContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  meterWrapper: {
    width: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  timerText: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.semibold,
    fontVariant: ["tabular-nums"],
    color: theme.colors.foreground,
  },
  actionGroup: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  actionButton: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: theme.borderWidth[1],
  },
  actionButtonCancel: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  actionButtonSecondary: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  actionButtonConfirm: {
    borderColor: theme.colors.foreground,
    backgroundColor: theme.colors.foreground,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  loadingContainer: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  statusLabel: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
  },
}));

const OVERLAY_BUTTON_SIZE = 44;
const OVERLAY_VERTICAL_PADDING = (FOOTER_HEIGHT - OVERLAY_BUTTON_SIZE) / 2;

const overlayStyles = StyleSheet.create((theme) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    borderRadius: theme.borderRadius["2xl"],
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[4],
    paddingVertical: OVERLAY_VERTICAL_PADDING,
    height: FOOTER_HEIGHT,
    backgroundColor: theme.colors.accent,
  },
  cancelButton: {
    width: OVERLAY_BUTTON_SIZE,
    height: OVERLAY_BUTTON_SIZE,
    borderRadius: theme.borderRadius.full,
    backgroundColor: "rgba(20, 23, 31, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  centerContainer: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  meterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[4],
  },
  // Soft timer figure: quieter than display xl.
  timerText: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: theme.fontWeight.semibold,
    fontVariant: ["tabular-nums"],
    color: theme.colors.accentForeground,
  },
  transcriptText: {
    // Soft dictation chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.normal,
    textAlign: "center",
    paddingHorizontal: theme.spacing[2],
    opacity: 0.95,
    color: theme.colors.accentForeground,
  },
  actionButtonsContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionButton: {
    width: OVERLAY_BUTTON_SIZE,
    height: OVERLAY_BUTTON_SIZE,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtonConfirm: {
    width: OVERLAY_BUTTON_SIZE,
    height: OVERLAY_BUTTON_SIZE,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accentForeground,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  loadingContainer: {
    width: OVERLAY_BUTTON_SIZE,
    height: OVERLAY_BUTTON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
}));

const ACTION_CONFIRM_STYLE = [styles.actionButton, styles.actionButtonConfirm];
const ACTION_SECONDARY_STYLE = [styles.actionButton, styles.actionButtonSecondary];
const OVERLAY_ACCEPT_BUTTON_BG = { backgroundColor: "rgba(255, 255, 255, 0.25)" };
const OVERLAY_ACCEPT_BUTTON_STYLE = [overlayStyles.actionButton, OVERLAY_ACCEPT_BUTTON_BG];
