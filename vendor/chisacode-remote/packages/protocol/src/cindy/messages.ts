import { z } from "zod/v3";

import {
  GoalSetRequestSchema,
  GoalSetResponseSchema,
  GoalCancelRequestSchema,
  GoalCancelResponseSchema,
  GoalInspectRequestSchema,
  GoalInspectResponseSchema,
  GoalListRequestSchema,
  GoalListResponseSchema,
} from "../goal/rpc-schemas.js";
import {
  TeamStartRequestSchema,
  TeamStartResponseSchema,
  TeamEndRequestSchema,
  TeamEndResponseSchema,
  TeamCreateWorkerRequestSchema,
  TeamCreateWorkerResponseSchema,
  TeamListWorkersRequestSchema,
  TeamListWorkersResponseSchema,
  TeamSendToWorkerRequestSchema,
  TeamSendToWorkerResponseSchema,
  TeamListQueueRequestSchema,
  TeamListQueueResponseSchema,
  TeamCancelMessageRequestSchema,
  TeamCancelMessageResponseSchema,
  TeamArchiveWorkerRequestSchema,
  TeamArchiveWorkerResponseSchema,
  TeamSwitchFocusRequestSchema,
  TeamSwitchFocusResponseSchema,
  TeamWorkerStatusRequestSchema,
  TeamWorkerStatusResponseSchema,
} from "../team/rpc-schemas.js";
import {
  ContextBuildRequestSchema,
  ContextBuildResponseSchema,
  ContextInspectRequestSchema,
  ContextInspectResponseSchema,
  ContextInvalidateRequestSchema,
  ContextInvalidateResponseSchema,
} from "../project-context/rpc-schemas.js";
import {
  SnapshotCreateRequestSchema,
  SnapshotCreateResponseSchema,
  SnapshotListRequestSchema,
  SnapshotListResponseSchema,
  SnapshotRewindRequestSchema,
  SnapshotRewindResponseSchema,
  SnapshotStatusRequestSchema,
  SnapshotStatusResponseSchema,
} from "../snapshot/rpc-schemas.js";
import {
  MigrationDetectRequestSchema,
  MigrationDetectResponseSchema,
  MigrationApplyRequestSchema,
  MigrationApplyResponseSchema,
  MigrationAvailableNotificationSchema,
} from "../migration/rpc-schemas.js";
import {
  LearnStartRequestSchema,
  LearnStartResponseSchema,
  LearnListRequestSchema,
  LearnListResponseSchema,
  LearnInspectRequestSchema,
  LearnInspectResponseSchema,
  LearnApplyRequestSchema,
  LearnApplyResponseSchema,
  LearnDiscardRequestSchema,
  LearnDiscardResponseSchema,
  LearnCancelRequestSchema,
  LearnCancelResponseSchema,
} from "../learn/rpc-schemas.js";

export * from "../goal/rpc-schemas.js";
export * from "../team/rpc-schemas.js";
export * from "../project-context/rpc-schemas.js";
export * from "../snapshot/rpc-schemas.js";
export * from "../migration/rpc-schemas.js";
export * from "../learn/rpc-schemas.js";

/** Goal, team, context, snapshot, migration, and learn requests accepted by a daemon session. */
export const CindyInboundMessageSchemas = [
  // Goal
  GoalSetRequestSchema,
  GoalCancelRequestSchema,
  GoalInspectRequestSchema,
  GoalListRequestSchema,
  // Team
  TeamStartRequestSchema,
  TeamEndRequestSchema,
  TeamCreateWorkerRequestSchema,
  TeamListWorkersRequestSchema,
  TeamSendToWorkerRequestSchema,
  TeamListQueueRequestSchema,
  TeamCancelMessageRequestSchema,
  TeamArchiveWorkerRequestSchema,
  TeamSwitchFocusRequestSchema,
  TeamWorkerStatusRequestSchema,
  // Project Context
  ContextBuildRequestSchema,
  ContextInspectRequestSchema,
  ContextInvalidateRequestSchema,
  // Snapshot
  SnapshotCreateRequestSchema,
  SnapshotListRequestSchema,
  SnapshotRewindRequestSchema,
  SnapshotStatusRequestSchema,
  // Migration
  MigrationDetectRequestSchema,
  MigrationApplyRequestSchema,
  // Learn
  LearnStartRequestSchema,
  LearnListRequestSchema,
  LearnInspectRequestSchema,
  LearnApplyRequestSchema,
  LearnDiscardRequestSchema,
  LearnCancelRequestSchema,
] as const;

/** Goal, team, context, snapshot, migration, and learn responses emitted by a daemon session. */
export const CindyOutboundMessageSchemas = [
  // Goal
  GoalSetResponseSchema,
  GoalCancelResponseSchema,
  GoalInspectResponseSchema,
  GoalListResponseSchema,
  // Team
  TeamStartResponseSchema,
  TeamEndResponseSchema,
  TeamCreateWorkerResponseSchema,
  TeamListWorkersResponseSchema,
  TeamSendToWorkerResponseSchema,
  TeamListQueueResponseSchema,
  TeamCancelMessageResponseSchema,
  TeamArchiveWorkerResponseSchema,
  TeamSwitchFocusResponseSchema,
  TeamWorkerStatusResponseSchema,
  // Project Context
  ContextBuildResponseSchema,
  ContextInspectResponseSchema,
  ContextInvalidateResponseSchema,
  // Snapshot
  SnapshotCreateResponseSchema,
  SnapshotListResponseSchema,
  SnapshotRewindResponseSchema,
  SnapshotStatusResponseSchema,
  // Migration
  MigrationDetectResponseSchema,
  MigrationApplyResponseSchema,
  MigrationAvailableNotificationSchema,
  // Learn
  LearnStartResponseSchema,
  LearnListResponseSchema,
  LearnInspectResponseSchema,
  LearnApplyResponseSchema,
  LearnDiscardResponseSchema,
  LearnCancelResponseSchema,
] as const;

/** Any Cindy-module request accepted by the daemon session protocol. */
export type CindyInboundMessage = z.infer<(typeof CindyInboundMessageSchemas)[number]>;

/** Any Cindy-module response emitted by the daemon session protocol. */
export type CindyOutboundMessage = z.infer<(typeof CindyOutboundMessageSchemas)[number]>;
