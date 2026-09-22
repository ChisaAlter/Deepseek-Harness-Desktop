import type { AgentPermissionRequest } from "../../agent-sdk-types.js";

export interface CodexPendingPermission<TQuestions> {
  resolve: (value: unknown) => void;
  kind: "command" | "file" | "question" | "plan";
  questions?: TQuestions[];
  planText?: string;
}

interface CodexPermissionEntry<TQuestions> {
  request: AgentPermissionRequest;
  handler: CodexPendingPermission<TQuestions>;
}

/** Owns pending Codex permission requests and their app-server response handlers. */
export class CodexPermissionState<TQuestions> {
  private readonly entries = new Map<string, CodexPermissionEntry<TQuestions>>();

  register(request: AgentPermissionRequest, handler: CodexPendingPermission<TQuestions>): void {
    this.entries.set(request.id, { request, handler });
  }

  create(
    request: AgentPermissionRequest,
    pending: Omit<CodexPendingPermission<TQuestions>, "resolve">,
  ): Promise<unknown> {
    return new Promise((resolve) => {
      this.register(request, { ...pending, resolve });
    });
  }

  listRequests(): AgentPermissionRequest[] {
    return Array.from(this.entries.values(), ({ request }) => request);
  }

  take(requestId: string): CodexPermissionEntry<TQuestions> | null {
    const entry = this.entries.get(requestId) ?? null;
    if (entry) {
      this.entries.delete(requestId);
    }
    return entry;
  }

  cancelAll(): void {
    for (const { handler } of this.entries.values()) {
      handler.resolve({ decision: "cancel" });
    }
    this.entries.clear();
  }
}
