/**
 * listSessionAgents: catalog skip, label fallbacks, lineage, empty parent.
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { listSessionAgents } from '../src/client/agents.ts'

const PARENT = 'parent' as SessionId
const CHILD = 'child' as SessionId

function emptyState(overrides: Partial<SessionListState> = {}): SessionListState {
  return {
    ids: [],
    byId: {},
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
    ...overrides,
  }
}

describe('listSessionAgents', () => {
  it('returns empty when no parent can be resolved', () => {
    expect(listSessionAgents(emptyState(), undefined)).toEqual([])
  })

  it('uses the list current id when sessionId is omitted', () => {
    const state = emptyState({
      current: PARENT,
      byId: {
        [CHILD]: {
          id: CHILD,
          displayTitle: 'writer',
          running: false,
          blank: false,
          updatedAt: 1,
          parentId: PARENT,
        },
      },
    })
    expect(listSessionAgents(state, undefined)).toEqual([
      { id: CHILD, label: 'writer', activity: 'inactive' },
    ])
  })

  it('skips non-child catalog entries and falls back for blank labels', () => {
    const state = emptyState({
      subagentsByParent: {
        [PARENT]: {
          entries: [
            { kind: 'diagnostic', id: PARENT, reason: 'unavailable' },
            { kind: 'child', id: CHILD, activity: 'inactive', hasChildren: false, mode: 'continuable', label: '' },
            {
              kind: 'child',
              id: 'orphan' as SessionId,
              activity: 'running',
              hasChildren: false,
              mode: 'one-shot',
            },
          ],
          parentAvailable: true,
          state: 'ready',
          error: null,
        },
      },
    })
    expect(listSessionAgents(state, PARENT)).toEqual([
      { id: CHILD, label: String(CHILD), activity: 'inactive', mode: 'continuable' },
      { id: 'orphan' as SessionId, label: 'orphan', activity: 'running', mode: 'one-shot' },
    ])
  })
})
