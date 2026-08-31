/**
 * Four-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * details | surfaces) plus a shared titlebar row over conversation and details
 * (surfaces spans every row to the window top), the conversation-column
 * terminal drawer, the single 48px caption drag band (columns 1–end, first
 * child so columns paint above it), the titlebar trailing cluster (in that
 * row, not over the open surfaces column), the phone overlay band (portrait
 * below PHONE_MAX), landscape sidebar (rotate keeps the column in the grid),
 * the drag handles (pointer capture + rAF throttle), the concession chain
 * (columns.ts), and the child-slot render decisions: the sidebar slot renders
 * HERE with live parameters from the concession solve, and the session-aware
 * occupants render in fixed column positions; strict entries gate themselves
 * on current-session availability while session-maybe entries retain identity.
 * Pure component: everything arrives through the three framework shares —
 * zero cordis or framework imports, zero self-made hooks.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type {
  PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import { computeColumns, PHONE_DRAWER, PHONE_MAX, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT, SIDEBAR_MIN } from './columns.ts'
import { DocumentTitle } from './DocumentTitle.tsx'
import type { createLayoutStore } from './stores.ts'
import { resolveTitlebarDensity, titlebarConversationReserve } from './titlebar-density.ts'
import css from './AppFrame.module.css'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'surfaces' | 'shell.overlay' | 'shell.titlebar.trailing' | 'shell.terminalDrawer'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'common'>

/** Center column grid item (session-body building block). */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Details column grid item; width 0 keeps the subtree mounted (never unmount on close). */
function DetailsColumn(props: { children?: ReactNode }) {
  return <div className={css.detailsCol}>{props.children}</div>
}

/** Surfaces column grid item; width 0 keeps the subtree mounted (never unmount on close). */
function SurfacesColumn(props: { children?: ReactNode }) {
  return <div className={css.surfacesCol}>{props.children}</div>
}

/** Terminal drawer under the conversation column; height 0 keeps the subtree mounted. */
function TerminalDrawerTrack(props: { children?: ReactNode }) {
  return <div className={css.terminalDrawerCol}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'details' | 'surfaces'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/**
 * Physical screen aspect. A keyboard resizes the layout viewport and can
 * flip CSS `orientation` without rotating the device; `availWidth`/`availHeight`
 * stay put. Returns `undefined` when the screen box is missing or square.
 */
function physicalScreenLandscape(): boolean | undefined {
  const width = window.screen.availWidth
  const height = window.screen.availHeight
  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) return undefined
  if (width === height) return undefined
  return width > height
}

/**
 * Device rotation, not the viewport's aspect ratio. Prefer
 * `screen.orientation.type`, then the physical screen, then matchMedia.
 * When type and the physical screen disagree, trust the screen: some
 * browsers leave `orientation.type` stale or skip `orientation.change`.
 */
function screenOrientation(): ScreenOrientation | undefined {
  // The DOM lib types screen.orientation as always present, but jsdom and
  // older browsers omit it; the cast mirrors desktop-shell's window.shell probe.
  return (window.screen as Screen & { orientation?: ScreenOrientation }).orientation
}

function readDeviceLandscape(): boolean {
  const type = screenOrientation()?.type
  const fromScreen = physicalScreenLandscape()
  if (typeof type === 'string' && type.length > 0) {
    const fromType = type.startsWith('landscape')
    if (fromScreen !== undefined && fromScreen !== fromType) return fromScreen
    return fromType
  }
  if (fromScreen !== undefined) return fromScreen
  return window.matchMedia('(orientation: landscape)').matches
}

/** EventTarget-shaped target that may be presence-only (e.g. `screen.orientation`). */
interface OptionalEventTarget {
  addEventListener?: (type: string, fn: () => void) => void
  removeEventListener?: (type: string, fn: () => void) => void
}

/** Subscribe only when the target implements EventTarget; a presence-only
 * `screen.orientation` object must not throw and take down the shell. */
function subscribe(
  target: OptionalEventTarget | null | undefined,
  type: string,
  fn: () => void,
): () => void {
  if (target === null || target === undefined) return () => {}
  if (typeof target.addEventListener !== 'function' || typeof target.removeEventListener !== 'function') return () => {}
  target.addEventListener(type, fn)
  // The typeof guards above do not narrow the property access inside this closure.
  return () => { target.removeEventListener?.(type, fn) }
}

/** The four-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
  SessionProvider,
  t,
}: AppFrameProps) {
  const panels = useStore(s => s)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const documentTitle = useSessions((s) => {
    const current = s.current
    return current === undefined ? undefined : s.byId[current]?.title
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const trailingRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const [landscape, setLandscape] = useState(() => readDeviceLandscape())
  const [trailingWidth, setTrailingWidth] = useState(0)

  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
      actions.closeNarrowSidebar()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  // Track the frame box and device rotation together. Cap width to innerWidth
  // so a min-content overflow cannot promote the shell out of the phone/narrow
  // bands. Re-read landscape on resize as well as orientation.change: some
  // mobile browsers skip that event after a rotate.
  useEffect(() => {
    const frameElement = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (frameElement === null) return
    const el = frameElement
    let raf: number | null = null
    let rafFallback: number | null = null
    let zeroWidthRetry: number | null = null
    const scheduleZeroWidthRetry = (): void => {
      if (zeroWidthRetry !== null) return
      zeroWidthRetry = window.setTimeout(() => {
        zeroWidthRetry = null
        apply()
      }, 50)
    }
    function measure(): void {
      if (rafFallback !== null) {
        window.clearTimeout(rafFallback)
        rafFallback = null
      }
      raf = null
      setLandscape(readDeviceLandscape())
      const frameWidth = el.getBoundingClientRect().width
      const windowWidth = window.innerWidth
      const width = frameWidth > 0
        ? Math.min(frameWidth, windowWidth > 0 ? windowWidth : frameWidth)
        : windowWidth
      if (width > 0) setViewport(width)
      else scheduleZeroWidthRetry()
      const trailing = trailingRef.current
      /* v8 ignore next -- the trailing cluster mounts unconditionally with the frame. */
      if (trailing !== null) {
        setTrailingWidth(Math.max(0, Math.round(trailing.getBoundingClientRect().width)))
      }
    }
    function apply(): void {
      if (raf !== null) return
      raf = requestAnimationFrame(measure)
      rafFallback = window.setTimeout(() => {
        if (raf === null) return
        cancelAnimationFrame(raf)
        measure()
      }, 100)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(el)
    const trailing = trailingRef.current
    /* v8 ignore next -- the trailing cluster mounts unconditionally with the frame. */
    if (trailing !== null) observer.observe(trailing)
    window.addEventListener('resize', apply)
    const stopMedia = subscribe(window.matchMedia('(orientation: landscape)'), 'change', apply)
    const stopOrientation = subscribe(window.screen.orientation, 'change', apply)
    const stopVisual = subscribe(window.visualViewport, 'resize', apply)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', apply)
      stopMedia()
      stopOrientation()
      stopVisual()
      if (raf !== null) cancelAnimationFrame(raf)
      if (rafFallback !== null) window.clearTimeout(rafFallback)
      if (zeroWidthRetry !== null) window.clearTimeout(zeroWidthRetry)
    }
  }, [])

  useLayoutEffect(() => {
    const trailing = trailingRef.current
    /* v8 ignore next -- the trailing cluster mounts unconditionally with the frame. */
    if (trailing === null) return
    setTrailingWidth(Math.max(0, Math.round(trailing.getBoundingClientRect().width)))
  })

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the preference
  // (or the default when the wide preference is closed) and the center
  // absorbs the squeeze.
  // Landscape keeps the sidebar in the grid: a phone rotate must not fall
  // into the 56px rail or the overlay drawer.
  const phone = viewport < PHONE_MAX && !landscape
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE && !landscape
  // Hide the titlebar trailing cluster on any phone-width frame, including
  // landscape: rotation must not re-show Session log / Git over the title.
  const compactHeader = viewport < SIDEBAR_AUTO_COLLAPSE
  const clusterVisible = !phone && !compactHeader
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  const cols = computeColumns(
    viewport,
    sidebarPreference,
    detailsSession === undefined ? 0 : panels.details,
    panels.surfaces,
  )
  const colsRef = useRef(cols)
  colsRef.current = cols
  const drawerWidth = Math.min(PHONE_DRAWER, Math.max(SIDEBAR_MIN, viewport - 48))
  const sidebarWidth = phone ? (sidebarCollapsed ? 0 : drawerWidth) : cols.sidebar
  const detailsOpen = detailsSession !== undefined && (phone ? panels.details > 0 : cols.details > 0)
  const clusterOverConversation = clusterVisible && cols.details === 0
  const titlebarDensity = resolveTitlebarDensity(cols.center, clusterOverConversation)
  const conversationReserve = titlebarConversationReserve(clusterVisible, trailingWidth, cols.details)

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  const surfacesBase = useRef(0)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onDetailsStart = useCallback(() => { detailsBase.current = colsRef.current.details; setDragging(true) }, [])
  const onSurfacesStart = useCallback(() => { surfacesBase.current = colsRef.current.surfaces; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onDetailsDrag = useCallback((dx: number) => {
    actions.setDetails(detailsBase.current - dx)
  }, [actions])
  const onSurfacesDrag = useCallback((dx: number) => {
    actions.setSurfaces(surfacesBase.current - dx)
  }, [actions])
  const productTitle = process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        gridTemplateColumns: phone
          ? `0px minmax(0, 1fr) 0px ${cols.surfaces}px`
          : `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px ${cols.surfaces}px`,
        gridTemplateRows: `auto minmax(0, 1fr) ${panels.terminalDrawer}px`,
        '--dshd-titlebar-conversation-reserve': `${conversationReserve}px`,
      } as CSSProperties}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={detailsOpen ? undefined : true}
      data-surfaces-collapsed={cols.surfaces === 0 || undefined}
      data-terminal-drawer-collapsed={panels.terminalDrawer === 0 || undefined}
      data-phone={phone || undefined}
      data-phone-sidebar={phone && !sidebarCollapsed || undefined}
      data-phone-details={phone && detailsOpen || undefined}
      data-compact-header={compactHeader || undefined}
      data-titlebar-density={titlebarDensity}
      data-titlebar-over-conversation={clusterOverConversation || undefined}
      data-dragging={dragging || undefined}
    >
      <DocumentTitle
        productTitle={productTitle}
        {...documentTitle === undefined ? {} : { title: documentTitle }}
      />
      <div className={css.captionDrag} data-dshd-caption="band" aria-hidden="true" />
      {phone && sidebarCollapsed && (
        <button
          type="button"
          className={css.phoneMenu}
          aria-label="Open sidebar"
          onClick={() => { actions.toggleSidebar() }}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M2.5 4h11M2.5 8h11M2.5 12h11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {phone && !sidebarCollapsed && (
        <button
          type="button"
          className={css.phoneBackdrop}
          aria-label="Close sidebar"
          onClick={() => { actions.toggleSidebar() }}
        />
      )}
      <div className={css.sidebarCol}>
        {/* Render-site slot call with live concession output: a closed
            sidebar keeps the mounted slot at the compact-rail width, and the
            component sees its rendered state as owner params decided here
            (collapsed follows the resolved rail, so a derived auto-collapse
            renders the rail UI too). Phone mode reports width 0 when the
            drawer is closed — there is no rail. */}
        {renderSlot('sidebar', {
          collapsed: sidebarCollapsed,
          width: sidebarWidth,
        })}
      </div>
      <>
        {/* Both column occupants stay at fixed tree positions from first
            paint — no loading gate: a bare status line reads worse than
            the shell's own pending rendering. The conversation
            is session-maybe; SessionProvider withholds the strict details
            entry while no session is current. */}
        <CenterColumn>{renderSlot('conversation', {})}</CenterColumn>
        <TerminalDrawerTrack>{renderSlot('shell.terminalDrawer', {})}</TerminalDrawerTrack>
        <DetailsColumn>
          <SessionProvider>{renderSlot('details', {})}</SessionProvider>
        </DetailsColumn>
        <SurfacesColumn>{renderSlot('surfaces', {})}</SurfacesColumn>
      </>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      <div className={css.titlebarBand} data-titlebar-row />
      <div
        ref={trailingRef}
        className={css.titlebarTrailing}
        data-titlebar-trailing
        data-titlebar-trailing-over-surfaces={cols.surfaces === 0 || undefined}
        id="dshd-shell-titlebar-trailing"
      >
        {renderSlot('shell.titlebar.trailing', {
          surfaces: panels.surfaces,
          terminalDrawer: panels.terminalDrawer,
          density: titlebarDensity,
        })}
      </div>
      {/* The collapsed rail is fixed-width: no resize handle while closed.
          Phone drawers are overlays — dragging a column edge does not apply. */}
      {!phone && !sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {!phone && cols.details > 0 && <DragHandle side="details" left={viewport - cols.details - cols.surfaces} onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />}
      {!phone && cols.surfaces > 0 && <DragHandle side="surfaces" left={viewport - cols.surfaces} onStart={onSurfacesStart} onDrag={onSurfacesDrag} onEnd={onDragEnd} />}
    </div>
  )
}
