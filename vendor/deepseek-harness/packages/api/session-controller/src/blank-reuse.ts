/** Pure eligibility rules for reusing an otherwise blank Session. */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence'

// These optional domains can persist work before opening a turn. Compare their
// event names without loading a goal/schedule plugin to inspect a cold Session.
const PRETURN_WORK_EVENTS: ReadonlySet<string> = new Set(['goal/change', 'schedule/change'])

/** Capture an attached Session at one point in time without activating or writing it. */
export function inspectAttachedSession(session: Pick<Session, 'header' | 'inheritedEventCount' | 'snapshotEvents'>): SessionInspection {
  return {
    meta: session.header,
    inheritedEventCount: session.inheritedEventCount,
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    events: session.snapshotEvents(),
  }
}

/**
 * Decide whether a complete cold or attached inspection is still an ordinary
 * blank Session that navigation may reuse.
 *
 * The summary `blank` bit deliberately is not used here. A title or a
 * presentation release leaves the Session list blank while still making the
 * identity unsuitable for reuse by a different conversation owner.
 */
export function canReuseBlankInspection(inspection: SessionInspection): boolean {
  const { meta } = inspection
  if (meta.parentSession !== undefined || meta.isSeeded || Number(inspection.inheritedEventCount) > 0) return false
  if (meta.origin === 'subagent') return false

  for (const event of inspection.events as readonly SessionEvent[]) {
    if (PRETURN_WORK_EVENTS.has(event.type)) return false
    switch (event.type) {
      case 'agent/inbox/spliced':
        if (event.data.inserted.length > 0) return false
        break
      case 'turn/start':
      case 'session/title':
      case 'user/message':
      case 'assistant/message':
      case 'system/message':
      case 'tool/result':
        return false
      case 'session/presentation':
        // A null release is harmless only when no non-null presentation ever
        // appeared. Any non-null record is sticky by definition, even if the
        // latest summary has since folded it away.
        if (event.data !== null) return false
        break
      default:
        break
    }
  }
  return true
}
