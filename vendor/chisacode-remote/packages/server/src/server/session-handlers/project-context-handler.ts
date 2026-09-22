/**
 * ProjectContextHandler — project knowledge discovery RPC handler.
 *
 * Exposes build/inspect/invalidate RPCs for workspace project context.
 */

import type { SessionInboundMessage } from "../messages.js";
import type { DisposableHandler } from "./session-context.js";
import { summarizeUntrustedLogIdentifier } from "../log-metadata.js";
import { buildProjectContext, loadProjectContext, workspaceCacheKey } from "../project-context.js";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

export interface ProjectContextHandlerContext {
  readonly sessionLogger: { error(obj: unknown, msg: string): void };
  readonly chisacodeHome: string;
  emit(message: unknown): void;
}

/** Handles project context RPC operations. */
export class ProjectContextHandler implements DisposableHandler {
  private readonly context: ProjectContextHandlerContext;

  constructor(context: ProjectContextHandlerContext) {
    this.context = context;
  }

  dispose(): void {}

  private get cacheDir(): string {
    return path.join(this.context.chisacodeHome, "context");
  }

  private emitRpcError(request: { requestId: string; type: string }, error: unknown): void {
    const message = error instanceof Error ? error.message : "Context request failed";
    this.context.sessionLogger.error(
      {
        requestType: request.type,
        requestId: summarizeUntrustedLogIdentifier(request.requestId),
        category: "context",
        code: "context_request_failed",
      },
      "Context request failed",
    );
    this.context.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        error: message,
        code: "context_request_failed",
      },
    });
  }

  async handleContextBuildRequest(
    request: Extract<SessionInboundMessage, { type: "context/build" }>,
  ): Promise<void> {
    try {
      const ctx = buildProjectContext(request.workDir);
      this.context.emit({
        type: "context/build/response",
        payload: {
          requestId: request.requestId,
          context: serializeContext(ctx),
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleContextInspectRequest(
    request: Extract<SessionInboundMessage, { type: "context/inspect" }>,
  ): Promise<void> {
    try {
      const ctx = loadProjectContext(request.workDir, this.cacheDir);
      const cachePath = path.join(this.cacheDir, `${workspaceCacheKey(request.workDir)}.json`);
      const cached = existsSync(cachePath);
      this.context.emit({
        type: "context/inspect/response",
        payload: {
          requestId: request.requestId,
          context: serializeContext(ctx),
          cached,
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleContextInvalidateRequest(
    request: Extract<SessionInboundMessage, { type: "context/invalidate" }>,
  ): Promise<void> {
    try {
      const cachePath = path.join(this.cacheDir, `${workspaceCacheKey(request.workDir)}.json`);
      if (existsSync(cachePath)) {
        unlinkSync(cachePath);
      }
      this.context.emit({
        type: "context/invalidate/response",
        payload: { requestId: request.requestId, error: null },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }
}

function serializeContext(ctx: ReturnType<typeof buildProjectContext>) {
  return {
    workDir: ctx.workDir,
    projectName: ctx.projectName,
    modules: ctx.modules,
    toc: ctx.toc,
    builtAt: new Date(ctx.builtAt).toISOString(),
  };
}
