/**
 * ChatScheduleLoopHandler — extracted from Session.
 *
 * Handles chat, schedule, and loop RPC requests. Three independent services
 * with similar request/response/error patterns.
 */

import { ChatServiceError } from "../chat/chat-service.js";
import { postChatMessageCommand } from "../chat/post-message-command.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import type { ScheduleService } from "../schedule/service.js";
import type { ChatScheduleLoopHandlerContext, DisposableHandler } from "./session-context.js";
import { summarizeUntrustedLogIdentifier } from "../log-metadata.js";

/** Handles chat room, schedule, and loop RPC operations. */
export class ChatScheduleLoopHandler implements DisposableHandler {
  private readonly context: ChatScheduleLoopHandlerContext;

  constructor(context: ChatScheduleLoopHandlerContext) {
    this.context = context;
  }

  dispose(): void {
    // No subscriptions or timers to clean up.
  }

  // --- Chat handlers ---

  private emitChatRpcError(request: { requestId: string; type: string }, error: unknown): void {
    const message = error instanceof Error ? error.message : "Chat request failed";
    const code = error instanceof ChatServiceError ? error.code : "chat_request_failed";
    this.context.sessionLogger.error(
      {
        requestType: request.type,
        requestId: summarizeUntrustedLogIdentifier(request.requestId),
        category: "chat",
        code,
      },
      "Chat request failed",
    );
    this.context.emit({
      type: "rpc_error",
      payload: { requestId: request.requestId, requestType: request.type, error: message, code },
    });
  }

  /** Handle chat room creation. */
  async handleChatCreateRequest(
    request: Extract<SessionInboundMessage, { type: "chat/create" }>,
  ): Promise<void> {
    try {
      const room = await this.context.chatService.createRoom({
        name: request.name,
        purpose: request.purpose,
      });
      this.context.emit({
        type: "chat/create/response",
        payload: { requestId: request.requestId, room, error: null },
      });
    } catch (error) {
      this.emitChatRpcError(request, error);
    }
  }

  /** Handle chat room listing. */
  async handleChatListRequest(
    request: Extract<SessionInboundMessage, { type: "chat/list" }>,
  ): Promise<void> {
    try {
      const rooms = await this.context.chatService.listRooms();
      this.context.emit({
        type: "chat/list/response",
        payload: { requestId: request.requestId, rooms, error: null },
      });
    } catch (error) {
      this.emitChatRpcError(request, error);
    }
  }

  /** Handle chat room inspection (detail view plus recent messages). */
  async handleChatInspectRequest(
    request: Extract<SessionInboundMessage, { type: "chat/inspect" }>,
  ): Promise<void> {
    try {
      const result = await this.context.chatService.inspectRoom({ room: request.room });
      this.context.emit({
        type: "chat/inspect/response",
        payload: { requestId: request.requestId, room: result.room, error: null },
      });
    } catch (error) {
      this.emitChatRpcError(request, error);
    }
  }

  /** Handle chat room deletion. */
  async handleChatDeleteRequest(
    request: Extract<SessionInboundMessage, { type: "chat/delete" }>,
  ): Promise<void> {
    try {
      const result = await this.context.chatService.deleteRoom({ room: request.room });
      this.context.emit({
        type: "chat/delete/response",
        payload: { requestId: request.requestId, room: result.room, error: null },
      });
    } catch (error) {
      this.emitChatRpcError(request, error);
    }
  }

  /** Handle posting a message to a chat room, including mention fan-out. */
  async handleChatPostRequest(
    request: Extract<SessionInboundMessage, { type: "chat/post" }>,
  ): Promise<void> {
    try {
      const authorAgentId = request.authorAgentId?.trim() || this.context.clientId;
      const message = await postChatMessageCommand(
        {
          chatService: this.context.chatService,
          agentManager: this.context.agentManager,
          agentStorage: this.context.agentStorage,
          logger: this.context.sessionLogger,
          resolveAgentIdentifier: (identifier) => this.context.resolveAgentIdentifier(identifier),
        },
        {
          room: request.room,
          authorAgentId,
          body: request.body,
          replyToMessageId: request.replyToMessageId,
        },
      );
      this.context.emit({
        type: "chat/post/response",
        payload: { requestId: request.requestId, message, error: null },
      });
    } catch (error) {
      this.emitChatRpcError(request, error);
    }
  }

  /** Handle reading messages from a chat room with optional pagination. */
  async handleChatReadRequest(
    request: Extract<SessionInboundMessage, { type: "chat/read" }>,
  ): Promise<void> {
    try {
      const messages = await this.context.chatService.readMessages({
        room: request.room,
        limit: request.limit,
        since: request.since,
        authorAgentId: request.authorAgentId,
      });
      this.context.emit({
        type: "chat/read/response",
        payload: { requestId: request.requestId, messages, error: null },
      });
    } catch (error) {
      this.emitChatRpcError(request, error);
    }
  }

  /** Handle long-polling wait for new messages in a chat room. */
  async handleChatWaitRequest(
    request: Extract<SessionInboundMessage, { type: "chat/wait" }>,
  ): Promise<void> {
    try {
      const messages = await this.context.chatService.waitForMessages({
        room: request.room,
        afterMessageId: request.afterMessageId,
        timeoutMs: request.timeoutMs,
        signal: this.context.getOperationAbortSignal(),
      });
      this.context.emit({
        type: "chat/wait/response",
        payload: {
          requestId: request.requestId,
          messages,
          timedOut: messages.length === 0,
          error: null,
        },
      });
    } catch (error) {
      this.emitChatRpcError(request, error);
    }
  }

  // --- Schedule handlers ---

  private toScheduleSummary(
    schedule: Awaited<ReturnType<ScheduleService["inspect"]>>,
  ): Extract<
    SessionOutboundMessage,
    { type: "schedule/list/response" }
  >["payload"]["schedules"][number] {
    const { runs: _runs, ...summary } = schedule;
    return summary;
  }

  private emitScheduleRpcError(
    request: Extract<
      SessionInboundMessage,
      {
        type:
          | "schedule/create"
          | "schedule/list"
          | "schedule/inspect"
          | "schedule/logs"
          | "schedule/pause"
          | "schedule/resume"
          | "schedule/delete"
          | "schedule/run-once"
          | "schedule/update";
      }
    >,
    error: unknown,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    this.context.sessionLogger.error(
      {
        requestType: request.type,
        requestId: summarizeUntrustedLogIdentifier(request.requestId),
        category: "schedule",
        code: "schedule_request_failed",
      },
      "Schedule request failed",
    );
    this.context.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        error: message,
        code: "schedule_request_failed",
      },
    });
  }

  /** Handle schedule creation. */
  async handleScheduleCreateRequest(
    request: Extract<SessionInboundMessage, { type: "schedule/create" }>,
  ): Promise<void> {
    try {
      const target =
        request.target.type === "self"
          ? { type: "agent" as const, agentId: request.target.agentId }
          : request.target;
      const schedule = await this.context.scheduleService.create({
        prompt: request.prompt,
        name: request.name,
        cadence: request.cadence,
        target,
        maxRuns: request.maxRuns,
        expiresAt: request.expiresAt,
        runOnCreate: request.runOnCreate,
      });
      this.context.emit({
        type: "schedule/create/response",
        payload: {
          requestId: request.requestId,
          schedule: this.toScheduleSummary(schedule),
          error: null,
        },
      });
    } catch (error) {
      this.emitScheduleRpcError(request, error);
    }
  }

  /** Handle listing all schedules. */
  async handleScheduleListRequest(
    request: Extract<SessionInboundMessage, { type: "schedule/list" }>,
  ): Promise<void> {
    try {
      const schedules = await this.context.scheduleService.list();
      this.context.emit({
        type: "schedule/list/response",
        payload: {
          requestId: request.requestId,
          schedules: schedules.map((s) => this.toScheduleSummary(s)),
          error: null,
        },
      });
    } catch (error) {
      this.emitScheduleRpcError(request, error);
    }
  }

  /** Handle inspecting a specific schedule including its run history. */
  async handleScheduleInspectRequest(
    request: Extract<SessionInboundMessage, { type: "schedule/inspect" }>,
  ): Promise<void> {
    try {
      const schedule = await this.context.scheduleService.inspect(request.scheduleId);
      this.context.emit({
        type: "schedule/inspect/response",
        payload: { requestId: request.requestId, schedule, error: null },
      });
    } catch (error) {
      this.emitScheduleRpcError(request, error);
    }
  }

  /** Handle fetching schedule run logs. */
  async handleScheduleLogsRequest(
    request: Extract<SessionInboundMessage, { type: "schedule/logs" }>,
  ): Promise<void> {
    try {
      const runs = await this.context.scheduleService.logs(request.scheduleId);
      this.context.emit({
        type: "schedule/logs/response",
        payload: { requestId: request.requestId, runs, error: null },
      });
    } catch (error) {
      this.emitScheduleRpcError(request, error);
    }
  }

  /** Handle pausing a schedule. */
  async handleSchedulePauseRequest(
    request: Extract<SessionInboundMessage, { type: "schedule/pause" }>,
  ): Promise<void> {
    try {
      const schedule = await this.context.scheduleService.pause(request.scheduleId);
      this.context.emit({
        type: "schedule/pause/response",
        payload: {
          requestId: request.requestId,
          schedule: this.toScheduleSummary(schedule),
          error: null,
        },
      });
    } catch (error) {
      this.emitScheduleRpcError(request, error);
    }
  }

  /** Handle resuming a paused schedule. */
  async handleScheduleResumeRequest(
    request: Extract<SessionInboundMessage, { type: "schedule/resume" }>,
  ): Promise<void> {
    try {
      const schedule = await this.context.scheduleService.resume(request.scheduleId);
      this.context.emit({
        type: "schedule/resume/response",
        payload: {
          requestId: request.requestId,
          schedule: this.toScheduleSummary(schedule),
          error: null,
        },
      });
    } catch (error) {
      this.emitScheduleRpcError(request, error);
    }
  }

  /** Handle deleting a schedule. */
  async handleScheduleDeleteRequest(
    request: Extract<SessionInboundMessage, { type: "schedule/delete" }>,
  ): Promise<void> {
    try {
      await this.context.scheduleService.delete(request.scheduleId);
      this.context.emit({
        type: "schedule/delete/response",
        payload: { requestId: request.requestId, scheduleId: request.scheduleId, error: null },
      });
    } catch (error) {
      this.emitScheduleRpcError(request, error);
    }
  }

  /** Handle triggering a single run of a schedule immediately. */
  async handleScheduleRunOnceRequest(
    request: Extract<SessionInboundMessage, { type: "schedule/run-once" }>,
  ): Promise<void> {
    try {
      const schedule = await this.context.scheduleService.runOnce(request.scheduleId);
      this.context.emit({
        type: "schedule/run-once/response",
        payload: { requestId: request.requestId, schedule, error: null },
      });
    } catch (error) {
      this.emitScheduleRpcError(request, error);
    }
  }

  /** Handle updating an existing schedule's configuration. */
  async handleScheduleUpdateRequest(
    request: Extract<SessionInboundMessage, { type: "schedule/update" }>,
  ): Promise<void> {
    try {
      const schedule = await this.context.scheduleService.update({
        id: request.scheduleId,
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
        ...(request.cadence !== undefined ? { cadence: request.cadence } : {}),
        ...(request.newAgentConfig !== undefined ? { newAgentConfig: request.newAgentConfig } : {}),
        ...(request.maxRuns !== undefined ? { maxRuns: request.maxRuns } : {}),
        ...(request.expiresAt !== undefined ? { expiresAt: request.expiresAt } : {}),
      });
      this.context.emit({
        type: "schedule/update/response",
        payload: { requestId: request.requestId, schedule, error: null },
      });
    } catch (error) {
      this.emitScheduleRpcError(request, error);
    }
  }

  // --- Loop handlers ---

  private emitLoopRpcError(
    request: Extract<
      SessionInboundMessage,
      { type: "loop/run" | "loop/list" | "loop/inspect" | "loop/logs" | "loop/stop" }
    >,
    error: unknown,
  ): void {
    const message = error instanceof Error ? error.message : String(error);
    this.context.sessionLogger.error(
      {
        requestType: request.type,
        requestId: summarizeUntrustedLogIdentifier(request.requestId),
        category: "loop",
        code: "loop_request_failed",
      },
      "Loop request failed",
    );
    this.context.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        error: message,
        code: "loop_request_failed",
      },
    });
  }

  /** Handle starting a new loop run. */
  async handleLoopRunRequest(
    request: Extract<SessionInboundMessage, { type: "loop/run" }>,
  ): Promise<void> {
    try {
      const loop = await this.context.loopService.runLoop({
        prompt: request.prompt,
        cwd: request.cwd,
        provider: request.provider,
        model: request.model,
        modeId: request.modeId,
        workerProvider: request.workerProvider,
        workerModel: request.workerModel,
        verifierProvider: request.verifierProvider,
        verifierModel: request.verifierModel,
        verifierModeId: request.verifierModeId,
        verifyPrompt: request.verifyPrompt,
        verifyChecks: request.verifyChecks,
        archive: request.archive,
        name: request.name,
        sleepMs: request.sleepMs,
        maxIterations: request.maxIterations,
        maxTimeMs: request.maxTimeMs,
      });
      this.context.emit({
        type: "loop/run/response",
        payload: { requestId: request.requestId, loop, error: null },
      });
    } catch (error) {
      this.emitLoopRpcError(request, error);
    }
  }

  /** Handle listing all loops. */
  async handleLoopListRequest(
    request: Extract<SessionInboundMessage, { type: "loop/list" }>,
  ): Promise<void> {
    try {
      const loops = await this.context.loopService.listLoops();
      this.context.emit({
        type: "loop/list/response",
        payload: { requestId: request.requestId, loops, error: null },
      });
    } catch (error) {
      this.emitLoopRpcError(request, error);
    }
  }

  /** Handle inspecting a specific loop's status and iteration history. */
  async handleLoopInspectRequest(
    request: Extract<SessionInboundMessage, { type: "loop/inspect" }>,
  ): Promise<void> {
    try {
      const loop = await this.context.loopService.inspectLoop(request.id);
      this.context.emit({
        type: "loop/inspect/response",
        payload: { requestId: request.requestId, loop, error: null },
      });
    } catch (error) {
      this.emitLoopRpcError(request, error);
    }
  }

  /** Handle fetching loop iteration logs with cursor-based pagination. */
  async handleLoopLogsRequest(
    request: Extract<SessionInboundMessage, { type: "loop/logs" }>,
  ): Promise<void> {
    try {
      const result = await this.context.loopService.getLoopLogs(request.id, request.afterSeq ?? 0);
      this.context.emit({
        type: "loop/logs/response",
        payload: {
          requestId: request.requestId,
          loop: result.loop,
          entries: result.entries,
          nextCursor: result.nextCursor,
          error: null,
        },
      });
    } catch (error) {
      this.emitLoopRpcError(request, error);
    }
  }

  /** Handle stopping a running loop. */
  async handleLoopStopRequest(
    request: Extract<SessionInboundMessage, { type: "loop/stop" }>,
  ): Promise<void> {
    try {
      const loop = await this.context.loopService.stopLoop(request.id);
      this.context.emit({
        type: "loop/stop/response",
        payload: { requestId: request.requestId, loop, error: null },
      });
    } catch (error) {
      this.emitLoopRpcError(request, error);
    }
  }
}
