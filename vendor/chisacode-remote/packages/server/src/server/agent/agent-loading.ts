import type { Logger } from "pino";

import type { AgentProvider } from "./agent-sdk-types.js";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import {
  buildConfigOverrides,
  buildSessionConfig,
  extractTimestamps,
  isStoredAgentProviderAvailable,
  toAgentPersistenceHandle,
} from "../persistence-hooks.js";

const pendingAgentInitializations = new Map<string, Promise<ManagedAgent>>();

/** Maximum number of recently-active agents to preload after a directory fetch. */
export const AGENT_PRELOAD_LIMIT = 3;

export interface EnsureAgentLoadedDeps {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  validProviders?: Iterable<AgentProvider>;
  logger: Logger;
}

export interface PreloadAgentCandidate {
  readonly id: string;
  readonly updatedAt?: string | null;
}

/**
 * Select the most recently updated agent ids for background preload.
 * Stable for equal timestamps by preserving input order after sort key ties.
 */
export function selectAgentsForPreload(
  candidates: readonly PreloadAgentCandidate[],
  limit: number = AGENT_PRELOAD_LIMIT,
): string[] {
  if (limit <= 0 || candidates.length === 0) {
    return [];
  }
  return [...candidates]
    .map((candidate, index) => ({
      id: candidate.id,
      index,
      updatedAtMs: Date.parse(candidate.updatedAt ?? ""),
    }))
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.updatedAtMs)
        ? left.updatedAtMs
        : Number.NEGATIVE_INFINITY;
      const rightTime = Number.isFinite(right.updatedAtMs)
        ? right.updatedAtMs
        : Number.NEGATIVE_INFINITY;
      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }
      return left.index - right.index;
    })
    .slice(0, limit)
    .map((candidate) => candidate.id);
}

/**
 * Fire-and-forget ensureAgentLoaded for a bounded set of agent ids.
 * Failures are logged at debug and never rejected to the caller.
 */
export function preloadAgents(agentIds: readonly string[], deps: EnsureAgentLoadedDeps): void {
  for (const agentId of agentIds) {
    void ensureAgentLoaded(agentId, deps).catch((error) => {
      deps.logger.debug({ err: error, agentId }, "Background agent preload failed");
    });
  }
}

export async function ensureAgentLoaded(
  agentId: string,
  deps: EnsureAgentLoadedDeps,
): Promise<ManagedAgent> {
  const existing = deps.agentManager.getAgent(agentId);
  if (existing) {
    return existing;
  }

  const inflight = pendingAgentInitializations.get(agentId);
  if (inflight) {
    return inflight;
  }

  const initPromise = (async () => {
    const record = await deps.agentStorage.get(agentId);
    if (!record) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const validProviders = deps.validProviders ?? deps.agentManager.getRegisteredProviderIds();
    if (!isStoredAgentProviderAvailable(record, validProviders)) {
      throw new Error(`Agent ${agentId} references unavailable provider '${record.provider}'`);
    }

    const handle = toAgentPersistenceHandle(validProviders, record.persistence);

    let snapshot: ManagedAgent;
    if (handle) {
      snapshot = await deps.agentManager.resumeAgentFromPersistence(
        handle,
        buildConfigOverrides(record),
        agentId,
        {
          ...extractTimestamps(record),
          labels: record.labels,
          relation: record.relation,
        },
      );
      deps.logger.info({ agentId, provider: record.provider }, "Agent resumed from persistence");
    } else {
      const config = buildSessionConfig(record, {
        validProviders,
      });
      if (!config) {
        throw new Error(`Agent ${agentId} references unavailable provider '${record.provider}'`);
      }
      snapshot = await deps.agentManager.createAgent(config, agentId, {
        labels: record.labels,
        relation: record.relation,
      });
      deps.logger.info({ agentId, provider: record.provider }, "Agent created from stored config");
    }

    // Seed provider history in the background so create/resume is not blocked
    // on a full thread/read. fetch_agent_timeline can wait briefly or report
    // hydrating=true while this is in flight.
    void deps.agentManager.hydrateTimelineFromProvider(agentId).catch((error) => {
      deps.logger.debug({ err: error, agentId }, "Background timeline hydration failed");
    });
    return deps.agentManager.getAgent(agentId) ?? snapshot;
  })();

  pendingAgentInitializations.set(agentId, initPromise);

  try {
    return await initPromise;
  } finally {
    const current = pendingAgentInitializations.get(agentId);
    if (current === initPromise) {
      pendingAgentInitializations.delete(agentId);
    }
  }
}
