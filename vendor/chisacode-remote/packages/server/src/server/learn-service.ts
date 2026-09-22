/**
 * Learn Service — automated skill extraction from code changes.
 *
 * A five-stage pipeline that distills reusable skills/rules from code
 * review evidence:
 *   collecting → distilling → staging → awaiting-review → applied/discarded
 *
 * Global concurrency: 1 (only one collecting/distilling run at a time).
 * Awaiting-review runs don't occupy the concurrency slot.
 *
 * Design adapted from Cindy's learn-host/ (Apache-2.0).
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type LearnRunStatus =
  | "collecting"
  | "distilling"
  | "staging"
  | "awaiting-review"
  | "applied"
  | "discarded"
  | "failed"
  | "cancelled";

export const LEARN_TERMINAL_STATUSES: ReadonlySet<LearnRunStatus> = new Set([
  "applied",
  "discarded",
  "failed",
  "cancelled",
]);

/** Whether a status occupies the global concurrency slot. */
export function isBusyStatus(status: LearnRunStatus): boolean {
  return status === "collecting" || status === "distilling" || status === "staging";
}

export interface LearnEvidence {
  /** Git diff or code change content. */
  diff: string;
  /** File paths involved. */
  files: string[];
  /** Optional context (commit message, PR description). */
  context?: string;
}

export interface LearnProposal {
  /** Proposed skill/rule filename. */
  filename: string;
  /** Proposed content (markdown with frontmatter). */
  content: string;
  /** Fingerprint for deduplication. */
  fingerprint: string;
}

export interface LearnRun {
  id: string;
  status: LearnRunStatus;
  /** Evidence collected in the collecting stage. */
  evidence?: LearnEvidence;
  /** Proposals produced by the distilling stage. */
  proposals: LearnProposal[];
  /** Error message when status=failed. */
  error?: string;
  createdAt: number;
  updatedAt: number;
  /** Age threshold for auto-expiring awaiting-review runs. */
  expiresAt?: number;
}

// ── Configuration ──────────────────────────────────────────────────────────

export interface LearnConfig {
  /** Maximum age (ms) for awaiting-review runs before auto-expiry. Default: 7 days. */
  awaitingReviewMaxAgeMs: number;
  /** Maximum total bytes across all proposals. Default: 256KB. */
  maxProposalTotalBytes: number;
  /** File patterns excluded from proposals. */
  excludedPaths: string[];
}

export const DEFAULT_LEARN_CONFIG: LearnConfig = {
  awaitingReviewMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  maxProposalTotalBytes: 256 * 1024,
  excludedPaths: ["node_modules/", ".git/", "dist/", "package-lock.json"],
};

// ── State machine ──────────────────────────────────────────────────────────

/** Valid status transitions. */
const TRANSITIONS: Record<LearnRunStatus, LearnRunStatus[]> = {
  collecting: ["distilling", "failed", "cancelled"],
  distilling: ["staging", "failed", "cancelled"],
  staging: ["awaiting-review", "failed"],
  "awaiting-review": ["applied", "discarded", "failed"],
  applied: [],
  discarded: [],
  failed: [],
  cancelled: [],
};

/**
 * Check whether a status transition is valid.
 */
export function canTransition(from: LearnRunStatus, to: LearnRunStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Create a new learn run in the collecting state.
 */
export function createLearnRun(id: string, now: number): LearnRun {
  return {
    id,
    status: "collecting",
    proposals: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Transition a learn run to a new status with validation.
 * Returns the updated run, or throws if the transition is invalid.
 */
export function transitionRun(
  run: LearnRun,
  to: LearnRunStatus,
  now: number,
  patch?: Partial<Pick<LearnRun, "evidence" | "proposals" | "error" | "expiresAt">>,
): LearnRun {
  if (!canTransition(run.status, to)) {
    throw new Error(`Invalid learn run transition: ${run.status} → ${to}`);
  }

  return {
    ...run,
    ...patch,
    status: to,
    updatedAt: now,
  };
}

// ── Proposal validation ────────────────────────────────────────────────────

/**
 * Validate a set of proposals against size and path exclusion rules.
 */
export function validateProposals(
  proposals: LearnProposal[],
  config: LearnConfig = DEFAULT_LEARN_CONFIG,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const totalBytes = proposals.reduce((sum, p) => sum + Buffer.byteLength(p.content, "utf8"), 0);
  if (totalBytes > config.maxProposalTotalBytes) {
    errors.push(`Total proposal size ${totalBytes} exceeds limit ${config.maxProposalTotalBytes}`);
  }

  for (const p of proposals) {
    for (const excluded of config.excludedPaths) {
      if (p.filename.includes(excluded)) {
        errors.push(`Proposal "${p.filename}" matches excluded path "${excluded}"`);
      }
    }
    if (!p.filename || p.filename.trim().length === 0) {
      errors.push("Proposal has empty filename");
    }
    if (!p.content || p.content.trim().length === 0) {
      errors.push(`Proposal "${p.filename}" has empty content`);
    }
  }

  // Check for duplicate fingerprints
  const fingerprints = new Set<string>();
  for (const p of proposals) {
    if (fingerprints.has(p.fingerprint)) {
      errors.push(`Duplicate proposal fingerprint: ${p.fingerprint}`);
    }
    fingerprints.add(p.fingerprint);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check whether an awaiting-review run has expired.
 */
export function isExpired(run: LearnRun, now: number): boolean {
  if (run.status !== "awaiting-review") return false;
  if (!run.expiresAt) return false;
  return now > run.expiresAt;
}

/**
 * Sweep expired awaiting-review runs, marking them as discarded.
 */
export function sweepExpiredRuns(runs: LearnRun[], now: number): LearnRun[] {
  return runs.map((run) => {
    if (isExpired(run, now)) {
      return transitionRun(run, "discarded", now, {
        error: "Expired: not reviewed within the time limit",
      });
    }
    return run;
  });
}
