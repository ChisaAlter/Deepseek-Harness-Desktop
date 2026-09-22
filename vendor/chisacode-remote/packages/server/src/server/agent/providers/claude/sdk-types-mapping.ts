import type {
  McpServerConfig as ClaudeSdkMcpServerConfig,
  PermissionUpdate,
  SDKTaskProgressMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type {
  AgentMetadata,
  AgentPermissionRequestKind,
  AgentPermissionUpdate,
  McpServerConfig,
} from "../../agent-sdk-types.js";

export interface ClaudeContentChunk {
  type: string;
  [key: string]: unknown;
}

function isMetadata(value: unknown): value is AgentMetadata {
  return typeof value === "object" && value !== null;
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Normalizes ChisaCode question answers into Claude's full-question keyed shape. */
export function normalizeClaudeAskUserQuestionUpdatedInput(
  updatedInput: AgentMetadata | undefined,
  fallbackInput: AgentMetadata | undefined,
): AgentMetadata {
  const fallback = isMetadata(fallbackInput) ? fallbackInput : {};
  const base = isMetadata(updatedInput) ? updatedInput : {};
  const merged = { ...fallback, ...base };
  const questions =
    (Array.isArray(base.questions) ? base.questions : null) ??
    (Array.isArray(fallback.questions) ? fallback.questions : null);
  const answers = isMetadata(base.answers) ? base.answers : null;

  if (!questions || !answers) {
    return merged;
  }

  const normalizedAnswers: Record<string, string> = {};
  for (const item of questions) {
    const question = isMetadata(item) ? item : null;
    if (!question) {
      continue;
    }
    const questionText = readNonEmptyString(question.question);
    if (!questionText) {
      continue;
    }
    const header = readNonEmptyString(question.header);
    const answer =
      readNonEmptyString(answers[questionText]) ??
      (header ? readNonEmptyString(answers[header]) : null);
    if (answer) {
      normalizedAnswers[questionText] = answer;
    }
  }

  if (Object.keys(normalizedAnswers).length === 0) {
    return merged;
  }
  return { ...merged, answers: normalizedAnswers };
}

export function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

export function isImageMimeType(
  value: string,
): value is "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  return (
    value === "image/jpeg" ||
    value === "image/png" ||
    value === "image/gif" ||
    value === "image/webp"
  );
}

export function extractSessionIdRaw(message: {
  session_id?: unknown;
  sessionId?: unknown;
  session?: { id?: unknown } | null;
}): string {
  if (typeof message.session_id === "string") return message.session_id;
  if (typeof message.sessionId === "string") return message.sessionId;
  if (typeof message.session?.id === "string") return message.session.id;
  return "";
}

export function toClaudeSdkMcpConfig(config: McpServerConfig): ClaudeSdkMcpServerConfig {
  switch (config.type) {
    case "stdio":
      return {
        type: "stdio",
        command: config.command,
        args: config.args,
        env: config.env,
      };
    case "http":
      return {
        type: "http",
        url: config.url,
        headers: config.headers,
      };
    case "sse":
      return {
        type: "sse",
        url: config.url,
        headers: config.headers,
      };
  }
  throw new Error("Unhandled MCP server config type");
}

export function isClaudeContentChunk(value: unknown): value is ClaudeContentChunk {
  return isMetadata(value) && typeof value.type === "string";
}

export function isPermissionUpdate(value: AgentPermissionUpdate): value is PermissionUpdate {
  if (!isMetadata(value)) {
    return false;
  }
  const type = value.type;
  if (type !== "addRules" && type !== "replaceRules" && type !== "removeRules") {
    return false;
  }
  return (
    Array.isArray(value.rules) &&
    typeof value.behavior === "string" &&
    typeof value.destination === "string"
  );
}

export function resolvePermissionKind(
  toolName: string,
  input: Record<string, unknown>,
): AgentPermissionRequestKind {
  if (toolName === "ExitPlanMode") return "plan";
  if (toolName === "AskUserQuestion" && Array.isArray(input.questions)) {
    return "question";
  }
  return "tool";
}

export function extractContextWindowSize(modelUsage: unknown): number | undefined {
  const usageRecord = toObjectRecord(modelUsage);
  if (!usageRecord) {
    return undefined;
  }

  let maxContextWindow: number | undefined;
  for (const value of Object.values(usageRecord)) {
    const valueRecord = toObjectRecord(value);
    if (!valueRecord) {
      continue;
    }
    const contextWindow = valueRecord.contextWindow;
    if (
      typeof contextWindow !== "number" ||
      !Number.isFinite(contextWindow) ||
      contextWindow <= 0
    ) {
      continue;
    }
    maxContextWindow = Math.max(maxContextWindow ?? 0, contextWindow);
  }
  return maxContextWindow;
}

function readUsageTotalTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }
  const totalTokens = (usage as { total_tokens?: unknown }).total_tokens;
  if (typeof totalTokens !== "number" || !Number.isFinite(totalTokens) || totalTokens < 0) {
    return undefined;
  }
  return totalTokens;
}

export function readContextWindowUsedTokensFromTaskProgress(
  message: SDKTaskProgressMessage,
): number | undefined {
  return readUsageTotalTokens(message.usage);
}

export function readUsageFromTaskNotification(message: { usage?: unknown }): number | undefined {
  return readUsageTotalTokens(message.usage);
}

export function readStreamRequestInputTokens(event: Record<string, unknown>): number | undefined {
  const usage = toObjectRecord(toObjectRecord(event.message)?.usage);
  if (!usage) {
    return undefined;
  }
  const inputTokens =
    typeof usage.input_tokens === "number" && Number.isFinite(usage.input_tokens)
      ? usage.input_tokens
      : undefined;
  const cacheCreationInputTokens =
    typeof usage.cache_creation_input_tokens === "number" &&
    Number.isFinite(usage.cache_creation_input_tokens)
      ? usage.cache_creation_input_tokens
      : 0;
  const cacheReadInputTokens =
    typeof usage.cache_read_input_tokens === "number" &&
    Number.isFinite(usage.cache_read_input_tokens)
      ? usage.cache_read_input_tokens
      : 0;
  if (typeof inputTokens !== "number" || inputTokens < 0) {
    return undefined;
  }
  return inputTokens + cacheCreationInputTokens + cacheReadInputTokens;
}

export function readStreamRequestOutputTokens(event: Record<string, unknown>): number | undefined {
  const outputTokens = toObjectRecord(event.usage)?.output_tokens;
  if (typeof outputTokens !== "number" || !Number.isFinite(outputTokens) || outputTokens < 0) {
    return undefined;
  }
  return outputTokens;
}
