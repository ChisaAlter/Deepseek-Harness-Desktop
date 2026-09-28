// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EmptyState, type EmptyStateGuide } from '../src/client/EmptyState.tsx'
import { en } from '../src/client/locales.ts'
import type { OpenableKind } from '../src/client/stores.ts'
import type { SidebarRightGuideBox } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

const t = (key: string) => (en as Record<string, string>)[key] ?? key

function box(
  id: string,
  kind: string,
  extra: Partial<SidebarRightGuideBox> = {},
  hasDescription = true,
): SidebarRightGuideBox {
  return {
    id,
    kind,
    providerId: `provider-${id}`,
    order: 0,
    title: () => `${id} title`,
    ...(hasDescription ? { description: () => `${id} description` } : {}),
    ...extra,
  }
}

function guide(entries: readonly SidebarRightGuideBox[]): EmptyStateGuide & { open: ReturnType<typeof vi.fn<(kind: string) => void>> } {
  return { entries, open: vi.fn<(kind: string) => void>() }
}

afterEach(cleanup)

describe('EmptyState', () => {
  it('renders five cards and opens the matching kind on click', () => {
    const onOpen = vi.fn<(kind: OpenableKind) => void>()
    render(<EmptyState onOpen={onOpen} t={t} />)

    fireEvent.click(screen.getByRole('button', { name: /Browser/ }))
    fireEvent.click(screen.getByRole('button', { name: /Terminal/ }))
    fireEvent.click(screen.getByRole('button', { name: /Files/ }))
    fireEvent.click(screen.getByRole('button', { name: /Diff/ }))
    fireEvent.click(screen.getByRole('button', { name: /Agents/ }))

    expect(onOpen.mock.calls.map(call => call[0])).toEqual([
      'preview', 'terminal', 'files', 'diff', 'agents',
    ])
    expect(screen.getByText('Open a local app or URL.')).toBeTruthy()
    expect(screen.getByText('Start a shell in this workspace.')).toBeTruthy()
    expect(screen.getByText('Browse and read workspace files.')).toBeTruthy()
    expect(screen.getByText('Review git changes.')).toBeTruthy()
    expect(screen.getByText('Inspect running agents.')).toBeTruthy()
  })

  it('disables the Browser card with the desktop-only reason outside the desktop app', () => {
    const onOpen = vi.fn<(kind: OpenableKind) => void>()
    render(<EmptyState onOpen={onOpen} t={t} browserAvailable={false} />)

    const browser = screen.getByRole('button', { name: /Browser/ })
    expect(browser).toHaveProperty('disabled', true)
    fireEvent.click(browser)
    expect(onOpen).not.toHaveBeenCalled()
    expect(browser.getAttribute('title')).toBe('Browser previews are only available in the desktop app.')
  })

  it('disables the Diff card with the git-repository reason when the workspace is not a git repository', () => {
    const onOpen = vi.fn<(kind: OpenableKind) => void>()
    render(<EmptyState onOpen={onOpen} t={t} diffAvailable={false} />)

    const diff = screen.getByRole('button', { name: /Diff/ })
    expect(diff).toHaveProperty('disabled', true)
    fireEvent.click(diff)
    expect(onOpen).not.toHaveBeenCalled()
    expect(diff.getAttribute('title')).toBe('Diff is only available in Git repositories.')
  })

  it('puts every card in a stretching grid cell, including disabled Browser and Diff', () => {
    render(<EmptyState onOpen={vi.fn()} t={t} browserAvailable={false} diffAvailable={false} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(5)
    for (const button of buttons) {
      expect(button.closest('[data-surfaces-card-cell]')).toBeTruthy()
    }
  })

  it('lists exactly the guide entries it is given and opens their kinds through the guide', () => {
    const onOpen = vi.fn<(kind: OpenableKind) => void>()
    const g = guide([
      box('browse', 'browser'),
      box('shell', 'terminal'),
      box('tree', 'files'),
    ])
    render(<EmptyState onOpen={onOpen} guide={g} t={t} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(3)
    expect(screen.getByText('browse title')).toBeTruthy()
    expect(screen.getByText('shell description')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /shell title/ }))
    expect(g.open).toHaveBeenCalledWith('terminal')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('keeps a card usable when its entry registers no icon or description', () => {
    const g = guide([box('plain', 'search', {}, false)])
    render(<EmptyState onOpen={vi.fn()} guide={g} t={t} />)

    const button = screen.getByRole('button', { name: /plain title/ })
    fireEvent.click(button)
    expect(g.open).toHaveBeenCalledWith('search')
  })

  it('re-renders when the mirrored entry list changes', () => {
    const g = guide([box('a', 'browser')])
    const { rerender } = render(<EmptyState onOpen={vi.fn()} guide={g} t={t} />)
    expect(screen.getAllByRole('button')).toHaveLength(1)

    const next = guide([box('a', 'browser'), box('b', 'terminal')])
    rerender(<EmptyState onOpen={vi.fn()} guide={next} t={t} />)
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })
})
