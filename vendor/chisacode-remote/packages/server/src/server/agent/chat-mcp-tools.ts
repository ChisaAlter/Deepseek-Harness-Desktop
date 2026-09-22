import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { CHAT_WAIT_MAX_TIMEOUT_MS, type FileBackedChatService } from "../chat/chat-service.js";
import { ChatMessageSchema, ChatRoomDetailSchema } from "@chisacode/protocol/chat/types";
import { ensureValidJson } from "../json-utils.js";
import type { AgentManager } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import type { Logger } from "pino";
import { postChatMessageCommand } from "../chat/post-message-command.js";

export type ChatMcpService = Pick<
  FileBackedChatService,
  | "createRoom"
  | "listRooms"
  | "inspectRoom"
  | "deleteRoom"
  | "dispatchMessage"
  | "readMessages"
  | "listRoomPosterAgentIds"
  | "waitForMessages"
>;

export interface RegisterChatMcpToolsOptions {
  registerTool: McpServer["registerTool"];
  chatService?: ChatMcpService | null;
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  callerAgentId?: string;
  logger: Logger;
  resolveAgentIdentifier: (
    identifier: string,
  ) => Promise<{ ok: true; agentId: string } | { ok: false; error: string }>;
}

export function registerChatMcpTools(options: RegisterChatMcpToolsOptions): void {
  const requireService = (): ChatMcpService => {
    if (!options.chatService) {
      throw new Error("Chat service is not configured");
    }
    return options.chatService;
  };

  options.registerTool(
    "create_chat_room",
    {
      title: "Create chat room",
      description: "Create a persistent chat room for agents and operators.",
      inputSchema: {
        name: z.string().trim().min(1),
        purpose: z.string().optional(),
      },
      outputSchema: ChatRoomDetailSchema.shape,
    },
    async ({ name, purpose }) => ({
      content: [],
      structuredContent: ensureValidJson(await requireService().createRoom({ name, purpose })),
    }),
  );

  options.registerTool(
    "list_chat_rooms",
    {
      title: "List chat rooms",
      description: "List persistent chat rooms ordered by recent activity.",
      inputSchema: {},
      outputSchema: { rooms: z.array(ChatRoomDetailSchema) },
    },
    async () => ({
      content: [],
      structuredContent: ensureValidJson({ rooms: await requireService().listRooms() }),
    }),
  );

  options.registerTool(
    "inspect_chat_room",
    {
      title: "Inspect chat room",
      description: "Inspect a chat room by id, id prefix, or name.",
      inputSchema: { room: z.string().trim().min(1) },
      outputSchema: ChatRoomDetailSchema.shape,
    },
    async ({ room }) => {
      const result = await requireService().inspectRoom({ room });
      return { content: [], structuredContent: ensureValidJson(result.room) };
    },
  );

  options.registerTool(
    "delete_chat_room",
    {
      title: "Delete chat room",
      description: "Delete a chat room and all messages stored in it.",
      inputSchema: { room: z.string().trim().min(1) },
      outputSchema: ChatRoomDetailSchema.shape,
    },
    async ({ room }) => {
      const result = await requireService().deleteRoom({ room });
      return { content: [], structuredContent: ensureValidJson(result.room) };
    },
  );

  options.registerTool(
    "post_chat_message",
    {
      title: "Post chat message",
      description: "Post a message and notify eligible agents mentioned with @agent or @everyone.",
      inputSchema: {
        room: z.string().trim().min(1),
        body: z.string().trim().min(1),
        authorAgentId: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe("Required for top-level MCP; agent-scoped calls use the caller identity."),
        replyToMessageId: z.string().trim().min(1).optional(),
      },
      outputSchema: ChatMessageSchema.shape,
    },
    async ({ room, body, authorAgentId, replyToMessageId }) => {
      const resolvedAuthorAgentId = options.callerAgentId ?? authorAgentId;
      if (!resolvedAuthorAgentId) {
        throw new Error("authorAgentId is required when no caller agent is available");
      }
      if (
        options.callerAgentId &&
        authorAgentId !== undefined &&
        authorAgentId !== options.callerAgentId
      ) {
        throw new Error("authorAgentId cannot differ from the caller agent");
      }
      const message = await postChatMessageCommand(
        {
          chatService: requireService(),
          agentManager: options.agentManager,
          agentStorage: options.agentStorage,
          logger: options.logger,
          resolveAgentIdentifier: options.resolveAgentIdentifier,
        },
        { room, body, authorAgentId: resolvedAuthorAgentId, replyToMessageId },
      );
      return { content: [], structuredContent: ensureValidJson(message) };
    },
  );

  options.registerTool(
    "read_chat_messages",
    {
      title: "Read chat messages",
      description: "Read messages from a chat room with optional filters and tail limiting.",
      inputSchema: {
        room: z.string().trim().min(1),
        limit: z.number().int().nonnegative().optional(),
        since: z.string().optional(),
        authorAgentId: z.string().trim().min(1).optional(),
      },
      outputSchema: { messages: z.array(ChatMessageSchema) },
    },
    async (input) => ({
      content: [],
      structuredContent: ensureValidJson({
        messages: await requireService().readMessages(input),
      }),
    }),
  );

  options.registerTool(
    "wait_for_chat_messages",
    {
      title: "Wait for chat messages",
      description:
        "Wait for messages after an optional cursor without polling the room repeatedly.",
      inputSchema: {
        room: z.string().trim().min(1),
        afterMessageId: z.string().trim().min(1).optional(),
        timeoutMs: z.number().int().nonnegative().max(CHAT_WAIT_MAX_TIMEOUT_MS).optional(),
      },
      outputSchema: {
        messages: z.array(ChatMessageSchema),
        timedOut: z.boolean(),
      },
    },
    async (input, context) => {
      const messages = await requireService().waitForMessages({
        ...input,
        signal: context.signal,
      });
      return {
        content: [],
        structuredContent: ensureValidJson({ messages, timedOut: messages.length === 0 }),
      };
    },
  );
}
