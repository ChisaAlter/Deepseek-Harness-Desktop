// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { BrowserController, createBrowserControllers } from '../src/client/browser/BrowserController.ts'
import { createBrowserStore } from '../src/client/browser/store.ts'

const TAB = 'tab' as TabId
const APP = 'https://dsh.example'
const lifetimes = new Set<AbortController>()

function lifetime(): AbortController {
  const controller = new AbortController()
  lifetimes.add(controller)
  return controller
}

afterEach(() => {
  for (const controller of lifetimes) controller.abort()
  lifetimes.clear()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('BrowserController', () => {
  it('ignores navigation commands after its tab occurrence ends', () => {
    const store = createBrowserStore().create('browser-controller-ended-test')
    const tabLifetime = lifetime()
    const controller = new BrowserController({
      tabId: TAB, signal: tabLifetime.signal, applicationOrigin: APP, actions: store.actions,
    })
    tabLifetime.abort()

    controller.loadUrl('https://ignored.example/')
    controller.goBack()
    controller.goForward()
    controller.reload()
    controller.frame.reportLoaded(1)
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('owns the four navigation commands and frame load state', () => {
    const store = createBrowserStore().create('browser-controller-test')
    const face = createBrowserControllers(store.actions)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    const frame = face.keyedHooks.browserFrame(TAB)!
    face.mount(TAB, tabLifetime.signal, APP)
    expect(face.keyedHooks.browserFrame(TAB)).toBe(frame)
    face.goBack(TAB)
    face.goForward(TAB)
    face.reload(TAB)

    face.loadUrl(TAB, 'https://example.test/one')
    const first = frame.getSnapshot().document!
    expect(first.src).toBe('https://example.test/one')
    face.reportLoaded(TAB, first.revision - 1)
    face.reportLoaded(TAB, first.revision)
    expect(store.getSnapshot().byTab[TAB]?.navigation.status).toBe('known')
    face.reportLoaded(TAB, first.revision)
    expect(store.getSnapshot().byTab[TAB]?.navigation.status).toBe('unknown')
    face.goBack(TAB)
    face.goForward(TAB)
    expect(store.getSnapshot().byTab[TAB]?.navigation.status).toBe('unknown')

    face.loadUrl(TAB, 'https://example.test/two')
    face.goBack(TAB)
    expect(frame.getSnapshot().document?.target.url).toBe('https://example.test/one')
    face.goForward(TAB)
    expect(frame.getSnapshot().document?.target.url).toBe('https://example.test/two')
    const beforeReload = store.getSnapshot().byTab[TAB]!.request!.revision
    face.reload(TAB)
    expect(store.getSnapshot().byTab[TAB]?.request?.revision).toBe(beforeReload + 1)
    face.loadUrl(TAB, 'https://example.test/two')
    expect(store.getSnapshot().byTab[TAB]?.request?.revision).toBe(beforeReload + 2)

    tabLifetime.abort()
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
    face.reportLoaded(TAB, first.revision)
    face.loadUrl(TAB, 'https://ignored.example/')
    face.goBack(TAB)
    face.goForward(TAB)
    face.reload(TAB)
  })

  it('does not let an old occurrence delete a replacement controller', () => {
    const store = createBrowserStore().create('browser-controller-replacement-test')
    const face = createBrowserControllers(store.actions)
    const first = lifetime()
    const second = lifetime()
    face.mount(TAB, first.signal, APP)
    const original = face.keyedHooks.browserFrame(TAB)
    face.mount(TAB, second.signal, APP)
    const replacement = face.keyedHooks.browserFrame(TAB)
    expect(replacement).not.toBe(original)
    first.abort()
    expect(store.getSnapshot().byTab[TAB]).toBeUndefined()
    face.loadUrl(TAB, 'https://example.test/')
    expect(store.getSnapshot().byTab[TAB]).toBeDefined()
    face.mount(TAB, second.signal, APP)
    expect(face.keyedHooks.browserFrame(TAB)).toBe(replacement)
  })

  it('loads loopback under sandbox and reloads it across sandbox changes', () => {
    const store = createBrowserStore().create('browser-controller-loopback-test')
    const face = createBrowserControllers(store.actions)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)
    const frame = face.keyedHooks.browserFrame(TAB)!

    face.loadUrl(TAB, 'http://localhost:5173/app')
    expect(frame.getSnapshot()).toMatchObject({
      sandboxed: true,
      document: { src: 'http://localhost:5173/app' },
    })
    const beforeToggle = store.getSnapshot().byTab[TAB]!.request!.revision

    face.toggleSandbox(TAB)
    expect(frame.getSnapshot().sandboxed).toBe(false)
    expect(frame.getSnapshot().document?.src).toBe('http://localhost:5173/app')
    expect(store.getSnapshot().byTab[TAB]?.request?.revision).toBe(beforeToggle + 1)

    face.toggleSandbox(TAB)
    expect(frame.getSnapshot()).toMatchObject({
      sandboxed: true,
      document: { src: 'http://localhost:5173/app' },
    })
    expect(store.getSnapshot().byTab[TAB]?.request?.revision).toBe(beforeToggle + 2)
  })

  it('loads public HTTP without changing the sandbox policy', () => {
    const store = createBrowserStore().create('browser-controller-http-test')
    const face = createBrowserControllers(store.actions)
    const tabLifetime = lifetime()
    face.mount(TAB, tabLifetime.signal, APP)

    face.loadUrl(TAB, 'http://example.test/path')
    expect(face.keyedHooks.browserFrame(TAB)?.getSnapshot()).toMatchObject({
      sandboxed: true,
      document: { src: 'http://example.test/path' },
    })
  })
})
