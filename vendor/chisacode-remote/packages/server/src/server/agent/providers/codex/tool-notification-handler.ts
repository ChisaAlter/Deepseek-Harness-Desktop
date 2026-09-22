import type { Logger } from "pino";

import type { ToolCallTimelineItem } from "../../agent-sdk-types.js";
import { extractCodexTerminalSessionId } from "../tool-call-mapper-utils.js";
import { CodexNotificationStreamState } from "./notification-stream-state.js";
import {
  isEditToolCallWithoutContent,
  mapCodexExecNotificationToToolCall,
  mapCodexPatchNotificationToToolCall,
  mapCodexTerminalInteractionToToolCall,
  normalizeCodexCommandValue,
} from "./notification-timeline.js";
import type { ParsedCodexNotification } from "./notifications.js";

interface CodexToolNotificationHandlerOptions {
  logger: Logger;
  notificationStream: CodexNotificationStreamState;
  getCwd: () => string | null;
  emit: (item: ToolCallTimelineItem) => void;
}

export class CodexToolNotificationHandler {
  private readonly logger: Logger;
  private readonly notificationStream: CodexNotificationStreamState;
  private readonly getCwd: () => string | null;
  private readonly emit: (item: ToolCallTimelineItem) => void;

  constructor(options: CodexToolNotificationHandlerOptions) {
    this.logger = options.logger;
    this.notificationStream = options.notificationStream;
    this.getCwd = options.getCwd;
    this.emit = options.emit;
  }

  handleExecCommandStarted(
    parsed: Extract<ParsedCodexNotification, { kind: "exec_command_started" }>,
  ): void {
    if (parsed.callId) {
      this.notificationStream.markExecCommandStarted(parsed.callId);
      this.notificationStream.clearCommandOutput(parsed.callId);
    }
    const timelineItem = mapCodexExecNotificationToToolCall({
      callId: parsed.callId,
      command: parsed.command,
      cwd: parsed.cwd ?? this.getCwd(),
      running: true,
    });
    if (timelineItem) {
      this.emit(timelineItem);
    }
  }

  handleExecCommandCompleted(
    parsed: Extract<ParsedCodexNotification, { kind: "exec_command_completed" }>,
  ): void {
    const bufferedOutput = this.notificationStream.consumeCommandOutput(parsed.callId);
    const resolvedOutput = parsed.output ?? bufferedOutput;
    this.rememberTerminalProcessForCommand(parsed.command, resolvedOutput);
    const timelineItem = mapCodexExecNotificationToToolCall({
      callId: parsed.callId,
      command: parsed.command,
      cwd: parsed.cwd ?? this.getCwd(),
      output: resolvedOutput,
      exitCode: parsed.exitCode,
      success: parsed.success,
      stderr: parsed.stderr,
      running: false,
    });
    if (timelineItem) {
      this.notificationStream.markExecCommandCompleted(timelineItem.callId);
      this.emit(timelineItem);
    }
  }

  handleTerminalInteraction(
    parsed: Extract<ParsedCodexNotification, { kind: "terminal_interaction" }>,
  ): void {
    const interactionKey = [parsed.processId ?? "", parsed.stdin ?? ""].join("\u0000");
    if (!this.notificationStream.shouldEmitTerminalInteraction(interactionKey)) {
      return;
    }
    const command = parsed.processId
      ? this.notificationStream.resolveTerminalCommand(parsed.processId)
      : null;
    if (!command && parsed.processId) {
      this.notificationStream.markPendingTerminalInteraction(parsed.processId);
    }
    this.emit(
      mapCodexTerminalInteractionToToolCall({
        processId: parsed.processId,
        fallbackCallId: parsed.callId,
        command,
      }),
    );
  }

  handlePatchApplyStarted(
    parsed: Extract<ParsedCodexNotification, { kind: "patch_apply_started" }>,
  ): void {
    if (parsed.callId) {
      this.notificationStream.clearFileChangeOutput(parsed.callId);
    }
    const timelineItem = mapCodexPatchNotificationToToolCall({
      callId: parsed.callId,
      changes: parsed.changes,
      cwd: this.getCwd(),
      running: true,
    });
    if (timelineItem) {
      this.warnOnIncompleteEditToolCall(timelineItem, "patch_apply_started", {
        callId: parsed.callId,
        changes: parsed.changes,
      });
      this.emit(timelineItem);
    }
  }

  handlePatchApplyCompleted(
    parsed: Extract<ParsedCodexNotification, { kind: "patch_apply_completed" }>,
  ): void {
    const bufferedOutput = this.notificationStream.consumeFileChangeOutput(parsed.callId);
    const timelineItem = mapCodexPatchNotificationToToolCall({
      callId: parsed.callId,
      changes: parsed.changes,
      cwd: this.getCwd(),
      stdout: parsed.stdout ?? bufferedOutput,
      stderr: parsed.stderr,
      success: parsed.success,
      running: false,
    });
    if (timelineItem) {
      this.warnOnIncompleteEditToolCall(timelineItem, "patch_apply_completed", {
        callId: parsed.callId,
        changes: parsed.changes,
        stdout: parsed.stdout,
      });
      this.emit(timelineItem);
    }
  }

  warnOnIncompleteEditToolCall(item: ToolCallTimelineItem, source: string, payload: unknown): void {
    if (!isEditToolCallWithoutContent(item)) {
      return;
    }
    const warnKey = source + ":" + item.callId;
    if (!this.notificationStream.shouldWarnIncompleteEdit(warnKey)) {
      return;
    }
    this.logger.warn(
      {
        source,
        callId: item.callId,
        status: item.status,
        name: item.name,
        detail: item.detail,
        payload,
      },
      "Codex edit tool call is missing diff/content fields",
    );
  }

  private rememberTerminalProcessForCommand(command: unknown, output: string | null): void {
    const normalizedCommand = normalizeCodexCommandValue(command);
    if (!normalizedCommand) {
      return;
    }
    const displayCommand =
      typeof normalizedCommand === "string"
        ? normalizedCommand
        : normalizedCommand.join(" ").trim();
    if (!displayCommand) {
      return;
    }
    const processId = extractCodexTerminalSessionId(output ?? undefined);
    if (!processId) {
      return;
    }
    if (!this.notificationStream.rememberTerminalCommand(processId, displayCommand)) {
      return;
    }
    this.emit(
      mapCodexTerminalInteractionToToolCall({
        processId,
        command: displayCommand,
      }),
    );
  }
}
