// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { OpenInAppAction, type OpenInAppActionProps } from '../src/client/OpenInAppAction.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const SESSION = 'session' as SessionId
const t: OpenInAppActionProps['t'] = makeTranslate(zh)

interface Bench {
  props: OpenInAppActionProps
  launch: ReturnType<typeof vi.fn>
  choose: ReturnType<typeof vi.fn>
}

function bench(over: {
  apps?: readonly string[] | null
  choice?: string
  cwd?: string
  launch?: (appId: string, path: string) => Promise<void>
} = {}): Bench {
  const state: SessionListState = {
    ids: [SESSION],
    byId: over.cwd === undefined ? {} : { [SESSION]: { id: SESSION, displayTitle: 'Workspace', cwd: over.cwd, running: false, retainedBy: {}, blank: false, updatedAt: 0 } },
    phase: 'ready',
    projectionsBySession: {},
  }
  const apps = createSnapshotStore<readonly string[] | null>(over.apps ?? null)
  const choice = createSnapshotStore<string>(over.choice ?? '')
  const launch = vi.fn(over.launch ?? (async () => {}))
  const choose = vi.fn()
  function useSessions<T>(select: (snapshot: SessionListState) => T): T {
    return select(state)
  }
  function useSelector<T, R>(source: { getSnapshot(): T }): (select: (value: T) => R) => R {
    return select => select(source.getSnapshot())
  }
  const props = {
    sessionId: SESSION,
    useSessions,
    useOpenInAppApps: useSelector(apps),
    useOpenInAppChoice: useSelector(choice),
    launch,
    choose,
    iconUrl: (appId: string) => `open-in-app/icon/${appId}`,
    t,
  } as OpenInAppActionProps
  return { props, launch, choose }
}

describe('OpenInAppAction visibility', () => {
  it('renders nothing before availability arrives, with no apps, without a cwd, and for unnameable ids', () => {
    for (const over of [
      { apps: null, cwd: '/w' },
      { apps: [], cwd: '/w' },
      { apps: [], choice: 'vscode', cwd: '/w' },
      { apps: ['finder'] },
      { apps: ['finder'], cwd: '' },
      { apps: ['someday-an-app'], cwd: '/w' },
    ] as const) {
      const { container } = render(<OpenInAppAction {...bench(over).props} />)
      expect(container.innerHTML).toBe('')
      cleanup()
    }
  })

  it('shows the remembered choice, falling back to the first available app when it is gone', () => {
    render(<OpenInAppAction {...bench({ apps: ['finder', 'cursor'], choice: 'cursor', cwd: '/w' }).props} />)
    expect(screen.getByRole('button', { name: t('open.title', { app: 'Cursor' }) }).querySelector('img')?.getAttribute('src')).toBe('open-in-app/icon/cursor')
    cleanup()

    render(<OpenInAppAction {...bench({ apps: ['finder', 'cursor'], choice: 'vscode', cwd: '/w' }).props} />)
    expect(screen.getByRole('button', { name: t('open.title', { app: zh['app.finder'] }) }).querySelector('img')?.getAttribute('src')).toBe('open-in-app/icon/finder')
  })
})

describe('OpenInAppAction launching', () => {
  it('disables both buttons and ignores duplicate gestures until the launch settles', async () => {
    const pending = Promise.withResolvers<undefined>()
    const b = bench({ apps: ['finder', 'cursor'], cwd: '/w/dir', launch: () => pending.promise })
    const view = render(<OpenInAppAction {...b.props} />)
    const main = screen.getByRole('button', { name: t('open.title', { app: zh['app.finder'] }) })
    fireEvent.click(main)
    expect(main).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: zh['path.more'] })).toHaveProperty('disabled', true)
    fireEvent.click(main)
    expect(b.launch).toHaveBeenCalledOnce()
    expect(view.container.querySelector('[data-open-target]')?.getAttribute('data-state')).toBe('busy')
    await act(async () => { pending.resolve(undefined) })
    expect(main).toHaveProperty('disabled', false)
  })

  it('announces launch failure without changing the remembered application', async () => {
    const b = bench({ apps: ['finder', 'cursor'], cwd: '/w', launch: async () => { throw new Error('gone') } })
    render(<OpenInAppAction {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: zh['path.more'] }))
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Cursor' })) })
    expect(screen.getByRole('alert').textContent).toContain(zh['path.openError'])
    expect(b.choose).not.toHaveBeenCalled()
  })

  it('lists only applications, marks the remembered default, and remembers a successful choice', async () => {
    const b = bench({ apps: ['finder', 'cursor', 'terminal'], cwd: '/w/dir' })
    render(<OpenInAppAction {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: zh['path.more'] }))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['访达（默认）', 'Cursor', '终端'])
    expect(screen.queryByText(zh['path.reveal'])).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Cursor' })) })
    expect(b.launch).toHaveBeenCalledWith('cursor', '/w/dir')
    expect(b.choose).toHaveBeenCalledWith('cursor')
  })

  it('closes on Escape without launching and falls back after an icon fails', async () => {
    const b = bench({ apps: ['finder', 'terminal'], cwd: '/w' })
    const view = render(<OpenInAppAction {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: zh['path.more'] }))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(b.launch).not.toHaveBeenCalled()
    const image = view.container.querySelector('img')!
    fireEvent.error(image)
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.querySelector('svg')).not.toBeNull()
  })

  it('names the selected application in the tooltip', async () => {
    render(<OpenInAppAction {...bench({ apps: ['finder'], cwd: '/w' }).props} />)
    fireEvent.mouseEnter(screen.getByRole('button', { name: t('open.title', { app: zh['app.finder'] }) }))
    expect(await screen.findByText(t('open.title', { app: zh['app.finder'] }))).toBeTruthy()
  })
})


it('omits the dropdown when only one directory application is available', () => {
  render(<OpenInAppAction {...bench({ apps: ['finder'], cwd: '/w' }).props} />)
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: zh['path.more'] })).toBeNull()
})
