// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { createBrowserControllers } from '../src/client/browser/BrowserController.ts'
import type { BrowserFrameState } from '../src/client/browser/BrowserFrame.ts'
import { createBrowserStore } from '../src/client/browser/store.ts'
import type { BrowserBodyProps } from '../src/client/view/BrowserBody.tsx'
import { BrowserBody, WEB_BROWSER_SANDBOX } from '../src/client/view/BrowserBody.tsx'
import { zh } from '../src/client/locales.ts'

const SESSION = 'session' as SessionId
const TAB = 'tab' as TabId
const lifetimes = new Set<AbortController>()
let mountSequence = 0

function hookOf<T>(store: { subscribe(listener: () => void): () => void; getSnapshot(): T }) {
  return function useSelector<S>(select: (state: T) => S): S {
    return select(useSyncExternalStore(
      listener => store.subscribe(listener),
      () => store.getSnapshot(),
    ))
  }
}

const absentFrame = {
  subscribe: (_listener: () => void): (() => void) => () => {},
  getSnapshot: (): BrowserFrameState | undefined => undefined,
}

function mountBrowser(navigation?: { readonly url?: string }) {
  const store = createBrowserStore().create(`browser-body-test-${String(++mountSequence)}`)
  const lifetime = new AbortController()
  lifetimes.add(lifetime)
  const injected = createBrowserControllers(store.actions)
  const { keyedHooks, ...commands } = injected
  const props = {
    sessionId: SESSION,
    useSessions: vi.fn(),
    useResource: vi.fn(),
    useWorkspaces: vi.fn(),
    usePanelInfo: vi.fn(),
    useSessionPendingInteraction: vi.fn(),
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false }, panel: { id: 'pane' },
      tab: {
        id: TAB, kind: 'browser', title: 'Browser', contentId: 'sidebar://browser/1', visible: true,
        navigation: { address: 'sidebar://browser/1', params: navigation, revision: 0 },
        signal: lifetime.signal,
        actions: { openResource: vi.fn(), openTab: vi.fn(), close: vi.fn() },
      },
    }),
    useStore: hookOf(store),
    actions: store.actions,
    t: (key: keyof typeof zh, params?: Record<string, unknown>) => params === undefined
      ? zh[key] : zh[key].replace('{message}', String(params.message)),
    ...commands,
    useBrowserFrame: (key: string) => {
      const frame = keyedHooks.browserFrame(key) ?? absentFrame
      return useSyncExternalStore(frame.subscribe, frame.getSnapshot)
    },
  } as unknown as BrowserBodyProps
  const renderBody = () => render(<BrowserBody {...props} />)
  return {
    view: renderBody(), remount: renderBody, store, lifetime, injected,
  }
}

afterEach(() => {
  cleanup()
  for (const lifetime of lifetimes) lifetime.abort()
  lifetimes.clear()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('BrowserBody', () => {
  it('routes address input to the controller and renders parser failures', async () => {
    const mounted = mountBrowser()
    const input = mounted.view.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => { expect(mounted.view.getByRole('alert').textContent).toBe(zh['error.protocol']) })
    expect(input).toHaveProperty('value', 'javascript:alert(1)')
    expect(mounted.view.container.querySelector('iframe')).toBeNull()
    fireEvent.change(input, { target: { value: 'file:///work/index.html' } })
    fireEvent.submit(input.closest('form')!)
    expect(mounted.view.getByRole('alert').textContent).toBe(zh['error.protocol'])
  })

  it('renders HTTPS in the fixed sandbox and follows controller history', async () => {
    const mounted = mountBrowser()
    const input = mounted.view.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'example.com/one' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => { expect(mounted.view.container.querySelector('iframe')).not.toBeNull() })
    expect(input).toHaveProperty('value', 'https://example.com/one')
    let frame = mounted.view.container.querySelector('iframe')!
    expect(frame.getAttribute('src')).toBe('https://example.com/one')
    expect(frame.getAttribute('sandbox')).toBe(WEB_BROWSER_SANDBOX)
    expect(frame.getAttribute('allow')).toBeNull()
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
    const disableSandbox = mounted.view.getByRole('button', { name: zh['sandbox.disable'] })
    const protectedMark = disableSandbox.querySelector('svg path:last-child')?.getAttribute('d')
    fireEvent.click(disableSandbox)
    await waitFor(() => { expect(mounted.view.container.querySelector('iframe')?.getAttribute('sandbox')).toBeNull() })
    expect(mounted.view.getByRole('status').textContent).toBe(zh['sandbox.warning'])
    const enableSandbox = mounted.view.getByRole('button', { name: zh['sandbox.enable'] })
    expect(enableSandbox.querySelector('svg path:last-child')?.getAttribute('d')).not.toBe(protectedMark)
    fireEvent.click(enableSandbox)
    await waitFor(() => { expect(mounted.view.container.querySelector('iframe')?.getAttribute('sandbox')).toBe(WEB_BROWSER_SANDBOX) })
    expect(mounted.view.getByRole('button', { name: zh['sandbox.disable'] }).querySelector('svg path:last-child')?.getAttribute('d')).toBe(protectedMark)

    fireEvent.change(input, { target: { value: 'https://example.com/two' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => { expect(mounted.view.container.querySelector('iframe')?.getAttribute('src')).toBe('https://example.com/two') })
    fireEvent.click(mounted.view.getByRole('button', { name: zh.back }))
    await waitFor(() => { expect(mounted.view.container.querySelector('iframe')?.getAttribute('src')).toBe('https://example.com/one') })
    expect(input).toHaveProperty('value', 'https://example.com/one')
    frame = mounted.view.container.querySelector('iframe')!
    expect(frame.getAttribute('src')).toBe('https://example.com/one')
    expect(mounted.store.getSnapshot().byTab[TAB]?.index).toBe(0)
    fireEvent.click(mounted.view.getByRole('button', { name: zh.forward }))
    await waitFor(() => { expect(mounted.view.container.querySelector('iframe')?.getAttribute('src')).toBe('https://example.com/two') })
    expect(input).toHaveProperty('value', 'https://example.com/two')

    const beforeReload = mounted.store.getSnapshot().byTab[TAB]!.request!.revision
    fireEvent.click(mounted.view.getByRole('button', { name: zh.reload }))
    expect(mounted.store.getSnapshot().byTab[TAB]!.request?.revision).toBe(beforeReload + 1)
    fireEvent.submit(input.closest('form')!)
    expect(mounted.store.getSnapshot().byTab[TAB]!.request?.revision).toBe(beforeReload + 2)
  })

  it('marks later frame loads unknown and limits unsafe toolbar actions', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const mounted = mountBrowser()
    const input = mounted.view.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'https://example.com/one' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => { expect(mounted.view.container.querySelector('iframe')).not.toBeNull() })
    fireEvent.change(input, { target: { value: 'https://example.com/two' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => { expect(mounted.view.container.querySelector('iframe')?.getAttribute('src')).toBe('https://example.com/two') })
    const frame = mounted.view.container.querySelector('iframe')!
    const revision = mounted.store.getSnapshot().byTab[TAB]!.request!.revision

    fireEvent.load(frame)
    expect(mounted.store.getSnapshot().byTab[TAB]?.navigation).toEqual({ status: 'known', revision })
    expect(mounted.view.getByRole('button', { name: zh.back })).toHaveProperty('disabled', false)
    fireEvent.load(frame)
    expect(mounted.store.getSnapshot().byTab[TAB]?.navigation).toEqual({ status: 'unknown', revision })
    expect(mounted.view.getByText(zh['address.changed'])).toBeDefined()
    expect(mounted.view.getByRole('button', { name: zh.back })).toHaveProperty('disabled', true)
    expect(mounted.view.getByRole('button', { name: zh.forward })).toHaveProperty('disabled', true)
    expect(mounted.view.getByRole('button', { name: zh.external })).toHaveProperty('disabled', true)
    expect(mounted.view.getByRole('button', { name: zh.reload })).toHaveProperty('disabled', false)
    fireEvent.click(mounted.view.getByRole('button', { name: zh.external }))
    expect(open).not.toHaveBeenCalled()

    fireEvent.click(mounted.view.getByRole('button', { name: zh.reload }))
    expect(mounted.store.getSnapshot().byTab[TAB]?.navigation).toEqual({ status: 'loading', revision: revision + 1 })
  })

  it('shows a best-effort iframe error notice until the next controlled load', async () => {
    const mounted = mountBrowser()
    const input = mounted.view.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'https://example.com/one' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => { expect(mounted.view.container.querySelector('iframe')).not.toBeNull() })
    const failedRevision = mounted.store.getSnapshot().byTab[TAB]!.request!.revision

    act(() => { mounted.injected.reportLoadFailed(TAB, failedRevision) })
    expect(mounted.injected.keyedHooks.browserFrame(TAB)?.getSnapshot().loadFailed).toBe(true)
    await waitFor(() => { expect(mounted.view.getByText(zh['web.loadFailed'])).toBeDefined() })
    fireEvent.click(mounted.view.getByRole('button', { name: zh.reload }))
    await waitFor(() => { expect(mounted.view.queryByText(zh['web.loadFailed'])).toBeNull() })
    act(() => { mounted.injected.reportLoadFailed(TAB, failedRevision) })
    expect(mounted.view.queryByText(zh['web.loadFailed'])).toBeNull()
  })

  it('loads loopback under the default sandbox and keeps it across sandbox changes', async () => {
    const mounted = mountBrowser()
    const input = mounted.view.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'http://localhost:5173/' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => { expect(mounted.view.container.querySelector('iframe')?.getAttribute('src')).toBe('http://localhost:5173/') })
    expect(mounted.view.container.querySelector('iframe')?.getAttribute('sandbox')).toBe(WEB_BROWSER_SANDBOX)

    fireEvent.click(mounted.view.getByRole('button', { name: zh['sandbox.disable'] }))
    await waitFor(() => { expect(mounted.view.container.querySelector('iframe')?.getAttribute('sandbox')).toBeNull() })
    fireEvent.click(mounted.view.getByRole('button', { name: zh['sandbox.enable'] }))
    await waitFor(() => { expect(mounted.view.container.querySelector('iframe')?.getAttribute('sandbox')).toBe(WEB_BROWSER_SANDBOX) })
    expect(mounted.view.container.querySelector('iframe')?.getAttribute('src')).toBe('http://localhost:5173/')
  })

  it('opens known Web targets externally and consumes an initial typed navigation', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const mounted = mountBrowser({ url: 'https://initial.example/path' })
    const input = mounted.view.getByRole('textbox') as HTMLInputElement
    await waitFor(() => { expect(input.value).toBe('https://initial.example/path') })
    await waitFor(() => { expect(mounted.view.container.querySelector('iframe')).not.toBeNull() })
    fireEvent.click(mounted.view.getByRole('button', { name: zh.external }))
    expect(open).toHaveBeenCalledWith('https://initial.example/path', '_blank', 'noopener,noreferrer')
  })

  it('keeps a rejected initial URL in the address input for editing', async () => {
    const mounted = mountBrowser({ url: 'file:/work/index.html' })
    const input = mounted.view.getByRole('textbox')
    await waitFor(() => { expect(mounted.view.getByRole('alert').textContent).toBe(zh['error.protocol']) })
    expect(input).toHaveProperty('value', 'file:/work/index.html')
    expect(mounted.view.container.querySelector('iframe')).toBeNull()
  })

  it('reloads the latest controlled URL instead of replaying the initial URL after remount', async () => {
    const mounted = mountBrowser({ url: 'https://initial.example/path' })
    const input = mounted.view.getByRole('textbox')
    await waitFor(() => { expect(mounted.view.container.querySelector('iframe')?.getAttribute('src')).toBe('https://initial.example/path') })
    fireEvent.change(input, { target: { value: 'https://latest.example/path' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => { expect(mounted.view.container.querySelector('iframe')?.getAttribute('src')).toBe('https://latest.example/path') })

    mounted.view.unmount()
    const remounted = mounted.remount()
    await waitFor(() => { expect(remounted.container.querySelector('iframe')?.getAttribute('src')).toBe('https://latest.example/path') })
    expect(remounted.getByRole('textbox')).toHaveProperty('value', 'https://latest.example/path')
    expect(mounted.store.getSnapshot().byTab[TAB]?.entries.at(-1)?.url).toBe('https://latest.example/path')
  })

})
