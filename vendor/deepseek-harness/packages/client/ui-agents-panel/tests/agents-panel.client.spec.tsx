// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState, SubagentCatalogSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { AgentsPanelProps } from '../src/client/AgentsPanel.tsx'
import { AgentsPanel } from '../src/client/AgentsPanel.tsx'
import { en } from '../src/client/locales.ts'

const t: AgentsPanelProps['t'] = key => (en as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('agents must not read this hook') }) as never
const PARENT = 'session-parent' as SessionId
const CHILD = 'session-child' as SessionId

function sessionList(opts: {
  catalog?: SubagentCatalogSnapshot
  childInList?: boolean
}): SessionListState {
  return {
    ids: [PARENT],
    byId: {
      [PARENT]: {
        id: PARENT,
        displayTitle: 'root',
        running: true,
        blank: false,
        updatedAt: 1,
      },
      ...(opts.childInList === true
        ? {
          [CHILD]: {
            id: CHILD,
            displayTitle: 'writer',
            running: true,
            blank: false,
            updatedAt: 2,
            parentId: PARENT,
            origin: 'subagent' as const,
          },
        }
        : {}),
    },
    current: PARENT,
    phase: 'ready',
    subagentsByParent: opts.catalog === undefined ? {} : { [PARENT]: opts.catalog },
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function mount(state: SessionListState, openAgent = () => {}) {
  render(
    <AgentsPanel {...({
      sessionId: PARENT,
      useSession: neverHook,
      useSessions: (sel: (s: SessionListState) => unknown) => sel(state),
      useWorkspaces: neverHook,
      useProjection: neverHook,
      openAgent,
      t,
    } as unknown as AgentsPanelProps)} />,
  )
}

afterEach(cleanup)

describe('AgentsPanel', () => {
  it('shows the empty state when the session has no subagents', () => {
    mount(sessionList({}))
    expect(screen.getByText('No agents yet')).toBeTruthy()
    expect(screen.getByText('When this session spawns subagents, they show up here.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Agents' })).toBeNull()
    expect(screen.queryByText('writer')).toBeNull()
  })

  it('lists catalog children with label and activity', () => {
    mount(sessionList({
      catalog: {
        entries: [{
          kind: 'child',
          id: CHILD,
          activity: 'running',
          hasChildren: false,
          mode: 'continuable',
          label: 'writer',
        }],
        parentAvailable: true,
        state: 'ready',
        error: null,
      },
    }))
    expect(screen.getByText('writer')).toBeTruthy()
    expect(screen.getByText(/running/)).toBeTruthy()
    expect(screen.queryByText('No agents yet')).toBeNull()
  })

  it('lists byId children when the catalog is absent', () => {
    mount(sessionList({ childInList: true }))
    expect(screen.getByText('writer')).toBeTruthy()
    expect(screen.getByText('running')).toBeTruthy()
  })

  it('opens a catalog child when the row is clicked', () => {
    const openAgent = vi.fn()
    mount(sessionList({
      catalog: {
        entries: [{
          kind: 'child',
          id: CHILD,
          activity: 'running',
          hasChildren: false,
          mode: 'continuable',
          label: 'writer',
        }],
        parentAvailable: true,
        state: 'ready',
        error: null,
      },
    }), openAgent)
    fireEvent.click(screen.getByRole('button', { name: /writer/ }))
    expect(openAgent).toHaveBeenCalledWith(CHILD)
  })

  it('lists background jobs for the session', () => {
    const state = sessionList({ childInList: true })
    state.jobsBySession = {
      [PARENT]: [{
        id: 'bash-1' as never,
        kind: 'bash',
        label: 'sleep 2',
        status: 'running',
        startedAt: 1,
      }],
    }
    mount(state)
    expect(screen.getByText('Background jobs')).toBeTruthy()
    expect(screen.getByText('sleep 2')).toBeTruthy()
    expect(screen.getAllByText('running').length).toBeGreaterThan(0)
  })

  it('shows inactive one-shot rows and job detail', () => {
    const state = sessionList({
      catalog: {
        entries: [{
          kind: 'child',
          id: CHILD,
          activity: 'inactive',
          hasChildren: false,
          mode: 'one-shot',
          label: 'once',
        }],
        parentAvailable: true,
        state: 'ready',
        error: null,
      },
    })
    state.jobsBySession = {
      [PARENT]: [{
        id: 'bash-2' as never,
        kind: 'bash',
        label: 'echo',
        status: 'completed',
        startedAt: 1,
        detail: 'exit 0',
      }],
    }
    mount(state)
    expect(screen.getByText('once')).toBeTruthy()
    expect(screen.getByText(/not running/)).toBeTruthy()
    expect(screen.getByText(/one-shot/)).toBeTruthy()
    expect(screen.getByText(/exit 0/)).toBeTruthy()
  })

  it('renders job status through the locale table, not the raw enum', () => {
    const state = sessionList({})
    state.jobsBySession = {
      [PARENT]: [{
        id: 'bash-3' as never,
        kind: 'bash',
        label: 'pnpm test',
        status: 'failed',
        startedAt: 1,
      }],
    }
    const localized: AgentsPanelProps['t'] = (key) => (
      key === 'jobs.status.failed' ? '失败' : ((en as Record<string, string>)[key] ?? key)
    )
    render(
      <AgentsPanel {...({
        sessionId: PARENT,
        useSession: neverHook,
        useSessions: (sel: (s: SessionListState) => unknown) => sel(state),
        useWorkspaces: neverHook,
        useProjection: neverHook,
        openAgent: () => {},
        t: localized,
      } as unknown as AgentsPanelProps)} />,
    )
    expect(screen.getByText('失败')).toBeTruthy()
    expect(screen.queryByText('failed')).toBeNull()
  })

  it('lists no jobs when the session id cannot be resolved', () => {
    const state = sessionList({})
    state.current = undefined
    render(
      <AgentsPanel {...({
        sessionId: undefined,
        useSession: neverHook,
        useSessions: (sel: (s: SessionListState) => unknown) => sel(state),
        useWorkspaces: neverHook,
        useProjection: neverHook,
        openAgent: () => {},
        t,
      } as unknown as AgentsPanelProps)} />,
    )
    expect(screen.getByText('No agents yet')).toBeTruthy()
    expect(screen.queryByText('Background jobs')).toBeNull()
  })
})
