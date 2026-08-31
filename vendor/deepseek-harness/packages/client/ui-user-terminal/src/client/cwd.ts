import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
/**
 * Resolve the project cwd for a session-maybe occupant.
 * Prefer the slot's sessionId; otherwise use the current session list entry.
 * @param sessionId - framework session id when a session is current.
 * @param list - global session list snapshot.
 * @returns a non-empty cwd, or undefined when no project is selected.
 */
export function cwdFromSessions(
  sessionId: SessionId | undefined,
  list: SessionListState,
): string | undefined {
  const id = sessionId ?? list.current
  const next = id === undefined ? undefined : list.byId[id]?.cwd
  return next ? next : undefined
}
