import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { type Agent, useSessionStore } from "@/stores/session-store";

function buildHistoricalAgentDetail(agent: AggregatedAgent): Agent {
  return {
    serverId: agent.serverId,
    id: agent.id,
    provider: agent.provider,
    status: agent.status,
    createdAt: agent.createdAt,
    updatedAt: agent.lastActivityAt,
    lastUserMessageAt: null,
    lastActivityAt: agent.lastActivityAt,
    capabilities: {
      supportsStreaming: false,
      supportsSessionPersistence: false,
      supportsDynamicModes: false,
      supportsMcpServers: false,
      supportsReasoningStream: false,
      supportsToolInvocations: false,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    runtimeInfo: {
      provider: agent.provider,
      sessionId: null,
    },
    title: agent.title,
    cwd: agent.cwd,
    model: null,
    thinkingOptionId: null,
    requiresAttention: agent.requiresAttention,
    attentionReason: agent.attentionReason,
    attentionTimestamp: agent.attentionTimestamp,
    archivedAt: agent.archivedAt,
    labels: agent.labels,
    parentAgentId: null,
  };
}

function isValidArchivedAt(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * Seeds session-store agent details for an archived agent before navigating to it
 * @param agent Aggregated archived agent to remember in the live session store
 */
export function rememberArchivedAgentDetail(agent: AggregatedAgent): void {
  if (!isValidArchivedAt(agent.archivedAt)) {
    return;
  }

  useSessionStore.getState().setAgentDetails(agent.serverId, (previous) => {
    const existing = previous.get(agent.id);
    const next = new Map(previous);
    next.set(agent.id, {
      ...buildHistoricalAgentDetail(agent),
      ...existing,
      archivedAt: existing?.archivedAt ?? agent.archivedAt,
      cwd: existing?.cwd ?? agent.cwd,
    });
    return next;
  });
}

/** Test-only helpers for archived agent history navigation */
export const __private__ = {
  isValidArchivedAt,
};
