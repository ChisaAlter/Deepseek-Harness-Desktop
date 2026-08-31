// Cloning the anchor preserves its layout context. Fixed positioning lets the
// bubble escape ancestor overflow clipping without a portal.

import { cloneElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FocusEventHandler, MouseEventHandler, MutableRefObject, ReactElement, Ref } from 'react'
import { usePresence } from './usePresence.ts'
import css from './Tooltip.module.css'

/** Bubble placement relative to the anchor. */
export type TooltipSide = 'right' | 'left' | 'bottom' | 'top'

/** Props Tooltip injects into its anchor child; the child's own handlers are chained ahead of the tooltip's. */
interface AnchorProps {
  ref?: Ref<HTMLElement> | undefined
  onMouseEnter?: MouseEventHandler | undefined
  onMouseLeave?: MouseEventHandler | undefined
  onFocus?: FocusEventHandler | undefined
  onBlur?: FocusEventHandler | undefined
}

type TooltipLabel = string | (() => string)

/**
 * Attach a hover/focus tooltip to an anchor element.
 * @param props.label - bubble text, or a resolver evaluated only while the bubble is visible.
 * @param props.side - placement relative to the anchor (default 'right').
 * @param props.delayMs - hover delay in milliseconds; keyboard focus remains immediate.
 * @param props.disabled - suppress the bubble while true; the anchor renders identically so
 * toggling never remounts it (which would cut its CSS transitions).
 * @param props.maxWidth - bubble width cap in pixels, for labels long enough that the default
 * half-viewport cap would render a slab wider than the surface the anchor sits on.
 * @param props.children - a single anchor element; its own ref (callback or object) is forwarded alongside the tooltip's.
 * @returns the cloned anchor plus a fixed-position bubble while hovered/focused.
 */
export function Tooltip({ label, side = 'right', delayMs = 0, disabled = false, maxWidth, children }: { label: TooltipLabel; side?: TooltipSide; delayMs?: number; disabled?: boolean; maxWidth?: number; children: ReactElement<AnchorProps> }) {
  const anchor = useRef<HTMLElement | null>(null)
  // React 18 keeps the element's ref outside props; forward it so wrapping an
  // anchor in Tooltip never silently severs the owner's ref.
  const childRef = (children as ReactElement<AnchorProps> & { ref?: Ref<HTMLElement> }).ref
  const mergedRef = useCallback((el: HTMLElement | null) => {
    anchor.current = el
    if (typeof childRef === 'function') childRef(el)
    else if (childRef != null) (childRef as MutableRefObject<HTMLElement | null>).current = el
  }, [childRef])
  // The anchor's edges rather than final coordinates: a vertical flip has to
  // re-derive the bubble's own top from the opposite edge.
  const [pos, setPos] = useState<{ x: number; top: number; bottom: number } | null>(null)
  const [visible, setVisible] = useState(false)
  const { mounted, state } = usePresence(visible)
  // Where the bubble actually sits, which is the requested side until the
  // viewport refuses it.
  const [placement, setPlacement] = useState<TooltipSide>(side)
  const bubble = useRef<HTMLSpanElement | null>(null)
  const resolvedLabel = useMemo(() => {
    if (!mounted || pos === null) return null
    return typeof label === 'function' ? label() : label
  }, [mounted, pos, label])
  const y = pos === null
    ? 0
    : placement === 'right' || placement === 'left'
      ? pos.top + (pos.bottom - pos.top) / 2
      : placement === 'top' ? pos.top - 8 : pos.bottom + 8
  const EDGE_MARGIN = 12
  // Viewport fit: fixed positioning knows nothing about edges, so a centered
  // bubble near the right edge would clip and a long label under an anchor low
  // on the page would run off the bottom. Horizontally the bubble slides back
  // inside; vertically it flips to the opposite side, which is the only move
  // that does not cover the anchor being read. Each measurement resets the base
  // position first, so a shorter label or a larger viewport releases a previous
  // adjustment without another render.
  useLayoutEffect(() => {
    if (pos === null) return
    const fit = () => {
      const el = bubble.current
      /* v8 ignore next -- pos is set only while the bubble is mounted. */
      if (el === null) return
      el.style.left = `${pos.x}px`
      const r = el.getBoundingClientRect()
      if (side === 'left') {
        el.style.left = `${pos.x - r.width - 10}px`
        if (r.left - r.width - 10 < EDGE_MARGIN) el.style.left = `${EDGE_MARGIN}px`
        return
      }
      let dx = 0
      if (r.right > window.innerWidth - EDGE_MARGIN) dx = window.innerWidth - EDGE_MARGIN - r.right
      if (r.left + dx < EDGE_MARGIN) dx = EDGE_MARGIN - r.left
      el.style.left = `${pos.x + dx}px`
      if (side === 'right') return
      // Flip only into a side that genuinely fits, so an anchor with room on
      // neither side keeps the requested placement instead of oscillating.
      const fitsBelow = pos.bottom + 8 + r.height <= window.innerHeight - EDGE_MARGIN
      const fitsAbove = pos.top - 8 - r.height >= EDGE_MARGIN
      if (placement === 'bottom' && !fitsBelow && fitsAbove) setPlacement('top')
      if (placement === 'top' && !fitsAbove && fitsBelow) setPlacement('bottom')
    }
    fit()
    window.addEventListener('resize', fit)
    return () => { window.removeEventListener('resize', fit) }
  }, [mounted, placement, pos, resolvedLabel, side])
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Hover and focus are independent triggers: the bubble hides only after
  // BOTH clear (hovering away from a focused anchor must not drop it).
  const triggers = useRef({ hover: false, focus: false })

  // Disabling mid-hover (e.g. clicking a rail control expands the sidebar)
  // must drop an already-visible bubble: no mouseleave fires.
  const cancelShow = useCallback(() => {
    if (showTimer.current === null) return
    clearTimeout(showTimer.current)
    showTimer.current = null
  }, [])
  useEffect(() => {
    if (disabled) {
      cancelShow()
      triggers.current = { hover: false, focus: false }
      setVisible(false)
    }
    return cancelShow
  }, [cancelShow, disabled])

  useEffect(() => {
    if (!mounted && !visible) setPos(null)
  }, [mounted, visible])

  const show = () => {
    if (disabled) return
    const el = anchor.current
    /* v8 ignore next -- the ref is attached by event time: events fire on the cloned anchor. */
    if (el === null) return
    const r = el.getBoundingClientRect()
    // Every show starts from the requested side; the fit pass flips it only
    // where this anchor's position demands it.
    setPlacement(side)
    setPos({ x: side === 'right' ? r.right + 10 : side === 'left' ? r.left : r.left + r.width / 2, top: r.top, bottom: r.bottom })
    setVisible(true)
  }
  const showAfterHoverDelay = () => {
    cancelShow()
    if (delayMs <= 0) {
      show()
      return
    }
    showTimer.current = setTimeout(() => {
      showTimer.current = null
      show()
    }, delayMs)
  }
  const hide = () => {
    cancelShow()
    if (!triggers.current.hover && !triggers.current.focus) setVisible(false)
  }

  return (
    <>
      {cloneElement(children, {
        ref: mergedRef,
        onMouseEnter: (e) => { children.props.onMouseEnter?.(e); triggers.current.hover = true; showAfterHoverDelay() },
        onMouseLeave: (e) => { children.props.onMouseLeave?.(e); triggers.current.hover = false; cancelShow(); setVisible(false) },
        onFocus: (e) => { children.props.onFocus?.(e); triggers.current.focus = true; cancelShow(); show() },
        onBlur: (e) => { children.props.onBlur?.(e); triggers.current.focus = false; hide() },
      })}
      {mounted && pos !== null && (
        <span
          ref={bubble}
          className={css.bubble}
          data-dsh-motion="fade"
          data-state={state}
          data-side={placement}
          aria-hidden={visible ? undefined : true}
          style={{ left: pos.x, top: y, ...maxWidth === undefined ? {} : { maxWidth } }}
          role="tooltip"
        >
          {resolvedLabel}
        </span>
      )}
    </>
  )
}
