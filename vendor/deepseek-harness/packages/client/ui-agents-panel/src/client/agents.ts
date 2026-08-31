import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState, SubagentCatalogSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
/** One current-session subagent row derived from the existing snapshot. */
export interface AgentRow {
  id: SessionId
  label: string
  activity: 'running' | 'inactive'
  mode?: 'one-shot' | 'continuable'
}

function fromCatalog(
  catalog: SubagentCatalogSnapshot,
  byId: SessionListState['byId'],
): AgentRow[] {
  const rows: AgentRow[] = []
  for (const entry of catalog.entries) {
    if (entry.kind !== 'child') continue
    const summary = byId[entry.id]
    const labeled = 'label' in entry ? entry.label : undefined
    rows.push({
      id: entry.id,
      label: labeled && labeled.length > 0 ? labeled : summary?.displayTitle ?? String(entry.id),
      activity: entry.activity,
      mode: entry.mode,
    })
  }
  return rows
}

function fromLineage(parent: SessionId, state: SessionListState): AgentRow[] {
  return Object.values(state.byId)
    .filter(child => child.parentId === parent)
    .map(child => ({
      id: child.id,
      label: child.displayTitle,
      activity: child.running ? 'running' as const : 'inactive' as const,
    }))
}

/**
 * List current-session subagents from the existing session snapshot.
 * Prefers `subagentsByParent`; falls back to `byId` children of the parent.
 * @param state - live session list snapshot.
 * @param sessionId - surfaces session, or the list's current id.
 * @returns rows in catalog / list order; empty when none.
 */
export function listSessionAgents(state: SessionListState, sessionId: SessionId | undefined): AgentRow[] {
  const parent = sessionId ?? state.current
  if (parent === undefined) return []
  const catalog = state.subagentsByParent[parent]
  if (catalog !== undefined) return fromCatalog(catalog, state.byId)
  return fromLineage(parent, state)
}
