import { randomUUID } from "node:crypto";
import type {
  CanUseTool,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";

import type {
  AgentMetadata,
  AgentPermissionAction,
  AgentPermissionRequest,
  AgentPermissionResponse,
  AgentPermissionUpdate,
  AgentStreamEvent,
  AgentTimelineItem,
} from "../../agent-sdk-types.js";
import {
  isPermissionUpdate,
  normalizeClaudeAskUserQuestionUpdatedInput,
  resolvePermissionKind,
} from "./sdk-types-mapping.js";
import {
  mapClaudeCompletedToolCall,
  mapClaudeFailedToolCall,
  mapClaudeRunningToolCall,
} from "./tool-call-mapper.js";

export interface ClaudePendingPermission {
  request: AgentPermissionRequest;
  resolve: (result: PermissionResult) => void;
  reject: (error: Error) => void;
  cleanup?: () => void;
}

interface ClaudePermissionControllerOptions {
  getPlanResumeMode: () => PermissionMode | null;
  getModeLabel: (modeId: PermissionMode) => string;
  setMode: (modeId: PermissionMode) => Promise<void>;
  emitEvent: (event: AgentStreamEvent) => void;
  emitToolCall: (item: Extract<AgentTimelineItem, { type: "tool_call" }> | null) => void;
}

function buildClaudePlanPermissionActions(
  resumeMode: PermissionMode | null,
  getModeLabel: (modeId: PermissionMode) => string,
): AgentPermissionAction[] {
  const actions: AgentPermissionAction[] = [
    {
      id: "reject",
      label: "Reject",
      behavior: "deny",
      variant: "danger",
      intent: "dismiss",
    },
    {
      id: "implement",
      label: "Implement",
      behavior: "allow",
      variant: "primary",
      intent: "implement",
    },
  ];

  if (resumeMode === "bypassPermissions") {
    actions.push({
      id: "implement_resume",
      label: `Implement with ${getModeLabel(resumeMode)}`,
      behavior: "allow",
      variant: "secondary",
      intent: "implement_resume",
    });
  }

  return actions;
}

/** Owns Claude SDK permission requests, pending resolution state, and cleanup. */
export class ClaudePermissionController {
  private readonly pendingPermissions = new Map<string, ClaudePendingPermission>();

  constructor(private readonly options: ClaudePermissionControllerOptions) {}

  readonly handleRequest: CanUseTool = async (
    toolName,
    input,
    requestOptions,
  ): Promise<PermissionResult> => {
    const requestId = `permission-${randomUUID()}`;
    const kind = resolvePermissionKind(toolName, input);
    const metadata: AgentMetadata = {};
    if (requestOptions.toolUseID) {
      metadata.toolUseId = requestOptions.toolUseID;
    }
    if (toolName === "ExitPlanMode" && typeof input.plan === "string") {
      metadata.planText = input.plan;
    }
    const toolDetail =
      kind === "tool"
        ? mapClaudeRunningToolCall({
            name: toolName,
            callId: requestOptions.toolUseID ?? requestId,
            input,
            output: null,
          })?.detail
        : undefined;
    const planResumeMode = this.options.getPlanResumeMode();
    const request: AgentPermissionRequest = {
      id: requestId,
      provider: "claude",
      name: toolName,
      kind,
      input,
      detail: toolDetail,
      suggestions: requestOptions.suggestions?.map((suggestion) => ({ ...suggestion })),
      actions:
        kind === "plan"
          ? buildClaudePlanPermissionActions(planResumeMode, this.options.getModeLabel)
          : undefined,
      metadata: Object.keys(metadata).length ? metadata : undefined,
    };

    this.options.emitEvent({
      type: "permission_requested",
      provider: "claude",
      request,
    });

    return await new Promise<PermissionResult>((resolve, reject) => {
      const cleanupFns: Array<() => void> = [];
      const cleanup = () => {
        while (cleanupFns.length) {
          const cleanupFn = cleanupFns.pop();
          try {
            cleanupFn?.();
          } catch {
            // Ignore cleanup errors.
          }
        }
      };
      const abortHandler = () => {
        this.pendingPermissions.delete(requestId);
        cleanup();
        reject(new Error("Permission request aborted"));
      };

      if (requestOptions.signal) {
        if (requestOptions.signal.aborted) {
          abortHandler();
          return;
        }
        requestOptions.signal.addEventListener("abort", abortHandler, { once: true });
        cleanupFns.push(() => requestOptions.signal?.removeEventListener("abort", abortHandler));
      }

      this.pendingPermissions.set(requestId, {
        request,
        resolve,
        reject,
        cleanup,
      });
    });
  };

  getPending(): AgentPermissionRequest[] {
    return Array.from(this.pendingPermissions.values()).map((entry) => entry.request);
  }

  getPendingMap(): Map<string, ClaudePendingPermission> {
    return this.pendingPermissions;
  }

  async respond(requestId: string, response: AgentPermissionResponse): Promise<void> {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      throw new Error(`No pending permission request with id '${requestId}'`);
    }
    this.pendingPermissions.delete(requestId);
    pending.cleanup?.();

    if (response.behavior === "allow") {
      await this.resolveAllowedPermission(pending.request, response, pending.resolve);
    } else {
      this.resolveDeniedPermission(pending.request, response, pending.resolve);
    }

    this.options.emitEvent({
      type: "permission_resolved",
      provider: "claude",
      requestId,
      resolution: response,
    });
  }

  rejectAll(error: Error): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      pending.cleanup?.();
      pending.reject(error);
      this.pendingPermissions.delete(requestId);
    }
  }

  private async resolveAllowedPermission(
    request: AgentPermissionRequest,
    response: Extract<AgentPermissionResponse, { behavior: "allow" }>,
    resolve: (result: PermissionResult) => void,
  ): Promise<void> {
    if (request.kind === "plan") {
      const selectedActionId = response.selectedActionId;
      const shouldResumePriorMode =
        selectedActionId === "implement_resume" &&
        this.options.getPlanResumeMode() === "bypassPermissions";
      const targetMode: PermissionMode = shouldResumePriorMode
        ? "bypassPermissions"
        : "acceptEdits";
      await this.options.setMode(targetMode);
      this.options.emitToolCall(
        mapClaudeCompletedToolCall({
          name: "plan_approval",
          callId: request.id,
          input: request.input ?? null,
          output: {
            approved: true,
            actionId: selectedActionId ?? "implement",
          },
        }),
      );
    }

    const updatedInput =
      request.kind === "question"
        ? normalizeClaudeAskUserQuestionUpdatedInput(
            response.updatedInput,
            request.input ?? undefined,
          )
        : (response.updatedInput ?? request.input ?? {});
    resolve({
      behavior: "allow",
      updatedInput,
      updatedPermissions: this.normalizePermissionUpdates(response.updatedPermissions),
    });
  }

  private resolveDeniedPermission(
    request: AgentPermissionRequest,
    response: Extract<AgentPermissionResponse, { behavior: "deny" }>,
    resolve: (result: PermissionResult) => void,
  ): void {
    if (request.kind === "tool") {
      this.options.emitToolCall(
        mapClaudeFailedToolCall({
          name: request.name,
          callId:
            (typeof request.metadata?.toolUseId === "string" ? request.metadata.toolUseId : null) ??
            request.id,
          input: request.input ?? null,
          output: null,
          error: { message: response.message ?? "Permission denied" },
        }),
      );
    }
    resolve({
      behavior: "deny",
      message: response.message ?? "Permission request denied",
      interrupt: response.interrupt,
    });
  }

  private normalizePermissionUpdates(
    updates?: AgentPermissionUpdate[],
  ): PermissionUpdate[] | undefined {
    if (!updates || updates.length === 0) {
      return undefined;
    }
    const normalized = updates.filter(isPermissionUpdate);
    return normalized.length > 0 ? normalized : undefined;
  }
}
