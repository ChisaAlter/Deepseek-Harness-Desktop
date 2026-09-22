import type {
  FilePartInput as OpenCodeFilePartInput,
  OpencodeClient,
  TextPartInput as OpenCodeTextPartInput,
} from "@opencode-ai/sdk/v2/client";
import type { Logger } from "pino";

import type { AgentPromptInput, AgentRunOptions, AgentRunResult } from "../../agent-sdk-types.js";
import { renderPromptAttachmentAsText } from "../../prompt-attachments.js";
import { composeSystemPromptParts } from "../../system-prompt.js";
import { toDiagnosticErrorMessage } from "../diagnostic-utils.js";
import { runProviderTurn } from "../provider-runner.js";
import { OpenCodeAbortCoordinator } from "./abort-coordinator.js";
import type { OpenCodeAgentConfig } from "./catalog.js";
import { OpenCodeEventStreamController } from "./event-stream.js";
import { isOpenCodeHeadersTimeoutFailure } from "./helpers.js";
import { OpenCodeMcpController } from "./mcp-controller.js";
import { OpenCodeSessionEventBus } from "./session-event-bus.js";
import { OpenCodeSessionRuntime } from "./session-runtime.js";

interface OpenCodeTurnTranslationStateInput {
  prompt: AgentPromptInput;
  contextWindowMaxTokens: number | undefined;
}

type OpenCodeTurnExecutionTraceMessage =
  | "provider.opencode.prompt_async.start"
  | "provider.opencode.prompt_async.response"
  | "provider.opencode.prompt_async.throw";

interface OpenCodeTurnExecutionOptions {
  config: OpenCodeAgentConfig;
  client: OpencodeClient;
  sessionId: string;
  logger: Logger;
  abortCoordinator: OpenCodeAbortCoordinator;
  mcpController: OpenCodeMcpController;
  sessionRuntime: OpenCodeSessionRuntime;
  eventStreamController: OpenCodeEventStreamController;
  eventBus: OpenCodeSessionEventBus;
  prepareTranslationState: (input: OpenCodeTurnTranslationStateInput) => void;
  trace: (message: OpenCodeTurnExecutionTraceMessage, data: Record<string, unknown>) => void;
}

function getOpenCodeAttachmentExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default:
      return "bin";
  }
}

function toOpenCodeDataUrl(mimeType: string, data: string): { mimeType: string; url: string } {
  const match = data.match(/^data:([^;,]+);base64,(.+)$/);
  if (match) {
    return {
      mimeType: match[1] ?? mimeType,
      url: data,
    };
  }
  return {
    mimeType,
    url: `data:${mimeType};base64,${data}`,
  };
}

/** Builds OpenCode SDK prompt parts while preserving ChisaCode attachment semantics. */
export function buildOpenCodePromptParts(
  prompt: AgentPromptInput,
): Array<OpenCodeTextPartInput | OpenCodeFilePartInput> {
  if (typeof prompt === "string") {
    return [{ type: "text", text: prompt }];
  }
  let attachmentOrdinal = 0;
  const output: Array<OpenCodeTextPartInput | OpenCodeFilePartInput> = [];
  for (const part of prompt) {
    if (part.type === "text") {
      output.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "image") {
      attachmentOrdinal += 1;
      const normalized = toOpenCodeDataUrl(part.mimeType, part.data);
      output.push({
        type: "file",
        mime: normalized.mimeType,
        filename: `attachment-${attachmentOrdinal}.${getOpenCodeAttachmentExtension(
          normalized.mimeType,
        )}`,
        url: normalized.url,
      });
      continue;
    }
    output.push({ type: "text", text: renderPromptAttachmentAsText(part) });
  }
  return output;
}

/** Builds the user-message text mirrored into the ChisaCode timeline. */
export function buildOpenCodeUserTimelineText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") {
    return prompt;
  }
  return prompt
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      if (part.type === "image") {
        return "[Image]";
      }
      return renderPromptAttachmentAsText(part);
    })
    .filter((text) => text.trim().length > 0)
    .join("\n");
}

/** Owns OpenCode foreground turn preparation, dispatch, and interruption orchestration. */
export class OpenCodeTurnExecution {
  constructor(private readonly options: OpenCodeTurnExecutionOptions) {}

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    return runProviderTurn({
      prompt,
      runOptions: options,
      startTurn: (nextPrompt, nextOptions) => this.startTurn(nextPrompt, nextOptions),
      subscribe: (callback) => this.options.eventBus.subscribe(callback),
      getSessionId: () => this.options.sessionId,
    });
  }

  async interrupt(): Promise<void> {
    const turnId = this.options.eventBus.getActiveTurnId();
    await this.options.abortCoordinator.interruptCurrentTurn(turnId);
    if (!turnId) {
      return;
    }
    this.options.eventStreamController.suppressTerminalUntilUserMessage();
    this.options.eventBus.finish(
      { type: "turn_canceled", provider: "opencode", reason: "interrupted" },
      turnId,
    );
  }

  async startTurn(
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    if (this.options.eventBus.getActiveTurnId()) {
      throw new Error("A foreground turn is already active");
    }
    await this.options.abortCoordinator.awaitPendingBeforeStart();

    this.options.eventBus.prepareTurn();
    this.options.prepareTranslationState({
      prompt,
      contextWindowMaxTokens: this.options.sessionRuntime.getSelectedModelContextWindowMaxTokens(),
    });
    const turnAbortController = this.options.abortCoordinator.beginTurn();
    await this.options.mcpController.ensureConfigured(this.options.config.mcpServers);

    const parts = buildOpenCodePromptParts(prompt);
    const { model, configuredModel, effectiveMode, effectiveVariant } =
      this.options.sessionRuntime.getTurnConfig();

    try {
      await this.options.eventStreamController.ensureReady();
    } catch (error) {
      this.options.abortCoordinator.clearTurn(turnAbortController);
      throw error;
    }

    const turnId = this.options.eventBus.beginTurn();
    const slashCommand = await this.resolveSlashCommandInvocation(prompt);
    if (slashCommand) {
      this.dispatchSlashCommand({
        slashCommand,
        turnId,
        model,
        configuredModel,
        effectiveMode,
        effectiveVariant,
      });
    } else {
      this.dispatchPrompt({
        parts,
        options,
        turnId,
        model,
        effectiveMode,
        effectiveVariant,
      });
    }

    return { turnId };
  }

  private dispatchSlashCommand({
    slashCommand,
    turnId,
    model,
    configuredModel,
    effectiveMode,
    effectiveVariant,
  }: {
    slashCommand: { commandName: string; args?: string };
    turnId: string;
    model: { providerID: string; modelID: string } | undefined;
    configuredModel: string | undefined;
    effectiveMode: string;
    effectiveVariant: string | undefined;
  }): void {
    if (slashCommand.commandName === "compact" || slashCommand.commandName === "summarize") {
      void this.options.client.session
        .summarize({
          sessionID: this.options.sessionId,
          directory: this.options.config.cwd,
          ...(model ? { providerID: model.providerID, modelID: model.modelID } : {}),
        })
        .then((response) => {
          if (response.error) {
            this.options.eventBus.finish(
              {
                type: "turn_failed",
                provider: "opencode",
                error: toDiagnosticErrorMessage(response.error),
              },
              turnId,
            );
          } else {
            this.options.eventBus.finish(
              { type: "turn_completed", provider: "opencode", usage: undefined },
              turnId,
            );
          }
          return;
        })
        .catch((error) => {
          this.options.eventBus.finish(
            {
              type: "turn_failed",
              provider: "opencode",
              error: toDiagnosticErrorMessage(error),
            },
            turnId,
          );
        });
      return;
    }

    // command() only acknowledges dispatch. SSE remains the turn terminal source of truth.
    void this.options.client.session
      .command({
        sessionID: this.options.sessionId,
        directory: this.options.config.cwd,
        command: slashCommand.commandName,
        arguments: slashCommand.args ?? "",
        ...(configuredModel ? { model: configuredModel } : {}),
        ...(effectiveMode ? { agent: effectiveMode } : {}),
        ...(effectiveVariant ? { variant: effectiveVariant } : {}),
      })
      .then((response) => {
        if (!response.error) {
          return;
        }
        if (isOpenCodeHeadersTimeoutFailure(response.error)) {
          this.logSlashCommandHeaderTimeout(response.error, slashCommand.commandName, turnId);
          return;
        }
        this.options.eventBus.finish(
          {
            type: "turn_failed",
            provider: "opencode",
            error: toDiagnosticErrorMessage(response.error),
          },
          turnId,
        );
        return;
      })
      .catch((error) => {
        if (isOpenCodeHeadersTimeoutFailure(error)) {
          this.logSlashCommandHeaderTimeout(error, slashCommand.commandName, turnId);
          return;
        }
        this.options.eventBus.finish(
          {
            type: "turn_failed",
            provider: "opencode",
            error: toDiagnosticErrorMessage(error),
          },
          turnId,
        );
      });
  }

  private dispatchPrompt({
    parts,
    options,
    turnId,
    model,
    effectiveMode,
    effectiveVariant,
  }: {
    parts: Array<OpenCodeTextPartInput | OpenCodeFilePartInput>;
    options: AgentRunOptions | undefined;
    turnId: string;
    model: { providerID: string; modelID: string } | undefined;
    effectiveMode: string;
    effectiveVariant: string | undefined;
  }): void {
    // The async boundary catches synchronous SDK input validation throws and async rejections.
    void (async () => {
      this.options.trace("provider.opencode.prompt_async.start", {
        turnId,
        sessionId: this.options.sessionId,
        model,
        effectiveMode,
        effectiveVariant,
        partTypes: parts.map((part) => part.type),
      });
      try {
        const systemPrompt = composeSystemPromptParts(
          this.options.config.systemPrompt,
          this.options.config.daemonAppendSystemPrompt,
        );
        const promptResponse = await this.options.client.session.promptAsync({
          sessionID: this.options.sessionId,
          directory: this.options.config.cwd,
          parts,
          ...(options?.outputSchema
            ? {
                format: {
                  type: "json_schema" as const,
                  schema: options.outputSchema as Record<string, unknown>,
                },
              }
            : {}),
          ...(systemPrompt ? { system: systemPrompt } : {}),
          ...(model ? { model } : {}),
          ...(effectiveMode ? { agent: effectiveMode } : {}),
          ...(effectiveVariant ? { variant: effectiveVariant } : {}),
        });
        this.options.trace("provider.opencode.prompt_async.response", {
          turnId,
          hasError: promptResponse.error !== undefined,
          error: promptResponse.error,
          data: promptResponse.data,
        });
        if (promptResponse.error) {
          this.options.eventBus.finish(
            {
              type: "turn_failed",
              provider: "opencode",
              error: toDiagnosticErrorMessage(promptResponse.error),
            },
            turnId,
          );
        }
      } catch (error) {
        this.options.trace("provider.opencode.prompt_async.throw", {
          turnId,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        this.options.eventBus.finish(
          {
            type: "turn_failed",
            provider: "opencode",
            error: toDiagnosticErrorMessage(error),
          },
          turnId,
        );
      }
    })();
  }

  private parseSlashCommandInput(text: string): { commandName: string; args?: string } | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/") || trimmed.length <= 1) {
      return null;
    }
    const withoutPrefix = trimmed.slice(1);
    const firstWhitespaceIdx = withoutPrefix.search(/\s/);
    const commandName =
      firstWhitespaceIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, firstWhitespaceIdx);
    if (!commandName || commandName.includes("/")) {
      return null;
    }
    const rawArgs =
      firstWhitespaceIdx === -1 ? "" : withoutPrefix.slice(firstWhitespaceIdx + 1).trim();
    return rawArgs.length > 0 ? { commandName, args: rawArgs } : { commandName };
  }

  private async resolveSlashCommandInvocation(
    prompt: AgentPromptInput,
  ): Promise<{ commandName: string; args?: string } | null> {
    if (typeof prompt !== "string") {
      return null;
    }
    const parsed = this.parseSlashCommandInput(prompt);
    if (!parsed) {
      return null;
    }
    try {
      const commands = await this.options.sessionRuntime.listCommands();
      return commands.some((command) => command.name === parsed.commandName) ? parsed : null;
    } catch (error) {
      this.options.logger.warn(
        { err: error, commandName: parsed.commandName },
        "Failed to resolve slash command; falling back to plain prompt input",
      );
      return null;
    }
  }

  private logSlashCommandHeaderTimeout(error: unknown, commandName: string, turnId: string): void {
    this.options.logger.warn(
      { err: error, commandName, turnId },
      "OpenCode slash command hit a header timeout; waiting for SSE terminal event",
    );
  }
}
