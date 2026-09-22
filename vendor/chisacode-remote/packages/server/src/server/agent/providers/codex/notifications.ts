import { z } from "zod/v3";

const ThreadStartedNotificationSchema = z
  .object({
    thread: z.object({ id: z.string() }).passthrough(),
  })
  .passthrough();

const TurnStartedNotificationSchema = z
  .object({
    threadId: z.string().optional(),
    turn: z.object({ id: z.string() }).passthrough(),
  })
  .passthrough();

const TurnCompletedNotificationSchema = z
  .object({
    threadId: z.string().optional(),
    turn: z
      .object({
        status: z.string(),
        error: z
          .object({
            message: z.string().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

const TurnPlanUpdatedNotificationSchema = z
  .object({
    plan: z.array(
      z
        .object({
          step: z.string().optional(),
          status: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const TurnDiffUpdatedNotificationSchema = z
  .object({
    diff: z.string(),
  })
  .passthrough();

const ThreadTokenUsageUpdatedNotificationSchema = z
  .object({
    tokenUsage: z.unknown(),
  })
  .passthrough();

const ItemTextDeltaNotificationSchema = z
  .object({
    threadId: z.string().optional(),
    itemId: z.string(),
    delta: z.string(),
  })
  .passthrough();

const ItemLifecycleNotificationSchema = z
  .object({
    threadId: z.string().optional(),
    item: z
      .object({
        id: z.string().optional(),
        type: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const ContextCompactedNotificationSchema = z
  .object({
    threadId: z.string(),
    turnId: z.string().optional(),
  })
  .passthrough();

const CodexEventTurnAbortedNotificationSchema = z
  .object({
    msg: z
      .object({
        type: z.literal("turn_aborted"),
        reason: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const CodexEventTaskCompleteNotificationSchema = z
  .object({
    msg: z
      .object({
        type: z.literal("task_complete"),
      })
      .passthrough(),
  })
  .passthrough();

const CodexEventItemLifecycleNotificationSchema = z
  .object({
    threadId: z.string().optional(),
    msg: z
      .object({
        type: z.enum(["item_started", "item_completed"]),
        threadId: z.string().optional(),
        thread_id: z.string().optional(),
        item: z
          .object({
            id: z.string().optional(),
            type: z.string().optional(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const CodexEventExecCommandBeginNotificationSchema = z
  .object({
    msg: z
      .object({
        type: z.literal("exec_command_begin"),
        call_id: z.string().optional(),
        command: z.unknown().optional(),
        cwd: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const CodexEventExecCommandEndNotificationSchema = z
  .object({
    msg: z
      .object({
        type: z.literal("exec_command_end"),
        call_id: z.string().optional(),
        command: z.unknown().optional(),
        cwd: z.string().optional(),
        stdout: z.string().optional(),
        stderr: z.string().optional(),
        aggregated_output: z.string().optional(),
        aggregatedOutput: z.string().optional(),
        formatted_output: z.string().optional(),
        exit_code: z.number().nullable().optional(),
        exitCode: z.number().nullable().optional(),
        success: z.boolean().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const CodexEventExecCommandOutputDeltaNotificationSchema = z
  .object({
    msg: z
      .object({
        type: z.literal("exec_command_output_delta"),
        call_id: z.string().optional(),
        stream: z.string().optional(),
        chunk: z.string().optional(),
        delta: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const CodexEventTerminalInteractionNotificationSchema = z
  .object({
    msg: z
      .object({
        type: z.literal("terminal_interaction"),
        call_id: z.string().optional(),
        process_id: z.union([z.string(), z.number()]).optional(),
        stdin: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const ItemCommandExecutionTerminalInteractionNotificationSchema = z
  .object({
    itemId: z.string().optional(),
    processId: z.union([z.string(), z.number()]).optional(),
    stdin: z.string().optional(),
  })
  .passthrough();

const CodexEventPatchApplyBeginNotificationSchema = z
  .object({
    msg: z
      .object({
        type: z.literal("patch_apply_begin"),
        call_id: z.string().optional(),
        changes: z.unknown().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const CodexEventPatchApplyEndNotificationSchema = z
  .object({
    msg: z
      .object({
        type: z.literal("patch_apply_end"),
        call_id: z.string().optional(),
        changes: z.unknown().optional(),
        stdout: z.string().optional(),
        stderr: z.string().optional(),
        success: z.boolean().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const ItemFileChangeOutputDeltaNotificationSchema = z
  .object({
    itemId: z.string(),
    delta: z.string().optional(),
    chunk: z.string().optional(),
  })
  .passthrough();

const CodexEventTurnDiffNotificationSchema = z
  .object({
    msg: z
      .object({
        type: z.literal("turn_diff"),
        unified_diff: z.string().optional(),
        diff: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const CodexEventThreadRolledBackNotificationSchema = z
  .object({
    msg: z
      .object({
        type: z.literal("thread_rolled_back"),
        num_turns: z.number().int().nonnegative().optional(),
        numTurns: z.number().int().nonnegative().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type ParsedCodexNotification =
  | { kind: "thread_started"; threadId: string }
  | { kind: "turn_started"; turnId: string; threadId: string | null }
  | {
      kind: "turn_completed";
      status: string;
      errorMessage: string | null;
      threadId: string | null;
    }
  | { kind: "plan_updated"; plan: Array<{ step: string | null; status: string | null }> }
  | { kind: "diff_updated"; diff: string }
  | { kind: "token_usage_updated"; tokenUsage: unknown }
  | { kind: "agent_message_delta"; itemId: string; delta: string; threadId: string | null }
  | { kind: "reasoning_delta"; itemId: string; delta: string; threadId: string | null }
  | {
      kind: "item_completed";
      source: "item" | "codex_event";
      threadId: string | null;
      item: { id?: string; type?: string; [key: string]: unknown };
    }
  | {
      kind: "item_started";
      source: "item" | "codex_event";
      threadId: string | null;
      item: { id?: string; type?: string; [key: string]: unknown };
    }
  | {
      kind: "exec_command_started";
      callId: string | null;
      command: unknown;
      cwd: string | null;
    }
  | {
      kind: "exec_command_completed";
      callId: string | null;
      command: unknown;
      cwd: string | null;
      output: string | null;
      exitCode: number | null;
      success: boolean | null;
      stderr: string | null;
    }
  | {
      kind: "exec_command_output_delta";
      callId: string | null;
      stream: string | null;
      chunk: string | null;
    }
  | {
      kind: "terminal_interaction";
      source: "item" | "codex_event";
      callId: string | null;
      processId: string | null;
      stdin: string | null;
    }
  | {
      kind: "patch_apply_started";
      callId: string | null;
      changes: unknown;
    }
  | {
      kind: "patch_apply_completed";
      callId: string | null;
      changes: unknown;
      stdout: string | null;
      stderr: string | null;
      success: boolean | null;
    }
  | {
      kind: "file_change_output_delta";
      itemId: string;
      delta: string | null;
    }
  | { kind: "thread_rolled_back"; numTurns: number }
  | { kind: "context_compacted"; threadId: string; turnId: string | null }
  | { kind: "invalid_payload"; method: string; params: unknown }
  | { kind: "unknown_method"; method: string; params: unknown };

export type CodexDeltaNotification = Extract<
  ParsedCodexNotification,
  {
    kind:
      | "agent_message_delta"
      | "reasoning_delta"
      | "exec_command_output_delta"
      | "file_change_output_delta";
  }
>;

export function isCodexDeltaNotification(
  parsed: ParsedCodexNotification,
): parsed is CodexDeltaNotification {
  return (
    parsed.kind === "agent_message_delta" ||
    parsed.kind === "reasoning_delta" ||
    parsed.kind === "exec_command_output_delta" ||
    parsed.kind === "file_change_output_delta"
  );
}

export const CodexNotificationSchema = z.union([
  z
    .object({ method: z.literal("thread/started"), params: ThreadStartedNotificationSchema })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "thread_started",
        threadId: params.thread.id,
      }),
    ),
  z.object({ method: z.literal("thread/started"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z.object({ method: z.literal("turn/started"), params: TurnStartedNotificationSchema }).transform(
    ({ params }): ParsedCodexNotification => ({
      kind: "turn_started",
      turnId: params.turn.id,
      threadId: params.threadId ?? null,
    }),
  ),
  z.object({ method: z.literal("turn/started"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({ method: z.literal("turn/completed"), params: TurnCompletedNotificationSchema })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "turn_completed",
        status: params.turn.status,
        errorMessage: params.turn.error?.message ?? null,
        threadId: params.threadId ?? null,
      }),
    ),
  z.object({ method: z.literal("turn/completed"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({ method: z.literal("turn/plan/updated"), params: TurnPlanUpdatedNotificationSchema })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "plan_updated",
        plan: params.plan.map((entry) => ({
          step: entry.step ?? null,
          status: entry.status ?? null,
        })),
      }),
    ),
  z.object({ method: z.literal("turn/plan/updated"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({ method: z.literal("turn/diff/updated"), params: TurnDiffUpdatedNotificationSchema })
    .transform(
      ({ params }): ParsedCodexNotification => ({ kind: "diff_updated", diff: params.diff }),
    ),
  z.object({ method: z.literal("turn/diff/updated"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({
      method: z.literal("thread/tokenUsage/updated"),
      params: ThreadTokenUsageUpdatedNotificationSchema,
    })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "token_usage_updated",
        tokenUsage: params.tokenUsage,
      }),
    ),
  z.object({ method: z.literal("thread/tokenUsage/updated"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({ method: z.literal("thread/compacted"), params: ContextCompactedNotificationSchema })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "context_compacted",
        threadId: params.threadId,
        turnId: params.turnId ?? null,
      }),
    ),
  z.object({ method: z.literal("thread/compacted"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({
      method: z.literal("item/agentMessage/delta"),
      params: ItemTextDeltaNotificationSchema,
    })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "agent_message_delta",
        itemId: params.itemId,
        delta: params.delta,
        threadId: params.threadId ?? null,
      }),
    ),
  z.object({ method: z.literal("item/agentMessage/delta"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({
      method: z.enum([
        "item/reasoning/summaryTextDelta",
        "item/reasoning/textDelta",
        "item/reasoning/delta",
        "item/reasoning/contentDelta",
      ]),
      params: ItemTextDeltaNotificationSchema,
    })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "reasoning_delta",
        itemId: params.itemId,
        delta: params.delta,
        threadId: params.threadId ?? null,
      }),
    ),
  z
    .object({
      method: z.enum([
        "item/reasoning/summaryTextDelta",
        "item/reasoning/textDelta",
        "item/reasoning/delta",
        "item/reasoning/contentDelta",
      ]),
      params: z.unknown(),
    })
    .transform(
      ({ method, params }): ParsedCodexNotification => ({
        kind: "invalid_payload",
        method,
        params,
      }),
    ),
  z
    .object({ method: z.literal("item/completed"), params: ItemLifecycleNotificationSchema })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "item_completed",
        source: "item",
        threadId: params.threadId ?? null,
        item: params.item,
      }),
    ),
  z.object({ method: z.literal("item/completed"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({ method: z.literal("item/started"), params: ItemLifecycleNotificationSchema })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "item_started",
        source: "item",
        threadId: params.threadId ?? null,
        item: params.item,
      }),
    ),
  z.object({ method: z.literal("item/started"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({
      method: z.literal("codex/event/item_started"),
      params: CodexEventItemLifecycleNotificationSchema,
    })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "item_started",
        source: "codex_event",
        threadId: params.threadId ?? params.msg.threadId ?? params.msg.thread_id ?? null,
        item: params.msg.item,
      }),
    ),
  z.object({ method: z.literal("codex/event/item_started"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({
      method: z.literal("codex/event/item_completed"),
      params: CodexEventItemLifecycleNotificationSchema,
    })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "item_completed",
        source: "codex_event",
        threadId: params.threadId ?? params.msg.threadId ?? params.msg.thread_id ?? null,
        item: params.msg.item,
      }),
    ),
  z.object({ method: z.literal("codex/event/item_completed"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({
      method: z.literal("codex/event/exec_command_begin"),
      params: CodexEventExecCommandBeginNotificationSchema,
    })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "exec_command_started",
        callId: params.msg.call_id ?? null,
        command: params.msg.command ?? null,
        cwd: params.msg.cwd ?? null,
      }),
    ),
  z.object({ method: z.literal("codex/event/exec_command_begin"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({
      method: z.literal("codex/event/exec_command_end"),
      params: CodexEventExecCommandEndNotificationSchema,
    })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "exec_command_completed",
        callId: params.msg.call_id ?? null,
        command: params.msg.command ?? null,
        cwd: params.msg.cwd ?? null,
        output:
          params.msg.aggregated_output ??
          params.msg.aggregatedOutput ??
          params.msg.formatted_output ??
          params.msg.stdout ??
          null,
        exitCode: params.msg.exit_code ?? params.msg.exitCode ?? null,
        success: params.msg.success ?? null,
        stderr: params.msg.stderr ?? null,
      }),
    ),
  z.object({ method: z.literal("codex/event/exec_command_end"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({
      method: z.literal("codex/event/exec_command_output_delta"),
      params: CodexEventExecCommandOutputDeltaNotificationSchema,
    })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "exec_command_output_delta",
        callId: params.msg.call_id ?? null,
        stream: params.msg.stream ?? null,
        chunk: params.msg.chunk ?? params.msg.delta ?? null,
      }),
    ),
  z
    .object({
      method: z.literal("codex/event/exec_command_output_delta"),
      params: z.unknown(),
    })
    .transform(
      ({ method, params }): ParsedCodexNotification => ({
        kind: "invalid_payload",
        method,
        params,
      }),
    ),
  z
    .object({
      method: z.literal("codex/event/terminal_interaction"),
      params: CodexEventTerminalInteractionNotificationSchema,
    })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "terminal_interaction",
        source: "codex_event",
        callId: params.msg.call_id ?? null,
        processId:
          typeof params.msg.process_id === "number"
            ? String(params.msg.process_id)
            : (params.msg.process_id ?? null),
        stdin: params.msg.stdin ?? null,
      }),
    ),
  z
    .object({ method: z.literal("codex/event/terminal_interaction"), params: z.unknown() })
    .transform(
      ({ method, params }): ParsedCodexNotification => ({
        kind: "invalid_payload",
        method,
        params,
      }),
    ),
  z
    .object({
      method: z.literal("item/commandExecution/terminalInteraction"),
      params: ItemCommandExecutionTerminalInteractionNotificationSchema,
    })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "terminal_interaction",
        source: "item",
        callId: params.itemId ?? null,
        processId:
          typeof params.processId === "number"
            ? String(params.processId)
            : (params.processId ?? null),
        stdin: params.stdin ?? null,
      }),
    ),
  z
    .object({
      method: z.literal("item/commandExecution/terminalInteraction"),
      params: z.unknown(),
    })
    .transform(
      ({ method, params }): ParsedCodexNotification => ({
        kind: "invalid_payload",
        method,
        params,
      }),
    ),
  z
    .object({
      method: z.literal("codex/event/patch_apply_begin"),
      params: CodexEventPatchApplyBeginNotificationSchema,
    })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "patch_apply_started",
        callId: params.msg.call_id ?? null,
        changes: params.msg.changes ?? null,
      }),
    ),
  z.object({ method: z.literal("codex/event/patch_apply_begin"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({
      method: z.literal("codex/event/patch_apply_end"),
      params: CodexEventPatchApplyEndNotificationSchema,
    })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "patch_apply_completed",
        callId: params.msg.call_id ?? null,
        changes: params.msg.changes ?? null,
        stdout: params.msg.stdout ?? null,
        stderr: params.msg.stderr ?? null,
        success: params.msg.success ?? null,
      }),
    ),
  z.object({ method: z.literal("codex/event/patch_apply_end"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({
      method: z.literal("item/fileChange/outputDelta"),
      params: ItemFileChangeOutputDeltaNotificationSchema,
    })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "file_change_output_delta",
        itemId: params.itemId,
        delta: params.delta ?? params.chunk ?? null,
      }),
    ),
  z.object({ method: z.literal("item/fileChange/outputDelta"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({
      method: z.literal("codex/event/turn_diff"),
      params: CodexEventTurnDiffNotificationSchema,
    })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "diff_updated",
        diff: params.msg.unified_diff ?? params.msg.diff ?? "",
      }),
    ),
  z.object({ method: z.literal("codex/event/turn_diff"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({
      method: z.literal("codex/event/turn_aborted"),
      params: CodexEventTurnAbortedNotificationSchema,
    })
    .transform(
      (): ParsedCodexNotification => ({
        kind: "turn_completed",
        status: "interrupted",
        errorMessage: null,
        threadId: null,
      }),
    ),
  z.object({ method: z.literal("codex/event/turn_aborted"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({
      method: z.literal("codex/event/task_complete"),
      params: CodexEventTaskCompleteNotificationSchema,
    })
    .transform(
      (): ParsedCodexNotification => ({
        kind: "turn_completed",
        status: "completed",
        errorMessage: null,
        threadId: null,
      }),
    ),
  z.object({ method: z.literal("codex/event/task_complete"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({
      method: z.literal("codex/event/thread_rolled_back"),
      params: CodexEventThreadRolledBackNotificationSchema,
    })
    .transform(
      ({ params }): ParsedCodexNotification => ({
        kind: "thread_rolled_back",
        numTurns: params.msg.num_turns ?? params.msg.numTurns ?? 0,
      }),
    ),
  z.object({ method: z.literal("codex/event/thread_rolled_back"), params: z.unknown() }).transform(
    ({ method, params }): ParsedCodexNotification => ({
      kind: "invalid_payload",
      method,
      params,
    }),
  ),
  z
    .object({ method: z.string(), params: z.unknown() })
    .transform(
      ({ method, params }): ParsedCodexNotification => ({ kind: "unknown_method", method, params }),
    ),
]);
