export const PARENT_AGENT_ID_LABEL = "chisacode.parent-agent-id";
export const RELATION_KIND_LABEL = "chisacode.relation-kind";
export const DELEGATION_TASK_ID_LABEL = "chisacode.delegation-task-id";

export const AGENT_RELATION_KINDS = ["subagent", "detached", "handoff", "team-slot"] as const;
export const AGENT_RELATION_SOURCES = ["mcp", "user", "system"] as const;

export type AgentRelationKind = (typeof AGENT_RELATION_KINDS)[number];
export type AgentRelationSource = (typeof AGENT_RELATION_SOURCES)[number];

export interface AgentRelation {
  kind: AgentRelationKind;
  parentAgentId?: string;
  taskId?: string;
  source?: AgentRelationSource;
}

export function readParentAgentIdLabel(labels: Record<string, unknown> | undefined): unknown {
  return labels?.[PARENT_AGENT_ID_LABEL];
}

export function readAgentRelation(
  labels: Record<string, unknown> | undefined,
  relation?: AgentRelation | null,
): AgentRelation | null {
  const normalizedRelation = normalizeAgentRelation(relation);
  if (normalizedRelation) {
    const parentAgentId =
      normalizedRelation.parentAgentId ?? normalizeNonEmptyString(labels?.[PARENT_AGENT_ID_LABEL]);
    const taskId =
      normalizedRelation.taskId ?? normalizeNonEmptyString(labels?.[DELEGATION_TASK_ID_LABEL]);
    return {
      ...normalizedRelation,
      ...(parentAgentId ? { parentAgentId } : {}),
      ...(taskId ? { taskId } : {}),
    };
  }

  const parentAgentId = normalizeNonEmptyString(labels?.[PARENT_AGENT_ID_LABEL]);
  if (!parentAgentId) {
    return null;
  }

  const labelKind = normalizeRelationKind(labels?.[RELATION_KIND_LABEL]) ?? "subagent";
  const taskId = normalizeNonEmptyString(labels?.[DELEGATION_TASK_ID_LABEL]);
  return {
    kind: labelKind,
    parentAgentId,
    ...(taskId ? { taskId } : {}),
  };
}

export function labelsForAgentRelation(
  labels: Record<string, string> | undefined,
  relation: AgentRelation | null | undefined,
): Record<string, string> | undefined {
  const normalizedRelation = readAgentRelation(labels, relation);
  const mergedLabels = { ...labels };
  if (normalizedRelation?.parentAgentId) {
    mergedLabels[PARENT_AGENT_ID_LABEL] = normalizedRelation.parentAgentId;
  }
  if (normalizedRelation?.kind) {
    mergedLabels[RELATION_KIND_LABEL] = normalizedRelation.kind;
  }
  if (normalizedRelation?.taskId) {
    mergedLabels[DELEGATION_TASK_ID_LABEL] = normalizedRelation.taskId;
  }
  return Object.keys(mergedLabels).length > 0 ? mergedLabels : undefined;
}

export function isCascadingAgentRelation(relation: AgentRelation | null): boolean {
  return relation?.kind === "subagent" || relation?.kind === "team-slot";
}

function normalizeAgentRelation(relation: AgentRelation | null | undefined): AgentRelation | null {
  if (!relation) {
    return null;
  }
  const kind = normalizeRelationKind(relation.kind);
  if (!kind) {
    return null;
  }
  const parentAgentId = normalizeNonEmptyString(relation.parentAgentId);
  const taskId = normalizeNonEmptyString(relation.taskId);
  const source = normalizeRelationSource(relation.source);
  return {
    kind,
    ...(parentAgentId ? { parentAgentId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(source ? { source } : {}),
  };
}

function normalizeRelationKind(value: unknown): AgentRelationKind | null {
  if (typeof value !== "string") {
    return null;
  }
  return AGENT_RELATION_KINDS.includes(value as AgentRelationKind)
    ? (value as AgentRelationKind)
    : null;
}

function normalizeRelationSource(value: unknown): AgentRelationSource | null {
  if (typeof value !== "string") {
    return null;
  }
  return AGENT_RELATION_SOURCES.includes(value as AgentRelationSource)
    ? (value as AgentRelationSource)
    : null;
}

function normalizeNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
