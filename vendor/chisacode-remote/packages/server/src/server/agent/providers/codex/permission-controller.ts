import { randomUUID } from "node:crypto";
import { z } from "zod/v3";

import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPermissionResult,
  AgentStreamEvent,
} from "../../agent-sdk-types.js";
import { mapCodexExecNotificationToToolCall } from "./notification-timeline.js";
import { CodexPermissionState } from "./permission-state.js";
import {
  buildCodexPlanImplementationPrompt,
  buildPlanPermissionActions,
  type CodexQuestionPrompt,
  formatCodexQuestionPrompts,
  mapCodexQuestionRequestToToolCall,
  mapCodexQuestionResponseByHeader,
  normalizeCodexQuestionPrompts,
  normalizePlanMarkdown,
  resolvePermissionDecision,
} from "./permissions.js";

interface CodexPermissionControllerOptions {
  getCwd(): string | null;
  emit(event: AgentStreamEvent): void;
  onPlanApproved(): void;
}

/** Owns Codex permission request parsing, pending state, and response resolution. */
export class CodexPermissionController {
  private readonly state = new CodexPermissionState<CodexQuestionPrompt>();

  constructor(private readonly options: CodexPermissionControllerOptions) {}

  requestPlanApproval(planText: string): void {
    const requestId = `permission-${randomUUID()}`;
    const request: AgentPermissionRequest = {
      id: requestId,
      provider: "codex",
      name: "CodexPlanApproval",
      kind: "plan",
      title: "Plan",
      description: "Review the proposed plan before implementation starts.",
      input: { plan: planText },
      actions: buildPlanPermissionActions(),
      metadata: {
        planText,
        source: "codex_plan_approval",
      },
    };

    this.state.register(request, {
      resolve: () => undefined,
      kind: "plan",
      planText,
    });
    this.options.emit({ type: "permission_requested", provider: "codex", request });
  }

  getPendingPermissions(): AgentPermissionRequest[] {
    return this.state.listRequests();
  }

  respondToPermission(
    requestId: string,
    response: AgentPermissionResponse,
  ): AgentPermissionResult | void {
    const permissionEntry = this.state.take(requestId);
    if (!permissionEntry) {
      throw new Error(`No pending Codex app-server permission request with id '${requestId}'`);
    }
    const { handler: pending, request: pendingRequest } = permissionEntry;

    if (pending.kind === "plan") {
      return this.handlePlanPermissionResponse({ requestId, response, pending, pendingRequest });
    }

    if (response.behavior === "deny" && pendingRequest.kind === "tool") {
      this.emitDeniedToolCallTimelineEvent({ requestId, response, pendingRequest });
    }

    this.options.emit({
      type: "permission_resolved",
      provider: "codex",
      requestId,
      resolution: response,
    });

    if (pending.kind === "command" || pending.kind === "file") {
      pending.resolve({ decision: resolvePermissionDecision(response) });
      return;
    }

    const questions = pending.questions ?? [];
    const itemId =
      typeof pendingRequest.metadata?.itemId === "string"
        ? pendingRequest.metadata.itemId
        : requestId;
    if (response.behavior === "allow") {
      const mappedAnswers = mapCodexQuestionResponseByHeader({ questions, response });
      const answers =
        mappedAnswers ??
        Object.fromEntries(
          questions
            .map((question) => {
              const fallback = question.options[0]?.label?.trim();
              return fallback ? [question.id, { answers: [fallback] }] : null;
            })
            .filter((entry): entry is [string, { answers: string[] }] => entry !== null),
        );
      this.options.emit({
        type: "timeline",
        provider: "codex",
        item: mapCodexQuestionRequestToToolCall({
          callId: itemId,
          questions,
          status: "completed",
          answers: Object.fromEntries(
            Object.entries(answers).map(([id, value]) => [id, value.answers]),
          ),
        }),
      });
      pending.resolve({ answers });
      return;
    }

    this.options.emit({
      type: "timeline",
      provider: "codex",
      item: mapCodexQuestionRequestToToolCall({
        callId: itemId,
        questions,
        status: response.interrupt ? "canceled" : "failed",
        error: { message: response.message ?? "Question dismissed" },
      }),
    });
    pending.resolve({ answers: {} });
  }

  cancelAll(): void {
    this.state.cancelAll();
  }

  handleCommandApprovalRequest(params: unknown): Promise<unknown> {
    const parsed = z
      .object({
        itemId: z.string(),
        threadId: z.string(),
        turnId: z.string(),
        command: z.string().nullable().optional(),
        cwd: z.string().nullable().optional(),
        reason: z.string().nullable().optional(),
      })
      .parse(params);
    const commandPreview = mapCodexExecNotificationToToolCall({
      callId: parsed.itemId,
      command: parsed.command,
      cwd: parsed.cwd ?? this.options.getCwd(),
      running: true,
    });
    const requestId = `permission-${parsed.itemId}`;
    const request: AgentPermissionRequest = {
      id: requestId,
      provider: "codex",
      name: "CodexBash",
      kind: "tool",
      title: parsed.command ? `Run command: ${parsed.command}` : "Run command",
      description: parsed.reason ?? undefined,
      input: {
        command: parsed.command ?? undefined,
        cwd: parsed.cwd ?? undefined,
      },
      detail: commandPreview?.detail ?? {
        type: "unknown",
        input: {
          command: parsed.command ?? null,
          cwd: parsed.cwd ?? null,
        },
        output: null,
      },
      metadata: {
        itemId: parsed.itemId,
        threadId: parsed.threadId,
        turnId: parsed.turnId,
      },
    };
    const pendingResponse = this.state.create(request, { kind: "command" });
    this.options.emit({ type: "permission_requested", provider: "codex", request });
    return pendingResponse;
  }

  handleFileChangeApprovalRequest(params: unknown): Promise<unknown> {
    const parsed = z
      .object({
        itemId: z.string(),
        threadId: z.string(),
        turnId: z.string(),
        reason: z.string().nullable().optional(),
      })
      .parse(params);
    const requestId = `permission-${parsed.itemId}`;
    const request: AgentPermissionRequest = {
      id: requestId,
      provider: "codex",
      name: "CodexFileChange",
      kind: "tool",
      title: "Apply file changes",
      description: parsed.reason ?? undefined,
      detail: {
        type: "unknown",
        input: { reason: parsed.reason ?? null },
        output: null,
      },
      metadata: {
        itemId: parsed.itemId,
        threadId: parsed.threadId,
        turnId: parsed.turnId,
      },
    };
    const pendingResponse = this.state.create(request, { kind: "file" });
    this.options.emit({ type: "permission_requested", provider: "codex", request });
    return pendingResponse;
  }

  handleToolApprovalRequest(params: unknown): Promise<unknown> {
    const parsed = z
      .object({
        itemId: z.string(),
        threadId: z.string(),
        turnId: z.string(),
        questions: z.array(z.unknown()),
      })
      .parse(params);
    const requestId = `permission-${parsed.itemId}`;
    const questions = normalizeCodexQuestionPrompts(parsed.questions);
    const request: AgentPermissionRequest = {
      id: requestId,
      provider: "codex",
      name: "request_user_input",
      kind: "question",
      title: "Question",
      description: undefined,
      detail: {
        type: "plain_text",
        text: formatCodexQuestionPrompts(questions),
        icon: "brain",
      },
      input: { questions },
      metadata: {
        itemId: parsed.itemId,
        threadId: parsed.threadId,
        turnId: parsed.turnId,
        questions,
      },
    };
    const pendingResponse = this.state.create(request, { kind: "question", questions });
    this.options.emit({
      type: "timeline",
      provider: "codex",
      item: mapCodexQuestionRequestToToolCall({
        callId: parsed.itemId,
        questions,
        status: "running",
      }),
    });
    this.options.emit({ type: "permission_requested", provider: "codex", request });
    return pendingResponse;
  }

  private handlePlanPermissionResponse(params: {
    requestId: string;
    response: AgentPermissionResponse;
    pending: { planText?: string };
    pendingRequest: AgentPermissionRequest;
  }): AgentPermissionResult | void {
    const { requestId, response, pending, pendingRequest } = params;
    let followUpPrompt: string | undefined;
    if (response.behavior === "allow") {
      const rawPlanText = pending.planText ?? pendingRequest.metadata?.planText;
      const planText = typeof rawPlanText === "string" ? normalizePlanMarkdown(rawPlanText) : "";
      this.options.onPlanApproved();
      followUpPrompt = buildCodexPlanImplementationPrompt(planText);
    }

    this.options.emit({
      type: "permission_resolved",
      provider: "codex",
      requestId,
      resolution: response,
    });
    return followUpPrompt ? { followUpPrompt } : undefined;
  }

  private emitDeniedToolCallTimelineEvent(params: {
    requestId: string;
    response: Extract<AgentPermissionResponse, { behavior: "deny" }>;
    pendingRequest: AgentPermissionRequest;
  }): void {
    const { requestId, response, pendingRequest } = params;
    let fallbackName: string;
    if (pendingRequest.name === "CodexBash") {
      fallbackName = "shell";
    } else if (pendingRequest.name === "CodexFileChange") {
      fallbackName = "apply_patch";
    } else {
      fallbackName = pendingRequest.name;
    }
    this.options.emit({
      type: "timeline",
      provider: "codex",
      item: {
        type: "tool_call",
        callId: requestId,
        name: fallbackName,
        status: "failed",
        error: { message: response.message ?? "Permission denied" },
        detail: pendingRequest.detail ?? {
          type: "unknown",
          input: pendingRequest.input ?? null,
          output: null,
        },
        metadata: {
          permissionRequestId: requestId,
          denied: true,
        },
      },
    });
  }
}
