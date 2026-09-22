import type { Logger } from "pino";
import type { ChatMessage } from "@chisacode/protocol/chat/types";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import { formatSystemNotificationPrompt, sendPromptToAgent } from "../agent/agent-prompt.js";
import {
  ChatServiceError,
  parseMentionAgentIds,
  type FileBackedChatService,
} from "./chat-service.js";
import { notifyChatMentions, prepareChatMentionFanout } from "./chat-mentions.js";

export type ChatPostService = Pick<
  FileBackedChatService,
  "dispatchMessage" | "listRoomPosterAgentIds"
>;

export interface PostChatMessageCommandDependencies {
  chatService: ChatPostService;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
  resolveAgentIdentifier: (
    identifier: string,
  ) => Promise<{ ok: true; agentId: string } | { ok: false; error: string }>;
}

export interface PostChatMessageCommandInput {
  room: string;
  authorAgentId: string;
  body: string;
  replyToMessageId?: string | null;
}

export async function postChatMessageCommand(
  deps: PostChatMessageCommandDependencies,
  input: PostChatMessageCommandInput,
): Promise<ChatMessage> {
  const mentionAgentIds = parseMentionAgentIds(input.body);
  const storedAgents = await deps.agentStorage.list();
  const liveAgents = deps.agentManager.listAgents();
  const fanout = await prepareChatMentionFanout({
    authorAgentId: input.authorAgentId,
    mentionAgentIds,
    storedAgents,
    liveAgents,
    listRoomPosterAgentIds: () => deps.chatService.listRoomPosterAgentIds({ room: input.room }),
  });
  if (!fanout.ok) {
    throw new ChatServiceError("chat_mention_fanout_limit_exceeded", fanout.error);
  }

  const message = await deps.chatService.dispatchMessage(input);
  void notifyChatMentions({
    room: input.room,
    authorAgentId: input.authorAgentId,
    body: input.body,
    mentionAgentIds: message.mentionAgentIds,
    logger: deps.logger,
    storedAgents,
    liveAgents,
    prepared: fanout.prepared,
    resolveAgentIdentifier: deps.resolveAgentIdentifier,
    sendAgentMessage: async (agentId, text) => {
      await sendPromptToAgent({
        agentManager: deps.agentManager,
        agentStorage: deps.agentStorage,
        agentId,
        prompt: formatSystemNotificationPrompt(text),
        unarchive: false,
        logger: deps.logger,
      });
    },
  }).catch((error: unknown) => {
    deps.logger.warn({ err: error, room: input.room }, "Failed to fan out chat mentions");
  });
  return message;
}
