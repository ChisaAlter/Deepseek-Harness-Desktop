import type {
  GlobalSession as OpenCodeGlobalSession,
  Message as OpenCodeMessage,
  OpencodeClient,
  Part as OpenCodePart,
  Session as OpenCodeSession,
} from "@opencode-ai/sdk/v2/client";
import { createPathEquivalenceMatcher } from "../../../../utils/path.js";

import type {
  AgentStreamEvent,
  AgentTimelineItem,
  ListPersistedAgentsOptions,
  PersistedAgentDescriptor,
} from "../../agent-sdk-types.js";
import { OPENCODE_PERSISTED_SESSION_LIMIT } from "./constants.js";
import { buildOpenCodeModelLookupKey, normalizeOpenCodeModeId } from "./catalog.js";
import {
  isOpenCodeTodoWriteToolPart,
  mapOpenCodeTodosToTimelineItems,
  readOpenCodeTodoItemsFromToolPart,
  stringifyStructuredAssistantMessage,
} from "./event-translator.js";
import { OpencodeToolPartToTimelineItemSchema } from "./helpers.js";
import { normalizeProviderReplayTimestamp } from "../../provider-history-timestamps.js";

type OpenCodePersistedSession = OpenCodeSession | OpenCodeGlobalSession;

interface OpenCodeSessionMessage {
  info: OpenCodeMessage;
  parts: OpenCodePart[];
}

export async function collectOpenCodePersistedAgentsFromSdk(
  client: Pick<OpencodeClient, "experimental" | "session">,
  options?: ListPersistedAgentsOptions,
): Promise<PersistedAgentDescriptor[]> {
  const limit = options?.limit ?? OPENCODE_PERSISTED_SESSION_LIMIT;
  const sessionListLimit = options?.cwd ? Math.max(limit, OPENCODE_PERSISTED_SESSION_LIMIT) : limit;
  const response = await client.experimental.session.list({
    archived: true,
    roots: true,
    limit: sessionListLimit,
  });

  if (response.error) {
    throw new Error(`Failed to list OpenCode sessions: ${JSON.stringify(response.error)}`);
  }

  const sessions = response.data ?? [];
  const matchesCwd = options?.cwd ? createPathEquivalenceMatcher(options.cwd) : null;
  const candidates = sessions
    .filter((session) => !matchesCwd || matchesCwd(session.directory))
    .sort((left, right) => getOpenCodeSessionTimestamp(right) - getOpenCodeSessionTimestamp(left))
    .slice(0, limit);

  return await Promise.all(
    candidates.map((session) => buildOpenCodePersistedAgentDescriptor(client, session)),
  );
}

async function buildOpenCodePersistedAgentDescriptor(
  client: Pick<OpencodeClient, "session">,
  session: OpenCodePersistedSession,
): Promise<PersistedAgentDescriptor> {
  const messages = await readOpenCodeSessionMessagesFromSdk(client, session);
  const timeline = buildOpenCodeSessionTimeline(messages);
  const modeId = resolveOpenCodePersistedSessionModeId(session, messages);
  const model = resolveOpenCodePersistedSessionModel(session, messages);
  return {
    provider: "opencode",
    sessionId: session.id,
    cwd: session.directory,
    title: normalizeOpenCodeSessionTitle(session.title),
    lastActivityAt: new Date(getOpenCodeSessionTimestamp(session)),
    persistence: {
      provider: "opencode",
      sessionId: session.id,
      nativeHandle: session.id,
      metadata: {
        provider: "opencode",
        cwd: session.directory,
        title: normalizeOpenCodeSessionTitle(session.title),
        ...(modeId ? { modeId } : {}),
        ...(model ? { model } : {}),
      },
    },
    timeline,
  };
}

function normalizeOpenCodeSessionTitle(title: string | null | undefined): string | null {
  const normalized = title?.trim();
  return normalized ? normalized : null;
}

function getOpenCodeSessionTimestamp(session: OpenCodePersistedSession): number {
  return session.time?.updated ?? session.time?.created ?? 0;
}

function resolveOpenCodeReplayTimestamp(params: {
  message: { time?: { created?: number; completed?: number } | undefined };
  part?: unknown;
}): string | null {
  const timedPart = params.part as
    | { time?: { start?: number; end?: number } | undefined }
    | undefined;
  const partTimestamp =
    timedPart?.time?.start ??
    timedPart?.time?.end ??
    params.message.time?.created ??
    params.message.time?.completed;
  return normalizeProviderReplayTimestamp(partTimestamp);
}

function buildOpenCodeReplayTimelineEvent(params: {
  item: AgentTimelineItem;
  message: { time?: { created?: number; completed?: number } | undefined };
  part?: unknown;
}): Extract<AgentStreamEvent, { type: "timeline" }> {
  const timestamp = resolveOpenCodeReplayTimestamp({
    message: params.message,
    part: params.part,
  });
  return {
    type: "timeline",
    provider: "opencode",
    item: params.item,
    ...(timestamp ? { timestamp } : {}),
  };
}

function buildOpenCodeReplayPartTimelineEvent(params: {
  part: OpenCodePart;
  message: { structured?: unknown; time?: { created?: number; completed?: number } | undefined };
}): Extract<AgentStreamEvent, { type: "timeline" }> | null {
  const { part, message } = params;
  if (part.type === "text" && part.text) {
    return buildOpenCodeReplayTimelineEvent({
      item: { type: "assistant_message", text: part.text },
      message,
      part,
    });
  }
  if (part.type === "reasoning" && part.text) {
    return buildOpenCodeReplayTimelineEvent({
      item: { type: "reasoning", text: part.text },
      message,
      part,
    });
  }
  if (part.type !== "tool") {
    return null;
  }
  if (isOpenCodeTodoWriteToolPart(part)) {
    const todos = readOpenCodeTodoItemsFromToolPart(part);
    if (!todos) {
      return null;
    }
    return buildOpenCodeReplayTimelineEvent({
      item: mapOpenCodeTodosToTimelineItems(todos),
      message,
      part,
    });
  }
  const parsedToolPart = OpencodeToolPartToTimelineItemSchema.safeParse(part);
  if (!parsedToolPart.success || !parsedToolPart.data) {
    return null;
  }
  return buildOpenCodeReplayTimelineEvent({
    item: parsedToolPart.data,
    message,
    part,
  });
}

async function readOpenCodeSessionMessagesFromSdk(
  client: Pick<OpencodeClient, "session">,
  session: OpenCodePersistedSession,
): Promise<OpenCodeSessionMessage[]> {
  const response = await client.session.messages({
    sessionID: session.id,
    directory: session.directory,
  });

  if (response.error || !response.data) {
    return [];
  }

  return filterOpenCodeRevertedMessages(response.data, session.revert);
}

function buildOpenCodeSessionTimeline(
  messages: ReadonlyArray<OpenCodeSessionMessage>,
): AgentTimelineItem[] {
  return messages.flatMap((message) =>
    buildOpenCodeReplayTimelineEvents(message).map((event) => event.item),
  );
}

export function filterOpenCodeRevertedMessages(
  messages: ReadonlyArray<OpenCodeSessionMessage>,
  revert: OpenCodePersistedSession["revert"] | null | undefined,
): OpenCodeSessionMessage[] {
  if (!revert?.messageID || revert.partID) {
    return [...messages];
  }
  const revertIndex = messages.findIndex((message) => message.info.id === revert.messageID);
  if (revertIndex < 0) {
    return [...messages];
  }
  return messages.slice(0, revertIndex);
}

function resolveOpenCodePersistedSessionModeId(
  session: OpenCodePersistedSession,
  messages: ReadonlyArray<OpenCodeSessionMessage>,
): string | undefined {
  const agent = session.agent ?? messages.map(readOpenCodeMessageAgent).find(Boolean);
  return agent ? normalizeOpenCodeModeId(agent) : undefined;
}

function readOpenCodeMessageAgent(message: OpenCodeSessionMessage): string | undefined {
  const agent = message.info.agent;
  return typeof agent === "string" && agent.trim() ? agent : undefined;
}

function resolveOpenCodePersistedSessionModel(
  session: OpenCodePersistedSession,
  messages: ReadonlyArray<OpenCodeSessionMessage>,
): string | undefined {
  if (session.model) {
    return buildOpenCodeModelLookupKey(session.model.providerID, session.model.id);
  }

  const model = messages.map(readOpenCodeMessageModel).find(Boolean);
  return model ? buildOpenCodeModelLookupKey(model.providerID, model.modelID) : undefined;
}

function readOpenCodeMessageModel(
  message: OpenCodeSessionMessage,
): { providerID: string; modelID: string } | undefined {
  const { info } = message;
  if (info.role === "user") {
    return info.model;
  }
  return {
    providerID: info.providerID,
    modelID: info.modelID,
  };
}

export function buildOpenCodeReplayTimelineEvents(
  message: OpenCodeSessionMessage,
): Extract<AgentStreamEvent, { type: "timeline" }>[] {
  const { info, parts } = message;
  if (info.role === "user") {
    const text = parts
      .filter((part): part is Extract<OpenCodePart, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("");

    return text
      ? [
          buildOpenCodeReplayTimelineEvent({
            item: { type: "user_message", text, messageId: info.id },
            message: info,
          }),
        ]
      : [];
  }

  const events: Extract<AgentStreamEvent, { type: "timeline" }>[] = [];
  let emittedAssistantText = false;
  for (const part of parts) {
    if (part.type === "text" && part.text) {
      emittedAssistantText = true;
    }
    const event = buildOpenCodeReplayPartTimelineEvent({ part, message: info });
    if (event) {
      events.push(event);
    }
  }

  if (!emittedAssistantText) {
    const text = stringifyStructuredAssistantMessage(info.structured);
    if (text) {
      events.push(
        buildOpenCodeReplayTimelineEvent({
          item: { type: "assistant_message", text },
          message: info,
        }),
      );
    }
  }

  return events;
}
