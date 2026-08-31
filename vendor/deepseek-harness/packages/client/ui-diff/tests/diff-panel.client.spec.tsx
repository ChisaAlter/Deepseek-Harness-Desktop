// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { DiffPanelProps } from '../src/client/DiffPanel.tsx'
import { DiffPanel, pickBranchBase } from '../src/client/DiffPanel.tsx'
import { en } from '../src/client/locales.ts'
import { isStaged, isUnstaged, type GitBranchListResult, type GitDiffOptions, type GitDiffResult } from '../src/client/shell.ts'

const t: DiffPanelProps['t'] = key => (en as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('diff must not read this hook') }) as never
const SID = 'session-diff' as SessionId

function sessionList(cwd: string | undefined): SessionListState {
  const current = cwd === undefined ? undefined : SID
  const byId = current === undefined
    ? {}
    : {
      [SID]: {
        id: SID,
        displayTitle: 'proj',
        running: false,
        blank: false,
        updatedAt: 1,
        ...(cwd ? { cwd } : {}),
      },
    }
  return {
    ids: current === undefined ? [] : [SID],
    byId,
    current,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

const SAMPLE: GitDiffResult = {
  files: [{
    path: 'README.md',
    status: 'modified',
    hunks: [{
      header: '@@ -1,1 +1,2 @@',
      lines: [
        { kind: 'context', text: 'hello' },
        { kind: 'del', text: 'old' },
        { kind: 'add', text: 'world' },
      ],
    }],
  }],
}

function mount(opts: {
  cwd?: string | undefined
  status?: unknown
  diff?: GitDiffResult | null
  entries?: { ok: boolean; entries?: { path: string; xy: string }[] } | null
}) {
  const gitStatus = vi.fn(async () => opts.status ?? null)
  const gitDiff = vi.fn(async (_cwd: string, _options?: GitDiffOptions): Promise<GitDiffResult | null> => opts.diff ?? null)
  const gitStatusEntries = vi.fn(async () => opts.entries ?? null)
  const gitStage = vi.fn(async (): Promise<{ ok: boolean; message?: string }> => ({ ok: true }))
  const gitUnstage = vi.fn(async (): Promise<{ ok: boolean; message?: string }> => ({ ok: true }))
  const gitDiscard = vi.fn(async (): Promise<{ ok: boolean; message?: string }> => ({ ok: true }))
  const gitBranchList = vi.fn(async (): Promise<GitBranchListResult | null> => ({
    ok: true,
    defaultRef: 'origin/main',
    branches: [{ name: 'main', isCurrent: true }, { name: 'origin/main', isRemote: true, isDefault: true }],
  }))
  const openFile = vi.fn()
  render(
    <DiffPanel {...({
      sessionId: SID,
      useSession: neverHook,
      useSessions: (sel: (s: SessionListState) => unknown) => sel(sessionList(opts.cwd)),
      useWorkspaces: neverHook,
      useProjection: neverHook,
      openFile,
      gitStatus,
      gitDiff,
      gitStatusEntries,
      gitStage,
      gitUnstage,
      gitDiscard,
      gitBranchList,
      t,
    } as unknown as DiffPanelProps)} />,
  )
  return { gitStatus, gitDiff, gitStage, gitUnstage, gitDiscard, gitBranchList, openFile }
}

afterEach(cleanup)

describe('porcelain helpers', () => {
  it('classifies staged and unstaged XY codes', () => {
    expect(isStaged('M ')).toBe(true)
    expect(isStaged(' M')).toBe(false)
    expect(isUnstaged(' M')).toBe(true)
    expect(isUnstaged('M ')).toBe(false)
  })
})

describe('DiffPanel', () => {
  it('shows the disabled reason when the workspace is not a git repository', async () => {
    mount({ cwd: '/tmp/plain', status: null, diff: null })
    await waitFor(() => {
      expect(screen.getByText('Diff is only available in Git repositories.')).toBeTruthy()
    })
    expect(screen.queryByText('README.md')).toBeNull()
  })

  it('renders the change list and hunks when gitStatus and gitDiff succeed', async () => {
    const b = mount({ cwd: '/tmp/repo', status: { refName: 'main' }, diff: SAMPLE })
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    expect(screen.getByText('@@ -1,1 +1,2 @@')).toBeTruthy()
    expect(screen.getByText('world')).toBeTruthy()
    fireEvent.click(screen.getByText('README.md'))
    expect(b.openFile).toHaveBeenCalledWith('README.md')
  })

  it('stages an unstaged porcelain row', async () => {
    const b = mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: SAMPLE,
      entries: { ok: true, entries: [{ path: 'README.md', xy: ' M' }] },
    })
    await waitFor(() => {
      expect(screen.getByText('Unstaged')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Stage' }))
    await waitFor(() => {
      expect(b.gitStage).toHaveBeenCalledWith('/tmp/repo', 'README.md')
    })
  })

  it('unstages a staged porcelain row', async () => {
    const b = mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: SAMPLE,
      entries: { ok: true, entries: [{ path: 'README.md', xy: 'M ' }] },
    })
    await waitFor(() => {
      expect(screen.getByText('Staged')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Unstage' }))
    await waitFor(() => {
      expect(b.gitUnstage).toHaveBeenCalledWith('/tmp/repo', 'README.md')
    })
  })

  it('confirms discard before calling gitDiscard', async () => {
    const b = mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: SAMPLE,
      entries: { ok: true, entries: [{ path: 'README.md', xy: ' M' }] },
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    const confirms = screen.getAllByRole('button', { name: 'Discard' })
    fireEvent.click(confirms[confirms.length - 1]!)
    await waitFor(() => {
      expect(b.gitDiscard).toHaveBeenCalledWith('/tmp/repo', 'README.md')
    })
  })

  it('cancels discard without calling gitDiscard', async () => {
    const b = mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: SAMPLE,
      entries: { ok: true, entries: [{ path: 'README.md', xy: ' M' }] },
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    const cancels = screen.getAllByRole('button', { name: 'Cancel' })
    fireEvent.click(cancels[cancels.length - 1]!)
    expect(b.gitDiscard).not.toHaveBeenCalled()
  })

  it('shows empty porcelain and empty-cwd messages', async () => {
    mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: { files: [] },
      entries: { ok: true, entries: [] },
    })
    expect(await screen.findByText('No net changes in this selection.')).toBeTruthy()
    cleanup()
    mount({ cwd: undefined, status: { refName: 'main' }, diff: SAMPLE })
    expect(screen.getByText('A workspace is required to review diffs.')).toBeTruthy()
  })

  it('renders unified hunks without porcelain and surfaces a stage failure', async () => {
    const gitStage = vi.fn(async () => ({ ok: false, message: 'index locked' }))
    const gitStatus = vi.fn(async () => ({ refName: 'main' }))
    const gitDiff = vi.fn(async () => ({ ...SAMPLE, truncated: true }))
    const gitStatusEntries = vi.fn(async () => null)
    const gitUnstage = vi.fn(async () => ({ ok: true }))
    const gitDiscard = vi.fn(async () => ({ ok: true }))
    render(
      <DiffPanel {...({
        sessionId: SID,
        useSession: neverHook,
        useSessions: (sel: (s: SessionListState) => unknown) => sel(sessionList('/tmp/repo')),
        useWorkspaces: neverHook,
        useProjection: neverHook,
        openFile: vi.fn(),
        gitStatus,
        gitDiff,
        gitStatusEntries,
        gitStage,
        gitUnstage,
        gitDiscard,
        gitBranchList: async () => null,
        t,
      } as unknown as DiffPanelProps)} />,
    )
    expect(await screen.findByText('Diff is too large; showing the beginning.')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
    cleanup()
    const failing = mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: SAMPLE,
      entries: { ok: true, entries: [{ path: 'README.md', xy: ' M' }] },
    })
    failing.gitStage.mockResolvedValueOnce({ ok: false, message: 'index locked' })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Stage' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Stage' }))
    expect(await screen.findByText('index locked')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
  })

  it('shows the load error when gitStatus rejects', async () => {
    render(
      <DiffPanel {...({
        sessionId: SID,
        useSession: neverHook,
        useSessions: (sel: (s: SessionListState) => unknown) => sel(sessionList('/tmp/repo')),
        useWorkspaces: neverHook,
        useProjection: neverHook,
        openFile: vi.fn(),
        gitStatus: async () => { throw new Error('boom') },
        gitDiff: async () => SAMPLE,
        gitStatusEntries: async () => null,
        gitStage: async () => ({ ok: true }),
        gitUnstage: async () => ({ ok: true }),
        gitDiscard: async () => ({ ok: true }),
        gitBranchList: async () => null,
        t,
      } as unknown as DiffPanelProps)} />,
    )
    expect(await screen.findByText('Could not load the diff.')).toBeTruthy()
  })

  it('reloads on refresh and window focus, and toggles a hunk', async () => {
    const b = mount({ cwd: '/tmp/repo', status: { refName: 'main' }, diff: SAMPLE })
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    expect(screen.getByRole('button', { name: 'Working tree' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      expect(b.gitDiff.mock.calls.length).toBeGreaterThan(1)
    })
    window.dispatchEvent(new Event('focus'))
    const title = screen.getByText('README.md')
    fireEvent.click(title)
    expect(b.openFile).toHaveBeenCalledWith('README.md')
    fireEvent.click(screen.getByRole('button', { expanded: true }))
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.click(screen.getByText('hello'))
    expect(b.openFile).toHaveBeenCalledTimes(1)
  })

  it('shows empty unified changes when porcelain is absent', async () => {
    mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: { files: [] },
      entries: null,
    })
    expect(await screen.findByText('No net changes in this selection.')).toBeTruthy()
  })

  it('unmounts a pending load, confirms modal close, and shows truncated porcelain', async () => {
    let finish!: (value: unknown) => void
    const pending = new Promise((resolve) => { finish = resolve })
    const { unmount } = render(
      <DiffPanel {...({
        sessionId: SID,
        useSession: neverHook,
        useSessions: (sel: (s: SessionListState) => unknown) => sel(sessionList('/tmp/repo')),
        useWorkspaces: neverHook,
        useProjection: neverHook,
        openFile: vi.fn(),
        gitStatus: () => pending,
        gitDiff: async () => SAMPLE,
        gitStatusEntries: async () => ({ ok: true }),
        gitStage: async () => ({ ok: false }),
        gitUnstage: async () => ({ ok: true }),
        gitDiscard: async () => ({ ok: true }),
        gitBranchList: async () => null,
        t,
      } as unknown as DiffPanelProps)} />,
    )
    unmount()
    finish({ refName: 'main' })
    const b = mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: { ...SAMPLE, truncated: true },
      entries: { ok: true, entries: [{ path: 'README.md', xy: ' M' }] },
    })
    expect(await screen.findByText('Diff is too large; showing the beginning.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!)
    expect(b.gitDiscard).not.toHaveBeenCalled()
    b.gitStage.mockResolvedValueOnce({ ok: false })
    fireEvent.click(screen.getByRole('button', { name: 'Stage' }))
    expect(await screen.findByText('Could not load the diff.')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
  })

  it('treats ok porcelain without entries as empty and ignores a late reject', async () => {
    let fail!: (error: Error) => void
    const pending = new Promise<never>((_, reject) => { fail = reject })
    const { unmount } = render(
      <DiffPanel {...({
        sessionId: SID,
        useSession: neverHook,
        useSessions: (sel: (s: SessionListState) => unknown) => sel(sessionList('/tmp/repo')),
        useWorkspaces: neverHook,
        useProjection: neverHook,
        openFile: vi.fn(),
        gitStatus: () => pending,
        gitDiff: async () => SAMPLE,
        gitStatusEntries: async () => ({ ok: true }),
        gitStage: async () => ({ ok: true }),
        gitUnstage: async () => ({ ok: true }),
        gitDiscard: async () => ({ ok: true }),
        gitBranchList: async () => null,
        t,
      } as unknown as DiffPanelProps)} />,
    )
    unmount()
    fail(new Error('late'))
    mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: SAMPLE,
      entries: { ok: true },
    })
    expect(await screen.findByText('No net changes in this selection.')).toBeTruthy()
    expect(screen.queryByText('README.md')).toBeNull()
  })

  it('renders an empty hunk list for a porcelain path absent from the unified diff', async () => {
    mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: SAMPLE,
      entries: { ok: true, entries: [{ path: 'ghost.ts', xy: ' M' }] },
    })
    expect(await screen.findByText('ghost.ts')).toBeTruthy()
    expect(screen.queryByText('@@ -1,1 +1,2 @@')).toBeNull()
  })

  it('loads a three-dot branch range and hides stage actions', async () => {
    const b = mount({ cwd: '/tmp/repo', status: { refName: 'main' }, diff: SAMPLE })
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Working tree' }))
    await waitFor(() => {
      expect(b.gitBranchList).toHaveBeenCalledWith('/tmp/repo')
    })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'origin/main' }))
    await waitFor(() => {
      expect(b.gitDiff).toHaveBeenCalledWith('/tmp/repo', { baseRef: 'origin/main' })
    })
    expect(screen.getByRole('button', { name: /Branch/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stage' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    fireEvent.click(screen.getByRole('button', { name: /Branch/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Working tree' }))
    await waitFor(() => {
      expect(b.gitDiff.mock.calls.some(call => call[1] === undefined)).toBe(true)
    })
  })

  it('shows a load error when the repo is valid but gitDiff returns null', async () => {
    mount({
      cwd: '/tmp/repo',
      status: { refName: 'main' },
      diff: null,
    })
    expect(await screen.findByText('Could not load the diff.')).toBeTruthy()
    expect(screen.queryByText('Diff is only available in Git repositories.')).toBeNull()
  })

  it('clears the branch list when gitBranchList is not ok', async () => {
    const b = mount({ cwd: '/tmp/repo', status: { refName: 'main' }, diff: SAMPLE })
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    b.gitBranchList.mockResolvedValueOnce({ ok: false, message: 'no git' })
    fireEvent.click(screen.getByRole('button', { name: 'Working tree' }))
    await waitFor(() => {
      expect(b.gitBranchList).toHaveBeenCalled()
    })
    expect(screen.queryByRole('menuitem', { name: 'origin/main' })).toBeNull()
  })

  it('filters branch refs and lists beyond fifty names', async () => {
    const extra = Array.from({ length: 51 }, (_, index) => ({
      name: `topic-${String(index + 1).padStart(2, '0')}`,
    }))
    const b = mount({ cwd: '/tmp/repo', status: { refName: 'main' }, diff: SAMPLE })
    b.gitBranchList.mockResolvedValueOnce({
      ok: true,
      defaultRef: 'origin/main',
      branches: [
        { name: 'main', isCurrent: true },
        { name: 'origin/main', isRemote: true, isDefault: true },
        ...extra,
      ],
    })
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Working tree' }))
    expect(await screen.findByRole('menuitem', { name: 'topic-51' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search branches…'), { target: { value: 'topic-51' } })
    expect(screen.getByRole('menuitem', { name: 'topic-51' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'origin/main' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Working tree' })).toBeTruthy()
  })
})

describe('pickBranchBase', () => {
  it('prefers defaultRef, then isDefault, then main, then the first local branch', () => {
    expect(pickBranchBase([], 'origin/main')).toBe('origin/main')
    expect(pickBranchBase([{ name: 'topic', isDefault: true }], null)).toBe('topic')
    expect(pickBranchBase([{ name: 'main' }], undefined)).toBe('main')
    expect(pickBranchBase([{ name: 'topic', isRemote: true }, { name: 'feat' }], null)).toBe('feat')
    expect(pickBranchBase([{ name: 'origin/main' }], null)).toBe('origin/main')
    expect(pickBranchBase([], null)).toBe('main')
    expect(pickBranchBase([], '')).toBe('main')
  })
})
