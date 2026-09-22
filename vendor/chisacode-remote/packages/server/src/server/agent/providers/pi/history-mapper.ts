import type { AgentStreamEvent, AgentTimelineItem, ToolCallDetail } from "../../agent-sdk-types.js";
import type { PiAgentMessage, PiImageContent, PiTextContent } from "./rpc-types.js";
import {
  extractTextFromToolResult,
  mapToolDetail,
  parseToolArgs,
  parseToolResult,
  type PiTrackedToolCall,
} from "./tool-call-mapper.js";

export interface PiCapturedUserMessageEntry {
  id: string;
  text: string;
}

function isTextContentBlock(block: unknown): block is PiTextContent {
  return (
    typeof block === "object" &&
    block !== null &&
    !Array.isArray(block) &&
    Reflect.get(block, "type") === "text" &&
    typeof Reflect.get(block, "text") === "string"
  );
}

export function getUserMessageText(content: string | (PiTextContent | PiImageContent)[]): string {
  if (typeof content === "string") {
    return content;
  }

  const textParts: string[] = [];
  for (const block of content) {
    if (isTextContentBlock(block)) {
      textParts.push(block.text);
    }
  }
  return textParts.join("\n\n");
}

/**
 * Formats a failed Pi assistant turn for history replay.
 * Live turns surface the same failure via turn_failed; resume/history must not drop it.
 * @param message Pi assistant message that may include errorMessage/stopReason
 * @returns Error text for a timeline error item, or null when the turn succeeded
 */
export function formatPiHistoryError(
  message: Extract<PiAgentMessage, { role: "assistant" }>,
): string | null {
  const headline = message.errorMessage?.trim();
  if (!headline && message.stopReason !== "error") {
    return null;
  }
  const details = [
    message.stopReason ? `stopReason=${message.stopReason}` : null,
    message.provider && message.model ? `model=${message.provider}/${message.model}` : null,
    message.responseModel ? `responseModel=${message.responseModel}` : null,
    message.responseId ? `responseId=${message.responseId}` : null,
  ].filter((detail): detail is string => detail !== null);
  const base = headline || "Pi turn failed";
  return details.length > 0 ? `${base} (${details.join(", ")})` : base;
}

export async function* streamPiHistory(
  provider: string,
  messages: PiAgentMessage[],
  userEntries: readonly PiCapturedUserMessageEntry[] = [],
): AsyncGenerator<AgentStreamEvent> {
  const pendingToolCalls = new Map<string, PiTrackedToolCall>();
  let userIndex = 0;

  for (const message of messages) {
    if (message.role === "user") {
      const text = getUserMessageText(message.content);
      if (text) {
        const userEntry = userEntries[userIndex];
        yield {
          type: "timeline",
          provider,
          item: {
            type: "user_message",
            text,
            ...(userEntry ? { messageId: userEntry.id } : {}),
          },
        };
      }
      userIndex += 1;
      continue;
    }

    if (message.role === "assistant") {
      for (const content of message.content) {
        if (content.type === "text" && content.text) {
          yield {
            type: "timeline",
            provider,
            item: { type: "assistant_message", text: content.text },
          };
          continue;
        }

        if (content.type === "thinking" && content.thinking) {
          yield {
            type: "timeline",
            provider,
            item: { type: "reasoning", text: content.thinking },
          };
          continue;
        }

        if (content.type === "toolCall") {
          const tracked = parseToolArgs(content.name, content.arguments);
          pendingToolCalls.set(content.id, tracked);
          yield {
            type: "timeline",
            provider,
            item: {
              type: "tool_call",
              callId: content.id,
              name: tracked.toolName,
              status: "running",
              detail: mapToolDetail(tracked, null),
              error: null,
            },
          };
        }
      }

      // Failed turns often have empty content (e.g. 401 before the first token).
      // Without this, resume/history only shows the user message and the UI looks hung.
      const historyError = formatPiHistoryError(message);
      if (historyError) {
        yield {
          type: "timeline",
          provider,
          item: { type: "error", message: historyError },
        };
      }
      continue;
    }

    if (message.role === "toolResult") {
      const tracked =
        pendingToolCalls.get(message.toolCallId) ?? parseToolArgs(message.toolName, null);
      pendingToolCalls.delete(message.toolCallId);
      const result = parseToolResult({ content: message.content });
      const detail = mapToolDetail(tracked, result);
      yield {
        type: "timeline",
        provider,
        item: toToolResultTimelineItem({
          callId: message.toolCallId,
          name: tracked.toolName,
          isError: Boolean(message.isError),
          detail,
          errorText: extractTextFromToolResult(result) ?? "Tool call failed",
        }),
      };
      continue;
    }

    if (message.role === "bashExecution") {
      const callId = `pi-bash-${message.timestamp}`;
      const detail: ToolCallDetail = {
        type: "shell",
        command: message.command,
        output: message.output,
        exitCode: message.exitCode ?? null,
      };
      yield {
        type: "timeline",
        provider,
        item: {
          type: "tool_call",
          callId,
          name: "bash",
          status: message.cancelled ? "canceled" : "completed",
          detail,
          error: null,
        },
      };
    }
  }
}

function toToolResultTimelineItem(input: {
  callId: string;
  name: string;
  isError: boolean;
  detail: ToolCallDetail;
  errorText: string;
}): AgentTimelineItem {
  if (input.isError) {
    return {
      type: "tool_call",
      callId: input.callId,
      name: input.name,
      status: "failed",
      detail: input.detail,
      error: input.errorText,
    };
  }
  return {
    type: "tool_call",
    callId: input.callId,
    name: input.name,
    status: "completed",
    detail: input.detail,
    error: null,
  };
}
