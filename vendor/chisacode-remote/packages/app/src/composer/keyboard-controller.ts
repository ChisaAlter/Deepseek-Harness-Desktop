import { useCallback, useRef, useState, type RefObject } from "react";
import type { DaemonClient } from "@chisacode/client/internal/daemon-client";

import type { MessageInputRef } from "@/composer/input/input";
import { isNative } from "@/constants/platform";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { MessageInputKeyboardActionKind } from "@/keyboard/actions";
import type { KeyboardActionDefinition } from "@/keyboard/keyboard-action-dispatcher";
import { useSessionStore } from "@/stores/session-store";
import { focusWithRetries } from "@/utils/web-focus";

interface UseComposerKeyboardControllerInput {
  serverId: string;
  agentId: string;
  client: DaemonClient | null;
  isPaneFocused: boolean;
  messageInputRef: RefObject<MessageInputRef | null>;
  isAgentRunning: boolean;
  isCancellingAgent: boolean;
  isConnected: boolean;
  handleCancelAgent: () => void;
  onAttentionInputFocus?: () => void;
}

interface ComposerKeyboardControllerResult {
  handleFocusChange: (focused: boolean) => void;
}

interface DispatchComposerKeyboardActionInput {
  action: KeyboardActionDefinition;
  isPaneFocused: boolean;
  messageInputRef: RefObject<MessageInputRef | null>;
  isAgentRunning: boolean;
  isCancellingAgent: boolean;
  isConnected: boolean;
  handleCancelAgent: () => void;
  focusMessageInput: () => void;
  onCycleAgentMode: () => void;
}

function resolveKeyboardPriority(isMessageInputFocused: boolean): number {
  return isMessageInputFocused ? 200 : 100;
}

function focusMessageInputWithPlatformStrategy(
  messageInputRef: RefObject<MessageInputRef | null>,
): void {
  if (isNative) {
    messageInputRef.current?.focus();
    return;
  }
  focusWithRetries({
    focus: () => messageInputRef.current?.focus(),
    isFocused: () => {
      const element = messageInputRef.current?.getNativeElement?.() ?? null;
      const active = typeof document !== "undefined" ? document.activeElement : null;
      return Boolean(element) && active === element;
    },
  });
}

function resolveMessageInputPassthroughAction(
  actionId: string,
): MessageInputKeyboardActionKind | null {
  switch (actionId) {
    case "message-input.send":
      return "send";
    case "message-input.dictation-confirm":
      return "dictation-confirm";
    case "message-input.dictation-toggle":
      return "dictation-toggle";
    case "message-input.dictation-cancel":
      return "dictation-cancel";
    case "message-input.voice-toggle":
      return "voice-toggle";
    case "message-input.voice-mute-toggle":
      return "voice-mute-toggle";
    case "message-input.mode-cycle":
      return "mode-cycle";
    default:
      return null;
  }
}

function dispatchComposerKeyboardAction(input: DispatchComposerKeyboardActionInput): boolean {
  const {
    action,
    isPaneFocused,
    messageInputRef,
    isAgentRunning,
    isCancellingAgent,
    isConnected,
    handleCancelAgent,
    focusMessageInput,
  } = input;
  if (!isPaneFocused) return false;

  if (action.id === "agent.interrupt") {
    if (messageInputRef.current?.runKeyboardAction("dictation-cancel")) return true;
    if (!isAgentRunning || isCancellingAgent || !isConnected) return false;
    handleCancelAgent();
    return true;
  }

  if (action.id === "message-input.focus") {
    focusMessageInput();
    return true;
  }

  if (action.id === "message-input.mode-cycle") {
    input.onCycleAgentMode();
    return true;
  }

  const passthroughAction = resolveMessageInputPassthroughAction(action.id);
  if (!passthroughAction) return false;
  const result = messageInputRef.current?.runKeyboardAction(passthroughAction);
  // Respect the input's own guard: e.g. voice-mute-toggle is a no-op (and
  // must NOT swallow Space for keyboard users) when voice mode is not active.
  return result ?? false;
}

export function useComposerKeyboardController(
  input: UseComposerKeyboardControllerInput,
): ComposerKeyboardControllerResult {
  const {
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
  } = input;
  const [isMessageInputFocused, setIsMessageInputFocused] = useState(false);
  const handlerIdRef = useRef(
    `message-input:${serverId}:${agentId}:${Math.random().toString(36).slice(2)}`,
  );
  const focusMessageInput = useCallback(() => {
    focusMessageInputWithPlatformStrategy(messageInputRef);
  }, [messageInputRef]);
  const onCycleAgentMode = useCallback(() => {
    const agent = useSessionStore.getState().sessions[serverId]?.agents?.get(agentId);
    if (!agent) return;
    const modes = agent.availableModes;
    if (modes.length <= 1) return;
    const currentIndex = modes.findIndex((mode) => mode.id === agent.currentModeId);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % modes.length;
    const next = modes[nextIndex];
    if (!next || !client) return;
    void client.setAgentMode(agentId, next.id).catch((error: Error) => {
      console.warn("[Composer] cycleAgentMode failed", error);
    });
  }, [agentId, client, serverId]);
  const handleKeyboardAction = useCallback(
    (action: KeyboardActionDefinition): boolean =>
      dispatchComposerKeyboardAction({
        action,
        isPaneFocused,
        messageInputRef,
        isAgentRunning,
        isCancellingAgent,
        isConnected,
        handleCancelAgent,
        focusMessageInput,
        onCycleAgentMode,
      }),
    [
      focusMessageInput,
      handleCancelAgent,
      isAgentRunning,
      isCancellingAgent,
      isConnected,
      isPaneFocused,
      messageInputRef,
      onCycleAgentMode,
    ],
  );

  useKeyboardActionHandler({
    handlerId: handlerIdRef.current,
    actions: [
      "agent.interrupt",
      "message-input.focus",
      "message-input.send",
      "message-input.dictation-toggle",
      "message-input.dictation-cancel",
      "message-input.dictation-confirm",
      "message-input.voice-toggle",
      "message-input.voice-mute-toggle",
      "message-input.mode-cycle",
    ],
    enabled: isPaneFocused,
    priority: resolveKeyboardPriority(isMessageInputFocused),
    isActive: () => isPaneFocused,
    handle: handleKeyboardAction,
  });

  const handleFocusChange = useCallback(
    (focused: boolean) => {
      setIsMessageInputFocused(focused);
      if (focused) {
        onAttentionInputFocus?.();
      }
    },
    [onAttentionInputFocus],
  );

  return { handleFocusChange };
}
