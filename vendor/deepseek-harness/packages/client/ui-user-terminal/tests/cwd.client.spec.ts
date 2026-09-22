import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { cwdFromSessions } from '../src/client/cwd.ts'

const MAIN = 'session-main' as SessionId
const BACKGROUND = 'session-background' as SessionId

function sessions(mainViewId: SessionId | undefined): SessionListState {
  return {
    ids: [MAIN, BACKGROUND],
    byId: {
      [MAIN]: {
        id: MAIN,
        displayTitle: 'main',
        running: false,
        blank: false,
        retainedBy: mainViewId === MAIN ? { mainView: 1 } : {},
        updatedAt: 1,
        cwd: '/work/main',
      },
      [BACKGROUND]: {
        id: BACKGROUND,
        displayTitle: 'background',
        running: false,
        blank: false,
        retainedBy: {},
        updatedAt: 1,
        cwd: '/work/background',
      },
    },
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
  }
}

describe('cwdFromSessions', () => {
  it('resolves the main-view workspace without selecting a background session', () => {
    expect(cwdFromSessions(undefined, sessions(MAIN))).toBe('/work/main')
  })

  it('returns undefined after the main-view reference is released', () => {
    expect(cwdFromSessions(undefined, sessions(undefined))).toBeUndefined()
  })

  it('preserves an explicit session fallback for an occupied terminal', () => {
    expect(cwdFromSessions(BACKGROUND, sessions(undefined))).toBe('/work/background')
  })
})
