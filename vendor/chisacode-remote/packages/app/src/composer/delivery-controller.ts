import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { DaemonClient } from "@chisacode/client/internal/daemon-client";

import type { ComposerAttachment, UserComposerAttachment } from "@/attachments/types";
import type { ClientSlashCommand } from "@/client-slash-commands";
import { dispatchComposerAgentMessage, type AgentStreamWriter } from "@/composer/actions";
import type { MessageInputRef } from "@/composer/input/input";
import type { MessagePayload } from "@/composer/types";
import { useSessionStore } from "@/stores/session-store";
import { encodeImages } from "@/utils/encode-images";

interface UseComposerDeliveryControllerInput {
  serverId: string;
  agentId: string;
  cwd: string;
  client: DaemonClient | null;
  messageInputRef: RefObject<MessageInputRef | null>;
  blurOnSubmit: boolean;
  onSubmitMessage?: (payload: MessagePayload) => Promise<void>;
  onClientSlashCommand?: (command: ClientSlashCommand) => Promise<void>;
  onMessageSent?: () => void;
  onAttentionPromptSend?: () => void;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  setUserInput: (text: string) => void;
  setSelectedAttachments: Dispatch<SetStateAction<UserComposerAttachment[]>>;
  resetSuppression: () => void;
  setSendError: Dispatch<SetStateAction<string | null>>;
  setIsProcessing: Dispatch<SetStateAction<boolean>>;
}

interface ComposerDeliveryControllerResult {
  runClientSlashCommand: (command: ClientSlashCommand) => boolean;
  /**
   * Submits a message. When the default daemon path is used, resolves to the
   * optimistic message id; external `onSubmitMessage` paths resolve to null.
   */
  submitMessage: (text: string, attachments: ComposerAttachment[]) => Promise<string | null>;
  canSubmitMessage: () => boolean;
  /**
   * Registers a synchronous callback for the optimistic message id (fired
   * immediately after the stream append, before the daemon round-trip).
   */
  setOnOptimisticDispatched: (handler: ((messageId: string) => void) | null) => void;
}

export function useComposerDeliveryController(
  input: UseComposerDeliveryControllerInput,
): ComposerDeliveryControllerResult {
  const {
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
  } = input;
  const setAgentStreamTail = useSessionStore((state) => state.setAgentStreamTail);
  const setAgentStreamHead = useSessionStore((state) => state.setAgentStreamHead);
  const agentIdRef = useRef(agentId);
  const onOptimisticDispatchedRef = useRef<((messageId: string) => void) | null>(null);
  const sendAgentMessageRef = useRef<
    | ((
        targetAgentId: string,
        text: string,
        attachments: ComposerAttachment[],
      ) => Promise<string | null>)
    | null
  >(null);
  const onSubmitMessageRef = useRef(onSubmitMessage);

  const runClientSlashCommand = useCallback(
    (command: ClientSlashCommand): boolean => {
      if (command.execution !== "immediate" || !onClientSlashCommand) {
        return false;
      }
      if (blurOnSubmit) {
        messageInputRef.current?.blur();
      }
      clearDraft("sent");
      setUserInput("");
      setSelectedAttachments([]);
      resetSuppression();
      setSendError(null);
      setIsProcessing(true);
      void onClientSlashCommand(command)
        .catch((error) => {
          console.error("[Composer] Failed to run client slash command:", error);
          setSendError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          setIsProcessing(false);
        });
      return true;
    },
    [
      blurOnSubmit,
      clearDraft,
      messageInputRef,
      onClientSlashCommand,
      resetSuppression,
      setIsProcessing,
      setSelectedAttachments,
      setSendError,
      setUserInput,
    ],
  );
  const submitMessage = useCallback(
    async (text: string, submitAttachments: ComposerAttachment[]): Promise<string | null> => {
      onMessageSent?.();
      if (onSubmitMessageRef.current) {
        await onSubmitMessageRef.current({ text, attachments: submitAttachments, cwd });
        return null;
      }
      if (!sendAgentMessageRef.current) {
        throw new Error("Host is not connected");
      }
      return await sendAgentMessageRef.current(agentIdRef.current, text, submitAttachments);
    },
    [cwd, onMessageSent],
  );
  const canSubmitMessage = useCallback(
    () => Boolean(sendAgentMessageRef.current || onSubmitMessageRef.current),
    [],
  );

  useEffect(() => {
    agentIdRef.current = agentId;
  }, [agentId]);
  useEffect(() => {
    sendAgentMessageRef.current = async (
      targetAgentId: string,
      text: string,
      sendAttachments: ComposerAttachment[],
    ): Promise<string | null> => {
      if (!client) {
        throw new Error("Host is not connected");
      }
      const stream: AgentStreamWriter = {
        getTail: (id) => useSessionStore.getState().sessions[serverId]?.agentStreamTail?.get(id),
        getHead: (id) => useSessionStore.getState().sessions[serverId]?.agentStreamHead?.get(id),
        setHead: (updater) => setAgentStreamHead(serverId, updater),
        setTail: (updater) => setAgentStreamTail(serverId, updater),
      };
      const messageId = await dispatchComposerAgentMessage({
        client,
        agentId: targetAgentId,
        text,
        attachments: sendAttachments,
        encodeImages,
        stream,
        onOptimisticDispatched: (id) => onOptimisticDispatchedRef.current?.(id),
      });
      onAttentionPromptSend?.();
      return messageId;
    };
  }, [client, onAttentionPromptSend, serverId, setAgentStreamHead, setAgentStreamTail]);
  useEffect(() => {
    onSubmitMessageRef.current = onSubmitMessage;
  }, [onSubmitMessage]);

  const setOnOptimisticDispatched = useCallback((handler: ((messageId: string) => void) | null) => {
    onOptimisticDispatchedRef.current = handler;
  }, []);

  return { runClientSlashCommand, submitMessage, canSubmitMessage, setOnOptimisticDispatched };
}
