import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";

import type { ComposerAttachment, UserComposerAttachment } from "@/attachments/types";
import { resolveClientSlashCommand, type ClientSlashCommand } from "@/client-slash-commands";
import { composerWorkspaceAttachment } from "@/composer/attachments/workspace";
import type { MessageInputRef } from "@/composer/input/input";
import { submitAgentInput, type AgentInputSubmitResult } from "@/composer/submit";
import type { MessagePayload } from "@/composer/types";

interface UseComposerSubmissionControllerInput {
  attachments: UserComposerAttachment[];
  buildOutgoingAttachments: (attachments: UserComposerAttachment[]) => ComposerAttachment[];
  runClientSlashCommand: (command: ClientSlashCommand) => boolean;
  blurOnSubmit: boolean;
  messageInputRef: RefObject<MessageInputRef | null>;
  hasExternalContent: boolean;
  allowEmptySubmit: boolean;
  submitBehavior: "clear" | "preserve-and-lock";
  isAgentRunning: boolean;
  canSubmitMessage: () => boolean;
  queueMessage: (text: string, attachments: ComposerAttachment[]) => void;
  submitMessage: (text: string, attachments: ComposerAttachment[]) => Promise<string | null | void>;
  clearDraft: (lifecycle: "sent" | "abandoned") => void;
  setUserInput: (text: string) => void;
  setSelectedAttachments: Dispatch<SetStateAction<UserComposerAttachment[]>>;
  completeSubmit: (input: {
    result: AgentInputSubmitResult;
    outgoingAttachments: readonly ComposerAttachment[];
  }) => void;
  setSendError: Dispatch<SetStateAction<string | null>>;
  setIsProcessing: Dispatch<SetStateAction<boolean>>;
}

interface ComposerSubmissionControllerResult {
  handleSubmit: (payload: MessagePayload) => void;
}

export function useComposerSubmissionController(
  input: UseComposerSubmissionControllerInput,
): ComposerSubmissionControllerResult {
  const {
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
  } = input;

  const sendMessageWithContent = useCallback(
    async (
      outgoingMessage: string,
      outgoingAttachments: ComposerAttachment[],
      forceSend?: boolean,
    ) => {
      const result = await submitAgentInput({
        message: outgoingMessage,
        attachments: outgoingAttachments,
        hasExternalContent,
        allowEmptySubmit,
        forceSend,
        submitBehavior,
        isAgentRunning,
        // Parent-managed submits are still valid paths when the transport is disconnected.
        canSubmit: canSubmitMessage(),
        queueMessage: ({ message: queuedText, attachments: queuedAttachments }) => {
          queueMessage(queuedText, queuedAttachments);
        },
        submitMessage: async ({ message: submitText, attachments: submitAttachments }) => {
          await submitMessage(submitText, submitAttachments);
        },
        clearDraft,
        setUserInput,
        setAttachments: (nextAttachments) => {
          setSelectedAttachments(composerWorkspaceAttachment.userAttachmentsOnly(nextAttachments));
        },
        setSendError,
        setIsProcessing,
        onSubmitError: (error) => {
          console.error("[AgentInput] Failed to send message:", error);
        },
      });
      completeSubmit({ result, outgoingAttachments });
    },
    [
      allowEmptySubmit,
      canSubmitMessage,
      clearDraft,
      completeSubmit,
      hasExternalContent,
      isAgentRunning,
      queueMessage,
      setIsProcessing,
      setSelectedAttachments,
      setSendError,
      setUserInput,
      submitBehavior,
      submitMessage,
    ],
  );

  const handleSubmit = useCallback(
    (payload: MessagePayload) => {
      const outgoingAttachments = buildOutgoingAttachments(attachments);
      const clientSlashCommand = resolveClientSlashCommand({
        text: payload.text,
        hasAttachments: outgoingAttachments.length > 0,
      });
      if (clientSlashCommand && runClientSlashCommand(clientSlashCommand)) {
        return;
      }

      if (blurOnSubmit) {
        messageInputRef.current?.blur();
      }
      void sendMessageWithContent(payload.text, outgoingAttachments, payload.forceSend);
    },
    [
      attachments,
      blurOnSubmit,
      buildOutgoingAttachments,
      messageInputRef,
      runClientSlashCommand,
      sendMessageWithContent,
    ],
  );

  return { handleSubmit };
}
