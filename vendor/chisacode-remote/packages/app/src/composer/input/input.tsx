import {
  StyleSheet as RNStyleSheet,
  View,
  Text,
  TextInput,
  ActivityIndicator,
  useWindowDimensions,
  NativeSyntheticEvent,
  TextInputContentSizeChangeEventData,
  TextInputKeyPressEventData,
  TextInputSelectionChangeEventData,
} from "react-native";
import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  forwardRef,
} from "react";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { ArrowUp, Mic, MicOff, CornerDownLeft, Plus, Square } from "lucide-react-native";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { useDictation } from "@/hooks/use-dictation";
import { DictationOverlay } from "@/components/dictation-controls";
import { RealtimeVoiceOverlay } from "@/components/realtime-voice-overlay";
import type { DaemonClient } from "@chisacode/client/internal/daemon-client";
import { useSessionStore } from "@/stores/session-store";
import { useVoiceOptional } from "@/contexts/voice-context";
import { useToast } from "@/contexts/toast-context";
import { resolveVoiceUnavailableMessage } from "@/utils/server-info-capabilities";
import {
  collectImageFilesFromClipboardData,
  filesToImageAttachments,
} from "@/utils/image-attachments-from-files";
import type { ComposerAttachment } from "@/attachments/types";
import type { ImageAttachment, MessagePayload } from "@/composer/types";
import { focusWithRetries } from "@/utils/web-focus";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Shortcut } from "@/components/ui/shortcut";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWebElementScrollbar } from "@/components/use-web-scrollbar";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useIosHardwareKeyboardSubmit } from "@/hooks/use-ios-hardware-keyboard-submit";
import { formatShortcut } from "@/utils/format-shortcut";
import { getShortcutOs } from "@/utils/shortcut-platform";
import type { MessageInputKeyboardActionKind } from "@/keyboard/actions";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";
import { isNative, isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { resolveSoftComposerCardElevation } from "@/composer/draft/soft-home-layout";
import { COMPOSER_VOICE_UI_VISIBLE } from "@/composer/voice-visibility";
import { useComposerHeightMirror } from "./height-mirror";
import { computeCanStartDictation } from "./state";
import { useTranslation } from "react-i18next";

export interface AttachmentMenuItem {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  icon?: React.ReactElement | null;
  trailing?: React.ReactElement | null;
  closeOnSelect?: boolean;
}

export interface MessageInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: (payload: MessagePayload) => void;
  /** When true, the submit button is enabled even without text or images (e.g. external attachment selected). */
  hasExternalContent?: boolean;
  /** When true, the submit button stays visible and can submit even with no content. */
  allowEmptySubmit?: boolean;
  /** Optional accessibility label for the primary submit button. */
  submitButtonAccessibilityLabel?: string;
  submitIcon?: "arrow" | "return";
  isSubmitDisabled?: boolean;
  isSubmitLoading?: boolean;
  attachments: ComposerAttachment[];
  cwd: string;
  attachmentMenuItems: AttachmentMenuItem[];
  onAttachButtonRef?: (node: View | null) => void;
  onAddImages?: (images: ImageAttachment[]) => void;
  client: DaemonClient | null;
  /** Dictation start gate from host runtime (socket connected + directory ready). */
  isReadyForDictation?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  autoFocusKey?: string;
  disabled?: boolean;
  /** True when this composer's pane is focused. Used to gate global hotkeys and stop dictation when hidden. */
  isPaneFocused?: boolean;
  /** Content to render on the left side of the composer toolbar (e.g., AgentControls) */
  leftContent?: React.ReactNode;
  /** Content to render on the right side before the voice button (e.g., context window meter) */
  beforeVoiceContent?: React.ReactNode;
  /** Content to render on the right side after voice button (e.g., realtime button, cancel button) */
  rightContent?: React.ReactNode;
  voiceServerId?: string;
  voiceAgentId?: string;
  /** When true and there's sendable content, calls onQueue instead of onSubmit */
  isAgentRunning?: boolean;
  /** Controls what the default send action (Enter, send button, dictation) does
   *  when the agent is running. "interrupt" sends immediately, "queue" queues. */
  defaultSendBehavior?: "interrupt" | "queue";
  /** Callback for queue button when agent is running */
  onQueue?: (payload: MessagePayload) => void;
  /** Optional handler used when submit button is in loading state. */
  onSubmitLoadingPress?: () => void;
  /** Intercept key press events before default handling. Return true to prevent default. */
  onKeyPress?: (event: { key: string; preventDefault: () => void }) => boolean;
  /** Reports cursor selection updates from the underlying input. */
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  onFocusChange?: (focused: boolean) => void;
  onHeightChange?: (height: number) => void;
  /** Extra styles merged onto the input wrapper (e.g. elevated background). */
  inputWrapperStyle?: import("react-native").ViewStyle;
  /** Content rendered inside the bordered input surface, above the text input (e.g. attachment pills). */
  attachmentSlot?: React.ReactNode;
}

export interface MessageInputRef {
  focus: () => void;
  blur: () => void;
  runKeyboardAction: (action: MessageInputKeyboardActionKind) => boolean;
  /**
   * Web-only: return the underlying DOM element for focus assertions/retries.
   * May return null if not mounted or on native.
   */
  getNativeElement?: () => HTMLElement | null;
}

const MIN_INPUT_HEIGHT_MOBILE = 30;
const MIN_INPUT_HEIGHT_DESKTOP = 46;
const DEFAULT_MAX_INPUT_HEIGHT = 160;
const MAX_INPUT_VIEWPORT_RATIO = 0.5;
const MIN_INPUT_HEIGHT = isWeb ? MIN_INPUT_HEIGHT_DESKTOP : MIN_INPUT_HEIGHT_MOBILE;

type WebTextInputKeyPressEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & {
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    // Web-only: present on DOM KeyboardEvent during IME composition (CJK input).
    isComposing?: boolean;
    keyCode?: number;
  }
>;

interface TextAreaHandle {
  scrollHeight?: number;
  clientHeight?: number;
  offsetHeight?: number;
  scrollTop?: number;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  style?: {
    height?: string;
    overflowY?: string;
  } & Record<string, unknown>;
}

function AttachButtonIcon({
  hovered,
  onAttachButtonRef,
  buttonIconSize,
}: {
  hovered: boolean;
  onAttachButtonRef: ((node: View | null) => void) | undefined;
  buttonIconSize: number;
}) {
  return (
    <View ref={onAttachButtonRef} collapsable={false} style={styles.attachButtonAnchor}>
      <ThemedPlus
        size={buttonIconSize}
        style={hovered ? styles.iconForeground : styles.iconForegroundMuted}
      />
    </View>
  );
}

function AttachmentMenuList({ items }: { items: AttachmentMenuItem[] }) {
  return (
    <>
      {items.map((item) => (
        <DropdownMenuItem
          key={item.id}
          testID={`message-input-attachment-menu-item-${item.id}`}
          disabled={item.disabled}
          onSelect={item.onSelect}
          leading={item.icon ?? null}
          trailing={item.trailing ?? null}
          closeOnSelect={item.closeOnSelect ?? true}
        >
          {item.label}
        </DropdownMenuItem>
      ))}
    </>
  );
}

function AttachmentDropdown({
  isConnected,
  disabled,
  attachButtonStyle,
  renderAttachButtonIcon,
  attachmentMenuItems,
  addAttachmentLabel,
}: {
  isConnected: boolean;
  disabled: boolean;
  attachButtonStyle: React.ComponentProps<typeof DropdownMenuTrigger>["style"];
  renderAttachButtonIcon: (input: { hovered?: boolean }) => React.ReactElement;
  attachmentMenuItems: AttachmentMenuItem[];
  addAttachmentLabel: string;
}) {
  return (
    <DropdownMenu>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger
            disabled={!isConnected || disabled}
            accessibilityLabel={addAttachmentLabel}
            accessibilityRole="button"
            testID="message-input-attach-button"
            style={attachButtonStyle}
          >
            {renderAttachButtonIcon}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{addAttachmentLabel}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="start"
        offset={8}
        minWidth={220}
        testID="message-input-attachment-menu"
      >
        <AttachmentMenuList items={attachmentMenuItems} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function VoiceButtonIcon({
  hovered,
  isDictating,
  isMutedRealtime,
  buttonIconSize,
}: {
  hovered: boolean;
  isDictating: boolean;
  isMutedRealtime: boolean;
  buttonIconSize: number;
}) {
  if (isDictating) {
    return <Square size={buttonIconSize} color="white" fill="white" />;
  }
  const iconStyle = hovered ? styles.iconForeground : styles.iconForegroundMuted;
  if (isMutedRealtime) {
    return <ThemedMicOff size={buttonIconSize} style={iconStyle} />;
  }
  return <ThemedMic size={buttonIconSize} style={iconStyle} />;
}

type ShortcutChord = NonNullable<React.ComponentProps<typeof Shortcut>["chord"]>;

function VoiceTooltipBody({
  voiceTooltipText,
  shortcut,
}: {
  voiceTooltipText: string;
  shortcut: ShortcutChord | null | undefined;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{voiceTooltipText}</Text>
      {shortcut ? <Shortcut chord={shortcut} /> : null}
    </View>
  );
}

function SendTooltipBody({
  label,
  sendKeys,
}: {
  label: string;
  sendKeys: ShortcutChord | null | undefined;
}) {
  return (
    <View style={styles.tooltipRow}>
      <Text style={styles.tooltipText}>{label}</Text>
      {sendKeys ? <Shortcut chord={sendKeys} /> : null}
    </View>
  );
}

function SendButtonContent({
  isSubmitLoading,
  submitIcon,
  buttonIconSize,
}: {
  isSubmitLoading: boolean;
  submitIcon: "arrow" | "return";
  buttonIconSize: number;
}) {
  // Soft .send uses --send-fg (primaryForeground), not accent chip white.
  if (isSubmitLoading) {
    return <ThemedActivityIndicator size="small" style={styles.iconPrimaryForeground} />;
  }
  if (submitIcon === "return") {
    return <ThemedCornerDownLeft size={buttonIconSize} style={styles.iconPrimaryForeground} />;
  }
  return <ThemedArrowUp size={buttonIconSize} style={styles.iconPrimaryForeground} />;
}

function resolveSubmitAccessibilityLabel(input: {
  submitButtonAccessibilityLabel: string | undefined;
  canPressLoadingButton: boolean;
  defaultActionQueues: boolean;
  isAgentRunning: boolean;
  labels: {
    interruptAgent: string;
    queueMessage: string;
    sendAndInterrupt: string;
    sendMessage: string;
  };
}): string {
  if (input.submitButtonAccessibilityLabel) return input.submitButtonAccessibilityLabel;
  if (input.canPressLoadingButton) return input.labels.interruptAgent;
  if (input.defaultActionQueues) return input.labels.queueMessage;
  if (input.isAgentRunning) return input.labels.sendAndInterrupt;
  return input.labels.sendMessage;
}

function resolveVoiceAccessibilityLabel(input: {
  isRealtimeVoiceForCurrentAgent: boolean;
  isMuted: boolean;
  isDictating: boolean;
  labels: {
    unmuteVoiceMode: string;
    muteVoiceMode: string;
    stopDictation: string;
    startDictation: string;
  };
}): string {
  if (input.isRealtimeVoiceForCurrentAgent) {
    return input.isMuted ? input.labels.unmuteVoiceMode : input.labels.muteVoiceMode;
  }
  if (input.isDictating) return input.labels.stopDictation;
  return input.labels.startDictation;
}

function resolveVoiceTooltipText(input: {
  isRealtimeVoiceForCurrentAgent: boolean;
  isMuted: boolean;
  labels: {
    unmute: string;
    mute: string;
    dictation: string;
  };
}): string {
  if (input.isRealtimeVoiceForCurrentAgent) {
    return input.isMuted ? input.labels.unmute : input.labels.mute;
  }
  return input.labels.dictation;
}

function resolveSendTooltipLabel(input: {
  submitButtonAccessibilityLabel: string | undefined;
  defaultActionQueues: boolean;
  labels: {
    queue: string;
    send: string;
  };
}): string {
  if (input.submitButtonAccessibilityLabel) return input.submitButtonAccessibilityLabel;
  return input.defaultActionQueues ? input.labels.queue : input.labels.send;
}

interface DesktopKeyPressContext {
  onKeyPressCallback: ((event: { key: string; preventDefault: () => void }) => boolean) | undefined;
  submitOnEnter: boolean;
  isAgentRunning: boolean;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  disabled: boolean;
  handleAlternateSendAction: () => void;
  handleDefaultSendAction: () => void;
}

function handleDesktopKeyPressImpl(
  event: WebTextInputKeyPressEvent,
  ctx: DesktopKeyPressContext,
): void {
  if (isImeComposingKeyboardEvent(event.nativeEvent)) return;

  if (ctx.onKeyPressCallback) {
    const handled = ctx.onKeyPressCallback({
      key: event.nativeEvent.key,
      preventDefault: () => event.preventDefault(),
    });
    if (handled) return;
  }

  const { shiftKey, metaKey, ctrlKey } = event.nativeEvent;

  if (event.nativeEvent.key !== "Enter") return;
  if (!ctx.submitOnEnter) return;
  if (shiftKey) return;

  if ((metaKey || ctrlKey) && ctx.isAgentRunning && ctx.onQueue) {
    if (ctx.isSubmitDisabled || ctx.isSubmitLoading || ctx.disabled) return;
    event.preventDefault();
    ctx.handleAlternateSendAction();
    return;
  }

  if (ctx.isSubmitDisabled || ctx.isSubmitLoading || ctx.disabled) return;
  event.preventDefault();
  ctx.handleDefaultSendAction();
}

function handleNativeKeyPress(
  event: NativeSyntheticEvent<TextInputKeyPressEventData>,
  ctx: DesktopKeyPressContext,
): void {
  if (event.nativeEvent.key !== "Enter") return;
  if (!ctx.submitOnEnter) return;
  if (ctx.isSubmitDisabled || ctx.isSubmitLoading || ctx.disabled) return;
  ctx.handleDefaultSendAction();
}

function computeShouldSubmitOnEnter(web: boolean, compact: boolean, native: boolean): boolean {
  if (web && !compact) return true;
  return native;
}

function resolveKeyPressHandler(
  web: boolean,
  native: boolean,
  desktop: (event: WebTextInputKeyPressEvent) => void,
  nativeHandler: (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => void,
):
  | ((event: WebTextInputKeyPressEvent | NativeSyntheticEvent<TextInputKeyPressEventData>) => void)
  | undefined {
  if (web) return desktop;
  if (native) return nativeHandler;
  return undefined;
}

interface KeyboardActionHandlers {
  textInputRef: React.MutableRefObject<
    TextInput | (TextInput & { getNativeRef?: () => unknown }) | null
  >;
  isDictatingRef: React.MutableRefObject<boolean>;
  sendAfterTranscriptRef: React.MutableRefObject<boolean>;
  confirmDictation: () => void | Promise<void>;
  cancelDictation: () => void | Promise<void>;
  startDictationIfAvailable: () => Promise<void>;
  handleToggleRealtimeVoiceShortcut: () => void;
  isVoiceUiVisible: boolean;
  isRealtimeVoiceForCurrentAgent: boolean;
  voice: { toggleMute: () => void } | null | undefined;
}

function runKeyboardActionImpl(
  action: MessageInputKeyboardActionKind,
  h: KeyboardActionHandlers,
): boolean {
  if (action === "focus") {
    h.textInputRef.current?.focus();
    return true;
  }
  if (action === "send" || action === "dictation-confirm") {
    if (h.isDictatingRef.current) {
      h.sendAfterTranscriptRef.current = true;
      void h.confirmDictation();
      return true;
    }
    return false;
  }
  if (action === "voice-toggle") {
    if (!h.isVoiceUiVisible) return false;
    h.handleToggleRealtimeVoiceShortcut();
    return true;
  }
  if (action === "voice-mute-toggle") {
    if (!h.isVoiceUiVisible) return false;
    if (h.isRealtimeVoiceForCurrentAgent) {
      h.voice?.toggleMute();
    }
    return true;
  }
  if (action === "dictation-cancel") {
    if (h.isDictatingRef.current) {
      void h.cancelDictation();
      return true;
    }
    return false;
  }
  if (action === "dictation-toggle") {
    if (!h.isVoiceUiVisible) return false;
    if (h.isDictatingRef.current) {
      h.sendAfterTranscriptRef.current = true;
      void h.confirmDictation();
    } else {
      void h.startDictationIfAvailable();
    }
    return true;
  }
  return false;
}

function getTextInputNativeElement(
  current: TextInput | (TextInput & { getNativeRef?: () => unknown }) | null,
): HTMLElement | null {
  if (!current) return null;
  const handle = current as TextInput & { getNativeRef?: () => unknown };
  const native = typeof handle.getNativeRef === "function" ? handle.getNativeRef() : current;
  return native instanceof HTMLElement ? native : null;
}

interface PasteImagesEffectArgs {
  getWebTextArea: () => TextAreaHandle | null;
  isConnected: boolean;
  disabled: boolean;
  isDictating: boolean;
  isRealtimeVoiceForCurrentAgent: boolean;
  onAddImages: ((images: ImageAttachment[]) => void) | undefined;
}

function usePasteImagesEffect(args: PasteImagesEffectArgs): void {
  const {
    getWebTextArea,
    isConnected,
    disabled,
    isDictating,
    isRealtimeVoiceForCurrentAgent,
    onAddImages,
  } = args;

  // Track the guard-only state in refs so toggling dictation/voice does not
  // tear down and re-add the paste listener (the guard already short-circuits).
  const isDictatingRef = useRef(isDictating);
  const isRealtimeVoiceRef = useRef(isRealtimeVoiceForCurrentAgent);
  isDictatingRef.current = isDictating;
  isRealtimeVoiceRef.current = isRealtimeVoiceForCurrentAgent;

  useEffect(() => {
    if (!isWeb || !onAddImages) return;

    const textarea = getWebTextArea() as
      | (TextAreaHandle & {
          addEventListener?: (type: string, listener: (e: ClipboardEvent) => void) => void;
          removeEventListener?: (type: string, listener: (e: ClipboardEvent) => void) => void;
        })
      | null;
    if (
      !textarea ||
      typeof textarea.addEventListener !== "function" ||
      typeof textarea.removeEventListener !== "function"
    ) {
      return;
    }

    let disposed = false;
    const handlePaste = (event: ClipboardEvent) => {
      if (!isConnected || disabled || isDictatingRef.current || isRealtimeVoiceRef.current) return;

      const imageFiles = collectImageFilesFromClipboardData(event.clipboardData);
      if (imageFiles.length === 0) return;

      event.preventDefault();

      void filesToImageAttachments(imageFiles)
        .then((pastedAttachments) => {
          if (disposed || pastedAttachments.length === 0) return;
          onAddImages(pastedAttachments);
          return;
        })
        .catch((error) => {
          console.error("[MessageInput] Failed to process pasted images:", error);
        });
    };

    textarea.addEventListener("paste", handlePaste);
    return () => {
      disposed = true;
      textarea.removeEventListener?.("paste", handlePaste);
    };
  }, [disabled, getWebTextArea, isConnected, onAddImages]);
}

function useAutoFocusOnWebEffect(
  textInputRef: React.MutableRefObject<
    TextInput | (TextInput & { getNativeRef?: () => unknown }) | null
  >,
  autoFocus: boolean,
  autoFocusKey: string | undefined,
): void {
  useEffect(() => {
    if (!isWeb || !autoFocus) return;
    return focusWithRetries({
      focus: () => textInputRef.current?.focus(),
      isFocused: () => {
        const element = getTextInputNativeElement(textInputRef.current);
        const active = typeof document !== "undefined" ? document.activeElement : null;
        return Boolean(element) && active === element;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, autoFocusKey]);
}

function MessageInputOverlay({
  showDictationOverlay,
  showRealtimeOverlay,
  voice,
  dictationVolume,
  dictationDuration,
  isDictating,
  isDictationProcessing,
  dictationStatus,
  dictationError,
  onCancelRecording,
  onAcceptRecording,
  onAcceptAndSendRecording,
  onRetryFailedRecording,
  onDiscardFailedRecording,
  onRealtimeVoiceStop,
}: {
  showDictationOverlay: boolean;
  showRealtimeOverlay: boolean;
  voice:
    | {
        isMuted: boolean;
        isVoiceSwitching: boolean;
        toggleMute: () => void;
      }
    | null
    | undefined;
  dictationVolume: number;
  dictationDuration: number;
  isDictating: boolean;
  isDictationProcessing: boolean;
  dictationStatus: React.ComponentProps<typeof DictationOverlay>["status"];
  dictationError: string | null;
  onCancelRecording: () => Promise<void>;
  onAcceptRecording: () => Promise<void>;
  onAcceptAndSendRecording: () => Promise<void>;
  onRetryFailedRecording: () => void;
  onDiscardFailedRecording: () => void;
  onRealtimeVoiceStop: () => void;
}) {
  if (showDictationOverlay) {
    return (
      <DictationOverlay
        volume={dictationVolume}
        duration={dictationDuration}
        isRecording={isDictating}
        isProcessing={isDictationProcessing}
        status={dictationStatus}
        errorText={dictationStatus === "failed" ? (dictationError ?? undefined) : undefined}
        onCancel={onCancelRecording}
        onAccept={onAcceptRecording}
        onAcceptAndSend={onAcceptAndSendRecording}
        onRetry={dictationStatus === "failed" ? onRetryFailedRecording : undefined}
        onDiscard={dictationStatus === "failed" ? onDiscardFailedRecording : undefined}
      />
    );
  }
  if (showRealtimeOverlay && voice) {
    return (
      <RealtimeVoiceOverlay
        isMuted={voice.isMuted}
        isSwitching={voice.isVoiceSwitching}
        onToggleMute={voice.toggleMute}
        onStop={onRealtimeVoiceStop}
      />
    );
  }
  return null;
}

function FocusHint({
  visible,
  focusInputKeys,
  label,
}: {
  visible: boolean;
  focusInputKeys: ShortcutChord | null | undefined;
  label: string;
}) {
  if (!visible || !focusInputKeys) return null;
  const shortcut = formatShortcut(focusInputKeys[0], getShortcutOs());
  return (
    <Text style={styles.focusHintText} pointerEvents="none">
      {label.replace("{{shortcut}}", shortcut)}
    </Text>
  );
}

function VoiceButtonTooltip({
  onVoicePress,
  isDictationStartEnabled,
  voiceButtonAccessibilityLabel,
  voiceButtonStyle,
  renderVoiceButtonIcon,
  voiceTooltipText,
  isRealtimeVoiceForCurrentAgent,
  voiceMuteToggleKeys,
  dictationToggleKeys,
}: {
  onVoicePress: () => void;
  isDictationStartEnabled: boolean;
  voiceButtonAccessibilityLabel: string;
  voiceButtonStyle: React.ComponentProps<typeof TooltipTrigger>["style"];
  renderVoiceButtonIcon: (input: { hovered?: boolean }) => React.ReactElement;
  voiceTooltipText: string;
  isRealtimeVoiceForCurrentAgent: boolean;
  voiceMuteToggleKeys: ShortcutChord | null | undefined;
  dictationToggleKeys: ShortcutChord | null | undefined;
}) {
  const shortcut = isRealtimeVoiceForCurrentAgent ? voiceMuteToggleKeys : dictationToggleKeys;
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={onVoicePress}
        disabled={!isDictationStartEnabled}
        accessibilityRole="button"
        accessibilityLabel={voiceButtonAccessibilityLabel}
        style={voiceButtonStyle}
      >
        {renderVoiceButtonIcon}
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <VoiceTooltipBody voiceTooltipText={voiceTooltipText} shortcut={shortcut} />
      </TooltipContent>
    </Tooltip>
  );
}

function SendButtonTooltip({
  shouldShow,
  canPressLoadingButton,
  onSubmitLoadingPress,
  onDefaultSendAction,
  isSendButtonDisabled,
  submitAccessibilityLabel,
  sendButtonCombinedStyle,
  isSubmitLoading,
  submitIcon,
  buttonIconSize,
  sendKeys,
  sendTooltipLabel,
}: {
  shouldShow: boolean;
  canPressLoadingButton: boolean;
  onSubmitLoadingPress: (() => void) | undefined;
  onDefaultSendAction: () => void;
  isSendButtonDisabled: boolean;
  submitAccessibilityLabel: string;
  sendButtonCombinedStyle: React.ComponentProps<typeof TooltipTrigger>["style"];
  isSubmitLoading: boolean;
  submitIcon: "arrow" | "return";
  buttonIconSize: number;
  sendKeys: ShortcutChord | null | undefined;
  sendTooltipLabel: string;
}) {
  if (!shouldShow) return null;
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger
        onPress={canPressLoadingButton ? onSubmitLoadingPress : onDefaultSendAction}
        disabled={isSendButtonDisabled}
        accessibilityLabel={submitAccessibilityLabel}
        accessibilityRole="button"
        testID="composer-send-button"
        style={sendButtonCombinedStyle}
      >
        <SendButtonContent
          isSubmitLoading={isSubmitLoading}
          submitIcon={submitIcon}
          buttonIconSize={buttonIconSize}
        />
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <SendTooltipBody label={sendTooltipLabel} sendKeys={sendKeys} />
      </TooltipContent>
    </Tooltip>
  );
}

interface DictationTranscriptContext {
  value: string;
  defaultSendBehavior: "interrupt" | "queue";
  isAgentRunning: boolean;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  onSubmit: (payload: MessagePayload) => void;
  onChangeText: (text: string) => void;
  attachments: ComposerAttachment[];
  cwd: string;
  autoSend: boolean;
}

function applyDictationTranscript(text: string, ctx: DictationTranscriptContext): void {
  if (!text) return;
  const shouldPad = ctx.value.length > 0 && !/\s$/.test(ctx.value);
  const nextValue = `${ctx.value}${shouldPad ? " " : ""}${text}`;

  if (!ctx.autoSend) {
    ctx.onChangeText(nextValue);
    return;
  }

  if (ctx.defaultSendBehavior === "queue" && ctx.isAgentRunning && ctx.onQueue) {
    ctx.onQueue({ text: nextValue, attachments: ctx.attachments, cwd: ctx.cwd });
    ctx.onChangeText("");
    return;
  }

  ctx.onSubmit({
    text: nextValue,
    attachments: ctx.attachments,
    cwd: ctx.cwd,
    forceSend: ctx.isAgentRunning || undefined,
  });
}

interface ToggleRealtimeVoiceContext {
  voice:
    | {
        isVoiceSwitching: boolean;
        isVoiceModeForAgent: (serverId: string, agentId: string) => boolean;
        startVoice: (serverId: string, agentId: string) => Promise<unknown>;
      }
    | null
    | undefined;
  voiceServerId: string | undefined;
  voiceAgentId: string | undefined;
  isConnected: boolean;
  disabled: boolean;
  isAgentRunning: boolean;
  handleStopRealtimeVoice: () => Promise<unknown> | void;
  toast: { error: (msg: string) => void };
  interruptBeforeVoiceModeMessage: string;
}

function toggleRealtimeVoiceImpl(ctx: ToggleRealtimeVoiceContext): void {
  if (!ctx.voice || !ctx.voiceServerId || !ctx.voiceAgentId || !ctx.isConnected || ctx.disabled) {
    return;
  }
  if (ctx.voice.isVoiceSwitching) return;
  if (ctx.voice.isVoiceModeForAgent(ctx.voiceServerId, ctx.voiceAgentId)) {
    void ctx.handleStopRealtimeVoice();
    return;
  }
  if (ctx.isAgentRunning) {
    ctx.toast.error(ctx.interruptBeforeVoiceModeMessage);
    return;
  }
  void ctx.voice.startVoice(ctx.voiceServerId, ctx.voiceAgentId).catch((error) => {
    console.error("[MessageInput] Failed to start realtime voice", error);
    const message = extractErrorMessage(error);
    if (message && message.trim().length > 0) {
      ctx.toast.error(message);
    }
  });
}

interface StartDictationContext {
  dictationUnavailableMessage: string | null | undefined;
  canStartDictation: () => boolean;
  isDictatingRef: React.MutableRefObject<boolean>;
  toast: { error: (msg: string) => void };
  startDictation: () => Promise<void>;
}

async function startDictationIfAvailableImpl(ctx: StartDictationContext): Promise<void> {
  if (ctx.dictationUnavailableMessage) {
    ctx.isDictatingRef.current = false;
    ctx.toast.error(ctx.dictationUnavailableMessage);
    return;
  }
  if (!ctx.canStartDictation()) {
    ctx.isDictatingRef.current = false;
    return;
  }
  ctx.isDictatingRef.current = true;
  await ctx.startDictation();
}

interface StopRealtimeVoiceContext {
  voice: { stopVoice: () => Promise<unknown> } | null | undefined;
  isRealtimeVoiceForCurrentAgent: boolean;
  isAgentRunning: boolean;
  client: { cancelAgent: (agentId: string) => Promise<unknown> } | null;
  voiceAgentId: string | undefined;
}

async function stopRealtimeVoiceImpl(ctx: StopRealtimeVoiceContext): Promise<void> {
  if (!ctx.voice || !ctx.isRealtimeVoiceForCurrentAgent) return;

  const tasks: Promise<unknown>[] = [];
  if (ctx.isAgentRunning && ctx.client && ctx.voiceAgentId) {
    tasks.push(ctx.client.cancelAgent(ctx.voiceAgentId));
  }
  tasks.push(ctx.voice.stopVoice());

  const results = await Promise.allSettled(tasks);
  results.forEach((result) => {
    if (result.status === "rejected") {
      console.error("[MessageInput] Failed to stop realtime voice", result.reason);
    }
  });
}

interface VoicePressContext {
  isRealtimeVoiceForCurrentAgent: boolean;
  voice: { toggleMute: () => void } | null | undefined;
  isDictating: boolean;
  cancelDictation: () => Promise<void> | void;
  startDictationIfAvailable: () => Promise<void>;
}

async function handleVoicePressImpl(ctx: VoicePressContext): Promise<void> {
  if (ctx.isRealtimeVoiceForCurrentAgent && ctx.voice) {
    ctx.voice.toggleMute();
    return;
  }
  if (ctx.isDictating) {
    await ctx.cancelDictation();
    return;
  }
  await ctx.startDictationIfAvailable();
}

interface SendMessageContext {
  value: string;
  attachments: ComposerAttachment[];
  hasExternalContent: boolean;
  allowEmptySubmit: boolean;
  cwd: string;
  isAgentRunning: boolean;
  onSubmit: (payload: MessagePayload) => void;
  onMinimizeHeight: () => void;
}

function sendMessageImpl(ctx: SendMessageContext): void {
  const trimmed = ctx.value.trim();
  if (
    !trimmed &&
    ctx.attachments.length === 0 &&
    !ctx.hasExternalContent &&
    !ctx.allowEmptySubmit
  ) {
    return;
  }
  ctx.onSubmit({
    text: trimmed,
    attachments: ctx.attachments,
    cwd: ctx.cwd,
    forceSend: ctx.isAgentRunning || undefined,
  });
  ctx.onMinimizeHeight();
}

interface QueueMessageContext {
  value: string;
  attachments: ComposerAttachment[];
  cwd: string;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  onChangeText: (text: string) => void;
  onMinimizeHeight: () => void;
}

function queueMessageImpl(ctx: QueueMessageContext): void {
  if (!ctx.onQueue) return;
  const trimmed = ctx.value.trim();
  if (!trimmed && ctx.attachments.length === 0) return;
  ctx.onQueue({ text: trimmed, attachments: ctx.attachments, cwd: ctx.cwd });
  ctx.onChangeText("");
  ctx.onMinimizeHeight();
}

function computeIsRealtimeVoiceForAgent(
  voice: { isVoiceModeForAgent: (serverId: string, agentId: string) => boolean } | null | undefined,
  voiceServerId: string | undefined,
  voiceAgentId: string | undefined,
): boolean {
  if (!voice || !voiceServerId || !voiceAgentId) return false;
  return voice.isVoiceModeForAgent(voiceServerId, voiceAgentId);
}

function computeShouldShowDictationOverlay(
  isDictating: boolean,
  isDictationProcessing: boolean,
  dictationStatus: string,
): boolean {
  return isDictating || isDictationProcessing || dictationStatus === "failed";
}

function computeVisibleDictationOverlay(
  isDictating: boolean,
  isDictationProcessing: boolean,
  dictationStatus: string,
): boolean {
  if (!COMPOSER_VOICE_UI_VISIBLE) return false;
  return computeShouldShowDictationOverlay(isDictating, isDictationProcessing, dictationStatus);
}

function computeVisibleRealtimeOverlay(isRealtimeVoiceForCurrentAgent: boolean): boolean {
  if (!COMPOSER_VOICE_UI_VISIBLE) return false;
  return isRealtimeVoiceForCurrentAgent;
}

interface SendableContentInput {
  value: string;
  attachments: ComposerAttachment[];
  hasExternalContent: boolean;
  allowEmptySubmit: boolean;
  isSubmitLoading: boolean;
}

interface SendableContentOutput {
  hasAttachments: boolean;
  hasRealContent: boolean;
  hasSendableContent: boolean;
  shouldShowSendButton: boolean;
}

function computeSendableContent(input: SendableContentInput): SendableContentOutput {
  const hasAttachments = input.attachments.length > 0;
  const hasRealContent = input.value.trim().length > 0 || hasAttachments;
  const hasSendableContent = hasRealContent || input.hasExternalContent;
  const shouldShowSendButton =
    hasSendableContent || input.allowEmptySubmit || input.isSubmitLoading;
  return { hasAttachments, hasRealContent, hasSendableContent, shouldShowSendButton };
}

function computeIsDictationStartEnabled(
  isReadyForDictation: boolean | undefined,
  isConnected: boolean,
  disabled: boolean,
): boolean {
  return (isReadyForDictation ?? isConnected) && !disabled;
}

function resolveMaxInputHeight(windowHeight: number): number {
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return DEFAULT_MAX_INPUT_HEIGHT;
  return Math.max(DEFAULT_MAX_INPUT_HEIGHT, Math.floor(windowHeight * MAX_INPUT_VIEWPORT_RATIO));
}

function computeTextInputHeightStyle(inputHeight: number, maxInputHeight: number) {
  if (isWeb) {
    return {
      height: inputHeight,
      minHeight: MIN_INPUT_HEIGHT,
      maxHeight: maxInputHeight,
    };
  }
  return {
    minHeight: MIN_INPUT_HEIGHT,
    maxHeight: maxInputHeight,
  };
}

function isTextAreaLike(v: unknown): v is TextAreaHandle {
  return typeof v === "object" && v !== null && "scrollHeight" in v;
}

function getWebTextAreaImpl(
  current: TextInput | (TextInput & { getNativeRef?: () => unknown }) | null,
): TextAreaHandle | null {
  if (!current) return null;
  const candidate = current as { getNativeRef?: () => unknown };
  if (typeof candidate.getNativeRef === "function") {
    const native = candidate.getNativeRef();
    if (isTextAreaLike(native)) return native;
  }
  if (isTextAreaLike(current)) return current;
  return null;
}

interface SendButtonStateInput {
  disabled: boolean;
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  onSubmitLoadingPress: (() => void) | undefined;
  defaultSendBehavior: "interrupt" | "queue";
  isAgentRunning: boolean;
}

interface SendButtonStateOutput {
  canPressLoadingButton: boolean;
  isSendButtonDisabled: boolean;
  defaultActionQueues: boolean;
}

function computeSendButtonState(input: SendButtonStateInput): SendButtonStateOutput {
  const canPressLoadingButton =
    input.isSubmitLoading && typeof input.onSubmitLoadingPress === "function";
  const isSendButtonDisabled =
    input.disabled || (!canPressLoadingButton && (input.isSubmitDisabled || input.isSubmitLoading));
  const defaultActionQueues = input.defaultSendBehavior === "queue" && input.isAgentRunning;
  return { canPressLoadingButton, isSendButtonDisabled, defaultActionQueues };
}

interface DefaultSendActionContext {
  defaultSendBehavior: "interrupt" | "queue";
  isAgentRunning: boolean;
  onQueue: ((payload: MessagePayload) => void) | undefined;
  handleSendMessage: () => void;
  handleQueueMessage: () => void;
}

function runDefaultSendAction(ctx: DefaultSendActionContext): void {
  if (ctx.defaultSendBehavior === "queue" && ctx.isAgentRunning && ctx.onQueue) {
    ctx.handleQueueMessage();
    return;
  }
  ctx.handleSendMessage();
}

function runAlternateSendAction(ctx: DefaultSendActionContext): void {
  if (ctx.defaultSendBehavior === "queue") {
    ctx.handleSendMessage();
    return;
  }
  if (ctx.onQueue) {
    ctx.handleQueueMessage();
  }
}

interface ResolvedMessageInputProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: (payload: MessagePayload) => void;
  hasExternalContent: boolean;
  allowEmptySubmit: boolean;
  submitButtonAccessibilityLabel: string | undefined;
  submitIcon: "arrow" | "return";
  isSubmitDisabled: boolean;
  isSubmitLoading: boolean;
  attachments: ComposerAttachment[];
  cwd: string;
  attachmentMenuItems: AttachmentMenuItem[];
  onAttachButtonRef: ((node: View | null) => void) | undefined;
  onAddImages: ((images: ImageAttachment[]) => void) | undefined;
  client: DaemonClient | null;
  isReadyForDictation: boolean | undefined;
  placeholder: string | undefined;
  autoFocus: boolean;
  autoFocusKey: string | undefined;
  disabled: boolean;
  isPaneFocused: boolean;
  leftContent: React.ReactNode;
  beforeVoiceContent: React.ReactNode;
  rightContent: React.ReactNode;
  voiceServerId: string | undefined;
  voiceAgentId: string | undefined;
  isAgentRunning: boolean;
  defaultSendBehavior: "interrupt" | "queue";
  onQueue: ((payload: MessagePayload) => void) | undefined;
  onSubmitLoadingPress: (() => void) | undefined;
  onKeyPressCallback: ((event: { key: string; preventDefault: () => void }) => boolean) | undefined;
  onSelectionChangeCallback: ((selection: { start: number; end: number }) => void) | undefined;
  onFocusChange: ((focused: boolean) => void) | undefined;
  onHeightChange: ((height: number) => void) | undefined;
  inputWrapperStyle: import("react-native").ViewStyle | undefined;
  attachmentSlot: React.ReactNode;
}

function resolveMessageInputProps(props: MessageInputProps): ResolvedMessageInputProps {
  return {
    value: props.value,
    onChangeText: props.onChangeText,
    onSubmit: props.onSubmit,
    hasExternalContent: props.hasExternalContent ?? false,
    allowEmptySubmit: props.allowEmptySubmit ?? false,
    submitButtonAccessibilityLabel: props.submitButtonAccessibilityLabel,
    submitIcon: props.submitIcon ?? "arrow",
    isSubmitDisabled: props.isSubmitDisabled ?? false,
    isSubmitLoading: props.isSubmitLoading ?? false,
    attachments: props.attachments,
    cwd: props.cwd,
    attachmentMenuItems: props.attachmentMenuItems,
    onAttachButtonRef: props.onAttachButtonRef,
    onAddImages: props.onAddImages,
    client: props.client,
    isReadyForDictation: props.isReadyForDictation,
    placeholder: props.placeholder,
    autoFocus: props.autoFocus ?? false,
    autoFocusKey: props.autoFocusKey,
    disabled: props.disabled ?? false,
    isPaneFocused: props.isPaneFocused ?? true,
    leftContent: props.leftContent,
    beforeVoiceContent: props.beforeVoiceContent,
    rightContent: props.rightContent,
    voiceServerId: props.voiceServerId,
    voiceAgentId: props.voiceAgentId,
    isAgentRunning: props.isAgentRunning ?? false,
    defaultSendBehavior: props.defaultSendBehavior ?? "interrupt",
    onQueue: props.onQueue,
    onSubmitLoadingPress: props.onSubmitLoadingPress,
    onKeyPressCallback: props.onKeyPress,
    onSelectionChangeCallback: props.onSelectionChange,
    onFocusChange: props.onFocusChange,
    onHeightChange: props.onHeightChange,
    inputWrapperStyle: props.inputWrapperStyle,
    attachmentSlot: props.attachmentSlot,
  };
}

function extractErrorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return null;
}

export const MessageInput = forwardRef<MessageInputRef, MessageInputProps>(
  function MessageInput(props, ref) {
    const {
      value,
      onChangeText,
      onSubmit,
      hasExternalContent,
      allowEmptySubmit,
      submitButtonAccessibilityLabel,
      submitIcon,
      isSubmitDisabled,
      isSubmitLoading,
      attachments,
      cwd,
      attachmentMenuItems,
      onAttachButtonRef,
      onAddImages,
      client,
      isReadyForDictation,
      placeholder,
      autoFocus,
      autoFocusKey,
      disabled,
      isPaneFocused,
      leftContent,
      beforeVoiceContent,
      rightContent,
      voiceServerId,
      voiceAgentId,
      isAgentRunning,
      defaultSendBehavior,
      onQueue,
      onSubmitLoadingPress,
      onKeyPressCallback,
      onSelectionChangeCallback,
      onFocusChange,
      onHeightChange,
      inputWrapperStyle,
      attachmentSlot,
    } = resolveMessageInputProps(props);
    const { t } = useTranslation();
    const isCompact = useIsCompactFormFactor();
    const { height: windowHeight } = useWindowDimensions();
    const maxInputHeight = resolveMaxInputHeight(windowHeight);
    const buttonIconSize = isWeb ? ICON_SIZE.md : ICON_SIZE.lg;
    const toast = useToast();
    const voice = useVoiceOptional();
    const sendKeys = useShortcutKeys("message-input-send");
    const voiceMuteToggleKeys = useShortcutKeys("voice-mute-toggle");
    const dictationToggleKeys = useShortcutKeys("dictation-toggle");
    const focusInputKeys = useShortcutKeys("focus-message-input");
    const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
    const [isInputFocused, setIsInputFocused] = useState(false);

    const rootRef = useRef<View | null>(null);
    const inputWrapperRef = useRef<View | null>(null);
    const textInputRef = useRef<TextInput | (TextInput & { getNativeRef?: () => unknown }) | null>(
      null,
    );
    const isInputFocusedRef = useRef(false);

    useImperativeHandle(ref, () => ({
      focus: () => {
        textInputRef.current?.focus();
      },
      blur: () => {
        textInputRef.current?.blur?.();
      },
      runKeyboardAction: (action) =>
        runKeyboardActionImpl(action, {
          textInputRef,
          isDictatingRef,
          sendAfterTranscriptRef,
          confirmDictation,
          cancelDictation,
          startDictationIfAvailable,
          handleToggleRealtimeVoiceShortcut,
          isVoiceUiVisible: COMPOSER_VOICE_UI_VISIBLE,
          isRealtimeVoiceForCurrentAgent,
          voice,
        }),
      getNativeElement: () => (isWeb ? getTextInputNativeElement(textInputRef.current) : null),
    }));
    const inputHeightRef = useRef(MIN_INPUT_HEIGHT);
    const overlayTransition = useSharedValue(0);
    const sendAfterTranscriptRef = useRef(false);
    const valueRef = useRef(value);
    const serverInfo = useSessionStore(
      useCallback(
        (state) => {
          if (!voiceServerId) {
            return null;
          }
          return state.sessions[voiceServerId]?.serverInfo ?? null;
        },
        [voiceServerId],
      ),
    );

    useEffect(() => {
      valueRef.current = value;
    }, [value]);

    // Emit blur only on true unmount, not when onFocusChange identity changes
    // mid-focus (which would deliver a spurious blur to the parent).
    const onFocusChangeRef = useRef(onFocusChange);
    onFocusChangeRef.current = onFocusChange;
    useEffect(() => {
      return () => {
        onFocusChangeRef.current?.(false);
      };
    }, []);

    useAutoFocusOnWebEffect(textInputRef, autoFocus, autoFocusKey);

    const handleDictationTranscript = useCallback(
      (text: string, _meta: { requestId: string }) => {
        const autoSend = sendAfterTranscriptRef.current;
        sendAfterTranscriptRef.current = false;
        applyDictationTranscript(text, {
          value: valueRef.current,
          defaultSendBehavior,
          isAgentRunning,
          onQueue,
          onSubmit,
          onChangeText,
          attachments,
          cwd,
          autoSend,
        });
      },
      [onChangeText, onSubmit, onQueue, attachments, cwd, isAgentRunning, defaultSendBehavior],
    );

    const handleDictationError = useCallback(
      (error: Error) => {
        console.error("[MessageInput] Dictation error:", error);
        toast.error(error.message);
      },
      [toast],
    );

    const dictationUnavailableMessage = resolveVoiceUnavailableMessage({
      serverInfo,
      mode: "dictation",
    });

    const canStartDictation = useCallback(
      () =>
        computeCanStartDictation({
          client,
          isReadyForDictation,
          disabled,
          dictationUnavailableMessage,
        }),
      [client, disabled, dictationUnavailableMessage, isReadyForDictation],
    );

    const canConfirmDictation = useCallback(() => client?.isConnected ?? false, [client]);
    const isConnected = client?.isConnected ?? false;
    const isDictationStartEnabled = computeIsDictationStartEnabled(
      isReadyForDictation,
      isConnected,
      disabled,
    );

    const {
      isRecording: isDictating,
      isProcessing: isDictationProcessing,
      partialTranscript: _dictationPartialTranscript,
      volume: dictationVolume,
      duration: dictationDuration,
      error: dictationError,
      status: dictationStatus,
      startDictation,
      cancelDictation,
      confirmDictation,
      retryFailedDictation,
      discardFailedDictation,
    } = useDictation({
      client,
      onTranscript: handleDictationTranscript,
      onError: handleDictationError,
      canStart: canStartDictation,
      canConfirm: canConfirmDictation,
      enableDuration: true,
    });

    const isDictatingRef = useRef(isDictating);
    useEffect(() => {
      isDictatingRef.current = isDictating;
    }, [isDictating]);

    const isRealtimeVoiceForCurrentAgent = computeIsRealtimeVoiceForAgent(
      voice,
      voiceServerId,
      voiceAgentId,
    );
    const showDictationOverlay = computeVisibleDictationOverlay(
      isDictating,
      isDictationProcessing,
      dictationStatus,
    );
    const showRealtimeOverlay = computeVisibleRealtimeOverlay(isRealtimeVoiceForCurrentAgent);
    const showOverlay = showDictationOverlay || showRealtimeOverlay;

    useEffect(() => {
      if (isDictating || isDictationProcessing) {
        return;
      }
      sendAfterTranscriptRef.current = false;
    }, [dictationStatus, isDictating, isDictationProcessing]);

    const startDictationIfAvailable = useCallback(
      () =>
        startDictationIfAvailableImpl({
          dictationUnavailableMessage,
          canStartDictation,
          isDictatingRef,
          toast,
          startDictation,
        }),
      [canStartDictation, dictationUnavailableMessage, startDictation, toast],
    );

    // Animate overlay
    useEffect(() => {
      overlayTransition.value = withTiming(showOverlay ? 1 : 0, {
        duration: 200,
      });
    }, [overlayTransition, showOverlay]);

    // Drive pointerEvents via a React state toggle at the 0.5 threshold so the
    // prop works on native (pointerEvents is a view prop, not a style property,
    // and cannot be driven by useAnimatedStyle on native).
    const [overlayPointerEvents, setOverlayPointerEvents] = useState<"auto" | "none">(
      showOverlay ? "auto" : "none",
    );
    useAnimatedReaction(
      () => overlayTransition.value > 0.5,
      (isInteractive, previous) => {
        if (isInteractive !== previous) {
          runOnJS(setOverlayPointerEvents)(isInteractive ? "auto" : "none");
        }
      },
    );

    const overlayAnimatedStyle = useAnimatedStyle(() => ({
      opacity: overlayTransition.value,
    }));

    const inputAnimatedStyle = useAnimatedStyle(() => ({
      opacity: 1 - overlayTransition.value,
    }));

    const handleVoicePress = useCallback(
      () =>
        handleVoicePressImpl({
          isRealtimeVoiceForCurrentAgent,
          voice,
          isDictating,
          cancelDictation,
          startDictationIfAvailable,
        }),
      [
        cancelDictation,
        isDictating,
        isRealtimeVoiceForCurrentAgent,
        startDictationIfAvailable,
        voice,
      ],
    );

    const handleCancelRecording = useCallback(async () => {
      await cancelDictation();
    }, [cancelDictation]);

    const handleAcceptRecording = useCallback(async () => {
      sendAfterTranscriptRef.current = false;
      await confirmDictation();
    }, [confirmDictation]);

    const handleAcceptAndSendRecording = useCallback(async () => {
      sendAfterTranscriptRef.current = true;
      await confirmDictation();
    }, [confirmDictation]);

    const handleRetryFailedRecording = useCallback(() => {
      void retryFailedDictation();
    }, [retryFailedDictation]);

    const handleDiscardFailedRecording = useCallback(() => {
      discardFailedDictation();
    }, [discardFailedDictation]);

    const handleStopRealtimeVoice = useCallback(
      () =>
        stopRealtimeVoiceImpl({
          voice,
          isRealtimeVoiceForCurrentAgent,
          isAgentRunning,
          client,
          voiceAgentId,
        }),
      [client, isAgentRunning, isRealtimeVoiceForCurrentAgent, voice, voiceAgentId],
    );

    const handleToggleRealtimeVoiceShortcut = useCallback(() => {
      toggleRealtimeVoiceImpl({
        voice,
        voiceServerId,
        voiceAgentId,
        isConnected,
        disabled,
        isAgentRunning,
        handleStopRealtimeVoice,
        toast,
        interruptBeforeVoiceModeMessage: t("composer.interruptBeforeVoiceMode"),
      });
    }, [
      disabled,
      handleStopRealtimeVoice,
      isAgentRunning,
      isConnected,
      toast,
      t,
      voice,
      voiceAgentId,
      voiceServerId,
    ]);

    const minimizeInputHeight = useCallback(() => {
      inputHeightRef.current = MIN_INPUT_HEIGHT;
      setInputHeight(MIN_INPUT_HEIGHT);
      onHeightChange?.(MIN_INPUT_HEIGHT);
    }, [onHeightChange]);

    const handleSendMessage = useCallback(
      () =>
        sendMessageImpl({
          value: valueRef.current,
          attachments,
          hasExternalContent,
          allowEmptySubmit,
          cwd,
          isAgentRunning,
          onSubmit,
          onMinimizeHeight: minimizeInputHeight,
        }),
      [
        allowEmptySubmit,
        attachments,
        cwd,
        onSubmit,
        isAgentRunning,
        hasExternalContent,
        minimizeInputHeight,
      ],
    );

    const handleQueueMessage = useCallback(
      () =>
        queueMessageImpl({
          value: valueRef.current,
          attachments,
          cwd,
          onQueue,
          onChangeText,
          onMinimizeHeight: minimizeInputHeight,
        }),
      [attachments, cwd, onQueue, onChangeText, minimizeInputHeight],
    );

    const handleDefaultSendAction = useCallback(() => {
      runDefaultSendAction({
        defaultSendBehavior,
        isAgentRunning,
        onQueue,
        handleSendMessage,
        handleQueueMessage,
      });
    }, [defaultSendBehavior, isAgentRunning, onQueue, handleQueueMessage, handleSendMessage]);

    const handleAlternateSendAction = useCallback(() => {
      runAlternateSendAction({
        defaultSendBehavior,
        isAgentRunning,
        onQueue,
        handleSendMessage,
        handleQueueMessage,
      });
    }, [defaultSendBehavior, isAgentRunning, handleSendMessage, handleQueueMessage, onQueue]);

    const getWebTextArea = useCallback(
      (): TextAreaHandle | null => getWebTextAreaImpl(textInputRef.current),
      [],
    );

    const webTextareaRef = useRef<HTMLElement | null>(null);

    useLayoutEffect(() => {
      if (isWeb) {
        webTextareaRef.current = getWebTextArea() as HTMLElement | null;
      }
    }, [getWebTextArea]);

    const inputScrollbar = useWebElementScrollbar(webTextareaRef, {
      enabled: isWeb,
    });

    usePasteImagesEffect({
      getWebTextArea,
      isConnected,
      disabled,
      isDictating,
      isRealtimeVoiceForCurrentAgent,
      onAddImages,
    });

    const setBoundedInputHeight = useCallback(
      (nextHeight: number) => {
        const bounded = Math.max(MIN_INPUT_HEIGHT, Math.min(maxInputHeight, nextHeight));
        if (Math.abs(inputHeightRef.current - bounded) < 1) return;
        inputHeightRef.current = bounded;
        setInputHeight(bounded);
        onHeightChange?.(bounded);
      },
      [maxInputHeight, onHeightChange],
    );

    useEffect(() => {
      setBoundedInputHeight(inputHeightRef.current);
    }, [setBoundedInputHeight]);

    useComposerHeightMirror({
      value,
      textareaRef: webTextareaRef,
      minHeight: MIN_INPUT_HEIGHT,
      maxHeight: maxInputHeight,
      onHeight: setBoundedInputHeight,
    });

    const handleContentSizeChange = useCallback(
      (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
        if (isWeb) return;
        setBoundedInputHeight(event.nativeEvent.contentSize.height);
      },
      [setBoundedInputHeight],
    );

    const handleSelectionChange = useCallback(
      (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
        const start = event.nativeEvent.selection?.start ?? 0;
        const end = event.nativeEvent.selection?.end ?? start;
        onSelectionChangeCallback?.({ start, end });
      },
      [onSelectionChangeCallback],
    );

    const shouldHandleWebKeyPress = isWeb;
    const shouldSubmitOnEnter = computeShouldSubmitOnEnter(isWeb, isCompact, isNative);

    const handleDesktopKeyPress = useCallback(
      (event: WebTextInputKeyPressEvent) => {
        if (!shouldHandleWebKeyPress) return;
        handleDesktopKeyPressImpl(event, {
          onKeyPressCallback,
          submitOnEnter: shouldSubmitOnEnter,
          isAgentRunning,
          onQueue,
          isSubmitDisabled,
          isSubmitLoading,
          disabled,
          handleAlternateSendAction,
          handleDefaultSendAction,
        });
      },
      [
        shouldHandleWebKeyPress,
        shouldSubmitOnEnter,
        onKeyPressCallback,
        isAgentRunning,
        onQueue,
        isSubmitDisabled,
        isSubmitLoading,
        disabled,
        handleAlternateSendAction,
        handleDefaultSendAction,
      ],
    );

    const handleNativeKeyPressEvent = useCallback(
      (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        const ctx: DesktopKeyPressContext = {
          onKeyPressCallback,
          submitOnEnter: shouldSubmitOnEnter,
          isAgentRunning,
          onQueue,
          isSubmitDisabled,
          isSubmitLoading,
          disabled,
          handleAlternateSendAction,
          handleDefaultSendAction,
        };
        handleNativeKeyPress(event, ctx);
      },
      [
        onKeyPressCallback,
        shouldSubmitOnEnter,
        isAgentRunning,
        onQueue,
        isSubmitDisabled,
        isSubmitLoading,
        disabled,
        handleAlternateSendAction,
        handleDefaultSendAction,
      ],
    );

    const keyPressHandler = useMemo(
      () =>
        resolveKeyPressHandler(isWeb, isNative, handleDesktopKeyPress, handleNativeKeyPressEvent),
      [handleDesktopKeyPress, handleNativeKeyPressEvent],
    );

    const { shouldShowSendButton } = computeSendableContent({
      value,
      attachments,
      hasExternalContent,
      allowEmptySubmit,
      isSubmitLoading,
    });
    const { canPressLoadingButton, isSendButtonDisabled, defaultActionQueues } =
      computeSendButtonState({
        disabled,
        isSubmitDisabled,
        isSubmitLoading,
        onSubmitLoadingPress,
        defaultSendBehavior,
        isAgentRunning,
      });
    useIosHardwareKeyboardSubmit({
      isEnabled: isInputFocused && !isSendButtonDisabled,
      onSubmit: handleDefaultSendAction,
    });
    const submitAccessibilityLabel = resolveSubmitAccessibilityLabel({
      submitButtonAccessibilityLabel,
      canPressLoadingButton,
      defaultActionQueues,
      isAgentRunning,
      labels: {
        interruptAgent: t("composer.interruptAgent"),
        queueMessage: t("composer.queueMessage"),
        sendAndInterrupt: t("composer.sendAndInterrupt"),
        sendMessage: t("composer.sendMessage"),
      },
    });

    const voiceButtonAccessibilityLabel = resolveVoiceAccessibilityLabel({
      isRealtimeVoiceForCurrentAgent,
      isMuted: Boolean(voice?.isMuted),
      isDictating,
      labels: {
        unmuteVoiceMode: t("composer.unmuteVoiceMode"),
        muteVoiceMode: t("composer.muteVoiceMode"),
        stopDictation: t("composer.stopDictation"),
        startDictation: t("composer.startDictation"),
      },
    });

    const voiceTooltipText = resolveVoiceTooltipText({
      isRealtimeVoiceForCurrentAgent,
      isMuted: Boolean(voice?.isMuted),
      labels: {
        unmute: t("composer.unmute"),
        mute: t("composer.mute"),
        dictation: t("composer.dictation"),
      },
    });

    const sendTooltipLabel = resolveSendTooltipLabel({
      submitButtonAccessibilityLabel,
      defaultActionQueues,
      labels: {
        queue: t("composer.queue"),
        send: t("composer.send"),
      },
    });

    const handleInputChange = useCallback(
      (nextValue: string) => {
        valueRef.current = nextValue;
        onChangeText(nextValue);
      },
      [onChangeText],
    );

    const handleInputFocus = useCallback(() => {
      isInputFocusedRef.current = true;
      setIsInputFocused(true);
      onFocusChange?.(true);
    }, [onFocusChange]);

    const handleInputBlur = useCallback(() => {
      isInputFocusedRef.current = false;
      setIsInputFocused(false);
      onFocusChange?.(false);
    }, [onFocusChange]);

    const attachButtonStyle = useCallback(
      ({ hovered }: { hovered?: boolean }) => [
        styles.attachButton,
        Boolean(hovered) && styles.iconButtonHovered,
        (!isConnected || disabled) && styles.buttonDisabled,
      ],
      [isConnected, disabled],
    );

    const voiceButtonStyle = useCallback(
      ({ hovered }: { hovered?: boolean }) => [
        styles.voiceButton,
        Boolean(hovered) && !isDictating && styles.iconButtonHovered,
        !isDictationStartEnabled && styles.buttonDisabled,
        isDictating && styles.voiceButtonRecording,
      ],
      [isDictating, isDictationStartEnabled],
    );

    const handleRealtimeVoiceStop = useCallback(() => {
      void handleStopRealtimeVoice();
    }, [handleStopRealtimeVoice]);

    const inputWrapperSurfaceStyle = useMemo(
      () => [styles.inputWrapper, inputWrapperStyle],
      [inputWrapperStyle],
    );
    const textInputStyle = useMemo(
      () => [styles.textInput, computeTextInputHeightStyle(inputHeight, maxInputHeight)],
      [inputHeight, maxInputHeight],
    );
    const sendButtonCombinedStyle = useMemo(
      () => [styles.sendButton, isSendButtonDisabled && styles.buttonDisabled],
      [isSendButtonDisabled],
    );
    const overlayContainerStyle = useMemo(
      () => [staticStyles.overlayContainer, overlayAnimatedStyle],
      [overlayAnimatedStyle],
    );

    const renderAttachButtonIcon = useCallback(
      ({ hovered }: { hovered?: boolean }) => (
        <AttachButtonIcon
          hovered={Boolean(hovered)}
          onAttachButtonRef={onAttachButtonRef}
          buttonIconSize={buttonIconSize}
        />
      ),
      [onAttachButtonRef, buttonIconSize],
    );

    const renderVoiceButtonIcon = useCallback(
      ({ hovered }: { hovered?: boolean }) => (
        <VoiceButtonIcon
          hovered={Boolean(hovered)}
          isDictating={isDictating}
          isMutedRealtime={Boolean(isRealtimeVoiceForCurrentAgent && voice?.isMuted)}
          buttonIconSize={buttonIconSize}
        />
      ),
      [isDictating, isRealtimeVoiceForCurrentAgent, voice?.isMuted, buttonIconSize],
    );
    return (
      <View ref={rootRef} style={styles.container} testID="message-input-root">
        {/* Regular input */}
        <Animated.View style={inputAnimatedStyle}>
          <View ref={inputWrapperRef} style={inputWrapperSurfaceStyle}>
            {attachmentSlot}
            {/* Text input */}
            <View style={styles.textInputScrollWrapper}>
              <ThemedTextInput
                ref={textInputRef}
                value={value}
                onChangeText={handleInputChange}
                placeholder={placeholder ?? t("composer.placeholder")}
                uniProps={textInputPlaceholderColorMapping}
                accessibilityLabel={t("composer.messageAgent")}
                onFocus={handleInputFocus}
                onBlur={handleInputBlur}
                style={textInputStyle}
                multiline
                scrollEnabled={isWeb ? inputHeight >= maxInputHeight : true}
                onContentSizeChange={handleContentSizeChange}
                editable={!isDictating && !isRealtimeVoiceForCurrentAgent && !disabled}
                onKeyPress={keyPressHandler}
                onSelectionChange={handleSelectionChange}
                autoFocus={isWeb && autoFocus}
              />
              {inputScrollbar}
              <FocusHint
                visible={isWeb && isPaneFocused && !isInputFocused && !value}
                focusInputKeys={focusInputKeys}
                label={t("composer.focusHint")}
              />
            </View>

            {/* Button row */}
            <View style={styles.buttonRow}>
              {/* Toolbar left: attachment button + agent controls */}
              <View style={styles.leftButtonGroup}>
                <AttachmentDropdown
                  isConnected={isConnected}
                  disabled={disabled}
                  attachButtonStyle={attachButtonStyle}
                  renderAttachButtonIcon={renderAttachButtonIcon}
                  attachmentMenuItems={attachmentMenuItems}
                  addAttachmentLabel={t("composer.addAttachment")}
                />
                {leftContent}
              </View>

              {/* Right: voice button, contextual button (realtime/send/cancel) */}
              <View style={styles.rightButtonGroup}>
                {beforeVoiceContent}
                {COMPOSER_VOICE_UI_VISIBLE ? (
                  <VoiceButtonTooltip
                    onVoicePress={handleVoicePress}
                    isDictationStartEnabled={isDictationStartEnabled}
                    voiceButtonAccessibilityLabel={voiceButtonAccessibilityLabel}
                    voiceButtonStyle={voiceButtonStyle}
                    renderVoiceButtonIcon={renderVoiceButtonIcon}
                    voiceTooltipText={voiceTooltipText}
                    isRealtimeVoiceForCurrentAgent={isRealtimeVoiceForCurrentAgent}
                    voiceMuteToggleKeys={voiceMuteToggleKeys}
                    dictationToggleKeys={dictationToggleKeys}
                  />
                ) : null}
                {rightContent}
                <SendButtonTooltip
                  shouldShow={shouldShowSendButton}
                  canPressLoadingButton={canPressLoadingButton}
                  onSubmitLoadingPress={onSubmitLoadingPress}
                  onDefaultSendAction={handleDefaultSendAction}
                  isSendButtonDisabled={isSendButtonDisabled}
                  submitAccessibilityLabel={submitAccessibilityLabel}
                  sendButtonCombinedStyle={sendButtonCombinedStyle}
                  isSubmitLoading={isSubmitLoading}
                  submitIcon={submitIcon}
                  buttonIconSize={buttonIconSize}
                  sendKeys={sendKeys}
                  sendTooltipLabel={sendTooltipLabel}
                />
              </View>
            </View>
          </View>
        </Animated.View>

        <Animated.View style={overlayContainerStyle} pointerEvents={overlayPointerEvents}>
          <MessageInputOverlay
            showDictationOverlay={showDictationOverlay}
            showRealtimeOverlay={showRealtimeOverlay}
            voice={voice}
            dictationVolume={dictationVolume}
            dictationDuration={dictationDuration}
            isDictating={isDictating}
            isDictationProcessing={isDictationProcessing}
            dictationStatus={dictationStatus}
            dictationError={dictationError}
            onCancelRecording={handleCancelRecording}
            onAcceptRecording={handleAcceptRecording}
            onAcceptAndSendRecording={handleAcceptAndSendRecording}
            onRetryFailedRecording={handleRetryFailedRecording}
            onDiscardFailedRecording={handleDiscardFailedRecording}
            onRealtimeVoiceStop={handleRealtimeVoiceStop}
          />
        </Animated.View>
      </View>
    );
  },
);

const styles = StyleSheet.create((theme: Theme) => ({
  container: {
    position: "relative",
  },
  // Soft Workbench .composer: r18 card; textarea pad 14/16/6; cbar pad 4/8/10.
  inputWrapper: {
    flexDirection: "column",
    gap: 0,
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: 18,
    minHeight: {
      xs: 108,
      md: 108,
    },
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    ...resolveSoftComposerCardElevation(),
    ...(isWeb
      ? {
          transitionProperty: "border-color, box-shadow",
          transitionDuration: "200ms",
          transitionTimingFunction: "ease-in-out",
        }
      : {}),
  },
  textInputScrollWrapper: {
    position: "relative",
    // Soft .composer textarea: padding 14px 16px 6px
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  focusHintText: {
    position: "absolute",
    top: 14,
    right: 16,
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundMuted,
    opacity: 0.5,
  },
  textInput: {
    width: "100%",
    color: theme.colors.foreground,
    // Soft .composer textarea: 14.5px / ~1.5
    fontSize: 14.5,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 22,
    ...(isWeb
      ? ({
          outlineStyle: "none",
          outlineWidth: 0,
          outlineColor: "transparent",
        } as object)
      : {}),
  },
  // Soft .cbar: padding 4px 8px 10px, gap 4, right cluster ml auto
  buttonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 4,
    paddingHorizontal: 8,
    paddingBottom: 10,
    gap: 4,
  },
  leftButtonGroup: {
    minWidth: 0,
    flexShrink: 1,
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  rightButtonGroup: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
  },
  // Soft .t-icon: 32 r10 pen-bar chip.
  attachButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  attachButtonAnchor: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  voiceButtonRecording: {
    backgroundColor: theme.colors.destructive,
  },
  // Soft .send — design --send #1a1d26 (primary), not accent blue.
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: theme.spacing[1],
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
  iconForeground: {
    color: theme.colors.foreground,
  },
  iconForegroundMuted: {
    color: theme.colors.foregroundMuted,
  },
  iconAccentForeground: {
    color: theme.colors.accentForeground,
  },
  iconPrimaryForeground: {
    color: theme.colors.primaryForeground,
  },
})) as unknown as Record<string, object>;

const staticStyles = RNStyleSheet.create({
  overlayContainer: {
    position: "absolute",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    right: 0,
    bottom: 0,
  },
});

const ThemedPlus = withUnistyles(Plus);
const ThemedMic = withUnistyles(Mic);
const ThemedMicOff = withUnistyles(MicOff);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedCornerDownLeft = withUnistyles(CornerDownLeft);
const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedTextInput = withUnistyles(TextInput);

const textInputPlaceholderColorMapping = (theme: Theme) => ({
  // Soft .composer-float textarea::placeholder → --faint
  placeholderTextColor: theme.colors.foregroundFaint,
});
