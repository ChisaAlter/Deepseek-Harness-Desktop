import type { HostConnection } from "@/types/host-connection";

/** A host connection being considered for selection, paired with its id */
export interface ConnectionCandidate {
  connectionId: string;
  connection: HostConnection;
}

/** The probe result for a connection: still pending, unavailable, or available with a measured latency */
export type ConnectionProbeState =
  | { status: "pending"; latencyMs: null }
  | { status: "unavailable"; latencyMs: null }
  | { status: "available"; latencyMs: number };

/** The candidate connections and their probe results used to pick the best connection */
export interface SelectBestConnectionInput {
  candidates: ConnectionCandidate[];
  probeByConnectionId: Map<string, ConnectionProbeState>;
}

function getAvailableLatency(input: {
  connectionId: string;
  probeByConnectionId: Map<string, ConnectionProbeState>;
}): number | null {
  const probe = input.probeByConnectionId.get(input.connectionId);
  return probe?.status === "available" ? probe.latencyMs : null;
}

/**
 * Picks the available connection with the lowest measured latency
 * @param input The candidate connections and their probe results
 * @returns The id of the lowest-latency available connection, or null when none are available
 */
export function selectBestConnection(input: SelectBestConnectionInput): string | null {
  const { candidates, probeByConnectionId } = input;
  if (candidates.length === 0) {
    return null;
  }

  let bestConnectionId: string | null = null;
  let bestLatency: number | null = null;

  for (const candidate of candidates) {
    const latencyMs = getAvailableLatency({
      connectionId: candidate.connectionId,
      probeByConnectionId,
    });
    if (latencyMs === null) {
      continue;
    }
    if (bestLatency === null || latencyMs < bestLatency) {
      bestConnectionId = candidate.connectionId;
      bestLatency = latencyMs;
    }
  }

  return bestConnectionId;
}
