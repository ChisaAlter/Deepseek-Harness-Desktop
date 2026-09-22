import type { AgentSnapshotPayload } from "@chisacode/protocol/messages";
import type { AgentPermissionRequest } from "@chisacode/protocol/agent-types";
import { readAgentRelation } from "@chisacode/protocol/agent-labels";
import type { Agent } from "@/stores/session-store";

/**
 * Decides how an incoming authoritative agent snapshot should replace the
 * current store entry.
 *
 * Stale snapshots (older updatedAt) are rejected so in-flight pre-archive
 * views cannot clobber a newer state. Archive state is monotonic: a snapshot
 * with the SAME updatedAt that lacks archivedAt is a stale pre-archive view
 * racing the optimistic archive (equal timestamps bypass strict `<` checks),
 * so the archived state is preserved while the rest of the snapshot applies.
 * Explicit unarchive always resumes the agent with a newer updatedAt, so it
 * is unaffected.
 * @param current The current store entry, or undefined when absent
 * @param incoming The normalized incoming authoritative snapshot
 * @returns `{ status: "reject" }` when the snapshot is stale, or
 * `{ status: "apply", agent }` with the entry to store
 */
export function resolveAuthoritativeAgentSnapshot(
  current: Agent | undefined,
  incoming: Agent,
): { status: "reject" } | { status: "apply"; agent: Agent } {
  if (current && incoming.updatedAt.getTime() < current.updatedAt.getTime()) {
    return { status: "reject" };
  }
  if (
    current?.archivedAt &&
    !incoming.archivedAt &&
    incoming.updatedAt.getTime() === current.updatedAt.getTime()
  ) {
    return { status: "apply", agent: { ...incoming, archivedAt: current.archivedAt } };
  }
  return { status: "apply", agent: incoming };
}

/**
 * Derives a stable cache key for a pending permission request scoped to an agent.
 * @param agentId The agent identifier owning the permission request
 * @param request The permission request to key
 * @returns A string key of the form `agentId:fallbackId`
 */
export function derivePendingPermissionKey(
  agentId: string,
  request: AgentPermissionRequest,
): string {
  const fallbackId =
    request.id ||
    (typeof request.metadata?.id === "string" ? request.metadata.id : undefined) ||
    request.name ||
    request.title ||
    `${request.kind}:${JSON.stringify(request.input ?? request.metadata ?? {})}`;

  return `${agentId}:${fallbackId}`;
}

/**
 * Normalizes a protocol agent snapshot payload into the app-side agent state shape,
 * parsing timestamps, resolving the agent relation/parent, and defaulting optional fields.
 * @param snapshot The raw protocol snapshot payload
 * @param serverId The server identifier the snapshot belongs to
 * @returns The normalized agent state object
 */
export function normalizeAgentSnapshot(snapshot: AgentSnapshotPayload, serverId: string) {
  const createdAt = new Date(snapshot.createdAt);
  const updatedAt = new Date(snapshot.updatedAt);
  const lastUserMessageAt = snapshot.lastUserMessageAt
    ? new Date(snapshot.lastUserMessageAt)
    : null;
  const attentionTimestamp = snapshot.attentionTimestamp
    ? new Date(snapshot.attentionTimestamp)
    : null;
  const archivedAt = snapshot.archivedAt ? new Date(snapshot.archivedAt) : null;
  const relation = readAgentRelation(snapshot.labels, snapshot.relation);
  const parentAgentId = relation?.parentAgentId ?? null;

  return {
    serverId,
    id: snapshot.id,
    provider: snapshot.provider,
    status: snapshot.status,
    createdAt,
    updatedAt,
    lastUserMessageAt,
    lastActivityAt: updatedAt,
    capabilities: snapshot.capabilities,
    currentModeId: snapshot.currentModeId,
    availableModes: snapshot.availableModes ?? [],
    pendingPermissions: snapshot.pendingPermissions ?? [],
    persistence: snapshot.persistence ?? null,
    runtimeInfo: snapshot.runtimeInfo,
    lastUsage: snapshot.lastUsage,
    lastError: snapshot.lastError ?? null,
    title: snapshot.title ?? null,
    cwd: snapshot.cwd,
    model: snapshot.model ?? null,
    features: snapshot.features,
    thinkingOptionId: snapshot.thinkingOptionId ?? null,
    requiresAttention: snapshot.requiresAttention ?? false,
    attentionReason: snapshot.attentionReason ?? null,
    attentionTimestamp,
    archivedAt,
    parentAgentId,
    relationKind: relation?.kind ?? null,
    labels: snapshot.labels,
  };
}
