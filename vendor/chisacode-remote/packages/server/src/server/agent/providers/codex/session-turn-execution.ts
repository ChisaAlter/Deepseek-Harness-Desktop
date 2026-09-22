import type { Logger } from "pino";

import type {
  AgentPromptInput,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeInfo,
  AgentSessionConfig,
  AgentStreamEvent,
} from "../../agent-sdk-types.js";
import { composeSystemPromptParts } from "../../system-prompt.js";
import { runProviderTurn } from "../provider-runner.js";
import type { CodexPromptInput } from "./session-commands.js";
import type { ResolvedCodexCollaborationMode } from "./session-metadata.js";
import {
  buildRuntimeModelIdentityInstructions,
  type CodexCustomProvider,
} from "./runtime-config.js";
import { buildCodexTurnStartParams } from "./turn-config.js";

const TURN_START_TIMEOUT_MS = 90 * 1000;
const INTERRUPT_TIMEOUT_MS = 2_000;

interface CodexTurnClient {
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
}

interface CodexSessionTurnExecutionOptions {
  logger: Logger;
  getClient: () => CodexTurnClient | null;
  connect: () => Promise<void>;
  getThreadId: () => string | null;
  ensureThreadLoaded: () => Promise<void>;
  ensureThread: () => Promise<void>;
  resolvePrompt: (prompt: AgentPromptInput) => Promise<CodexPromptInput>;
  buildUserInput: (prompt: CodexPromptInput) => Promise<unknown>;
  getConfig: () => AgentSessionConfig;
  getMode: () => string;
  getServiceTier: () => "fast" | null;
  getCollaborationMode: () => ResolvedCodexCollaborationMode | null;
  getCodexConfig: () => Record<string, unknown> | null;
  customProvider?: CodexCustomProvider;
  subscribe: (callback: (event: AgentStreamEvent) => void) => () => void;
  getRuntimeInfo: () => Promise<AgentRuntimeInfo>;
}

/** Owns Codex foreground turn state and turn start/interrupt orchestration. */
export class CodexSessionTurnExecution {
  private currentTurnId: string | null = null;
  private activeForegroundTurnId: string | null = null;
  private nextTurnOrdinal = 0;

  constructor(private readonly options: CodexSessionTurnExecutionOptions) {}

  getCurrentTurnId(): string | null {
    return this.currentTurnId;
  }

  setCurrentTurnId(turnId: string | null): void {
    this.currentTurnId = turnId;
  }

  getActiveForegroundTurnId(): string | null {
    return this.activeForegroundTurnId;
  }

  setActiveForegroundTurnId(turnId: string | null): void {
    this.activeForegroundTurnId = turnId;
  }

  clearActiveForegroundTurn(): void {
    this.activeForegroundTurnId = null;
  }

  async run(prompt: AgentPromptInput, options?: AgentRunOptions): Promise<AgentRunResult> {
    return runProviderTurn({
      prompt,
      runOptions: options,
      startTurn: (nextPrompt, nextOptions) => this.startTurn(nextPrompt, nextOptions),
      subscribe: this.options.subscribe,
      getSessionId: async () => (await this.options.getRuntimeInfo()).sessionId ?? "",
      reduceFinalText: ({ current, item }) => {
        if (item.type === "assistant_message") {
          return item.text;
        }
        if (item.type === "tool_call" && item.detail.type === "plan") {
          return item.detail.text;
        }
        return current;
      },
    });
  }

  async startTurn(
    prompt: AgentPromptInput,
    options?: AgentRunOptions,
  ): Promise<{ turnId: string }> {
    if (this.activeForegroundTurnId) {
      throw new Error("A foreground turn is already active");
    }

    await this.options.connect();
    if (!this.options.getClient()) {
      throw new Error("Codex client not initialized");
    }

    const effectivePrompt = await this.options.resolvePrompt(prompt);
    if (this.options.getThreadId()) {
      await this.options.ensureThreadLoaded();
    } else {
      await this.options.ensureThread();
    }

    const turnStart = await this.buildTurnStartParams(effectivePrompt, options);
    const client = this.options.getClient();
    if (!client) {
      throw new Error("Codex client not initialized");
    }
    const turnId = this.createTurnId();
    this.activeForegroundTurnId = turnId;

    try {
      this.logTurnStartSummary({
        turnId,
        thinkingOptionId: turnStart.thinkingOptionId,
        approvalPolicy: turnStart.approvalPolicy,
        sandboxPolicyType: turnStart.sandboxPolicyType,
        hasOutputSchema: turnStart.hasOutputSchema,
        hasDeveloperInstructions: turnStart.hasDeveloperInstructions,
        hasCodexConfig: turnStart.hasCodexConfig,
      });
      await client.request("turn/start", turnStart.params, TURN_START_TIMEOUT_MS);
    } catch (error) {
      this.activeForegroundTurnId = null;
      throw error;
    }

    return { turnId };
  }

  async interrupt(): Promise<void> {
    const client = this.options.getClient();
    const threadId = this.options.getThreadId();
    if (!client || !threadId || !this.currentTurnId) return;
    try {
      await client.request(
        "turn/interrupt",
        { threadId, turnId: this.currentTurnId },
        INTERRUPT_TIMEOUT_MS,
      );
    } catch (error) {
      this.options.logger.warn({ error }, "Failed to interrupt Codex turn");
    }
  }

  reset(): void {
    this.activeForegroundTurnId = null;
    this.currentTurnId = null;
  }

  private async buildTurnStartParams(prompt: CodexPromptInput, options?: AgentRunOptions) {
    const config = this.options.getConfig();
    const userInput = await this.options.buildUserInput(prompt);
    const developerInstructions = composeSystemPromptParts(
      config.systemPrompt,
      config.daemonAppendSystemPrompt,
      buildRuntimeModelIdentityInstructions(config, this.options.customProvider),
    );
    return buildCodexTurnStartParams({
      threadId: this.options.getThreadId(),
      userInput,
      modeId: this.options.getMode(),
      config,
      serviceTier: this.options.getServiceTier(),
      collaborationMode: this.options.getCollaborationMode(),
      outputSchema: options?.outputSchema,
      developerInstructions,
      codexConfig: this.options.getCodexConfig(),
    });
  }

  private createTurnId(): string {
    return `codex-turn-${this.nextTurnOrdinal++}`;
  }

  private logTurnStartSummary({
    turnId,
    thinkingOptionId,
    approvalPolicy,
    sandboxPolicyType,
    hasOutputSchema,
    hasDeveloperInstructions,
    hasCodexConfig,
  }: {
    turnId: string;
    thinkingOptionId?: string;
    approvalPolicy: string;
    sandboxPolicyType: string;
    hasOutputSchema: boolean;
    hasDeveloperInstructions: boolean;
    hasCodexConfig: boolean;
  }): void {
    const config = this.options.getConfig();
    this.options.logger.info(
      {
        turnId,
        threadId: this.options.getThreadId(),
        model: config.model ?? null,
        modeId: this.options.getMode(),
        effort: thinkingOptionId ?? null,
        serviceTier: this.options.getServiceTier(),
        cwd: config.cwd ?? null,
        approvalPolicy,
        sandboxPolicyType,
        hasCollaborationMode: Boolean(this.options.getCollaborationMode()),
        hasOutputSchema,
        hasDeveloperInstructions,
        hasCodexConfig,
      },
      "Starting Codex app-server turn",
    );
  }
}
