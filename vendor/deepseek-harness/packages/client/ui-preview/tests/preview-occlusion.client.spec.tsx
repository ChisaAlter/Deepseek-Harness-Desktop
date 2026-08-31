// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PreviewPanelProps } from '../src/client/PreviewPanel.tsx'
import { PreviewPanel } from '../src/client/PreviewPanel.tsx'
import { en } from '../src/client/locales.ts'

const t: PreviewPanelProps['t'] = key => (en as Record<string, string>)[key] ?? key
const neverHook = (() => { throw new Error('preview must not read this hook') }) as never

function stubHostRect(): void {
  const host = document.querySelector('[data-preview-host]') as HTMLElement
  host.getBoundingClientRect = () => ({
    x: 800,
    y: 40,
    width: 400,
    height: 600,
    top: 40,
    left: 800,
    right: 1200,
    bottom: 640,
    toJSON() { return this },
  })
}

function mount(): {
  rerender: ReturnType<typeof render>['rerender']
  previewHide: ReturnType<typeof vi.fn>
  previewShow: ReturnType<typeof vi.fn>
  props: PreviewPanelProps
} {
  const previewHide = vi.fn(async () => {})
  const previewShow = vi.fn(async () => {})
  const sessionId = 'session-occluded' as SessionId
  const props = {
    sessionId,
    useSession: neverHook,
    useSessions: (sel: (s: { current: SessionId; byId: Record<string, { cwd?: string }> }) => unknown) =>
      sel({ current: sessionId, byId: { [sessionId]: {} } }),
    useWorkspaces: neverHook,
    useProjection: neverHook,
    active: true,
    occluded: false,
    previewAvailable: true,
    previewOpen: vi.fn(async () => ({
      ok: true,
      id: 'pv-occluded',
      url: 'http://127.0.0.1:3000',
    })),
    previewNavigate: vi.fn(async () => ({ ok: true, id: 'pv-occluded' })),
    previewBack: vi.fn(async () => ({ ok: true, id: 'pv-occluded' })),
    previewForward: vi.fn(async () => ({ ok: true, id: 'pv-occluded' })),
    previewReload: vi.fn(async () => ({ ok: true, id: 'pv-occluded' })),
    previewState: vi.fn(async () => ({ ok: true, id: 'pv-occluded' })),
    onPreviewStateChange: () => () => {},
    previewOpenDevTools: vi.fn(async () => ({ ok: true, id: 'pv-occluded' })),
    previewDiscover: vi.fn(async () => []),
    openExternal: vi.fn(async () => {}),
    previewResize: vi.fn(async () => {}),
    previewHide,
    previewShow,
    previewClose: vi.fn(async () => {}),
    t,
  } as unknown as PreviewPanelProps
  const view = render(
    <PreviewPanel {...props} />,
  )
  return { rerender: view.rerender, previewHide, previewShow, props }
}

class ResizeObserverStub {
  constructor(_callback: ResizeObserverCallback) {}
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PreviewPanel native guest occlusion', () => {
  it('hides the native guest while renderer chrome is open and restores it afterward', async () => {
    const b = mount()
    stubHostRect()
    fireEvent.change(screen.getByRole('textbox', { name: 'Browser' }), {
      target: { value: 'http://127.0.0.1:3000' },
    })
    fireEvent.submit(document.querySelector('[data-preview-toolbar]') as HTMLFormElement)
    await waitFor(() => {
      expect(b.previewShow).toHaveBeenCalledWith('pv-occluded', expect.objectContaining({ width: 400, height: 600 }))
    })

    const hideCalls = b.previewHide.mock.calls.length
    b.props.occluded = true
    b.rerender(<PreviewPanel {...b.props} />)
    await waitFor(() => {
      expect(b.previewHide.mock.calls.length).toBeGreaterThan(hideCalls)
    })

    const showCalls = b.previewShow.mock.calls.length
    b.props.occluded = false
    b.rerender(<PreviewPanel {...b.props} />)
    await waitFor(() => {
      expect(b.previewShow.mock.calls.length).toBeGreaterThan(showCalls)
    })
  })

  it('hides the native guest while the More menu is open', async () => {
    const b = mount()
    stubHostRect()
    fireEvent.change(screen.getByRole('textbox', { name: 'Browser' }), {
      target: { value: 'http://127.0.0.1:3000' },
    })
    fireEvent.submit(document.querySelector('[data-preview-toolbar]') as HTMLFormElement)
    await waitFor(() => {
      expect(b.previewShow).toHaveBeenCalled()
    })
    const hideCalls = b.previewHide.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    await waitFor(() => {
      expect(b.previewHide.mock.calls.length).toBeGreaterThan(hideCalls)
    })
    expect(screen.getByRole('menuitem', { name: 'Developer tools' })).toBeTruthy()
  })
})
