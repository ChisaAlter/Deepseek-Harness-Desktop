import { randomUUID } from "node:crypto";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";

import type { AgentPromptInput, AgentStreamEvent } from "../../agent-sdk-types.js";
import { renderPromptAttachmentAsText } from "../../prompt-attachments.js";
import type { ClaudeMessageRouter } from "./message-router.js";
import type { ClaudeQueryLifecycle } from "./query-lifecycle.js";
import type { ClaudeRewindController } from "./rewind-controller.js";
import { isImageMimeType } from "./sdk-types-mapping.js";

interface ClaudeForegroundTurnControllerOptions {
  logger: Logger;
  queryLifecycle: ClaudeQueryLifecycle;
  messageRouter: ClaudeMessageRouter;
  rewindController: ClaudeRewindController;
  getSessionId: () => string | null;
  isClosed: () => boolean;
  clearRecentStderr: () => void;
  interruptActiveTurn: () => Promise<void>;
  rejectAllPendingPermissions: (error: Error) => void;
  flushPendingToolCalls: () => void;
  notifySubscribers: (event: AgentStreamEvent) => void;
  emitSubmittedUserMessage: (message: SDKUserMessage, turnId: string) => void;
  buildTurnFailedEvent: (
    errorMessage: string,
  ) => Extract<AgentStreamEvent, { type: "turn_failed" }>;
}

/** Owns Claude foreground prompt conversion, dispatch, cancellation, and rewind turns. */
export class ClaudeForegroundTurnController {
  constructor(private readonly options: ClaudeForegroundTurnControllerOptions) {}

  async startTurn(prompt: AgentPromptInput): Promise<{ turnId: string }> {
    if (this.options.isClosed()) {
      throw new Error("Claude session is closed");
    }
    if (this.options.messageRouter.getActiveForegroundTurnId()) {
      throw new Error("A foreground turn is already active");
    }

    const slashCommand = this.options.rewindController.resolveSlashCommandInvocation(prompt);
    if (slashCommand) {
      const turnId = this.options.messageRouter.createTurnId("foreground");
      this.options.messageRouter.setActiveForegroundTurnId(turnId);
      this.options.messageRouter.transitionTurnState("foreground", "rewind command");
      void this.executeRewindTurn(slashCommand.args);
      return { turnId };
    }

    if (this.options.messageRouter.getAutonomousTurn()) {
      this.options.messageRouter.completeAutonomousTurn();
    }

    const sdkMessage = this.toSdkUserMessage(prompt);
    const sdkUserMessageId =
      typeof sdkMessage.uuid === "string" && sdkMessage.uuid.length > 0 ? sdkMessage.uuid : null;
    this.options.rewindController.rememberUserAnchor(sdkUserMessageId);
    const turnId = this.options.messageRouter.createTurnId("foreground");
    this.options.messageRouter.setActiveForegroundTurnId(turnId);
    this.options.messageRouter.setForegroundVisibleActivity(false);
    this.options.messageRouter.setActiveTurnAssistantText(false);
    this.options.messageRouter.transitionTurnState("foreground", "foreground turn started");
    this.options.clearRecentStderr();

    this.installCancellation();
    this.options.notifySubscribers({ type: "turn_started", provider: "claude" });

    try {
      await this.options.queryLifecycle.send(sdkMessage);
      setTimeout(() => {
        if (this.options.messageRouter.getActiveForegroundTurnId() === turnId) {
          this.options.emitSubmittedUserMessage(sdkMessage, turnId);
        }
      }, 0);
    } catch (error) {
      this.options.messageRouter.finishForegroundTurn(
        this.options.buildTurnFailedEvent(
          error instanceof Error ? error.message : "Claude stream failed",
        ),
      );
    }

    return { turnId };
  }

  async interrupt(): Promise<void> {
    const cancelCurrentTurn = this.options.messageRouter.getCancelCurrentTurn();
    if (cancelCurrentTurn) {
      cancelCurrentTurn();
      return;
    }

    if (this.options.messageRouter.getAutonomousTurn()) {
      this.options.flushPendingToolCalls();
      this.options.messageRouter.completeAutonomousTurn();
    }

    await this.options.interruptActiveTurn();
  }

  close(): void {
    this.options.messageRouter.getCancelCurrentTurn()?.();
    this.options.messageRouter.setActiveForegroundTurnId(null);
    this.options.messageRouter.setAutonomousTurn(null);
    this.options.messageRouter.setCancelCurrentTurn(null);
    this.options.messageRouter.setTurnState("idle");
  }

  private installCancellation(): void {
    let cancelIssued = false;
    const requestCancel = () => {
      if (cancelIssued) {
        return;
      }
      cancelIssued = true;
      if (this.options.messageRouter.getCancelCurrentTurn() === requestCancel) {
        this.options.messageRouter.setCancelCurrentTurn(null);
      }
      this.options.rejectAllPendingPermissions(new Error("Permission request aborted"));
      this.options.messageRouter.finishForegroundTurn({
        type: "turn_canceled",
        provider: "claude",
        reason: "Interrupted",
      });
      void this.options.interruptActiveTurn().catch((error) => {
        this.options.logger.warn({ err: error }, "Failed to interrupt during cancel");
      });
    };
    this.options.messageRouter.setCancelCurrentTurn(requestCancel);
  }

  private async executeRewindTurn(args: string | undefined): Promise<void> {
    this.options.notifySubscribers({ type: "turn_started", provider: "claude" });
    try {
      const rewindAttempt = await this.options.rewindController.attempt(args);
      if (!rewindAttempt.messageId || !rewindAttempt.result) {
        this.options.messageRouter.finishForegroundTurn({
          type: "turn_failed",
          provider: "claude",
          error:
            rewindAttempt.error ??
            "No prior user message available to rewind. Use /rewind <user_message_uuid>.",
        });
        return;
      }
      this.options.notifySubscribers({
        type: "timeline",
        provider: "claude",
        item: {
          type: "assistant_message",
          text: this.options.rewindController.buildSuccessMessage(
            rewindAttempt.messageId,
            rewindAttempt.result,
          ),
        },
      });
      this.options.messageRouter.finishForegroundTurn({
        type: "turn_completed",
        provider: "claude",
      });
    } catch (error) {
      this.options.messageRouter.finishForegroundTurn({
        type: "turn_failed",
        provider: "claude",
        error: error instanceof Error ? error.message : "Failed to rewind tracked files",
      });
    }
  }

  private toSdkUserMessage(prompt: AgentPromptInput): SDKUserMessage {
    const content: Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          source: {
            type: "base64";
            media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
            data: string;
          };
        }
    > = [];
    if (Array.isArray(prompt)) {
      for (const chunk of prompt) {
        if (chunk.type === "text") {
          content.push({ type: "text", text: chunk.text });
        } else if (chunk.type === "image") {
          if (isImageMimeType(chunk.mimeType)) {
            content.push({
              type: "image",
              source: {
                type: "base64",
                media_type: chunk.mimeType,
                data: chunk.data,
              },
            });
          }
        } else {
          content.push({ type: "text", text: renderPromptAttachmentAsText(chunk) });
        }
      }
    } else {
      content.push({ type: "text", text: prompt });
    }

    const messageId = randomUUID();
    this.options.rewindController.rememberUserMessageId(messageId);
    return {
      type: "user",
      message: {
        role: "user",
        content,
      },
      parent_tool_use_id: null,
      uuid: messageId,
      session_id: this.options.getSessionId() ?? "",
    };
  }
}
