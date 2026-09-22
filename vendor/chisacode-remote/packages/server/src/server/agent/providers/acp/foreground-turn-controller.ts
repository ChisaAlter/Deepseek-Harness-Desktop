import type {
  ClientSideConnection,
  ContentBlock,
  Error as ACPError,
  PromptResponse,
  Usage,
} from "@agentclientprotocol/sdk";
import { randomUUID } from "node:crypto";

import type {
  AgentPromptContentBlock,
  AgentPromptInput,
  AgentStreamEvent,
  AgentUsage,
} from "../../agent-sdk-types.js";
import { renderPromptAttachmentAsText } from "../../prompt-attachments.js";

interface SuppressedUserEcho {
  messageId: string | null;
  text: string | null;
}

interface ProcessExitInput {
  exitCode: number | null;
  signal: string | null;
  diagnostic?: string;
}

type TerminalTurnEvent = Extract<
  AgentStreamEvent,
  { type: "turn_completed" | "turn_failed" | "turn_canceled" }
>;

/** Dependencies used by the ACP foreground turn controller. */
export interface ACPForegroundTurnControllerOptions {
  provider: string;
  getSessionId: () => string | null;
  emit: (event: AgentStreamEvent) => void;
  collectDiagnostic: (message: string) => string | undefined;
  createCanceledToolEvents: () => AgentStreamEvent[];
}

/** Owns ACP foreground prompt dispatch, active turn state, usage, and terminal outcomes. */
export class ACPForegroundTurnController {
  private readonly provider: string;
  private readonly getSessionId: () => string | null;
  private readonly emit: (event: AgentStreamEvent) => void;
  private readonly collectDiagnostic: (message: string) => string | undefined;
  private readonly createCanceledToolEvents: () => AgentStreamEvent[];
  private currentTurnUsage: AgentUsage | undefined;
  private currentActiveTurnId: string | null = null;
  private suppressedMessageId: string | null = null;
  private suppressedText: string | null = null;
  private bootstrapThreadEventPending = false;

  constructor(options: ACPForegroundTurnControllerOptions) {
    this.provider = options.provider;
    this.getSessionId = options.getSessionId;
    this.emit = options.emit;
    this.collectDiagnostic = options.collectDiagnostic;
    this.createCanceledToolEvents = options.createCanceledToolEvents;
  }

  get activeTurnId(): string | null {
    return this.currentActiveTurnId;
  }

  get suppressedUserEcho(): SuppressedUserEcho {
    return {
      messageId: this.suppressedMessageId,
      text: this.suppressedText,
    };
  }

  markThreadBootstrapPending(): void {
    this.bootstrapThreadEventPending = true;
  }

  startTurn(
    prompt: AgentPromptInput,
    connection: Pick<ClientSideConnection, "prompt">,
    sessionId: string,
  ): { turnId: string } {
    if (this.currentActiveTurnId) {
      throw new Error("A foreground turn is already active");
    }

    const turnId = randomUUID();
    const messageId = randomUUID();
    this.currentTurnUsage = undefined;
    this.currentActiveTurnId = turnId;
    this.suppressedMessageId = messageId;
    this.suppressedText = extractPromptText(prompt);
    this.emitBootstrapThreadEvent();
    this.emit({ type: "turn_started", provider: this.provider, turnId });

    void connection
      .prompt({
        sessionId,
        messageId,
        prompt: toACPContentBlocks(prompt),
      })
      .then((response) => {
        if (this.currentActiveTurnId !== turnId) {
          return;
        }
        return this.handlePromptResponse(response, turnId);
      })
      .catch((error: unknown) => {
        if (this.currentActiveTurnId !== turnId) {
          return;
        }
        const summary = summarizeACPRequestError(error);
        return this.finishTurn({
          type: "turn_failed",
          provider: this.provider,
          error: summary.message,
          code: summary.code,
          diagnostic: this.collectDiagnostic(summary.diagnostic ?? summary.message),
          turnId,
        });
      });

    return { turnId };
  }

  handleProcessExit(input: ProcessExitInput): void {
    if (!this.currentActiveTurnId) {
      return;
    }
    this.emitCanceledToolEvents();
    this.finishTurn({
      type: "turn_failed",
      provider: this.provider,
      error: `ACP agent exited unexpectedly (${input.exitCode ?? "null"}${input.signal ? `, ${input.signal}` : ""})`,
      diagnostic: input.diagnostic,
      turnId: this.currentActiveTurnId,
    });
  }

  close(): void {
    this.currentActiveTurnId = null;
    this.suppressedMessageId = null;
    this.suppressedText = null;
  }

  private handlePromptResponse(response: PromptResponse, turnId: string): void {
    this.currentTurnUsage = mapACPUsage(response.usage);

    switch (response.stopReason) {
      case "cancelled":
        this.emitCanceledToolEvents();
        this.finishTurn({
          type: "turn_canceled",
          provider: this.provider,
          reason: "Interrupted",
          turnId,
        });
        return;
      case "end_turn":
      case "max_tokens":
      case "max_turn_requests":
      case "refusal":
      default:
        this.finishTurn({
          type: "turn_completed",
          provider: this.provider,
          usage: this.currentTurnUsage,
          turnId,
        });
    }
  }

  private finishTurn(event: TerminalTurnEvent): void {
    this.currentActiveTurnId = null;
    this.suppressedMessageId = null;
    this.suppressedText = null;
    this.emit(event);
  }

  private emitBootstrapThreadEvent(): void {
    const sessionId = this.getSessionId();
    if (!this.bootstrapThreadEventPending || !sessionId) {
      return;
    }
    this.bootstrapThreadEventPending = false;
    this.emit({
      type: "thread_started",
      provider: this.provider,
      sessionId,
    });
  }

  private emitCanceledToolEvents(): void {
    for (const event of this.createCanceledToolEvents()) {
      this.emit(event);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isACPError(value: unknown): value is ACPError {
  return isRecord(value) && typeof value.message === "string" && typeof value.code === "number";
}

function summarizeACPRequestError(error: unknown): {
  message: string;
  code?: string;
  diagnostic?: string;
} {
  if (isACPError(error)) {
    const code = String(error.code);
    const data = error.data === undefined ? "" : ` | data=${JSON.stringify(error.data)}`;
    return {
      message: error.message,
      code,
      diagnostic: `${error.message} | code=${code}${data}`,
    };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: String(error) };
}

/**
 * Maps ACP usage fields into shared agent usage.
 * @param usage ACP usage payload
 * @returns Shared usage metrics when provided
 */
export function mapACPUsage(usage: Usage | null | undefined): AgentUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    inputTokens: usage.inputTokens ?? undefined,
    outputTokens: usage.outputTokens ?? undefined,
    cachedInputTokens: usage.cachedReadTokens ?? undefined,
  };
}

function toACPContentBlocks(prompt: AgentPromptInput): ContentBlock[] {
  if (typeof prompt === "string") {
    return [{ type: "text", text: prompt }];
  }

  const contentBlocks: ContentBlock[] = [];
  for (const block of prompt) {
    switch (block.type) {
      case "text":
        contentBlocks.push({ type: "text", text: block.text });
        break;
      case "image":
        contentBlocks.push({ type: "image", data: block.data, mimeType: block.mimeType });
        break;
      default:
        contentBlocks.push({ type: "text", text: renderPromptAttachmentAsText(block) });
        break;
    }
  }
  return contentBlocks;
}

function extractPromptText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") {
    return prompt;
  }
  return prompt
    .filter(
      (block): block is Extract<AgentPromptContentBlock, { type: "text" }> => block.type === "text",
    )
    .map((block) => block.text)
    .join("");
}
