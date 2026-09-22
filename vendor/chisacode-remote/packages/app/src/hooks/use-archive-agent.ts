import { useCallback, useMemo } from "react";
import type { DaemonClient } from "@chisacode/client/internal/daemon-client";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { agentHistoryQueryKeys } from "./agent-history-query-key";

export const ARCHIVE_AGENT_PENDING_QUERY_KEY = ["archive-agent-pending"] as const;
export const ARCHIVE_AGENT_SUPPRESSED_QUERY_KEY = ["archive-agent-suppressed"] as const;
const EMPTY_PENDING_ARCHIVE_AGENT_IDS = new Set<string>();

export interface ArchiveAgentInput {
  serverId: string;
  agentId: string;
}

export type ArchiveAgentClient = Pick<DaemonClient, "archiveAgent" | "closeItems">;

type ArchiveAgentState = Record<string, true>;

export type ArchiveAgentPendingState = ArchiveAgentState;
export type ArchiveAgentSuppressedState = ArchiveAgentState;

interface SetAgentArchivingInput extends ArchiveAgentInput {
  queryClient: QueryClient;
  isArchiving: boolean;
}

interface IsAgentArchivingInput extends ArchiveAgentInput {
  queryClient: QueryClient;
}

export interface AgentsListQueryData {
  entries?: Array<{ agent?: { id?: string | null } | null } | null>;
}

export interface AgentHistoryQueryAgent {
  id?: string | null;
  archivedAt?: Date | null;
}

export interface AgentHistoryQueryPage {
  agents?: AgentHistoryQueryAgent[];
}

export interface AgentHistoryQueryData {
  pages?: AgentHistoryQueryPage[];
}

export function toArchiveKey(input: ArchiveAgentInput): string {
  const serverId = input.serverId.trim();
  const agentId = input.agentId.trim();
  if (!serverId || !agentId) {
    return "";
  }
  return `${serverId}:${agentId}`;
}

export function readPendingState(queryClient: QueryClient): ArchiveAgentPendingState {
  return queryClient.getQueryData<ArchiveAgentPendingState>(ARCHIVE_AGENT_PENDING_QUERY_KEY) ?? {};
}

export function readSuppressedState(queryClient: QueryClient): ArchiveAgentSuppressedState {
  return (
    queryClient.getQueryData<ArchiveAgentSuppressedState>(ARCHIVE_AGENT_SUPPRESSED_QUERY_KEY) ?? {}
  );
}

export function selectPendingArchiveAgentIds(
  pendingState: ArchiveAgentPendingState,
  serverId: string,
): ReadonlySet<string> {
  return selectArchiveAgentIdsByServer(pendingState, serverId);
}

export function selectSuppressedArchiveAgentIds(
  suppressedState: ArchiveAgentSuppressedState,
  serverId: string,
): ReadonlySet<string> {
  return selectArchiveAgentIdsByServer(suppressedState, serverId);
}

function selectArchiveAgentIdsByServer(
  state: ArchiveAgentPendingState | ArchiveAgentSuppressedState,
  serverId: string,
): ReadonlySet<string> {
  const normalizedServerId = serverId.trim();
  if (!normalizedServerId) {
    return EMPTY_PENDING_ARCHIVE_AGENT_IDS;
  }

  const prefix = `${normalizedServerId}:`;
  let agentIds: string[] | null = null;
  for (const key of Object.keys(state)) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    const agentId = key.slice(prefix.length);
    if (!agentId) {
      continue;
    }
    agentIds ??= [];
    agentIds.push(agentId);
  }

  if (!agentIds || agentIds.length === 0) {
    return EMPTY_PENDING_ARCHIVE_AGENT_IDS;
  }
  return new Set(agentIds);
}

export function resolveArchiveAgentClient(input: {
  serverId: string;
  sessionClient: ArchiveAgentClient | null | undefined;
  runtimeClient: ArchiveAgentClient | null | undefined;
}): ArchiveAgentClient | null {
  return input.runtimeClient ?? input.sessionClient ?? null;
}

export function isArchiveAgentNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // Match both server-side "not found" messages that can surface when an
  // already-archived agent's storage record is gone:
  //   - "Agent not found: <id>"                (lifecycle-command.ts archiveStoredAgent)
  //   - "Agent not found in storage after archive: <id>"  (post-archive guard)
  // Without matching the second one, re-archiving an already-archived session
  // whose record was cleared throws an unswallowed error and pops a toast.
  const isNotFound = /Agent not found( in storage after archive)?:/i.test(message);
  return isNotFound && /archive_agent_request/i.test(message);
}

/**
 * Detects client-side request timeouts, which are ambiguous: the daemon may
 * still be processing the archive (it routinely takes 10–12s per agent under
 * load, longer than the request timeout). Rolling the optimistic removal back
 * on timeout makes already-archived sessions flicker back into the list, so
 * timeout errors are treated as "in flight" instead of "failed".
 */
export function isArchiveTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Timeout waiting for message|Timed out waiting for connection/i.test(message);
}

function groupArchiveInputsByServer(inputs: ArchiveAgentInput[]): Map<string, string[]> {
  const byServer = new Map<string, string[]>();
  for (const input of inputs) {
    const serverId = input.serverId.trim();
    const agentId = input.agentId.trim();
    if (!serverId || !agentId) {
      continue;
    }
    const existing = byServer.get(serverId);
    if (existing) {
      existing.push(agentId);
    } else {
      byServer.set(serverId, [agentId]);
    }
  }
  return byServer;
}

/**
 * Aggregated outcome of a multi-session archive run. Callers use it to drive
 * the sidebar progress capsule and the merged failure toast instead of
 * surfacing raw RPC errors.
 */
export interface ArchiveAgentsOutcome {
  /** Sessions confirmed archived by the daemon (or optimistically kept). */
  archivedCount: number;
  /** Sessions that genuinely failed; their optimistic removal is rolled back. */
  failedCount: number;
  /** Sessions whose request timed out; the daemon is still processing them. */
  backgroundCount: number;
  /** Inputs of the failed sessions, used by the toast retry action. */
  retryInputs: ArchiveAgentInput[];
}

export const EMPTY_ARCHIVE_AGENTS_OUTCOME: ArchiveAgentsOutcome = {
  archivedCount: 0,
  failedCount: 0,
  backgroundCount: 0,
  retryInputs: [],
};

function addArchiveOutcomes(
  left: ArchiveAgentsOutcome,
  right: ArchiveAgentsOutcome,
): ArchiveAgentsOutcome {
  return {
    archivedCount: left.archivedCount + right.archivedCount,
    failedCount: left.failedCount + right.failedCount,
    backgroundCount: left.backgroundCount + right.backgroundCount,
    retryInputs: [...left.retryInputs, ...right.retryInputs],
  };
}

function buildFailedOutcome(agentIds: string[], serverId: string): ArchiveAgentsOutcome {
  return {
    archivedCount: 0,
    failedCount: agentIds.length,
    backgroundCount: 0,
    retryInputs: agentIds.map((agentId) => ({ serverId, agentId })),
  };
}

async function archiveAgentsOnServer(input: {
  serverId: string;
  agentIds: string[];
  queryClient: QueryClient;
  archiveMutateAsync: (value: ArchiveAgentInput) => Promise<{ archivedAt: string }>;
}): Promise<ArchiveAgentsOutcome> {
  const { serverId, queryClient, archiveMutateAsync } = input;
  const uniqueAgentIds = [...new Set(input.agentIds)];
  const client = resolveArchiveAgentClient({
    serverId,
    sessionClient: useSessionStore.getState().sessions[serverId]?.client ?? null,
    runtimeClient: getHostRuntimeStore().getClient(serverId),
  });
  if (!client) {
    return buildFailedOutcome(uniqueAgentIds, serverId);
  }

  await cancelArchivedAgentListQueries(queryClient, serverId);
  // Keep rows visible with a button spinner while the RPC is in flight. Only
  // hide after the daemon confirms (or a timeout is accepted as still-in-progress).
  for (const agentId of uniqueAgentIds) {
    setAgentArchiving({
      queryClient,
      serverId,
      agentId,
      isArchiving: true,
    });
  }

  try {
    // Prefer the batch close_items RPC (one round-trip) when available.
    // Fall back to sequential single archives if the client surface is
    // missing closeItems (older runtime / tests). Each fallback failure is
    // handled by its own mutation; keep archiving the rest.
    if (typeof client.closeItems !== "function") {
      let archivedCount = 0;
      const failedAgentIds: string[] = [];
      for (const agentId of uniqueAgentIds) {
        try {
          await archiveMutateAsync({ serverId, agentId });
          archivedCount += 1;
        } catch {
          failedAgentIds.push(agentId);
        }
      }
      return {
        archivedCount,
        failedCount: failedAgentIds.length,
        backgroundCount: 0,
        retryInputs: failedAgentIds.map((agentId) => ({ serverId, agentId })),
      };
    }

    const result = await client.closeItems({ agentIds: uniqueAgentIds });
    applyArchivedAgentCloseResults({
      queryClient,
      serverId,
      results: result.agents,
      invalidateQueries: false,
    });
    if (result.agents.length >= uniqueAgentIds.length) {
      return { ...EMPTY_ARCHIVE_AGENTS_OUTCOME, archivedCount: uniqueAgentIds.length };
    }
    const archivedIds = new Set(result.agents.map((entry) => entry.agentId));
    const missing = uniqueAgentIds.filter((agentId) => !archivedIds.has(agentId));
    return {
      archivedCount: result.agents.length,
      failedCount: missing.length,
      backgroundCount: 0,
      retryInputs: missing.map((agentId) => ({ serverId, agentId })),
    };
  } catch (error) {
    if (isArchiveTimeoutError(error)) {
      // Daemon is still processing. Hide the rows now and let refetch converge,
      // matching the single-agent timeout acceptance path.
      const archivedAt = new Date().toISOString();
      applyArchivedAgentCloseResults({
        queryClient,
        serverId,
        results: uniqueAgentIds.map((agentId) => ({ agentId, archivedAt })),
        invalidateQueries: false,
      });
      return { ...EMPTY_ARCHIVE_AGENTS_OUTCOME, backgroundCount: uniqueAgentIds.length };
    }
    return buildFailedOutcome(uniqueAgentIds, serverId);
  } finally {
    for (const agentId of uniqueAgentIds) {
      clearArchiveAgentPending({ queryClient, serverId, agentId });
    }
    void queryClient.invalidateQueries({ queryKey: ["sidebarAgentsList", serverId] });
    void queryClient.invalidateQueries({ queryKey: ["allAgents", serverId] });
    for (const queryKey of agentHistoryQueryKeys(serverId)) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }
}

/**
 * Reverts the optimistic archived state for agents whose archive failed:
 * clears `archivedAt` in the session store and removes them from the
 * suppressed set so they reappear in the sidebar.
 */
export function unmarkAgentArchivedInStore(input: {
  queryClient: QueryClient;
  serverId: string;
  agentIds: string[];
}): void {
  const { queryClient, serverId } = input;
  const uniqueAgentIds = [...new Set(input.agentIds)];
  if (uniqueAgentIds.length === 0) {
    return;
  }
  const setAgents = useSessionStore.getState().setAgents;
  setAgents(serverId, (prev) => {
    let changed = false;
    const next = new Map(prev);
    for (const agentId of uniqueAgentIds) {
      const existing = next.get(agentId);
      if (!existing?.archivedAt) {
        continue;
      }
      next.set(agentId, { ...existing, archivedAt: null });
      changed = true;
    }
    return changed ? next : prev;
  });
  for (const agentId of uniqueAgentIds) {
    setAgentArchiveSuppressed({
      queryClient,
      serverId,
      agentId,
      isArchiving: false,
    });
  }
}

export function setAgentArchiving(input: SetAgentArchivingInput): void {
  setArchiveAgentState({
    queryClient: input.queryClient,
    queryKey: ARCHIVE_AGENT_PENDING_QUERY_KEY,
    serverId: input.serverId,
    agentId: input.agentId,
    active: input.isArchiving,
  });
}

export function setAgentArchiveSuppressed(input: SetAgentArchivingInput): void {
  setArchiveAgentState({
    queryClient: input.queryClient,
    queryKey: ARCHIVE_AGENT_SUPPRESSED_QUERY_KEY,
    serverId: input.serverId,
    agentId: input.agentId,
    active: input.isArchiving,
  });
}

function setArchiveAgentState(input: {
  queryClient: QueryClient;
  queryKey: typeof ARCHIVE_AGENT_PENDING_QUERY_KEY | typeof ARCHIVE_AGENT_SUPPRESSED_QUERY_KEY;
  serverId: string;
  agentId: string;
  active: boolean;
}): void {
  const key = toArchiveKey(input);
  if (!key) {
    return;
  }

  input.queryClient.setQueryData<ArchiveAgentState>(input.queryKey, (current) => {
    const state: ArchiveAgentState = current ?? {};
    if (input.active) {
      if (state[key]) {
        return state;
      }
      return { ...state, [key]: true };
    }

    if (!state[key]) {
      return state;
    }

    const next = { ...state };
    delete next[key];
    return next;
  });
}

export function isAgentArchiving(input: IsAgentArchivingInput): boolean {
  const key = toArchiveKey(input);
  if (!key) {
    return false;
  }
  return readPendingState(input.queryClient)[key] ?? false;
}

export function isAgentArchiveSuppressed(input: IsAgentArchivingInput): boolean {
  const key = toArchiveKey(input);
  if (!key) {
    return false;
  }
  return readSuppressedState(input.queryClient)[key] ?? false;
}

export function removeAgentFromListPayload<T extends AgentsListQueryData | undefined>(
  payload: T,
  agentId: string,
): T {
  if (!payload || !Array.isArray(payload.entries) || !agentId) {
    return payload;
  }
  const filtered = payload.entries.filter((entry) => entry?.agent?.id !== agentId);
  if (filtered.length === payload.entries.length) {
    return payload;
  }
  return {
    ...payload,
    entries: filtered,
  } as T;
}

export function removeAgentFromCachedLists(
  queryClient: QueryClient,
  input: ArchiveAgentInput,
): void {
  const agentId = input.agentId.trim();
  if (!agentId) {
    return;
  }

  queryClient.setQueryData<AgentsListQueryData | undefined>(
    ["sidebarAgentsList", input.serverId],
    (current) => removeAgentFromListPayload(current, agentId),
  );
  queryClient.setQueryData<AgentsListQueryData | undefined>(
    ["allAgents", input.serverId],
    (current) => removeAgentFromListPayload(current, agentId),
  );
}

export function markAgentArchivedInHistoryPayload<T extends AgentHistoryQueryData | undefined>(
  payload: T,
  input: ArchiveAgentInput & { archivedAt: string },
): T {
  if (!payload || !Array.isArray(payload.pages) || !input.agentId) {
    return payload;
  }

  const archivedAt = new Date(input.archivedAt);
  if (Number.isNaN(archivedAt.getTime())) {
    return payload;
  }

  let changed = false;
  const pages = payload.pages.map((page) => {
    if (!Array.isArray(page.agents)) {
      return page;
    }

    let pageChanged = false;
    const agents = page.agents.map((agent) => {
      if (agent.id !== input.agentId) {
        return agent;
      }
      pageChanged = true;
      changed = true;
      return {
        ...agent,
        archivedAt,
      };
    });

    return pageChanged ? { ...page, agents } : page;
  });

  return changed ? ({ ...payload, pages } as T) : payload;
}

export function markAgentArchivedInHistoryCache(
  queryClient: QueryClient,
  input: ArchiveAgentInput & { archivedAt: string },
): void {
  for (const queryKey of agentHistoryQueryKeys(input.serverId)) {
    queryClient.setQueryData<AgentHistoryQueryData | undefined>(queryKey, (current) =>
      markAgentArchivedInHistoryPayload(current, input),
    );
  }
}

export function clearArchiveAgentPending(input: IsAgentArchivingInput): void {
  setAgentArchiving({
    ...input,
    isArchiving: false,
  });
}

export interface ArchivedAgentCloseResult {
  agentId: string;
  archivedAt: string;
}

async function cancelArchivedAgentListQueries(queryClient: QueryClient, serverId: string) {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: ["sidebarAgentsList", serverId] }),
    queryClient.cancelQueries({ queryKey: ["allAgents", serverId] }),
    ...agentHistoryQueryKeys(serverId).map((queryKey) => queryClient.cancelQueries({ queryKey })),
  ]);
}

function markAgentArchivedInStore(input: ArchiveAgentInput & { archivedAt: string }): void {
  const archivedAt = new Date(input.archivedAt);
  if (Number.isNaN(archivedAt.getTime())) {
    return;
  }

  const setAgents = useSessionStore.getState().setAgents;
  setAgents(input.serverId, (prev) => {
    const existing = prev.get(input.agentId);
    if (!existing) {
      return prev;
    }
    if (existing.archivedAt && existing.archivedAt.getTime() === archivedAt.getTime()) {
      return prev;
    }
    // Bump updatedAt to the archive time: authoritative snapshots (agent
    // updates, history/fetch responses) that were computed before the archive
    // carry an older updatedAt and are rejected by the store's staleness
    // guard instead of clobbering the optimistic archivedAt — which would
    // make an already-archived session flicker back into the list.
    const next = new Map(prev);
    next.set(input.agentId, {
      ...existing,
      archivedAt,
      updatedAt: archivedAt,
    });
    return next;
  });
}

interface ApplyArchivedAgentCloseResultsInput {
  queryClient: QueryClient;
  serverId: string;
  results: ArchivedAgentCloseResult[];
  invalidateQueries?: boolean;
}

export function applyArchivedAgentCloseResults(input: ApplyArchivedAgentCloseResultsInput): void {
  if (input.results.length === 0) {
    return;
  }

  for (const result of input.results) {
    useWorkspaceLayoutStore.getState().unpinAgentEverywhere(result.agentId);
    markAgentArchivedInStore({
      serverId: input.serverId,
      agentId: result.agentId,
      archivedAt: result.archivedAt,
    });
    removeAgentFromCachedLists(input.queryClient, {
      serverId: input.serverId,
      agentId: result.agentId,
    });
    markAgentArchivedInHistoryCache(input.queryClient, {
      serverId: input.serverId,
      agentId: result.agentId,
      archivedAt: result.archivedAt,
    });
    setAgentArchiveSuppressed({
      queryClient: input.queryClient,
      serverId: input.serverId,
      agentId: result.agentId,
      isArchiving: true,
    });
  }

  if (input.invalidateQueries ?? true) {
    void input.queryClient.invalidateQueries({
      queryKey: ["sidebarAgentsList", input.serverId],
    });
    void input.queryClient.invalidateQueries({
      queryKey: ["allAgents", input.serverId],
    });
    for (const queryKey of agentHistoryQueryKeys(input.serverId)) {
      void input.queryClient.invalidateQueries({ queryKey });
    }
  }
}

function useArchiveAgentPendingQuery() {
  return useQuery({
    queryKey: ARCHIVE_AGENT_PENDING_QUERY_KEY,
    queryFn: async (): Promise<ArchiveAgentPendingState> => ({}),
    initialData: {} as ArchiveAgentPendingState,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

function useArchiveAgentSuppressedQuery() {
  return useQuery({
    queryKey: ARCHIVE_AGENT_SUPPRESSED_QUERY_KEY,
    queryFn: async (): Promise<ArchiveAgentSuppressedState> => ({}),
    initialData: {} as ArchiveAgentSuppressedState,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function usePendingArchiveAgentIds(serverId: string): ReadonlySet<string> {
  const pendingQuery = useArchiveAgentPendingQuery();
  return useMemo(
    () => selectPendingArchiveAgentIds(pendingQuery.data ?? {}, serverId),
    [pendingQuery.data, serverId],
  );
}

/**
 * Agent ids that should stay hidden from active session lists after a confirmed
 * (or timeout-accepted) archive. Pending in-flight archives are intentionally
 * excluded so the row can remain visible with a button-level spinner instead of
 * vanishing and flashing the rest of the list.
 */
export function useSuppressedArchiveAgentIds(serverId: string): ReadonlySet<string> {
  const suppressedQuery = useArchiveAgentSuppressedQuery();
  return useMemo(
    () => selectSuppressedArchiveAgentIds(suppressedQuery.data ?? {}, serverId),
    [serverId, suppressedQuery.data],
  );
}

export function useArchiveAgent() {
  const queryClient = useQueryClient();

  const pendingQuery = useArchiveAgentPendingQuery();

  const archiveMutation = useMutation({
    mutationFn: async (input: ArchiveAgentInput): Promise<{ archivedAt: string }> => {
      const client = resolveArchiveAgentClient({
        serverId: input.serverId,
        sessionClient: useSessionStore.getState().sessions[input.serverId]?.client ?? null,
        runtimeClient: getHostRuntimeStore().getClient(input.serverId),
      });
      if (!client) {
        throw new Error("Daemon client not available");
      }
      try {
        return await client.archiveAgent(input.agentId);
      } catch (error) {
        if (isArchiveAgentNotFoundError(error)) {
          return { archivedAt: new Date().toISOString() };
        }
        if (isArchiveTimeoutError(error)) {
          // The daemon is still processing the archive; the authoritative
          // agent_update / revalidation will converge the store. Treating the
          // timeout as success keeps the optimistic removal in place instead
          // of rolling back and making the session reappear.
          return { archivedAt: new Date().toISOString() };
        }
        throw error;
      }
    },
    onMutate: async (input) => {
      await cancelArchivedAgentListQueries(queryClient, input.serverId);
      // Do not hide the row yet — leave it in place so the archive control can
      // show an in-button spinner. Confirmed archives apply in onSuccess.
      setAgentArchiving({
        queryClient,
        serverId: input.serverId,
        agentId: input.agentId,
        isArchiving: true,
      });
      return undefined;
    },
    onSuccess: (result, input) => {
      applyArchivedAgentCloseResults({
        queryClient,
        serverId: input.serverId,
        results: [{ agentId: input.agentId, archivedAt: result.archivedAt }],
        invalidateQueries: false,
      });
    },
    onSettled: (_result, _error, input) => {
      clearArchiveAgentPending({
        queryClient,
        serverId: input.serverId,
        agentId: input.agentId,
      });
      void queryClient.invalidateQueries({
        queryKey: ["sidebarAgentsList", input.serverId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["allAgents", input.serverId],
      });
      for (const queryKey of agentHistoryQueryKeys(input.serverId)) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  const archiveMutateAsync = archiveMutation.mutateAsync;

  const archiveAgent = useCallback(
    async (input: ArchiveAgentInput): Promise<void> => {
      await archiveMutateAsync(input);
    },
    [archiveMutateAsync],
  );

  const archiveAgents = useCallback(
    async (inputs: ArchiveAgentInput[]): Promise<ArchiveAgentsOutcome> => {
      if (inputs.length === 0) {
        return EMPTY_ARCHIVE_AGENTS_OUTCOME;
      }
      if (inputs.length === 1) {
        try {
          await archiveMutateAsync(inputs[0]!);
          return { ...EMPTY_ARCHIVE_AGENTS_OUTCOME, archivedCount: 1 };
        } catch {
          return buildFailedOutcome([inputs[0]!.agentId], inputs[0]!.serverId);
        }
      }

      // Group by server so we can issue one close_items_request per host.
      // Parallel single-agent archive RPCs routinely exceed the 10s client
      // timeout under load (daemon logs show 10–12s per archive_agent_request
      // with peakInflightRequests ~15), causing optimistic removals to roll
      // back and already-archived sessions to reappear.
      const byServer = groupArchiveInputsByServer(inputs);
      let outcome: ArchiveAgentsOutcome = EMPTY_ARCHIVE_AGENTS_OUTCOME;
      for (const [serverId, agentIds] of byServer) {
        const serverOutcome = await archiveAgentsOnServer({
          serverId,
          agentIds,
          queryClient,
          archiveMutateAsync,
        });
        outcome = addArchiveOutcomes(outcome, serverOutcome);
      }
      return outcome;
    },
    [archiveMutateAsync, queryClient],
  );

  const isArchivingAgent = useCallback(
    (input: ArchiveAgentInput): boolean => {
      const key = toArchiveKey(input);
      if (!key) {
        return false;
      }
      return (pendingQuery.data ?? {})[key] ?? false;
    },
    [pendingQuery.data],
  );

  return {
    archiveAgent,
    archiveAgents,
    isArchivingAgent,
  };
}
