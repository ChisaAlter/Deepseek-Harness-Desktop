import type {
  ContentBlock,
  PermissionOption,
  Plan,
  RequestPermissionRequest,
  ToolCall,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolCallUpdate,
  ToolKind,
} from "@agentclientprotocol/sdk";

import type {
  AgentPermissionRequest,
  AgentPermissionRequestKind,
  AgentPermissionResponse,
  AgentTimelineItem,
  ToolCallDetail,
  ToolCallTimelineItem,
} from "../../agent-sdk-types.js";

/** Snapshot of an ACP tool call assembled from incremental updates. */
export interface ACPToolSnapshot {
  toolCallId: string;
  title: string;
  kind?: ToolKind | null;
  status?: ToolCallStatus | null;
  content?: ToolCallContent[] | null;
  locations?: ToolCallLocation[] | null;
  rawInput?: unknown;
  rawOutput?: unknown;
}

/** Read-only terminal state used when projecting ACP terminal tool details. */
export interface ACPToolTerminalState {
  output: string;
  exit: { exitCode?: number | null } | null;
}

/**
 * Converts an ACP content block to the text shown in ChisaCode timelines.
 * @param content ACP content block
 * @returns Human-readable text for the block
 */
export function contentBlockToText(content: ContentBlock): string {
  switch (content.type) {
    case "text":
      return content.text;
    case "resource_link":
      return content.title ?? content.uri;
    case "resource":
      return "text" in content.resource
        ? content.resource.text
        : `[resource:${content.resource.mimeType ?? "binary"}]`;
    case "image":
      return "[image]";
    case "audio":
      return "[audio]";
    default:
      return "";
  }
}

function coalesceDefined<T>(next: T | undefined, previous: T | undefined, fallback: T): T {
  if (next !== undefined) return next;
  if (previous !== undefined) return previous;
  return fallback;
}

/**
 * Merges an incremental ACP tool update into its latest snapshot.
 * @param toolCallId Stable ACP tool call identifier
 * @param update New ACP tool call payload
 * @param previous Previous snapshot, when one exists
 * @returns The merged tool snapshot
 */
export function mergeACPToolSnapshot(
  toolCallId: string,
  update: ToolCall | ToolCallUpdate,
  previous?: ACPToolSnapshot,
): ACPToolSnapshot {
  return {
    toolCallId,
    title: update.title ?? previous?.title ?? toolCallId,
    kind: update.kind ?? previous?.kind ?? null,
    status: update.status ?? previous?.status ?? null,
    content: coalesceDefined(update.content, previous?.content, null),
    locations: coalesceDefined(update.locations, previous?.locations, null),
    rawInput: update.rawInput !== undefined ? update.rawInput : previous?.rawInput,
    rawOutput: update.rawOutput !== undefined ? update.rawOutput : previous?.rawOutput,
  };
}

/**
 * Maps an ACP plan update to the shared timeline todo shape.
 * @param plan ACP plan update
 * @returns Shared timeline item
 */
export function mapACPPlanToTimeline(plan: Plan): AgentTimelineItem {
  return {
    type: "todo",
    items: plan.entries.map((entry) => ({
      text: entry.content,
      completed: entry.status === "completed",
    })),
  };
}

/**
 * Maps an assembled ACP tool snapshot to the shared tool timeline shape.
 * @param snapshot Assembled ACP tool snapshot
 * @param terminals ACP terminal state indexed by terminal id
 * @returns Shared tool timeline item
 */
export function mapACPToolSnapshotToTimeline(
  snapshot: ACPToolSnapshot,
  terminals: ReadonlyMap<string, ACPToolTerminalState>,
): ToolCallTimelineItem {
  const status = mapToolStatus(snapshot.status);
  const detail = mapACPToolDetail(snapshot, terminals);
  const base = {
    type: "tool_call" as const,
    callId: snapshot.toolCallId,
    name: snapshot.kind ?? snapshot.title,
    detail,
    metadata: { kind: snapshot.kind ?? undefined, title: snapshot.title },
  };
  if (status === "failed") {
    return { ...base, status: "failed", error: { message: readErrorMessage(snapshot.rawOutput) } };
  }
  if (status === "completed") {
    return { ...base, status: "completed", error: null };
  }
  return { ...base, status: "running", error: null };
}

function mapToolStatus(status: ToolCallStatus | null | undefined): ToolCallTimelineItem["status"] {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "pending":
    case "in_progress":
    default:
      return "running";
  }
}

interface MapToolDetailContext {
  snapshot: ACPToolSnapshot;
  firstLocation: string | undefined;
  textContent: string | undefined;
  diffContent: ReturnType<typeof extractDiffContent>;
  terminalContent: ReturnType<typeof extractTerminalContent>;
  rawInput: ReturnType<typeof readRecord>;
  rawOutput: ReturnType<typeof readRecord>;
}

/**
 * Maps an ACP tool snapshot to the provider-neutral tool detail union.
 * @param snapshot Assembled ACP tool snapshot
 * @param terminals ACP terminal state indexed by terminal id
 * @returns Provider-neutral tool detail
 */
export function mapACPToolDetail(
  snapshot: ACPToolSnapshot,
  terminals: ReadonlyMap<string, ACPToolTerminalState> = new Map(),
): ToolCallDetail {
  const context: MapToolDetailContext = {
    snapshot,
    firstLocation: snapshot.locations?.[0]?.path,
    textContent: extractToolText(snapshot.content),
    diffContent: extractDiffContent(snapshot.content),
    terminalContent: extractTerminalContent(snapshot.content, terminals),
    rawInput: readRecord(snapshot.rawInput),
    rawOutput: readRecord(snapshot.rawOutput),
  };

  switch (snapshot.kind) {
    case "read":
      return buildReadToolDetail(context);
    case "edit":
    case "delete":
      return buildEditToolDetail(context);
    case "search":
      return buildSearchToolDetail(context);
    case "execute":
      return buildShellToolDetail(context);
    case "fetch":
      return buildFetchToolDetail(context);
    case "think":
      return {
        type: "plain_text",
        label: snapshot.title,
        icon: "brain",
        text: context.textContent ?? stringifyUnknown(snapshot.rawOutput),
      };
    case "switch_mode":
      return {
        type: "plain_text",
        label: snapshot.title,
        icon: "sparkles",
        text: context.textContent ?? stringifyUnknown(snapshot.rawInput),
      };
    default:
      return buildDefaultToolDetail(context);
  }
}

function buildReadToolDetail(context: MapToolDetailContext): ToolCallDetail {
  const { snapshot, firstLocation, textContent, rawInput, rawOutput } = context;
  return {
    type: "read",
    filePath: firstLocation ?? readString(rawInput, ["path", "filePath", "file"]) ?? snapshot.title,
    content: textContent ?? readString(rawOutput, ["content", "text"]),
    offset: readNumber(rawInput, ["offset", "line"]),
    limit: readNumber(rawInput, ["limit"]),
  };
}

function buildEditToolDetail(context: MapToolDetailContext): ToolCallDetail {
  const { snapshot, firstLocation, textContent, diffContent, rawInput } = context;
  return {
    type: "edit",
    filePath: firstLocation ?? readString(rawInput, ["path", "filePath", "file"]) ?? snapshot.title,
    oldString: diffContent?.oldText ?? readString(rawInput, ["oldText", "oldString"]),
    newString:
      snapshot.kind === "delete"
        ? ""
        : (diffContent?.newText ?? readString(rawInput, ["newText", "newString"])),
    unifiedDiff: textContent ?? undefined,
  };
}

function buildSearchToolDetail(context: MapToolDetailContext): ToolCallDetail {
  const { snapshot, textContent, rawInput, rawOutput } = context;
  return {
    type: "search",
    query: readString(rawInput, ["query", "pattern"]) ?? snapshot.title,
    toolName: "search",
    content: textContent ?? readString(rawOutput, ["content", "text"]),
    filePaths: snapshot.locations?.map((location) => location.path),
  };
}

function buildShellToolDetail(context: MapToolDetailContext): ToolCallDetail {
  const { snapshot, textContent, terminalContent, rawInput, rawOutput } = context;
  return {
    type: "shell",
    command:
      terminalContent?.command ??
      buildShellCommand(rawInput) ??
      readString(rawInput, ["command"]) ??
      snapshot.title,
    cwd: terminalContent?.cwd ?? readString(rawInput, ["cwd"]),
    output: terminalContent?.output ?? textContent ?? readString(rawOutput, ["output", "text"]),
    exitCode: terminalContent?.exitCode ?? readNumber(rawOutput, ["exitCode"]),
  };
}

function buildFetchToolDetail(context: MapToolDetailContext): ToolCallDetail {
  const { snapshot, textContent, rawInput, rawOutput } = context;
  return {
    type: "fetch",
    url: readString(rawInput, ["url"]) ?? snapshot.title,
    prompt: readString(rawInput, ["prompt"]),
    result: textContent ?? readString(rawOutput, ["result", "text", "content"]),
    code: readNumber(rawOutput, ["status", "code"]),
  };
}

function buildDefaultToolDetail(context: MapToolDetailContext): ToolCallDetail {
  const { snapshot, textContent, terminalContent } = context;
  if (terminalContent) {
    return {
      type: "shell",
      command: terminalContent.command ?? snapshot.title,
      cwd: terminalContent.cwd,
      output: terminalContent.output,
      exitCode: terminalContent.exitCode,
    };
  }
  if (textContent) {
    return {
      type: "plain_text",
      label: snapshot.title,
      text: textContent,
      icon: "wrench",
    };
  }
  return { type: "unknown", input: snapshot.rawInput ?? null, output: snapshot.rawOutput ?? null };
}

function extractToolText(content: ToolCallContent[] | null | undefined): string | undefined {
  if (!content) return undefined;
  const parts: string[] = [];
  for (const item of content) {
    if (item.type === "content") {
      const text = contentBlockToText(item.content);
      if (text) parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function extractDiffContent(
  content: ToolCallContent[] | null | undefined,
): { oldText?: string | null; newText: string } | null {
  const diff = content?.find(
    (item): item is Extract<ToolCallContent, { type: "diff" }> => item.type === "diff",
  );
  return diff ? { oldText: diff.oldText ?? undefined, newText: diff.newText } : null;
}

function extractTerminalContent(
  content: ToolCallContent[] | null | undefined,
  terminals: ReadonlyMap<string, ACPToolTerminalState>,
): { command?: string; cwd?: string; output?: string; exitCode?: number | null } | undefined {
  const terminal = content?.find(
    (item): item is Extract<ToolCallContent, { type: "terminal" }> => item.type === "terminal",
  );
  if (!terminal) return undefined;
  const entry = terminals.get(terminal.terminalId);
  if (!entry) return undefined;
  return { output: entry.output, exitCode: entry.exit?.exitCode ?? null };
}

/**
 * Maps an ACP permission request to the shared permission contract.
 * @param provider Provider id exposed to ChisaCode
 * @param requestId ChisaCode permission request id
 * @param params ACP permission request
 * @param snapshot Assembled ACP tool snapshot
 * @returns Shared permission request
 */
export function mapACPPermissionRequest(
  provider: string,
  requestId: string,
  params: RequestPermissionRequest,
  snapshot: ACPToolSnapshot,
): AgentPermissionRequest {
  const kind: AgentPermissionRequestKind = snapshot.kind === "switch_mode" ? "mode" : "tool";
  return {
    id: requestId,
    provider,
    name: snapshot.kind ?? snapshot.title,
    kind,
    title: params.toolCall.title ?? snapshot.title,
    detail: mapACPToolDetail(snapshot),
    metadata: {
      toolCallId: params.toolCall.toolCallId,
      rawRequest: params,
      options: params.options,
    },
  };
}

/**
 * Selects the ACP option matching a ChisaCode allow or deny response.
 * @param options ACP permission options
 * @param response ChisaCode permission response
 * @returns Matching ACP option, or null when unavailable
 */
export function selectACPPermissionOption(
  options: PermissionOption[],
  response: AgentPermissionResponse,
): PermissionOption | null {
  const order =
    response.behavior === "allow"
      ? ["allow_once", "allow_always"]
      : ["reject_once", "reject_always"];
  for (const kind of order) {
    const match = options.find((option) => option.kind === kind);
    if (match) return match;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readString(record: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function readNumber(record: Record<string, unknown> | null, keys: string[]): number | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function buildShellCommand(record: Record<string, unknown> | null): string | undefined {
  if (!record) return undefined;
  const command = readString(record, ["command"]);
  const args = Array.isArray(record["args"])
    ? record["args"].filter((value): value is string => typeof value === "string")
    : [];
  if (!command) return undefined;
  return args.length > 0 ? `${command} ${args.join(" ")}` : command;
}

function readErrorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  const record = readRecord(value);
  return readString(record, ["message", "error"]) ?? "Tool call failed";
}

function stringifyUnknown(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return typeof value === "bigint" ? String(value) : "[unserializable]";
  }
}
