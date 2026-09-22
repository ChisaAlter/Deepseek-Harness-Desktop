import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { Agent } from "@/stores/session-store";
import {
  isAgentToolCallItem,
  type StreamItem,
  type TodoEntry,
  type TodoListItem,
} from "@/types/stream";

export type WorkspacePullRequestRuntime = NonNullable<
  NonNullable<WorkspaceDescriptor["githubRuntime"]>["pullRequest"]
>;

export interface TodoProgressSummary {
  completedCount: number;
  totalCount: number;
  progress: number;
  visibleItems: TodoEntry[];
  hiddenCount: number;
}

/** Normalized cross-provider task/plan progress status. */
export type AgentProgressStatus = "pending" | "in_progress" | "completed";

/** One step in the provider-neutral task progress model. */
export interface AgentProgressItem {
  id: string;
  text: string;
  status: AgentProgressStatus;
  completed: boolean;
}

/** Source of the resolved progress snapshot for the floating task card. */
export type AgentProgressSource = "todo_list" | "plan";

/**
 * Provider-neutral progress model for the environment stack task card.
 * Built from stream `todo_list` items (Claude/OpenCode/ACP/update_plan) or
 * plan tool calls (Codex plan markdown).
 */
export interface AgentProgressModel {
  source: AgentProgressSource;
  items: AgentProgressItem[];
  completedCount: number;
  totalCount: number;
  progress: number;
  visibleItems: AgentProgressItem[];
  hiddenCount: number;
}

const DEFAULT_PROGRESS_VISIBLE_ITEMS = 8;
const PLAN_CHECKBOX_RE = /^[-*+]\s+\[([ xX])\]\s+(.+)$/;
const PLAN_BULLET_RE = /^[-*+]\s+(.+)$/;
const PLAN_NUMBERED_RE = /^\d+[.)]\s+(.+)$/;

export type WorkspaceStatusStripTone = "neutral" | "success" | "warning" | "danger";

export type WorkspaceModelLabelParams = Record<string, number | string>;

export interface WorkspaceStatusStripItem {
  key: string;
  label: string;
  labelKey?: string;
  labelParams?: WorkspaceModelLabelParams;
  tone: WorkspaceStatusStripTone;
}

export interface WorkspaceStatusStripModel {
  taskTitle: string;
  items: WorkspaceStatusStripItem[];
  hasActionableState: boolean;
}

export interface WorkspaceReviewCalloutModel {
  title: string;
  titleKey: string;
  description: string;
  descriptionParts: WorkspaceReviewCalloutDescriptionPart[];
  showViewChanges: boolean;
  showOpenPullRequest: boolean;
  showCopyResume: boolean;
}

export interface WorkspaceReviewCalloutDescriptionPart {
  key: string;
  label: string;
  labelKey?: string;
  labelParams?: WorkspaceModelLabelParams;
}

export interface WorkspaceActivityItem {
  key: string;
  label: string;
  labelKey?: string;
  labelParams?: WorkspaceModelLabelParams;
  tone: WorkspaceStatusStripTone;
}

export interface WorkspacePullRequestPillModel {
  key: string;
  label: string;
  labelKey: string;
  tone: WorkspaceStatusStripTone;
}

export function buildPullRequestLabel(pullRequest: WorkspacePullRequestRuntime): string {
  const title = normalizeLabel(pullRequest.title) ?? "Pull request";
  if (
    typeof pullRequest.number === "number" &&
    Number.isInteger(pullRequest.number) &&
    pullRequest.number > 0
  ) {
    return `#${pullRequest.number} ${title}`;
  }
  return title;
}

export function buildWorkspaceTaskTitle(input: {
  activeAgent?: Pick<Agent, "title"> | null;
  workspace?: Pick<
    WorkspaceDescriptor,
    "name" | "projectDisplayName" | "workspaceDirectory"
  > | null;
  currentBranchName?: string | null;
}): string {
  const agentTitle = normalizeLabel(input.activeAgent?.title);
  if (agentTitle) {
    return agentTitle;
  }
  const workspaceName = normalizeLabel(input.workspace?.name);
  if (workspaceName) {
    return workspaceName;
  }
  const branchName = normalizeLabel(input.currentBranchName);
  if (branchName) {
    return branchName;
  }
  const projectName = normalizeLabel(input.workspace?.projectDisplayName);
  if (projectName) {
    return projectName;
  }
  return getPathBasename(input.workspace?.workspaceDirectory) ?? "Workspace";
}

export function buildWorkspaceStatusStripAccessibilityLabel(input: {
  actionLabel: string;
  taskTitle: string;
  itemLabels: readonly string[];
}): string {
  const actionLabel = normalizeLabel(input.actionLabel) ?? "Open workspace status";
  const taskTitle = normalizeLabel(input.taskTitle);
  const itemLabels = input.itemLabels
    .map((label) => normalizeLabel(label))
    .filter((label): label is string => Boolean(label));
  const detailParts = [taskTitle, ...itemLabels].filter((part): part is string => Boolean(part));
  if (detailParts.length === 0) {
    return actionLabel;
  }
  return `${actionLabel}: ${detailParts.join(", ")}`;
}

export function buildWorkspaceStatusStripModel(input: {
  activeAgent?: Pick<Agent, "status" | "pendingPermissions" | "title"> | null;
  workspace?: WorkspaceDescriptor | null;
  currentBranchName?: string | null;
  todoItems?: readonly TodoEntry[] | null;
}): WorkspaceStatusStripModel {
  const items: WorkspaceStatusStripItem[] = [];
  const agent = input.activeAgent ?? null;
  if (agent) {
    items.push({
      key: "agent",
      label: formatAgentStatus(agent.status),
      labelKey: `workspace.environment.agentStatus.${agent.status}`,
      tone: resolveAgentTone(agent.status),
    });
    const pendingCount = agent.pendingPermissions?.length ?? 0;
    if (pendingCount > 0) {
      items.push({
        key: "permissions",
        label: `${pendingCount} permission${pendingCount === 1 ? "" : "s"}`,
        labelKey: "workspace.statusStrip.pendingPermissions",
        labelParams: { count: pendingCount },
        tone: "warning",
      });
    }
  }

  const diffStat = input.workspace?.diffStat ?? null;
  const normalizedDiffStat = normalizeDiffStat(diffStat);
  if (normalizedDiffStat) {
    items.push({
      key: "changes",
      label: `+${normalizedDiffStat.additions} -${normalizedDiffStat.deletions}`,
      tone: "warning",
    });
  }

  const pullRequest = input.workspace?.githubRuntime?.pullRequest ?? null;
  if (pullRequest) {
    const status = buildPullRequestStatusDescriptor(pullRequest);
    items.push({
      key: "pr",
      label: status.label,
      labelKey: status.labelKey,
      tone: resolvePullRequestTone(pullRequest),
    });
  }

  const todoSummary = buildTodoProgressSummary(input.todoItems, 0);
  if (todoSummary) {
    items.push({
      key: "todos",
      label: `${todoSummary.completedCount}/${todoSummary.totalCount} tasks`,
      labelKey: "workspace.statusStrip.todoProgress",
      labelParams: {
        completed: todoSummary.completedCount,
        total: todoSummary.totalCount,
      },
      tone: todoSummary.completedCount === todoSummary.totalCount ? "success" : "neutral",
    });
  }

  if (items.length === 0) {
    const fallbackItem = buildWorkspaceStatusStripFallbackItem({
      workspace: input.workspace,
      currentBranchName: input.currentBranchName,
    });
    if (fallbackItem) {
      items.push(fallbackItem);
    }
  }

  return {
    taskTitle: buildWorkspaceTaskTitle({
      activeAgent: agent,
      workspace: input.workspace,
      currentBranchName: input.currentBranchName,
    }),
    items,
    hasActionableState: items.some((item) => item.tone === "warning" || item.tone === "danger"),
  };
}

function buildWorkspaceStatusStripFallbackItem(input: {
  workspace?: WorkspaceDescriptor | null;
  currentBranchName?: string | null;
}): WorkspaceStatusStripItem | null {
  const branchName = normalizeLabel(input.currentBranchName);
  if (branchName) {
    return {
      key: "branch",
      label: branchName,
      tone: "neutral",
    };
  }
  if (input.workspace) {
    return {
      key: "workspace",
      label: "Workspace ready",
      labelKey: "workspace.statusStrip.workspaceReady",
      tone: "neutral",
    };
  }
  return null;
}

export function buildWorkspaceReviewCalloutModel(input: {
  activeAgent?: Pick<Agent, "status" | "runtimeInfo" | "persistence"> | null;
  workspace?: WorkspaceDescriptor | null;
}): WorkspaceReviewCalloutModel | null {
  const agentStatus = input.activeAgent?.status ?? null;
  if (!isReviewableAgentStatus(agentStatus)) {
    return null;
  }

  const diffStat = input.workspace?.diffStat ?? null;
  const normalizedDiffStat = normalizeDiffStat(diffStat);
  const hasChanges = normalizedDiffStat !== null;
  const pullRequest = input.workspace?.githubRuntime?.pullRequest ?? null;
  if (!hasChanges && !pullRequest) {
    return null;
  }

  return {
    title: agentStatus === "error" ? "Review interrupted work" : "Review completed work",
    titleKey:
      agentStatus === "error"
        ? "workspace.reviewCallout.interruptedTitle"
        : "workspace.reviewCallout.completedTitle",
    description: buildReviewCalloutDescription({ diffStat: normalizedDiffStat, pullRequest }),
    descriptionParts: buildReviewCalloutDescriptionParts({
      diffStat: normalizedDiffStat,
      pullRequest,
    }),
    showViewChanges: hasChanges,
    showOpenPullRequest: Boolean(pullRequest?.url),
    showCopyResume: agentStatus === "error" && hasResumeSession(input.activeAgent),
  };
}

export function shouldEnableWorkspaceReviewArchiveAction(input: {
  workspace?: WorkspaceDescriptor | null;
  workspaceDirectory?: string | null;
}): boolean {
  const workspace = input.workspace ?? null;
  if (!normalizeLabel(input.workspaceDirectory)) {
    return false;
  }
  if (workspace?.projectKind !== "git" || workspace.workspaceKind !== "worktree") {
    return false;
  }
  return (
    normalizeDiffStat(workspace.diffStat) !== null || Boolean(workspace.githubRuntime?.pullRequest)
  );
}

export function buildWorkspaceActivityItems(input: {
  activeAgent?: Pick<Agent, "status" | "pendingPermissions"> | null;
  workspace?: WorkspaceDescriptor | null;
  currentBranchName?: string | null;
  maxItems?: number;
}): WorkspaceActivityItem[] {
  const items: WorkspaceActivityItem[] = [];
  const agent = input.activeAgent ?? null;
  if (agent) {
    items.push({
      key: "agent",
      label: `Agent ${formatAgentStatus(agent.status).toLowerCase()}`,
      labelKey: `workspace.activity.agent.${agent.status}`,
      tone: resolveAgentTone(agent.status),
    });
    const pendingCount = agent.pendingPermissions?.length ?? 0;
    if (pendingCount > 0) {
      items.push({
        key: "permissions",
        label: `${pendingCount} permission request${pendingCount === 1 ? "" : "s"} pending`,
        labelKey: "workspace.activity.pendingPermissions",
        labelParams: { count: pendingCount },
        tone: "warning",
      });
    }
  }

  const diffStat = input.workspace?.diffStat ?? null;
  const normalizedDiffStat = normalizeDiffStat(diffStat);
  if (normalizedDiffStat) {
    items.push({
      key: "changes",
      label: `Workspace has +${normalizedDiffStat.additions} -${normalizedDiffStat.deletions} changes`,
      labelKey: "workspace.activity.changes",
      labelParams: {
        additions: normalizedDiffStat.additions,
        deletions: normalizedDiffStat.deletions,
      },
      tone: "warning",
    });
  }

  const pullRequest = input.workspace?.githubRuntime?.pullRequest ?? null;
  if (pullRequest) {
    const status = buildPullRequestStatusDescriptor(pullRequest);
    items.push({
      key: "pr",
      label: `Pull request ${status.label.toLowerCase()}`,
      labelKey: status.activityLabelKey,
      tone: resolvePullRequestTone(pullRequest),
    });
  }

  const branchName = normalizeLabel(input.currentBranchName);
  if (branchName) {
    items.push({
      key: "branch",
      label: `Branch ${branchName}`,
      labelKey: "workspace.activity.branch",
      labelParams: { branch: branchName },
      tone: "neutral",
    });
  }

  if (items.length === 0 && input.workspace) {
    items.push({
      key: "workspace",
      label: "Workspace ready",
      labelKey: "workspace.activity.workspaceReady",
      tone: "neutral",
    });
  }

  return items.slice(0, normalizeMaxActivityItems(input.maxItems));
}

export function buildWorkspacePullRequestPills(
  pullRequest: WorkspacePullRequestRuntime,
): WorkspacePullRequestPillModel[] {
  if (pullRequest.isMerged) {
    return [
      {
        key: "pr-merged",
        label: "PR merged",
        labelKey: "workspace.pullRequestStatus.merged",
        tone: "success",
      },
    ];
  }
  if (pullRequest.state === "closed") {
    return [
      {
        key: "pr-closed",
        label: "PR closed",
        labelKey: "workspace.pullRequestStatus.closed",
        tone: "neutral",
      },
    ];
  }

  const items: WorkspacePullRequestPillModel[] = [];
  const checksStatus = pullRequest.checksStatus ?? "none";
  if (checksStatus !== "none") {
    items.push({
      key: "checks",
      label: buildChecksStatusLabel(checksStatus),
      labelKey: `workspace.environment.checksStatus.${checksStatus}`,
      tone: resolveChecksTone(checksStatus),
    });
  }

  const reviewDecision = pullRequest.reviewDecision ?? null;
  if (reviewDecision) {
    items.push({
      key: "review",
      label: buildReviewDecisionLabel(reviewDecision),
      labelKey: `workspace.environment.reviewDecision.${reviewDecision}`,
      tone: resolveReviewTone(reviewDecision),
    });
  }
  return items;
}

export function findLatestTodoItems(input: {
  head?: readonly StreamItem[] | null;
  tail?: readonly StreamItem[] | null;
}): TodoEntry[] | null {
  const latestHead = findLatestTodoList(input.head);
  const latestTail = findLatestTodoList(input.tail);

  if (!latestHead) {
    return latestTail?.items ?? null;
  }
  if (!latestTail) {
    return latestHead.items;
  }
  return getTodoListTime(latestHead) >= getTodoListTime(latestTail)
    ? latestHead.items
    : latestTail.items;
}

/**
 * Parses provider-emitted plan markdown into discrete progress steps.
 * @param text Plan tool-call markdown body
 * @returns Parsed steps, or an empty array when no steps are found
 */
export function parsePlanMarkdownToProgressItems(text: string): AgentProgressItem[] {
  const lines = text.split(/\r?\n/);
  const items: AgentProgressItem[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const checkboxMatch = line.match(PLAN_CHECKBOX_RE);
    if (checkboxMatch) {
      const completed = checkboxMatch[1] !== " ";
      const stepText = checkboxMatch[2]?.trim() ?? "";
      if (!stepText) {
        continue;
      }
      items.push(createProgressItem(items.length, stepText, completed ? "completed" : "pending"));
      continue;
    }
    const bulletMatch = line.match(PLAN_BULLET_RE);
    if (bulletMatch) {
      const stepText = bulletMatch[1]?.trim() ?? "";
      if (!stepText || PLAN_CHECKBOX_RE.test(line)) {
        continue;
      }
      // Skip pure checkbox leftovers already handled; ignore heading-like bullets.
      if (stepText.startsWith("[")) {
        continue;
      }
      items.push(createProgressItem(items.length, stepText, "pending"));
      continue;
    }
    const numberedMatch = line.match(PLAN_NUMBERED_RE);
    if (numberedMatch) {
      const stepText = numberedMatch[1]?.trim() ?? "";
      if (!stepText) {
        continue;
      }
      items.push(createProgressItem(items.length, stepText, "pending"));
    }
  }
  return items;
}

/**
 * Resolves the latest cross-provider progress snapshot for the focused agent.
 * Prefers the newest of todo_list (Claude/OpenCode/ACP) and plan tool calls (Codex).
 * @param input Stream head/tail slices for the focused agent
 * @param maxVisibleItems Max items shown in the floating task card
 * @returns Progress model, or null when the agent has no plan/todos
 */
export function resolveAgentProgress(
  input: {
    head?: readonly StreamItem[] | null;
    tail?: readonly StreamItem[] | null;
  },
  maxVisibleItems = DEFAULT_PROGRESS_VISIBLE_ITEMS,
): AgentProgressModel | null {
  const todoCandidate = pickLatestTimedCandidate([
    toTodoProgressCandidate(findLatestTodoList(input.head)),
    toTodoProgressCandidate(findLatestTodoList(input.tail)),
  ]);
  const planCandidate = pickLatestTimedCandidate([
    findLatestPlanProgressCandidate(input.head),
    findLatestPlanProgressCandidate(input.tail),
  ]);

  const selected = pickLatestTimedCandidate([todoCandidate, planCandidate]);
  if (!selected || selected.items.length === 0) {
    return null;
  }
  return buildAgentProgressModel(selected.source, selected.items, maxVisibleItems);
}

export function buildTodoProgressSummary(
  items: readonly TodoEntry[] | null | undefined,
  maxVisibleItems = 6,
): TodoProgressSummary | null {
  if (!items || items.length === 0) {
    return null;
  }

  let completedCount = 0;
  for (const item of items) {
    if (item.completed) {
      completedCount += 1;
    }
  }

  const visibleCount = Math.max(0, maxVisibleItems);
  const visibleItems = items.slice(0, visibleCount);
  return {
    completedCount,
    totalCount: items.length,
    progress: completedCount / items.length,
    visibleItems,
    hiddenCount: Math.max(0, items.length - visibleItems.length),
  };
}

function createProgressItem(
  index: number,
  text: string,
  status: AgentProgressStatus,
): AgentProgressItem {
  return {
    id: `progress-${index}`,
    text,
    status,
    completed: status === "completed",
  };
}

function buildAgentProgressModel(
  source: AgentProgressSource,
  items: readonly AgentProgressItem[],
  maxVisibleItems: number,
): AgentProgressModel {
  let completedCount = 0;
  for (const item of items) {
    if (item.completed) {
      completedCount += 1;
    }
  }
  const visibleCount = Math.max(0, maxVisibleItems);
  const visibleItems = items.slice(0, visibleCount);
  return {
    source,
    items: [...items],
    completedCount,
    totalCount: items.length,
    progress: items.length === 0 ? 0 : completedCount / items.length,
    visibleItems,
    hiddenCount: Math.max(0, items.length - visibleItems.length),
  };
}

function todoEntriesToProgressItems(items: readonly TodoEntry[]): AgentProgressItem[] {
  return items.map((item, index) =>
    createProgressItem(index, item.text, item.completed ? "completed" : "pending"),
  );
}

interface TimedProgressCandidate {
  source: AgentProgressSource;
  time: number;
  items: AgentProgressItem[];
}

function toTodoProgressCandidate(list: TodoListItem | null): TimedProgressCandidate | null {
  if (!list || list.items.length === 0) {
    return null;
  }
  return {
    source: "todo_list",
    time: getStreamItemTime(list),
    items: todoEntriesToProgressItems(list.items),
  };
}

function findLatestPlanProgressCandidate(
  items: readonly StreamItem[] | null | undefined,
): TimedProgressCandidate | null {
  if (!items) {
    return null;
  }
  let latest: TimedProgressCandidate | null = null;
  for (const item of items) {
    if (!isAgentToolCallItem(item)) {
      continue;
    }
    const detail = item.payload.data.detail;
    if (detail.type !== "plan") {
      continue;
    }
    const progressItems = parsePlanMarkdownToProgressItems(detail.text);
    if (progressItems.length === 0) {
      continue;
    }
    const time = getStreamItemTime(item);
    if (!latest || time >= latest.time) {
      latest = {
        source: "plan",
        time,
        items: progressItems,
      };
    }
  }
  return latest;
}

function pickLatestTimedCandidate(
  candidates: readonly (TimedProgressCandidate | null | undefined)[],
): TimedProgressCandidate | null {
  let latest: TimedProgressCandidate | null = null;
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (!latest || candidate.time >= latest.time) {
      latest = candidate;
    }
  }
  return latest;
}

function findLatestTodoList(items: readonly StreamItem[] | null | undefined) {
  let latest: TodoListItem | null = null;
  if (!items) {
    return latest;
  }

  for (const item of items) {
    if (item.kind !== "todo_list") {
      continue;
    }
    if (!latest || getStreamItemTime(item) >= getStreamItemTime(latest)) {
      latest = item;
    }
  }
  return latest;
}

function getTodoListTime(item: TodoListItem): number {
  return getStreamItemTime(item);
}

function getStreamItemTime(item: { timestamp: Date }): number {
  const time = item.timestamp.getTime();
  return Number.isFinite(time) ? time : 0;
}

function normalizeLabel(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getPathBasename(value: string | null | undefined): string | null {
  const normalized = normalizeLabel(value);
  if (!normalized) {
    return null;
  }
  return normalized.split(/[\\/]/).findLast(Boolean) ?? null;
}

function isReviewableAgentStatus(status: Agent["status"] | null): boolean {
  return status === "idle" || status === "closed" || status === "error";
}

function normalizeDiffStat(
  diffStat: WorkspaceDescriptor["diffStat"] | null | undefined,
): { additions: number; deletions: number } | null {
  if (!diffStat) {
    return null;
  }
  const additions = normalizeDiffLineCount(diffStat.additions);
  const deletions = normalizeDiffLineCount(diffStat.deletions);
  if (additions === 0 && deletions === 0) {
    return null;
  }
  return { additions, deletions };
}

function normalizeDiffLineCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function normalizeMaxActivityItems(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 5;
  }
  if (value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function hasResumeSession(
  activeAgent: Pick<Agent, "runtimeInfo" | "persistence"> | null | undefined,
): boolean {
  return Boolean(activeAgent?.runtimeInfo?.sessionId ?? activeAgent?.persistence?.sessionId);
}

function buildReviewCalloutDescription(input: {
  diffStat: WorkspaceDescriptor["diffStat"] | null | undefined;
  pullRequest: WorkspacePullRequestRuntime | null | undefined;
}): string {
  return buildReviewCalloutDescriptionParts(input)
    .map((part) => part.label)
    .join(" · ");
}

function buildReviewCalloutDescriptionParts(input: {
  diffStat: WorkspaceDescriptor["diffStat"] | null | undefined;
  pullRequest: WorkspacePullRequestRuntime | null | undefined;
}): WorkspaceReviewCalloutDescriptionPart[] {
  const descriptionParts: WorkspaceReviewCalloutDescriptionPart[] = [];
  const normalizedDiffStat = normalizeDiffStat(input.diffStat);
  if (normalizedDiffStat) {
    descriptionParts.push({
      key: "changes",
      label: `+${normalizedDiffStat.additions} -${normalizedDiffStat.deletions} changes`,
      labelKey: "workspace.reviewCallout.changeSummary",
      labelParams: {
        additions: normalizedDiffStat.additions,
        deletions: normalizedDiffStat.deletions,
      },
    });
  }
  if (input.pullRequest) {
    const status = buildPullRequestStatusDescriptor(input.pullRequest);
    descriptionParts.push({
      key: "pr",
      label: status.label,
      labelKey: status.labelKey,
    });
  }
  return descriptionParts;
}

function formatAgentStatus(status: Agent["status"]): string {
  if (status === "initializing") {
    return "Starting";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function resolveAgentTone(status: Agent["status"]): WorkspaceStatusStripTone {
  if (status === "error") {
    return "danger";
  }
  if (status === "running" || status === "initializing") {
    return "warning";
  }
  if (status === "closed") {
    return "neutral";
  }
  return "success";
}

function buildPullRequestStatusDescriptor(pullRequest: WorkspacePullRequestRuntime): {
  label: string;
  labelKey: string;
  activityLabelKey: string;
} {
  if (pullRequest.isMerged) {
    return {
      label: "PR merged",
      labelKey: "workspace.pullRequestStatus.merged",
      activityLabelKey: "workspace.activity.pullRequest.merged",
    };
  }
  if (pullRequest.state === "closed") {
    return {
      label: "PR closed",
      labelKey: "workspace.pullRequestStatus.closed",
      activityLabelKey: "workspace.activity.pullRequest.closed",
    };
  }
  if (pullRequest.checksStatus === "failure") {
    return {
      label: "Checks failed",
      labelKey: "workspace.pullRequestStatus.checksFailed",
      activityLabelKey: "workspace.activity.pullRequest.checksFailed",
    };
  }
  if (pullRequest.reviewDecision === "changes_requested") {
    return {
      label: "Changes requested",
      labelKey: "workspace.pullRequestStatus.changesRequested",
      activityLabelKey: "workspace.activity.pullRequest.changesRequested",
    };
  }
  if (pullRequest.checksStatus === "pending") {
    return {
      label: "Checks pending",
      labelKey: "workspace.pullRequestStatus.checksPending",
      activityLabelKey: "workspace.activity.pullRequest.checksPending",
    };
  }
  if (pullRequest.reviewDecision === "approved") {
    return {
      label: "Approved",
      labelKey: "workspace.pullRequestStatus.approved",
      activityLabelKey: "workspace.activity.pullRequest.approved",
    };
  }
  return {
    label: "PR open",
    labelKey: "workspace.pullRequestStatus.open",
    activityLabelKey: "workspace.activity.pullRequest.open",
  };
}

function resolvePullRequestTone(
  pullRequest: WorkspacePullRequestRuntime,
): WorkspaceStatusStripTone {
  if (pullRequest.isMerged) {
    return "success";
  }
  if (pullRequest.state === "closed") {
    return "neutral";
  }
  if (
    pullRequest.checksStatus === "failure" ||
    pullRequest.reviewDecision === "changes_requested"
  ) {
    return "danger";
  }
  if (pullRequest.checksStatus === "pending" || pullRequest.reviewDecision === "pending") {
    return "warning";
  }
  if (pullRequest.isMerged || pullRequest.reviewDecision === "approved") {
    return "success";
  }
  return "neutral";
}

function buildChecksStatusLabel(
  status: NonNullable<WorkspacePullRequestRuntime["checksStatus"]>,
): string {
  if (status === "success") {
    return "Checks passed";
  }
  if (status === "failure") {
    return "Checks failed";
  }
  if (status === "pending") {
    return "Checks pending";
  }
  return "No checks";
}

function buildReviewDecisionLabel(
  decision: NonNullable<WorkspacePullRequestRuntime["reviewDecision"]>,
): string {
  if (decision === "approved") {
    return "Approved";
  }
  if (decision === "changes_requested") {
    return "Changes requested";
  }
  return "Review pending";
}

function resolveChecksTone(
  status: NonNullable<WorkspacePullRequestRuntime["checksStatus"]>,
): WorkspaceStatusStripTone {
  if (status === "success") {
    return "success";
  }
  if (status === "failure") {
    return "danger";
  }
  return "warning";
}

function resolveReviewTone(
  decision: NonNullable<WorkspacePullRequestRuntime["reviewDecision"]>,
): WorkspaceStatusStripTone {
  if (decision === "approved") {
    return "success";
  }
  if (decision === "changes_requested") {
    return "danger";
  }
  return "warning";
}
