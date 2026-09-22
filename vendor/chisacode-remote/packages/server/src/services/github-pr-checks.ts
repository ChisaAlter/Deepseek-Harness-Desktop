import { z } from "zod/v3";

const PullRequestCheckRunNodeSchema = z.object({
  __typename: z.literal("CheckRun"),
  name: z.string(),
  workflowName: z.string().nullable().optional(),
  conclusion: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  detailsUrl: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  checkSuite: z
    .object({
      workflowRun: z
        .object({
          databaseId: z.number().nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

const PullRequestStatusContextNodeSchema = z.object({
  __typename: z.literal("StatusContext"),
  context: z.string(),
  state: z.string().nullable().optional(),
  targetUrl: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
});

const PullRequestStatusCheckRollupNodeSchema = z.discriminatedUnion("__typename", [
  PullRequestCheckRunNodeSchema,
  PullRequestStatusContextNodeSchema,
]);
const PullRequestStatusCheckRollupArraySchema = z.array(z.unknown());
const LegacyPullRequestStatusCheckRollupSchema = z.object({
  contexts: z.array(z.unknown()),
});

type PullRequestCheckRunNode = z.infer<typeof PullRequestCheckRunNodeSchema>;
type PullRequestStatusContextNode = z.infer<typeof PullRequestStatusContextNodeSchema>;
type PullRequestStatusCheckRollupNode = z.infer<typeof PullRequestStatusCheckRollupNodeSchema>;

/** Normalized state for an individual pull request check. */
export type PullRequestCheckStatus = "pending" | "success" | "failure" | "cancelled" | "skipped";

/** Normalized pull request check displayed by clients. */
export interface PullRequestCheck {
  name: string;
  status: PullRequestCheckStatus;
  url: string | null;
  workflow?: string;
  duration?: string;
}

/** Aggregate state across all normalized pull request checks. */
export type PullRequestChecksStatus = "none" | "pending" | "success" | "failure";

interface ParsedPullRequestCheck {
  check: PullRequestCheck;
  identity: string;
  recency: number;
}

function getCheckRunIdentity(context: PullRequestCheckRunNode): string {
  const workflowName = context.workflowName?.trim();
  return workflowName ? `${workflowName}\0${context.name}` : context.name;
}

function buildPullRequestCheck(context: PullRequestStatusCheckRollupNode): ParsedPullRequestCheck {
  if (context.__typename === "CheckRun") {
    const workflowName = context.workflowName?.trim();
    return {
      identity: getCheckRunIdentity(context),
      check: {
        name: context.name,
        status: mapCheckRunStatus(context.status, context.conclusion),
        url: typeof context.detailsUrl === "string" ? context.detailsUrl : null,
        ...(workflowName ? { workflow: context.workflowName ?? workflowName } : {}),
        ...formatCheckRunDuration(context),
      },
      recency: getCheckRunRecency(context),
    };
  }

  return {
    identity: context.context,
    check: {
      name: context.context,
      status: mapStatusContextState(context.state),
      url: typeof context.targetUrl === "string" ? context.targetUrl : null,
    },
    recency: getStatusContextRecency(context),
  };
}

/**
 * Normalizes GitHub check rollups and keeps the newest rerun per workflow and check name.
 * @param value GitHub statusCheckRollup payload in current or legacy shape
 * @returns Normalized checks, preserving same-named jobs from different workflows
 */
export function parseStatusCheckRollup(value: unknown): PullRequestCheck[] {
  const directContexts = PullRequestStatusCheckRollupArraySchema.safeParse(value);
  if (!directContexts.success) {
    const legacyContexts = LegacyPullRequestStatusCheckRollupSchema.safeParse(value);
    if (!legacyContexts.success) {
      return [];
    }
    return parseStatusCheckRollup(legacyContexts.data.contexts);
  }

  const dedupedChecks = new Map<string, ParsedPullRequestCheck>();
  for (const entry of directContexts.data) {
    const parsed = PullRequestStatusCheckRollupNodeSchema.safeParse(entry);
    if (!parsed.success) {
      continue;
    }
    const candidate = buildPullRequestCheck(parsed.data);
    const existing = dedupedChecks.get(candidate.identity);
    if (!existing || candidate.recency > existing.recency) {
      dedupedChecks.set(candidate.identity, candidate);
    }
  }

  return Array.from(dedupedChecks.values(), (entry) => entry.check);
}

/**
 * Computes the aggregate pull request check state used by the PR panel.
 * @param checks Normalized checks
 * @returns Aggregate status with failures taking precedence over pending checks
 */
export function computePullRequestChecksStatus(
  checks: PullRequestCheck[],
): PullRequestChecksStatus {
  if (checks.length === 0) {
    return "none";
  }
  if (checks.some((check) => check.status === "failure")) {
    return "failure";
  }
  if (checks.some((check) => check.status === "pending")) {
    return "pending";
  }
  return "success";
}

function mapCheckRunStatus(status: unknown, conclusion: unknown): PullRequestCheckStatus {
  if (status !== "COMPLETED") {
    return "pending";
  }
  switch (conclusion) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
      return "failure";
    case "CANCELLED":
      return "cancelled";
    case "SKIPPED":
    case "NEUTRAL":
      return "skipped";
    default:
      return "pending";
  }
}

function mapStatusContextState(state: unknown): PullRequestCheckStatus {
  switch (state) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "EXPECTED":
    case "PENDING":
    default:
      return "pending";
  }
}

function getCheckRunRecency(context: PullRequestCheckRunNode): number {
  const workflowRunId = context.checkSuite?.workflowRun?.databaseId;
  if (typeof workflowRunId === "number") {
    return workflowRunId;
  }
  return parseOptionalTime(context.completedAt ?? context.startedAt ?? null);
}

function formatCheckRunDuration(context: PullRequestCheckRunNode): { duration?: string } {
  const startedAt = parseOptionalTime(context.startedAt ?? null);
  const completedAt = parseOptionalTime(context.completedAt ?? null);
  if (startedAt <= 0 || completedAt <= 0 || completedAt < startedAt) {
    return {};
  }
  const durationSeconds = Math.floor((completedAt - startedAt) / 1_000);
  return { duration: formatDurationSeconds(durationSeconds) };
}

function formatDurationSeconds(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }
  return parts.join(" ");
}

function getStatusContextRecency(context: PullRequestStatusContextNode): number {
  return parseOptionalTime(context.createdAt ?? null);
}

function parseOptionalTime(timestamp: string | null): number {
  if (!timestamp) {
    return 0;
  }
  const time = Date.parse(timestamp);
  return Number.isNaN(time) ? 0 : time;
}
