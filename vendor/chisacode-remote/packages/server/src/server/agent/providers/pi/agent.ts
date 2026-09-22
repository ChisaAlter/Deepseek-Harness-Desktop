import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";

import {
  type AgentCapabilityFlags,
  type AgentClient,
  type AgentLaunchContext,
  type AgentMode,
  type AgentModelDefinition,
  type AgentPermissionRequest,
  type AgentPermissionResponse,
  type AgentPersistenceHandle,
  type AgentPromptInput,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentRuntimeInfo,
  type AgentSession,
  type AgentSessionConfig,
  type AgentSlashCommand,
  type AgentStreamEvent,
  type ListPersistedAgentsOptions,
  type ListModesOptions,
  type ListModelsOptions,
  type PersistedAgentDescriptor,
} from "../../agent-sdk-types.js";
import { runProviderTurn } from "../provider-runner.js";
import {
  checkProviderLaunchAvailable,
  resolveProviderLaunch,
  type ProviderRuntimeSettings,
  type ResolvedProviderLaunch,
} from "../../provider-launch-config.js";
import { renderPromptAttachmentAsText } from "../../prompt-attachments.js";
import { withTimeout } from "../../../../utils/promise-timeout.js";
import {
  buildBinaryDiagnosticRows,
  formatDiagnosticStatus,
  formatProviderDiagnostic,
  formatProviderDiagnosticError,
  toDiagnosticErrorMessage,
} from "../diagnostic-utils.js";
import { streamPiHistory } from "./history-mapper.js";
import { PiExtensionHistoryController } from "./extension-history-controller.js";
import {
  isPiMcpAdapterCommand,
  PiSessionLifecycle,
  type PiSessionInitialization,
} from "./session-lifecycle.js";
import {
  DEFAULT_PI_THINKING_LEVEL,
  PiSessionRuntimeController,
  readRuntimeModelPrefix,
} from "./session-runtime.js";
import { PiSessionEventController } from "./session-event-controller.js";
import { PiCliRuntime } from "./cli-runtime.js";
import { revertPiConversation } from "./rewind.js";
import type { PiRuntime, PiRuntimeSession } from "./runtime.js";
import type { PiAgentMessage, PiImageContent, PiModel, PiThinkingLevel } from "./rpc-types.js";

const PI_PROVIDER = "pi";
function resolvePiDefaultBinary(): string {
  return process.env.PI_COMMAND ?? process.env.PI_ACP_PI_COMMAND ?? "pi";
}

const PI_CAPABILITIES: AgentCapabilityFlags = {
  supportsStreaming: true,
  supportsSessionPersistence: true,
  supportsDynamicModes: true,
  supportsMcpServers: false,
  supportsReasoningStream: true,
  supportsToolInvocations: true,
  supportsRewindConversation: true,
  supportsRewindFiles: false,
  supportsRewindBoth: false,
};

const PI_THINKING_OPTIONS: ReadonlyArray<{
  id: PiThinkingLevel;
  label: string;
  description: string;
  isDefault?: boolean;
}> = [
  { id: "off", label: "Off", description: "No extra reasoning" },
  { id: "minimal", label: "Minimal", description: "Light reasoning" },
  { id: "low", label: "Low", description: "Faster reasoning" },
  { id: "medium", label: "Medium", description: "Balanced reasoning", isDefault: true },
  { id: "high", label: "High", description: "Deeper reasoning" },
  { id: "xhigh", label: "XHigh", description: "Maximum reasoning" },
] as const;

interface PiRpcAgentClientOptions {
  logger: Logger;
  runtimeSettings?: ProviderRuntimeSettings;
  runtime?: PiRuntime;
}

interface PiPromptPayload {
  text: string;
  images?: PiImageContent[];
}

interface StartTurnResult {
  turnId: string;
}

type PiRpcAgentSessionOptions = PiSessionInitialization;

function normalizePiModelLabel(label: string): string {
  return label.trim().replace(/[_\s]+/g, " ");
}

export function transformPiModels(models: AgentModelDefinition[]): AgentModelDefinition[] {
  return models.map((model) => {
    if (!model.label.includes("/")) {
      return model;
    }

    const segments = model.label.split("/").filter((segment) => segment.length > 0);
    const rawLabel = segments.at(-1);
    if (!rawLabel) {
      return model;
    }

    return {
      ...model,
      label: normalizePiModelLabel(rawLabel),
      description: model.description ?? model.label,
    };
  });
}

function mapThinkingOption(option: (typeof PI_THINKING_OPTIONS)[number]) {
  const mappedOption = {
    id: option.id,
    label: option.label,
    description: option.description,
  };
  if (option.isDefault) {
    return {
      ...mappedOption,
      isDefault: true,
    };
  }
  return mappedOption;
}

function convertPromptInput(prompt: AgentPromptInput): PiPromptPayload {
  if (typeof prompt === "string") {
    return { text: prompt };
  }

  const textParts: string[] = [];
  const images: PiImageContent[] = [];

  for (const block of prompt) {
    if (block.type === "text") {
      textParts.push(block.text);
      continue;
    }

    if (block.type === "image") {
      images.push({
        type: "image",
        data: block.data,
        mimeType: block.mimeType,
      });
      continue;
    }

    textParts.push(renderPromptAttachmentAsText(block));
  }

  const payload: PiPromptPayload = {
    text: textParts.join("\n\n"),
  };
  if (images.length > 0) {
    payload.images = images;
  }
  return payload;
}

function isPiRequestAbortError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }

  return /\brequest was aborted\b|\babort(ed)?\b/i.test(toDiagnosticErrorMessage(error));
}

function isPiStreamingBehaviorRequiredError(error: unknown): boolean {
  return /streamingBehavior/i.test(toDiagnosticErrorMessage(error));
}

const PI_IDLE_POLL_INTERVAL_MS = 50;
const PI_IDLE_WAIT_TIMEOUT_MS = 2_000;

/**
 * Wait until Pi reports it is no longer streaming (best-effort).
 * Used after abort so a replacement prompt is not rejected while Pi is still
 * finishing the previous stream, and so we can fall back cleanly if polling fails.
 */
async function waitForPiIdle(
  runtimeSession: Pick<PiRuntimeSession, "getState">,
  timeoutMs = PI_IDLE_WAIT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = await runtimeSession.getState();
      if (!state.isStreaming) {
        return;
      }
    } catch {
      // getState can fail during process teardown; keep trying until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, PI_IDLE_POLL_INTERVAL_MS));
  }
}

function piAssistantText(message: Extract<PiAgentMessage, { role: "assistant" }>): string | null {
  const text = message.content
    .flatMap((part) => {
      if (part.type === "text") {
        return [part.text];
      }
      if (part.type === "thinking") {
        return [part.thinking];
      }
      return [];
    })
    .join("\n\n")
    .trim();
  return text.length > 0 ? text : null;
}

function formatPiErrorMessage(message: Extract<PiAgentMessage, { role: "assistant" }>): string {
  const headline = message.errorMessage?.trim() || "Pi turn failed";
  const details = [
    message.stopReason ? `stopReason=${message.stopReason}` : null,
    message.provider && message.model ? `model=${message.provider}/${message.model}` : null,
    message.responseModel ? `responseModel=${message.responseModel}` : null,
    message.responseId ? `responseId=${message.responseId}` : null,
  ].filter((detail): detail is string => detail !== null);
  const partialText = piAssistantText(message);
  if (partialText) {
    details.push(`partial=${JSON.stringify(partialText.slice(0, 500))}`);
  }
  return details.length > 0 ? `${headline} (${details.join(", ")})` : headline;
}

function latestPiErrorMessage(messages: PiAgentMessage[]): string | null {
  const latestAssistant = messages.findLast((message) => message.role === "assistant");
  if (!latestAssistant || !latestAssistant.errorMessage?.trim()) {
    return null;
  }
  return formatPiErrorMessage(latestAssistant);
}

function mapPiModel(model: PiModel): AgentModelDefinition {
  return {
    provider: PI_PROVIDER,
    id: `${model.provider}/${model.id}`,
    label: `${model.provider}/${model.name ?? model.id}`,
    description: `${model.provider}/${model.id}`,
    metadata: {
      provider: model.provider,
      modelId: model.id,
    },
    thinkingOptions: model.reasoning ? PI_THINKING_OPTIONS.map(mapThinkingOption) : undefined,
    defaultThinkingOptionId: model.reasoning ? DEFAULT_PI_THINKING_LEVEL : undefined,
  };
}

function createRuntime(logger: Logger, runtimeSettings?: ProviderRuntimeSettings): PiRuntime {
  return new PiCliRuntime({ logger, runtimeSettings });
}

export class PiRpcAgentSession implements AgentSession {
  readonly provider = PI_PROVIDER;
  readonly capabilities: AgentCapabilityFlags;

  private readonly subscribers = new Set<(event: AgentStreamEvent) => void>();
  private readonly extensionHistory: PiExtensionHistoryController;
  private readonly sessionEvents: PiSessionEventController;
  private readonly sessionRuntime: PiSessionRuntimeController;
  constructor(options: PiRpcAgentSessionOptions) {
    this.runtimeSession = options.runtimeSession;
    this.capabilities = options.capabilities;
    this.logger = options.logger;
    this.sessionRuntime = new PiSessionRuntimeController({
      ...options,
      emit: (event) => this.emit(event),
    });
    this.extensionHistory = new PiExtensionHistoryController({
      runtimeSession: this.runtimeSession,
      emit: (event) => this.emit(event),
    });
    this.sessionEvents = new PiSessionEventController({
      runtimeSession: this.runtimeSession,
      extensionHistory: this.extensionHistory,
      emit: (event) => this.emit(event),
      getSessionId: () => this.sessionRuntime.sessionId,
      resolveTurnError: latestPiErrorMessage,
      onTurnCompleted: (turnId) => void this.sessionRuntime.refreshAfterTurn(turnId),
    });

    this.runtimeSession.onEvent((event) => {
      this.sessionEvents.handleRuntimeEvent(event);
    });
  }

  private readonly runtimeSession: PiRuntimeSession;
  private readonly logger: Logger;

  get id(): string | null {
    return this.sessionRuntime.sessionId;
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    return runProviderTurn({
      prompt,
      runOptions: options,
      startTurn: (p, o) => this.startTurn(p, o),
      subscribe: (callback) => this.subscribe(callback),
      getSessionId: () => this.sessionRuntime.sessionId,
      reduceFinalText: ({ current, item }) =>
        item.type === "assistant_message" ? `${current}${item.text}` : current,
    });
  }

  async startTurn(prompt: AgentPromptInput, _options?: AgentRunOptions): Promise<StartTurnResult> {
    const payload = convertPromptInput(prompt);
    const activeTurnId = this.sessionEvents.activeTurnId;

    // Pi can still be streaming after our local turn bookkeeping desyncs, and
    // concurrent user messages must queue with streamingBehavior instead of failing.
    if (activeTurnId) {
      await this.promptWithStreamingFallback(payload, "followUp");
      return { turnId: activeTurnId };
    }

    const turnId = randomUUID();
    this.sessionEvents.beginTurn(turnId);

    void this.promptWithStreamingFallback(payload, "followUp").catch((error) => {
      const failedTurnId = this.sessionEvents.activeTurnId ?? turnId;
      if (isPiRequestAbortError(error)) {
        this.sessionEvents.finishTurn({
          type: "turn_canceled",
          provider: PI_PROVIDER,
          turnId: failedTurnId,
          reason: toDiagnosticErrorMessage(error),
        });
        return;
      }
      this.sessionEvents.finishTurn({
        type: "turn_failed",
        provider: PI_PROVIDER,
        turnId: failedTurnId,
        error: toDiagnosticErrorMessage(error),
      });
    });

    return { turnId };
  }

  /**
   * Send a prompt with streamingBehavior so Pi can queue while streaming.
   * Retries once with followUp if an older Pi still rejects without the field
   * (defensive — cli-runtime always includes the field).
   */
  private async promptWithStreamingFallback(
    payload: PiPromptPayload,
    streamingBehavior: "steer" | "followUp",
  ): Promise<void> {
    try {
      await this.runtimeSession.prompt(payload.text, {
        images: payload.images,
        streamingBehavior,
      });
    } catch (error) {
      if (!isPiStreamingBehaviorRequiredError(error)) {
        throw error;
      }
      // Race: Pi still streaming but first attempt lacked/lost the field.
      await this.runtimeSession.prompt(payload.text, {
        images: payload.images,
        streamingBehavior: "followUp",
      });
    }
  }

  subscribe(callback: (event: AgentStreamEvent) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async *streamHistory(): AsyncGenerator<AgentStreamEvent> {
    await this.extensionHistory.capture("history");
    yield* streamPiHistory(
      PI_PROVIDER,
      await this.runtimeSession.getMessages(),
      this.extensionHistory.entries,
    );
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    return this.sessionRuntime.getRuntimeInfo();
  }

  async getAvailableModes(): Promise<AgentMode[]> {
    return [];
  }

  async getCurrentMode(): Promise<string | null> {
    return null;
  }

  async setMode(modeId: string): Promise<void> {
    void modeId;
    throw new Error("Pi does not expose selectable modes");
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return this.sessionEvents.getPendingPermissions();
  }

  async respondToPermission(requestId: string, response: AgentPermissionResponse): Promise<void> {
    await this.sessionEvents.respondToPermission(requestId, response);
  }

  describePersistence(): AgentPersistenceHandle | null {
    return this.sessionRuntime.describePersistence();
  }

  async interrupt(): Promise<void> {
    const activeTurnId = this.sessionEvents.activeTurnId;
    try {
      await withTimeout(
        this.runtimeSession.abort(),
        PI_IDLE_WAIT_TIMEOUT_MS,
        `Timed out aborting Pi turn after ${PI_IDLE_WAIT_TIMEOUT_MS}ms`,
      );
    } catch (error) {
      if (activeTurnId) {
        this.sessionEvents.finishTurn({
          type: "turn_canceled",
          provider: PI_PROVIDER,
          turnId: activeTurnId,
          reason: toDiagnosticErrorMessage(error),
        });
      }
      throw error;
    }
    await waitForPiIdle(this.runtimeSession);
    if (activeTurnId && this.sessionEvents.activeTurnId === activeTurnId) {
      this.sessionEvents.finishTurn({
        type: "turn_canceled",
        provider: PI_PROVIDER,
        turnId: activeTurnId,
        reason: "Interrupted by user",
      });
    }
  }

  async revertConversation(input: { messageId: string }): Promise<void> {
    if (this.sessionEvents.activeTurnId) {
      throw new Error("Cannot rewind the Pi conversation while a Pi turn is active");
    }
    await this.sessionRuntime.refreshState().catch((err) => {
      this.logger.warn({ err }, "Pi refreshState failed before rewind");
    });
    await this.extensionHistory.capture("rewind");
    if (!this.extensionHistory.getEntry(input.messageId)) {
      throw new Error(`Pi rewind target ${input.messageId} was not found in captured tree entries`);
    }
    await revertPiConversation({
      messageId: input.messageId,
      navigator: {
        navigateTree: (treeEntryId) => this.extensionHistory.navigateTree(treeEntryId),
      },
    });
    this.sessionEvents.clearToolCalls();
  }

  async close(): Promise<void> {
    await this.sessionRuntime.close(() => {
      this.sessionEvents.close(new Error("Pi session closed"));
    });
  }

  async listCommands(): Promise<AgentSlashCommand[]> {
    const commands = await this.runtimeSession.getCommands();
    return commands.map((command) => ({
      name: command.name,
      description: command.description ?? command.source,
      argumentHint: "",
    }));
  }

  async setModel(modelId: string | null): Promise<void> {
    await this.sessionRuntime.setModel(modelId);
  }

  async setThinkingOption(thinkingOptionId: string | null): Promise<void> {
    await this.sessionRuntime.setThinkingOption(thinkingOptionId);
  }

  private emit(event: AgentStreamEvent): void {
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }
}

export class PiRpcAgentClient implements AgentClient {
  readonly provider = PI_PROVIDER;
  readonly capabilities = PI_CAPABILITIES;

  private readonly logger: Logger;
  private readonly runtimeSettings?: ProviderRuntimeSettings;
  private readonly runtime: PiRuntime;
  private readonly sessionLifecycle: PiSessionLifecycle;

  constructor(options: PiRpcAgentClientOptions) {
    this.logger = options.logger;
    this.runtimeSettings = options.runtimeSettings;
    this.runtime = options.runtime ?? createRuntime(options.logger, options.runtimeSettings);
    this.sessionLifecycle = new PiSessionLifecycle({
      runtime: this.runtime,
      logger: this.logger,
      modelPrefix: readRuntimeModelPrefix(this.runtimeSettings),
      baseCapabilities: PI_CAPABILITIES,
    });
  }

  async createSession(
    config: AgentSessionConfig,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    return new PiRpcAgentSession(await this.sessionLifecycle.createSession(config, launchContext));
  }

  async resumeSession(
    handle: AgentPersistenceHandle,
    overrides?: Partial<AgentSessionConfig>,
    launchContext?: AgentLaunchContext,
  ): Promise<AgentSession> {
    return new PiRpcAgentSession(
      await this.sessionLifecycle.resumeSession(handle, overrides, launchContext),
    );
  }

  async listModels(options: ListModelsOptions): Promise<AgentModelDefinition[]> {
    const runtimeSession = await this.runtime.startSession({ cwd: options.cwd });
    try {
      return transformPiModels((await runtimeSession.getAvailableModels()).map(mapPiModel));
    } finally {
      await runtimeSession.close();
    }
  }

  async listModes(_options: ListModesOptions): Promise<AgentMode[]> {
    return [];
  }

  async listPersistedAgents(
    _options?: ListPersistedAgentsOptions,
  ): Promise<PersistedAgentDescriptor[]> {
    return [];
  }

  async isAvailable(): Promise<boolean> {
    const launch = await this.resolvePiLaunch();
    const availability = await checkProviderLaunchAvailable(launch);
    // Availability answers whether the configured Pi executable can be launched.
    // Authentication and model discovery are independent runtime concerns and
    // are reported by listModels()/diagnostics instead of hiding the provider.
    return availability.available;
  }

  async getDiagnostic(): Promise<{ diagnostic: string }> {
    try {
      const launch = await this.resolvePiLaunch();
      const availability = await checkProviderLaunchAvailable(launch);
      const available = availability.available;
      const authConfigPath = join(homedir(), ".pi", "agent", "auth.json");
      let modelsValue = "Not checked";
      let configuredProvidersValue = "none";
      let mcpToolsValue = "Not checked";
      let status = formatDiagnosticStatus(available);

      if (availability.available) {
        const runtimeSession = await this.runtime
          .startSession({ cwd: homedir() })
          .catch((error) => {
            status = formatDiagnosticStatus(false, {
              source: "startup",
              cause: error,
            });
            return null;
          });
        if (runtimeSession) {
          try {
            const models = await runtimeSession.getAvailableModels();
            modelsValue = String(models.length);
            const configuredProviders = Array.from(
              new Set(models.map((model) => model.provider)),
            ).sort();
            configuredProvidersValue =
              configuredProviders.length > 0 ? configuredProviders.join(", ") : "none";
            const commands = await runtimeSession.getCommands();
            mcpToolsValue = commands.some(isPiMcpAdapterCommand)
              ? "yes (pi-mcp-adapter loaded)"
              : "no (install pi-mcp-adapter)";
          } catch (error) {
            modelsValue = `Error - ${toDiagnosticErrorMessage(error)}`;
            mcpToolsValue = `Error - ${toDiagnosticErrorMessage(error)}`;
            status = formatDiagnosticStatus(available, {
              source: "model fetch",
              cause: error,
            });
          } finally {
            await runtimeSession.close().catch(() => undefined);
          }
        }
      }

      return {
        diagnostic: formatProviderDiagnostic("Pi", [
          ...(await buildBinaryDiagnosticRows(launch, availability)),
          { label: "Configured providers", value: configuredProvidersValue },
          {
            label: "Auth config (~/.pi/agent/auth.json)",
            value: existsSync(authConfigPath) ? "found" : "not found",
          },
          { label: "Models", value: modelsValue },
          { label: "ChisaCode MCP tools", value: mcpToolsValue },
          { label: "Status", value: status },
        ]),
      };
    } catch (error) {
      this.logger.debug({ err: error }, "Pi diagnostic lookup failed");
      return {
        diagnostic: formatProviderDiagnosticError("Pi", error),
      };
    }
  }

  private async resolvePiLaunch(): Promise<ResolvedProviderLaunch> {
    return resolveProviderLaunch({
      commandConfig: this.runtimeSettings?.command,
      defaultBinary: resolvePiDefaultBinary(),
    });
  }
}
