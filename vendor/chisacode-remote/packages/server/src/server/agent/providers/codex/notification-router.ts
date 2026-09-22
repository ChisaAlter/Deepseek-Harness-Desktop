import {
  CodexNotificationSchema,
  isCodexDeltaNotification,
  type CodexDeltaNotification,
  type ParsedCodexNotification,
} from "./notifications.js";

type NotificationHandler<Kind extends ParsedCodexNotification["kind"]> = (
  parsed: Extract<ParsedCodexNotification, { kind: Kind }>,
) => void;

export interface CodexNotificationRouterHandlers {
  onParsed(method: string, params: unknown, parsed: ParsedCodexNotification): void;
  onDelta(parsed: CodexDeltaNotification): void;
  onThreadStarted: NotificationHandler<"thread_started">;
  onTurnStarted: NotificationHandler<"turn_started">;
  onTurnCompleted: NotificationHandler<"turn_completed">;
  onPlanUpdated: NotificationHandler<"plan_updated">;
  onTokenUsageUpdated: NotificationHandler<"token_usage_updated">;
  onContextCompacted: NotificationHandler<"context_compacted">;
  onThreadRolledBack: NotificationHandler<"thread_rolled_back">;
  onExecCommandStarted: NotificationHandler<"exec_command_started">;
  onExecCommandCompleted: NotificationHandler<"exec_command_completed">;
  onTerminalInteraction: NotificationHandler<"terminal_interaction">;
  onPatchApplyStarted: NotificationHandler<"patch_apply_started">;
  onPatchApplyCompleted: NotificationHandler<"patch_apply_completed">;
  onItemCompleted: NotificationHandler<"item_completed">;
  onItemStarted: NotificationHandler<"item_started">;
  onInvalidPayload: NotificationHandler<"invalid_payload">;
  onUnknownMethod: NotificationHandler<"unknown_method">;
}

/** Parses and routes Codex app-server notifications to domain handlers. */
export class CodexNotificationRouter {
  constructor(private readonly handlers: CodexNotificationRouterHandlers) {}

  route(method: string, params: unknown): void {
    const parsed = CodexNotificationSchema.parse({ method, params });
    this.handlers.onParsed(method, params, parsed);
    if (isCodexDeltaNotification(parsed)) {
      this.handlers.onDelta(parsed);
      return;
    }

    switch (parsed.kind) {
      case "thread_started":
        this.handlers.onThreadStarted(parsed);
        return;
      case "turn_started":
        this.handlers.onTurnStarted(parsed);
        return;
      case "turn_completed":
        this.handlers.onTurnCompleted(parsed);
        return;
      case "plan_updated":
        this.handlers.onPlanUpdated(parsed);
        return;
      case "diff_updated":
        // Full-turn accumulated diff telemetry is not a concrete tool call.
        return;
      case "token_usage_updated":
        this.handlers.onTokenUsageUpdated(parsed);
        return;
      case "context_compacted":
        this.handlers.onContextCompacted(parsed);
        return;
      case "thread_rolled_back":
        this.handlers.onThreadRolledBack(parsed);
        return;
      case "exec_command_started":
        this.handlers.onExecCommandStarted(parsed);
        return;
      case "exec_command_completed":
        this.handlers.onExecCommandCompleted(parsed);
        return;
      case "terminal_interaction":
        this.handlers.onTerminalInteraction(parsed);
        return;
      case "patch_apply_started":
        this.handlers.onPatchApplyStarted(parsed);
        return;
      case "patch_apply_completed":
        this.handlers.onPatchApplyCompleted(parsed);
        return;
      case "item_completed":
        this.handlers.onItemCompleted(parsed);
        return;
      case "item_started":
        this.handlers.onItemStarted(parsed);
        return;
      case "invalid_payload":
        this.handlers.onInvalidPayload(parsed);
        return;
      case "unknown_method":
        this.handlers.onUnknownMethod(parsed);
        return;
    }
  }
}
