/** Subagent consumption folded into the composer's session-cost strip.
 *
 * A delegated subagent runs in its own Session, so its samples land in the
 * CHILD's `billedUsage`; a figure that reads only the current Session's
 * projection undercounts every delegation. The child's usage is read from the
 * Session list rows (`byId[row].projectionValues.billedUsage`): the Session
 * Controller already keeps every listed Session's current projection values
 * there — list hints plus the host-wide control frames carry them for sessions
 * this client never opened — so a new child sample moves the strip through the
 * same store notification, with no cross-Session subscription and no host
 * change. Nothing here depends on the subagent plugin: delegation is expressed
 * by the list's own `origin`/`parentId` row fields, and a program without that
 * plugin simply has no such rows. A child whose `billedUsage` value has not
 * arrived yet is reported with no usage and contributes nothing to the total.
 *
 * @module subagent-cost
 */

import type { SessionListState, SessionProjectionMap } from '@deepseek-ai/dsh-api-session-controller/client'
import type { BilledUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One subagent descendant of the current Session, with the usage it billed. */
export interface SubagentCostSource {
  /** Child Session the tokens were billed in. */
  readonly sessionId: SessionId
  /**
   * Human name of the child: the parent's catalog label for it when that
   * catalog has loaded, otherwise the list row's display title.
   */
  readonly label: string
  /**
   * The child's billed usage, or undefined while its projection value has not
   * arrived (the child then adds no cost rather than a guessed zero).
   */
  readonly usage: BilledUsageProjection | undefined
}

/**
 * Every subagent descendant of one Session, nearest first, each with its own
 * billed usage. Delegation nests — a child may delegate again — so the walk
 * repeats over each discovered child as a parent, and a cycle (which the list
 * may transiently hold while rows merge) stops at the first revisit.
 * @param current - the selected Session; undefined without a selection.
 * @param list - the sessions list state the standard `useSessions` seat reads.
 * @returns one source per descendant, in list order per parent.
 */
export function subagentCostSources(
  current: SessionId | undefined,
  list: SessionListState,
): readonly SubagentCostSource[] {
  if (current === undefined) return []
  const sources: SubagentCostSource[] = []
  const seen = new Set<SessionId>([current])
  let frontier: readonly SessionId[] = [current]
  while (frontier.length > 0) {
    const next: SessionId[] = []
    for (const parent of frontier) {
      const catalog = list.projectionsBySession[parent]?.values.subagentCatalog
      for (const row of Object.values(list.byId)) {
        if (row.origin !== 'subagent' || row.parentId !== parent || seen.has(row.id)) continue
        seen.add(row.id)
        sources.push({
          sessionId: row.id,
          label: catalogLabel(catalog, row.id) ?? row.displayTitle,
          usage: row.projectionValues?.billedUsage,
        })
        next.push(row.id)
      }
    }
    frontier = next
  }
  return sources
}

/**
 * The loaded catalog's label for one direct child. The catalog is fetched only
 * while some UI observes it, so absence is ordinary and the caller falls back
 * to the list row's own display title.
 * @param catalog - the parent's catalog snapshot, absent until a read succeeds.
 * @param childId - the child row to name.
 * @returns the creation label, or undefined when there is none to read.
 */
function catalogLabel(
  catalog: SessionProjectionMap['subagentCatalog'] | undefined,
  childId: SessionId,
): string | undefined {
  return catalog?.find(candidate => candidate.id === childId)?.label
}
