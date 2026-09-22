import { z } from "zod/v3";

import {
  ChatCreateRequestSchema,
  ChatCreateResponseSchema,
  ChatDeleteRequestSchema,
  ChatDeleteResponseSchema,
  ChatInspectRequestSchema,
  ChatInspectResponseSchema,
  ChatListRequestSchema,
  ChatListResponseSchema,
  ChatPostRequestSchema,
  ChatPostResponseSchema,
  ChatReadRequestSchema,
  ChatReadResponseSchema,
  ChatWaitRequestSchema,
  ChatWaitResponseSchema,
} from "../chat/rpc-schemas.js";
import {
  LoopInspectRequestSchema,
  LoopInspectResponseSchema,
  LoopListRequestSchema,
  LoopListResponseSchema,
  LoopLogsRequestSchema,
  LoopLogsResponseSchema,
  LoopRunRequestSchema,
  LoopRunResponseSchema,
  LoopStopRequestSchema,
  LoopStopResponseSchema,
} from "../loop/rpc-schemas.js";
import {
  ScheduleCreateRequestSchema,
  ScheduleCreateResponseSchema,
  ScheduleDeleteRequestSchema,
  ScheduleDeleteResponseSchema,
  ScheduleInspectRequestSchema,
  ScheduleInspectResponseSchema,
  ScheduleListRequestSchema,
  ScheduleListResponseSchema,
  ScheduleLogsRequestSchema,
  ScheduleLogsResponseSchema,
  SchedulePauseRequestSchema,
  SchedulePauseResponseSchema,
  ScheduleResumeRequestSchema,
  ScheduleResumeResponseSchema,
  ScheduleRunOnceRequestSchema,
  ScheduleRunOnceResponseSchema,
  ScheduleUpdateRequestSchema,
  ScheduleUpdateResponseSchema,
} from "../schedule/rpc-schemas.js";

export * from "../chat/rpc-schemas.js";
export * from "../loop/rpc-schemas.js";
export * from "../schedule/rpc-schemas.js";

/** Chat, schedule, and loop requests accepted by a daemon session. */
export const AutomationInboundMessageSchemas = [
  ChatCreateRequestSchema,
  ChatListRequestSchema,
  ChatInspectRequestSchema,
  ChatDeleteRequestSchema,
  ChatPostRequestSchema,
  ChatReadRequestSchema,
  ChatWaitRequestSchema,
  ScheduleCreateRequestSchema,
  ScheduleListRequestSchema,
  ScheduleInspectRequestSchema,
  ScheduleLogsRequestSchema,
  SchedulePauseRequestSchema,
  ScheduleResumeRequestSchema,
  ScheduleDeleteRequestSchema,
  ScheduleRunOnceRequestSchema,
  ScheduleUpdateRequestSchema,
  LoopRunRequestSchema,
  LoopListRequestSchema,
  LoopInspectRequestSchema,
  LoopLogsRequestSchema,
  LoopStopRequestSchema,
] as const;

/** Chat, schedule, and loop responses emitted by a daemon session. */
export const AutomationOutboundMessageSchemas = [
  ChatCreateResponseSchema,
  ChatListResponseSchema,
  ChatInspectResponseSchema,
  ChatDeleteResponseSchema,
  ChatPostResponseSchema,
  ChatReadResponseSchema,
  ChatWaitResponseSchema,
  ScheduleCreateResponseSchema,
  ScheduleListResponseSchema,
  ScheduleInspectResponseSchema,
  ScheduleLogsResponseSchema,
  SchedulePauseResponseSchema,
  ScheduleResumeResponseSchema,
  ScheduleDeleteResponseSchema,
  ScheduleRunOnceResponseSchema,
  ScheduleUpdateResponseSchema,
  LoopRunResponseSchema,
  LoopListResponseSchema,
  LoopInspectResponseSchema,
  LoopLogsResponseSchema,
  LoopStopResponseSchema,
] as const;

/** Any automation request accepted by the daemon session protocol. */
export type AutomationInboundMessage = z.infer<(typeof AutomationInboundMessageSchemas)[number]>;

/** Any automation response emitted by the daemon session protocol. */
export type AutomationOutboundMessage = z.infer<(typeof AutomationOutboundMessageSchemas)[number]>;

/** Request payload for creating a chat room. */
export type ChatCreateRequest = z.infer<typeof ChatCreateRequestSchema>;
/** Request payload for listing chat rooms. */
export type ChatListRequest = z.infer<typeof ChatListRequestSchema>;
/** Request payload for inspecting a chat room. */
export type ChatInspectRequest = z.infer<typeof ChatInspectRequestSchema>;
/** Request payload for deleting a chat room. */
export type ChatDeleteRequest = z.infer<typeof ChatDeleteRequestSchema>;
/** Request payload for posting a chat message. */
export type ChatPostRequest = z.infer<typeof ChatPostRequestSchema>;
/** Request payload for reading chat messages. */
export type ChatReadRequest = z.infer<typeof ChatReadRequestSchema>;
/** Request payload for waiting for chat messages. */
export type ChatWaitRequest = z.infer<typeof ChatWaitRequestSchema>;
/** Response emitted after creating a chat room. */
export type ChatCreateResponse = z.infer<typeof ChatCreateResponseSchema>;
/** Response emitted after listing chat rooms. */
export type ChatListResponse = z.infer<typeof ChatListResponseSchema>;
/** Response emitted after inspecting a chat room. */
export type ChatInspectResponse = z.infer<typeof ChatInspectResponseSchema>;
/** Response emitted after deleting a chat room. */
export type ChatDeleteResponse = z.infer<typeof ChatDeleteResponseSchema>;
/** Response emitted after posting a chat message. */
export type ChatPostResponse = z.infer<typeof ChatPostResponseSchema>;
/** Response emitted after reading chat messages. */
export type ChatReadResponse = z.infer<typeof ChatReadResponseSchema>;
/** Response emitted after waiting for chat messages. */
export type ChatWaitResponse = z.infer<typeof ChatWaitResponseSchema>;
/** Request payload for creating a schedule. */
export type ScheduleCreateRequest = z.infer<typeof ScheduleCreateRequestSchema>;
/** Request payload for listing schedules. */
export type ScheduleListRequest = z.infer<typeof ScheduleListRequestSchema>;
/** Request payload for inspecting a schedule. */
export type ScheduleInspectRequest = z.infer<typeof ScheduleInspectRequestSchema>;
/** Request payload for reading schedule run logs. */
export type ScheduleLogsRequest = z.infer<typeof ScheduleLogsRequestSchema>;
/** Request payload for pausing a schedule. */
export type SchedulePauseRequest = z.infer<typeof SchedulePauseRequestSchema>;
/** Request payload for resuming a schedule. */
export type ScheduleResumeRequest = z.infer<typeof ScheduleResumeRequestSchema>;
/** Request payload for deleting a schedule. */
export type ScheduleDeleteRequest = z.infer<typeof ScheduleDeleteRequestSchema>;
/** Request payload for running a schedule immediately. */
export type ScheduleRunOnceRequest = z.infer<typeof ScheduleRunOnceRequestSchema>;
/** Request payload for updating a schedule. */
export type ScheduleUpdateRequest = z.infer<typeof ScheduleUpdateRequestSchema>;
/** Response emitted after creating a schedule. */
export type ScheduleCreateResponse = z.infer<typeof ScheduleCreateResponseSchema>;
/** Response emitted after listing schedules. */
export type ScheduleListResponse = z.infer<typeof ScheduleListResponseSchema>;
/** Response emitted after inspecting a schedule. */
export type ScheduleInspectResponse = z.infer<typeof ScheduleInspectResponseSchema>;
/** Response emitted after reading schedule run logs. */
export type ScheduleLogsResponse = z.infer<typeof ScheduleLogsResponseSchema>;
/** Response emitted after pausing a schedule. */
export type SchedulePauseResponse = z.infer<typeof SchedulePauseResponseSchema>;
/** Response emitted after resuming a schedule. */
export type ScheduleResumeResponse = z.infer<typeof ScheduleResumeResponseSchema>;
/** Response emitted after deleting a schedule. */
export type ScheduleDeleteResponse = z.infer<typeof ScheduleDeleteResponseSchema>;
/** Response emitted after running a schedule immediately. */
export type ScheduleRunOnceResponse = z.infer<typeof ScheduleRunOnceResponseSchema>;
/** Response emitted after updating a schedule. */
export type ScheduleUpdateResponse = z.infer<typeof ScheduleUpdateResponseSchema>;
