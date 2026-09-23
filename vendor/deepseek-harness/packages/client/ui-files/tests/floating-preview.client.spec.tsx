// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { FloatingPreviewButton } from '../src/client/FloatingPreviewButton.tsx'
import { floatingPreviewTarget } from '../src/client/floating-preview.ts'
import { en } from '../src/client/locales.ts'

const t = ((key: string): string => (en as Record<string, string>)[key] ?? key) as never

function sessions(rows: Record<string, { cwd?: string }>): SessionListState {
  const byId = Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, {
    id: id as SessionId,
    displayTitle: id,
    running: false,
    blank: false,
    retainedBy: { mainView: 1 },
    updatedAt: 0,
    ...(row.cwd === undefined ? {} : { cwd: row.cwd }),
  }]))
  return {
    ids: Object.keys(byId) as SessionId[],
    byId: byId as SessionListState['byId'],
    phase: 'ready',
    projectionsBySession: {},
  }
}

afterEach(() => {
  cleanup()
  delete (window as Window & { shell?: unknown }).shell
})

describe('floating preview target', () => {
  it('uses the cwd of the session named by the resource, not the main-view session', () => {
    expect(floatingPreviewTarget(
      sessionFileAddress('resource-session', 'src/a.ts'),
      sessions({ 'resource-session': { cwd: '/tmp/resource' }, 'main-session': { cwd: '/tmp/main' } }),
    )).toEqual({
      ok: true,
      request: { cwd: '/tmp/resource', relativePath: 'src/a.ts' },
    })
  })

  it('uses an absolute request for an absolute resource address', () => {
    expect(floatingPreviewTarget(
      'dsh-resource://file/absolute/tmp/outside/a.ts',
      sessions({}),
    )).toEqual({ ok: true, request: { absolutePath: '/tmp/outside/a.ts' } })
  })

  it('disables a relative address whose owning session has no cwd', () => {
    expect(floatingPreviewTarget(
      sessionFileAddress('resource-session', 'src/a.ts'),
      sessions({ 'resource-session': {} }),
    )).toEqual({ ok: false, reason: 'no-cwd' })
  })
})

describe('FloatingPreviewButton', () => {
  it('sends the exact cwd + relativePath request', async () => {
    const previewOpenFileWindow = vi.fn(async () => ({ ok: true as const }))
    ;(window as Window & { shell?: unknown }).shell = { previewOpenFileWindow }
    render(
      <FloatingPreviewButton
        resourceAddress={sessionFileAddress('resource-session', 'src/a.ts')}
        sessions={sessions({ 'resource-session': { cwd: '/tmp/resource' } })}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Floating preview' }))
    await waitFor(() => {
      expect(previewOpenFileWindow).toHaveBeenCalledWith({
        cwd: '/tmp/resource',
        relativePath: 'src/a.ts',
      })
    })
  })

  it('sends the absolutePath request when no cwd is available', async () => {
    const previewOpenFileWindow = vi.fn(async () => ({ ok: true as const }))
    ;(window as Window & { shell?: unknown }).shell = { previewOpenFileWindow }
    render(
      <FloatingPreviewButton
        resourceAddress="dsh-resource://file/absolute/tmp/a.ts"
        sessions={sessions({})}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Floating preview' }))
    await waitFor(() => {
      expect(previewOpenFileWindow).toHaveBeenCalledWith({ absolutePath: '/tmp/a.ts' })
    })
  })

  it('shows a disabled localized action when the owning session cwd is unavailable', () => {
    ;(window as Window & { shell?: unknown }).shell = { previewOpenFileWindow: vi.fn() }
    render(
      <FloatingPreviewButton
        resourceAddress={sessionFileAddress('resource-session', 'src/a.ts')}
        sessions={sessions({ 'resource-session': {} })}
        t={t}
      />,
    )
    expect((screen.getByRole('button', { name: 'Floating preview' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('hides the action without the Desktop preload capability', () => {
    render(
      <FloatingPreviewButton
        resourceAddress={sessionFileAddress('resource-session', 'src/a.ts')}
        sessions={sessions({ 'resource-session': { cwd: '/tmp/resource' } })}
        t={t}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Floating preview' })).toBeNull()
  })

  it('leaves a dirty editor untouched when the floating viewer opens', async () => {
    const previewOpenFileWindow = vi.fn(async () => ({ ok: true as const }))
    const writeFile = vi.fn(async () => ({ ok: true as const }))
    ;(window as Window & { shell?: unknown }).shell = { previewOpenFileWindow }
    const { FilePreview } = await import('../src/client/FilePreview.tsx')
    render(
      <FilePreview
        sessionId={'resource-session' as SessionId}
        relativePath="src/a.ts"
        active
        onDirtyChange={() => {}}
        registerSave={() => {}}
        readBuffer={() => undefined}
        writeBuffer={() => {}}
        useSessions={selector => selector(sessions({ 'resource-session': { cwd: '/tmp/resource' } }))}
        listDir={async () => ({ ok: false })}
        readFile={async () => ({ ok: true, text: 'disk', binary: false })}
        readFileMedia={async () => ({ ok: false })}
        mentionFile={() => {}}
        writeFile={writeFile}
        t={key => en[key as keyof typeof en] ?? key}
      />,
    )
    const editor = await screen.findByLabelText('src/a.ts') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'unsaved draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Floating preview' }))
    await waitFor(() => {
      expect(previewOpenFileWindow).toHaveBeenCalledWith({
        cwd: '/tmp/resource',
        relativePath: 'src/a.ts',
      })
    })
    expect((screen.getByLabelText('src/a.ts') as HTMLTextAreaElement).value).toBe('unsaved draft')
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('captures the target before an in-flight request so a session switch cannot redirect it', async () => {
    let release!: (result: { ok: true }) => void
    const previewOpenFileWindow = vi.fn(() => new Promise<{ ok: true }>((resolve) => { release = resolve }))
    ;(window as Window & { shell?: unknown }).shell = { previewOpenFileWindow }
    const view = render(
      <FloatingPreviewButton
        resourceAddress={sessionFileAddress('resource-session', 'src/a.ts')}
        sessions={sessions({ 'resource-session': { cwd: '/tmp/first' } })}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Floating preview' }))
    view.rerender(
      <FloatingPreviewButton
        resourceAddress={sessionFileAddress('resource-session', 'src/a.ts')}
        sessions={sessions({ 'resource-session': { cwd: '/tmp/second' } })}
        t={t}
      />,
    )
    release({ ok: true })
    await waitFor(() => {
      expect(previewOpenFileWindow).toHaveBeenCalledWith({
        cwd: '/tmp/first',
        relativePath: 'src/a.ts',
      })
    })
  })

  it.each([
    ['rejected result', async () => ({ ok: false as const })],
    ['malformed result', async () => null],
    ['thrown IPC', async () => { throw new Error('ipc down') }],
  ])('shows a visible failure for %s without any OS fallback', async (_name, open) => {
    const previewOpenFileWindow = vi.fn(open)
    ;(window as Window & { shell?: unknown }).shell = { previewOpenFileWindow }
    render(
      <FloatingPreviewButton
        resourceAddress={sessionFileAddress('resource-session', 'src/a.ts')}
        sessions={sessions({ 'resource-session': { cwd: '/tmp/resource' } })}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Floating preview' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not open the floating preview.')
    expect(previewOpenFileWindow).toHaveBeenCalledTimes(1)
  })
})
