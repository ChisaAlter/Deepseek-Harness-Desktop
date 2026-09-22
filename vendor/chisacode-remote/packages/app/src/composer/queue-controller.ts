import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";

import type { ComposerAttachment, UserComposerAttachment } from "@/attachments/types";
import { resolveClientSlashCommand, type ClientSlashCommand } from "@/client-slash-commands";
import {
  editQueuedComposerMessage,
  queueComposerMessage,
  sendQueuedComposerMessageNow,
  type QueueWriter,
  type QueuedComposerMessage,
} from "@/composer/actions";
import type { MessagePayload } from "@/composer/types";
import { useSessionStore } from "@/stores/session-store";

const EMPTY_QUEUED_MESSAGES: readonly QueuedComposerMessage[] = [];

interface UseComposerQueueControllerInput {
  serverId: string;
  agentId: string;
  attachments: UserComposerAttachment[];
  buildOutgoingAttachments: (attachments: UserComposerAttachment[]) => ComposerAttachment[];
  setUserInput: (text: string) => void;
  setSelectedAttachments: Dispatch<SetStateAction<UserComposerAttachment[]>>;
  resetSuppression: () => void;
  clearSentAttachments: (attachments: readonly ComposerAttachment[]) => void;
  runClientSlashCommand: (command: ClientSlashCommand) => boolean;
  canSubmitQueuedMessage: () => boolean;
  submitMessage: (text: string, attachments: ComposerAttachment[]) => Promise<string | null | void>;
  setSendError: Dispatch<SetStateAction<string | null>>;
}

interface ComposerQueueControllerResult {
  queuedMessages: readonly QueuedComposerMessage[];
  queueMessage: (text: string, attachments: ComposerAttachment[]) => void;
  handleEditQueuedMessage: (id: string) => void;
  handleSendQueuedNow: (id: string) => Promise<void>;
  handleQueue: (payload: MessagePayload) => void;
}

export function useComposerQueueController(
  input: UseComposerQueueControllerInput,
): ComposerQueueControllerResult {
  const {
    serverId,
    agentId,
    attachments,
    buildOutgoingAttachments,
    setUserInput,
    setSelectedAttachments,
    resetSuppression,
    clearSentAttachments,
    runClientSlashCommand,
    canSubmitQueuedMessage,
    submitMessage,
    setSendError,
  } = input;
  const queuedMessagesRaw = useSessionStore((state) =>
    state.sessions[serverId]?.queuedMessages?.get(agentId),
  );
  const queuedMessages = queuedMessagesRaw ?? EMPTY_QUEUED_MESSAGES;
  const setQueuedMessages = useSessionStore((state) => state.setQueuedMessages);
  const queueWriter = useMemo<QueueWriter>(
    () => ({
      read: (id) => useSessionStore.getState().sessions[serverId]?.queuedMessages?.get(id) ?? [],
      write: (updater) => setQueuedMessages(serverId, updater),
    }),
    [serverId, setQueuedMessages],
  );
  const queueMessage = useCallback(
    (queuedMessage: string, queuedAttachments: ComposerAttachment[]) => {
      const result = queueComposerMessage({
        agentId,
        text: queuedMessage,
        attachments: queuedAttachments,
        queue: queueWriter,
      });
      if (!result.queued) return;

      setUserInput("");
      setSelectedAttachments([]);
      resetSuppression();
      clearSentAttachments(queuedAttachments);
    },
    [
      agentId,
      clearSentAttachments,
      queueWriter,
      resetSuppression,
      setSelectedAttachments,
      setUserInput,
    ],
  );
  const handleEditQueuedMessage = useCallback(
    (id: string) => {
      const result = editQueuedComposerMessage({
        agentId,
        messageId: id,
        queue: queueWriter,
      });
      if (!result) return;
      setUserInput(result.text);
      setSelectedAttachments(result.attachments);
    },
    [agentId, queueWriter, setSelectedAttachments, setUserInput],
  );
  const handleSendQueuedNow = useCallback(
    async (id: string) => {
      if (!canSubmitQueuedMessage()) return;
      const result = await sendQueuedComposerMessageNow({
        agentId,
        messageId: id,
        queue: queueWriter,
        submitMessage: async ({ text, attachments: queuedAttachments }) => {
          await submitMessage(text, queuedAttachments);
        },
      });
      if (result.status === "failed") {
        setSendError(result.errorMessage);
      }
    },
    [agentId, canSubmitQueuedMessage, queueWriter, setSendError, submitMessage],
  );
  const handleQueue = useCallback(
    (payload: MessagePayload) => {
      const outgoingAttachments = buildOutgoingAttachments(attachments);
      const clientSlashCommand = resolveClientSlashCommand({
        text: payload.text,
        hasAttachments: outgoingAttachments.length > 0,
      });
      if (clientSlashCommand && runClientSlashCommand(clientSlashCommand)) {
        return;
      }
      queueMessage(payload.text, outgoingAttachments);
    },
    [attachments, buildOutgoingAttachments, queueMessage, runClientSlashCommand],
  );

  return {
    queuedMessages,
    queueMessage,
    handleEditQueuedMessage,
    handleSendQueuedNow,
    handleQueue,
  };
}
