// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { CommitDialog, type CommitDialogProps } from '../src/client/CommitDialog.tsx'
import { en } from '../src/client/locales.ts'

const t: CommitDialogProps['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (
    name in params ? String(params[name]) : match
  ))
}

afterEach(cleanup)

function mount(overrides: Partial<CommitDialogProps> = {}) {
  const props: CommitDialogProps = {
    open: true,
    branchName: 'large-bird',
    isDefaultRef: false,
    files: [{ path: 'src/demo.ts', insertions: 2, deletions: 1 }],
    excluded: new Set(),
    editing: false,
    message: '',
    t,
    onClose: vi.fn(),
    onMessage: vi.fn(),
    onToggleEdit: vi.fn(),
    onTogglePath: vi.fn(),
    onToggleAll: vi.fn(),
    onCommit: vi.fn(),
    onCommitNewRef: vi.fn(),
    ...overrides,
  }
  render(<CommitDialog {...props} />)
  return props
}

describe('CommitDialog', () => {
  it('shows branch, files, stats, and the three commit actions', () => {
    mount()
    expect(screen.getByRole('dialog', { name: 'Commit changes' })).toBeTruthy()
    expect(screen.getByText('large-bird')).toBeTruthy()
    expect(screen.getByText('src/demo.ts')).toBeTruthy()
    expect(screen.getAllByText('+2').length).toBe(2)
    expect(screen.getAllByText('-1').length).toBe(2)
    expect(screen.getAllByRole('button', { name: 'Cancel' }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Commit on new branch' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Commit' })).toBeTruthy()
  })

  it('shows none when there are no files and disables commit', () => {
    mount({ files: [] })
    expect(screen.getByText('none')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Commit' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Commit on new branch' }).disabled).toBe(true)
  })

  it('shows the default-ref warning and detached copy', () => {
    mount({ branchName: null, isDefaultRef: true })
    expect(screen.getByText('(detached HEAD)')).toBeTruthy()
    expect(screen.getByText('Warning: default branch')).toBeTruthy()
  })

  it('shows a selected-of count when some files are excluded', () => {
    mount({
      excluded: new Set(['src/demo.ts']),
      files: [
        { path: 'src/demo.ts', insertions: 2, deletions: 1 },
        { path: 'keep.ts', insertions: 1, deletions: 0 },
      ],
    })
    expect(screen.getByText('(1 of 2)')).toBeTruthy()
  })

  it('toggles edit, paths, and all; excluded rows hide stats', () => {
    const onToggleEdit = vi.fn()
    const onTogglePath = vi.fn()
    const onToggleAll = vi.fn()
    mount({
      editing: true,
      excluded: new Set(['src/demo.ts']),
      files: [
        { path: 'src/demo.ts', insertions: 2, deletions: 1 },
        { path: 'keep.ts', insertions: 1, deletions: 0 },
      ],
      onToggleEdit,
      onTogglePath,
      onToggleAll,
    })
    expect(screen.getByText('Excluded')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onToggleEdit).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'src/demo.ts' }))
    expect(onTogglePath).toHaveBeenCalledWith('src/demo.ts')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Files' }))
    expect(onToggleAll).toHaveBeenCalled()
  })

  it('marks the select-all checkbox indeterminate when some files are excluded', () => {
    mount({
      editing: true,
      excluded: new Set(['src/demo.ts']),
      files: [
        { path: 'src/demo.ts', insertions: 2, deletions: 1 },
        { path: 'keep.ts', insertions: 1, deletions: 0 },
      ],
    })
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Files' }).indeterminate).toBe(true)
  })

  it('opens excluded paths as well as selected ones', () => {
    const onOpenFile = vi.fn()
    mount({
      excluded: new Set(['src/demo.ts']),
      onOpenFile,
    })
    fireEvent.click(screen.getByRole('button', { name: 'src/demo.ts' }))
    expect(onOpenFile).toHaveBeenCalledWith('src/demo.ts')
  })

  it('forwards message edits and both commit actions', () => {
    const onMessage = vi.fn()
    const onCommit = vi.fn()
    const onCommitNewRef = vi.fn()
    const onClose = vi.fn()
    mount({ onMessage, onCommit, onCommitNewRef, onClose })
    fireEvent.change(screen.getByPlaceholderText('Leave empty to auto-generate'), { target: { value: 'fix' } })
    expect(onMessage).toHaveBeenCalledWith('fix')
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }))
    expect(onCommit).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Commit on new branch' }))
    expect(onCommitNewRef).toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[1]!)
    expect(onClose).toHaveBeenCalled()
  })

  it('opens a changed file from the review list', () => {
    const onOpenFile = vi.fn()
    mount({ onOpenFile })
    fireEvent.click(screen.getByRole('button', { name: 'src/demo.ts' }))
    expect(onOpenFile).toHaveBeenCalledWith('src/demo.ts')
  })

  it('stays silent when the host reported no oversized files', () => {
    mount({ largeFiles: [] })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Large files over 100 MB detected')).toBeNull()
  })

  it('warns with each oversized path and its size', () => {
    mount({
      largeFiles: [
        { path: 'assets/video.bin', size: 101 * 1024 * 1024 },
        { path: 'a dir/ünï code.bin', size: 100 * 1024 * 1024 + 1 },
      ],
    })
    const alert = screen.getByRole('alert')
    expect(within(alert).getByText('Large files over 100 MB detected')).toBeTruthy()
    expect(within(alert).getByText('assets/video.bin')).toBeTruthy()
    expect(within(alert).getByText('a dir/ünï code.bin')).toBeTruthy()
    // Rounded up, so a just-over-limit file never reads as "100.0 MB".
    expect(within(alert).getByText('101.0 MB')).toBeTruthy()
    expect(within(alert).getByText('100.1 MB')).toBeTruthy()
    expect(
      within(alert).getByText('GitHub rejects files over 100 MB. Cancel and add them to .gitignore or use Git LFS.'),
    ).toBeTruthy()
  })

  it('keeps commit actions enabled while warning about a large file', () => {
    mount({ largeFiles: [{ path: 'src/demo.ts', size: 150 * 1024 * 1024 }] })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Commit' }).disabled).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Commit on new branch' }).disabled).toBe(false)
  })
})
