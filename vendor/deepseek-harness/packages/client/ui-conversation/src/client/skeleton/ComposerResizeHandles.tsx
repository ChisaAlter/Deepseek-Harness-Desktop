/** Shared composer-edge drag handles for InputBar and ApprovalPanel. */

import { useCallback, useLayoutEffect, useRef, type PointerEvent, type RefObject } from 'react'
import clsx from 'clsx'
import { composerResizeHeight, composerResizeMaxWidth, composerResizeWidth } from './composer-resize.ts'
import type { ComposerResizeWidthEdge } from './composer-resize.ts'
import css from './ComposerResizeHandles.module.css'

const HEIGHT_VAR = '--dsh-composer-resized-height'
const WIDTH_VAR = '--dsh-composer-resized-width'

function seatOf(node: HTMLElement | null): HTMLElement | null {
  return node?.closest('[data-composer-seat]') ?? null
}

/**
 * Width publishes on the conversation root (the common ancestor of the
 * composer card and the message column), so the transcript column reads the
 * same `--dsh-composer-resized-width` the dock rows do; the composer seat
 * remains the fallback when no root ancestor exists (standalone bars).
 */
function widthSeatOf(node: HTMLElement | null): HTMLElement | null {
  return node?.closest('[data-conversation-root]') ?? seatOf(node)
}

function applyHeight(scroll: HTMLElement, height: number): void {
  const value = `${height}px`
  const seat = seatOf(scroll)
  const targets = new Set<HTMLElement>([scroll])
  if (seat !== null) {
    for (const el of seat.querySelectorAll<HTMLElement>('[data-input-scroll], [data-approval-scroll]')) {
      targets.add(el)
    }
    seat.style.setProperty(HEIGHT_VAR, value)
    seat.dataset.composerResized = ''
  }
  for (const el of targets) {
    el.style.height = value
    el.dataset.composerResized = ''
  }
}

function applyWidth(card: HTMLElement, width: number): void {
  const value = `${width}px`
  const seat = widthSeatOf(card)
  const targets = new Set<HTMLElement>([card])
  if (seat !== null) {
    for (const el of seat.querySelectorAll<HTMLElement>('[data-composer-card]')) {
      targets.add(el)
    }
    seat.style.setProperty(WIDTH_VAR, value)
    seat.dataset.composerResizedWidth = ''
  }
  for (const el of targets) {
    el.style.width = value
    el.dataset.composerResizedWidth = ''
  }
}

function clearSize(scroll: HTMLElement | null, card: HTMLElement | null): void {
  const seat = seatOf(scroll) ?? seatOf(card)
  const widthSeat = widthSeatOf(card) ?? seat
  const scrolls = seat === null
    ? (scroll === null ? [] : [scroll])
    : [...seat.querySelectorAll<HTMLElement>('[data-input-scroll], [data-approval-scroll]')]
  const cards = seat === null
    ? (card === null ? [] : [card])
    : [...seat.querySelectorAll<HTMLElement>('[data-composer-card]')]
  for (const el of scrolls) {
    el.style.height = ''
    delete el.dataset.composerResized
  }
  for (const el of cards) {
    el.style.width = ''
    delete el.dataset.composerResizedWidth
  }
  if (seat !== null) {
    seat.style.removeProperty(HEIGHT_VAR)
    delete seat.dataset.composerResized
  }
  if (widthSeat !== null) {
    widthSeat.style.removeProperty(WIDTH_VAR)
    delete widthSeat.dataset.composerResizedWidth
  }
}

function adoptFromSeat(scroll: HTMLElement, card: HTMLElement): void {
  const seat = seatOf(scroll) ?? seatOf(card)
  const widthSeat = widthSeatOf(card)
  if (seat === null && widthSeat === null) return
  const height = seat?.style.getPropertyValue(HEIGHT_VAR) ?? ''
  const width = widthSeat?.style.getPropertyValue(WIDTH_VAR) ?? ''
  if (height !== '') {
    scroll.style.height = height
    scroll.dataset.composerResized = ''
  }
  if (width !== '') {
    card.style.width = width
    card.dataset.composerResizedWidth = ''
  }
}

/**
 * Pointer drag that sets composer scrollport height and card width.
 * When a `[data-composer-seat]` ancestor is present, the size is published
 * there and copied to every InputBar / ApprovalPanel body under that seat.
 * @param enabled - Interface Settings `composerResize`.
 * @param cardRef - the composer card (`[data-composer-card]`).
 * @param scrollRef - the draft or approval scrollport.
 * @param persisted - Host-remembered size applied when the seat has none yet.
 * @param onCommit - durable write after a finished drag (pointer up).
 * @returns pointer handlers for the three edge handles.
 */
export function useComposerResizeDrag(
  enabled: boolean,
  cardRef: RefObject<HTMLDivElement | null>,
  scrollRef: RefObject<HTMLDivElement | null>,
  persisted: { height: number | null; width: number | null } = { height: null, width: null },
  onCommit?: (size: Partial<{ height: number; width: number }>) => void,
): {
  onResizePointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onResizePointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onResizePointerUp: (event: PointerEvent<HTMLDivElement>) => void
} {
  const resizeDrag = useRef<{
    pointerId: number
    edge: 'top' | ComposerResizeWidthEdge
    originX: number
    originY: number
    originWidth: number
    originHeight: number
    maxWidth: number
  } | null>(null)
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const card = cardRef.current
    if (!enabled) {
      clearSize(scroll, card)
      return
    }
    if (scroll === null || card === null) return
    adoptFromSeat(scroll, card)
    if (scroll.dataset.composerResized === undefined && persisted.height !== null) {
      applyHeight(scroll, persisted.height)
    }
    if (card.dataset.composerResizedWidth === undefined && persisted.width !== null) {
      applyWidth(card, persisted.width)
    }
  }, [enabled, cardRef, scrollRef, persisted.height, persisted.width])

  const onResizePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const edge = e.currentTarget.dataset.composerResizeEdge
    /* v8 ignore next -- handles always set top | left | right */
    if (edge !== 'top' && edge !== 'left' && edge !== 'right') return
    const scroll = scrollRef.current
    const card = cardRef.current
    /* v8 ignore next -- the handle only renders while the scrollport and card are mounted */
    if (scroll === null || card === null) return
    e.preventDefault()
    e.stopPropagation()
    const parent = card.parentElement
    const cs = parent === null ? undefined : getComputedStyle(parent)
    resizeDrag.current = {
      pointerId: e.pointerId,
      edge,
      originX: e.clientX,
      originY: e.clientY,
      originWidth: card.getBoundingClientRect().width,
      originHeight: scroll.getBoundingClientRect().height,
      maxWidth: composerResizeMaxWidth(
        parent,
        cs?.paddingLeft ?? '0',
        cs?.paddingRight ?? '0',
        card.getBoundingClientRect().width,
      ),
    }
    /* v8 ignore next -- Pointer Capture is missing in jsdom; browsers have it */
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [cardRef, scrollRef])

  const onResizePointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const drag = resizeDrag.current
    if (drag === null || drag.pointerId !== e.pointerId) return
    const scroll = scrollRef.current
    const card = cardRef.current
    /* v8 ignore next -- the handle only renders while the scrollport and card are mounted */
    if (scroll === null || card === null) return
    if (drag.edge === 'top') {
      applyHeight(scroll, composerResizeHeight(
        drag.originHeight, drag.originY, e.clientY, window.innerHeight,
      ))
      return
    }
    applyWidth(card, composerResizeWidth(
      drag.originWidth, drag.originX, e.clientX, drag.edge, drag.maxWidth,
    ))
  }, [cardRef, scrollRef])

  const onResizePointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (resizeDrag.current?.pointerId !== e.pointerId) return
    resizeDrag.current = null
    /* v8 ignore next -- Pointer Capture is missing in jsdom; browsers have it */
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    const scroll = scrollRef.current
    const card = cardRef.current
    const patch: { height?: number; width?: number } = {}
    const height = scroll?.dataset.composerResized !== undefined
      ? Number.parseFloat(scroll.style.height)
      : Number.NaN
    const width = card?.dataset.composerResizedWidth !== undefined
      ? Number.parseFloat(card.style.width)
      : Number.NaN
    if (Number.isFinite(height)) patch.height = height
    if (Number.isFinite(width)) patch.width = width
    if (patch.height !== undefined || patch.width !== undefined) {
      onCommitRef.current?.(patch)
    }
  }, [cardRef, scrollRef])

  return { onResizePointerDown, onResizePointerMove, onResizePointerUp }
}

/** Locale keys the edge handles advertise to assistive tech. */
export interface ComposerResizeHandleLabels {
  (key: 'composer.resize' | 'composer.resizeWidth'): string
}

/**
 * Top / left / right edge hit strips. The parent decides whether they mount.
 * @param props - locale seat plus the drag handlers from {@link useComposerResizeDrag}.
 * @returns the three handle elements.
 */
export function ComposerResizeHandles({
  t, onPointerDown, onPointerMove, onPointerUp,
}: {
  t: ComposerResizeHandleLabels
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void
}) {
  return (
    <>
      <div
        className={css.resizeHandle}
        data-composer-resize-handle=""
        data-composer-resize-edge="top"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t('composer.resize')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div
        className={clsx(css.resizeHandle, css.resizeHandleWest)}
        data-composer-resize-handle=""
        data-composer-resize-edge="left"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('composer.resizeWidth')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div
        className={clsx(css.resizeHandle, css.resizeHandleEast)}
        data-composer-resize-handle=""
        data-composer-resize-edge="right"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('composer.resizeWidth')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </>
  )
}
