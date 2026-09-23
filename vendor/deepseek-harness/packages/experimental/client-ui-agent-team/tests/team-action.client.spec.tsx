// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  TeamTaskId, TeamTaskView as TeamTask, TeamView,
} from '@deepseek-ai/dsh-experimental-agent-team/client'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import {
  TeamAction, type TeamActionInjected, type TeamActionProps, type TeamActionResult,
} from '../src/client/TeamAction.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const SESSION = 'lead' as SessionId
const TASK_1 = 'task-1' as TeamTaskId
const task: TeamTask = {
  id: TASK_1,
  revision: 1,
  subject: 'Implement runtime',
  description: 'Build the Team runtime',
  status: 'in_progress',
  ownerName: 'lead',
  blockedBy: [],
  writeScopes: ['src'],
  ready: false,
  writeScopeWarnings: ['write scopes overlap with task-2'],
}
const view: TeamView = {
  members: [
    { id: SESSION, name: 'lead', role: 'lead', status: 'inactive', model: 'model-a', diagnostics: [] },
    {
      id: 'worker-id' as SessionId,
      name: 'worker',
      role: 'teammate',
      status: 'inactive',
      model: 'model-a',
      diagnostics: [],
    },
  ],
  tasks: [task],
}

function remoteFailure(message: string): TeamActionResult<never> {
  return { ok: false, error: new RemoteError('gateway/internal', message, {}) }
}

function props(actions: TeamActionInjected, sessionId: SessionId = SESSION): TeamActionProps {
  return {
    sessionId,
    ...actions,
    t: makeTranslate(zh, commonZh),
  } as unknown as TeamActionProps
}

function actions(overrides: Partial<TeamActionInjected> = {}): TeamActionInjected {
  return {
    load: () => Promise.resolve({ ok: true, value: view }),
    openTeammate: () => {},
    ...overrides,
  }
}

describe('TeamAction', () => {
  it('ignores a stale Team load after the conversation switches sessions', async () => {
    const nextSession = 'next-lead' as SessionId
    const firstLoad = Promise.withResolvers<{ ok: true; value: TeamView }>()
    const nextView: TeamView = {
      ...view,
      members: [{ id: nextSession, name: 'lead', role: 'lead', status: 'inactive', diagnostics: [] }],
      tasks: [{ ...task, id: 'task-next' as TeamTaskId, subject: 'Next session task' }],
    }
    const load = vi.fn((sessionId: SessionId) => sessionId === SESSION
      ? firstLoad.promise
      : Promise.resolve({ ok: true as const, value: nextView }))
    const injected = actions({ load })
    const rendered = render(<TeamAction {...props(injected)} />)
    fireEvent.click(screen.getByRole('button', { name: /Agent Team/u }))
    await waitFor(() => { expect(load).toHaveBeenCalledWith(SESSION) })

    rendered.rerender(<TeamAction {...props(injected, nextSession)} />)
    fireEvent.click(screen.getByRole('button', { name: /Agent Team/u }))
    expect(await screen.findByText('Next session task')).toBeTruthy()
    firstLoad.resolve({ ok: true, value: view })
    await Promise.resolve()

    await waitFor(() => {
      expect(screen.getByText('Next session task')).toBeTruthy()
      expect(screen.queryByText('Implement runtime')).toBeNull()
    })
  })

  it('loads roster/task diagnostics on open and navigates a healthy teammate', async () => {
    const openTeammate = vi.fn()
    render(<TeamAction {...props(actions({ openTeammate }))} />)
    fireEvent.click(screen.getByRole('button', { name: /Agent Team/u }))
    const worker = await screen.findByRole('button', { name: /worker/u })
    expect(screen.getByText('write scopes overlap with task-2')).toBeTruthy()
    fireEvent.click(worker)
    await waitFor(() => { expect(openTeammate).toHaveBeenCalledWith(SESSION, view.members[1]) })
  })

  it('keeps only the newest overlapping refresh for one session', async () => {
    const older = Promise.withResolvers<TeamActionResult<TeamView>>()
    const newer = Promise.withResolvers<TeamActionResult<TeamView>>()
    const newestView = {
      ...view,
      tasks: [{ ...task, id: 'newest-task' as TeamTaskId, subject: 'Newest task' }],
    }
    const load = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: view })
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)
    render(<TeamAction {...props(actions({ load }))} />)
    fireEvent.click(screen.getByRole('button', { name: /Agent Team/u }))
    await screen.findByText('Implement runtime')

    const refresh = screen.getByRole('button', { name: zh.refresh })
    fireEvent.click(refresh)
    expect(screen.getByRole('status', { name: zh.loading })).toBeTruthy()
    fireEvent.click(refresh)
    newer.resolve({ ok: true, value: newestView })
    expect(await screen.findByText('Newest task')).toBeTruthy()
    older.resolve({ ok: true, value: view })
    await Promise.resolve()

    expect(screen.getByText('Newest task')).toBeTruthy()
    expect(screen.queryByText('Implement runtime')).toBeNull()
  })

  it('renders roster/task state variants and contains navigation, refresh, and close actions', async () => {
    const { ownerName: _ownerName, ...unownedTask } = task
    const richView: TeamView = {
      ...view,
      members: [
        view.members[0]!,
        { ...view.members[1]!, status: 'running' },
        {
          id: 'failed-id' as SessionId,
          name: 'failed-worker',
          role: 'teammate',
          status: 'failed',
          diagnostics: ['provider failed'],
        },
        {
          id: 'provisioning-id' as SessionId,
          name: 'provisioning-worker',
          role: 'teammate',
          status: 'provisioning',
          diagnostics: [],
        },
      ],
      tasks: [
        { ...unownedTask, id: 'ready-task' as TeamTaskId, status: 'pending', ready: true },
        { ...unownedTask, id: 'blocked-task' as TeamTaskId, status: 'pending', ready: false, blockedBy: [TASK_1] },
        { ...task, id: 'completed-task' as TeamTaskId, status: 'completed' },
      ],
    }
    const load = vi.fn(() => Promise.resolve({ ok: true as const, value: richView }))
    const openTeammate = vi.fn(() => { throw new Error('navigation failed') })
    render(<TeamAction {...props(actions({ load, openTeammate }))} />)
    fireEvent.click(screen.getByRole('button', { name: /Agent Team/u }))
    expect(await screen.findByText('provider failed')).toBeTruthy()
    expect(screen.getByText(zh.ready)).toBeTruthy()
    expect(screen.getByText(zh.blocked)).toBeTruthy()
    const failedMember = screen.getByRole<HTMLButtonElement>('button', { name: /failed-worker/u })
    const provisioningMember = screen.getByRole<HTMLButtonElement>('button', { name: /provisioning-worker/u })
    expect(failedMember.disabled).toBe(true)
    expect(failedMember.querySelector('[data-state="error"]')).not.toBeNull()
    expect(provisioningMember.disabled).toBe(true)
    expect(provisioningMember.querySelector('[data-state="ongoing"]')).not.toBeNull()
    const tasks = [...document.querySelectorAll('article')]
    expect(tasks.map(card => card.querySelector('[data-state]')?.getAttribute('data-state')))
      .toEqual(['idle', 'warning', 'done'])

    fireEvent.click(screen.getByRole('button', { name: /^worker运行中/u }))
    expect(await screen.findByText('Error: navigation failed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.refresh }))
    await waitFor(() => { expect(load).toHaveBeenCalledTimes(2) })
    fireEvent.click(screen.getByRole('button', { name: /Agent Team/u }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Agent Team/u }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: zh.close }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Agent Team/u }))
  })

  it('shows load failures', async () => {
    render(<TeamAction {...props(actions({
      load: () => Promise.resolve(remoteFailure('load failed')),
    }))} />)
    fireEvent.click(screen.getByRole('button', { name: /Agent Team/u }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'load failed (gateway/internal)')
  })

  it('shows an empty task board without a create action', async () => {
    render(<TeamAction {...props(actions({
      load: () => Promise.resolve({ ok: true, value: { members: [], tasks: [] } }),
    }))} />)
    fireEvent.click(screen.getByRole('button', { name: /Agent Team/u }))
    expect(await screen.findByText(zh.empty)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /新建任务/u })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('displays task ownership and status without mutation controls', async () => {
    const { ownerName: _ownerName, ...unowned } = task
    const tasks: TeamTask[] = [
      { ...unowned, status: 'pending', ready: true },
      { ...task, id: 'task-2' as TeamTaskId },
      { ...task, id: 'task-3' as TeamTaskId, status: 'completed', ownerName: 'worker' },
    ]
    render(<TeamAction {...props(actions({
      load: () => Promise.resolve({ ok: true, value: { ...view, tasks } }),
    }))} />)
    fireEvent.click(screen.getByRole('button', { name: /Agent Team/u }))
    await screen.findAllByRole('article')
    expect(screen.getByText('Owner: 未分配')).toBeTruthy()
    expect(screen.getByText('Owner: lead')).toBeTruthy()
    expect(screen.getByText('Owner: worker')).toBeTruthy()
    expect(screen.getByText(zh['status.pending'])).toBeTruthy()
    expect(screen.getByText(zh['status.in_progress'])).toBeTruthy()
    expect(screen.getByText(zh['status.completed'])).toBeTruthy()
    expect(screen.queryByRole('button', { name: /新建任务|编辑|完成|重开|删除/u })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    for (const card of screen.getAllByRole('article')) {
      expect(card.querySelector('button, input, select, textarea')).toBeNull()
    }
  })
  it('keeps panel interactions open and dismisses on outside pointer or Escape', async () => {
    const rendered = render(<TeamAction {...props(actions())} />)
    const trigger = screen.getByRole('button', { name: /Agent Team/u })
    fireEvent.click(trigger)
    const panel = await screen.findByRole('dialog')
    expect(rendered.container.contains(panel)).toBe(false)
    expect(document.activeElement).toBe(panel)
    fireEvent.pointerDown(panel)
    expect(screen.getByRole('dialog')).toBe(panel)
    fireEvent.pointerDown(trigger)
    expect(screen.getByRole('dialog')).toBe(panel)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(trigger)
    await screen.findByText('Implement runtime')
    fireEvent.keyDown(screen.getByRole('button', { name: zh.refresh }), { key: 'Enter' })
    expect(screen.queryByRole('dialog')).not.toBeNull()
    fireEvent.keyDown(screen.getByRole('button', { name: zh.refresh }), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps focus within the trigger or panel and closes when focus moves elsewhere', async () => {
    render(<><TeamAction {...props(actions())} /><button>Outside</button></>)
    const trigger = screen.getByRole('button', { name: /Agent Team/u })
    fireEvent.click(trigger)
    const panel = await screen.findByRole('dialog')
    fireEvent.blur(panel, { relatedTarget: screen.getByRole('button', { name: zh.refresh }) })
    expect(screen.getByRole('dialog')).toBe(panel)
    fireEvent.blur(panel, { relatedTarget: trigger })
    expect(screen.getByRole('dialog')).toBe(panel)
    fireEvent.blur(panel, { relatedTarget: null })
    expect(screen.getByRole('dialog')).toBe(panel)
    fireEvent.blur(panel, { relatedTarget: screen.getByRole('button', { name: 'Outside' }) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

})
