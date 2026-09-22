/**
 * Sidebar V2 project model — ported from T3 Code's
 * `apps/web/src/sidebarProjectGrouping.ts` and the project sorters in
 * `apps/web/src/components/Sidebar.logic.ts`, adapted to ChisaCode's
 * workspace registry. A project snapshot groups workspace members that share
 * a logical project key; the sidebar shows one row per logical project and
 * can filter the thread list by scope.
 */
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { orderItemsByPreferredIds } from "./logic";

/** A workspace member of a project group. */
export interface SidebarV2ProjectMember {
  workspaceId: string;
  /** Physical project key (workspace.projectId). */
  physicalProjectKey: string;
  projectName: string;
  workspaceDirectory: string;
  branch: string | null;
  kind: string;
  status: string | null;
  archivedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** PR state when the workspace carries git runtime data. */
  changeRequestState: "open" | "closed" | "merged" | null;
}

/** A grouped project shown in the sidebar. */
export interface SidebarV2ProjectSnapshot {
  /** Logical grouping key. */
  projectKey: string;
  displayName: string;
  /** Representative member (the workspace the sidebar opens). */
  representative: SidebarV2ProjectMember;
  members: SidebarV2ProjectMember[];
  createdAt?: string;
  updatedAt?: string;
  /** True when every member is archived. */
  fullyArchived: boolean;
}

/** Builds a project member from a workspace descriptor. */
export function workspaceDescriptorToProjectMember(
  workspace: WorkspaceDescriptor,
): SidebarV2ProjectMember {
  const gitRuntime = workspace.gitRuntime;
  const branch =
    gitRuntime?.currentBranch?.trim() ||
    (workspace.projectKind === "git" ? workspace.name.trim() : null) ||
    null;
  const changeRequestState = resolveChangeRequestState(workspace);
  return {
    workspaceId: workspace.id,
    physicalProjectKey: workspace.projectId,
    projectName: workspace.projectDisplayName || workspace.projectId,
    workspaceDirectory: workspace.workspaceDirectory,
    branch,
    kind: workspace.workspaceKind,
    status: workspace.status ?? null,
    archivedAt: workspace.archivingAt ?? null,
    createdAt: "",
    updatedAt: "",
    changeRequestState,
  };
}

function resolveChangeRequestState(
  workspace: WorkspaceDescriptor,
): "open" | "closed" | "merged" | null {
  const pr = workspace.githubRuntime?.pullRequest;
  if (pr?.state === "open") {
    return "open";
  }
  if (pr?.state === "closed") {
    return "closed";
  }
  if (pr?.state === "merged") {
    return "merged";
  }
  return null;
}

function getMemberFreshness(member: SidebarV2ProjectMember): number {
  const updatedAt = Date.parse(member.updatedAt ?? "");
  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }
  const createdAt = Date.parse(member.createdAt ?? "");
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function shouldReplaceDuplicateMember(input: {
  existingMember: SidebarV2ProjectMember;
  candidateMember: SidebarV2ProjectMember;
}): boolean {
  const existingFreshness = getMemberFreshness(input.existingMember);
  const candidateFreshness = getMemberFreshness(input.candidateMember);
  if (candidateFreshness !== existingFreshness) {
    return candidateFreshness > existingFreshness;
  }
  return input.candidateMember.workspaceId > input.existingMember.workspaceId;
}

/** Members (and their logical keys) grouped by physical project key. */
interface PhysicalProjectBucket {
  logicalKey: string;
  member: SidebarV2ProjectMember;
}

function collectPhysicalWinners(input: {
  members: readonly SidebarV2ProjectMember[];
  deriveLogicalKey: (member: SidebarV2ProjectMember) => string;
}): Map<string, PhysicalProjectBucket> {
  const winners = new Map<string, PhysicalProjectBucket>();
  for (const member of input.members) {
    const physicalKey = member.physicalProjectKey;
    const existing = winners.get(physicalKey);
    if (!existing) {
      winners.set(physicalKey, { logicalKey: input.deriveLogicalKey(member), member });
      continue;
    }
    if (
      shouldReplaceDuplicateMember({ existingMember: existing.member, candidateMember: member })
    ) {
      winners.set(physicalKey, { logicalKey: input.deriveLogicalKey(member), member });
    }
  }
  return winners;
}

function deriveDisplayName(members: readonly SidebarV2ProjectMember[]): string {
  const representative = members[0];
  if (!representative) {
    return "Unknown project";
  }
  if (members.length > 1) {
    const shortNames = members.map((member) => shortProjectName(member.projectName));
    const uniqueShortNames = Array.from(new Set(shortNames));
    if (uniqueShortNames.length === 1) {
      return uniqueShortNames[0] ?? representative.projectName;
    }
    return `${shortProjectName(representative.projectName)} (${members.length})`;
  }
  return shortProjectName(representative.projectName);
}

/**
 * Extracts the basename of a project label ("owner/repo" → "repo", "a/b/c" → "c").
 * Used by the sidebar status cards to match T3's short project label.
 * @param projectName Full project label (may contain "/" separators)
 * @returns The last path segment, or the trimmed input when no separator exists
 */
export function shortProjectName(projectName: string): string {
  const trimmed = projectName.trim();
  const slash = trimmed.lastIndexOf("/");
  if (slash >= 0 && slash < trimmed.length - 1) {
    return trimmed.slice(slash + 1);
  }
  return trimmed || "Unknown project";
}

/**
 * Builds sidebar project snapshots from workspace members, grouping by
 * logical key (defaults to the physical project key).
 * @param input The members, logical-key derivation, and whether to skip archived members
 * @returns The project snapshots in input-member order
 */
export function buildSidebarProjectSnapshots(input: {
  members: readonly SidebarV2ProjectMember[];
  deriveLogicalKey?: (member: SidebarV2ProjectMember) => string;
  includeArchived?: boolean;
}): SidebarV2ProjectSnapshot[] {
  const deriveLogicalKey =
    input.deriveLogicalKey ?? ((member: SidebarV2ProjectMember) => member.physicalProjectKey);
  const includeArchived = input.includeArchived ?? false;
  const winners = collectPhysicalWinners({ members: input.members, deriveLogicalKey });
  const grouped = new Map<string, SidebarV2ProjectMember[]>();
  for (const winner of winners.values()) {
    const existing = grouped.get(winner.logicalKey) ?? [];
    existing.push(winner.member);
    grouped.set(winner.logicalKey, existing);
  }
  const snapshots: SidebarV2ProjectSnapshot[] = [];
  for (const [logicalKey, groupMembers] of grouped) {
    const nonArchivedMembers = groupMembers.filter((member) => member.archivedAt === null);
    const visibleMembers = includeArchived ? [...groupMembers] : nonArchivedMembers;
    if (visibleMembers.length === 0) {
      continue;
    }
    const representative = visibleMembers[0];
    if (!representative) {
      continue;
    }
    snapshots.push({
      projectKey: logicalKey,
      displayName: deriveDisplayName(visibleMembers),
      representative,
      members: visibleMembers,
      createdAt: representative.createdAt,
      updatedAt: representative.updatedAt,
      fullyArchived: groupMembers.length > 0 && nonArchivedMembers.length === 0,
    });
  }
  return snapshots;
}

/** A thread-like activity stamp used to sort projects. */
export interface SidebarV2ProjectActivityInput {
  projectKey: string;
  createdAt: string;
  updatedAt: string;
  threads: readonly { createdAt: string; updatedAt: string }[];
}

/**
 * The timestamp a project sorts by: its newest thread's newest activity, else
 * the project's updatedAt/createdAt.
 * @param project The project to score
 * @returns The sort timestamp in epoch ms
 */
export function getProjectSortTimestamp(project: SidebarV2ProjectActivityInput): number {
  let latest = Number.NEGATIVE_INFINITY;
  for (const thread of project.threads) {
    for (const candidate of [thread.createdAt, thread.updatedAt]) {
      const parsed = Date.parse(candidate);
      if (!Number.isNaN(parsed) && parsed > latest) {
        latest = parsed;
      }
    }
  }
  if (Number.isFinite(latest)) {
    return latest;
  }
  const updatedAt = Date.parse(project.updatedAt);
  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }
  const createdAt = Date.parse(project.createdAt);
  return Number.isFinite(createdAt) ? createdAt : 0;
}

/**
 * Sorts projects by activity descending (newest activity first), with a
 * manual order applied first when provided.
 * @param input The projects, threads by project key, and optional preferred (manual) order
 * @returns The sorted projects
 */
export function sortProjectsForSidebar<T extends { readonly projectKey: string }>(input: {
  projects: readonly T[];
  threadsByProjectKey: ReadonlyMap<string, readonly { createdAt: string; updatedAt: string }[]>;
  preferredProjectKeys?: readonly string[];
}): T[] {
  const preferred =
    input.preferredProjectKeys && input.preferredProjectKeys.length > 0
      ? orderItemsByPreferredIds({
          items: input.projects,
          preferredIds: input.preferredProjectKeys,
          getId: (project) => project.projectKey,
        })
      : null;
  // Manual order short-circuits the timestamp sort, mirroring T3's
  // `sortOrder === "manual"` pass-through.
  if (preferred) {
    return preferred;
  }
  return [...input.projects].sort((left, right) => {
    const leftTimestamp = getProjectSortTimestamp({
      projectKey: left.projectKey,
      createdAt: "",
      updatedAt: "",
      threads: input.threadsByProjectKey.get(left.projectKey) ?? [],
    });
    const rightTimestamp = getProjectSortTimestamp({
      projectKey: right.projectKey,
      createdAt: "",
      updatedAt: "",
      threads: input.threadsByProjectKey.get(right.projectKey) ?? [],
    });
    return rightTimestamp - leftTimestamp || left.projectKey.localeCompare(right.projectKey);
  });
}
