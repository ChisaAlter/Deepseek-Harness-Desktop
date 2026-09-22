import { StyleSheet as RNStyleSheet, View, Text } from "react-native";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
  type ReactElement,
  type ReactNode,
} from "react";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useShallow } from "zustand/shallow";
import Animated from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { FOOTER_HEIGHT } from "@/constants/layout";
import {
  AgentControls,
  DraftAgentControls,
  type DraftAgentControlsProps,
} from "@/composer/agent-controls";
import { useImageAttachmentPicker } from "@/hooks/use-image-attachment-picker";
import { useSessionStore } from "@/stores/session-store";
import { MessageInput, type MessageInputRef } from "./input/input";
import type { ImageAttachment, MessagePayload } from "./types";
import type { Theme } from "@/styles/theme";
import type { DraftCommandConfig } from "@/hooks/use-agent-commands-query";
import { focusWithRetries } from "@/utils/web-focus";
import {
  cancelComposerAgent,
  openComposerAttachment,
  pickAndPersistImages,
  removeComposerAttachmentAtIndex,
} from "@/composer/actions";
import { useVoiceOptional } from "@/contexts/voice-context";
import { useToast } from "@/contexts/toast-context";
import { AutocompletePopover } from "@/components/ui/autocomplete-popover";
import { ErrorBoundary, SectionErrorFallback } from "@/components/error-boundary";
import { useAgentAutocomplete } from "@/hooks/use-agent-autocomplete";
import {
  useHostRuntimeAgentDirectoryStatus,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";
import {
  deleteAttachments,
  persistAttachmentFromBlob,
  persistAttachmentFromFileUri,
} from "@/attachments/service";
import { resolveAgentControlsMode } from "@/composer/agent-controls/mode";
import { useKeyboardShiftStyle } from "@/hooks/use-keyboard-shift-style";
import { useAppSettings } from "@/hooks/use-settings";
import { isWeb, isNative } from "@/constants/platform";
import type {
  AttachmentMetadata,
  ComposerAttachment,
  UserComposerAttachment,
  WorkspaceComposerAttachment,
} from "@/attachments/types";
import { composerWorkspaceAttachment } from "@/composer/attachments/workspace";
import { AttachmentLightbox } from "@/components/attachment-lightbox";
import { openExternalUrl } from "@/utils/open-external-url";
import { useIsDictationReady } from "@/hooks/use-is-dictation-ready";
import type { ClientSlashCommand } from "@/client-slash-commands";
import { renderAttachmentTray, renderQueueTrack } from "@/composer/attachment-queue-renderers";
import { useComposerAttachmentMenu } from "./attachment-menu";
import { useComposerDeliveryController } from "./delivery-controller";
import { useComposerSendProjectionAck } from "./use-composer-send-projection-ack";
import { useComposerGithubPicker } from "./github/picker";
import { useComposerKeyboardController } from "./keyboard-controller";
import { useComposerQueueController } from "./queue-controller";
import { useComposerRuntimeControls } from "./runtime-controls";
import { useComposerSubmissionController } from "./submission-controller";
import { buildAgentStateSelector } from "@/composer/agent-state-selector";

type AttachmentListUpdater =
  | UserComposerAttachment[]
  | ((prev: UserComposerAttachment[]) => UserComposerAttachment[]);

function resolveIsComposerLocked(
  submitBehavior: "clear" | "preserve-and-lock",
  isSubmitLoading: boolean,
): boolean {
  return submitBehavior === "preserve-and-lock" && isSubmitLoading;
}

function resolveIsDesktopWebBreakpoint(isMobile: boolean): boolean {
  return isWeb && !isMobile;
}
function resolveMessagePlaceholder(input: {
  isDesktopWebBreakpoint: boolean;
  desktop: string;
  mobile: string;
}): string {
  return input.isDesktopWebBreakpoint ? input.desktop : input.mobile;
}

interface RenderAgentControlSlotArgs {
  agentControls: DraftAgentControlsProps | undefined;
  agentId: string;
  serverId: string;
  focusInput: () => void;
  /** Soft desktop cbar partition: mode left, model right. Compact uses `all` on the left. */
  slot: "all" | "mode" | "model";
}

function renderAgentControlSlot(args: RenderAgentControlSlotArgs): ReactElement {
  const { agentControls, agentId, serverId, focusInput, slot } = args;
  if (resolveAgentControlsMode(agentControls) === "draft" && agentControls) {
    return <DraftAgentControls {...agentControls} slot={slot} />;
  }
  return (
    <AgentControls agentId={agentId} serverId={serverId} onDropdownClose={focusInput} slot={slot} />
  );
}

function renderComposerFooter(footer: ReactNode, footerRight: ReactNode): ReactElement | null {
  if (!footer && !footerRight) return null;
  return (
    <View style={styles.footer}>
      <View style={styles.footerContent}>
        <View style={styles.footerLeft}>{footer}</View>
        <View style={styles.footerRight}>{footerRight}</View>
      </View>
    </View>
  );
}

interface ComposerProps {
  agentId: string;
  serverId: string;
  isPaneFocused: boolean;
  onSubmitMessage?: (payload: MessagePayload) => Promise<void>;
  onClientSlashCommand?: (command: ClientSlashCommand) => Promise<void>;
  /** When true, the submit button is enabled even without text or images (e.g. external attachment selected). */
  hasExternalContent?: boolean;
  /** When true, the composer can submit even with no text or attachments. */
  allowEmptySubmit?: boolean;
  /** Optional accessibility label for the primary submit button. */
  submitButtonAccessibilityLabel?: string;
  submitIcon?: "arrow" | "return";
  /** Externally controlled loading state. When true, disables the submit button. */
  isSubmitLoading?: boolean;
  submitBehavior?: "clear" | "preserve-and-lock";
  /** When true, blurs the input immediately when submitting. */
  blurOnSubmit?: boolean;
  value: string;
  onChangeText: (text: string) => void;
  attachments: UserComposerAttachment[];
  workspaceAttachments?: readonly WorkspaceComposerAttachment[];
  onOpenWorkspaceAttachment?: (attachment: WorkspaceComposerAttachment) => void;
  onChangeAttachments: (updater: AttachmentListUpdater) => void;
  cwd: string;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  /** When true, auto-focuses the text input on web. */
  autoFocus?: boolean;
  /** Callback to expose the addImages function to parent components */
  onAddImages?: (addImages: (images: ImageAttachment[]) => void) => void;
  /** Callback to expose a focus function to parent components (desktop only). */
  onFocusInput?: (focus: () => void) => void;
  /** Optional draft context for listing commands before an agent exists. */
  commandDraftConfig?: DraftCommandConfig;
  /** Called when a message is about to be sent (any path: keyboard, dictation, queued). */
  onMessageSent?: () => void;
  /**
   * Called right after a send dispatch with the optimistic user message id
   * (any send path). The id is stable across server adoption, so consumers
   * can anchor UI on it without racing the daemon's projection.
   */
  onOptimisticMessageDispatched?: (messageId: string) => void;
  onComposerHeightChange?: (height: number) => void;
  onAttentionInputFocus?: () => void;
  onAttentionPromptSend?: () => void;
  /** Controlled agent controls rendered in input area (draft flows). */
  agentControls?: DraftAgentControlsProps;
  /** Extra styles merged onto the message input wrapper (e.g. elevated background). */
  inputWrapperStyle?: import("react-native").ViewStyle;
  /**
   * Extra styles merged onto the outer input-area chrome (dock padding).
   * Soft Home uses this to zero horizontal padding so path/import match the pen-bar width.
   */
  inputAreaStyle?: import("react-native").ViewStyle;
  /** Override the default composer placeholder (e.g. Soft Home draft empty). */
  placeholder?: string;
  /** Rendered below the input, inside the keyboard-shifted container. */
  footer?: ReactNode;
  /** When true, a parent wrapper owns the keyboard shift, so the composer skips its own. */
  externalKeyboardShift?: boolean;
}

const StableMessageInput = memo(MessageInput);

export function Composer({
  agentId,
  serverId,
  isPaneFocused,
  onSubmitMessage,
  onClientSlashCommand,
  hasExternalContent = false,
  allowEmptySubmit = false,
  submitButtonAccessibilityLabel,
  submitIcon = "arrow",
  isSubmitLoading = false,
  submitBehavior = "clear",
  blurOnSubmit = false,
  value,
  onChangeText,
  attachments,
  workspaceAttachments = [],
  onOpenWorkspaceAttachment,
  onChangeAttachments,
  cwd,
  clearDraft,
  autoFocus = false,
  onAddImages,
  onFocusInput,
  commandDraftConfig,
  onMessageSent,
  onOptimisticMessageDispatched,
  onComposerHeightChange,
  onAttentionInputFocus,
  onAttentionPromptSend,
  agentControls,
  inputWrapperStyle,
  inputAreaStyle,
  placeholder,
  footer,
  externalKeyboardShift,
}: ComposerProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const agentDirectoryStatus = useHostRuntimeAgentDirectoryStatus(serverId);
  const toast = useToast();
  const toastErrorRef = useRef(toast.error);
  toastErrorRef.current = toast.error;
  const voice = useVoiceOptional();
  const isDictationReady = useIsDictationReady({
    serverId,
    isConnected,
    agentDirectoryStatus,
  });

  const { settings: appSettings } = useAppSettings();

  const agentState = useSessionStore(useShallow(buildAgentStateSelector(serverId, agentId)));

  const isMobile = useIsCompactFormFactor();
  const isDesktopWebBreakpoint = resolveIsDesktopWebBreakpoint(isMobile);
  const messagePlaceholder =
    placeholder ??
    resolveMessagePlaceholder({
      isDesktopWebBreakpoint,
      desktop: t("composer.desktopPlaceholder"),
      mobile: t("composer.mobilePlaceholder"),
    });
  const userInput = value;
  const setUserInput = onChangeText;
  const {
    selectedAttachments,
    buildOutgoingAttachments,
    removeAttachment,
    openAttachment,
    clearSentAttachments,
    completeSubmit,
    resetSuppression,
  } = composerWorkspaceAttachment.useBinding({
    normalAttachments: attachments,
    workspaceAttachments,
    onOpenWorkspaceAttachment,
  });
  const setSelectedAttachments = onChangeAttachments;
  const [cursorIndex, setCursorIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCancellingAgent, setIsCancellingAgent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lightboxMetadata, setLightboxMetadata] = useState<AttachmentMetadata | null>(null);
  const attachButtonRef = useRef<View | null>(null);
  const messageInputRef = useRef<MessageInputRef>(null);
  const isComposerLocked = resolveIsComposerLocked(submitBehavior, isSubmitLoading);
  const { githubPicker, markGithubAttachmentRemoved, openGithubPicker } = useComposerGithubPicker({
    client,
    serverId,
    cwd,
    text: userInput,
    attachments,
    selectedAttachments,
    setAttachments: setSelectedAttachments,
    isConnected,
    anchorRef: attachButtonRef,
  });

  // Send-busy is projection-driven: stay busy until the daemon adopts the
  // optimistic user message (or errors/times out), not until the RPC settles.
  // isProcessing is only used for submit dedupe while the dispatch is in flight.
  const { isServerAdopted, trackPendingSend, pendingSendMessageId } = useComposerSendProjectionAck({
    serverId,
    agentId,
  });
  const hasPendingSend = pendingSendMessageId !== null;

  // Track the optimistic message id via the dispatch callback (sync after
  // stream append) so busy-ack / turn-anchor do not re-scan the store.
  const { runClientSlashCommand, submitMessage, canSubmitMessage, setOnOptimisticDispatched } =
    useComposerDeliveryController({
      serverId,
      agentId,
      cwd,
      client,
      messageInputRef,
      blurOnSubmit,
      onSubmitMessage,
      onClientSlashCommand,
      onMessageSent,
      onAttentionPromptSend,
      clearDraft,
      setUserInput,
      setSelectedAttachments,
      resetSuppression,
      setSendError,
      setIsProcessing,
    });
  useEffect(() => {
    setOnOptimisticDispatched((messageId) => {
      trackPendingSend(messageId);
      onOptimisticMessageDispatched?.(messageId);
    });
    return () => setOnOptimisticDispatched(null);
  }, [onOptimisticMessageDispatched, setOnOptimisticDispatched, trackPendingSend]);
  const autocomplete = useAgentAutocomplete({
    userInput,
    cursorIndex,
    setUserInput,
    serverId,
    agentId,
    draftConfig: commandDraftConfig,
    canExecuteClientSlashCommand: buildOutgoingAttachments(attachments).length === 0,
    onClientSlashCommand: runClientSlashCommand,
    onAutocompleteApplied: () => {
      messageInputRef.current?.focus();
    },
  });
  const autocompleteOnKeyPressRef = useRef(autocomplete.onKeyPress);
  autocompleteOnKeyPressRef.current = autocomplete.onKeyPress;

  // Clear send error when user edits the input
  useEffect(() => {
    if (sendError && userInput) {
      setSendError(null);
    }
  }, [userInput, sendError]);

  // A send failure ends the in-flight window: release the projection busy so
  // the composer is not stuck waiting for a message the daemon never adopted.
  useEffect(() => {
    if (sendError) {
      trackPendingSend(null);
    }
  }, [sendError, trackPendingSend]);

  // Fallback timeout replaces the old 15s RPC hold: if the send is never
  // adopted and never errors, release busy and surface a retryable error.
  useEffect(() => {
    if (!hasPendingSend || isServerAdopted) {
      return;
    }
    const timeout = setTimeout(() => {
      trackPendingSend(null);
      setSendError(t("composer.sendTimeout"));
    }, 30_000);
    return () => clearTimeout(timeout);
  }, [hasPendingSend, isServerAdopted, t, trackPendingSend]);

  useEffect(() => {
    setCursorIndex((current) => Math.min(current, userInput.length));
  }, [userInput.length]);

  const { pickImages } = useImageAttachmentPicker();

  // Expose addImages function to parent for drag-and-drop support
  const addImages = useCallback(
    (images: ImageAttachment[]) => {
      setSelectedAttachments((prev) => [
        ...prev,
        ...images.map((metadata) => ({ kind: "image" as const, metadata })),
      ]);
    },
    [setSelectedAttachments],
  );

  useEffect(() => {
    onAddImages?.(addImages);
  }, [addImages, onAddImages]);

  const focusInput = useCallback(() => {
    if (isNative) return;
    focusWithRetries({
      focus: () => messageInputRef.current?.focus(),
      isFocused: () => {
        const el = messageInputRef.current?.getNativeElement?.() ?? null;
        return el != null && document.activeElement === el;
      },
    });
  }, []);

  useEffect(() => {
    onFocusInput?.(focusInput);
  }, [focusInput, onFocusInput]);

  const isAgentRunning = agentState.status === "running";
  const hasAgent = agentState.status !== null;

  const {
    queuedMessages,
    queueMessage,
    handleEditQueuedMessage,
    handleSendQueuedNow,
    handleQueue,
  } = useComposerQueueController({
    serverId,
    agentId,
    attachments,
    buildOutgoingAttachments,
    setUserInput,
    setSelectedAttachments,
    resetSuppression,
    clearSentAttachments,
    runClientSlashCommand,
    canSubmitQueuedMessage: canSubmitMessage,
    submitMessage,
    setSendError,
  });
  const { handleSubmit } = useComposerSubmissionController({
    attachments,
    buildOutgoingAttachments,
    runClientSlashCommand,
    blurOnSubmit,
    messageInputRef,
    hasExternalContent,
    allowEmptySubmit,
    submitBehavior,
    isAgentRunning,
    canSubmitMessage,
    queueMessage,
    submitMessage,
    clearDraft,
    setUserInput,
    setSelectedAttachments,
    completeSubmit,
    setSendError,
    setIsProcessing,
  });
  const handlePickImage = useCallback(async () => {
    const newImages = await pickAndPersistImages({
      pickImages,
      persister: {
        persistFromBlob: ({ blob, mimeType, fileName }) =>
          persistAttachmentFromBlob({ blob, mimeType, fileName }),
        persistFromFileUri: ({ uri, mimeType, fileName }) =>
          persistAttachmentFromFileUri({ uri, mimeType, fileName }),
      },
    });
    if (newImages.length === 0) return;
    addImages(newImages);
  }, [addImages, pickImages]);

  const attachmentMenuItems = useComposerAttachmentMenu({
    agentControls,
    agentFeatures: agentState.features,
    agentProvider: agentState.provider,
    agentId,
    client,
    focusInput,
    setUserInput,
    toastErrorRef,
    isComposerLocked,
    onPickImage: handlePickImage,
    openGithubPicker,
  });

  const handleRemoveAttachment = useCallback(
    (index: number) => {
      markGithubAttachmentRemoved(selectedAttachments[index]);
      const didRemoveWorkspaceAttachment = removeAttachment({
        selectedAttachments,
        index,
      });
      if (didRemoveWorkspaceAttachment) {
        return;
      }
      setSelectedAttachments((prev) =>
        removeComposerAttachmentAtIndex({ attachments: prev, index, deleteAttachments }),
      );
    },
    [markGithubAttachmentRemoved, removeAttachment, selectedAttachments, setSelectedAttachments],
  );

  const handleOpenAttachment = useCallback(
    (attachment: ComposerAttachment) => {
      openComposerAttachment({
        attachment,
        setLightboxMetadata,
        openWorkspaceAttachment: openAttachment,
        openExternalUrl: (url) => {
          void openExternalUrl(url);
        },
      });
    },
    [openAttachment],
  );

  useEffect(() => {
    if (!isAgentRunning || !isConnected) {
      setIsCancellingAgent(false);
    }
  }, [isAgentRunning, isConnected]);

  const handleCancelAgent = useCallback(() => {
    const didCancel = cancelComposerAgent({
      client,
      agentId,
      isAgentRunning,
      isCancellingAgent,
      isConnected,
      onCancelFailed: () => {
        // Cancel RPC failed: reset the busy spinner and surface the failure,
        // otherwise the interrupt button spins forever while the agent keeps
        // running (previously this was a silent unhandled rejection).
        setIsCancellingAgent(false);
        toastErrorRef.current(t("composer.cancelFailed"));
      },
    });
    if (!didCancel) return;
    setIsCancellingAgent(true);
    messageInputRef.current?.focus();
  }, [agentId, client, isAgentRunning, isCancellingAgent, isConnected, t]);

  const { handleFocusChange } = useComposerKeyboardController({
    serverId,
    agentId,
    client,
    isPaneFocused,
    messageInputRef,
    isAgentRunning,
    isCancellingAgent,
    isConnected,
    handleCancelAgent,
    onAttentionInputFocus,
  });
  const { style: keyboardAnimatedStyle } = useKeyboardShiftStyle({
    mode: "translate",
    enabled: !externalKeyboardShift,
  });

  const hasSendableContent = userInput.trim().length > 0 || selectedAttachments.length > 0;

  // Handle keyboard navigation for command autocomplete.
  const handleCommandKeyPress = useCallback(
    (event: { key: string; preventDefault: () => void }) =>
      autocompleteOnKeyPressRef.current(event),
    [],
  );

  const {
    beforeVoiceContent: runtimeBeforeVoiceContent,
    footerRight,
    rightContent,
  } = useComposerRuntimeControls({
    voice,
    serverId,
    agentId,
    isConnected,
    hasAgent,
    isAgentRunning,
    hasSendableContent,
    isProcessing,
    isCompact: isMobile,
    isCancellingAgent,
    handleCancelAgent,
    toastErrorRef,
    contextWindowMaxTokens: agentState.contextWindowMaxTokens,
    contextWindowUsedTokens: agentState.contextWindowUsedTokens,
    totalCostUsd: agentState.totalCostUsd,
  });
  // Soft .cbar: desktop left = mode, right = model (+ voice/send). Compact keeps one cluster left.
  const leftContent = useMemo(
    () =>
      renderAgentControlSlot({
        agentControls,
        agentId,
        serverId,
        focusInput,
        slot: isMobile ? "all" : "mode",
      }),
    [agentControls, agentId, focusInput, isMobile, serverId],
  );
  const modelControlSlot = useMemo(() => {
    if (isMobile) return null;
    return renderAgentControlSlot({
      agentControls,
      agentId,
      serverId,
      focusInput,
      slot: "model",
    });
  }, [agentControls, agentId, focusInput, isMobile, serverId]);
  const beforeVoiceContent = useMemo(() => {
    if (!modelControlSlot && !runtimeBeforeVoiceContent) return null;
    if (!modelControlSlot) return runtimeBeforeVoiceContent;
    if (!runtimeBeforeVoiceContent) return modelControlSlot;
    return (
      <View style={styles.cbarRightCluster}>
        {modelControlSlot}
        {runtimeBeforeVoiceContent}
      </View>
    );
  }, [modelControlSlot, runtimeBeforeVoiceContent]);

  const handleAttachButtonRef = useCallback((node: View | null) => {
    attachButtonRef.current = node;
  }, []);

  const handleSelectionChange = useCallback((selection: { start: number; end: number }) => {
    setCursorIndex(selection.start);
  }, []);

  const handleLightboxClose = useCallback(() => {
    setLightboxMetadata(null);
  }, []);

  const composerContainerStyle = useMemo(
    () => [staticStyles.container, keyboardAnimatedStyle],
    [keyboardAnimatedStyle],
  );
  const inputAreaContainerStyle = useMemo(
    () => [styles.inputAreaContainer, isComposerLocked && styles.inputAreaLocked, inputAreaStyle],
    [inputAreaStyle, isComposerLocked],
  );

  const attachmentTray = useMemo(
    () =>
      renderAttachmentTray({
        selectedAttachments,
        isComposerLocked,
        handleOpenAttachment,
        handleRemoveAttachment,
      }),
    [handleOpenAttachment, handleRemoveAttachment, isComposerLocked, selectedAttachments],
  );

  const queueList = useMemo(
    () => renderQueueTrack({ queuedMessages, handleEditQueuedMessage, handleSendQueuedNow }),
    [handleEditQueuedMessage, handleSendQueuedNow, queuedMessages],
  );

  const messageInputContainerRef = useRef<View>(null);

  const isSubmitBusy = (hasPendingSend && !isServerAdopted) || isSubmitLoading;
  const messageInputAutoFocus = autoFocus && isDesktopWebBreakpoint;
  const submitLoadingPressHandler = isAgentRunning ? handleCancelAgent : undefined;
  const sendErrorNode = useMemo(
    () => (sendError ? <Text style={styles.sendErrorText}>{sendError}</Text> : null),
    [sendError],
  );
  const autocompleteVisible = autocomplete.isVisible && isPaneFocused;

  const composerFallback = useCallback(
    (error: unknown, resetError: () => void) => (
      <SectionErrorFallback
        error={error}
        onReset={resetError}
        sectionLabel={t("errors.sectionComposer")}
        compact
      />
    ),
    [t],
  );

  return (
    <ErrorBoundary fallback={composerFallback}>
      <Animated.View style={composerContainerStyle}>
        <AttachmentLightbox metadata={lightboxMetadata} onClose={handleLightboxClose} />
        {/* Input area */}
        <View style={inputAreaContainerStyle}>
          <View style={styles.inputAreaContent}>
            {queueList}
            {sendErrorNode}

            <View ref={messageInputContainerRef} style={styles.messageInputContainer}>
              <AutocompletePopover
                visible={autocompleteVisible}
                anchorRef={messageInputContainerRef}
                options={autocomplete.options}
                selectedIndex={autocomplete.selectedIndex}
                onSelect={autocomplete.onSelectOption}
                isLoading={autocomplete.isLoading}
                errorMessage={autocomplete.errorMessage}
                loadingText={autocomplete.loadingText}
                emptyText={autocomplete.emptyText}
              />

              {/* MessageInput handles everything: text, dictation, attachments, all buttons */}
              <StableMessageInput
                ref={messageInputRef}
                value={userInput}
                onChangeText={setUserInput}
                onSubmit={handleSubmit}
                hasExternalContent={hasExternalContent}
                allowEmptySubmit={allowEmptySubmit}
                submitButtonAccessibilityLabel={submitButtonAccessibilityLabel}
                submitIcon={submitIcon}
                isSubmitDisabled={isSubmitBusy}
                isSubmitLoading={isSubmitBusy}
                attachments={selectedAttachments}
                cwd={cwd}
                attachmentMenuItems={attachmentMenuItems}
                onAttachButtonRef={handleAttachButtonRef}
                onAddImages={addImages}
                client={client}
                isReadyForDictation={isDictationReady}
                placeholder={messagePlaceholder}
                autoFocus={messageInputAutoFocus}
                autoFocusKey={`${serverId}:${agentId}`}
                disabled={isSubmitLoading}
                isPaneFocused={isPaneFocused}
                leftContent={leftContent}
                beforeVoiceContent={beforeVoiceContent}
                rightContent={rightContent}
                voiceServerId={serverId}
                voiceAgentId={agentId}
                isAgentRunning={isAgentRunning}
                defaultSendBehavior={appSettings.sendBehavior}
                onQueue={handleQueue}
                onSubmitLoadingPress={submitLoadingPressHandler}
                onKeyPress={handleCommandKeyPress}
                onSelectionChange={handleSelectionChange}
                onFocusChange={handleFocusChange}
                onHeightChange={onComposerHeightChange}
                inputWrapperStyle={inputWrapperStyle}
                attachmentSlot={attachmentTray}
              />
              {githubPicker}
            </View>
          </View>
        </View>
        {renderComposerFooter(footer, footerRight)}
      </Animated.View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  borderSeparator: {
    height: theme.borderWidth[1],
    backgroundColor: theme.colors.border,
  },
  // Soft .composer-dock vertical only on desktop: ConversationAspectColumn /
  // Soft Home already own the 28px session inset. Compact keeps .m-composer-wrap 12.
  // Keep overflow visible so the pen-bar card's soft shadow is not clipped square.
  inputAreaContainer: {
    position: "relative",
    minHeight: FOOTER_HEIGHT,
    alignItems: "center",
    width: "100%",
    minWidth: 0,
    overflow: "visible",
    paddingLeft: {
      xs: 12,
      md: 0,
    },
    paddingRight: {
      xs: 12,
      md: 0,
    },
    paddingBottom: {
      xs: 18,
      md: 16,
    },
    paddingTop: 8,
  },
  inputAreaLocked: {
    opacity: 0.6,
  },
  inputAreaContent: {
    // Width is driven by the left-aligned ConversationAspectColumn (max = height).
    width: "100%",
    minWidth: 0,
    gap: theme.spacing[3],
  },
  // Soft right cbar: model cluster then context meter, before voice/send.
  cbarRightCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexShrink: 1,
    minWidth: 0,
  },
  footer: {
    width: "100%",
    minWidth: 0,
    paddingLeft: 14,
    paddingRight: 14,
    // Negative margin collapses the gap between input area and footer toolbar.
    // Mobile (xs): spacing[4] (16px) minus 3px leaves a 3px visual gap — the
    // smallest value below spacing[1] (4px) that still provides breathing room.
    // Desktop (md): uses -spacing[3] (-12px) for a tighter collapse.
    marginTop: {
      xs: -(theme.spacing[4] - 3),
      md: -theme.spacing[3],
    },
    alignItems: "flex-start",
  },
  footerContent: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    // On mobile, the negative margins below cancel each glyph's internal padding
    // to reach the composer border; this inset adds a small visual gap from it.
    paddingLeft: {
      xs: 5,
      md: 10,
    },
    paddingRight: {
      xs: 5,
      md: 10,
    },
  },
  footerLeft: {
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    // On mobile, cancel the leading glyph's internal padding (chip paddingHorizontal)
    // so its icon aligns to the composer border before the footer inset is applied.
    marginLeft: {
      xs: -theme.spacing[2],
      md: 0,
    },
  },
  footerRight: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    // On mobile, cancel the trailing glyph's internal inset (28px box around a 16px
    // ring) so its right edge aligns to the composer border before the footer inset.
    marginRight: {
      xs: -6,
      md: 0,
    },
  },
  messageInputContainer: {
    position: "relative",
    width: "100%",
    gap: theme.spacing[3],
  },
  sendErrorText: {
    color: theme.colors.palette.red[500],
    fontSize: 12.5,
    lineHeight: 16,
  },
})) as unknown as Record<string, object>;

const staticStyles = RNStyleSheet.create({
  container: {
    flexDirection: "column",
    position: "relative",
  },
});
