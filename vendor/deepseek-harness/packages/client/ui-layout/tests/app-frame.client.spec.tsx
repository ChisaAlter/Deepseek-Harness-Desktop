// @vitest-environment jsdom
/**
 * AppFrame interaction spec under the four-share props form: real layout
 * store instance (createLayoutStore().create() — the test-sanctioned engine
 * path), a recording renderSlot stub, and a render-prop SessionProvider stub
 * (the real one is framework-wired to the renderer host; its own behavior is
 * ui-renderer's spec territory). Drag sequences (pointer capture + rAF flush),
 * concession response to viewport change, and details staying mounted at
 * zero width are the preserved behavior assertions. jsdom has no layout
 * engine, so the frame width comes from a mocked getBoundingClientRect and
 * resizes are driven through the ResizeObserver stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { AppFrame } from '@deepseek-ai/dsh-client-ui-layout/src/client/AppFrame.tsx'
import type { AppFrameProps } from '@deepseek-ai/dsh-client-ui-layout/src/client/AppFrame.tsx'
import { PHONE_DRAWER, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT } from '@deepseek-ai/dsh-client-ui-layout/src/client/columns.ts'
import { createLayoutStore } from '@deepseek-ai/dsh-client-ui-layout/src/client/stores.ts'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

// Session selection controls for the SessionProvider and useSessions stubs.
const selectedSession = { current: 's-test' as SessionId | undefined }
const selectedSessionBlank = { current: false }
const selectedSessionTitle = { current: undefined as string | undefined }
const workspacesReady = { current: true }
type AttentionSnapshot = Parameters<Parameters<AppFrameProps['useSessionPendingInteraction']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionPendingInteraction: AppFrameProps['useSessionPendingInteraction'] = selector => selector(noAttention)

// Render-prop contract stub fed through the standard seat prop (the renderer
// injects the real one in production): session mode runs children(id), empty
// mode runs the empty branch — the frame must work against exactly this
// shape. Typed as the seat's own component type so the branded sessionId
// parameter stays contract-checked.
const SessionProviderStub: AppFrameProps['SessionProvider'] = ({ children, empty }) =>
  selectedSession.current === undefined ? <>{empty?.() ?? null}</> : <>{children}</>


/** Observer stub: captures every instance so tests can fire resizes manually. */
const observerInstances = new Set<ResizeObserverStub>()
let fireResize: (() => void) | null = null
class ResizeObserverStub {
  #cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) { this.#cb = cb }
  observe(): void {
    observerInstances.add(this)
    fireResize = () => {
      for (const observer of observerInstances) observer.#cb([], observer)
    }
  }
  unobserve(): void {}
  disconnect(): void {
    observerInstances.delete(this)
    if (observerInstances.size === 0) fireResize = null
  }
}

let frameWidth = 1920
let initialWindowWidth: number | undefined
let trailingClusterWidth = 0
let orientationLandscape = true
const orientationListeners = new Set<(ev: MediaQueryListEvent) => void>()

/** Physical screen box used by readDeviceLandscape (keyboard-safe). */
function stubScreenAvail(width: number, height: number): void {
  Object.defineProperty(window.screen, 'availWidth', { configurable: true, value: width })
  Object.defineProperty(window.screen, 'availHeight', { configurable: true, value: height })
}

/** Test-local selector hook over a framework-neutral store instance. */
function hookOf<T>(inst: { subscribe: (fn: () => void) => () => void; getSnapshot: () => T }) {
  return function useSelector<S>(sel: (s: T) => S): S { return sel(useSyncExternalStore(inst.subscribe, inst.getSnapshot)) }
}

function mountFrame() {
  window.innerWidth = initialWindowWidth ?? frameWidth // first-render viewport source before the observer fires
  const instance = createLayoutStore().create()
  const slotCalls: { key: string; props: unknown }[] = []
  const renderSlot = ((key: string, owner: object) => {
    slotCalls.push({ key, props: owner })
    if (key === 'sidebar') return <div data-testid="sidebar-content" />
    if (key === 'conversation') return <div data-testid="center-content" />
    if (key === 'details') return <div data-testid="details-content" />
    if (key === 'surfaces') return <div data-testid="surfaces-content" />
    if (key === 'shell.terminalDrawer') return <div data-testid="terminal-drawer-content" />
    if (key === 'shell.titlebar.trailing') return <div data-testid="titlebar-trailing-content" />
    if (key === 'conversation.empty') return <div data-testid="empty-content" />
    return <div data-testid="other-content" />
  }) as AppFrameProps['renderSlot']
  const useSessions = ((sel: (s: SessionListState) => unknown) => {
    const current = selectedSession.current
    const sessionState = {
      ids: current === undefined ? [] : [current],
      byId: current === undefined
        ? {}
        : {
          [current]: {
            id: current,
            displayTitle: 'Test',
            running: false,
            blank: selectedSessionBlank.current,
            updatedAt: 1,
            ...(selectedSessionTitle.current === undefined ? {} : { title: selectedSessionTitle.current }),
          },
        },
      current,
      phase: 'ready',
    } as SessionListState
    return sel(sessionState)
  }) as never
  const workspaceState: WorkspaceSnapshot = {
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    ...(workspacesReady.current ? {} : { state: 'loading' as const, phase: 'pending' as const }),
  }
  const element = () => (
    <AppFrame
      useStore={hookOf(instance)}
      actions={instance.actions}
      renderSlot={renderSlot}
      useSessions={useSessions}
      useSessionPendingInteraction={useSessionPendingInteraction}
      useWorkspaces={((sel: (s: WorkspaceSnapshot) => unknown) => sel(workspaceState)) as never}
      SessionProvider={SessionProviderStub}
      t={key => key === 'brand.localBuild' ? 'DSH Local Build' : key}
    />
  )
  const utils = render(element())
  const frame = utils.container.firstElementChild as HTMLElement
  return { instance, frame, slotCalls, rerenderFrame: () => { utils.rerender(element()) }, ...utils }
}

function tracks(frame: HTMLElement): number[] {
  const m = /^(\d+)px minmax\(0, 1fr\) (\d+)px (\d+)px$/.exec(frame.style.gridTemplateColumns)
  if (m === null) throw new Error(`unexpected template: ${frame.style.gridTemplateColumns}`)
  return [Number(m[1]), Number(m[2])]
}

function surfacesTrack(frame: HTMLElement): number {
  const m = /^(\d+)px minmax\(0, 1fr\) (\d+)px (\d+)px$/.exec(frame.style.gridTemplateColumns)
  if (m === null) throw new Error(`unexpected template: ${frame.style.gridTemplateColumns}`)
  return Number(m[3])
}

function drawerTrack(frame: HTMLElement): number {
  const m = /^auto minmax\(0, 1fr\) (\d+)px$/.exec(frame.style.gridTemplateRows)
  if (m === null) throw new Error(`unexpected rows: ${frame.style.gridTemplateRows}`)
  return Number(m[1])
}

function drag(handle: Element, fromX: number, toX: number): void {
  const down = new PointerEvent('pointerdown', { pointerId: 1, clientX: fromX, bubbles: true })
  const move = new PointerEvent('pointermove', { pointerId: 1, clientX: toX, bubbles: true })
  const up = new PointerEvent('pointerup', { pointerId: 1, clientX: toX, bubbles: true })
  act(() => { handle.dispatchEvent(down) })
  act(() => { handle.dispatchEvent(move); vi.advanceTimersByTime(20) })
  act(() => { handle.dispatchEvent(up) })
}

beforeEach(() => {
  localStorage.clear()
  frameWidth = 1920
  initialWindowWidth = undefined
  trailingClusterWidth = 0
  observerInstances.clear()
  fireResize = null
  orientationLandscape = true
  orientationListeners.clear()
  selectedSession.current = 's-test' as SessionId
  selectedSessionBlank.current = false
  selectedSessionTitle.current = undefined
  workspacesReady.current = true
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => { cb(0) }, 16) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', (h: number) => { clearTimeout(h) })
  window.innerWidth = frameWidth
  stubScreenAvail(orientationLandscape ? 1920 : 390, orientationLandscape ? 1080 : 844)
  window.matchMedia = ((query: string) => ({
    get matches() {
      if (query.includes('landscape')) return orientationLandscape
      if (query.includes('portrait')) return !orientationLandscape
      return false
    },
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: EventListener) => {
      if (query.includes('landscape')) orientationListeners.add(listener)
    },
    removeEventListener: (_type: string, listener: EventListener) => {
      orientationListeners.delete(listener)
    },
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia
  Element.prototype.getBoundingClientRect = function () {
    if (this instanceof HTMLElement && this.id === 'dshd-shell-titlebar-trailing') {
      return {
        width: trailingClusterWidth, height: 32, top: 12, left: 0,
        right: trailingClusterWidth, bottom: 44, x: 0, y: 12, toJSON: () => ({}),
      }
    }
    return { width: frameWidth, height: 1080, top: 0, left: 0, right: frameWidth, bottom: 1080, x: 0, y: 0, toJSON: () => ({}) }
  }
  // jsdom lacks pointer capture: emulate per-element so hasPointerCapture gates pass.
  const captured = new WeakSet<Element>()
  Element.prototype.setPointerCapture = function () { captured.add(this) }
  Element.prototype.releasePointerCapture = function () { captured.delete(this) }
  Element.prototype.hasPointerCapture = function () { return captured.has(this) }
})

afterEach(() => {
  cleanup()
  document.title = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  Reflect.deleteProperty(window.screen, 'orientation')
})

describe('AppFrame', () => {
  it('localizes the product title when the build does not supply one', () => {
    mountFrame()
    expect(document.title).toBe('DSH Local Build')
  })

  it('projects the selected durable Session title', () => {
    vi.stubEnv('DSH_CLIENT_TITLE', 'Product')
    selectedSessionTitle.current = 'First'
    const { rerenderFrame } = mountFrame()
    expect(document.title).toBe('First — Product')

    selectedSessionTitle.current = 'Revised'
    act(() => { rerenderFrame() })
    expect(document.title).toBe('Revised — Product')

    selectedSession.current = undefined
    act(() => { rerenderFrame() })
    expect(document.title).toBe('Product')
  })

  it('renders three tracks from store state', () => {
    const { frame } = mountFrame()
    expect(tracks(frame)).toEqual([280, 0])
  })

  it('renders the session pair with empty owner shares (sessionId is framework-standard)', () => {
    const { slotCalls, getByTestId } = mountFrame()
    expect(getByTestId('center-content')).toBeTruthy()
    expect(getByTestId('details-content')).toBeTruthy()
    const keys = slotCalls.map(c => c.key)
    expect(keys).toContain('conversation')
    expect(keys).toContain('details')
    expect(keys).not.toContain('conversation.empty')
    expect(slotCalls.find(c => c.key === 'conversation')!.props).toEqual({})
    expect(slotCalls.find(c => c.key === 'details')!.props).toEqual({})
  })

  it('keeps the conversation slot mounted while no session is current', () => {
    // No current session: the session-maybe conversation shell owns the New
    // Session view itself — the center column renders it unconditionally.
    selectedSession.current = undefined
    const { slotCalls, getByTestId } = mountFrame()
    expect(getByTestId('center-content')).toBeTruthy()
    expect(slotCalls.map(c => c.key)).toContain('conversation')
  })

  it('renders both column occupants before baselines settle (no loading gate)', () => {
    // No loading gate: a bare loading status reads worse than the shell's own
    // pending rendering — both occupants mount from first paint.
    workspacesReady.current = false
    const { slotCalls } = mountFrame()
    expect(slotCalls.map(c => c.key)).toContain('conversation')
    expect(slotCalls.map(c => c.key)).toContain('details')
  })

  it('ignores unselected states and closes only when the Session id changes', () => {
    const { frame, instance, rerenderFrame } = mountFrame()
    expect(tracks(frame)).toEqual([280, 0])

    act(() => { instance.actions.openDetails() })
    expect(tracks(frame)).toEqual([280, 360])

    selectedSession.current = 's-next' as SessionId
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([280, 0])

    act(() => { instance.actions.openDetails() })
    selectedSession.current = 's-blank' as SessionId
    selectedSessionBlank.current = true
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([280, 0])
    expect(instance.getSnapshot().details).toBe(360)

    selectedSession.current = 's-next' as SessionId
    selectedSessionBlank.current = false
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([280, 360])

    selectedSession.current = undefined
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([280, 0])
    selectedSession.current = 's-test' as SessionId
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([280, 0])
  })

  it('keeps details closed when the first Session materializes', () => {
    selectedSession.current = undefined
    const { frame, instance, rerenderFrame } = mountFrame()
    expect(tracks(frame)).toEqual([280, 0])
    expect(instance.getSnapshot().details).toBe(0)

    selectedSession.current = 's-first' as SessionId
    act(() => { rerenderFrame() })
    expect(tracks(frame)).toEqual([280, 0])
  })

  it('sidebar slot receives live concession output as owner props', () => {
    const { slotCalls } = mountFrame()
    expect(slotCalls.find(c => c.key === 'sidebar')!.props).toEqual({ collapsed: false, width: 280 })
  })

  it('sidebar drag widens through rAF-batched pointer moves', () => {
    const { frame } = mountFrame()
    const handles = frame.querySelectorAll('[class*="handle"]')
    drag(handles[0]!, 280, 350)
    expect(tracks(frame)[0]).toBe(350)
  })

  it('details drag widens leftward (negative dx grows the panel)', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openDetails() })
    const handles = frame.querySelectorAll('[class*="handle"]')
    drag(handles[1]!, 1560, 1500)
    expect(tracks(frame)[1]).toBe(420)
  })

  it('drag base is the rendered (concession-clamped) width, not the preference', () => {
    frameWidth = 1250 // step-2 squeeze: details renders 330 while preference is 360
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openDetails() })
    expect(tracks(frame)).toEqual([280, 330])
    const handles = frame.querySelectorAll('[class*="handle"]')
    drag(handles[1]!, 920, 930) // shrink by 10 from the rendered width
    expect(instance.getSnapshot().details).toBe(320)
  })

  it('details column stays mounted at zero width', () => {
    const { frame, getByTestId } = mountFrame()
    expect(tracks(frame)).toEqual([280, 0])
    expect(getByTestId('details-content')).toBeTruthy()
    expect(frame.hasAttribute('data-details-collapsed')).toBe(true)
  })

  it('closed sidebar keeps its compact rail with mounted slot content and collapsed owner props', () => {
    const { frame, instance, slotCalls, getByTestId } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([SIDEBAR_COLLAPSED, 0])
    expect(getByTestId('sidebar-content')).toBeTruthy()
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(true)
    const lastSidebarCall = slotCalls.filter(c => c.key === 'sidebar').at(-1)!
    expect(lastSidebarCall.props).toEqual({ collapsed: true, width: SIDEBAR_COLLAPSED })
  })

  it('viewport shrink triggers the concession chain via ResizeObserver', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openDetails() })
    frameWidth = 1250
    act(() => { fireResize?.(); vi.advanceTimersByTime(20) })
    expect(tracks(frame)).toEqual([280, 330])
    frameWidth = 1920
    act(() => { fireResize?.(); vi.advanceTimersByTime(20) })
    expect(tracks(frame)).toEqual([280, 360])
  })

  it('recovers a zero first-render window width from the measured frame', () => {
    initialWindowWidth = 0
    const { frame, instance } = mountFrame()
    act(() => { vi.advanceTimersByTime(20) })
    act(() => { instance.actions.openSurfaces() })
    expect(surfacesTrack(frame)).toBe(540)
  })

  it('drag handles disappear for collapsed columns', () => {
    const { frame, instance } = mountFrame()
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(1)
    act(() => { instance.actions.openDetails() })
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(2)
    act(() => { instance.actions.closeDetails() })
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(1)
    act(() => { instance.actions.toggleSidebar() })
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(0)
  })

  it('renders the surfaces column, terminal drawer track, and titlebar trailing slot', () => {
    const { frame, slotCalls, getByTestId } = mountFrame()
    expect(getByTestId('surfaces-content')).toBeTruthy()
    expect(getByTestId('terminal-drawer-content')).toBeTruthy()
    expect(getByTestId('titlebar-trailing-content')).toBeTruthy()
    expect(slotCalls.map(c => c.key)).toEqual(expect.arrayContaining([
      'surfaces', 'shell.terminalDrawer', 'shell.titlebar.trailing',
    ]))
    expect(surfacesTrack(frame)).toBe(0)
    expect(drawerTrack(frame)).toBe(0)
    expect(frame.querySelector('[data-titlebar-trailing]')).toBeTruthy()
    expect(frame.querySelector('[data-titlebar-row]')).toBeTruthy()
    expect(frame.querySelector('#dshd-shell-titlebar-trailing')).toBeTruthy()
    expect(slotCalls.find(c => c.key === 'shell.titlebar.trailing')?.props).toEqual({
      surfaces: 0, terminalDrawer: 0, density: 'full',
    })
  })

  it('open surfaces and terminal drawer write their contract default tracks', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openSurfaces() })
    expect(surfacesTrack(frame)).toBe(540)
    expect(frame.hasAttribute('data-surfaces-collapsed')).toBe(false)
    expect(frame.hasAttribute('data-surfaces-inset')).toBe(false)
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(2)
    act(() => { instance.actions.toggleTerminalDrawer() })
    expect(drawerTrack(frame)).toBe(280)
    expect(frame.hasAttribute('data-terminal-drawer-collapsed')).toBe(false)
  })

  it('keeps an open surfaces column full height; trailing cluster stops before column 4', () => {
    const { frame, instance } = mountFrame()
    expect(frame.style.gridTemplateRows.startsWith('auto minmax(0, 1fr)')).toBe(true)
    expect(frame.querySelector('[data-titlebar-row]')).toBeTruthy()
    expect(frame.firstElementChild?.getAttribute('data-dshd-caption')).toBe('band')
    expect(frame.hasAttribute('data-surfaces-inset')).toBe(false)
    const trailing = frame.querySelector('[data-titlebar-trailing]')!
    expect(trailing.hasAttribute('data-titlebar-trailing-over-surfaces')).toBe(true)
    act(() => { instance.actions.openSurfaces() })
    expect(frame.hasAttribute('data-surfaces-inset')).toBe(false)
    expect(frame.hasAttribute('data-surfaces-collapsed')).toBe(false)
    expect(frame.querySelector('[data-dshd-caption="band"]')).toBeTruthy()
    expect(trailing.hasAttribute('data-titlebar-trailing-over-surfaces')).toBe(false)
    act(() => { instance.actions.closeSurfaces() })
    expect(frame.hasAttribute('data-surfaces-collapsed')).toBe(true)
    expect(trailing.hasAttribute('data-titlebar-trailing-over-surfaces')).toBe(true)
  })

  it('surfaces drag widens leftward (negative dx grows the panel)', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openSurfaces() })
    const handles = frame.querySelectorAll('[class*="handle"]')
    drag(handles[1]!, 1380, 1320)
    expect(surfacesTrack(frame)).toBe(600)
  })

  it('keeps surfaces and the terminal drawer mounted at zero size when closed', () => {
    const { frame, getByTestId } = mountFrame()
    expect(surfacesTrack(frame)).toBe(0)
    expect(drawerTrack(frame)).toBe(0)
    expect(getByTestId('surfaces-content')).toBeTruthy()
    expect(getByTestId('terminal-drawer-content')).toBeTruthy()
    expect(frame.hasAttribute('data-surfaces-collapsed')).toBe(true)
    expect(frame.hasAttribute('data-surfaces-inset')).toBe(false)
    expect(frame.hasAttribute('data-terminal-drawer-collapsed')).toBe(true)
  })
})

describe('AppFrame — titlebar density and conversation reserve', () => {
  it('reserves the measured trailing width in the conversation column when details is closed', () => {
    trailingClusterWidth = 400
    const { frame } = mountFrame()
    act(() => { fireResize?.(); vi.advanceTimersByTime(20) })
    expect(frame.getAttribute('data-titlebar-density')).toBe('full')
    expect(frame.hasAttribute('data-titlebar-over-conversation')).toBe(true)
    expect(frame.style.getPropertyValue('--dshd-titlebar-conversation-reserve')).toBe('400px')
  })

  it('drops the conversation reserve when details is at least as wide as the cluster', () => {
    trailingClusterWidth = 300
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openDetails() })
    act(() => { fireResize?.(); vi.advanceTimersByTime(20) })
    expect(frame.hasAttribute('data-titlebar-over-conversation')).toBe(false)
    expect(frame.getAttribute('data-titlebar-density')).toBe('full')
    expect(frame.style.getPropertyValue('--dshd-titlebar-conversation-reserve')).toBe('0px')
  })

  it('collapses to cozy when an open surfaces column pins the center below 720', () => {
    frameWidth = 1280
    const { frame, instance, slotCalls } = mountFrame()
    act(() => { instance.actions.openSurfaces() })
    expect(frame.getAttribute('data-titlebar-density')).toBe('cozy')
    expect(slotCalls.filter(c => c.key === 'shell.titlebar.trailing').at(-1)?.props).toEqual({
      surfaces: 540, terminalDrawer: 0, density: 'cozy',
    })
  })

  it('hides the cluster on a compact header and does not mark over-conversation', () => {
    frameWidth = 980
    orientationLandscape = false
    stubScreenAvail(390, 844)
    const { frame } = mountFrame()
    expect(frame.hasAttribute('data-compact-header')).toBe(true)
    expect(frame.hasAttribute('data-titlebar-over-conversation')).toBe(false)
    expect(frame.getAttribute('data-titlebar-density')).toBe('full')
    expect(frame.style.getPropertyValue('--dshd-titlebar-conversation-reserve')).toBe('0px')
  })
})

describe('AppFrame — narrow-viewport auto-collapse', () => {
  beforeEach(() => {
    orientationLandscape = false
    stubScreenAvail(390, 844)
  })

  it('mounts collapsed below the breakpoint with no sidebar handle', () => {
    frameWidth = 980
    const { frame, slotCalls } = mountFrame()
    expect(tracks(frame)).toEqual([SIDEBAR_COLLAPSED, 0])
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(true)
    expect(frame.hasAttribute('data-compact-header')).toBe(true)
    expect(slotCalls.filter(c => c.key === 'sidebar').at(-1)!.props).toEqual({ collapsed: true, width: SIDEBAR_COLLAPSED })
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(0)
  })

  it('keeps the shared titlebar row when a compact header hides the trailing cluster', () => {
    frameWidth = 980
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openSurfaces() })
    expect(frame.hasAttribute('data-compact-header')).toBe(true)
    expect(frame.hasAttribute('data-surfaces-inset')).toBe(false)
    expect(frame.querySelector('[data-titlebar-row]')).toBeTruthy()
    expect(frame.style.gridTemplateRows.startsWith('auto minmax(0, 1fr)')).toBe(true)
  })

  it('narrow toggle re-expands over the squeezed center and back', () => {
    frameWidth = 980
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([280, 0])
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(false)
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(1)
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([SIDEBAR_COLLAPSED, 0])
  })

  it('a wide-closed preference re-expands at the contract default while narrow', () => {
    frameWidth = 1920
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.toggleSidebar() }) // close while wide: preference 0
    frameWidth = 980
    act(() => { fireResize?.(); vi.advanceTimersByTime(20) })
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([280, 0])
    expect(instance.getSnapshot().sidebar).toBe(0) // preference untouched
  })

  it('shrinking across the breakpoint auto-collapses; re-widening restores the drag width', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.setSidebar(400) })
    frameWidth = 980
    act(() => { fireResize?.(); vi.advanceTimersByTime(20) })
    expect(tracks(frame)).toEqual([SIDEBAR_COLLAPSED, 0])
    frameWidth = 1920
    act(() => { fireResize?.(); vi.advanceTimersByTime(20) })
    expect(tracks(frame)).toEqual([400, 0])
  })
})

describe('AppFrame — phone overlay shell', () => {
  beforeEach(() => {
    orientationLandscape = false
    stubScreenAvail(390, 844)
  })

  it('drops both grid tracks and shows a menu instead of the rail', () => {
    frameWidth = 390
    const { frame, slotCalls, getByRole } = mountFrame()
    expect(tracks(frame)).toEqual([0, 0])
    expect(frame.hasAttribute('data-phone')).toBe(true)
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(true)
    expect(frame.hasAttribute('data-phone-sidebar')).toBe(false)
    expect(slotCalls.filter(c => c.key === 'sidebar').at(-1)!.props).toEqual({ collapsed: true, width: 0 })
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(0)
    expect(getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
    expect(frame.querySelector('#dshd-shell-titlebar-trailing')).toBeTruthy()
    expect(frame.hasAttribute('data-compact-header')).toBe(true)
  })

  it('toggle opens the drawer over the conversation and closes from the backdrop', () => {
    frameWidth = 390
    const { frame, instance, slotCalls, getByRole, queryByRole } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(tracks(frame)).toEqual([0, 0])
    expect(frame.hasAttribute('data-phone-sidebar')).toBe(true)
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(false)
    expect(slotCalls.filter(c => c.key === 'sidebar').at(-1)!.props).toEqual({ collapsed: false, width: PHONE_DRAWER })
    expect(queryByRole('button', { name: 'Open sidebar' })).toBeNull()
    expect(getByRole('button', { name: 'Close sidebar' })).toBeTruthy()
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(0)
    act(() => { getByRole('button', { name: 'Close sidebar' }).click() })
    expect(frame.hasAttribute('data-phone-sidebar')).toBe(false)
    expect(getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
  })

  it('open details stays a full-frame overlay with no drag handles', () => {
    frameWidth = 390
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openDetails() })
    expect(tracks(frame)).toEqual([0, 0])
    expect(frame.hasAttribute('data-phone-details')).toBe(true)
    expect(frame.hasAttribute('data-details-collapsed')).toBe(false)
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(0)
  })

  it('closes the overlay drawer when the current session changes', () => {
    frameWidth = 390
    const { frame, instance, rerenderFrame } = mountFrame()
    act(() => { instance.actions.toggleSidebar() })
    expect(frame.hasAttribute('data-phone-sidebar')).toBe(true)
    selectedSession.current = 's-other' as SessionId
    act(() => { rerenderFrame() })
    expect(instance.getSnapshot().narrowExpanded).toBe(false)
    expect(frame.hasAttribute('data-phone-sidebar')).toBe(false)
  })

  it('keeps the overlay when matchMedia is landscape but the device is portrait', () => {
    frameWidth = 390
    orientationLandscape = true
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: {
        type: 'portrait-primary',
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    })
    const { frame, getByRole } = mountFrame()
    expect(frame.hasAttribute('data-phone')).toBe(true)
    expect(getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
    Reflect.deleteProperty(window.screen, 'orientation')
  })

  it('does not leave the overlay when the frame box is wider than the window', () => {
    frameWidth = 390
    const { frame, getByRole } = mountFrame()
    frameWidth = 1200
    act(() => { fireResize?.(); vi.advanceTimersByTime(20) })
    expect(frame.hasAttribute('data-phone')).toBe(true)
    expect(getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
  })

  it('tracks device rotation through screen.orientation', () => {
    frameWidth = 390
    let type = 'portrait-primary'
    const listeners = new Set<() => void>()
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: {
        get type() { return type },
        addEventListener: (_name: string, fn: () => void) => { listeners.add(fn) },
        removeEventListener: (_name: string, fn: () => void) => { listeners.delete(fn) },
      },
    })
    const { frame, queryByRole } = mountFrame()
    expect(frame.hasAttribute('data-phone')).toBe(true)
    type = 'landscape-primary'
    stubScreenAvail(844, 390)
    act(() => {
      for (const listener of listeners) listener()
      vi.advanceTimersByTime(20)
    })
    expect(frame.hasAttribute('data-phone')).toBe(false)
    expect(queryByRole('button', { name: 'Open sidebar' })).toBeNull()
    Reflect.deleteProperty(window.screen, 'orientation')
  })

  it('falls through to matchMedia when the physical screen box is unusable', () => {
    frameWidth = 390
    orientationLandscape = false
    stubScreenAvail(0, 0)
    const { frame, getByRole } = mountFrame()
    expect(frame.hasAttribute('data-phone')).toBe(true)
    expect(getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
    stubScreenAvail(400, 400)
    act(() => {
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(20)
    })
    expect(frame.hasAttribute('data-phone')).toBe(true)
    Object.defineProperty(window.screen, 'availWidth', { configurable: true, value: undefined })
    act(() => {
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(20)
    })
    expect(frame.hasAttribute('data-phone')).toBe(true)
    stubScreenAvail(400, 400)
    Object.defineProperty(window.screen, 'availHeight', { configurable: true, value: undefined })
    act(() => {
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(20)
    })
    expect(frame.hasAttribute('data-phone')).toBe(true)
  })

  it('does not throw when screen.orientation lacks EventTarget methods', () => {
    frameWidth = 390
    orientationLandscape = false
    stubScreenAvail(390, 844)
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: { type: 'portrait-primary' },
    })
    const { frame, getByRole } = mountFrame()
    expect(frame.hasAttribute('data-phone')).toBe(true)
    expect(getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
    Reflect.deleteProperty(window.screen, 'orientation')
  })
})

describe('AppFrame — landscape sidebar', () => {
  it('keeps the sidebar in the grid on a phone-width landscape frame', () => {
    frameWidth = 844
    orientationLandscape = true
    const { frame, slotCalls, queryByRole } = mountFrame()
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 0])
    expect(frame.hasAttribute('data-phone')).toBe(false)
    expect(frame.hasAttribute('data-sidebar-collapsed')).toBe(false)
    expect(slotCalls.filter(c => c.key === 'sidebar').at(-1)!.props).toEqual({
      collapsed: false, width: SIDEBAR_DEFAULT,
    })
    expect(queryByRole('button', { name: 'Open sidebar' })).toBeNull()
    expect(frame.hasAttribute('data-compact-header')).toBe(true)
    expect(frame.querySelectorAll('[class*="handle"]')).toHaveLength(1)
  })

  it('hides the trailing cluster on a phone-width landscape frame and shows it when wide', () => {
    frameWidth = 844
    orientationLandscape = true
    stubScreenAvail(844, 390)
    const { frame, rerenderFrame } = mountFrame()
    expect(frame.hasAttribute('data-compact-header')).toBe(true)
    frameWidth = SIDEBAR_AUTO_COLLAPSE
    window.innerWidth = frameWidth
    act(() => { fireResize?.(); vi.advanceTimersByTime(20) })
    act(() => { rerenderFrame() })
    expect(frame.hasAttribute('data-compact-header')).toBe(false)
  })

  it('rotating from portrait overlay to landscape puts the sidebar in the grid', () => {
    frameWidth = 390
    orientationLandscape = false
    stubScreenAvail(390, 844)
    const { frame, getByRole } = mountFrame()
    expect(frame.hasAttribute('data-phone')).toBe(true)
    expect(getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
    orientationLandscape = true
    stubScreenAvail(844, 390)
    frameWidth = 844
    window.innerWidth = 844
    act(() => {
      for (const listener of orientationListeners) {
        listener({ matches: true } as MediaQueryListEvent)
      }
      vi.advanceTimersByTime(20)
    })
    expect(frame.hasAttribute('data-phone')).toBe(false)
    expect(tracks(frame)).toEqual([SIDEBAR_DEFAULT, 0])
  })

  it('re-reads rotation from a window resize when orientation.change does not fire', () => {
    frameWidth = 390
    orientationLandscape = false
    stubScreenAvail(390, 844)
    let type = 'portrait-primary'
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: {
        get type() { return type },
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    })
    const { frame, queryByRole } = mountFrame()
    expect(frame.hasAttribute('data-phone')).toBe(true)
    type = 'landscape-primary'
    orientationLandscape = true
    stubScreenAvail(844, 390)
    frameWidth = 844
    window.innerWidth = 844
    act(() => {
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(20)
    })
    expect(frame.hasAttribute('data-phone')).toBe(false)
    expect(queryByRole('button', { name: 'Open sidebar' })).toBeNull()
    Reflect.deleteProperty(window.screen, 'orientation')
  })

  it('trusts the physical screen when orientation.type stays portrait after rotate', () => {
    frameWidth = 390
    orientationLandscape = false
    stubScreenAvail(390, 844)
    Object.defineProperty(window.screen, 'orientation', {
      configurable: true,
      value: {
        type: 'portrait-primary',
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    })
    const { frame, queryByRole } = mountFrame()
    expect(frame.hasAttribute('data-phone')).toBe(true)
    stubScreenAvail(844, 390)
    orientationLandscape = true
    frameWidth = 844
    window.innerWidth = 844
    act(() => {
      window.dispatchEvent(new Event('resize'))
      vi.advanceTimersByTime(20)
    })
    expect(frame.hasAttribute('data-phone')).toBe(false)
    expect(queryByRole('button', { name: 'Open sidebar' })).toBeNull()
    Reflect.deleteProperty(window.screen, 'orientation')
  })

  it('re-reads rotation from visualViewport resize', () => {
    frameWidth = 390
    orientationLandscape = false
    stubScreenAvail(390, 844)
    const listeners = new Set<() => void>()
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        addEventListener: (_name: string, fn: () => void) => { listeners.add(fn) },
        removeEventListener: (_name: string, fn: () => void) => { listeners.delete(fn) },
      },
    })
    const { frame, queryByRole } = mountFrame()
    expect(listeners.size).toBe(1)
    orientationLandscape = true
    stubScreenAvail(844, 390)
    frameWidth = 844
    window.innerWidth = 844
    act(() => {
      for (const listener of listeners) listener()
      vi.advanceTimersByTime(20)
    })
    expect(frame.hasAttribute('data-phone')).toBe(false)
    expect(queryByRole('button', { name: 'Open sidebar' })).toBeNull()
    Reflect.deleteProperty(window, 'visualViewport')
  })
})

describe('AppFrame — guard branches', () => {
  it('pointer moves without capture are ignored (no width write)', () => {
    const { frame, instance } = mountFrame()
    const handle = frame.querySelectorAll('[class*="handle"]')[0]!
    const before = instance.getSnapshot().sidebar
    // Move + up without a preceding pointerdown: hasPointerCapture is false.
    act(() => {
      handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientX: 500, bubbles: true }))
      vi.advanceTimersByTime(20)
      handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, clientX: 500, bubbles: true }))
    })
    expect(instance.getSnapshot().sidebar).toBe(before)
  })

  it('two moves inside one frame coalesce through the pending rAF', () => {
    const { frame, instance } = mountFrame()
    const handle = frame.querySelectorAll('[class*="handle"]')[0]!
    act(() => { handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 280, bubbles: true })) })
    act(() => {
      // Two moves before the frame flushes: the second must ride the pending
      // rAF (frame.current ??= guard), and the flush sees the latest x.
      handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 320, bubbles: true }))
      handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 340, bubbles: true }))
      vi.advanceTimersByTime(20)
    })
    act(() => { handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 340, bubbles: true })) })
    expect(instance.getSnapshot().sidebar).toBe(340)
  })

  it('pointerup with a pending rAF cancels it and commits the final position', () => {
    const { frame, instance } = mountFrame()
    const handle = frame.querySelectorAll('[class*="handle"]')[0]!
    act(() => { handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 280, bubbles: true })) })
    act(() => {
      handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 360, bubbles: true }))
      // No timer advance: the rAF is still pending when pointerup arrives.
      handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 360, bubbles: true }))
    })
    expect(instance.getSnapshot().sidebar).toBe(360)
  })

  it('zero-width resize reports are ignored (display:none window)', () => {
    const { frame } = mountFrame()
    frameWidth = 0
    act(() => { fireResize?.(); vi.advanceTimersByTime(20) })
    // Track template still reflects the last non-zero viewport.
    expect(tracks(frame)).toEqual([280, 0])
  })
})

describe('AppFrame — unmount with an in-flight resize frame', () => {
  it('cancels the pending rAF on unmount (no post-unmount setState)', () => {
    const { unmount } = mountFrame()
    frameWidth = 800
    act(() => { fireResize?.() }) // rAF scheduled, NOT flushed
    unmount()
    // Flushing after unmount must be a no-op (the frame was cancelled).
    expect(() => { vi.advanceTimersByTime(20) }).not.toThrow()
  })

  it('double resize inside one frame rides the pending rAF (??= guard)', () => {
    const { frame, instance } = mountFrame()
    act(() => { instance.actions.openDetails() })
    frameWidth = 1250
    act(() => { fireResize?.(); fireResize?.(); vi.advanceTimersByTime(20) })
    expect(tracks(frame)).toEqual([280, 330])
  })
})
