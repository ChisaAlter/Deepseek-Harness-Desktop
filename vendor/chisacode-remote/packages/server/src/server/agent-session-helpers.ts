/**
 * Pure helper functions for agent filtering, projection, and subscription logic.
 *
 * Extracted from session.ts to reduce Session surface area. These functions are
 * stateless — they receive all context as parameters and return deterministic results.
 */

import { resolveEffectiveThinkingOptionId } from "./agent/agent-projections.js";
import { CLIENT_CAPS, type ClientCapability } from "@chisacode/protocol/client-capabilities";
import {
  isLegacyEditorTargetId,
  type AgentSnapshotPayload,
  type EditorTargetDescriptorPayload,
  type ProjectPlacementPayload,
  type SessionOutboundMessage,
} from "./messages.js";
import {
  LEGACY_PROVIDER_IDS,
  clientSupportsAllProviders,
  clientSupportsFlexibleEditorIds,
} from "./session-helpers.js";
import type { AgentManager, AgentManagerEvent } from "./agent/agent-manager.js";
import type { DaemonConfigStore } from "./daemon-config-store.js";
import type { StructuredGenerationDaemonConfig } from "./agent/structured-generation-providers.js";

/** Agent updates filter type mirroring session.ts internal type. */
export interface AgentUpdatesFilter {
  statuses?: string[];
  requiresAttention?: boolean | null;
  projectKeys?: (string | null)[];
  includeArchived?: boolean;
  labels?: Record<string, string>;
  thinkingOptionId?: string | null;
}

/** Agent update payload — upsert or remove.
 *
 * Upsert payloads carry `agent` (AgentSnapshotPayload), optional
 * `agentId`, and an optional `project` placement.  Remove payloads
 * carry only `kind` and `agentId`. */
export type AgentUpdatePayload =
  | {
      kind: "upsert";
      agent: AgentSnapshotPayload;
      agentId?: string;
      project?: ProjectPlacementPayload | null;
    }
  | { kind: "remove"; agentId: string };

// --- Provider / editor visibility helpers ---

/** Check whether a provider is visible to the connected client based on app version. */
export function isProviderVisibleToClient(provider: string, appVersion: string | null): boolean {
  if (clientSupportsAllProviders(appVersion)) {
    return true;
  }
  return LEGACY_PROVIDER_IDS.has(provider);
}

/** Filter editor targets based on client capabilities. */
export function filterEditorsForClient(
  editors: EditorTargetDescriptorPayload[],
  appVersion: string | null,
): EditorTargetDescriptorPayload[] {
  if (clientSupportsFlexibleEditorIds(appVersion)) {
    return editors;
  }
  return editors.filter((editor) => isLegacyEditorTargetId(editor.id));
}

// --- Agent filter helpers ---

/** Check whether an agent matches the thinking-option filter. */
export function agentThinkingOptionMatchesFilter(
  agent: AgentSnapshotPayload,
  filter: AgentUpdatesFilter,
): boolean {
  if (filter.thinkingOptionId === undefined) {
    return true;
  }
  const expectedThinkingOptionId = resolveEffectiveThinkingOptionId({
    configuredThinkingOptionId: filter.thinkingOptionId ?? null,
  });
  const resolvedThinkingOptionId =
    agent.effectiveThinkingOptionId ??
    resolveEffectiveThinkingOptionId({
      runtimeInfo: agent.runtimeInfo,
      configuredThinkingOptionId: agent.thinkingOptionId ?? null,
    });
  return resolvedThinkingOptionId === expectedThinkingOptionId;
}

/** Check whether an agent matches structural filters (statuses, attention, project). */
export function matchesAgentStructuralFilter(
  agent: AgentSnapshotPayload,
  project: ProjectPlacementPayload,
  filter: AgentUpdatesFilter,
): boolean {
  if (filter.statuses && filter.statuses.length > 0) {
    const statuses = new Set(filter.statuses);
    if (!statuses.has(agent.status)) {
      return false;
    }
  }

  if (typeof filter.requiresAttention === "boolean") {
    const requiresAttention = agent.requiresAttention ?? false;
    if (requiresAttention !== filter.requiresAttention) {
      return false;
    }
  }

  if (filter.projectKeys && filter.projectKeys.length > 0) {
    const projectKeys = new Set(
      filter.projectKeys.filter((item) => (item ?? "").trim().length > 0),
    );
    if (projectKeys.size > 0 && !projectKeys.has(project.projectKey)) {
      return false;
    }
  }
  return true;
}

/** Composite agent filter — combines labels, archive, thinking-option, and structural filters. */
export function matchesAgentFilter(options: {
  agent: AgentSnapshotPayload;
  project: ProjectPlacementPayload;
  filter?: AgentUpdatesFilter;
}): boolean {
  const { agent, project, filter } = options;

  if (filter?.labels) {
    const matchesLabels = Object.entries(filter.labels).every(
      ([key, value]) => agent.labels[key] === value,
    );
    if (!matchesLabels) {
      return false;
    }
  }

  const includeArchived = filter?.includeArchived ?? false;
  if (!includeArchived && agent.archivedAt) {
    return false;
  }

  if (filter && !agentThinkingOptionMatchesFilter(agent, filter)) {
    return false;
  }

  if (filter && !matchesAgentStructuralFilter(agent, project, filter)) {
    return false;
  }

  return true;
}

/** Derive the target ID for agent update subscription routing. */
export function getAgentUpdateTargetId(update: AgentUpdatePayload): string {
  return update.kind === "remove" ? update.agentId : update.agent.id;
}

// --- Agent identifier resolution ---

/** Minimal stored record shape needed for agent identifier resolution. */
interface StoredAgentRecord {
  id: string;
  title: string | null | undefined;
  internal?: boolean;
}

/** Dependencies for agent identifier resolution. */
export interface AgentIdentifierDeps {
  listLiveAgentIds(): string[];
  listStoredRecords(): Promise<StoredAgentRecord[]>;
}

/** Resolve an agent identifier to a canonical agent ID. */
export async function resolveAgentIdentifier(
  deps: AgentIdentifierDeps,
  identifier: string,
): Promise<{ ok: true; agentId: string } | { ok: false; error: string }> {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return { ok: false, error: "Agent identifier cannot be empty" };
  }

  const stored = await deps.listStoredRecords();
  const storedRecords = stored.filter((record) => !record.internal);
  const knownIds = new Set<string>();
  for (const record of storedRecords) {
    knownIds.add(record.id);
  }
  for (const id of deps.listLiveAgentIds()) {
    knownIds.add(id);
  }

  if (knownIds.has(trimmed)) {
    return { ok: true, agentId: trimmed };
  }

  const prefixMatches = Array.from(knownIds).filter((id) => id.startsWith(trimmed));
  if (prefixMatches.length === 1) {
    return { ok: true, agentId: prefixMatches[0] };
  }
  if (prefixMatches.length > 1) {
    return {
      ok: false,
      error: `Agent identifier "${trimmed}" is ambiguous (${prefixMatches
        .slice(0, 5)
        .map((id) => id.slice(0, 8))
        .join(", ")}${prefixMatches.length > 5 ? ", …" : ""})`,
    };
  }

  const titleMatches = storedRecords.filter((record) => record.title === trimmed);
  if (titleMatches.length === 1) {
    return { ok: true, agentId: titleMatches[0].id };
  }
  if (titleMatches.length > 1) {
    return {
      ok: false,
      error: `Agent title "${trimmed}" is ambiguous (${titleMatches
        .slice(0, 5)
        .map((r) => r.id.slice(0, 8))
        .join(", ")}${titleMatches.length > 5 ? ", …" : ""})`,
    };
  }

  return { ok: false, error: `Agent not found: ${trimmed}` };
}

// --- Client capability parsing ---

/**
 * Parse raw client capability flags from the wire into a normalized set.
 */
export function parseClientCapabilities(
  capabilities: Record<string, unknown> | null | undefined,
): ReadonlySet<ClientCapability> {
  if (!capabilities) {
    return new Set();
  }
  const known = new Set<ClientCapability>(Object.values(CLIENT_CAPS));
  const result: ClientCapability[] = [];
  for (const [key, value] of Object.entries(capabilities)) {
    if (value === true && known.has(key as ClientCapability)) {
      result.push(key as ClientCapability);
    }
  }
  return new Set(result);
}

// --- Agent stream payload builder ---

/**
 * Build a typed agent_stream payload from an AgentManager event and serialized event.
 */
export function buildAgentStreamPayload(
  event: Extract<AgentManagerEvent, { type: "agent_stream" }>,
  serializedEvent: Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"]["event"],
): Extract<SessionOutboundMessage, { type: "agent_stream" }>["payload"] {
  return {
    agentId: event.agentId,
    event: serializedEvent,
    timestamp: event.timestamp ?? new Date().toISOString(),
    ...(typeof event.seq === "number" ? { seq: event.seq } : {}),
    ...(typeof event.epoch === "string" ? { epoch: event.epoch } : {}),
  };
}

// --- Agent selection helpers (deps-injected) ---

/** Dependencies for getFocusedAgentSelectionForCwd. */
export interface FocusedAgentSelectionDeps {
  clientActivity: {
    focusedAgentId: string | null;
  } | null;
  agentManager: Pick<AgentManager, "getAgent">;
}

/**
 * Get the focused agent's provider/model selection for a workspace directory.
 */
export function getFocusedAgentSelectionForCwd(
  cwd: string,
  deps: FocusedAgentSelectionDeps,
):
  | {
      provider?: string | null;
      model?: string | null;
      thinkingOptionId?: string | null;
    }
  | undefined {
  const focusedAgentId = deps.clientActivity?.focusedAgentId;
  if (!focusedAgentId) {
    return undefined;
  }

  const agent = deps.agentManager.getAgent(focusedAgentId);
  if (!agent || agent.cwd !== cwd) {
    return undefined;
  }

  return {
    provider: agent.provider,
    model: agent.runtimeInfo?.model ?? agent.config.model ?? null,
    thinkingOptionId: agent.runtimeInfo?.thinkingOptionId ?? agent.config.thinkingOptionId ?? null,
  };
}

/**
 * Read the structured generation daemon config.
 */
export function readStructuredGenerationDaemonConfig(
  daemonConfigStore: Pick<DaemonConfigStore, "get">,
): StructuredGenerationDaemonConfig {
  return {
    metadataGeneration: daemonConfigStore.get().metadataGeneration,
  };
}

// --- Agent update buffer/flush helpers (deps-injected) ---

/** Agent updates subscription state (mirrors session.ts internal type). */
export interface AgentUpdatesSubscriptionState {
  subscriptionId: string;
  filter?: AgentUpdatesFilter;
  isBootstrapping: boolean;
  pendingUpdatesByAgentId: Map<string, AgentUpdatePayload>;
}

/** Dependencies for bufferOrEmitAgentUpdate. */
export interface BufferAgentUpdateDeps {
  isProviderVisibleToClient(provider: string): boolean;
  emit(message: SessionOutboundMessage): void;
}

/**
 * Buffer an agent update during bootstrapping, or emit it live to the client.
 */
export function bufferOrEmitAgentUpdate(
  subscription: AgentUpdatesSubscriptionState,
  payload: AgentUpdatePayload,
  deps: BufferAgentUpdateDeps,
): void {
  if (payload.kind === "upsert" && !deps.isProviderVisibleToClient(payload.agent.provider)) {
    return;
  }
  if (subscription.isBootstrapping) {
    subscription.pendingUpdatesByAgentId.set(getAgentUpdateTargetId(payload), payload);
    return;
  }

  deps.emit({
    type: "agent_update",
    payload,
  });
}

/** Dependencies for flushBootstrappedAgentUpdates. */
export interface FlushAgentUpdatesDeps extends BufferAgentUpdateDeps {
  getAgentUpdatesSubscription(): AgentUpdatesSubscriptionState | null;
}

/**
 * Flush all buffered agent updates after bootstrapping completes.
 */
export function flushBootstrappedAgentUpdates(
  deps: FlushAgentUpdatesDeps,
  options?: {
    snapshotUpdatedAtByAgentId?: Map<string, number>;
  },
): void {
  const subscription = deps.getAgentUpdatesSubscription();
  if (!subscription || !subscription.isBootstrapping) {
    return;
  }

  subscription.isBootstrapping = false;
  const pending = Array.from(subscription.pendingUpdatesByAgentId.values());
  subscription.pendingUpdatesByAgentId.clear();

  for (const payload of pending) {
    if (payload.kind === "upsert") {
      const snapshotUpdatedAt = options?.snapshotUpdatedAtByAgentId?.get(payload.agent.id);
      if (typeof snapshotUpdatedAt === "number") {
        const updateUpdatedAt = Date.parse(payload.agent.updatedAt);
        if (!Number.isNaN(updateUpdatedAt) && updateUpdatedAt <= snapshotUpdatedAt) {
          continue;
        }
      }
    }

    deps.emit({
      type: "agent_update",
      payload,
    });
  }
}
