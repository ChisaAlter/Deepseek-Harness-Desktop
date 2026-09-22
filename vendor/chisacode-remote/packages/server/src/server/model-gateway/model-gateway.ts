import { randomUUID } from "node:crypto";
import type {
  ModelGatewayConfig,
  ModelGatewayUpstream,
  SyntheticModelConfig,
  SyntheticModelMoa,
  SyntheticModelParameters,
} from "@chisacode/protocol/provider-config";

export type ModelGatewayTargetFormat = "anthropic" | "chatCompletions" | "responses";

type JsonRecord = Record<string, unknown>;

/**
 * Stable id for synthetic tool calls when the upstream chat stream omits `tool_calls[].id`.
 * Must be identical for both Responses `id` and `call_id` so later function_call_output pairs.
 */
function newToolCallId(): string {
  return `call_${randomUUID()}`;
}

/**
 * Coerces tool / function_call_output payloads into a chat `role=tool` content string.
 * Codex and other clients may send plain strings, content-part arrays, or structured
 * objects (`{ stdout, stderr }`, `{ text }`, nested `content`). Silent empty strings
 * here make models re-read forever and invent file contents.
 * @param value Raw tool output from Responses or Anthropic tool_result
 * @returns Text the upstream model should see as the tool result
 */
// eslint-disable-next-line complexity
function stringifyToolOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const joined = value.map(readPartText).join("");
    if (joined.length > 0) {
      return joined;
    }
    // Array of structured objects without text parts — fall through to JSON.
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }

  const record = asRecord(value);
  if (!record) {
    return String(value);
  }

  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.output_text === "string") {
    return record.output_text;
  }
  if (typeof record.output === "string") {
    return record.output;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  if (Array.isArray(record.content)) {
    const fromContent = stringifyToolOutput(record.content);
    if (fromContent.length > 0) {
      return fromContent;
    }
  }

  const stdout = typeof record.stdout === "string" ? record.stdout : "";
  const stderr = typeof record.stderr === "string" ? record.stderr : "";
  if (stdout.length > 0 || stderr.length > 0) {
    if (stdout.length > 0 && stderr.length > 0) {
      return `${stdout}\n${stderr}`;
    }
    return stdout.length > 0 ? stdout : stderr;
  }

  if (typeof record.aggregated_output === "string") {
    return record.aggregated_output;
  }
  if (typeof record.aggregatedOutput === "string") {
    return record.aggregatedOutput;
  }
  if (typeof record.formatted_output === "string") {
    return record.formatted_output;
  }
  if (typeof record.formattedOutput === "string") {
    return record.formattedOutput;
  }

  // Last resort: preserve structured tool payloads instead of dropping them.
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

interface HandleModelGatewayRequestOptions {
  gateway: ModelGatewayConfig;
  targetFormat: ModelGatewayTargetFormat;
  requestBody: JsonRecord;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

interface UpstreamSelection {
  format: ModelGatewayTargetFormat;
  upstream: ModelGatewayUpstream;
  url: string;
}

export interface MoaTestNodeTrace {
  id: string | null;
  model: string;
  status: "success" | "error";
  output: string | null;
  error: string | null;
  durationMs: number;
}

export interface MoaTestLayerTrace {
  id: string;
  label: string | null;
  nodes: MoaTestNodeTrace[];
}

export interface MoaTestAggregatorTrace {
  model: string;
  status: "success" | "error";
  output: string | null;
  error: string | null;
  durationMs: number;
}

export interface MoaTestResult {
  finalText: string;
  durationMs: number;
  layers: MoaTestLayerTrace[];
  aggregator: MoaTestAggregatorTrace;
}

const SYNTHETIC_MODEL_SYSTEM_PROMPT = `You have been provided with a set of responses from multiple models to the latest user request. Synthesize them into one high-quality answer. Critically evaluate the responses because some may be incomplete, biased, or incorrect. Do not merely copy them; produce a refined, accurate, coherent, and complete response.

Return only the final answer that should be shown to the user. Do not describe your evaluation process, do not mention the model responses, and do not include hidden reasoning or analysis.

Responses from models:`;
const SYNTHETIC_CHAT_OPTION_KEYS = [
  "temperature",
  "top_p",
  "max_tokens",
  "max_completion_tokens",
  "presence_penalty",
  "frequency_penalty",
  "stop",
  "seed",
] as const;
const XIAOMI_CHAT_COMPLETIONS_MAX_TOKENS = 131_072;
const UPSTREAM_COMPATIBILITY_RULES = [
  {
    host: "api.xiaomimimo.com",
    format: "chatCompletions",
    tokenLimits: {
      max_tokens: XIAOMI_CHAT_COMPLETIONS_MAX_TOKENS,
      max_completion_tokens: XIAOMI_CHAT_COMPLETIONS_MAX_TOKENS,
    },
  },
] as const;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function isConfigured(
  upstream: ModelGatewayUpstream | undefined,
): upstream is ModelGatewayUpstream {
  return upstream?.enabled === true && upstream.baseUrl.trim().length > 0;
}

function resolvePath(format: ModelGatewayTargetFormat, baseUrl: string): string {
  if (format === "anthropic") {
    const path = new URL(baseUrl).pathname.replace(/\/+$/u, "");
    return path.endsWith("/v1") ? "/messages" : "/v1/messages";
  }
  if (format === "chatCompletions") {
    return "/chat/completions";
  }
  return "/responses";
}

function getUpstreamForFormat(
  gateway: ModelGatewayConfig,
  format: ModelGatewayTargetFormat,
): ModelGatewayUpstream | undefined {
  if (format === "anthropic") {
    return gateway.upstreams.anthropic;
  }
  if (format === "chatCompletions") {
    return gateway.upstreams.chatCompletions;
  }
  return gateway.upstreams.responses;
}

function selectUpstream(
  gateway: ModelGatewayConfig,
  targetFormat: ModelGatewayTargetFormat,
): UpstreamSelection {
  const orderedFormats: ModelGatewayTargetFormat[] = [
    targetFormat,
    "responses",
    "chatCompletions",
    "anthropic",
  ];
  for (const format of orderedFormats) {
    const upstream = getUpstreamForFormat(gateway, format);
    if (!isConfigured(upstream)) {
      continue;
    }
    return {
      format,
      upstream,
      url: `${trimTrailingSlash(upstream.baseUrl)}${resolvePath(format, upstream.baseUrl)}`,
    };
  }
  throw new Error(`Model gateway "${gateway.id}" has no enabled upstream`);
}

function readPartText(part: unknown): string {
  if (typeof part === "string") {
    return part;
  }
  const record = asRecord(part);
  if (!record) {
    return "";
  }
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.input_text === "string") {
    return record.input_text;
  }
  if (typeof record.output_text === "string") {
    return record.output_text;
  }
  if (typeof record.stdout === "string") {
    return record.stdout;
  }
  if (typeof record.output === "string") {
    return record.output;
  }
  return "";
}

function readTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map(readPartText).join("");
}

function normalizeRequestedModelId(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed;
}

function findSyntheticModel(
  gateway: ModelGatewayConfig,
  requestedModel: unknown,
): SyntheticModelConfig | null {
  const normalized = normalizeRequestedModelId(requestedModel);
  if (!normalized) {
    return null;
  }
  const syntheticModels = gateway.syntheticModels ?? [];
  const exact = syntheticModels.find((model) => model.id === normalized);
  if (exact) {
    return exact;
  }
  const slashIndex = normalized.indexOf("/");
  if (slashIndex < 0) {
    return null;
  }
  const withoutProviderPrefix = normalized.slice(slashIndex + 1);
  return syntheticModels.find((model) => model.id === withoutProviderPrefix) ?? null;
}

/**
 * Builds an OpenAI-compatible `/v1/models` listing for a gateway face.
 * OpenCode discovers models via this endpoint when `OPENAI_BASE_URL`
 * points at the gateway; without it they never see `openai/grok-4.5`.
 * @param gateway The gateway configuration whose models should be listed
 * @returns OpenAI models list JSON (`{ object: "list", data: [...] }`)
 */
export function listModelGatewayModels(gateway: ModelGatewayConfig): JsonRecord {
  const seen = new Set<string>();
  const data: JsonRecord[] = [];
  const now = Math.floor(Date.now() / 1000);

  function addModel(id: string): void {
    const normalized = id.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    data.push({
      id: normalized,
      object: "model",
      created: now,
      owned_by: gateway.id,
    });
  }

  for (const model of gateway.models ?? []) {
    addModel(model.id);
  }
  for (const model of gateway.syntheticModels ?? []) {
    addModel(model.id);
  }
  // Face providers (opencode/pi) request models as `openai/<id>`.
  for (const model of gateway.models ?? []) {
    if (!model.id.includes("/")) {
      addModel(`openai/${model.id}`);
    }
  }
  for (const model of gateway.syntheticModels ?? []) {
    if (!model.id.includes("/")) {
      addModel(`openai/${model.id}`);
    }
  }

  return { object: "list", data };
}

function parseJsonObject(value: unknown): JsonRecord {
  if (typeof value !== "string" || value.trim().length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function anthropicToChat(body: JsonRecord): JsonRecord {
  const messages: JsonRecord[] = [];
  const system = body.system;
  if (typeof system === "string" && system.trim().length > 0) {
    messages.push({ role: "system", content: system });
  } else if (Array.isArray(system)) {
    const text = readTextContent(system);
    if (text.trim().length > 0) {
      messages.push({ role: "system", content: text });
    }
  }

  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    const record = asRecord(message);
    if (!record) {
      continue;
    }
    const content = Array.isArray(record.content) ? record.content : [];
    const toolResults = readAnthropicToolResults(content);
    if (toolResults.length > 0) {
      for (const toolResult of toolResults) {
        messages.push(toolResult);
      }
      // A user message may contain only tool_result blocks.
      const text = readTextContent(record.content);
      if (text.length === 0) {
        continue;
      }
    }
    const toolCalls = readAnthropicToolCalls(content);
    const role = record.role === "assistant" ? "assistant" : "user";
    messages.push({
      role,
      content:
        toolCalls.length > 0
          ? readTextContent(record.content) || null
          : readTextContent(record.content),
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  }

  return {
    model: body.model,
    messages,
    ...(typeof body.max_tokens === "number" ? { max_tokens: body.max_tokens } : {}),
    // Parameter passthrough decision table (see docs/refactors/…gateway conversion):
    // temperature/top_p forward as-is; stop_sequences → stop; tool_choice maps.
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
    ...(typeof body.top_p === "number" ? { top_p: body.top_p } : {}),
    ...(Array.isArray(body.stop_sequences)
      ? { stop: body.stop_sequences.filter((item): item is string => typeof item === "string") }
      : {}),
    ...convertAnthropicToolChoiceToChat(body.tool_choice),
    stream: body.stream === true,
    ...convertAnthropicToolsToChat(body.tools),
  };
}

/**
 * Picks the first string field from a record by priority, falling back to "".
 * Used to avoid nested ternaries when resolving tool call ids.
 * @param record Record to read from
 * @param keys Field names in priority order
 * @returns First string value found, or ""
 */
function firstStringField(record: JsonRecord | null, ...keys: string[]): string {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

/**
 * Maps a chat-completions finish_reason to an Anthropic stop_reason without nesting.
 * @param finishReason Chat finish_reason
 * @param hasToolUse Whether the assistant content contains tool_use blocks
 * @returns Anthropic stop_reason
 */
function chatFinishReasonToAnthropicStop(finishReason: string, hasToolUse: boolean): string {
  if (finishReason === "length") return "max_tokens";
  if (finishReason === "tool_calls" || hasToolUse) return "tool_use";
  return "end_turn";
}

/**
 * Maps an Anthropic stop_reason to a chat-completions finish_reason without nesting.
 * @param stopReason Anthropic stop_reason
 * @param hasToolUse Whether the assistant content contains tool_use blocks
 * @returns Chat finish_reason
 */
function anthropicStopToChatFinishReason(stopReason: string, hasToolUse: boolean): string {
  if (stopReason === "max_tokens") return "length";
  if (stopReason === "tool_use" || hasToolUse) return "tool_calls";
  return "stop";
}

/**
 * Extracts Anthropic tool_result content blocks as chat role=tool messages.
 * @param content Anthropic message content array
 * @returns Chat tool messages
 */
function readAnthropicToolResults(content: unknown[]): JsonRecord[] {
  return content.flatMap((part) => {
    const record = asRecord(part);
    if (!record || record.type !== "tool_result") {
      return [];
    }
    const toolUseId = firstStringField(record, "tool_use_id", "id");
    return [
      {
        role: "tool",
        tool_call_id: toolUseId,
        content: stringifyToolOutput(record.content ?? record.output ?? ""),
      },
    ];
  });
}

/**
 * Converts Anthropic tool definitions to OpenAI chat-completions tool format.
 * Anthropic tools: `[{ name, description, input_schema }]`
 * Chat tools: `[{ type: "function", function: { name, description, parameters } }]`
 * @param tools Anthropic tools array from the request body
 * @returns Chat-completions tools, or empty spread when absent
 */
function convertAnthropicToolsToChat(tools: unknown): { tools?: JsonRecord[] } {
  if (!Array.isArray(tools)) {
    return {};
  }
  const chatTools: JsonRecord[] = [];
  for (const tool of tools) {
    const record = asRecord(tool);
    if (!record || typeof record.name !== "string") {
      continue;
    }
    chatTools.push({
      type: "function",
      function: {
        name: record.name,
        ...(typeof record.description === "string" ? { description: record.description } : {}),
        parameters: asRecord(record.input_schema) ?? { type: "object", properties: {} },
      },
    });
  }
  return chatTools.length > 0 ? { tools: chatTools } : {};
}

function readAnthropicToolCalls(content: unknown[]): JsonRecord[] {
  return content.flatMap((part) => {
    const record = asRecord(part);
    // server_tool_use / mcp_tool_use share the tool_use shape (id/name/input) and
    // must convert exactly like tool_use so pairing survives format bridges.
    if (
      !record ||
      (record.type !== "tool_use" &&
        record.type !== "server_tool_use" &&
        record.type !== "mcp_tool_use")
    ) {
      return [];
    }
    return [
      {
        id: typeof record.id === "string" && record.id.length > 0 ? record.id : newToolCallId(),
        type: "function",
        function: {
          name: typeof record.name === "string" ? record.name : "",
          arguments: JSON.stringify(record.input ?? {}),
        },
      },
    ];
  });
}

function responsesToChat(body: JsonRecord): JsonRecord {
  const messages: JsonRecord[] = [];
  if (typeof body.instructions === "string" && body.instructions.trim().length > 0) {
    messages.push({ role: "system", content: body.instructions });
  }

  const input = body.input;
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
  } else if (Array.isArray(input)) {
    appendResponsesInputAsChatMessages(input, messages);
  }

  return {
    model: body.model,
    messages,
    ...(typeof body.max_output_tokens === "number" ? { max_tokens: body.max_output_tokens } : {}),
    // Parameter passthrough: temperature/top_p and stop (string|string[]) forward as-is.
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
    ...(typeof body.top_p === "number" ? { top_p: body.top_p } : {}),
    ...(typeof body.stop === "string" || Array.isArray(body.stop) ? { stop: body.stop } : {}),
    ...convertResponsesToolChoiceToChat(body.tool_choice),
    stream: body.stream === true,
    ...convertResponsesToolsToChat(body.tools),
  };
}

/**
 * Converts Responses-API `input` items into chat-completions messages, preserving
 * prior function calls and tool outputs so multi-turn tool use can continue.
 *
 * Chat completions require `role=tool` messages to immediately follow the assistant
 * message that contains the matching `tool_calls`. Codex often emits an empty
 * assistant message (or a short status line) between `function_call` and
 * `function_call_output`; inserting that as a separate chat message breaks pairing
 * and makes upstream models treat shell/read results as missing.
 *
 * Only `message` / `function_call` / `function_call_output` items are converted.
 * Any other item type (`reasoning`, `web_search_call`, `computer_call`, ...) is
 * skipped without flushing the pending assistant so tool_call/tool_result pairing
 * is never split by noise items.
 *
 * @param input Responses request `input` array
 * @param messages Mutable chat message list to append into
 */
// eslint-disable-next-line complexity
function appendResponsesInputAsChatMessages(input: unknown[], messages: JsonRecord[]): void {
  // Keep pending tool_calls as plain data so TS doesn't infer never[] on JsonRecord fields.
  let pendingToolCalls: JsonRecord[] = [];
  let pendingAssistantText: string | null = null;

  function flushPendingAssistant(): void {
    if (pendingToolCalls.length === 0 && pendingAssistantText == null) {
      return;
    }
    const message: JsonRecord = {
      role: "assistant",
      content: pendingAssistantText,
    };
    if (pendingToolCalls.length > 0) {
      message.tool_calls = pendingToolCalls;
    }
    messages.push(message);
    pendingToolCalls = [];
    pendingAssistantText = null;
  }

  for (const item of input) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    // Responses function_call items become assistant tool_calls.
    if (record.type === "function_call") {
      const callId = firstStringField(record, "call_id", "id") || `call_${messages.length}`;
      const name = typeof record.name === "string" ? record.name : "";
      const args =
        typeof record.arguments === "string"
          ? record.arguments
          : JSON.stringify(record.arguments ?? {});
      pendingToolCalls.push({
        id: callId,
        type: "function",
        function: { name, arguments: args },
      });
      continue;
    }

    // Responses function_call_output items become role=tool messages.
    if (record.type === "function_call_output") {
      flushPendingAssistant();
      const callId = firstStringField(record, "call_id", "id");
      const output = stringifyToolOutput(record.output ?? record.content);
      messages.push({
        role: "tool",
        tool_call_id: callId,
        content: output,
      });
      continue;
    }

    // Message-like items (role + content). Other item types (reasoning,
    // web_search_call, computer_call, ...) are whitelisted out below.
    if (record.type !== "message" && typeof record.role !== "string") {
      // Unknown item type — skip without touching pending assistant pairing.
      continue;
    }
    const role = normalizeMessageRole(record.role);
    const text = readTextContent(record.content ?? record.text);

    // Empty non-assistant placeholders are noise.
    if (text.length === 0 && role !== "assistant") {
      continue;
    }

    // Empty assistant messages must not split tool_calls from tool results.
    // Codex routinely inserts them between function_call and function_call_output.
    if (role === "assistant" && text.length === 0) {
      continue;
    }

    if (role === "assistant") {
      if (pendingToolCalls.length > 0) {
        // Merge status text into the same assistant message that owns tool_calls.
        pendingAssistantText =
          pendingAssistantText && pendingAssistantText.length > 0
            ? `${pendingAssistantText}\n${text}`
            : text;
        continue;
      }
      flushPendingAssistant();
      messages.push({ role: "assistant", content: text });
      continue;
    }

    // user/system: end any open tool_call assistant first.
    flushPendingAssistant();
    messages.push({
      role,
      content: text,
    });
  }

  flushPendingAssistant();
}

/**
 * Converts OpenAI Responses-API tool definitions to chat-completions tool format.
 * Responses tools may be flat (`{ type: "function", name, description, parameters }`)
 * or wrapped (`{ type: "function", function: { name, ... } }`). Chat tools are always
 * wrapped: `[{ type: "function", function: { name, description, parameters } }]`.
 * @param tools Responses-API tools array from the request body
 * @returns Chat-completions tools, or empty spread when absent
 */
function convertResponsesToolsToChat(tools: unknown): { tools?: JsonRecord[] } {
  if (!Array.isArray(tools)) {
    return {};
  }
  const chatTools: JsonRecord[] = [];
  for (const tool of tools) {
    const record = asRecord(tool);
    if (!record) {
      continue;
    }
    // Wrapped form: { type: "function", function: { name, ... } }
    const wrapped = asRecord(record.function);
    if (wrapped && typeof wrapped.name === "string") {
      chatTools.push({
        type: "function",
        function: {
          name: wrapped.name,
          ...(typeof wrapped.description === "string" ? { description: wrapped.description } : {}),
          parameters: asRecord(wrapped.parameters) ?? { type: "object", properties: {} },
        },
      });
      continue;
    }
    // Flat form: { type: "function", name, description, parameters }
    if (typeof record.name === "string") {
      chatTools.push({
        type: "function",
        function: {
          name: record.name,
          ...(typeof record.description === "string" ? { description: record.description } : {}),
          parameters: asRecord(record.parameters) ?? { type: "object", properties: {} },
        },
      });
    }
  }
  return chatTools.length > 0 ? { tools: chatTools } : {};
}

function normalizeMessageRole(role: unknown): string {
  if (role === "developer") {
    return "system";
  }
  if (role === "assistant" || role === "system" || role === "tool") {
    return role;
  }
  return "user";
}

/**
 * Maps a chat-completions `stop` value (string or string[]) to Anthropic
 * `stop_sequences` (string[]), or undefined when absent/empty.
 * @param value Raw chat `stop` field
 * @returns Anthropic stop_sequences array, or undefined
 */
function chatStopToAnthropicStopSequences(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const strings = value.filter((item): item is string => typeof item === "string");
    return strings.length > 0 ? strings : undefined;
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return undefined;
}

/**
 * Maps a chat-completions `tool_choice` to Anthropic form.
 * chat `{type:"function",function:{name}}` → `{type:"tool",name}`; plain
 * "auto"/"none" pass through; unknown shapes are dropped (documented as
 * known-dropped in the gateway conversion matrix).
 * @param value Raw chat `tool_choice`
 * @returns Anthropic tool_choice spread, or empty when absent
 */
function convertChatToolChoiceToAnthropic(value: unknown): { tool_choice?: JsonRecord } {
  if (typeof value === "string") {
    if (value === "auto" || value === "none") {
      return { tool_choice: { type: value } };
    }
    return {};
  }
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  if (record.type === "auto" || record.type === "none") {
    return { tool_choice: { type: record.type } };
  }
  if (record.type === "function") {
    const fn = asRecord(record.function);
    if (fn && typeof fn.name === "string") {
      return { tool_choice: { type: "tool", name: fn.name } };
    }
  }
  return {};
}

/**
 * Maps a chat-completions `tool_choice` to Responses-API form:
 * `{type:"function",function:{name}}` → `{type:"function",name}`.
 * @param value Raw chat `tool_choice`
 * @returns Responses tool_choice spread, or empty when absent
 */
function convertChatToolChoiceToResponses(value: unknown): { tool_choice?: JsonRecord } {
  if (typeof value === "string") {
    if (value === "auto" || value === "none" || value === "required") {
      return { tool_choice: { type: value } };
    }
    return {};
  }
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  if (record.type === "auto" || record.type === "none" || record.type === "required") {
    return { tool_choice: { type: record.type } };
  }
  if (record.type === "function") {
    const fn = asRecord(record.function);
    if (fn && typeof fn.name === "string") {
      return { tool_choice: { type: "function", name: fn.name } };
    }
  }
  return {};
}

/**
 * Maps an Anthropic `tool_choice` to chat-completions form:
 * `{type:"tool",name}` → `{type:"function",function:{name}}`; "auto"/"none"
 * pass through; "any" and unknown shapes are dropped (documented as
 * known-dropped in the gateway conversion matrix).
 * @param value Raw Anthropic tool_choice
 * @returns Chat tool_choice spread, or empty when absent
 */
function convertAnthropicToolChoiceToChat(value: unknown): { tool_choice?: JsonRecord } {
  if (typeof value === "string") {
    if (value === "auto" || value === "none") {
      return { tool_choice: { type: value } };
    }
    return {};
  }
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  if (record.type === "auto" || record.type === "none") {
    return { tool_choice: { type: record.type } };
  }
  if (record.type === "tool") {
    const name = typeof record.name === "string" ? record.name : "";
    if (name.length > 0) {
      return { tool_choice: { type: "function", function: { name } } };
    }
  }
  return {};
}

/**
 * Maps a Responses-API `tool_choice` to chat-completions form:
 * `{type:"function",name}` → `{type:"function",function:{name}}`.
 * @param value Raw Responses tool_choice
 * @returns Chat tool_choice spread, or empty when absent
 */
function convertResponsesToolChoiceToChat(value: unknown): { tool_choice?: JsonRecord } {
  if (typeof value === "string") {
    if (value === "auto" || value === "none" || value === "required") {
      return { tool_choice: { type: value } };
    }
    return {};
  }
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  if (record.type === "auto" || record.type === "none" || record.type === "required") {
    return { tool_choice: { type: record.type } };
  }
  if (record.type === "function") {
    const name = typeof record.name === "string" ? record.name : "";
    if (name.length > 0) {
      return { tool_choice: { type: "function", function: { name } } };
    }
  }
  return {};
}

function chatToAnthropic(body: JsonRecord): JsonRecord {
  const messages: JsonRecord[] = [];
  const systemMessages: string[] = [];

  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    const record = asRecord(message);
    if (!record) {
      continue;
    }
    appendChatMessageAsAnthropic(record, messages, systemMessages);
  }

  const stopSequences = chatStopToAnthropicStopSequences(body.stop);

  return {
    model: body.model,
    messages,
    ...(systemMessages.length > 0 ? { system: systemMessages.join("\n\n") } : {}),
    ...(typeof body.max_tokens === "number" ? { max_tokens: body.max_tokens } : {}),
    // Parameter passthrough: temperature/top_p as-is; stop → stop_sequences; tool_choice maps.
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
    ...(typeof body.top_p === "number" ? { top_p: body.top_p } : {}),
    ...(stopSequences !== undefined ? { stop_sequences: stopSequences } : {}),
    ...convertChatToolChoiceToAnthropic(body.tool_choice),
    stream: body.stream === true,
    ...convertChatToolsToAnthropic(body.tools),
  };
}

/**
 * Converts chat-completions tool definitions to Anthropic tool definitions.
 * @param tools Chat tools array
 * @returns Anthropic tools spread, or empty when absent
 */
function convertChatToolsToAnthropic(tools: unknown): { tools?: JsonRecord[] } {
  if (!Array.isArray(tools)) {
    return {};
  }
  const anthropicTools: JsonRecord[] = [];
  for (const tool of tools) {
    const record = asRecord(tool);
    const fn = asRecord(record?.function);
    if (!fn || typeof fn.name !== "string") {
      continue;
    }
    anthropicTools.push({
      name: fn.name,
      ...(typeof fn.description === "string" ? { description: fn.description } : {}),
      input_schema: asRecord(fn.parameters) ?? { type: "object", properties: {} },
    });
  }
  return anthropicTools.length > 0 ? { tools: anthropicTools } : {};
}

function appendChatMessageAsAnthropic(
  record: JsonRecord,
  messages: JsonRecord[],
  systemMessages: string[],
): void {
  const role = normalizeMessageRole(record.role);
  const contentText = readTextContent(record.content);
  if (role === "system" || role === "developer") {
    if (contentText.trim().length > 0) {
      systemMessages.push(contentText);
    }
    return;
  }
  if (role === "tool") {
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: typeof record.tool_call_id === "string" ? record.tool_call_id : "",
          content: stringifyToolOutput(record.content ?? record.output ?? contentText),
        },
      ],
    });
    return;
  }

  const content: JsonRecord[] = [];
  if (contentText.length > 0) {
    content.push({ type: "text", text: contentText });
  }
  content.push(...readChatToolUseContent(record.tool_calls));
  messages.push({ role: role === "assistant" ? "assistant" : "user", content });
}

function readChatToolUseContent(toolCalls: unknown): JsonRecord[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }
  return toolCalls.flatMap((toolCall) => {
    const toolCallRecord = asRecord(toolCall);
    const fn = asRecord(toolCallRecord?.function);
    if (!toolCallRecord || !fn) {
      return [];
    }
    return [
      {
        type: "tool_use",
        id:
          typeof toolCallRecord.id === "string" && toolCallRecord.id.length > 0
            ? toolCallRecord.id
            : newToolCallId(),
        name: typeof fn.name === "string" ? fn.name : "",
        input: parseJsonObject(fn.arguments),
      },
    ];
  });
}

// eslint-disable-next-line complexity
function chatToResponses(body: JsonRecord): JsonRecord {
  const input: JsonRecord[] = [];
  const instructions: string[] = [];
  for (const message of Array.isArray(body.messages) ? body.messages : []) {
    const record = asRecord(message);
    if (!record) {
      continue;
    }
    const role = normalizeMessageRole(record.role);
    const text = readTextContent(record.content);
    if (role === "system" || role === "developer") {
      if (text.trim().length > 0) {
        instructions.push(text);
      }
      continue;
    }
    if (role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: typeof record.tool_call_id === "string" ? record.tool_call_id : "",
        // Prefer full tool payload coercion — content may be a structured object.
        output: stringifyToolOutput(record.content ?? record.output ?? text),
      });
      continue;
    }
    if (role === "assistant") {
      if (text.length > 0) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        });
      }
      const toolCalls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
      for (const toolCall of toolCalls) {
        const toolCallRecord = asRecord(toolCall);
        const fn = asRecord(toolCallRecord?.function);
        if (!toolCallRecord || !fn || typeof fn.name !== "string") {
          continue;
        }
        const callId =
          typeof toolCallRecord.id === "string" ? toolCallRecord.id : `call_${input.length}`;
        input.push({
          type: "function_call",
          id: callId,
          call_id: callId,
          name: fn.name,
          arguments:
            typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
        });
      }
      continue;
    }
    input.push({
      type: "message",
      role: "user",
      content: text,
    });
  }

  return {
    model: body.model,
    input,
    ...(instructions.length > 0 ? { instructions: instructions.join("\n\n") } : {}),
    ...(typeof body.max_tokens === "number" ? { max_output_tokens: body.max_tokens } : {}),
    // Parameter passthrough: temperature/top_p forward as-is; `stop` is
    // intentionally dropped for the Responses target (known-dropped, see the
    // gateway conversion matrix); tool_choice maps to {type,name}.
    ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
    ...(typeof body.top_p === "number" ? { top_p: body.top_p } : {}),
    ...convertChatToolChoiceToResponses(body.tool_choice),
    stream: body.stream === true,
    ...convertChatToolsToResponses(body.tools),
  };
}

/**
 * Passes chat-completions tool definitions through to Responses format.
 * Chat tools are already `{ type:"function", function:{ name, parameters } }`;
 * Responses accepts the same shape.
 * @param tools Chat-completions tools array
 * @returns Responses tools spread, or empty when absent
 */
function convertChatToolsToResponses(tools: unknown): { tools?: JsonRecord[] } {
  if (!Array.isArray(tools) || tools.length === 0) {
    return {};
  }
  return { tools: tools as JsonRecord[] };
}

function anthropicToResponses(body: JsonRecord): JsonRecord {
  return chatToResponses(anthropicToChat(body));
}

function responsesToAnthropic(body: JsonRecord): JsonRecord {
  return chatToAnthropic(responsesToChat(body));
}

function normalizeChatUpstreamBody(body: JsonRecord): JsonRecord {
  const normalized = Array.isArray(body.messages)
    ? {
        ...body,
        messages: body.messages.map((message) => {
          const record = asRecord(message);
          if (!record) {
            return message;
          }
          return {
            ...record,
            role: normalizeMessageRole(record.role),
          };
        }),
      }
    : body;
  return normalized;
}

function isXiaomiChatCompletionsUpstream(
  upstreamFormat: ModelGatewayTargetFormat,
  upstream: ModelGatewayUpstream,
): boolean {
  try {
    const hostname = new URL(upstream.baseUrl).hostname;
    return UPSTREAM_COMPATIBILITY_RULES.some(
      (rule) => rule.format === upstreamFormat && rule.host === hostname,
    );
  } catch {
    return false;
  }
}

function clampTokenLimit(body: JsonRecord, key: string, limit: number): JsonRecord {
  const value = body[key];
  if (typeof value !== "number" || value <= limit) {
    return body;
  }
  return {
    ...body,
    [key]: limit,
  };
}

function applyUpstreamCompatibility(
  upstreamFormat: ModelGatewayTargetFormat,
  upstream: ModelGatewayUpstream,
  body: JsonRecord,
): JsonRecord {
  if (!isXiaomiChatCompletionsUpstream(upstreamFormat, upstream)) {
    return body;
  }

  let nextBody = body;
  for (const rule of UPSTREAM_COMPATIBILITY_RULES) {
    if (rule.format !== upstreamFormat) {
      continue;
    }
    for (const [key, limit] of Object.entries(rule.tokenLimits)) {
      nextBody = clampTokenLimit(nextBody, key, limit);
    }
  }
  return nextBody;
}

function readUsageNumber(usage: JsonRecord, primary: string, fallback?: string): number {
  if (typeof usage[primary] === "number") {
    return usage[primary];
  }
  if (fallback && typeof usage[fallback] === "number") {
    return usage[fallback];
  }
  return 0;
}

function chatToAnthropicResponse(chatResponse: JsonRecord, fallbackModel: unknown): JsonRecord {
  const choices = Array.isArray(chatResponse.choices) ? chatResponse.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message) ?? {};
  const usage = asRecord(chatResponse.usage) ?? {};
  const content = readChatMessageAsAnthropicContent(message);
  const hasToolUse = content.some((part) => asRecord(part)?.type === "tool_use");
  const finishReason = firstChoice?.finish_reason;

  return {
    id: typeof chatResponse.id === "string" ? chatResponse.id : `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: typeof chatResponse.model === "string" ? chatResponse.model : fallbackModel,
    content,
    stop_reason: chatFinishReasonToAnthropicStop(String(finishReason ?? ""), hasToolUse),
    stop_sequence: null,
    usage: {
      input_tokens: readUsageNumber(usage, "prompt_tokens"),
      output_tokens: readUsageNumber(usage, "completion_tokens"),
    },
  };
}

function readChatMessageAsAnthropicContent(message: JsonRecord): JsonRecord[] {
  const content: JsonRecord[] = [];
  const text = readTextContent(message.content);
  if (text.length > 0) {
    content.push({ type: "text", text });
  }
  content.push(...readChatToolUseContent(message.tool_calls));
  return content.length > 0 ? content : [{ type: "text", text: "" }];
}

function anthropicToChatResponse(
  anthropicResponse: JsonRecord,
  fallbackModel: unknown,
): JsonRecord {
  const usage = asRecord(anthropicResponse.usage) ?? {};
  const content = Array.isArray(anthropicResponse.content) ? anthropicResponse.content : [];
  const promptTokens = readUsageNumber(usage, "input_tokens");
  const completionTokens = readUsageNumber(usage, "output_tokens");
  return {
    id: typeof anthropicResponse.id === "string" ? anthropicResponse.id : `chatcmpl_${Date.now()}`,
    object: "chat.completion",
    model: typeof anthropicResponse.model === "string" ? anthropicResponse.model : fallbackModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: readTextContent(content),
          ...readAnthropicToolCallsAsChat(content),
        },
        finish_reason: anthropicStopToChatFinishReason(
          String(anthropicResponse.stop_reason ?? ""),
          content.some((part) => asRecord(part)?.type === "tool_use"),
        ),
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

function readAnthropicToolCallsAsChat(content: unknown[]): JsonRecord {
  const toolCalls = readAnthropicToolCalls(content);
  return toolCalls.length > 0 ? { tool_calls: toolCalls } : {};
}

function readResponsesOutputText(response: JsonRecord): string {
  if (typeof response.output_text === "string") {
    return response.output_text;
  }
  if (!Array.isArray(response.output)) {
    return "";
  }
  return response.output.map((item) => readTextContent(asRecord(item)?.content)).join("");
}

function responsesToChatResponse(
  responsesResponse: JsonRecord,
  fallbackModel: unknown,
): JsonRecord {
  const usage = asRecord(responsesResponse.usage) ?? {};
  const promptTokens = readUsageNumber(usage, "input_tokens", "prompt_tokens");
  const completionTokens = readUsageNumber(usage, "output_tokens", "completion_tokens");
  return {
    id: typeof responsesResponse.id === "string" ? responsesResponse.id : `chatcmpl_${Date.now()}`,
    object: "chat.completion",
    model: typeof responsesResponse.model === "string" ? responsesResponse.model : fallbackModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: readResponsesOutputText(responsesResponse),
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

function chatToResponsesResponse(chatResponse: JsonRecord, fallbackModel: unknown): JsonRecord {
  const choices = Array.isArray(chatResponse.choices) ? chatResponse.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message) ?? {};
  const usage = asRecord(chatResponse.usage) ?? {};
  const text = readTextContent(message.content);
  const promptTokens = readUsageNumber(usage, "prompt_tokens");
  const completionTokens = readUsageNumber(usage, "completion_tokens");
  const toolCalls = readChatToolCallsAsResponses(message.tool_calls);
  const output: JsonRecord[] = [];
  if (text.length > 0) {
    output.push({
      id: `msg_${Date.now()}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text }],
    });
  }
  output.push(...toolCalls);
  return {
    id: typeof chatResponse.id === "string" ? chatResponse.id : `resp_${Date.now()}`,
    object: "response",
    status: "completed",
    model: typeof chatResponse.model === "string" ? chatResponse.model : fallbackModel,
    output: output.length > 0 ? output : [],
    output_text: text,
    usage: {
      input_tokens: promptTokens,
      output_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

/**
 * Codex shell tools reject floating-point timeout fields (`expected u64`). Grok often
 * emits `timeout_ms: 15000.0` in tool arguments; coerce known numeric timeout keys to
 * integers so the app-server can execute instead of returning parse errors in a loop.
 *
 * Walks the full parsed JSON tree (any nesting depth) instead of regex-matching top
 * levels, so `timeout_ms` inside nested objects/arrays is also normalized. Falls back
 * to the original text when the payload is not valid JSON.
 * @param name Tool / function name
 * @param argumentsJson Raw JSON arguments string
 * @returns Sanitized arguments JSON string
 */
function sanitizeToolCallArguments(name: string, argumentsJson: string): string {
  if (!argumentsJson || argumentsJson.trim().length === 0) {
    return argumentsJson;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson) as unknown;
  } catch {
    // Not valid JSON — keep the original payload untouched (existing fallback).
    return argumentsJson;
  }
  const record = asRecord(parsed);
  if (!record) {
    return argumentsJson;
  }
  const changed = normalizeTimeoutKeys(record);
  if (!changed) {
    return argumentsJson;
  }
  // shell_command / exec tools are the main offenders; still safe for other tools.
  void name;
  try {
    return JSON.stringify(record);
  } catch {
    return argumentsJson;
  }
}

const TIMEOUT_KEYS = new Set(["timeout_ms", "timeoutMs", "timeout", "command_timeout_ms"]);

/**
 * Recursively truncates floating-point values under known timeout keys to integers.
 * Mutates the tree in place; returns whether anything changed.
 * @param value Any node of a parsed JSON tree
 * @returns True when at least one timeout value was normalized
 */
function normalizeTimeoutKeys(value: unknown): boolean {
  if (Array.isArray(value)) {
    let changed = false;
    for (const item of value) {
      changed = normalizeTimeoutKeys(item) || changed;
    }
    return changed;
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as JsonRecord;
  let changed = false;
  for (const [key, child] of Object.entries(record)) {
    if (TIMEOUT_KEYS.has(key) && typeof child === "number" && Number.isFinite(child)) {
      const asInt = Math.max(0, Math.trunc(child));
      if (asInt !== child) {
        record[key] = asInt;
        changed = true;
      }
      continue;
    }
    if (Array.isArray(child) || (typeof child === "object" && child !== null)) {
      changed = normalizeTimeoutKeys(child) || changed;
    }
  }
  return changed;
}

/**
 * Converts chat-completions tool_calls to Responses-API function_call output items.
 * @param toolCalls The `message.tool_calls` array from a chat-completions response
 * @returns Responses-API function_call output items
 */
function readChatToolCallsAsResponses(toolCalls: unknown): JsonRecord[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }
  return toolCalls.flatMap((toolCall) => {
    const record = asRecord(toolCall);
    const fn = asRecord(record?.function);
    if (!record || !fn || typeof fn.name !== "string") {
      return [];
    }
    const callId =
      typeof record.id === "string" && record.id.length > 0 ? record.id : newToolCallId();
    const rawArgs =
      typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {});
    return [
      {
        type: "function_call",
        id: callId,
        call_id: callId,
        name: fn.name,
        arguments: sanitizeToolCallArguments(fn.name, rawArgs),
      },
    ];
  });
}

function sseEvent(event: string, data: JsonRecord): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function parseStreamTextDeltas(sseText: string, format: ModelGatewayTargetFormat): string[] {
  const chunks: string[] = [];
  for (const line of sseText.split(/\r?\n/u)) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const payload = line.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }
    try {
      const parsed = JSON.parse(payload) as unknown;
      const content = readStreamDelta(asRecord(parsed) ?? {}, format);
      if (content.length > 0) {
        chunks.push(content);
      }
    } catch {
      continue;
    }
  }
  return chunks;
}

function readStreamDelta(parsed: JsonRecord, format: ModelGatewayTargetFormat): string {
  if (format === "chatCompletions") {
    const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
    const firstChoice = asRecord(choices[0]);
    const delta = asRecord(firstChoice?.delta) ?? {};
    return typeof delta.content === "string" ? delta.content : "";
  }
  if (format === "anthropic") {
    const delta = asRecord(parsed.delta) ?? {};
    return typeof delta.text === "string" ? delta.text : "";
  }
  // Only response.output_text.delta carries display text. Other string `delta`
  // payloads (e.g. response.function_call_arguments.delta argument fragments)
  // must not leak into the text stream.
  if (parsed.type !== "response.output_text.delta") {
    return "";
  }
  return typeof parsed.delta === "string" ? parsed.delta : "";
}

function readSseBlockTextDelta(block: string, format: ModelGatewayTargetFormat): string {
  const data = block
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .filter((payload) => payload.length > 0 && payload !== "[DONE]")
    .join("\n");
  if (!data) {
    return "";
  }
  try {
    return readStreamDelta(asRecord(JSON.parse(data) as unknown) ?? {}, format);
  } catch {
    return "";
  }
}

function createStreamFormatter(targetFormat: ModelGatewayTargetFormat): {
  start: () => string;
  delta: (text: string) => string;
  toolCall?: (call: { id: string; name: string; arguments: string }) => string;
  finish: (hasToolCalls?: boolean) => string;
} {
  if (targetFormat === "anthropic") {
    let blockIndex = 0;
    return {
      start: () =>
        [
          sseEvent("message_start", {
            type: "message_start",
            message: {
              id: `msg_${Date.now()}`,
              type: "message",
              role: "assistant",
              content: [],
              model: "",
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          }),
          sseEvent("content_block_start", {
            type: "content_block_start",
            index: 0,
            content_block: { type: "text", text: "" },
          }),
        ].join(""),
      delta: (text: string) =>
        sseEvent("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        }),
      toolCall: (call) => {
        blockIndex += 1;
        const idx = blockIndex;
        return [
          sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
          sseEvent("content_block_start", {
            type: "content_block_start",
            index: idx,
            content_block: {
              type: "tool_use",
              id: call.id || `toolu_${Date.now()}`,
              name: call.name,
              input: {},
            },
          }),
          sseEvent("content_block_delta", {
            type: "content_block_delta",
            index: idx,
            delta: { type: "input_json_delta", partial_json: call.arguments },
          }),
          sseEvent("content_block_stop", { type: "content_block_stop", index: idx }),
        ].join("");
      },
      finish: (hasToolCalls) =>
        [
          ...(hasToolCalls
            ? []
            : [sseEvent("content_block_stop", { type: "content_block_stop", index: 0 })]),
          sseEvent("message_delta", {
            type: "message_delta",
            delta: {
              stop_reason: hasToolCalls ? "tool_use" : "end_turn",
              stop_sequence: null,
            },
            usage: { output_tokens: 0 },
          }),
          sseEvent("message_stop", { type: "message_stop" }),
        ].join(""),
    };
  }

  if (targetFormat === "chatCompletions") {
    const id = `chatcmpl_${Date.now()}`;
    let toolCallIndex = 0;
    return {
      start: () => "",
      delta: (text: string) =>
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
        })}\n\n`,
      toolCall: (call) => {
        const index = toolCallIndex;
        toolCallIndex += 1;
        return `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index,
                    id: call.id && call.id.length > 0 ? call.id : newToolCallId(),
                    type: "function",
                    function: { name: call.name, arguments: call.arguments },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`;
      },
      finish: (hasToolCalls) =>
        [
          `data: ${JSON.stringify({
            id,
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: hasToolCalls ? "tool_calls" : "stop",
              },
            ],
          })}\n\n`,
          "data: [DONE]\n\n",
        ].join(""),
    };
  }

  const responseId = `resp_${Date.now()}`;
  const itemId = `msg_${Date.now()}`;
  const chunks: string[] = [];
  const toolCallItems: JsonRecord[] = [];
  let outputIndex = 0;
  return {
    start: () =>
      [
        sseEvent("response.created", {
          type: "response.created",
          response: {
            id: responseId,
            object: "response",
            status: "in_progress",
            output: [],
            output_text: "",
          },
        }),
        sseEvent("response.output_item.added", {
          type: "response.output_item.added",
          output_index: 0,
          item: {
            id: itemId,
            type: "message",
            status: "in_progress",
            role: "assistant",
            content: [],
          },
        }),
        sseEvent("response.content_part.added", {
          type: "response.content_part.added",
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        }),
      ].join(""),
    delta: (text: string) => {
      chunks.push(text);
      return sseEvent("response.output_text.delta", {
        type: "response.output_text.delta",
        item_id: itemId,
        output_index: 0,
        content_index: 0,
        delta: text,
      });
    },
    toolCall: (call) => {
      outputIndex += 1;
      // One id for both fields — dual Date.now() previously could desync call_id pairing.
      const callId = call.id && call.id.length > 0 ? call.id : newToolCallId();
      const fcItem = {
        type: "function_call",
        id: callId,
        call_id: callId,
        name: call.name,
        arguments: sanitizeToolCallArguments(call.name, call.arguments),
        status: "completed",
      };
      toolCallItems.push(fcItem);
      return [
        sseEvent("response.output_item.added", {
          type: "response.output_item.added",
          output_index: outputIndex,
          item: fcItem,
        }),
        sseEvent("response.output_item.done", {
          type: "response.output_item.done",
          output_index: outputIndex,
          item: fcItem,
        }),
      ].join("");
    },
    finish: (hasToolCalls?: boolean) => {
      void hasToolCalls;
      const fullText = chunks.join("");
      const messageItem = {
        id: itemId,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: fullText, annotations: [] }],
      };
      return [
        sseEvent("response.output_text.done", {
          type: "response.output_text.done",
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          text: fullText,
        }),
        sseEvent("response.content_part.done", {
          type: "response.content_part.done",
          item_id: itemId,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: fullText, annotations: [] },
        }),
        sseEvent("response.output_item.done", {
          type: "response.output_item.done",
          output_index: 0,
          item: messageItem,
        }),
        sseEvent("response.completed", {
          type: "response.completed",
          response: {
            id: responseId,
            object: "response",
            status: "completed",
            output: [messageItem, ...toolCallItems],
            output_text: fullText,
          },
        }),
        "data: [DONE]\n\n",
      ].join("");
    },
  };
}

function createStreamingTextTransform(
  targetFormat: ModelGatewayTargetFormat,
  upstreamFormat: ModelGatewayTargetFormat,
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const formatter = createStreamFormatter(targetFormat);
  let buffer = "";
  // Track tool calls across chunks so we can emit them on finish. Text deltas
  // are still streamed live for responsiveness.
  const toolCallAccumulator = new Map<number, ToolCallAccumulatorEntry>();
  const responsesToolCallState: ResponsesToolCallState = { itemSeq: new Map(), nextIndex: 0 };

  function emit(value: string, controller: TransformStreamDefaultController<Uint8Array>): void {
    if (value.length > 0) {
      controller.enqueue(encoder.encode(value));
    }
  }

  function drainCompleteBlocks(controller: TransformStreamDefaultController<Uint8Array>): void {
    while (true) {
      const match = /\r?\n\r?\n/u.exec(buffer);
      if (!match) {
        return;
      }
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      // First try text delta (streamed live)
      const text = readSseBlockTextDelta(block, upstreamFormat);
      if (text.length > 0) {
        emit(formatter.delta(text), controller);
      }
      // Then accumulate tool_calls deltas (emitted on finish)
      if (upstreamFormat === "chatCompletions") {
        accumulateChatToolCallDeltas(block, toolCallAccumulator);
      } else if (upstreamFormat === "anthropic") {
        accumulateAnthropicToolCallDeltas(block, toolCallAccumulator);
      } else if (upstreamFormat === "responses") {
        accumulateResponsesToolCallDeltas(block, toolCallAccumulator, responsesToolCallState);
      }
    }
  }

  return new TransformStream({
    start(controller) {
      emit(formatter.start(), controller);
    },
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      drainCompleteBlocks(controller);
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer.trim().length > 0) {
        const text = readSseBlockTextDelta(buffer, upstreamFormat);
        if (text.length > 0) {
          emit(formatter.delta(text), controller);
        }
        if (upstreamFormat === "chatCompletions") {
          accumulateChatToolCallDeltas(buffer, toolCallAccumulator);
        } else if (upstreamFormat === "anthropic") {
          accumulateAnthropicToolCallDeltas(buffer, toolCallAccumulator);
        } else if (upstreamFormat === "responses") {
          accumulateResponsesToolCallDeltas(buffer, toolCallAccumulator, responsesToolCallState);
        }
      }
      // Emit accumulated tool calls before finish. Fill missing ids once so
      // Responses call_id pairing stays stable across the whole item.
      const toolCalls = [...toolCallAccumulator.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => {
          if (!tc.id) {
            tc.id = newToolCallId();
          }
          return tc;
        });
      if (toolCalls.length > 0) {
        for (const tc of toolCalls) {
          emit(formatter.toolCall?.(tc) ?? "", controller);
        }
      }
      emit(formatter.finish(toolCalls.length > 0), controller);
    },
  });
}

interface ToolCallAccumulatorEntry {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Parses a chatCompletions SSE block for tool_calls deltas and accumulates them
 * by index, concatenating argument fragments into complete tool calls.
 *
 * Some upstreams omit `tool_calls[].index` on argument fragments. When the index
 * is missing, the fragment continues the last in-flight tool call (empty name,
 * no new id) or starts a new one (name/id present) at the next index.
 * @param block A single SSE block (double-newline-terminated chunk)
 * @param accumulator Map keyed by tool_calls index to the accumulated call
 */
// eslint-disable-next-line complexity
function accumulateChatToolCallDeltas(
  block: string,
  accumulator: Map<number, ToolCallAccumulatorEntry>,
): void {
  for (const line of block.split(/\r?\n/u)) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const payload = line.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }
    try {
      const parsed = JSON.parse(payload) as unknown;
      const record = asRecord(parsed) ?? {};
      const choices = Array.isArray(record.choices) ? record.choices : [];
      const firstChoice = asRecord(choices[0]);
      const delta = asRecord(firstChoice?.delta) ?? {};
      const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const tc of toolCalls) {
        const tcRecord = asRecord(tc);
        if (!tcRecord) continue;
        const fn = asRecord(tcRecord.function) ?? {};
        let index: number;
        if (typeof tcRecord.index === "number") {
          index = tcRecord.index;
        } else {
          index = resolveMissingToolCallIndex(tcRecord, fn, accumulator);
        }
        const existing = accumulator.get(index) ?? { id: "", name: "", arguments: "" };
        if (typeof tcRecord.id === "string" && existing.id === "") {
          existing.id = tcRecord.id;
        }
        if (typeof fn.name === "string" && existing.name === "") {
          existing.name = fn.name;
        }
        if (typeof fn.arguments === "string") {
          existing.arguments += fn.arguments;
        }
        accumulator.set(index, existing);
      }
    } catch {
      // Ignore malformed deltas
    }
  }
}

/**
 * Resolves the tool_calls index for a delta that omits `index`: continue the last
 * in-flight tool call when the fragment carries no name and no new id, otherwise
 * allocate the next index.
 * @param tcRecord The raw tool_calls delta entry
 * @param fn The parsed `function` record of the delta
 * @param accumulator Current accumulator state
 * @returns The index the fragment belongs to
 */
function resolveMissingToolCallIndex(
  tcRecord: JsonRecord,
  fn: JsonRecord,
  accumulator: Map<number, ToolCallAccumulatorEntry>,
): number {
  const lastKey = accumulator.size > 0 ? Math.max(...accumulator.keys()) : undefined;
  if (lastKey === undefined) {
    return 0;
  }
  const deltaId = typeof tcRecord.id === "string" ? tcRecord.id : "";
  const deltaName = typeof fn.name === "string" ? fn.name : "";
  const lastEntry = accumulator.get(lastKey);
  const startsNewTool = deltaName.length > 0 || (deltaId.length > 0 && deltaId !== lastEntry?.id);
  return startsNewTool ? lastKey + 1 : lastKey;
}

/**
 * Parses an Anthropic SSE block for tool_use content_block events and accumulates
 * `input_json_delta` fragments keyed by content_block index, so tool calls from
 * an Anthropic upstream survive the bridge into chat/responses targets.
 * @param block A single SSE block (double-newline-terminated chunk)
 * @param accumulator Map keyed by content_block index to the accumulated call
 */
// eslint-disable complexity, max-depth
function accumulateAnthropicToolCallDeltas(
  block: string,
  accumulator: Map<number, ToolCallAccumulatorEntry>,
): void {
  for (const line of block.split(/\r?\n/u)) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const payload = line.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }
    try {
      const parsed = JSON.parse(payload) as unknown;
      const record = asRecord(parsed) ?? {};
      const eventType = typeof record.type === "string" ? record.type : "";
      if (eventType === "content_block_start") {
        const index = typeof record.index === "number" ? record.index : 0;
        const contentBlock = asRecord(record.content_block) ?? {};
        if (contentBlock.type === "tool_use" && !accumulator.has(index)) {
          accumulator.set(index, {
            id: typeof contentBlock.id === "string" ? contentBlock.id : "",
            name: typeof contentBlock.name === "string" ? contentBlock.name : "",
            arguments: "",
          });
        }
      } else if (eventType === "content_block_delta") {
        const index = typeof record.index === "number" ? record.index : 0;
        const delta = asRecord(record.delta) ?? {};
        if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
          const existing = accumulator.get(index) ?? { id: "", name: "", arguments: "" };
          existing.arguments += delta.partial_json;
          accumulator.set(index, existing);
        }
      }
    } catch {
      // Ignore malformed deltas
    }
  }
}

interface ResponsesToolCallState {
  /** Responses item_id → accumulator index, kept across SSE blocks */
  itemSeq: Map<string, number>;
  /** Next accumulator index to allocate for a new function_call item */
  nextIndex: number;
}

/**
 * Parses a Responses-API SSE block for function_call items and accumulates them
 * keyed by an allocated sequence number, so tool calls from a Responses upstream
 * survive the bridge into chat/anthropic targets.
 * @param block A single SSE block (double-newline-terminated chunk)
 * @param accumulator Map keyed by sequence number to the accumulated call
 * @param state Cross-block item_id → index mapping
 */
// eslint-disable complexity, max-depth
function accumulateResponsesToolCallDeltas(
  block: string,
  accumulator: Map<number, ToolCallAccumulatorEntry>,
  state: ResponsesToolCallState,
): void {
  for (const line of block.split(/\r?\n/u)) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const payload = line.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }
    try {
      const parsed = JSON.parse(payload) as unknown;
      const record = asRecord(parsed) ?? {};
      const eventType = typeof record.type === "string" ? record.type : "";
      if (eventType === "response.output_item.added") {
        const item = asRecord(record.item) ?? {};
        if (item.type === "function_call") {
          const itemId = firstStringField(item, "id", "call_id");
          let index = itemId.length > 0 ? state.itemSeq.get(itemId) : undefined;
          if (index === undefined) {
            index = state.nextIndex;
            state.nextIndex += 1;
            if (itemId.length > 0) {
              state.itemSeq.set(itemId, index);
            }
          }
          const existing = accumulator.get(index) ?? { id: "", name: "", arguments: "" };
          if (existing.id === "") {
            existing.id = firstStringField(item, "id", "call_id");
          }
          if (existing.name === "") {
            existing.name = typeof item.name === "string" ? item.name : "";
          }
          if (existing.arguments === "" && typeof item.arguments === "string") {
            existing.arguments = item.arguments;
          }
          accumulator.set(index, existing);
        }
      } else if (eventType === "response.function_call_arguments.delta") {
        const itemId = typeof record.item_id === "string" ? record.item_id : "";
        const index = itemId.length > 0 ? state.itemSeq.get(itemId) : undefined;
        if (index === undefined) {
          continue;
        }
        const existing = accumulator.get(index) ?? { id: "", name: "", arguments: "" };
        if (typeof record.delta === "string") {
          existing.arguments += record.delta;
        }
        accumulator.set(index, existing);
      }
    } catch {
      // Ignore malformed deltas
    }
  }
}

function streamTextAsAnthropic(contentChunks: string[], status: number): Response {
  const body = [
    sseEvent("message_start", {
      type: "message_start",
      message: {
        id: `msg_${Date.now()}`,
        type: "message",
        role: "assistant",
        content: [],
        model: "",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }),
    sseEvent("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }),
    ...contentChunks.map((text) =>
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      }),
    ),
    sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
    sseEvent("message_stop", { type: "message_stop" }),
  ].join("");
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

function streamTextAsChat(contentChunks: string[], status: number): Response {
  const id = `chatcmpl_${Date.now()}`;
  const body = [
    ...contentChunks.map(
      (text) =>
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
        })}\n\n`,
    ),
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

function streamTextAsResponses(contentChunks: string[], status: number): Response {
  const responseId = `resp_${Date.now()}`;
  const itemId = `msg_${Date.now()}`;
  const fullText = contentChunks.join("");
  const messageItem = {
    id: itemId,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text: fullText, annotations: [] }],
  };
  const body = [
    sseEvent("response.created", {
      type: "response.created",
      response: {
        id: responseId,
        object: "response",
        status: "in_progress",
        output: [],
        output_text: "",
      },
    }),
    sseEvent("response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        id: itemId,
        type: "message",
        status: "in_progress",
        role: "assistant",
        content: [],
      },
    }),
    sseEvent("response.content_part.added", {
      type: "response.content_part.added",
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    }),
    ...contentChunks.map((text) =>
      sseEvent("response.output_text.delta", {
        type: "response.output_text.delta",
        item_id: itemId,
        output_index: 0,
        content_index: 0,
        delta: text,
      }),
    ),
    sseEvent("response.output_text.done", {
      type: "response.output_text.done",
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      text: fullText,
    }),
    sseEvent("response.content_part.done", {
      type: "response.content_part.done",
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: fullText, annotations: [] },
    }),
    sseEvent("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: messageItem,
    }),
    sseEvent("response.completed", {
      type: "response.completed",
      response: {
        id: responseId,
        object: "response",
        status: "completed",
        output: [messageItem],
        output_text: fullText,
      },
    }),
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

async function convertStreamResponse(
  targetFormat: ModelGatewayTargetFormat,
  upstreamFormat: ModelGatewayTargetFormat,
  response: Response,
): Promise<Response> {
  if (!response.body) {
    const sourceText = await response.text();
    const contentChunks = parseStreamTextDeltas(sourceText, upstreamFormat);
    if (targetFormat === "anthropic") {
      return streamTextAsAnthropic(contentChunks, response.status);
    }
    if (targetFormat === "chatCompletions") {
      return streamTextAsChat(contentChunks, response.status);
    }
    return streamTextAsResponses(contentChunks, response.status);
  }
  return new Response(
    response.body.pipeThrough(createStreamingTextTransform(targetFormat, upstreamFormat)),
    {
      status: response.status,
      headers: { "content-type": "text/event-stream" },
    },
  );
}

function buildUpstreamBody(
  targetFormat: ModelGatewayTargetFormat,
  upstreamFormat: ModelGatewayTargetFormat,
  requestBody: JsonRecord,
): JsonRecord {
  if (targetFormat === upstreamFormat) {
    return upstreamFormat === "chatCompletions"
      ? normalizeChatUpstreamBody(requestBody)
      : requestBody;
  }
  if (upstreamFormat === "chatCompletions") {
    const chatBody =
      targetFormat === "anthropic" ? anthropicToChat(requestBody) : responsesToChat(requestBody);
    return normalizeChatUpstreamBody(chatBody);
  }
  if (upstreamFormat === "anthropic") {
    return targetFormat === "chatCompletions"
      ? chatToAnthropic(requestBody)
      : responsesToAnthropic(requestBody);
  }
  return targetFormat === "chatCompletions"
    ? chatToResponses(requestBody)
    : anthropicToResponses(requestBody);
}

function convertJsonResponseBody(
  targetFormat: ModelGatewayTargetFormat,
  upstreamFormat: ModelGatewayTargetFormat,
  requestBody: JsonRecord,
  json: JsonRecord,
): JsonRecord {
  if (targetFormat === "anthropic") {
    const chatResponse =
      upstreamFormat === "chatCompletions"
        ? json
        : responsesToChatResponse(json, requestBody.model);
    return chatToAnthropicResponse(chatResponse, requestBody.model);
  }
  if (targetFormat === "chatCompletions") {
    return upstreamFormat === "anthropic"
      ? anthropicToChatResponse(json, requestBody.model)
      : responsesToChatResponse(json, requestBody.model);
  }
  const chatResponse =
    upstreamFormat === "anthropic" ? anthropicToChatResponse(json, requestBody.model) : json;
  return chatToResponsesResponse(chatResponse, requestBody.model);
}

async function convertUpstreamResponse(
  targetFormat: ModelGatewayTargetFormat,
  upstreamFormat: ModelGatewayTargetFormat,
  requestBody: JsonRecord,
  response: Response,
): Promise<Response> {
  if (targetFormat === upstreamFormat || !response.ok) {
    return response;
  }
  if (requestBody.stream === true) {
    return convertStreamResponse(targetFormat, upstreamFormat, response);
  }
  const json = (await response.json()) as JsonRecord;
  return Response.json(convertJsonResponseBody(targetFormat, upstreamFormat, requestBody, json), {
    status: response.status,
  });
}

function buildUpstreamHeaders(
  upstreamFormat: ModelGatewayTargetFormat,
  apiKey: string,
): HeadersInit {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
  if (upstreamFormat === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  }
  return headers;
}

function readChatResponseText(response: JsonRecord): string {
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);
  const content = readTextContent(message?.content);
  if (content.trim().length > 0) {
    return content;
  }
  return typeof message?.reasoning_content === "string" ? message.reasoning_content : "";
}

function buildSyntheticChatResponse(model: unknown, text: string): JsonRecord {
  const modelId = typeof model === "string" && model.trim().length > 0 ? model : "synthetic";
  return {
    id: `chatcmpl_synthetic_${Date.now()}`,
    object: "chat.completion",
    model: modelId,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text,
        },
        finish_reason: "stop",
      },
    ],
  };
}

function getChatMessages(
  targetFormat: ModelGatewayTargetFormat,
  requestBody: JsonRecord,
): JsonRecord[] {
  const chatBody =
    targetFormat === "chatCompletions"
      ? normalizeChatUpstreamBody(requestBody)
      : buildUpstreamBody(targetFormat, "chatCompletions", requestBody);
  return (Array.isArray(chatBody.messages) ? chatBody.messages : []).flatMap((message) => {
    const record = asRecord(message);
    return record ? [record] : [];
  });
}

function buildReferenceSystemPrompt(references: string[], systemPrompt?: string): string {
  const basePrompt =
    typeof systemPrompt === "string" && systemPrompt.trim().length > 0
      ? systemPrompt.trim()
      : SYNTHETIC_MODEL_SYSTEM_PROMPT;
  if (references.length === 0) {
    return basePrompt;
  }
  const referenceText = references
    .map((reference, index) => `${index + 1}. ${reference}`)
    .join("\n");
  return `${basePrompt}\n${referenceText}`;
}

function withReferenceSystemMessage(
  messages: JsonRecord[],
  references: string[],
  systemPrompt?: string,
): JsonRecord[] {
  if (references.length === 0 && !systemPrompt?.trim()) {
    return messages;
  }
  return [
    {
      role: "system",
      content: buildReferenceSystemPrompt(references, systemPrompt),
    },
    ...messages,
  ];
}

function buildSyntheticChatBody(input: {
  requestBody: JsonRecord;
  messages: JsonRecord[];
  model: string;
  parameters?: SyntheticModelParameters;
}): JsonRecord {
  const { requestBody, messages, model, parameters } = input;
  const options: JsonRecord = {};
  for (const key of SYNTHETIC_CHAT_OPTION_KEYS) {
    if (requestBody[key] !== undefined) {
      options[key] = requestBody[key];
    }
  }
  if (typeof parameters?.temperature === "number") {
    options.temperature = parameters.temperature;
  }
  if (typeof parameters?.maxTokens === "number") {
    options.max_tokens = parameters.maxTokens;
  }
  if (options.max_tokens === undefined && typeof requestBody.max_output_tokens === "number") {
    options.max_tokens = requestBody.max_output_tokens;
  }
  return {
    ...options,
    model,
    messages,
    stream: false,
  };
}

async function fetchGatewayChatCompletion(input: {
  selection: UpstreamSelection;
  chatBody: JsonRecord;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
}): Promise<JsonRecord> {
  const { selection, chatBody, fetchImpl, signal } = input;
  const upstreamBody = applyUpstreamCompatibility(
    selection.format,
    selection.upstream,
    buildUpstreamBody("chatCompletions", selection.format, chatBody),
  );
  const response = await fetchImpl(selection.url, {
    method: "POST",
    headers: buildUpstreamHeaders(selection.format, selection.upstream.apiKey),
    body: JSON.stringify(upstreamBody),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Synthetic model upstream request failed with HTTP ${response.status}`);
  }
  const json = (await response.json()) as JsonRecord;
  return selection.format === "chatCompletions"
    ? json
    : convertJsonResponseBody("chatCompletions", selection.format, chatBody, json);
}

function mergeSyntheticParameters(
  ...parameters: Array<SyntheticModelParameters | undefined>
): SyntheticModelParameters {
  return Object.assign({}, ...parameters.filter(Boolean));
}

function createLegacyMoaPlan(syntheticModel: SyntheticModelConfig): SyntheticModelMoa {
  const rounds = Math.max(1, Math.min(2, syntheticModel.rounds ?? 1));
  const nodes = syntheticModel.references.map((reference) => ({ model: reference.model }));
  return {
    layers: Array.from({ length: rounds }, (_, index) => ({
      id: `layer-${index + 1}`,
      label: `Layer ${index + 1}`,
      nodes,
    })),
    aggregator: { model: syntheticModel.aggregatorModel },
  };
}

function resolveSyntheticMoaPlan(syntheticModel: SyntheticModelConfig): SyntheticModelMoa {
  const plan = syntheticModel.moa ?? createLegacyMoaPlan(syntheticModel);
  return {
    ...plan,
    layers: plan.layers.slice(0, 2),
  };
}

async function runSyntheticNode(input: {
  selection: UpstreamSelection;
  fetchImpl: typeof fetch;
  requestBody: JsonRecord;
  messages: JsonRecord[];
  model: string;
  parameters?: SyntheticModelParameters;
  id?: string;
  signal?: AbortSignal;
}): Promise<MoaTestNodeTrace> {
  const startedAt = performance.now();
  try {
    const chatResponse = await fetchGatewayChatCompletion({
      selection: input.selection,
      fetchImpl: input.fetchImpl,
      signal: input.signal,
      chatBody: buildSyntheticChatBody({
        requestBody: input.requestBody,
        messages: input.messages,
        model: input.model,
        parameters: input.parameters,
      }),
    });
    return {
      id: input.id ?? null,
      model: input.model,
      status: "success",
      output: readChatResponseText(chatResponse).trim(),
      error: null,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    if (input.signal?.aborted) {
      input.signal.throwIfAborted();
    }
    return {
      id: input.id ?? null,
      model: input.model,
      status: "error",
      output: null,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
}

async function runSyntheticModelWithTrace(input: {
  gateway: ModelGatewayConfig;
  syntheticModel: SyntheticModelConfig;
  targetFormat: ModelGatewayTargetFormat;
  requestBody: JsonRecord;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
}): Promise<MoaTestResult> {
  const { gateway, syntheticModel, targetFormat, requestBody, fetchImpl, signal } = input;
  signal?.throwIfAborted();
  const startedAt = performance.now();
  const messages = getChatMessages(targetFormat, requestBody);
  const selection = selectUpstream(gateway, "chatCompletions");
  const plan = resolveSyntheticMoaPlan(syntheticModel);
  const layerTraces: MoaTestLayerTrace[] = [];
  let references: string[] = [];

  for (const layer of plan.layers) {
    signal?.throwIfAborted();
    const layerParameters = mergeSyntheticParameters(plan.defaults, layer.parameters);
    const layerMessages = withReferenceSystemMessage(
      messages,
      references,
      layerParameters.systemPrompt,
    );
    if (layer.nodes.length === 0) {
      layerTraces.push({
        id: layer.id,
        label: layer.label ?? null,
        nodes: [],
      });
      continue;
    }
    const nodes = await Promise.all(
      layer.nodes.map((node) =>
        runSyntheticNode({
          selection,
          fetchImpl,
          signal,
          requestBody,
          messages: layerMessages,
          model: node.model,
          id: node.id,
          parameters: mergeSyntheticParameters(layerParameters, node.parameters),
        }),
      ),
    );
    layerTraces.push({
      id: layer.id,
      label: layer.label ?? null,
      nodes,
    });
    references = nodes
      .filter((node) => node.status === "success" && node.output?.trim())
      .map((node) => node.output ?? "");
    if (references.length === 0) {
      throw new Error(`MoA layer "${layer.id}" produced no successful outputs`);
    }
  }

  const aggregatorStartedAt = performance.now();
  const aggregatorParameters = mergeSyntheticParameters(plan.defaults, plan.aggregator.parameters);
  signal?.throwIfAborted();
  try {
    const aggregateResponse = await fetchGatewayChatCompletion({
      selection,
      fetchImpl,
      signal,
      chatBody: buildSyntheticChatBody({
        requestBody,
        messages: withReferenceSystemMessage(
          messages,
          references,
          aggregatorParameters.systemPrompt,
        ),
        model: plan.aggregator.model,
        parameters: aggregatorParameters,
      }),
    });
    const finalText = readChatResponseText(aggregateResponse).trim();
    return {
      finalText,
      durationMs: Math.round(performance.now() - startedAt),
      layers: layerTraces,
      aggregator: {
        model: plan.aggregator.model,
        status: "success",
        output: finalText,
        error: null,
        durationMs: Math.round(performance.now() - aggregatorStartedAt),
      },
    };
  } catch (error) {
    if (signal?.aborted) {
      signal.throwIfAborted();
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      finalText: "",
      durationMs: Math.round(performance.now() - startedAt),
      layers: layerTraces,
      aggregator: {
        model: plan.aggregator.model,
        status: "error",
        output: null,
        error: message,
        durationMs: Math.round(performance.now() - aggregatorStartedAt),
      },
    };
  }
}

async function runSyntheticModel(input: {
  gateway: ModelGatewayConfig;
  syntheticModel: SyntheticModelConfig;
  targetFormat: ModelGatewayTargetFormat;
  requestBody: JsonRecord;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
}): Promise<string> {
  const result = await runSyntheticModelWithTrace(input);
  if (result.aggregator.status === "error") {
    throw new Error(result.aggregator.error ?? "MoA aggregator failed");
  }
  return result.finalText;
}

export interface ModelGatewayTestResult {
  ok: boolean;
  durationMs: number;
  status: number | null;
  error: string | null;
}

/**
 * Sends a minimal non-streaming completion through a gateway and measures the
 * end-to-end response latency.
 * @param gateway Gateway configuration to test
 * @param modelId Model id sent to the selected upstream
 * @param fetchImpl Optional fetch implementation for tests
 * @returns Connectivity, HTTP status, error, and elapsed milliseconds
 */
function buildModelGatewayTestRequestBody(
  targetFormat: ModelGatewayTargetFormat,
  modelId: string,
): JsonRecord {
  if (targetFormat === "anthropic") {
    return {
      model: modelId,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    };
  }
  if (targetFormat === "responses") {
    return {
      model: modelId,
      max_output_tokens: 1,
      input: [{ type: "message", role: "user", content: "ping" }],
    };
  }
  return {
    model: modelId,
    max_tokens: 1,
    messages: [{ role: "user", content: "ping" }],
  };
}

export async function runModelGatewayTest(input: {
  gateway: ModelGatewayConfig;
  modelId: string;
  targetFormat?: ModelGatewayTargetFormat;
  fetchImpl?: typeof fetch;
}): Promise<ModelGatewayTestResult> {
  const { gateway, modelId, targetFormat, fetchImpl = fetch } = input;
  const enabledFormats: ModelGatewayTargetFormat[] = targetFormat
    ? [targetFormat]
    : ["anthropic", "responses", "chatCompletions"];
  const selectedFormat = enabledFormats.find((format) =>
    isConfigured(getUpstreamForFormat(gateway, format)),
  );
  if (!selectedFormat) {
    return {
      ok: false,
      durationMs: 0,
      status: null,
      error: "No enabled upstream is configured",
    };
  }

  const requestBody = buildModelGatewayTestRequestBody(selectedFormat, modelId);

  const startedAt = performance.now();
  try {
    const response = await handleModelGatewayRequest({
      gateway,
      targetFormat: selectedFormat,
      requestBody,
      fetchImpl,
    });
    await response.arrayBuffer();
    return {
      ok: response.ok,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      status: response.status,
      error: response.ok ? null : `Upstream returned HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runSyntheticModelTest(input: {
  gateway: ModelGatewayConfig;
  syntheticModel: SyntheticModelConfig;
  prompt: string;
  fetchImpl?: typeof fetch;
}): Promise<MoaTestResult> {
  return runSyntheticModelWithTrace({
    gateway: input.gateway,
    syntheticModel: input.syntheticModel,
    targetFormat: "chatCompletions",
    requestBody: {
      model: input.syntheticModel.id,
      messages: [{ role: "user", content: input.prompt }],
    },
    fetchImpl: input.fetchImpl ?? fetch,
  });
}

function syntheticResponseForTarget(input: {
  targetFormat: ModelGatewayTargetFormat;
  requestBody: JsonRecord;
  text: string;
}): Response {
  const { targetFormat, requestBody, text } = input;
  if (requestBody.stream === true) {
    if (targetFormat === "anthropic") {
      return streamTextAsAnthropic([text], 200);
    }
    if (targetFormat === "chatCompletions") {
      return streamTextAsChat([text], 200);
    }
    return streamTextAsResponses([text], 200);
  }
  const chatResponse = buildSyntheticChatResponse(requestBody.model, text);
  const body =
    targetFormat === "chatCompletions"
      ? chatResponse
      : convertJsonResponseBody(targetFormat, "chatCompletions", requestBody, chatResponse);
  return Response.json(body, { status: 200 });
}

/**
 * Sends a model gateway request and converts the upstream response when formats differ.
 * @param options Gateway selection, request payload, fetch implementation, and cancellation signal
 * @returns The upstream or converted response without consuming its streaming body
 * @throws If selection, upstream transport, conversion, or synthetic generation fails
 */
export async function handleModelGatewayRequest({
  gateway,
  targetFormat,
  requestBody,
  fetchImpl = fetch,
  signal,
}: HandleModelGatewayRequestOptions): Promise<Response> {
  const syntheticModel = findSyntheticModel(gateway, requestBody.model);
  if (syntheticModel) {
    const text = await runSyntheticModel({
      gateway,
      syntheticModel,
      targetFormat,
      requestBody,
      fetchImpl,
      signal,
    });
    return syntheticResponseForTarget({ targetFormat, requestBody, text });
  }

  const selection = selectUpstream(gateway, targetFormat);
  const upstreamBody = applyUpstreamCompatibility(
    selection.format,
    selection.upstream,
    buildUpstreamBody(targetFormat, selection.format, requestBody),
  );
  const response = await fetchImpl(selection.url, {
    method: "POST",
    headers: buildUpstreamHeaders(selection.format, selection.upstream.apiKey),
    body: JSON.stringify(upstreamBody),
    signal,
  });
  return convertUpstreamResponse(targetFormat, selection.format, requestBody, response);
}
