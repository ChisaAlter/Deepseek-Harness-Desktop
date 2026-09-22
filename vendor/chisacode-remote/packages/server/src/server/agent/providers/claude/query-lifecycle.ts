import type { Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";

import { withTimeout } from "../../../../utils/promise-timeout.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import { ClaudeOptionsBuilder, summarizeClaudeOptionsForLog } from "./options-builder.js";
import { claudeQuery, type ClaudeQueryFactory } from "./query.js";
import { runClaudeSdkQueryPump } from "./sdk-pump.js";

const MAX_RECENT_STDERR_CHARS = 4000;
const STDERR_FLUSH_WAIT_MS = 150;
const STDERR_FLUSH_POLL_INTERVAL_MS = 10;
const QUERY_OPERATION_TIMEOUT_MS = 3_000;

/** Pushable async input consumed by the Claude SDK query. */
export interface ClaudeAsyncMessageInput<T> {
  push: (item: T) => void;
  end: () => void;
  iterable: AsyncIterable<T>;
}

interface ClaudeQueryTraceContext {
  agentId?: string;
  provider: "claude";
  sessionId: string | null;
  turnId?: string;
}

interface ClaudeQueryLifecycleOptions {
  logger: Logger;
  optionsBuilder: ClaudeOptionsBuilder;
  runtimeSettings?: ProviderRuntimeSettings;
  launchEnv?: Record<string, string>;
  queryFactory?: ClaudeQueryFactory;
  getTraceContext: () => ClaudeQueryTraceContext;
  onBeforeQueryCreate: () => void;
  onQueryOptionsBuilt: (input: {
    requestedModel: string | null;
    modelGatewayOverrideActive: boolean;
  }) => void;
  handleMissingResumedConversation: (message: SDKMessage, query: Query) => Promise<boolean>;
  routeMessage: (message: SDKMessage) => void;
  failActiveTurns: (errorMessage: string) => void;
  onInterruptStarted: () => void;
}

function errorToMessageString(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

/** Owns Claude query creation, input, pump, restart, interruption, and shutdown state. */
export class ClaudeQueryLifecycle {
  private query: Query | null = null;
  private input: ClaudeAsyncMessageInput<SDKUserMessage> | null = null;
  private pumpPromise: Promise<void> | null = null;
  private restartNeeded = false;
  private recentStderr = "";
  private closed = false;

  constructor(private readonly options: ClaudeQueryLifecycleOptions) {}

  getCurrentQuery(): Query | null {
    return this.query;
  }

  getCurrentInput(): ClaudeAsyncMessageInput<SDKUserMessage> | null {
    return this.input;
  }

  isRestartNeeded(): boolean {
    return this.restartNeeded;
  }

  isClosed(): boolean {
    return this.closed;
  }

  setCurrentQueryForCompatibility(query: Query | null): void {
    this.query = query;
  }

  setCurrentInputForCompatibility(input: ClaudeAsyncMessageInput<SDKUserMessage> | null): void {
    this.input = input;
  }

  setRestartNeeded(restartNeeded: boolean): void {
    this.restartNeeded = restartNeeded;
  }

  async ensureQuery(): Promise<Query> {
    // Require both query and input. Compatibility setters / interrupt recovery
    // can leave query non-null while input is null; returning early in that
    // state makes send() hit `null.push` → "Cannot read properties of null
    // (reading 'push')" which surfaces as a [System Error] timeline message.
    if (this.query && this.input && !this.restartNeeded) {
      return this.query;
    }

    if ((this.restartNeeded || (this.query && !this.input)) && this.query) {
      await this.restartCurrentQuery();
    }
    this.restartNeeded = false;
    this.options.onBeforeQueryCreate();

    const input = createAsyncMessageInput<SDKUserMessage>();
    const builtOptions = await this.options.optionsBuilder.build();
    this.options.onQueryOptionsBuilt({
      requestedModel: builtOptions.requestedModel,
      modelGatewayOverrideActive: builtOptions.modelGatewayOverrideActive,
    });
    this.options.logger.debug(
      { options: summarizeClaudeOptionsForLog(builtOptions.options) },
      "claude query",
    );
    this.input = input;
    this.query = claudeQuery(
      { prompt: input.iterable, options: builtOptions.options },
      {
        runtimeSettings: this.options.runtimeSettings,
        launchEnv: this.options.launchEnv,
        queryFactory: this.options.queryFactory,
      },
    );
    const fastMode = this.options.optionsBuilder.resolveFastModeSetting();
    if (fastMode !== null) {
      await this.query.applyFlagSettings({ fastMode });
    }
    return this.query;
  }

  async ensureFreshQuery(): Promise<Query> {
    if (this.query) {
      this.restartNeeded = true;
    }
    return this.ensureQuery();
  }

  async send(message: SDKUserMessage): Promise<void> {
    await this.ensureQuery();
    // Capture the input stream after ensureQuery so a concurrent restart that
    // nulls `this.input` between the check and push cannot throw TypeError.
    const input = this.input;
    if (!input) {
      throw new Error("Claude session input stream not initialized");
    }
    this.startPump();
    input.push(message);
  }

  private startPump(): void {
    if (this.closed || this.pumpPromise) {
      return;
    }

    const pump = runClaudeSdkQueryPump({
      logger: this.options.logger,
      getTraceContext: this.options.getTraceContext,
      isClosed: () => this.closed,
      ensureQuery: () => this.ensureQuery(),
      isCurrentQuery: (query) => this.query === query,
      handleMissingResumedConversation: this.options.handleMissingResumedConversation,
      routeMessage: this.options.routeMessage,
      failActiveTurns: this.options.failActiveTurns,
      awaitRecentStderrAfterProcessExit: (error) => this.awaitRecentStderrAfterProcessExit(error),
      clearQueryIfCurrent: (query) => this.clearQueryIfCurrent(query),
    }).catch((error) => {
      this.options.logger.trace(
        { ...this.options.getTraceContext(), err: error },
        "provider.claude.query_pump.exit_unexpected",
      );
    });

    this.pumpPromise = pump;
    void pump.finally(() => {
      if (this.pumpPromise === pump) {
        this.pumpPromise = null;
      }
    });
  }

  async interruptActiveTurn(): Promise<void> {
    const queryToInterrupt = this.query;
    if (!queryToInterrupt || typeof queryToInterrupt.interrupt !== "function") {
      this.options.logger.trace(
        this.options.getTraceContext(),
        "provider.claude.interrupt.no_query",
      );
      return;
    }
    this.options.onInterruptStarted();
    await this.settle(queryToInterrupt.interrupt(), "interruptActiveTurn query.interrupt()");
  }

  beginClose(): void {
    this.closed = true;
  }

  async closeTransport(): Promise<void> {
    this.input?.end();
    this.query?.close?.();
    await this.settle(this.query?.interrupt?.(), "close query interrupt");
    await this.settle(this.query?.return?.(), "close query return");
    this.query = null;
    this.input = null;
    this.pumpPromise = null;
    this.restartNeeded = false;
  }

  async invalidateMissingResume(activeQuery: Query): Promise<void> {
    this.input?.end();
    await this.settle(activeQuery.return?.(), "query pump return on missing resumed conversation");
    this.clearQueryIfCurrent(activeQuery);
    this.restartNeeded = false;
  }

  captureStderr(data: string): void {
    const text = data.trim();
    if (!text) {
      return;
    }
    const combined = this.recentStderr ? `${this.recentStderr}\n${text}` : text;
    this.recentStderr = combined.slice(-MAX_RECENT_STDERR_CHARS);
  }

  clearRecentStderr(): void {
    this.recentStderr = "";
  }

  getRecentStderrDiagnostic(): string | undefined {
    return this.recentStderr.trim() || undefined;
  }

  private async settle(promise: Promise<unknown> | undefined, label: string): Promise<void> {
    if (!promise) {
      this.options.logger.trace(
        { ...this.options.getTraceContext(), label },
        "provider.claude.query_operation.skip",
      );
      return;
    }
    const startedAt = Date.now();
    this.options.logger.trace(
      { ...this.options.getTraceContext(), label },
      "provider.claude.query_operation.start",
    );
    try {
      await withTimeout(promise, QUERY_OPERATION_TIMEOUT_MS, "timeout");
      this.options.logger.trace(
        { ...this.options.getTraceContext(), label, durationMs: Date.now() - startedAt },
        "provider.claude.query_operation.settled",
      );
    } catch (error) {
      this.options.logger.warn(
        { err: error, label },
        "Claude query operation did not settle cleanly",
      );
    }
  }

  private async restartCurrentQuery(): Promise<void> {
    const oldQuery = this.query;
    const oldInput = this.input;
    this.query = null;
    this.input = null;
    this.pumpPromise = null;
    this.restartNeeded = false;
    oldInput?.end();
    oldQuery?.close?.();
    try {
      await oldQuery?.return?.();
    } catch {
      /* ignore */
    }
  }

  private clearQueryIfCurrent(query: Query): void {
    if (this.query === query) {
      this.query = null;
      this.input = null;
    }
  }

  private async awaitRecentStderrAfterProcessExit(error: unknown): Promise<void> {
    if (this.getRecentStderrDiagnostic()) {
      return;
    }
    const message = errorToMessageString(error);
    if (
      !/\bprocess exited with code\b/i.test(message) &&
      !/\bterminated by signal\b/i.test(message)
    ) {
      return;
    }

    const startedAt = Date.now();
    while (!this.closed && !this.getRecentStderrDiagnostic()) {
      if (Date.now() - startedAt >= STDERR_FLUSH_WAIT_MS) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, STDERR_FLUSH_POLL_INTERVAL_MS));
    }
  }
}

function createAsyncMessageInput<T>(): ClaudeAsyncMessageInput<T> {
  const queue: T[] = [];
  const resolvers: Array<(value: IteratorResult<T, void>) => void> = [];
  let closed = false;

  return {
    push(item: T) {
      if (closed) {
        return;
      }
      const resolve = resolvers.shift();
      if (resolve) {
        resolve({ value: item, done: false });
        return;
      }
      queue.push(item);
    },
    end() {
      closed = true;
      while (resolvers.length > 0) {
        const resolve = resolvers.shift();
        resolve?.({ value: undefined, done: true });
      }
    },
    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<T, void> {
        return {
          next: (): Promise<IteratorResult<T, void>> => {
            if (queue.length > 0) {
              const value = queue.shift();
              if (value !== undefined) {
                return Promise.resolve({ value, done: false });
              }
            }
            if (closed) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise<IteratorResult<T, void>>((resolve) => {
              resolvers.push(resolve);
            });
          },
        };
      },
    },
  };
}
