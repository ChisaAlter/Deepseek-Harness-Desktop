// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()
  return { ...actual, writeClipboard: vi.fn(async () => true) }
})
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { filterEntries } from '../src/client/filter.ts'
import { FileTree, joinRel } from '../src/client/FileTree.tsx'
import { FilePreview } from '../src/client/FilePreview.tsx'
import { resolveCenteredFileLineScrollTop } from '../src/client/fileLineReveal.ts'
import type { FilesPanelProps } from '../src/client/FilesPanel.tsx'
import { FilesPanel } from '../src/client/FilesPanel.tsx'
import { en } from '../src/client/locales.ts'
import type { DirEntry, ListDirResult } from '../src/client/shell.ts'

const t: FilesPanelProps['t'] = key => (en as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('files must not read this hook') }) as never
const SID = 'session-files' as SessionId

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

const FAKE_ROOT: DirEntry[] = [
  { name: 'src', kind: 'directory' },
  { name: 'README.md', kind: 'file' },
]

const FAKE_SRC: DirEntry[] = [
  { name: 'index.ts', kind: 'file' },
]

function listDirFake(cwd: string, relativePath: string): Promise<ListDirResult> {
  if (cwd !== '/tmp/proj') return Promise.resolve({ ok: false, message: 'missing' })
  if (relativePath === '' || relativePath === '.') {
    return Promise.resolve({ ok: true, entries: FAKE_ROOT })
  }
  if (relativePath === 'src') return Promise.resolve({ ok: true, entries: FAKE_SRC })
  return Promise.resolve({ ok: true, entries: [] })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
  delete (window as Window & { shell?: unknown }).shell
})

describe('filterEntries', () => {
  it('keeps ancestor directories of a name match', () => {
    const src = { name: 'src', kind: 'directory' as const, path: 'src' }
    const readme = { name: 'README.md', kind: 'file' as const, path: 'README.md' }
    const index = { name: 'index.ts', kind: 'file' as const, path: 'src/index.ts' }
    expect(filterEntries([src, readme], 'index', { src: [index] }).map(entry => entry.path)).toEqual(['src'])
    expect(filterEntries([src, readme], '', { src: [index] })).toHaveLength(2)
  })
})

describe('FileTree', () => {
  it('renders a fake directory and opens a file on click', () => {
    const onOpenFile = vi.fn()
    const onMention = vi.fn()
    const onCopyRelative = vi.fn()
    const onCopyAbsolute = vi.fn()
    const entries = FAKE_ROOT.map(entry => ({ ...entry, path: joinRel('', entry.name) }))
    render(
      <FileTree
        entries={entries}
        childrenByPath={{}}
        expanded={new Set()}
        onToggle={() => {}}
        onOpenFile={onOpenFile}
        onMention={onMention}
        onCopyRelative={onCopyRelative}
        onCopyAbsolute={onCopyAbsolute}
        mentionLabel="Mention in composer"
        copyRelativeLabel="Copy relative path"
        copyAbsoluteLabel="Copy absolute path"
      />,
    )
    expect(screen.getByText('src')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /README.md/ }))
    expect(onOpenFile).toHaveBeenCalledWith('README.md')
    fireEvent.click(screen.getByRole('button', { name: 'Mention in composer' }))
    expect(onMention).toHaveBeenCalledWith('README.md')
    fireEvent.contextMenu(screen.getByRole('button', { name: /README.md/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy relative path' }))
    expect(onCopyRelative).toHaveBeenCalledWith('README.md')
    fireEvent.contextMenu(screen.getByRole('button', { name: /README.md/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy absolute path' }))
    expect(onCopyAbsolute).toHaveBeenCalledWith('README.md')
    fireEvent.contextMenu(screen.getByRole('button', { name: /README.md/ }))
    fireEvent.keyDown(document, { key: 'Escape' })
  })

  it('includes Show in folder on files and directories', () => {
    const onShowInFolder = vi.fn()
    const onOpenInEditor = vi.fn()
    const onOpenWithSystemDefault = vi.fn()
    const entries = FAKE_ROOT.map(entry => ({ ...entry, path: joinRel('', entry.name) }))
    render(
      <FileTree
        entries={entries}
        childrenByPath={{}}
        expanded={new Set()}
        onToggle={() => {}}
        onOpenFile={() => {}}
        onShowInFolder={onShowInFolder}
        onOpenInEditor={onOpenInEditor}
        onOpenWithSystemDefault={onOpenWithSystemDefault}
        editors={[{ id: 'vscode', label: 'VS Code' }]}
        showInFolderLabel="在文件夹中显示"
        openWithSystemDefaultLabel="系统默认程序"
      />,
    )
    fireEvent.contextMenu(screen.getByRole('button', { name: /README.md/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '在文件夹中显示' }))
    expect(onShowInFolder).toHaveBeenCalledWith('README.md')
    fireEvent.contextMenu(screen.getByRole('button', { name: /README.md/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'VS Code' }))
    expect(onOpenInEditor).toHaveBeenCalledWith('vscode', 'README.md')
    fireEvent.contextMenu(screen.getByRole('button', { name: /README.md/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: '系统默认程序' }))
    expect(onOpenWithSystemDefault).toHaveBeenCalledWith('README.md')
    fireEvent.contextMenu(screen.getByRole('button', { name: /src/ }))
    expect(screen.getByRole('menuitem', { name: '在文件夹中显示' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'VS Code' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '系统默认程序' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '在文件夹中显示' }))
    expect(onShowInFolder).toHaveBeenCalledWith('src')
  })

  it('tags file rows for mention drag and ignores click while dragging', () => {
    const onOpenFile = vi.fn()
    const entries = FAKE_ROOT.map(entry => ({ ...entry, path: joinRel('', entry.name) }))
    render(
      <FileTree
        entries={entries}
        childrenByPath={{}}
        expanded={new Set()}
        onToggle={() => {}}
        onOpenFile={onOpenFile}
      />,
    )
    const fileRow = screen.getByRole('button', { name: /README.md/ })
    const dirRow = screen.getByRole('button', { name: /src/ })
    expect(fileRow.getAttribute('draggable')).toBe('true')
    expect(fileRow.getAttribute('data-item-path')).toBe('README.md')
    expect(dirRow.getAttribute('draggable')).not.toBe('true')
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => ''),
    }
    fireEvent.dragStart(fileRow, { dataTransfer })
    fireEvent.click(fileRow)
    expect(onOpenFile).not.toHaveBeenCalled()
    fireEvent.dragEnd(fileRow)
    fireEvent.click(fileRow)
    expect(onOpenFile).toHaveBeenCalledWith('README.md')
  })

  it('skips the context menu when copy actions are absent', () => {
    const entries = FAKE_ROOT.map(entry => ({ ...entry, path: joinRel('', entry.name) }))
    render(
      <FileTree
        entries={entries}
        childrenByPath={{}}
        expanded={new Set()}
        onToggle={() => {}}
        onOpenFile={() => {}}
      />,
    )
    fireEvent.contextMenu(screen.getByRole('button', { name: /README.md/ }))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('FilesPanel', () => {
  it('lists a fake workspace and calls openFile for a file click', async () => {
    const openFile = vi.fn()
    const listDir = vi.fn(listDirFake)
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={openFile}
        listDir={listDir}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    expect(listDir).toHaveBeenCalledWith('/tmp/proj', '')
    fireEvent.click(screen.getByRole('button', { name: /README.md/ }))
    expect(openFile).toHaveBeenCalledWith('README.md')
    fireEvent.click(screen.getByRole('button', { name: /src/ }))
    await waitFor(() => {
      expect(listDir).toHaveBeenCalledWith('/tmp/proj', 'src')
    })
    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /index.ts/ }))
    expect(openFile).toHaveBeenCalledWith('src/index.ts')
    fireEvent.click(screen.getByRole('button', { name: /src/ }))
    fireEvent.click(screen.getByRole('button', { name: /src/ }))
    expect(screen.getByText('index.ts')).toBeTruthy()
  })

  it('shows the list error when listDir rejects', async () => {
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={async () => { throw new Error('unknown id') }}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('Could not list the directory.')).toBeTruthy()
  })

  it('mentions a file and refreshes the tree', async () => {
    const mentionFile = vi.fn()
    const listDir = vi.fn(listDirFake)
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={listDir}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={mentionFile}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Mention in composer' }))
    expect(mentionFile).toHaveBeenCalledWith(SID, 'README.md')
    expect(screen.queryByRole('heading')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      expect(listDir.mock.calls.length).toBeGreaterThan(1)
    })
  })

  it('copies relative and absolute paths from the context menu', async () => {
    vi.mocked(writeClipboard).mockClear()
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={listDirFake}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: /README.md/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy relative path' }))
    await waitFor(() => {
      expect(writeClipboard).toHaveBeenCalledWith('README.md')
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: /README.md/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy absolute path' }))
    await waitFor(() => {
      expect(writeClipboard).toHaveBeenCalledWith('/tmp/proj/README.md')
    })
    vi.useFakeTimers()
    fireEvent.contextMenu(screen.getByRole('button', { name: /README.md/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy relative path' }))
    await act(async () => {
      await Promise.resolve()
    })
    // Copy feedback is its own status marker; the Refresh tooltip is untouched.
    expect(screen.getByRole('status').textContent).toBe('Copied')
    await act(async () => {
      vi.advanceTimersByTime(1200)
    })
    expect(screen.queryByRole('status')).toBeNull()
    vi.useRealTimers()
  })

  it('copies a markdown mention from the context menu', async () => {
    vi.mocked(writeClipboard).mockClear()
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={listDirFake}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    fireEvent.contextMenu(screen.getByRole('button', { name: /README.md/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy mention' }))
    await waitFor(() => {
      expect(writeClipboard).toHaveBeenCalledWith('[README.md](README.md)')
    })
  })

  it('shows the empty-cwd message when no workspace is attached', () => {
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList(undefined))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(screen.getByText('A workspace is required to browse files.')).toBeTruthy()
  })

  it('does not paint empty-directory while the root listing is in flight', async () => {
    let finish!: (value: ListDirResult) => void
    const pending = new Promise<ListDirResult>((resolve) => { finish = resolve })
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={() => pending}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(screen.getByText('Listing directory…')).toBeTruthy()
    expect(screen.queryByText('This directory is empty.')).toBeNull()
    await act(async () => {
      finish({ ok: true, entries: FAKE_ROOT })
    })
    expect(await screen.findByText('README.md')).toBeTruthy()
    expect(screen.queryByText('Listing directory…')).toBeNull()
  })

  it('shows the empty-directory message when listing returns no entries', async () => {
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={async () => ({ ok: true, entries: [] })}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('This directory is empty.')).toBeTruthy()
    cleanup()
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={async () => ({ ok: true })}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('This directory is empty.')).toBeTruthy()
  })

  it('shows the list message when listDir returns not-ok', async () => {
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={async () => ({ ok: false, message: 'denied' })}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('denied')).toBeTruthy()
  })

  it('does not mention without a session and reports a child-list error', async () => {
    vi.mocked(writeClipboard).mockResolvedValueOnce(false)
    const mentionFile = vi.fn()
    render(
      <FilesPanel
        sessionId={undefined}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={async (_cwd, relativePath) => {
          if (relativePath === 'src') return { ok: false }
          return listDirFake('/tmp/proj', relativePath)
        }}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={mentionFile}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Mention in composer' })).toBeNull()
    fireEvent.contextMenu(screen.getByRole('button', { name: /README.md/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy relative path' }))
    fireEvent.click(screen.getByRole('button', { name: /src/ }))
    expect(await screen.findByText('Could not list the directory.')).toBeTruthy()
  })

  it('surfaces a thrown child listing error', async () => {
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={async (_cwd, relativePath) => {
          if (relativePath === 'src') throw new Error('boom')
          return listDirFake('/tmp/proj', relativePath)
        }}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /src/ }))
    expect(await screen.findByText('Could not list the directory.')).toBeTruthy()
  })

  it('ignores a late listDir, uses fallback copy, and expands empty children', async () => {
    let finish!: (value: ListDirResult) => void
    const pending = new Promise<ListDirResult>((resolve) => { finish = resolve })
    const { unmount } = render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={() => pending}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    unmount()
    finish({ ok: true, entries: FAKE_ROOT })
    let fail!: (error: Error) => void
    const rejecting = new Promise<ListDirResult>((_, reject) => { fail = reject })
    const { unmount: unmountReject } = render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={() => rejecting}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    unmountReject()
    fail(new Error('late'))
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={async (_cwd, relativePath) => {
          if (relativePath === 'src') return { ok: true }
          if (relativePath === '') return { ok: false }
          return { ok: false }
        }}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('Could not list the directory.')).toBeTruthy()
    cleanup()
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={async (_cwd, relativePath) => {
          if (relativePath === '') return { ok: true, entries: FAKE_ROOT }
          return { ok: true }
        }}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('src')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: /src/ }))
    fireEvent.click(screen.getByRole('button', { name: /src/ }))
    expect(screen.getByText('src')).toBeTruthy()
  })

  it('filters the tree from the search field and clears on Escape', async () => {
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={listDirFake}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'README' } })
    })
    await waitFor(() => {
      expect(screen.queryByText('src')).toBeNull()
    })
    expect(screen.getByRole('button', { name: /README.md/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /index.ts/ })).toBeNull()
    fireEvent.keyDown(screen.getByLabelText('Search files'), { key: 'Escape' })
    await waitFor(() => {
      expect(screen.getByText('src')).toBeTruthy()
    })
  })

  it('re-walks an active search on refresh instead of dropping nested matches', async () => {
    const listDir = vi.fn(listDirFake)
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={listDir}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'index' } })
    expect(await screen.findByText('index.ts')).toBeTruthy()
    const callsBefore = listDir.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      expect(listDir.mock.calls.length).toBeGreaterThan(callsBefore)
    })
    expect(screen.getByText('index.ts')).toBeTruthy()
  })

  it('walks once per search session and filters further keystrokes in memory', async () => {
    const listDir = vi.fn(listDirFake)
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={listDir}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeTruthy()
    })
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'i' } })
    expect(await screen.findByText('src/index.ts')).toBeTruthy()
    const callsAfterWalk = listDir.mock.calls.length
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'in' } })
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'index' } })
    expect(await screen.findByText('src/index.ts')).toBeTruthy()
    // Keystrokes inside one search session must not re-walk the tree.
    expect(listDir.mock.calls.length).toBe(callsAfterWalk)
    // Clearing and retyping starts a new session and re-walks once.
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'read' } })
    await waitFor(() => {
      expect(listDir.mock.calls.length).toBeGreaterThan(callsAfterWalk)
    })
  })

  it('walks nested directories with no depth cap during search', async () => {
    const deepList: FilesPanelProps['listDir'] = async (_cwd, relativePath) => {
      const depth = relativePath === '' ? 0 : relativePath.split('/').length
      if (depth >= 10) return { ok: true, entries: [{ name: 'leaf.ts', kind: 'file' }] }
      return { ok: true, entries: [{ name: `d${depth}`, kind: 'directory' }] }
    }
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/deep'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={() => {}}
        listDir={deepList}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('d0')).toBeTruthy()
    })
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'leaf' } })
    expect(await screen.findByText('leaf.ts')).toBeTruthy()
    expect(screen.queryByText('Search stopped early (depth or directory limit).')).toBeNull()
  })

  it('shows picker rows for index that call openFile', async () => {
    const openFile = vi.fn()
    const listDir: FilesPanelProps['listDir'] = async (_cwd, relativePath) => {
      if (relativePath === '') return { ok: true, entries: [{ name: 'apps', kind: 'directory' }] }
      if (relativePath === 'apps') return { ok: true, entries: [{ name: 'web', kind: 'directory' }] }
      if (relativePath === 'apps/web') return { ok: true, entries: [{ name: 'src', kind: 'directory' }] }
      if (relativePath === 'apps/web/src') {
        return { ok: true, entries: [{ name: 'index.ts', kind: 'file' }] }
      }
      return { ok: true, entries: [] }
    }
    render(
      <FilesPanel
        sessionId={SID}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        openFile={openFile}
        listDir={listDir}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.getByText('apps')).toBeTruthy()
    })
    fireEvent.change(screen.getByLabelText('Search files'), { target: { value: 'index' } })
    expect(await screen.findByText('apps/web/src/index.ts')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /apps\/web\/src\/index\.ts/ }))
    expect(openFile).toHaveBeenCalledWith('apps/web/src/index.ts')
  })
})

describe('FilePreview', () => {
  it('shows the read error when readFile rejects', async () => {
    render(
      <FilePreview
        sessionId={SID}
        relativePath="README.md"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => { throw new Error('unknown id') }}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('Could not read the file.')).toBeTruthy()
  })

  it('renders markdown with codeLabels and images from readFileMedia', async () => {
    const { rerender } = render(
      <FilePreview
        sessionId={SID}
        relativePath="note.md"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: '# Hello', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Rendered' }))
    expect(await screen.findByText('Hello')).toBeTruthy()
    rerender(
      <FilePreview
        sessionId={SID}
        relativePath="icon.png"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: true, mime: 'image/png', base64: 'aaaa' })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    const image = await screen.findByRole('img', { name: 'icon.png' })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,aaaa')
  })

  it('shows the binary stub and the empty-cwd message', async () => {
    render(
      <FilePreview
        sessionId={SID}
        relativePath="blob.bin"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList(undefined))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, binary: true, text: '' })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('A workspace is required to browse files.')).toBeTruthy()
  })

  it('shows truncated text, binary stub, and media errors', async () => {
    const { rerender } = render(
      <FilePreview
        sessionId={SID}
        relativePath="src/a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'const x = 1', binary: false, truncated: true })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('File is too large; showing the beginning.')).toBeTruthy()
    expect(screen.getByText('proj')).toBeTruthy()
    expect(screen.getByText('src')).toBeTruthy()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByText('const x = 1')).toBeTruthy()
    rerender(
      <FilePreview
        sessionId={SID}
        relativePath="blob.bin"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, binary: true, text: '' })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('This binary file cannot be previewed.')).toBeTruthy()
    rerender(
      <FilePreview
        sessionId={SID}
        relativePath="icon.png"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false, message: 'too large' })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('too large')).toBeTruthy()
  })

  it('ignores a late read after unmount and surfaces media failures', async () => {
    let finish!: (value: { ok: true; text: string; binary: false }) => void
    const pending = new Promise<{ ok: true; text: string; binary: false }>((resolve) => {
      finish = resolve
    })
    const { unmount } = render(
      <FilePreview
        sessionId={SID}
        relativePath="late.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={() => pending}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    unmount()
    finish({ ok: true, text: 'late', binary: false })
    const { rerender } = render(
      <FilePreview
        sessionId={SID}
        relativePath="icon.png"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => { throw new Error('media') }}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('Could not read the file.')).toBeTruthy()
    rerender(
      <FilePreview
        sessionId={SID}
        relativePath="photo.jpg"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: true, mime: 'image/jpeg', base64: 'bb', truncated: true })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('File is too large; showing the beginning.')).toBeTruthy()
    // A truncated image payload never renders a broken <img>.
    expect(screen.queryByRole('img')).toBeNull()
    rerender(
      <FilePreview
        sessionId={SID}
        relativePath="note.md"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: '# Hi', binary: false, truncated: true })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('File is too large; showing the beginning.')).toBeTruthy()
    rerender(
      <FilePreview
        sessionId={SID}
        relativePath="missing.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('Could not read the file.')).toBeTruthy()
  })

  it('previews a file with no extension', async () => {
    render(
      <FilePreview
        sessionId={SID}
        relativePath="LICENSE"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'mit', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByDisplayValue('mit')).toBeTruthy()
  })

  it('ignores a late image read and falls back when media or text fields are missing', async () => {
    let finish!: (value: { ok: true; mime: string; base64: string }) => void
    const pending = new Promise<{ ok: true; mime: string; base64: string }>((resolve) => {
      finish = resolve
    })
    const { unmount } = render(
      <FilePreview
        sessionId={SID}
        relativePath="icon.png"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: false })}
        readFileMedia={() => pending}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    unmount()
    finish({ ok: true, mime: 'image/png', base64: 'late' })
    let fail!: (error: Error) => void
    const rejecting = new Promise<never>((_, reject) => { fail = reject })
    const { unmount: unmountReject } = render(
      <FilePreview
        sessionId={SID}
        relativePath="icon.png"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: false })}
        readFileMedia={() => rejecting}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    unmountReject()
    fail(new Error('late-media'))
    let failText!: (error: Error) => void
    const rejectingText = new Promise<never>((_, reject) => { failText = reject })
    const { unmount: unmountText } = render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={() => rejectingText}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    unmountText()
    failText(new Error('late-text'))
    const { rerender } = render(
      <FilePreview
        sessionId={SID}
        relativePath="icon.png"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: false })}
        readFileMedia={async () => ({ ok: true })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('Could not read the file.')).toBeTruthy()
    rerender(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    await waitFor(() => {
      expect(screen.queryByText('Could not read the file.')).toBeNull()
    })
  })

  it('saves an edited text file and toggles markdown source', async () => {
    const writeFile = vi.fn(async () => ({ ok: true }))
    render(
      <FilePreview
        sessionId={SID}
        relativePath="note.md"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: '# Hello', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={writeFile}
        t={t}
      />,
    )
    const editor = await screen.findByLabelText('note.md')
    fireEvent.change(editor, { target: { value: '# Saved' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(writeFile).toHaveBeenCalledWith('/tmp/proj', 'note.md', '# Saved')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Rendered' }))
  })

  it('keeps keystrokes typed during an explicit save dirty instead of marking them saved', async () => {
    let finishWrite!: (result: { ok: boolean }) => void
    const writePending = new Promise<{ ok: boolean }>((resolve) => { finishWrite = resolve })
    // The debounced follow-up save (for the mid-flight keystrokes) stays
    // in flight so the assertions below observe the still-dirty state.
    const writeFile = vi.fn<(cwd: string, path: string, contents: string) => Promise<{ ok: boolean }>>()
      .mockReturnValueOnce(writePending)
      .mockReturnValue(new Promise<{ ok: boolean }>(() => {}))
    const writeBuffer = vi.fn()
    const onDirtyChange = vi.fn()
    render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={onDirtyChange}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={writeBuffer}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'x', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={writeFile}
        t={t}
      />,
    )
    const editor = await screen.findByLabelText('a.ts')
    fireEvent.change(editor, { target: { value: 'saved snapshot' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(writeFile).toHaveBeenCalledWith('/tmp/proj', 'a.ts', 'saved snapshot')
    })
    // Keystrokes injected while the write is still in flight.
    fireEvent.change(screen.getByLabelText('a.ts'), { target: { value: 'saved snapshot plus' } })
    await act(async () => { finishWrite({ ok: true }) })
    // Only the written snapshot is confirmed; the newer draft stays dirty.
    await waitFor(() => {
      expect(writeBuffer).toHaveBeenCalledWith({ text: 'saved snapshot', draft: 'saved snapshot plus' })
    })
    expect((screen.getByLabelText('a.ts') as HTMLTextAreaElement).value).toBe('saved snapshot plus')
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
    expect((screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the write error when save fails', async () => {
    render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'x', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: false, message: 'disk full' })}
        t={t}
      />,
    )
    const editor = await screen.findByLabelText('a.ts')
    fireEvent.change(editor, { target: { value: 'y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('disk full')).toBeTruthy()
    expect((screen.getByLabelText('a.ts') as HTMLTextAreaElement).value).toBe('y')
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('keeps characters typed during an explicit save dirty instead of marking them saved', async () => {
    let disk = 'base'
    const writes: string[] = []
    let releaseWrite!: () => void
    const gate = new Promise<void>((resolve) => { releaseWrite = resolve })
    const writeFile = vi.fn(async (_cwd: string, _path: string, contents: string) => {
      writes.push(contents)
      if (writes.length === 1) await gate
      disk = contents
      return { ok: true }
    })
    const writeBuffer = vi.fn()
    render(
      <FilePreview
        sessionId={SID}
        relativePath="race.txt"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={writeBuffer}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: disk, binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={writeFile}
        t={t}
      />,
    )
    const editor = await screen.findByLabelText('race.txt')
    fireEvent.change(editor, { target: { value: 'first' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => { expect(writeFile).toHaveBeenCalledTimes(1) })
    // Inject characters while the explicit save's write is still in flight.
    fireEvent.change(editor, { target: { value: 'first+typed' } })
    releaseWrite()
    await waitFor(() => {
      // The written snapshot becomes the baseline; the newer draft stays dirty.
      expect(writeBuffer).toHaveBeenCalledWith({ text: 'first', draft: 'first+typed' })
    })
    expect((screen.getByLabelText('race.txt') as HTMLTextAreaElement).value).toBe('first+typed')
    // The debounced follow-up write persists the newer draft; nothing is lost.
    await waitFor(() => { expect(writes).toContain('first+typed') }, { timeout: 3000 })
  }, 10_000)

  it('keeps an unsaved draft when the parent stays mounted but hidden', async () => {
    const { rerender } = render(
      <div data-keep-alive hidden={false}>
        <FilePreview
          sessionId={SID}
          relativePath="a.ts"
          active
          onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
          useSession={neverHook}
          useSessions={sel => sel(sessionList('/tmp/proj'))}
          useWorkspaces={neverHook}
          useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
          useInput={neverHook}
          inputActions={undefined}
          listDir={async () => ({ ok: false })}
          readFile={async () => ({ ok: true, text: 'x', binary: false })}
          readFileMedia={async () => ({ ok: false })}
          mentionFile={() => {}}
          writeFile={async () => ({ ok: true })}
          t={t}
        />
      </div>,
    )
    const editor = await screen.findByLabelText('a.ts')
    fireEvent.change(editor, { target: { value: 'unsaved keep-alive' } })
    rerender(
      <div data-keep-alive hidden>
        <FilePreview
          sessionId={SID}
          relativePath="a.ts"
          active
          onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
          useSession={neverHook}
          useSessions={sel => sel(sessionList('/tmp/proj'))}
          useWorkspaces={neverHook}
          useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
          useInput={neverHook}
          inputActions={undefined}
          listDir={async () => ({ ok: false })}
          readFile={async () => ({ ok: true, text: 'x', binary: false })}
          readFileMedia={async () => ({ ok: false })}
          mentionFile={() => {}}
          writeFile={async () => ({ ok: true })}
          t={t}
        />
      </div>,
    )
    expect((document.querySelector('[data-keep-alive] textarea') as HTMLTextAreaElement).value).toBe('unsaved keep-alive')
    rerender(
      <div data-keep-alive hidden={false}>
        <FilePreview
          sessionId={SID}
          relativePath="a.ts"
          active
          onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
          useSession={neverHook}
          useSessions={sel => sel(sessionList('/tmp/proj'))}
          useWorkspaces={neverHook}
          useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
          useInput={neverHook}
          inputActions={undefined}
          listDir={async () => ({ ok: false })}
          readFile={async () => ({ ok: true, text: 'x', binary: false })}
          readFileMedia={async () => ({ ok: false })}
          mentionFile={() => {}}
          writeFile={async () => ({ ok: true })}
          t={t}
        />
      </div>,
    )
    expect((screen.getByLabelText('a.ts') as HTMLTextAreaElement).value).toBe('unsaved keep-alive')
  })

  it('keeps the editor when writeFile throws', async () => {
    render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'x', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => { throw new Error('locked') }}
        t={t}
      />,
    )
    const editor = await screen.findByLabelText('a.ts')
    fireEvent.change(editor, { target: { value: 'kept' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Could not save the file.')).toBeTruthy()
    expect((screen.getByLabelText('a.ts') as HTMLTextAreaElement).value).toBe('kept')
  })

  it('uses the write error copy when save fails without a message', async () => {
    render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'x', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: false })}
        t={t}
      />,
    )
    const editor = await screen.findByLabelText('a.ts')
    fireEvent.change(editor, { target: { value: 'z' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Could not save the file.')).toBeTruthy()
    expect((screen.getByLabelText('a.ts') as HTMLTextAreaElement).value).toBe('z')
  })
  it('keeps dirty reporting when cwd becomes undefined', async () => {
    const onDirtyChange = vi.fn()
    const { rerender } = render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={onDirtyChange}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'x', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    const editor = await screen.findByLabelText('a.ts')
    fireEvent.change(editor, { target: { value: 'dirty' } })
    await waitFor(() => { expect(onDirtyChange).toHaveBeenCalledWith(true) })
    onDirtyChange.mockClear()
    rerender(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={onDirtyChange}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList(undefined))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'x', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('A workspace is required to browse files.')).toBeTruthy()
    // Dirty must not flip to false when cwd disappears (confirm still protects the buffer).
    expect(onDirtyChange).not.toHaveBeenCalledWith(false)
    expect((screen.getByLabelText('a.ts') as HTMLTextAreaElement).value).toBe('dirty')
  })

  it('keeps a dirty draft when disk content changes under the buffer', async () => {
    let disk = 'v1'
    const buffer = { text: 'v1', draft: 'edited' }
    render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => buffer}
        writeBuffer={(next) => {
          if (next === null) {
            buffer.text = ''
            buffer.draft = ''
            return
          }
          buffer.text = next.text
          buffer.draft = next.draft
        }}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: disk, binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByLabelText('a.ts')).toBeTruthy()
    expect((screen.getByLabelText('a.ts') as HTMLTextAreaElement).value).toBe('edited')
    disk = 'v2'
    cleanup()
    render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => buffer}
        writeBuffer={(next) => {
          if (next === null) {
            buffer.text = ''
            buffer.draft = ''
            return
          }
          buffer.text = next.text
          buffer.draft = next.draft
        }}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: disk, binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByLabelText('a.ts')).toBeTruthy()
    expect((screen.getByLabelText('a.ts') as HTMLTextAreaElement).value).toBe('edited')
    expect(buffer.text).toBe('v2')
    expect(buffer.draft).toBe('edited')
  })

  it('saves with Ctrl+S when the editor is dirty', async () => {
    const writeFile = vi.fn(async () => ({ ok: true as const }))
    render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'x', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={writeFile}
        t={t}
      />,
    )
    const editor = await screen.findByLabelText('a.ts')
    fireEvent.change(editor, { target: { value: 'saved-by-key' } })
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    })
    await waitFor(() => {
      expect(writeFile).toHaveBeenCalledWith('/tmp/proj', 'a.ts', 'saved-by-key')
    })
  })
  it('keeps a dirty buffer when readFile fails after remount', async () => {
    const buffer = { text: 'v1', draft: 'edited' }
    render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => buffer}
        writeBuffer={(next) => {
          if (next === null) {
            buffer.text = ''
            buffer.draft = ''
            return
          }
          buffer.text = next.text
          buffer.draft = next.draft
        }}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: false, message: 'gone' })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('gone')).toBeTruthy()
    expect(buffer.draft).toBe('edited')
    expect(buffer.text).toBe('v1')
    expect((screen.getByLabelText('a.ts') as HTMLTextAreaElement).value).toBe('edited')
  })

  it('saves a dirty draft after the last read failed', async () => {
    let save: (() => Promise<boolean>) | null = null
    const writeFile = vi.fn(async () => ({ ok: true as const }))
    render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={(next) => { save = next }}
        readBuffer={() => ({ text: 'v1', draft: 'edited' })}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: false, message: 'gone' })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={writeFile}
        t={t}
      />,
    )
    expect(await screen.findByText('gone')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
    expect((screen.getByLabelText('a.ts') as HTMLTextAreaElement).value).toBe('edited')
    await act(async () => {
      expect(await save?.()).toBe(true)
    })
    expect(writeFile).toHaveBeenCalledWith('/tmp/proj', 'a.ts', 'edited')
    expect(screen.queryByText('gone')).toBeNull()
  })

  it('lets a dirty markdown draft switch to source after the last read failed', async () => {
    render(
      <FilePreview
        sessionId={SID}
        relativePath="note.md"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => ({ text: '# v1', draft: '# edited' })}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: false, message: 'gone' })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('gone')).toBeTruthy()
    expect((await screen.findByLabelText('note.md') as HTMLTextAreaElement).value).toBe('# edited')
  })

  it('keeps a dirty draft editable and saveable after a truncated reread', async () => {
    const writeFile = vi.fn(async () => ({ ok: true as const }))
    render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => ({ text: 'v1', draft: 'edited' })}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'v1-prefix', binary: false, truncated: true })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={writeFile}
        t={t}
      />,
    )
    expect(await screen.findByText('File is too large; showing the beginning.')).toBeTruthy()
    expect((screen.getByLabelText('a.ts') as HTMLTextAreaElement).value).toBe('edited')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(writeFile).toHaveBeenCalledWith('/tmp/proj', 'a.ts', 'edited')
    })
    expect(screen.queryByText('File is too large; showing the beginning.')).toBeNull()
  })

  it('lets a dirty markdown draft switch to source after a truncated reread', async () => {
    render(
      <FilePreview
        sessionId={SID}
        relativePath="note.md"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => ({ text: '# v1', draft: '# edited' })}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: '# v1-prefix', binary: false, truncated: true })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('File is too large; showing the beginning.')).toBeTruthy()
    expect((await screen.findByLabelText('note.md') as HTMLTextAreaElement).value).toBe('# edited')
  })

  it('keeps a dirty draft editable and saveable after a binary reread', async () => {
    const writeFile = vi.fn(async () => ({ ok: true as const }))
    render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => ({ text: 'v1', draft: 'edited' })}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, binary: true, text: '' })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={writeFile}
        t={t}
      />,
    )
    expect(await screen.findByText('This binary file cannot be previewed.')).toBeTruthy()
    expect((screen.getByLabelText('a.ts') as HTMLTextAreaElement).value).toBe('edited')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(writeFile).toHaveBeenCalledWith('/tmp/proj', 'a.ts', 'edited')
    })
    expect(screen.queryByText('This binary file cannot be previewed.')).toBeNull()
  })

  it('lets a dirty markdown draft switch to source when cwd is missing', async () => {
    render(
      <FilePreview
        sessionId={SID}
        relativePath="note.md"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => ({ text: '# v1', draft: '# edited' })}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList(undefined))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: '# v1', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByText('A workspace is required to browse files.')).toBeTruthy()
    expect((await screen.findByLabelText('note.md') as HTMLTextAreaElement).value).toBe('# edited')
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not mount the editor until the first read settles', async () => {
    let resolveRead: ((value: { ok: true; text: string; binary: false }) => void) | undefined
    render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={() => new Promise(resolve => { resolveRead = resolve })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(screen.queryByLabelText('a.ts')).toBeNull()
    await act(async () => {
      resolveRead?.({ ok: true, text: 'from-disk', binary: false })
    })
    expect(await screen.findByLabelText('a.ts')).toBeTruthy()
    expect((screen.getByLabelText('a.ts') as HTMLTextAreaElement).value).toBe('from-disk')
  })

  it('refuses save once when disk diverged, then overwrites on the second save', async () => {
    let disk = 'v1'
    const writeFile = vi.fn(async (_cwd: string, _path: string, text: string) => {
      disk = text
      return { ok: true as const }
    })
    render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: disk, binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={writeFile}
        t={t}
      />,
    )
    const editor = await screen.findByLabelText('a.ts')
    fireEvent.change(editor, { target: { value: 'mine' } })
    disk = 'theirs'
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('The file changed on disk. Save again to overwrite.')).toBeTruthy()
    expect(writeFile).not.toHaveBeenCalled()
    expect((screen.getByLabelText('a.ts') as HTMLTextAreaElement).value).toBe('mine')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(writeFile).toHaveBeenCalledWith('/tmp/proj', 'a.ts', 'mine')
    })
  })

  it('does not reread while inactive and rereads on activate without dropping the draft', async () => {
    let disk = 'v1'
    const reads: string[] = []
    const buffer = { text: 'v1', draft: 'edited' }
    const preview = (active: boolean) => (
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active={active}
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => buffer}
        writeBuffer={(next) => {
          if (next === null) {
            buffer.text = ''
            buffer.draft = ''
            return
          }
          buffer.text = next.text
          buffer.draft = next.draft
        }}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => {
          reads.push(disk)
          return { ok: true, text: disk, binary: false }
        }}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />
    )
    const { rerender } = render(preview(false))
    expect(await screen.findByLabelText('a.ts')).toBeTruthy()
    expect((screen.getByLabelText('a.ts') as HTMLTextAreaElement).value).toBe('edited')
    expect(reads).toEqual([])
    disk = 'v2'
    rerender(preview(false))
    expect(reads).toEqual([])
    rerender(preview(true))
    await waitFor(() => { expect(reads).toEqual(['v2']) })
    expect((screen.getByLabelText('a.ts') as HTMLTextAreaElement).value).toBe('edited')
    expect(buffer.text).toBe('v2')
    expect(buffer.draft).toBe('edited')
  })

  it('does not save with Ctrl+S while the tab is inactive', async () => {
    const writeFile = vi.fn(async () => ({ ok: true as const }))
    render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active={false}
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => ({ text: 'x', draft: 'edited' })}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'x', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={writeFile}
        t={t}
      />,
    )
    expect(await screen.findByLabelText('a.ts')).toBeTruthy()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    })
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('autosaves the latest draft after 500ms', async () => {
    const writeFile = vi.fn(async () => ({ ok: true as const }))
    render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'x', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={writeFile}
        t={t}
      />,
    )
    const editor = await screen.findByLabelText('a.ts')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.change(editor, { target: { value: 'latest text' } })
    expect(writeFile).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(writeFile).toHaveBeenCalledWith('/tmp/proj', 'a.ts', 'latest text')
  })

  it('does not write a dirty draft when unmounted before autosave', async () => {
    const writeFile = vi.fn(async () => ({ ok: true as const }))
    const { unmount } = render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'x', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={writeFile}
        t={t}
      />,
    )
    const editor = await screen.findByLabelText('a.ts')
    fireEvent.change(editor, { target: { value: 'discarded' } })
    unmount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('does not write a discarded draft after a conflict', async () => {
    let disk = 'v1'
    const writeFile = vi.fn(async (_cwd: string, _path: string, text: string) => {
      disk = text
      return { ok: true as const }
    })
    const { unmount } = render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: disk, binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={writeFile}
        t={t}
      />,
    )
    const editor = await screen.findByLabelText('a.ts')
    fireEvent.change(editor, { target: { value: 'mine' } })
    disk = 'theirs'
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('The file changed on disk. Save again to overwrite.')).toBeTruthy()
    expect(writeFile).not.toHaveBeenCalled()
    unmount()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('shows the Source/Rendered toggle for mdx files', async () => {
    render(
      <FilePreview
        sessionId={SID}
        relativePath="notes.mdx"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: '# Notes', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByRole('button', { name: 'Rendered' })).toBeTruthy()
    expect(await screen.findByLabelText('notes.mdx')).toBeTruthy()
  })

  it('toggles word wrap to pre-wrap on the editor', async () => {
    render(
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'line', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    const editor = await screen.findByLabelText('a.ts')
    fireEvent.click(screen.getByRole('button', { name: 'Word wrap' }))
    expect(localStorage.getItem('dshd.fileWordWrap')).toBe('1')
    expect(
      editor.className.split(/\s+/).some(name => /wrap/i.test(name))
      || getComputedStyle(editor).whiteSpace === 'pre-wrap',
    ).toBe(true)
  })

  it('renders markdown preview without rewriting task checkboxes in the draft', async () => {
    render(
      <FilePreview
        sessionId={SID}
        relativePath="todo.md"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: '- [ ] milk', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Rendered' }))
    expect(await screen.findByText('milk')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    expect((await screen.findByLabelText('todo.md') as HTMLTextAreaElement).value).toBe('- [ ] milk')
  })

  it('shows project and directory crumbs in the toolbar', async () => {
    render(
      <FilePreview
        sessionId={SID}
        relativePath="src/a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'x', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    expect(await screen.findByLabelText('src/a.ts')).toBeTruthy()
    const toolbar = document.querySelector('[data-file-preview]')?.firstElementChild
    expect(toolbar?.textContent).toContain('proj')
    expect(toolbar?.textContent).toContain('src')
  })

  it('opens an html file in the preview browser from the toolbar', async () => {
    const previewWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      url: 'http://127.0.0.1:9/tok/index.html',
    }))
    ;(window as Window & { shell?: unknown }).shell = { previewWorkspaceFile }
    const events: unknown[] = []
    const onOpen = (event: Event): void => { events.push((event as CustomEvent).detail) }
    window.addEventListener('dshd-open-surface', onOpen)
    try {
      render(
        <FilePreview
          sessionId={SID}
          relativePath="index.html"
          active
          onDirtyChange={() => {}}
          registerSave={() => {}}
          readBuffer={() => undefined}
          writeBuffer={() => {}}
          useSession={neverHook}
          useSessions={sel => sel(sessionList('/tmp/proj'))}
          useWorkspaces={neverHook}
          useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
          useInput={neverHook}
          inputActions={undefined}
          listDir={async () => ({ ok: false })}
          readFile={async () => ({ ok: true, text: '<p>hi</p>', binary: false })}
          readFileMedia={async () => ({ ok: false })}
          mentionFile={() => {}}
          writeFile={async () => ({ ok: true })}
          t={t}
        />,
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Open in browser' }))
      await waitFor(() => {
        expect(previewWorkspaceFile).toHaveBeenCalledWith({
          cwd: '/tmp/proj',
          relativePath: 'index.html',
        })
        expect(events).toEqual([{ kind: 'preview', url: 'http://127.0.0.1:9/tok/index.html' }])
      })
      expect(sessionStorage.getItem('dshd-pending-preview-url')).toBe(
        'http://127.0.0.1:9/tok/index.html',
      )
    } finally {
      window.removeEventListener('dshd-open-surface', onOpen)
      sessionStorage.removeItem('dshd-pending-preview-url')
    }
  })

  it('opens a pdf file in the preview browser from the toolbar', async () => {
    const previewWorkspaceFile = vi.fn(async () => ({
      ok: true as const,
      url: 'http://127.0.0.1:9/tok/doc.pdf',
    }))
    ;(window as Window & { shell?: unknown }).shell = { previewWorkspaceFile }
    const events: unknown[] = []
    const onOpen = (event: Event): void => { events.push((event as CustomEvent).detail) }
    window.addEventListener('dshd-open-surface', onOpen)
    try {
      render(
        <FilePreview
          sessionId={SID}
          relativePath="doc.pdf"
          active
          onDirtyChange={() => {}}
          registerSave={() => {}}
          readBuffer={() => undefined}
          writeBuffer={() => {}}
          useSession={neverHook}
          useSessions={sel => sel(sessionList('/tmp/proj'))}
          useWorkspaces={neverHook}
          useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
          useInput={neverHook}
          inputActions={undefined}
          listDir={async () => ({ ok: false })}
          readFile={async () => ({ ok: true, text: '%PDF-1.4', binary: false })}
          readFileMedia={async () => ({ ok: false })}
          mentionFile={() => {}}
          writeFile={async () => ({ ok: true })}
          t={t}
        />,
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Open in browser' }))
      await waitFor(() => {
        expect(previewWorkspaceFile).toHaveBeenCalledWith({
          cwd: '/tmp/proj',
          relativePath: 'doc.pdf',
        })
        expect(events).toEqual([{ kind: 'preview', url: 'http://127.0.0.1:9/tok/doc.pdf' }])
      })
      expect(sessionStorage.getItem('dshd-pending-preview-url')).toBe(
        'http://127.0.0.1:9/tok/doc.pdf',
      )
    } finally {
      window.removeEventListener('dshd-open-surface', onOpen)
      sessionStorage.removeItem('dshd-pending-preview-url')
    }
  })

  it('scrolls the source textarea to a centered reveal line', async () => {
    const rect = {
      x: 0,
      y: 100,
      width: 200,
      height: 40,
      top: 100,
      right: 200,
      bottom: 140,
      left: 0,
      toJSON: () => ({}),
    }
    const originalRect = HTMLTextAreaElement.prototype.getBoundingClientRect
    HTMLTextAreaElement.prototype.getBoundingClientRect = () => rect
    Object.defineProperty(HTMLTextAreaElement.prototype, 'clientHeight', {
      configurable: true,
      get() { return 40 },
    })
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get() { return 2_000 },
    })
    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    const styleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = originalGetComputedStyle(element)
      if (!(element instanceof HTMLTextAreaElement)) return style
      return new Proxy(style, {
        get(target, prop, receiver) {
          if (prop === 'lineHeight') return '20px'
          return Reflect.get(target, prop, receiver)
        },
      })
    })
    try {
      render(
        <FilePreview
          sessionId={SID}
          relativePath="a.ts"
          active
          revealLine={3}
          revealRequestId={1}
          onDirtyChange={() => {}}
          registerSave={() => {}}
          readBuffer={() => undefined}
          writeBuffer={() => {}}
          useSession={neverHook}
          useSessions={sel => sel(sessionList('/tmp/proj'))}
          useWorkspaces={neverHook}
          useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
          useInput={neverHook}
          inputActions={undefined}
          listDir={async () => ({ ok: false })}
          readFile={async () => ({ ok: true, text: 'one\ntwo\nthree', binary: false })}
          readFileMedia={async () => ({ ok: false })}
          mentionFile={() => {}}
          writeFile={async () => ({ ok: true })}
          t={t}
        />,
      )
      const textarea = await screen.findByLabelText('a.ts') as HTMLTextAreaElement
      expect(textarea.value).toBe('one\ntwo\nthree')
      const expected = resolveCenteredFileLineScrollTop({
        scrollTop: 0,
        scrollHeight: 2_000,
        viewportTop: 100,
        viewportHeight: 40,
        fileTop: 0,
        estimatedLine: { top: (3 - 1) * 20, height: 20 },
      })
      expect(textarea.scrollTop).toBe(expected)
    } finally {
      HTMLTextAreaElement.prototype.getBoundingClientRect = originalRect
      Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'clientHeight')
      Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'scrollHeight')
      styleSpy.mockRestore()
    }
  })

  it('re-jumps from a scrolled textarea using fileTop 0', async () => {
    const rect = {
      x: 0,
      y: 100,
      width: 200,
      height: 40,
      top: 100,
      right: 200,
      bottom: 140,
      left: 0,
      toJSON: () => ({}),
    }
    const originalRect = HTMLTextAreaElement.prototype.getBoundingClientRect
    HTMLTextAreaElement.prototype.getBoundingClientRect = () => rect
    Object.defineProperty(HTMLTextAreaElement.prototype, 'clientHeight', {
      configurable: true,
      get() { return 40 },
    })
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get() { return 2_000 },
    })
    const originalGetComputedStyle = window.getComputedStyle.bind(window)
    const styleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = originalGetComputedStyle(element)
      if (!(element instanceof HTMLTextAreaElement)) return style
      return new Proxy(style, {
        get(target, prop, receiver) {
          if (prop === 'lineHeight') return '20px'
          return Reflect.get(target, prop, receiver)
        },
      })
    })
    const preview = (revealRequestId: number) => (
      <FilePreview
        sessionId={SID}
        relativePath="a.ts"
        active
        revealLine={3}
        revealRequestId={revealRequestId}
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'one\ntwo\nthree', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />
    )
    try {
      const view = render(preview(1))
      const textarea = await screen.findByLabelText('a.ts') as HTMLTextAreaElement
      act(() => { textarea.scrollTop = 200 })
      expect(textarea.scrollTop).toBe(200)
      view.rerender(preview(2))
      const expected = resolveCenteredFileLineScrollTop({
        scrollTop: 200,
        scrollHeight: 2_000,
        viewportTop: 100,
        viewportHeight: 40,
        fileTop: 0,
        estimatedLine: { top: (3 - 1) * 20, height: 20 },
      })
      const accumulated = resolveCenteredFileLineScrollTop({
        scrollTop: 200,
        scrollHeight: 2_000,
        viewportTop: 100,
        viewportHeight: 40,
        fileTop: 200,
        estimatedLine: { top: (3 - 1) * 20, height: 20 },
      })
      expect(accumulated).not.toBe(expected)
      await waitFor(() => {
        expect(textarea.scrollTop).toBe(expected)
      })
    } finally {
      HTMLTextAreaElement.prototype.getBoundingClientRect = originalRect
      Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'clientHeight')
      Reflect.deleteProperty(HTMLTextAreaElement.prototype, 'scrollHeight')
      styleSpy.mockRestore()
    }
  })

  it('switches markdown from rendered to source for a line reveal', async () => {
    localStorage.setItem('dshd.renderMarkdown', '1')
    render(
      <FilePreview
        sessionId={SID}
        relativePath="note.md"
        active
        revealLine={2}
        revealRequestId={1}
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: '# Hello\nsecond', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    const textarea = await screen.findByLabelText('note.md') as HTMLTextAreaElement
    expect(textarea.value).toBe('# Hello\nsecond')
    expect(screen.queryByRole('heading', { name: 'Hello' })).toBeNull()
  })

  it('adds a selected line range to the composer as a fenced file comment', async () => {
    const appendComposerText = vi.fn()
    render(
      <FilePreview
        sessionId={SID}
        relativePath="src/a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSession={neverHook}
        useSessions={sel => sel(sessionList('/tmp/proj'))}
        useWorkspaces={neverHook}
        useProjection={neverHook}
        useConversation={neverHook}
        useSessionPendingInteraction={neverHook}
        useInput={neverHook}
        inputActions={undefined}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'one\ntwo\nthree', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        appendComposerText={appendComposerText}
        writeFile={async () => ({ ok: true })}
        t={t}
      />,
    )
    const editor = await screen.findByLabelText('src/a.ts') as HTMLTextAreaElement
    expect(screen.queryByRole('button', { name: 'Add to chat' })).toBeNull()
    editor.focus()
    editor.setSelectionRange(0, 8)
    fireEvent.select(editor)
    expect(screen.getByRole('button', { name: 'Add to chat' })).toBeTruthy()
    editor.setSelectionRange(0, 0)
    fireEvent.select(editor)
    expect(screen.queryByRole('button', { name: 'Add to chat' })).toBeNull()
    editor.setSelectionRange(0, 8)
    fireEvent.select(editor)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Add to chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add to chat' }))
    expect(appendComposerText).toHaveBeenCalledTimes(1)
    const payload = appendComposerText.mock.calls[0]?.[1] as string
    expect(appendComposerText.mock.calls[0]?.[0]).toBe(SID)
    expect(payload).toContain('L1 to L2')
    expect(payload).toContain('`src/a.ts`')
    expect(payload).toContain('```text')
    expect(payload).toContain('one\ntwo')
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('button', { name: 'Add to chat' })).toBeNull()
  })
})
