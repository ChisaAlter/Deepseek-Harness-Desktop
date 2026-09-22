/**
 * SnapshotHandler — git snapshot/rewind RPC handler.
 *
 * Exposes create/list/rewind/status RPCs for automatic edit snapshots.
 */

import type { SessionInboundMessage } from "../messages.js";
import type { DisposableHandler } from "./session-context.js";
import { summarizeUntrustedLogIdentifier } from "../log-metadata.js";
import type { Logger } from "pino";
import {
  createSnapshot,
  listSnapshots,
  rewindToSnapshot,
  detectBlockedGitState,
  parseSnapshotTrailers,
} from "../git-snapshot.js";

export interface SnapshotHandlerContext {
  readonly sessionLogger: Logger;
  emit(message: unknown): void;
}

/** Handles git snapshot RPC operations. */
export class SnapshotHandler implements DisposableHandler {
  private readonly context: SnapshotHandlerContext;

  constructor(context: SnapshotHandlerContext) {
    this.context = context;
  }

  dispose(): void {}

  private emitRpcError(request: { requestId: string; type: string }, error: unknown): void {
    const message = error instanceof Error ? error.message : "Snapshot request failed";
    this.context.sessionLogger.error(
      {
        requestType: request.type,
        requestId: summarizeUntrustedLogIdentifier(request.requestId),
        category: "snapshot",
        code: "snapshot_request_failed",
      },
      "Snapshot request failed",
    );
    this.context.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        error: message,
        code: "snapshot_request_failed",
      },
    });
  }

  async handleSnapshotCreateRequest(
    request: Extract<SessionInboundMessage, { type: "snapshot/create" }>,
  ): Promise<void> {
    try {
      const result = await createSnapshot(
        request.cwd,
        {
          kind: "manual",
          label: request.label,
          agentId: request.agentId,
        },
        this.context.sessionLogger,
      );
      this.context.emit({
        type: "snapshot/create/response",
        payload: {
          requestId: request.requestId,
          commitHash: result.commitHash ?? null,
          excludedFiles: result.excludedFiles ?? [],
          error: result.ok ? null : (result.reason ?? "Snapshot failed"),
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleSnapshotListRequest(
    request: Extract<SessionInboundMessage, { type: "snapshot/list" }>,
  ): Promise<void> {
    try {
      const snapshots = await listSnapshots(
        request.cwd,
        this.context.sessionLogger,
        request.limit ?? 20,
      );
      this.context.emit({
        type: "snapshot/list/response",
        payload: {
          requestId: request.requestId,
          snapshots: snapshots.map(toSnapshotEntry),
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleSnapshotRewindRequest(
    request: Extract<SessionInboundMessage, { type: "snapshot/rewind" }>,
  ): Promise<void> {
    try {
      // Rewind all files (empty array = all tracked files from that snapshot)
      const result = await rewindToSnapshot(
        request.cwd,
        request.commitHash,
        [],
        this.context.sessionLogger,
      );
      this.context.emit({
        type: "snapshot/rewind/response",
        payload: {
          requestId: request.requestId,
          restoredFiles: result.restoredFiles ?? [],
          error: result.ok ? null : (result.reason ?? "Rewind failed"),
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleSnapshotStatusRequest(
    request: Extract<SessionInboundMessage, { type: "snapshot/status" }>,
  ): Promise<void> {
    try {
      const blocked = await detectBlockedGitState(request.cwd, this.context.sessionLogger);
      const snapshots = await listSnapshots(request.cwd, this.context.sessionLogger, 1);
      const latest = snapshots[0] ?? null;
      this.context.emit({
        type: "snapshot/status/response",
        payload: {
          requestId: request.requestId,
          blocked: blocked ? { reason: blocked.reason } : null,
          latestSnapshot: latest ? toSnapshotEntry(latest) : null,
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }
}

type SnapshotEntryKind =
  | "before-edit"
  | "after-edit"
  | "manual"
  | "pre-rollback"
  | "rewind-blocked";

/** Map a raw snapshot commit into the wire-format snapshot entry. */
function toSnapshotEntry(s: { hash: string; message: string; kind?: string; createdAt: number }) {
  const trailers = parseSnapshotTrailers(s.message);
  const kind = (trailers.kind ?? s.kind ?? "manual") as SnapshotEntryKind;
  // The commit subject is "chisacode: <label-or-kind>" (see buildSnapshotCommitMessage).
  // Surface a label only when the user supplied one distinct from the kind.
  const subject =
    s.message
      .split("\n", 1)[0]
      ?.replace(/^chisacode:\s*/, "")
      .trim() ?? "";
  const label = subject.length > 0 && subject !== kind ? subject : null;
  return {
    commitHash: s.hash,
    kind,
    sessionId: trailers.sessionId ?? null,
    agentId: trailers.agentId ?? null,
    label,
    createdAt: new Date(s.createdAt > 0 ? s.createdAt * 1000 : 0).toISOString(),
  };
}
