import type { Event as OpenCodeEvent } from "@opencode-ai/sdk/v2/client";

import type { AgentStreamEvent, ToolCallDetail } from "../../agent-sdk-types.js";
import { readNonEmptyString, readOpenCodeRecord } from "./event-values.js";
import { buildOpenCodePermissionActions } from "./helpers.js";
import {
  isOpenCodeSessionTrackedByParent,
  type OpenCodeSubAgentTrackingState,
} from "./sub-agent-tracking.js";

const PERMISSION_COMMAND_KEYS = ["command", "cmd", "shellCommand"] as const;
const PERMISSION_CWD_KEYS = ["cwd", "directory", "path", "workdir"] as const;
const PERMISSION_REASON_KEYS = ["reason", "purpose", "description", "message"] as const;
const PERMISSION_TITLE_BY_NAME: Record<string, string> = {
  external_directory: "Access external directory",
  bash: "Run shell command",
  read: "Read files",
  read_file: "Read files",
  write: "Write files",
  write_file: "Write files",
  create_file: "Write files",
  edit: "Edit files",
  apply_patch: "Edit files",
  apply_diff: "Edit files",
};

function toHumanReadablePermissionTitle(permission: string): string {
  const mapped = PERMISSION_TITLE_BY_NAME[permission];
  if (mapped) {
    return mapped;
  }

  const normalized = permission
    .split(/[\s_-]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
  return normalized.length > 0 ? normalized : "Permission request";
}

function readFirstStringFromRecord(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = readNonEmptyString(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function readPermissionField(
  metadata: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  const direct = readFirstStringFromRecord(metadata, keys);
  if (direct) {
    return direct;
  }

  const nestedInput = readOpenCodeRecord(metadata?.input);
  return readFirstStringFromRecord(nestedInput, keys);
}

function buildOpenCodePermissionInput(params: {
  patterns: string[];
  metadata: Record<string, unknown> | null;
  tool: Record<string, unknown> | null;
  command: string | null;
}): Record<string, unknown> {
  return {
    ...(params.patterns.length > 0 ? { patterns: params.patterns } : {}),
    ...(params.metadata ? { metadata: params.metadata } : {}),
    ...(params.tool ? { tool: params.tool } : {}),
    ...(params.command ? { command: params.command } : {}),
  };
}

function buildOpenCodePermissionDetail(params: {
  permission: string;
  input: Record<string, unknown>;
  command: string | null;
  cwd: string | null;
}): ToolCallDetail {
  if (params.command) {
    return {
      type: "shell",
      command: params.command,
      ...(params.cwd ? { cwd: params.cwd } : {}),
    };
  }

  return {
    type: "unknown",
    input: {
      permission: params.permission,
      ...params.input,
    },
    output: null,
  };
}

function buildOpenCodePermissionDescription(params: {
  reason: string | null;
  patterns: string[];
}): string | undefined {
  const parts: string[] = [];
  if (params.reason) {
    parts.push(params.reason);
  }
  if (params.patterns.length > 0) {
    parts.push(`Scope: ${params.patterns.join(", ")}`);
  }
  return parts.length > 0 ? parts.join(" - ") : undefined;
}

/** Translates an OpenCode tool permission request into the shared agent contract. */
export function appendOpenCodePermissionAsked(
  event: Extract<OpenCodeEvent, { type: "permission.asked" }>,
  state: OpenCodeSubAgentTrackingState,
  events: AgentStreamEvent[],
): void {
  if (!isOpenCodeSessionTrackedByParent(event.properties.sessionID, state)) {
    return;
  }
  const metadata = readOpenCodeRecord(event.properties.metadata);
  const tool = readOpenCodeRecord(event.properties.tool);
  const patterns = Array.isArray(event.properties.patterns)
    ? event.properties.patterns.filter((value): value is string => typeof value === "string")
    : [];
  const command = readPermissionField(metadata, PERMISSION_COMMAND_KEYS);
  const cwd = readPermissionField(metadata, PERMISSION_CWD_KEYS);
  const reason = readPermissionField(metadata, PERMISSION_REASON_KEYS);
  const input = buildOpenCodePermissionInput({ patterns, metadata, tool, command });
  const detail = buildOpenCodePermissionDetail({
    permission: event.properties.permission,
    input,
    command,
    cwd,
  });
  const description = buildOpenCodePermissionDescription({ reason, patterns });

  events.push({
    type: "permission_requested",
    provider: "opencode",
    request: {
      id: event.properties.id,
      provider: "opencode",
      name: event.properties.permission,
      kind: "tool",
      title: toHumanReadablePermissionTitle(event.properties.permission),
      ...(description ? { description } : {}),
      input,
      detail,
      actions: buildOpenCodePermissionActions(),
    },
  });
}

/** Translates an OpenCode question request into the shared agent permission contract. */
export function appendOpenCodeQuestionAsked(
  event: Extract<OpenCodeEvent, { type: "question.asked" }>,
  state: Pick<OpenCodeSubAgentTrackingState, "sessionId">,
  events: AgentStreamEvent[],
): void {
  if (event.properties.sessionID !== state.sessionId) {
    return;
  }
  const questions = event.properties.questions.flatMap((question) => {
    if (!question.question || !question.header) {
      return [];
    }
    const options =
      question.options?.map((option) => ({
        label: option.label,
        ...(option.description ? { description: option.description } : {}),
      })) ?? [];
    return [
      {
        question: question.question,
        header: question.header,
        options,
        ...(question.multiple === true ? { multiSelect: true } : {}),
      },
    ];
  });

  if (questions.length === 0) {
    return;
  }

  events.push({
    type: "permission_requested",
    provider: "opencode",
    request: {
      id: event.properties.id,
      provider: "opencode",
      name: "question",
      kind: "question",
      title: "Question",
      input: { questions },
      metadata: {
        source: "opencode_question",
        ...event.properties.tool,
      },
    },
  });
}
