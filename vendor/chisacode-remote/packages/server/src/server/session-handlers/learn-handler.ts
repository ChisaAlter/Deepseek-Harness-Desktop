/**
 * LearnHandler — automated skill extraction RPC handler.
 *
 * Exposes start/list/inspect/apply/discard/cancel RPCs for the learn pipeline.
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SessionInboundMessage } from "../messages.js";
import type { DisposableHandler } from "./session-context.js";
import { summarizeUntrustedLogIdentifier } from "../log-metadata.js";
import { installUserSkillsFromLocalDirectory } from "../agent/skills-management.js";
import {
  type LearnProposal,
  type LearnRun,
  type LearnRunStatus,
  isBusyStatus,
  LEARN_TERMINAL_STATUSES,
  validateProposals,
  sweepExpiredRuns,
} from "../learn-service.js";

/** In-memory learn run store with global concurrency control. */
export class LearnManager {
  private readonly runs = new Map<string, LearnRun>();

  getRuns(): LearnRun[] {
    return Array.from(this.runs.values());
  }

  getRun(id: string): LearnRun | null {
    return this.runs.get(id) ?? null;
  }

  hasActiveRun(): boolean {
    return Array.from(this.runs.values()).some((r) => isBusyStatus(r.status));
  }

  startRun(diff: string, files: string[], context: string | undefined, now: number): LearnRun {
    if (this.hasActiveRun()) {
      throw new Error("A learn run is already in progress. Wait for it to complete or cancel it.");
    }
    const run: LearnRun = {
      id: randomUUID(),
      status: "collecting",
      evidence: { diff, files, context },
      proposals: [],
      createdAt: now,
      updatedAt: now,
    };
    this.runs.set(run.id, run);
    return run;
  }

  updateRunStatus(id: string, status: LearnRunStatus, now: number, error?: string): LearnRun {
    const run = this.runs.get(id);
    if (!run) throw new Error(`Learn run "${id}" not found.`);
    const updated: LearnRun = { ...run, status, updatedAt: now, error };
    this.runs.set(id, updated);
    return updated;
  }

  applyRun(id: string, now: number): LearnRun {
    const run = this.runs.get(id);
    if (!run) throw new Error(`Learn run "${id}" not found.`);
    if (run.status !== "awaiting-review") {
      throw new Error(`Cannot apply run in status "${run.status}". Must be "awaiting-review".`);
    }
    const updated: LearnRun = { ...run, status: "applied", updatedAt: now };
    this.runs.set(id, updated);
    return updated;
  }

  discardRun(id: string, now: number): LearnRun {
    const run = this.runs.get(id);
    if (!run) throw new Error(`Learn run "${id}" not found.`);
    if (LEARN_TERMINAL_STATUSES.has(run.status)) {
      throw new Error(`Cannot discard run in terminal status "${run.status}".`);
    }
    const updated: LearnRun = { ...run, status: "discarded", updatedAt: now };
    this.runs.set(id, updated);
    return updated;
  }

  cancelRun(id: string, now: number): LearnRun {
    const run = this.runs.get(id);
    if (!run) throw new Error(`Learn run "${id}" not found.`);
    if (LEARN_TERMINAL_STATUSES.has(run.status)) {
      throw new Error(`Cannot cancel run in terminal status "${run.status}".`);
    }
    const updated: LearnRun = { ...run, status: "cancelled", updatedAt: now };
    this.runs.set(id, updated);
    return updated;
  }

  /** Directly replace a run's state (used by distillation to set proposals + status). */
  updateRun(id: string, run: LearnRun): void {
    this.runs.set(id, run);
  }
}

export interface LearnHandlerContext {
  readonly sessionLogger: {
    error(obj: unknown, msg: string): void;
    info(obj: unknown, msg: string): void;
  };
  readonly learnManager: LearnManager;
  emit(message: unknown): void;
  /** Spawn a background agent to distill skills from evidence. Returns extracted proposals as JSON. */
  distill?(options: {
    diff: string;
    files: string[];
    context?: string;
  }): Promise<Array<{ filename: string; content: string; fingerprint: string }>>;
}

/** Handles learn pipeline RPC operations. */
export class LearnHandler implements DisposableHandler {
  private readonly context: LearnHandlerContext;

  constructor(context: LearnHandlerContext) {
    this.context = context;
  }

  dispose(): void {}

  private emitRpcError(request: { requestId: string; type: string }, error: unknown): void {
    const message = error instanceof Error ? error.message : "Learn request failed";
    this.context.sessionLogger.error(
      {
        requestType: request.type,
        requestId: summarizeUntrustedLogIdentifier(request.requestId),
        category: "learn",
        code: "learn_request_failed",
      },
      "Learn request failed",
    );
    this.context.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        error: message,
        code: "learn_request_failed",
      },
    });
  }

  async handleLearnStartRequest(
    request: Extract<SessionInboundMessage, { type: "learn/start" }>,
  ): Promise<void> {
    try {
      const run = this.context.learnManager.startRun(
        request.diff,
        request.files,
        request.context,
        Date.now(),
      );
      this.context.emit({
        type: "learn/start/response",
        payload: { requestId: request.requestId, run: serializeRun(run), error: null },
      });
      // Trigger distillation asynchronously if the callback is available
      if (this.context.distill) {
        void this.runDistillation(run.id, request.diff, request.files, request.context);
      }
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  private async runDistillation(
    runId: string,
    diff: string,
    files: string[],
    context?: string,
  ): Promise<void> {
    try {
      this.context.learnManager.updateRunStatus(runId, "distilling", Date.now());
      this.context.sessionLogger.info({ runId }, "Learn distillation started");

      const proposals = await this.context.distill!({ diff, files, context });

      const run = this.context.learnManager.getRun(runId);
      if (!run || LEARN_TERMINAL_STATUSES.has(run.status)) return;

      // Transition to awaiting-review with proposals
      const updated: LearnRun = {
        ...run,
        status: "awaiting-review",
        proposals,
        updatedAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      };
      this.context.learnManager.updateRun(runId, updated);
      this.context.sessionLogger.info(
        { runId, proposalCount: proposals.length },
        "Learn distillation complete",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Distillation failed";
      this.context.sessionLogger.error({ err: error, runId }, "Learn distillation failed");
      try {
        this.context.learnManager.updateRunStatus(runId, "failed", Date.now(), message);
      } catch {
        // Run may have been cancelled concurrently
      }
    }
  }

  async handleLearnListRequest(
    request: Extract<SessionInboundMessage, { type: "learn/list" }>,
  ): Promise<void> {
    try {
      const runs = this.sweepExpired();
      this.context.emit({
        type: "learn/list/response",
        payload: {
          requestId: request.requestId,
          runs: runs.map((r) => ({
            id: r.id,
            status: r.status,
            proposalCount: r.proposals.length,
            createdAt: new Date(r.createdAt).toISOString(),
            updatedAt: new Date(r.updatedAt).toISOString(),
          })),
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleLearnInspectRequest(
    request: Extract<SessionInboundMessage, { type: "learn/inspect" }>,
  ): Promise<void> {
    try {
      this.sweepExpired();
      const run = this.context.learnManager.getRun(request.runId);
      this.context.emit({
        type: "learn/inspect/response",
        payload: {
          requestId: request.requestId,
          run: run ? serializeRun(run) : null,
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  /** Sweep expired awaiting-review runs to "discarded" and persist the result. */
  private sweepExpired(): LearnRun[] {
    const swept = sweepExpiredRuns(this.context.learnManager.getRuns(), Date.now());
    for (const run of swept) {
      this.context.learnManager.updateRun(run.id, run);
    }
    return swept;
  }

  async handleLearnApplyRequest(
    request: Extract<SessionInboundMessage, { type: "learn/apply" }>,
  ): Promise<void> {
    try {
      const run = this.context.learnManager.getRun(request.runId);
      if (!run) throw new Error(`Learn run "${request.runId}" not found.`);
      if (run.status !== "awaiting-review") {
        throw new Error(`Cannot apply run in status "${run.status}". Must be "awaiting-review".`);
      }

      // Select which proposals to apply (default: all).
      const requested = new Set(request.fingerprints ?? []);
      const proposals =
        requested.size > 0
          ? run.proposals.filter((p) => requested.has(p.fingerprint))
          : run.proposals;
      if (proposals.length === 0) {
        throw new Error("No matching proposals to apply.");
      }

      // Validate before writing anything to disk.
      const validation = validateProposals(proposals);
      if (!validation.valid) {
        throw new Error(`Invalid proposals: ${validation.errors.join("; ")}`);
      }

      const appliedFiles = await this.writeProposalsToSkillRoots(proposals);

      const updated = this.context.learnManager.applyRun(request.runId, Date.now());
      this.context.emit({
        type: "learn/apply/response",
        payload: {
          requestId: request.requestId,
          run: serializeRun(updated),
          appliedFiles,
          error: null,
        },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  /**
   * Materialize learned proposals as real skill files. Each proposal is staged
   * as `<name>/SKILL.md` in a temp dir, then installed into the user skill roots
   * (~/.agents/skills, ~/.codex/skills, ~/.claude/skills) via the shared skill
   * installer so the learned skills show up in the Skills list.
   *
   * NOTE: the installed source isn't registered in daemon config, so these appear
   * as non-removable in the UI; registering it needs daemonConfigStore (follow-up).
   */
  private async writeProposalsToSkillRoots(proposals: LearnProposal[]): Promise<string[]> {
    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), "chisacode-learn-apply-"));
    try {
      const staged = new Set<string>();
      for (const proposal of proposals) {
        const skillName = deriveSkillName(proposal.filename);
        const skillDir = path.join(stagingDir, skillName);
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, "SKILL.md"), proposal.content, "utf8");
        staged.add(skillName);
      }
      const result = await installUserSkillsFromLocalDirectory(stagingDir, { replace: true });
      return result.skillNames.length > 0 ? result.skillNames : [...staged];
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async handleLearnDiscardRequest(
    request: Extract<SessionInboundMessage, { type: "learn/discard" }>,
  ): Promise<void> {
    try {
      const run = this.context.learnManager.discardRun(request.runId, Date.now());
      this.context.emit({
        type: "learn/discard/response",
        payload: { requestId: request.requestId, run: serializeRun(run), error: null },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }

  async handleLearnCancelRequest(
    request: Extract<SessionInboundMessage, { type: "learn/cancel" }>,
  ): Promise<void> {
    try {
      const run = this.context.learnManager.cancelRun(request.runId, Date.now());
      this.context.emit({
        type: "learn/cancel/response",
        payload: { requestId: request.requestId, run: serializeRun(run), error: null },
      });
    } catch (error) {
      this.emitRpcError(request, error);
    }
  }
}

function serializeRun(run: LearnRun) {
  return {
    id: run.id,
    status: run.status,
    evidence: run.evidence
      ? { diff: run.evidence.diff, files: run.evidence.files, context: run.evidence.context }
      : null,
    proposals: run.proposals,
    error: run.error ?? null,
    createdAt: new Date(run.createdAt).toISOString(),
    updatedAt: new Date(run.updatedAt).toISOString(),
    expiresAt: run.expiresAt ? new Date(run.expiresAt).toISOString() : null,
  };
}

/**
 * Derive a valid skill directory name from a proposed filename.
 *
 * Rejects path-traversal inputs (`..`, `/`, `\`) BEFORE the staging write so an
 * LLM-hallucinated filename like `"..md"` cannot escape the temp staging dir
 * via `path.join(stagingDir, "..")`. Mirrors the `validSkillName` rules used by
 * the skill installer, but applied at the staging boundary (the installer's
 * own check runs only AFTER the file has already been written).
 */
export function deriveSkillName(filename: string): string {
  const base = filename.replace(/\\/g, "/").split("/").pop() ?? filename;
  const stripped = base.replace(/\.md$/i, "").trim();
  const name = stripped.length > 0 ? stripped : "learned-skill";
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\")
  ) {
    throw new Error(`Invalid skill directory name derived from filename: "${filename}"`);
  }
  return name;
}
