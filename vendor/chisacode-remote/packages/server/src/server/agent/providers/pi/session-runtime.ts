import type { Logger } from "pino";

import type {
  AgentPersistenceHandle,
  AgentRuntimeInfo,
  AgentSessionConfig,
  AgentStreamEvent,
  AgentUsage,
} from "../../agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import type { PiSessionState, PiSessionStats, PiThinkingLevel } from "./rpc-types.js";
import type { PiRuntimeSession } from "./runtime.js";

export const DEFAULT_PI_THINKING_LEVEL: PiThinkingLevel = "medium";
const CHISACODE_MODEL_PREFIX_ENV = "CHISACODE_MODEL_PREFIX";

interface PiModelReference {
  provider?: string;
  id: string;
}

export function readRuntimeModelPrefix(
  runtimeSettings: ProviderRuntimeSettings | undefined,
): string | null {
  const prefix = runtimeSettings?.env?.[CHISACODE_MODEL_PREFIX_ENV]?.trim();
  return prefix ? prefix : null;
}

export function applyRuntimeModelPrefix(
  model: string | undefined,
  prefix: string | null,
): string | undefined {
  if (!model || !prefix || model.includes("/") || model.includes(":")) {
    return model;
  }
  return `${prefix}/${model}`;
}

function isPiThinkingLevel(value: string | null | undefined): value is PiThinkingLevel {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

export function normalizePiThinkingOption(
  value: string | null | undefined,
): PiThinkingLevel | null {
  if (!value) {
    return null;
  }
  return isPiThinkingLevel(value) ? value : null;
}

function parseModelReference(modelId: string | null): PiModelReference | null {
  if (!modelId) {
    return null;
  }
  if (modelId.includes("/")) {
    const [provider, ...rest] = modelId.split("/");
    const id = rest.join("/");
    if (provider && id) {
      return { provider, id };
    }
  }
  if (modelId.includes(":")) {
    const [provider, ...rest] = modelId.split(":");
    const id = rest.join(":");
    if (provider && id) {
      return { provider, id };
    }
  }
  return { id: modelId };
}

function resolveThinkingOptionId(
  cachedThinkingOptionId: string | null,
  sessionThinkingLevel: PiThinkingLevel,
): PiThinkingLevel | null {
  const currentThinking = cachedThinkingOptionId ?? sessionThinkingLevel;
  return normalizePiThinkingOption(currentThinking);
}

function modelToId(model: PiSessionState["model"]): string | null {
  return model?.provider && model.id ? `${model.provider}/${model.id}` : null;
}

function toAgentUsage(stats: PiSessionStats): AgentUsage | undefined {
  const inputTokens = stats.tokens?.input ?? 0;
  const cachedInputTokens = stats.tokens?.cacheRead ?? 0;
  const outputTokens = stats.tokens?.output ?? 0;
  const totalCostUsd = stats.cost ?? 0;
  const contextWindowMaxTokens = stats.contextUsage?.contextWindow ?? undefined;
  const contextWindowUsedTokens = stats.contextUsage?.tokens ?? undefined;

  if (
    inputTokens === 0 &&
    cachedInputTokens === 0 &&
    outputTokens === 0 &&
    totalCostUsd === 0 &&
    contextWindowMaxTokens === undefined &&
    contextWindowUsedTokens === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalCostUsd,
    ...(typeof contextWindowMaxTokens === "number" ? { contextWindowMaxTokens } : {}),
    ...(typeof contextWindowUsedTokens === "number" ? { contextWindowUsedTokens } : {}),
  };
}

interface PiSessionRuntimeOptions {
  runtimeSession: PiRuntimeSession;
  config: AgentSessionConfig;
  initialState: PiSessionState;
  modelPrefix?: string;
  cleanup?: () => void;
  logger: Logger;
  emit: (event: AgentStreamEvent) => void;
}

export class PiSessionRuntimeController {
  private state: PiSessionState;
  private lastKnownThinkingOptionId: string | null;
  private closed = false;

  constructor(private readonly options: PiSessionRuntimeOptions) {
    this.state = options.initialState;
    this.lastKnownThinkingOptionId =
      normalizePiThinkingOption(options.config.thinkingOptionId) ??
      this.state.thinkingLevel ??
      null;
  }

  get sessionId(): string {
    return this.state.sessionId;
  }

  async getRuntimeInfo(): Promise<AgentRuntimeInfo> {
    await this.refreshState();
    return {
      provider: "pi",
      sessionId: this.state.sessionId,
      model: modelToId(this.state.model),
      thinkingOptionId: resolveThinkingOptionId(
        this.lastKnownThinkingOptionId,
        this.state.thinkingLevel,
      ),
      modeId: null,
    };
  }

  describePersistence(): AgentPersistenceHandle {
    return {
      provider: "pi",
      sessionId: this.state.sessionId,
      nativeHandle: this.state.sessionFile,
      metadata: {
        cwd: this.options.config.cwd,
        ...(this.options.config.model ? { model: this.options.config.model } : {}),
        ...(this.options.config.thinkingOptionId
          ? { thinkingOptionId: this.options.config.thinkingOptionId }
          : {}),
      },
    };
  }

  async setModel(modelId: string | null): Promise<void> {
    const prefixedModelId = applyRuntimeModelPrefix(
      modelId ?? undefined,
      this.options.modelPrefix ?? null,
    );
    const parsedReference = parseModelReference(prefixedModelId ?? null);
    if (!parsedReference) {
      return;
    }
    if (!parsedReference.provider) {
      throw new Error(`Pi model id must include a provider: ${modelId}`);
    }

    const model = await this.options.runtimeSession.setModel(
      parsedReference.provider,
      parsedReference.id,
    );
    this.state = {
      ...this.state,
      model,
    };
    this.options.config.model = `${model.provider}/${model.id}`;
  }

  async setThinkingOption(thinkingOptionId: string | null): Promise<void> {
    const thinkingLevel = normalizePiThinkingOption(thinkingOptionId) ?? DEFAULT_PI_THINKING_LEVEL;
    await this.options.runtimeSession.setThinkingLevel(thinkingLevel);
    this.lastKnownThinkingOptionId = thinkingLevel;
    this.options.config.thinkingOptionId = thinkingLevel;
    this.state = {
      ...this.state,
      thinkingLevel,
    };
  }

  async refreshState(): Promise<void> {
    this.state = await this.options.runtimeSession.getState();
  }

  async refreshAfterTurn(turnId: string | undefined): Promise<void> {
    await this.refreshState().catch((err) => {
      this.options.logger.warn({ err }, "Pi refreshState failed after turn");
    });
    const usage = await this.options.runtimeSession
      .getSessionStats()
      .then(toAgentUsage)
      .catch(() => undefined);
    if (usage) {
      this.options.emit({
        type: "usage_updated",
        provider: "pi",
        turnId,
        usage,
      });
    }
  }

  async close(onClosed: () => void): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      await this.options.runtimeSession.close();
    } finally {
      try {
        onClosed();
      } finally {
        this.options.cleanup?.();
      }
    }
  }
}
