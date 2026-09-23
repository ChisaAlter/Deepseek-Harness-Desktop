/** Session-cost detail card: the click-opened surface behind the composer
 * strip's cost figure.
 *
 * Surface choice: the reference is ui-chat's 「Token 用量」 card (StatsPills plus
 * its private `stat-dialog` seat) — a portaled panel clamped inside the
 * viewport, a heading row with a glyph and the section name left and the
 * headline value right, a hairline rule, then label/value rows. That panel is
 * another feature plugin's private skin, and a feature plugin may not import
 * another's values, so this file rebuilds the same surface out of the
 * primitives the seat is made of: `useAnchoredPosition` for the clamped
 * placement, `useDismissOnOutsidePointer` for outside dismissal, `usePresence`
 * for the popover enter/exit recipe, and `useAnchoredMaxHeight` for the
 * viewport fit. The CSS module consumes the same semantic aliases
 * (`--dsw-specific-menu`, `--dsw-elevation-prominent`, `--dsw-alias-border-l2`,
 * the label tints) instead of copying `stat-dialog.module.css`. HoverCard
 * cannot serve here: it opens on a dwell and dismisses on an anchor press, so a
 * click-opened card cannot be built on it.
 *
 * Length: the card lists one row per billed route and one folded row for the
 * whole delegation tree, so a session that delegated fifty times still renders
 * a bounded card — the child lines are capped and the body scrolls.
 */

import {
  Fragment, useCallback, useEffect, useRef, useState,
  type CSSProperties, type MutableRefObject,
} from 'react'
import { createPortal } from 'react-dom'
import {
  DisclosureRow, IconChartOutline16, IconChevronRightOutline14, IconTreeCornerRegular,
  useAnchoredMaxHeight, useAnchoredPosition, useDismissOnOutsidePointer, usePresence,
  type PresenceState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComposerBarProps } from '../contract/slots.ts'
import css from './SessionCostCard.module.css'

/** Viewport margin the placement clamp and the height fit keep (the reference card's). */
const PANEL_MARGIN = 12

/** Distance between the trigger's top edge and the panel's bottom. */
const PANEL_GAP = 8

/** Design cap for the card's height; {@link useAnchoredMaxHeight} lowers it to the visible space. */
const CARD_MAX_HEIGHT = 360

/** Child lines rendered before the honest `还有 N 个` remainder. */
const SUBAGENT_ROW_CAP = 10

/**
 * Unplaced portal panel: hidden but laid out so the clamp measures real
 * dimensions (the `useAnchoredPosition` measure pass).
 */
export const COST_CARD_MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/** One billed route's block: the route's identity and its own lines. */
export interface SessionCostRoute {
  /** `provider/model` composite key — unique after the fold. */
  readonly key: string
  /** Route identity: `provider/model`, the bare model id, or the unknown-route label. */
  readonly name: string
  /** Cost or no-price notice, the two consumption lines, and the price columns when priced. */
  readonly lines: readonly string[]
}

/** One delegated child's line in the folded disclosure. */
export interface SessionCostSubagentRow {
  /** The child Session's id — stable across renders while the label changes. */
  readonly key: string
  /** The child's display name (catalog label first, list title as fallback). */
  readonly label: string
  /** The child's own cost or no-price notice plus the tokens it moved. */
  readonly detail: string
}

/** The delegation tree's folded contribution: one summary row and its child lines. */
export interface SessionCostSubagents {
  /** Summary label: the child count and the priced subtotal (or the no-price notice). */
  readonly summary: string
  /** One row per descendant that billed something, in tree order. */
  readonly rows: readonly SessionCostSubagentRow[]
}

/** Props of the portaled card. Everything arrives derived: the card prices nothing. */
export interface SessionCostCardProps {
  /** Panel element; the placement clamp and the height fit read its geometry. */
  panelRef: MutableRefObject<HTMLDivElement | null>
  /** Fixed placement, or null while the measure pass runs. */
  placement: CSSProperties | null
  /** Viewport-clamped height cap from {@link useAnchoredMaxHeight}. */
  maxHeight: number
  /** Presence state driving the popover recipe. */
  state: PresenceState
  /** Whether the card is wanted open; false only while the exit recipe plays. */
  open: boolean
  /** Card heading, also the dialog's accessible name. */
  title: string
  /** Headline total, already formatted, including the partial marker when one is owed. */
  total: string
  /** One block per billed route, in first-seen order. */
  routes: readonly SessionCostRoute[]
  /** The delegation tree's rows, or null when the Session delegated nothing. */
  subagents: SessionCostSubagents | null
  /** Where model prices are set, or null when every billed route is priced. */
  hint: string | null
  /** The owning dock's locale seat. */
  t: ComposerBarProps['t']
}

/** Open state, refs, placement, and dismissal for one session-cost card. */
export interface SessionCostCardSeat {
  open: boolean
  setOpen: (open: boolean) => void
  /** Flip the card; the trigger's click and keyboard activation both call this. */
  toggle: () => void
  /** The trigger: the placement anchor, and where Escape hands the focus back. */
  triggerRef: MutableRefObject<HTMLButtonElement | null>
  panelRef: MutableRefObject<HTMLDivElement | null>
  placement: CSSProperties | null
  maxHeight: number
  mounted: boolean
  state: PresenceState
}

/**
 * One trigger-anchored card seat: open state, viewport-clamped placement above
 * the trigger, outside-pointer dismissal, and Escape.
 *
 * Ordering constraint: the placement is requested only once the panel it
 * measures is in the DOM (`usePresence`'s `mounted`, not `open`). `open` flips
 * a commit before the panel renders, and `useAnchoredPosition` measures the
 * panel's offset size — requested on that earlier commit it reads a null ref as
 * height 0, pins the top edge 8px above the trigger, and the card grows
 * downward over the composer, with no `ResizeObserver` on a null panel and no
 * dependency left to correct it.
 * @returns the seat; render the panel while `mounted`, spreading `placement ??
 * COST_CARD_MEASURE_STYLE` and `maxHeight` onto it.
 */
export function useSessionCostCard(): SessionCostCardSeat {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const toggle = useCallback(() => { setOpen(previous => !previous) }, [])
  const { mounted, state } = usePresence(open)

  // The composer strip sits at the bottom of the viewport, so the card hangs
  // above its trigger; both edges are clamped inside the viewport. `open &&
  // mounted` is what makes `place()` measure the real box (see the ordering
  // constraint above); closing still nulls the position, so the panel keeps the
  // hidden measure style through its exit.
  const placement = useAnchoredPosition({
    open: open && mounted,
    anchorRef: triggerRef,
    panelRef,
    side: 'top',
    gap: PANEL_GAP,
    margin: PANEL_MARGIN,
  })

  // Outside dismissal counts the portaled panel as inside; a second press on
  // the trigger closes through the button's own click.
  useDismissOnOutsidePointer(triggerRef, open, setOpen, panelRef)

  // Escape closes and hands the keyboard back to the trigger that owns the
  // card: the panel is portaled and unmounts, so leaving focus where it was
  // would drop a keyboard user on a detached node.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open])

  // The fit re-runs when the placement lands (`placement` is null during the
  // measure pass) and whenever the anchor moves it. The panel's bottom edge is
  // what stays fixed, so the hook's bottom-to-viewport-top fit is exactly the
  // room a card hanging above its trigger may use.
  const maxHeight = useAnchoredMaxHeight(panelRef, CARD_MAX_HEIGHT, open ? placement?.top : null)
  return { open, setOpen, toggle, triggerRef, panelRef, placement, maxHeight, mounted, state }
}

/**
 * Render the portaled session-cost card.
 * @param props - the placement, the heading, and the already-derived rows.
 * @returns the card, mounted in `document.body` so the composer's clipping and
 * stacking cannot cut it off.
 */
export function SessionCostCard({
  panelRef, placement, maxHeight, state, open, title, total, routes, subagents, hint, t,
}: SessionCostCardProps) {
  const [subagentsOpen, setSubagentsOpen] = useState(false)
  const shown = subagents === null ? [] : subagents.rows.slice(0, SUBAGENT_ROW_CAP)
  const overflow = subagents === null ? 0 : subagents.rows.length - shown.length
  return createPortal(
    <div
      ref={panelRef}
      className={css.panel}
      role="dialog"
      aria-label={title}
      aria-hidden={open ? undefined : true}
      data-dsh-motion="popover"
      data-state={state}
      style={placement === null
        ? COST_CARD_MEASURE_STYLE
        : { ...placement, maxHeight }}
    >
      <div className={css.title}>
        <span className={css.titleLabel}>
          <IconChartOutline16 />
          {title}
        </span>
        <span className={css.titleValue}>{total}</span>
      </div>
      <div className={css.titleRule} aria-hidden />
      <div className={css.body}>
        {routes.map(route => (
          <div key={route.key} className={css.route} data-session-cost-route>
            <div className={css.routeName}>{route.name}</div>
            {route.lines.map(line => <div key={line} className={css.line}>{line}</div>)}
          </div>
        ))}
        {subagents !== null && (
          <DisclosureRow
            className={css.subagent}
            titleClassName={css.subagentTitle}
            icon={<IconTreeCornerRegular size={10} />}
            title={subagents.summary}
            open={subagentsOpen}
            expandable
            expandOnRowClick
            // The affordance sits after the text, where the reader looks for it,
            // and keeps its width when the title is ellipsized. The primitive's
            // leading slot carries the decorative glyph only.
            previewChevron={false}
            collapsedContent={<IconChevronRightOutline14 className={css.subagentChevron} />}
            onToggle={() => { setSubagentsOpen(previous => !previous) }}
          >
            <dl className={css.subagentList}>
              {shown.map(row => (
                <Fragment key={row.key}>
                  <dt>{row.label}</dt>
                  <dd>{row.detail}</dd>
                </Fragment>
              ))}
            </dl>
            {overflow > 0 && (
              <div className={css.subagentMore}>
                {t('sessionCost.subagent.more', { count: overflow })}
              </div>
            )}
          </DisclosureRow>
        )}
        {hint !== null && <div className={css.hint}>{hint}</div>}
      </div>
    </div>,
    document.body,
  )
}
