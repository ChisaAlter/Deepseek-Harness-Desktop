/**
 * MigrationHandler — cross-agent config migration RPC handler.
 *
 * Exposes detect/apply RPCs for converting config files between agents.
 */

import type { SessionInboundMessage } from "../messages.js";
import type { DisposableHandler } from "./session-context.js";
import { summarizeUntrustedLogIdentifier } from "../log-metadata.js";
import type { Logger } from "pino";
import { detectMigrations, runMigrations } from "../../utils/config-migration.js";

export interface MigrationHandlerContext {
  readonly sessionLogger: Logger;
  emit(message: unknown): void;
}

/** Handles config migration RPC operations. */
export class MigrationHandler implements DisposableHandler {
  private readonly context: MigrationHandlerContext;

  constructor(context: MigrationHandlerContext) {
    this.context = context;
  }

  dispose(): void {}

  private emitRpcError(request: { requestId: string; type: string }, error: unknown): void {
    const message = error instanceof Error ? error.message : "Migration request failed";
    this.context.sessionLogger.error(
      {
        requestType: request.type,
        requestId: summarizeUntrustedLogIdentifier(request.requestId),
        category: "migration",
        code: "migration_request_failed",
      },
      "Migration request failed",
    );
    this.context.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        error: message,
        code: "migration_request_failed",
      },
    });
  }

  async handleMigrationDetectRequest(
    request: Extract<SessionInboundMessage, { type: "migration/detect" }>,
  ): Promise<void> {
    try {
      const result = detectMigrations(request.workDir, request.targetAgent);
      this.context.emit({
        type: "migration/detect/response",
        payload: {
          requestId: request.requestId,
          items: result.items,
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleMigrationApplyRequest(
    request: Extract<SessionInboundMessage, { type: "migration/apply" }>,
  ): Promise<void> {
    try {
      const { results } = runMigrations(
        request.workDir,
        request.targetAgent,
        this.context.sessionLogger,
      );
      this.context.emit({
        type: "migration/apply/response",
        payload: {
          requestId: request.requestId,
          outcomes: results.map((r) => r.outcome),
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }
}
