import type { ToolCallTimelineItem } from "../../agent-sdk-types.js";
import { mapCodexToolCallEnvelope } from "./tool-call-mapper.js";
import { nonEmptyString } from "../tool-call-mapper-utils.js";

interface CodexPatchFileChange {
  path: string;
  kind?: string;
  content?: string;
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function extractPatchLikeText(value: unknown): string | undefined {
  const record = toObjectRecord(value);
  if (!record) {
    return undefined;
  }
  const candidates = [
    record.diff,
    record.patch,
    record.unified_diff,
    record.unifiedDiff,
    record.content,
    record.newString,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

export function normalizeCodexCommandValue(value: unknown): string | string[] | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.length) {
      return null;
    }
    const wrapperMatch = trimmed.match(/^(?:\/bin\/)?(?:zsh|bash|sh)\s+-(?:lc|c)\s+([\s\S]+)$/);
    if (!wrapperMatch) {
      return trimmed;
    }
    const candidate = wrapperMatch[1]?.trim() ?? "";
    if (!candidate.length) {
      return trimmed;
    }
    if (
      (candidate.startsWith('"') && candidate.endsWith('"')) ||
      (candidate.startsWith("'") && candidate.endsWith("'"))
    ) {
      return candidate.slice(1, -1);
    }
    return candidate;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (parts.length === 0) {
    return null;
  }
  if (parts.length >= 3 && (parts[1] === "-lc" || parts[1] === "-c")) {
    return parts[2] ?? parts;
  }
  return parts;
}

function parseCodexPatchChanges(changes: unknown): CodexPatchFileChange[] {
  const resolvePathFromRecord = (record: Record<string, unknown>): string => {
    return (
      (typeof record.path === "string" && record.path.trim().length > 0
        ? record.path.trim()
        : "") ||
      (typeof record.file_path === "string" && record.file_path.trim().length > 0
        ? record.file_path.trim()
        : "") ||
      (typeof record.filePath === "string" && record.filePath.trim().length > 0
        ? record.filePath.trim()
        : "")
    );
  };

  if (!changes || typeof changes !== "object") {
    return [];
  }

  if (Array.isArray(changes)) {
    return changes
      .map((entry): CodexPatchFileChange | null => {
        const record = toObjectRecord(entry);
        if (!record) {
          return null;
        }
        const pathValue = resolvePathFromRecord(record);
        if (!pathValue) {
          return null;
        }
        return {
          path: pathValue,
          kind:
            (typeof record.kind === "string" && record.kind) ||
            (typeof record.type === "string" && record.type) ||
            undefined,
          content: extractPatchLikeText(record),
        };
      })
      .filter((entry): entry is CodexPatchFileChange => entry !== null);
  }

  const recordChanges = toObjectRecord(changes);
  if (!recordChanges) {
    return [];
  }
  const directPathValue = resolvePathFromRecord(recordChanges);
  if (directPathValue) {
    return [
      {
        path: directPathValue,
        kind:
          (typeof recordChanges.kind === "string" && recordChanges.kind) ||
          (typeof recordChanges.type === "string" && recordChanges.type) ||
          undefined,
        content: extractPatchLikeText(recordChanges),
      },
    ];
  }

  return Object.entries(recordChanges)
    .map(([entryPath, value]): CodexPatchFileChange | null => {
      const normalizedPath = entryPath.trim();
      if (!normalizedPath) {
        return null;
      }
      return {
        path: normalizedPath,
        kind:
          value &&
          typeof value === "object" &&
          typeof (value as { type?: unknown }).type === "string"
            ? ((value as { type?: string }).type ?? undefined)
            : undefined,
        content: extractPatchLikeText(value),
      };
    })
    .filter((entry): entry is CodexPatchFileChange => entry !== null);
}

function codexPatchTextFields(text: string | null | undefined): {
  patch?: string;
  content?: string;
} {
  if (typeof text !== "string") {
    return {};
  }
  const normalized = text.trimStart();
  const looksLikeUnifiedDiff =
    normalized.startsWith("diff --git") ||
    normalized.startsWith("@@") ||
    normalized.startsWith("--- ") ||
    normalized.startsWith("+++ ");
  return looksLikeUnifiedDiff ? { patch: text } : { content: text };
}

function toRunningToolCall(item: ToolCallTimelineItem): ToolCallTimelineItem {
  return {
    ...item,
    status: "running",
    error: null,
  };
}

export function isEditToolCallWithoutContent(item: ToolCallTimelineItem): boolean {
  if (item.type !== "tool_call" || item.detail.type !== "edit") {
    return false;
  }
  const hasDiff =
    typeof item.detail.unifiedDiff === "string" && item.detail.unifiedDiff.trim().length > 0;
  const hasNewString =
    typeof item.detail.newString === "string" && item.detail.newString.trim().length > 0;
  return !hasDiff && !hasNewString;
}

export function decodeCodexOutputDeltaChunk(chunk: string): string {
  const trimmed = chunk.trim();
  if (trimmed.length === 0) {
    return chunk;
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(trimmed) || trimmed.length % 4 !== 0) {
    return chunk;
  }

  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (decoded.length === 0) {
      return chunk;
    }
    const normalizedInput = trimmed.replace(/=+$/, "");
    const normalizedRoundTrip = Buffer.from(decoded, "utf8").toString("base64").replace(/=+$/, "");
    return normalizedRoundTrip === normalizedInput ? decoded : chunk;
  } catch {
    return chunk;
  }
}

export function mapCodexExecNotificationToToolCall(params: {
  callId?: string | null;
  command: unknown;
  cwd?: string | null;
  output?: string | null;
  exitCode?: number | null;
  success?: boolean | null;
  stderr?: string | null;
  running: boolean;
}): ToolCallTimelineItem | null {
  const command = normalizeCodexCommandValue(params.command);
  if (!command) {
    return null;
  }
  const isFailure = params.running
    ? false
    : params.success === false || (typeof params.exitCode === "number" && params.exitCode !== 0);
  const output = params.running
    ? null
    : {
        command,
        ...(params.output !== null && params.output !== undefined ? { output: params.output } : {}),
        ...(params.exitCode !== null && params.exitCode !== undefined
          ? { exitCode: params.exitCode }
          : {}),
      };
  const mapped = mapCodexToolCallEnvelope({
    callId: params.callId ?? null,
    name: "shell",
    input: {
      command,
      ...(params.cwd ? { cwd: params.cwd } : {}),
    },
    output,
    error: isFailure ? { message: params.stderr?.trim() || "Command failed" } : null,
    cwd: params.cwd ?? null,
  });
  if (!mapped) {
    return null;
  }
  return params.running ? toRunningToolCall(mapped) : mapped;
}

export function mapCodexPatchNotificationToToolCall(params: {
  callId?: string | null;
  changes: unknown;
  cwd?: string | null;
  stdout?: string | null;
  stderr?: string | null;
  success?: boolean | null;
  running: boolean;
}): ToolCallTimelineItem | null {
  const files = parseCodexPatchChanges(params.changes);
  const firstPath = files[0]?.path;
  const patchText = files
    .map((file) => file.content?.trim())
    .find((value): value is string => typeof value === "string" && value.length > 0);
  const patchFields = codexPatchTextFields(patchText);
  const mapped = mapCodexToolCallEnvelope({
    callId: params.callId ?? null,
    name: "apply_patch",
    input: firstPath
      ? {
          path: firstPath,
          ...patchFields,
          files: files.map((file) => ({ path: file.path, kind: file.kind })),
        }
      : {
          changes: params.changes ?? null,
          ...patchFields,
        },
    output: params.running
      ? null
      : {
          ...(files.length > 0
            ? {
                files: files.map((file) =>
                  Object.assign(
                    { path: file.path },
                    file.kind ? { kind: file.kind } : {},
                    codexPatchTextFields(file.content ?? patchText),
                  ),
                ),
              }
            : {}),
          ...(params.stdout ? { stdout: params.stdout } : {}),
          ...(params.stderr ? { stderr: params.stderr } : {}),
          ...(params.success !== null && params.success !== undefined
            ? { success: params.success }
            : {}),
        },
    error:
      params.running || params.success !== false
        ? null
        : { message: params.stderr?.trim() || "Patch apply failed" },
    cwd: params.cwd ?? null,
  });
  if (!mapped) {
    return null;
  }
  return params.running ? toRunningToolCall(mapped) : mapped;
}

export function mapCodexTerminalInteractionToToolCall(params: {
  processId?: string | null;
  fallbackCallId?: string | null;
  command?: string | null;
}): ToolCallTimelineItem {
  const processId = nonEmptyString(params.processId ?? undefined);
  const callId = processId
    ? `terminal-session-${processId}`
    : (nonEmptyString(params.fallbackCallId ?? undefined) ?? "terminal-interaction");
  const label = nonEmptyString(params.command ?? undefined);
  return {
    type: "tool_call",
    callId,
    name: "terminal",
    status: "completed",
    error: null,
    detail: {
      type: "plain_text",
      ...(label ? { label } : {}),
      icon: "square_terminal",
    },
    ...(processId ? { metadata: { processId } } : {}),
  };
}
