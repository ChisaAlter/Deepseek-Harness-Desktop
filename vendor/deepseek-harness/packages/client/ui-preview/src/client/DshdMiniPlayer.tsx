import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { IconChevronLeftOutline14, IconRightUpOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { NS } from './locales.ts'
import {
  clampMiniPlayerPosition,
  clampMiniPlayerSize,
  MINI_PLAYER_DEFAULT_SIZE,
  resizeMiniPlayerGeometry,
  type MiniPlayerResizeSide,
} from './mini-player-geometry.ts'
import {
  closeMiniPlayer,
  readMiniPlayer,
  setMiniPlayerGeometry,
  subscribeMiniPlayer,
  useMiniPlayer,
  type MiniPlayerGeometry,
} from './mini-player-state.ts'
import css from './PreviewPanel.module.css'
import { BrowserSurfaceSlot } from './BrowserSurfaceSlot.tsx'

type Props = PropsRuntime<'shell.overlay'> & PropsLocale<typeof NS>

interface DragState { pointerId: number; x: number; y: number; baseX: number; baseY: number }
interface ResizeState { pointerId: number; x: number; y: number; base: MiniPlayerGeometry; side: MiniPlayerResizeSide }

function chatRect(): DOMRect | undefined {
  const node = document.querySelector('[data-conversation-scroll]')
  return node?.getBoundingClientRect()
}

function frameRect(): DOMRect | undefined {
  return document.querySelector('[data-shell-overlay]')?.getBoundingClientRect()
}

function boundsFor(node: HTMLElement): { rect: { x: number; y: number; width: number; height: number }; visible: boolean } | undefined {
  const frame = frameRect()
  if (!frame) return undefined
  const rect = (node.querySelector('[data-preview-mini-player-viewport]') as HTMLElement | null)?.getBoundingClientRect() ?? node.getBoundingClientRect()
  return {
    rect: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) },
    visible: rect.width > 0 && rect.height > 0,
  }
}

export function DshdMiniPlayer({ t }: Props): ReactNode {
  const state = useMiniPlayer()
  const rootRef = useRef<HTMLElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const resizeRef = useRef<ResizeState | null>(null)
  const geometry = state.geometry ?? { ...MINI_PLAYER_DEFAULT_SIZE, x: 0, y: 0 }

  useEffect(() => {
    if (!state.open || state.previewId === null || state.suspended) return
    const sync = (): void => {
      const root = rootRef.current
      const chat = chatRect()
      const frame = frameRect()
      if (!root || !chat || !frame) return
      const currentGeometry = readMiniPlayer().geometry ?? { ...MINI_PLAYER_DEFAULT_SIZE, x: 0, y: 0 }
      const container = { width: Math.max(1, chat.width), height: Math.max(1, chat.height) }
      const size = clampMiniPlayerSize(currentGeometry, container)
      const position = clampMiniPlayerPosition(currentGeometry, size, container)
      const next = { ...position, ...size }
      setMiniPlayerGeometry(next)
      const presented = boundsFor(root)
      const runtime = readMiniPlayer().runtime
      const id = readMiniPlayer().previewId
      if (!runtime || !id || !presented) return
      void runtime.previewShow(id, presented.rect)
    }
    sync()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(sync)
    const chat = document.querySelector('[data-conversation-scroll]')
    if (chat && observer) observer.observe(chat)
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
      const runtime = readMiniPlayer().runtime
      const id = readMiniPlayer().previewId
      if (runtime && id) void runtime.previewHide(id)
    }
  }, [state.open, state.previewId, state.revision, state.suspended])

  useEffect(() => {
    if (!state.open || state.previewId === null || state.suspended) return
    const root = rootRef.current
    const runtime = readMiniPlayer().runtime
    if (!root || !runtime) return
    const viewport = (root.querySelector('[data-preview-mini-player-viewport]') as HTMLElement | null)
    const rect = viewport?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    void runtime.previewResize(state.previewId, {
      x: Math.round(rect.left), y: Math.round(rect.top),
      width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)),
    })
  }, [geometry.x, geometry.y, geometry.width, geometry.height, state.open, state.previewId, state.suspended])

  useEffect(() => {
    const runtime = readMiniPlayer().runtime
    const id = readMiniPlayer().previewId
    if (!runtime || !id) return
    const off = subscribeMiniPlayer(() => {
      if (!readMiniPlayer().open || readMiniPlayer().suspended) void runtime.previewHide(id)
    })
    return off
  }, [state.previewId])

  if (!state.open || state.previewId === null) return null

  const onDragDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, baseX: geometry.x, baseY: geometry.y }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const onDragMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    const chat = chatRect()
    if (!drag || drag.pointerId !== event.pointerId || !chat) return
    const size = clampMiniPlayerSize(geometry, { width: chat.width, height: chat.height })
    const pos = clampMiniPlayerPosition({ x: drag.baseX + event.clientX - drag.x, y: drag.baseY + event.clientY - drag.y }, size, { width: chat.width, height: chat.height })
    setMiniPlayerGeometry({ ...pos, ...size })
  }
  const onDragEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onResizeDown = (event: ReactPointerEvent<HTMLButtonElement>, side: MiniPlayerResizeSide): void => {
    if (event.button !== 0) return
    resizeRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, base: geometry, side }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    event.stopPropagation()
  }
  const onResizeMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const resize = resizeRef.current
    const chat = chatRect()
    if (!resize || resize.pointerId !== event.pointerId || !chat) return
    setMiniPlayerGeometry(resizeMiniPlayerGeometry(resize.base, {
      x: event.clientX - resize.x,
      y: event.clientY - resize.y,
    }, resize.side, { width: chat.width, height: chat.height }))
  }
  const onResizeEnd = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (resizeRef.current?.pointerId !== event.pointerId) return
    resizeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const frame = frameRect()
  const chat = chatRect()
  const left = frame && chat ? chat.left - frame.left + geometry.x : geometry.x
  const top = frame && chat ? chat.top - frame.top + geometry.y : geometry.y

  return (
    <section ref={rootRef} className={css.miniPlayer} data-preview-mini-player aria-label="dshd mini-player" style={{ left, top, width: geometry.width, height: geometry.height }}>
      <div className={css.miniPlayerChrome} onPointerDown={onDragDown} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
        <span className={css.miniPlayerTitle}>dshd mini-player</span>
        <Tooltip label={t('miniRestore')} side="bottom"><button type="button" className={css.icon} aria-label={t('miniRestore')} onClick={() => { readMiniPlayer().runtime?.restore?.(); closeMiniPlayer() }}><IconChevronLeftOutline14 size={14} /></button></Tooltip>
      </div>
      <div className={css.miniPlayerViewport} data-preview-mini-player-viewport>
        <BrowserSurfaceSlot><div className={css.miniPlayerPlaceholder}><IconRightUpOutline16 size={16} /></div></BrowserSurfaceSlot>
      </div>
      {(['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'] as const).map((side) => (
        <button key={side} type="button" className={css.miniPlayerResize} data-side={side} aria-label={t('miniResize')} onPointerDown={(event) => onResizeDown(event, side)} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} onPointerCancel={onResizeEnd} />
      ))}
    </section>
  )
}
