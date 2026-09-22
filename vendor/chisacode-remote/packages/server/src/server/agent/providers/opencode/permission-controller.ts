import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { Logger } from "pino";

import type { AgentPermissionRequest, AgentPermissionResponse } from "../../agent-sdk-types.js";
import { readNonEmptyString, readOpenCodeRecord } from "./event-translator.js";
import { resolveOpenCodePermissionReply } from "./helpers.js";

interface OpenCodePermissionControllerOptions {
  client: Pick<OpencodeClient, "permission" | "question">;
  getDirectory: () => string;
  logger: Logger;
  autoAcceptEnabled: boolean;
}

/** Owns OpenCode permission queueing, auto-approval, and provider responses. */
export class OpenCodePermissionController {
  private readonly pending = new Map<string, AgentPermissionRequest>();
  private autoAcceptEnabled: boolean;

  constructor(private readonly options: OpenCodePermissionControllerOptions) {
    this.autoAcceptEnabled = options.autoAcceptEnabled;
  }

  setAutoAcceptEnabled(enabled: boolean): void {
    this.autoAcceptEnabled = enabled;
  }

  getPending(): AgentPermissionRequest[] {
    return Array.from(this.pending.values());
  }

  async register(request: AgentPermissionRequest): Promise<boolean> {
    if (await this.tryAutoApprove(request)) {
      return false;
    }
    this.pending.set(request.id, request);
    return true;
  }

  async respond(requestId: string, response: AgentPermissionResponse): Promise<void> {
    const pending = this.pending.get(requestId);
    if (!pending) {
      throw new Error(`No pending permission request with id '${requestId}'`);
    }

    if (pending.kind === "question") {
      await this.respondToQuestion(requestId, pending, response);
      this.pending.delete(requestId);
      return;
    }

    const reply = resolveOpenCodePermissionReply(response);
    await this.options.client.permission.reply({
      requestID: requestId,
      directory: this.options.getDirectory(),
      reply,
      message: response.behavior === "deny" ? response.message : undefined,
    });
    this.pending.delete(requestId);
  }

  private async respondToQuestion(
    requestId: string,
    pending: AgentPermissionRequest,
    response: AgentPermissionResponse,
  ): Promise<void> {
    const directory = this.options.getDirectory();
    if (response.behavior === "deny") {
      await this.options.client.question.reject({ requestID: requestId, directory });
      return;
    }

    const answersRecord = readOpenCodeRecord(response.updatedInput?.answers);
    const questions = Array.isArray(pending.input?.questions) ? pending.input.questions : [];
    const answers = questions.map((item) => {
      const header = readNonEmptyString(readOpenCodeRecord(item)?.header);
      const rawAnswer = header ? readNonEmptyString(answersRecord?.[header]) : null;
      if (!rawAnswer) {
        return [];
      }
      return rawAnswer
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    });
    await this.options.client.question.reply({ requestID: requestId, directory, answers });
  }

  private async tryAutoApprove(request: AgentPermissionRequest): Promise<boolean> {
    if (!this.autoAcceptEnabled || request.kind !== "tool") {
      return false;
    }
    try {
      await this.options.client.permission.reply({
        requestID: request.id,
        directory: this.options.getDirectory(),
        reply: "once",
      });
      return true;
    } catch (error) {
      this.options.logger.warn(
        { err: error, requestId: request.id },
        "Failed to auto-approve OpenCode tool permission",
      );
      return false;
    }
  }
}
