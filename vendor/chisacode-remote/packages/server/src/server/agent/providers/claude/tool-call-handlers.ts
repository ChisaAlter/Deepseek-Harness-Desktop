import fs from "node:fs";
import path from "node:path";
import type { SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";

import { parsePartialJsonObject } from "./partial-json.js";
import {
  mapClaudeCanceledToolCall,
  mapClaudeCompletedToolCall,
  mapClaudeFailedToolCall,
  mapClaudeRunningToolCall,
} from "./tool-call-mapper.js";
import type { AgentMetadata, AgentTimelineItem } from "../../agent-sdk-types.js";

export interface ClaudeToolContentChunk {
  type: string;
  [key: string]: unknown;
}

type ToolUseClassification = "generic" | "command" | "file_change";

export interface ClaudeToolUseCacheEntry {
  id: string;
  name: string;
  server: string;
  classification: ToolUseClassification;
  started: boolean;
  commandText?: string;
  files?: { path: string; kind: string }[];
  input?: AgentMetadata | null;
}

interface ClaudeToolCallHandlerOptions {
  getCwd: () => string | undefined;
  emitTimeline: (item: Extract<AgentTimelineItem, { type: "tool_call" }>) => void;
  deleteSidechain: (toolUseId: string) => void;
  clearSidechains: () => void;
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isMetadata(value: unknown): value is AgentMetadata {
  return typeof value === "object" && value !== null;
}

function isClaudeContentChunk(value: unknown): value is ClaudeToolContentChunk {
  return isMetadata(value) && typeof value.type === "string";
}

function firstStringField(
  input: Record<string, unknown>,
  primaryKey: string,
  secondaryKey: string,
): string | undefined {
  const primary = input[primaryKey];
  if (typeof primary === "string") return primary;
  const secondary = input[secondaryKey];
  if (typeof secondary === "string") return secondary;
  return undefined;
}

function isToolResultTextBlock(value: unknown): value is { type: "text"; text: string } {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "text" &&
    typeof (value as { text?: unknown }).text === "string"
  );
}

function normalizeForDeterministicString(value: unknown, seen: WeakSet<object>): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "function") {
    return "[function]";
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (typeof value === "undefined") {
    return "[undefined]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForDeterministicString(entry, seen));
  }
  if (typeof value === "object") {
    const objectValue = value;
    if (seen.has(objectValue)) {
      return "[circular]";
    }
    seen.add(objectValue);
    const record = toObjectRecord(value);
    if (!record) {
      seen.delete(objectValue);
      return "[invalid]";
    }
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      normalized[key] = normalizeForDeterministicString(record[key], seen);
    }
    seen.delete(objectValue);
    return normalized;
  }
  return "[unsupported]";
}

function deterministicStringify(value: unknown): string {
  if (typeof value === "undefined") {
    return "";
  }
  try {
    const normalized = normalizeForDeterministicString(value, new WeakSet<object>());
    if (typeof normalized === "string") {
      return normalized;
    }
    return JSON.stringify(normalized);
  } catch {
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return "[unserializable]";
  }
}

function coerceToolResultContentToString(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content) && content.every((block) => isToolResultTextBlock(block))) {
    return content.map((block) => block.text).join("");
  }
  return deterministicStringify(content);
}

function createDefaultClaudeToolUseCacheEntry(
  id: string,
  block: ClaudeToolContentChunk,
): ClaudeToolUseCacheEntry {
  const nameFromBlock =
    typeof block.name === "string" && block.name.length > 0 ? block.name : "tool";
  let server: string;
  if (typeof block.server === "string" && block.server.length > 0) {
    server = block.server;
  } else if (typeof block.name === "string" && block.name.length > 0) {
    server = block.name;
  } else {
    server = "tool";
  }
  return {
    id,
    name: nameFromBlock,
    server,
    classification: "generic",
    started: false,
  };
}

function isCommandExecutionTool(
  normalizedServer: string,
  normalizedTool: string,
  input: AgentMetadata | null | undefined,
): boolean {
  if (
    normalizedServer.includes("bash") ||
    normalizedServer.includes("shell") ||
    normalizedServer.includes("command")
  ) {
    return true;
  }
  if (
    normalizedTool.includes("bash") ||
    normalizedTool.includes("shell") ||
    normalizedTool.includes("command")
  ) {
    return true;
  }
  return Boolean(input && (typeof input.command === "string" || Array.isArray(input.command)));
}

function isFileWriteTool(normalizedTool: string): boolean {
  return (
    normalizedTool.includes("write") ||
    normalizedTool === "write_file" ||
    normalizedTool === "create_file"
  );
}

function isFileEditTool(normalizedTool: string): boolean {
  return (
    normalizedTool.includes("edit") ||
    normalizedTool.includes("patch") ||
    normalizedTool === "apply_patch" ||
    normalizedTool === "apply_diff"
  );
}

function isFileReadTool(normalizedTool: string): boolean {
  return (
    normalizedTool.includes("read") ||
    normalizedTool === "read_file" ||
    normalizedTool === "view_file"
  );
}

/** Owns Claude tool-call lifecycle state and timeline mapping. */
export class ClaudeToolCallHandler {
  private readonly toolUseCache = new Map<string, ClaudeToolUseCacheEntry>();
  private readonly toolUseIndexToId = new Map<number, string>();
  private readonly toolUseInputBuffers = new Map<string, string>();

  constructor(private readonly options: ClaudeToolCallHandlerOptions) {}

  getToolInput(toolUseId: string): AgentMetadata | null {
    return this.toolUseCache.get(toolUseId)?.input ?? null;
  }

  getToolName(toolUseId: string): string | null {
    return this.toolUseCache.get(toolUseId)?.name ?? null;
  }

  getToolUseCache(): ReadonlyMap<string, { input?: AgentMetadata | null }> {
    return this.toolUseCache;
  }

  getToolUseIndexToId(): ReadonlyMap<number, string> {
    return this.toolUseIndexToId;
  }

  getToolUseInputBuffers(): ReadonlyMap<string, string> {
    return this.toolUseInputBuffers;
  }

  handleToolUseStart(block: ClaudeToolContentChunk, items: AgentTimelineItem[]): void {
    const entry = this.upsertToolUseEntry(block);
    if (!entry || entry.started) {
      return;
    }
    entry.started = true;
    this.toolUseCache.set(entry.id, entry);
    this.pushToolCall(
      mapClaudeRunningToolCall({
        name: entry.name,
        callId: entry.id,
        input: entry.input ?? this.normalizeToolInput(block.input) ?? null,
        output: null,
      }),
      items,
    );
  }

  handleToolResult(block: ClaudeToolContentChunk, items: AgentTimelineItem[]): void {
    const entry =
      typeof block.tool_use_id === "string" ? this.toolUseCache.get(block.tool_use_id) : undefined;
    const blockToolName = typeof block.tool_name === "string" ? block.tool_name : undefined;
    const toolName = entry?.name ?? blockToolName ?? "tool";
    const callId =
      typeof block.tool_use_id === "string" && block.tool_use_id.length > 0
        ? block.tool_use_id
        : (entry?.id ?? null);
    const output = this.buildToolOutput(block, entry);

    if (block.is_error) {
      this.pushToolCall(
        mapClaudeFailedToolCall({
          name: toolName,
          callId,
          input: entry?.input ?? null,
          output: output ?? null,
          error: block,
        }),
        items,
      );
    } else {
      this.pushToolCall(
        mapClaudeCompletedToolCall({
          name: toolName,
          callId,
          input: entry?.input ?? null,
          output: output ?? null,
        }),
        items,
      );
    }

    if (typeof block.tool_use_id === "string") {
      this.toolUseCache.delete(block.tool_use_id);
      this.options.deleteSidechain(block.tool_use_id);
    }
  }

  updatePartialEventState(event: SDKPartialAssistantMessage["event"]): boolean {
    if (event.type === "content_block_start") {
      const block = isClaudeContentChunk(event.content_block) ? event.content_block : null;
      if (
        block?.type === "tool_use" &&
        typeof event.index === "number" &&
        typeof block.id === "string"
      ) {
        this.toolUseIndexToId.set(event.index, block.id);
        this.toolUseInputBuffers.delete(block.id);
      }
      return false;
    }
    if (event.type === "content_block_delta") {
      const delta = isClaudeContentChunk(event.delta) ? event.delta : null;
      if (delta?.type === "input_json_delta") {
        const partialJson = typeof delta.partial_json === "string" ? delta.partial_json : undefined;
        this.handleToolInputDelta(event.index, partialJson);
        return true;
      }
      return false;
    }
    if (event.type === "content_block_stop" && typeof event.index === "number") {
      const toolId = this.toolUseIndexToId.get(event.index);
      if (toolId) {
        this.toolUseIndexToId.delete(event.index);
        this.toolUseInputBuffers.delete(toolId);
      }
    }
    return false;
  }

  flushPendingToolCalls(): void {
    for (const [id, entry] of this.toolUseCache) {
      if (entry.started) {
        this.pushToolCall(
          mapClaudeCanceledToolCall({
            name: entry.name,
            callId: id,
            input: entry.input ?? null,
            output: null,
          }),
        );
      }
    }
    this.toolUseCache.clear();
    this.options.clearSidechains();
  }

  private pushToolCall(
    item: Extract<AgentTimelineItem, { type: "tool_call" }> | null,
    target?: AgentTimelineItem[],
  ): void {
    if (!item) {
      return;
    }
    if (target) {
      target.push(item);
      return;
    }
    this.options.emitTimeline(item);
  }

  buildToolOutput(
    block: ClaudeToolContentChunk,
    entry: ClaudeToolUseCacheEntry | undefined,
  ): AgentMetadata | undefined {
    if (block.is_error) {
      return undefined;
    }
    const blockServer = typeof block.server === "string" ? block.server : undefined;
    const blockToolName = typeof block.tool_name === "string" ? block.tool_name : undefined;
    const server = entry?.server ?? blockServer ?? "tool";
    const tool = entry?.name ?? blockToolName ?? "tool";
    const content = coerceToolResultContentToString(block.content);
    const input = entry?.input;
    const structured = this.buildStructuredToolResult(server, tool, content, input);
    if (structured) {
      return structured;
    }

    const result: AgentMetadata = {};
    if (content.length > 0) {
      try {
        result.output = JSON.parse(content);
      } catch {
        result.output = content;
      }
    }
    if (entry?.files?.length) {
      result.files = entry.files;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  private buildStructuredToolResult(
    server: string,
    tool: string,
    output: string,
    input?: AgentMetadata | null,
  ): AgentMetadata | undefined {
    const normalizedServer = server.toLowerCase();
    const normalizedTool = tool.toLowerCase();

    if (isCommandExecutionTool(normalizedServer, normalizedTool, input)) {
      const command = this.extractCommandText(input ?? {}) ?? "command";
      return {
        type: "command",
        command,
        output,
        cwd: typeof input?.cwd === "string" ? input.cwd : undefined,
      };
    }
    if (isFileWriteTool(normalizedTool) && input && typeof input.file_path === "string") {
      return {
        type: "file_write",
        filePath: input.file_path,
        oldContent: "",
        newContent: typeof input.content === "string" ? input.content : output,
      };
    }
    if (isFileEditTool(normalizedTool) && input && typeof input.file_path === "string") {
      const oldContent = firstStringField(input, "old_str", "old_string");
      const newContent = firstStringField(input, "new_str", "new_string");
      const diff = firstStringField(input, "patch", "diff");
      return {
        type: "file_edit",
        filePath: input.file_path,
        diff,
        oldContent,
        newContent,
      };
    }
    if (isFileReadTool(normalizedTool) && input && typeof input.file_path === "string") {
      return {
        type: "file_read",
        filePath: input.file_path,
        content: output,
      };
    }
    return undefined;
  }

  private upsertToolUseEntry(block: ClaudeToolContentChunk): ClaudeToolUseCacheEntry | null {
    const id = typeof block.id === "string" ? block.id : undefined;
    if (!id) {
      return null;
    }
    const existing = this.toolUseCache.get(id) ?? createDefaultClaudeToolUseCacheEntry(id, block);
    if (typeof block.name === "string" && block.name.length > 0) {
      existing.name = block.name;
    }
    if (typeof block.server === "string" && block.server.length > 0) {
      existing.server = block.server;
    } else if (!existing.server) {
      existing.server = existing.name;
    }
    if (
      block.type === "tool_use" ||
      block.type === "mcp_tool_use" ||
      block.type === "server_tool_use"
    ) {
      const input = this.normalizeToolInput(block.input);
      if (input) {
        this.applyToolInput(existing, input);
      }
    }
    this.toolUseCache.set(id, existing);
    return existing;
  }

  private handleToolInputDelta(index: number | undefined, partialJson: string | undefined): void {
    if (typeof index !== "number" || typeof partialJson !== "string") {
      return;
    }
    const toolId = this.toolUseIndexToId.get(index);
    if (!toolId) {
      return;
    }
    const buffer = (this.toolUseInputBuffers.get(toolId) ?? "") + partialJson;
    this.toolUseInputBuffers.set(toolId, buffer);
    const entry = this.toolUseCache.get(toolId);
    const parsed = parsePartialJsonObject(buffer);
    if (!entry || !parsed) {
      return;
    }
    const normalized = this.normalizeToolInput(parsed.value);
    if (!normalized) {
      return;
    }
    if (!parsed.complete && Object.keys(normalized).length === 0) {
      return;
    }
    if (this.areToolInputsEqual(entry.input ?? undefined, normalized)) {
      return;
    }
    this.applyToolInput(entry, normalized);
    this.toolUseCache.set(toolId, entry);
    this.pushToolCall(
      mapClaudeRunningToolCall({
        name: entry.name,
        callId: toolId,
        input: normalized,
        output: null,
      }),
    );
  }

  private normalizeToolInput(input: unknown): AgentMetadata | null {
    return isMetadata(input) ? input : null;
  }

  private areToolInputsEqual(left: AgentMetadata | undefined, right: AgentMetadata): boolean {
    if (!left) {
      return false;
    }
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    return rightKeys.every((key) => left[key] === right[key]);
  }

  private applyToolInput(entry: ClaudeToolUseCacheEntry, input: AgentMetadata): void {
    entry.input = input;
    if (this.isCommandTool(entry.name, input)) {
      entry.classification = "command";
      entry.commandText = this.extractCommandText(input) ?? entry.commandText;
      return;
    }
    const files = this.extractFileChanges(input);
    if (files?.length) {
      entry.classification = "file_change";
      entry.files = files;
    }
  }

  private isCommandTool(name: string, input: AgentMetadata): boolean {
    const normalized = name.toLowerCase();
    if (
      normalized.includes("bash") ||
      normalized.includes("shell") ||
      normalized.includes("terminal") ||
      normalized.includes("command")
    ) {
      return true;
    }
    return typeof input.command === "string" || Array.isArray(input.command);
  }

  private extractCommandText(input: AgentMetadata): string | undefined {
    const command = input.command;
    if (typeof command === "string" && command.length > 0) {
      return command;
    }
    if (Array.isArray(command)) {
      const tokens = command.filter((value): value is string => typeof value === "string");
      if (tokens.length > 0) {
        return tokens.join(" ");
      }
    }
    if (typeof input.description === "string" && input.description.length > 0) {
      return input.description;
    }
    return undefined;
  }

  private extractFileChanges(input: AgentMetadata): { path: string; kind: string }[] | undefined {
    if (typeof input.file_path === "string" && input.file_path.length > 0) {
      const relative = this.relativizePath(input.file_path);
      if (relative) {
        return [{ path: relative, kind: this.detectFileKind(input.file_path) }];
      }
    }
    if (typeof input.patch === "string" && input.patch.length > 0) {
      const files = this.parsePatchFileList(input.patch);
      if (files.length > 0) {
        return files.map((entry) => ({
          path: this.relativizePath(entry.path) ?? entry.path,
          kind: entry.kind,
        }));
      }
    }
    if (Array.isArray(input.files)) {
      const files: { path: string; kind: string }[] = [];
      for (const value of input.files) {
        if (typeof value === "string" && value.length > 0) {
          files.push({
            path: this.relativizePath(value) ?? value,
            kind: this.detectFileKind(value),
          });
        }
      }
      if (files.length > 0) {
        return files;
      }
    }
    return undefined;
  }

  private detectFileKind(filePath: string): string {
    try {
      return fs.existsSync(filePath) ? "update" : "add";
    } catch {
      return "update";
    }
  }

  private relativizePath(target?: string): string | undefined {
    if (!target) {
      return undefined;
    }
    const cwd = this.options.getCwd();
    if (cwd && target.startsWith(cwd)) {
      const relative = path.relative(cwd, target);
      return relative.length > 0 ? relative : path.basename(target);
    }
    return target;
  }

  private parsePatchFileList(patch: string): { path: string; kind: string }[] {
    const files: { path: string; kind: string }[] = [];
    const seen = new Set<string>();
    for (const line of patch.split(/\r?\n/)) {
      const trimmed = line.trim();
      let kind: string | null = null;
      let parsedPath: string | null = null;
      if (trimmed.startsWith("*** Add File:")) {
        kind = "add";
        parsedPath = trimmed.replace("*** Add File:", "").trim();
      } else if (trimmed.startsWith("*** Delete File:")) {
        kind = "delete";
        parsedPath = trimmed.replace("*** Delete File:", "").trim();
      } else if (trimmed.startsWith("*** Update File:")) {
        kind = "update";
        parsedPath = trimmed.replace("*** Update File:", "").trim();
      }
      if (kind && parsedPath && !seen.has(`${kind}:${parsedPath}`)) {
        seen.add(`${kind}:${parsedPath}`);
        files.push({ path: parsedPath, kind });
      }
    }
    return files;
  }
}
