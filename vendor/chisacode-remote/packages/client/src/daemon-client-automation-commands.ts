import type { SessionInboundMessage } from "@chisacode/protocol/messages";

import type {
  DaemonCommandResponsePayload,
  DaemonCommandTransport,
} from "./daemon-client-command-transport.js";

type RequestOf<TType extends SessionInboundMessage["type"]> = Extract<
  SessionInboundMessage,
  { type: TType }
>;
type WithoutEnvelope<T extends { requestId: string }> = Omit<T, "type" | "requestId"> & {
  requestId?: string;
};
type WithId<T> = Omit<T, "scheduleId"> & { id: string };
type NullableOptional<T, TKey extends keyof T> = Omit<T, TKey> & {
  [TField in TKey]?: Exclude<T[TField], undefined> | null;
};

type CreateChatRoomOptions = NullableOptional<WithoutEnvelope<RequestOf<"chat/create">>, "purpose">;
type InspectChatRoomOptions = WithoutEnvelope<RequestOf<"chat/inspect">>;
type DeleteChatRoomOptions = WithoutEnvelope<RequestOf<"chat/delete">>;
type PostChatMessageOptions = NullableOptional<
  WithoutEnvelope<RequestOf<"chat/post">>,
  "replyToMessageId"
>;
type ReadChatMessagesOptions = WithoutEnvelope<RequestOf<"chat/read">>;
type WaitForChatMessagesOptions = NullableOptional<
  WithoutEnvelope<RequestOf<"chat/wait">>,
  "afterMessageId"
>;
type CreateScheduleOptions = NullableOptional<
  WithoutEnvelope<RequestOf<"schedule/create">>,
  "name"
>;
type InspectScheduleOptions = WithId<WithoutEnvelope<RequestOf<"schedule/inspect">>>;
type UpdateScheduleOptions = WithId<WithoutEnvelope<RequestOf<"schedule/update">>>;
type RunLoopOptions = NullableOptional<
  NullableOptional<WithoutEnvelope<RequestOf<"loop/run">>, "name">,
  "verifyPrompt"
>;
type InspectLoopOptions = WithoutEnvelope<RequestOf<"loop/inspect">>;
type LoopLogsOptions = WithoutEnvelope<RequestOf<"loop/logs">>;
type StopLoopOptions = WithoutEnvelope<RequestOf<"loop/stop">>;

type ChatCreatePayload = DaemonCommandResponsePayload<"chat/create/response">;
type ChatListPayload = DaemonCommandResponsePayload<"chat/list/response">;
type ChatInspectPayload = DaemonCommandResponsePayload<"chat/inspect/response">;
type ChatDeletePayload = DaemonCommandResponsePayload<"chat/delete/response">;
type ChatPostPayload = DaemonCommandResponsePayload<"chat/post/response">;
type ChatReadPayload = DaemonCommandResponsePayload<"chat/read/response">;
type ChatWaitPayload = DaemonCommandResponsePayload<"chat/wait/response">;
type ScheduleCreatePayload = DaemonCommandResponsePayload<"schedule/create/response">;
type ScheduleListPayload = DaemonCommandResponsePayload<"schedule/list/response">;
type ScheduleInspectPayload = DaemonCommandResponsePayload<"schedule/inspect/response">;
type ScheduleLogsPayload = DaemonCommandResponsePayload<"schedule/logs/response">;
type SchedulePausePayload = DaemonCommandResponsePayload<"schedule/pause/response">;
type ScheduleResumePayload = DaemonCommandResponsePayload<"schedule/resume/response">;
type ScheduleDeletePayload = DaemonCommandResponsePayload<"schedule/delete/response">;
type ScheduleRunOncePayload = DaemonCommandResponsePayload<"schedule/run-once/response">;
type ScheduleUpdatePayload = DaemonCommandResponsePayload<"schedule/update/response">;
type LoopRunPayload = DaemonCommandResponsePayload<"loop/run/response">;
type LoopListPayload = DaemonCommandResponsePayload<"loop/list/response">;
type LoopInspectPayload = DaemonCommandResponsePayload<"loop/inspect/response">;
type LoopLogsPayload = DaemonCommandResponsePayload<"loop/logs/response">;
type LoopStopPayload = DaemonCommandResponsePayload<"loop/stop/response">;

/** Implements stateless Chat, Schedule, and Loop automation RPC commands. */
export class AutomationCommandClient {
  constructor(private readonly transport: DaemonCommandTransport) {}

  async createChatRoom(options: CreateChatRoomOptions): Promise<ChatCreatePayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "chat/create",
        name: options.name,
        ...(options.purpose ? { purpose: options.purpose } : {}),
      },
      responseType: "chat/create/response",
      timeout: 10000,
    });
  }

  async listChatRooms(requestId?: string): Promise<ChatListPayload> {
    return this.transport.request({
      requestId,
      message: {
        type: "chat/list",
      },
      responseType: "chat/list/response",
      timeout: 10000,
    });
  }

  async inspectChatRoom(options: InspectChatRoomOptions): Promise<ChatInspectPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "chat/inspect",
        room: options.room,
      },
      responseType: "chat/inspect/response",
      timeout: 10000,
    });
  }

  async deleteChatRoom(options: DeleteChatRoomOptions): Promise<ChatDeletePayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "chat/delete",
        room: options.room,
      },
      responseType: "chat/delete/response",
      timeout: 10000,
    });
  }

  async postChatMessage(options: PostChatMessageOptions): Promise<ChatPostPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "chat/post",
        room: options.room,
        body: options.body,
        ...(options.authorAgentId ? { authorAgentId: options.authorAgentId } : {}),
        ...(options.replyToMessageId ? { replyToMessageId: options.replyToMessageId } : {}),
      },
      responseType: "chat/post/response",
      timeout: 10000,
    });
  }

  async readChatMessages(options: ReadChatMessagesOptions): Promise<ChatReadPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "chat/read",
        room: options.room,
        ...(typeof options.limit === "number" ? { limit: options.limit } : {}),
        ...(options.since ? { since: options.since } : {}),
        ...(options.authorAgentId ? { authorAgentId: options.authorAgentId } : {}),
      },
      responseType: "chat/read/response",
      timeout: 10000,
    });
  }

  async waitForChatMessages(options: WaitForChatMessagesOptions): Promise<ChatWaitPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "chat/wait",
        room: options.room,
        ...(options.afterMessageId ? { afterMessageId: options.afterMessageId } : {}),
        ...(typeof options.timeoutMs === "number" ? { timeoutMs: options.timeoutMs } : {}),
      },
      responseType: "chat/wait/response",
      timeout: (options.timeoutMs ?? 0) + 10000,
    });
  }

  async scheduleCreate(options: CreateScheduleOptions): Promise<ScheduleCreatePayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "schedule/create",
        prompt: options.prompt,
        cadence: options.cadence,
        target: options.target,
        ...(options.name ? { name: options.name } : {}),
        ...(typeof options.maxRuns === "number" ? { maxRuns: options.maxRuns } : {}),
        ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
        ...(typeof options.runOnCreate === "boolean" ? { runOnCreate: options.runOnCreate } : {}),
      },
      responseType: "schedule/create/response",
      timeout: 10000,
    });
  }

  async scheduleList(requestId?: string): Promise<ScheduleListPayload> {
    return this.transport.request({
      requestId,
      message: {
        type: "schedule/list",
      },
      responseType: "schedule/list/response",
      timeout: 10000,
    });
  }

  async scheduleInspect(options: InspectScheduleOptions): Promise<ScheduleInspectPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "schedule/inspect",
        scheduleId: options.id,
      },
      responseType: "schedule/inspect/response",
      timeout: 10000,
    });
  }

  async scheduleLogs(options: InspectScheduleOptions): Promise<ScheduleLogsPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "schedule/logs",
        scheduleId: options.id,
      },
      responseType: "schedule/logs/response",
      timeout: 10000,
    });
  }

  async schedulePause(options: InspectScheduleOptions): Promise<SchedulePausePayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "schedule/pause",
        scheduleId: options.id,
      },
      responseType: "schedule/pause/response",
      timeout: 10000,
    });
  }

  async scheduleResume(options: InspectScheduleOptions): Promise<ScheduleResumePayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "schedule/resume",
        scheduleId: options.id,
      },
      responseType: "schedule/resume/response",
      timeout: 10000,
    });
  }

  async scheduleDelete(options: InspectScheduleOptions): Promise<ScheduleDeletePayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "schedule/delete",
        scheduleId: options.id,
      },
      responseType: "schedule/delete/response",
      timeout: 10000,
    });
  }

  async scheduleRunOnce(options: InspectScheduleOptions): Promise<ScheduleRunOncePayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "schedule/run-once",
        scheduleId: options.id,
      },
      responseType: "schedule/run-once/response",
      timeout: 10000,
    });
  }

  async scheduleUpdate(options: UpdateScheduleOptions): Promise<ScheduleUpdatePayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "schedule/update",
        scheduleId: options.id,
        ...(options.name !== undefined ? { name: options.name } : {}),
        ...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
        ...(options.cadence !== undefined ? { cadence: options.cadence } : {}),
        ...(options.newAgentConfig !== undefined ? { newAgentConfig: options.newAgentConfig } : {}),
        ...(options.maxRuns !== undefined ? { maxRuns: options.maxRuns } : {}),
        ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
      },
      responseType: "schedule/update/response",
      timeout: 10000,
    });
  }

  async loopRun(options: RunLoopOptions): Promise<LoopRunPayload> {
    return this.transport.request({
      requestId: options.requestId,
      message: {
        type: "loop/run",
        prompt: options.prompt,
        cwd: options.cwd,
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.modeId ? { modeId: options.modeId } : {}),
        ...(options.verifierProvider ? { verifierProvider: options.verifierProvider } : {}),
        ...(options.verifierModel ? { verifierModel: options.verifierModel } : {}),
        ...(options.verifierModeId ? { verifierModeId: options.verifierModeId } : {}),
        ...(options.verifyPrompt ? { verifyPrompt: options.verifyPrompt } : {}),
        ...(options.verifyChecks && options.verifyChecks.length > 0
          ? { verifyChecks: options.verifyChecks }
          : {}),
        ...(options.name ? { name: options.name } : {}),
        ...(typeof options.sleepMs === "number" ? { sleepMs: options.sleepMs } : {}),
        ...(typeof options.maxIterations === "number"
          ? { maxIterations: options.maxIterations }
          : {}),
        ...(typeof options.maxTimeMs === "number" ? { maxTimeMs: options.maxTimeMs } : {}),
      },
      responseType: "loop/run/response",
      timeout: 15000,
    });
  }

  async loopList(requestId?: string): Promise<LoopListPayload> {
    return this.transport.request({
      requestId,
      message: {
        type: "loop/list",
      },
      responseType: "loop/list/response",
      timeout: 10000,
    });
  }

  async loopInspect(options: string | InspectLoopOptions): Promise<LoopInspectPayload> {
    const normalized = typeof options === "string" ? { id: options } : options;
    return this.transport.request({
      requestId: typeof options === "string" ? undefined : options.requestId,
      message: {
        type: "loop/inspect",
        id: normalized.id,
      },
      responseType: "loop/inspect/response",
      timeout: 10000,
    });
  }

  async loopLogs(options: string | LoopLogsOptions, afterSeq?: number): Promise<LoopLogsPayload> {
    const normalized = typeof options === "string" ? { id: options, afterSeq } : options;
    return this.transport.request({
      requestId: typeof options === "string" ? undefined : options.requestId,
      message: {
        type: "loop/logs",
        id: normalized.id,
        ...(typeof normalized.afterSeq === "number" ? { afterSeq: normalized.afterSeq } : {}),
      },
      responseType: "loop/logs/response",
      timeout: 10000,
    });
  }

  async loopStop(options: string | StopLoopOptions): Promise<LoopStopPayload> {
    const normalized = typeof options === "string" ? { id: options } : options;
    return this.transport.request({
      requestId: typeof options === "string" ? undefined : options.requestId,
      message: {
        type: "loop/stop",
        id: normalized.id,
      },
      responseType: "loop/stop/response",
      timeout: 10000,
    });
  }
}
