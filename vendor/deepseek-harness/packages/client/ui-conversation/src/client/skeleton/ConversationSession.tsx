/** Strict per-session header/body content inserted into the resident conversation layout. */

import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import { resolveActiveView } from '../view-selection.ts'
import { DefaultConversationViews } from './DefaultConversationViews.tsx'
import css from './ConversationRoot.module.css'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
  readonly subagent: boolean
  readonly managed: boolean
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({
      id: summary.id,
      displayTitle: summary.displayTitle,
      subagent: summary.origin === 'subagent',
      managed: summary.presentation?.composer === 'managed',
    })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

function equalBreadcrumbs(left: readonly Breadcrumb[], right: readonly Breadcrumb[]): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right.at(index)
      return other !== undefined && item.id === other.id && item.displayTitle === other.displayTitle
        && item.managed === other.managed
    })
}

/**
 * Density attribute the frame publishes; the actions band hides on cozy and
 * compact through CSS, so this seat offers those actions through a popover
 * instead of dropping them.
 */
function readTitlebarDensity(): string {
  return document.documentElement.dataset.titlebarDensity ?? 'full'
}

function subscribeTitlebarDensity(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-titlebar-density'],
  })
  return () => { observer.disconnect() }
}

/**
 * Overflow entry for the header actions band: while the row is too narrow to
 * paint the actions inline (cozy/compact density), a chevron trigger renders
 * them in a popover. Hover/focus previews them transiently; clicking pins the
 * panel open until Escape, an outside pointerdown, or a second click.
 * @param props - the renderSlot binding plus the trigger's aria label.
 */
function HeaderActionsOverflow({
  renderSlot, label,
}: {
  renderSlot: ConversationSessionHeaderSlotProps['renderSlot']
  label: string
}) {
  const [density, setDensity] = useState(readTitlebarDensity)
  const [pinned, setPinned] = useState(false)
  const [hovering, setHovering] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => subscribeTitlebarDensity(() => {
    setDensity(readTitlebarDensity())
  }), [])

  const collapsed = density === 'cozy' || density === 'compact'
  const open = collapsed && (pinned || hovering)

  // Leaving the collapsed range resets the seat so a widened row shows the
  // inline band again with no stale popover state.
  useEffect(() => {
    if (!collapsed) {
      setPinned(false)
      setHovering(false)
    }
  }, [collapsed])

  useEffect(() => {
    if (!pinned) return
    const onPointerDown = (event: PointerEvent): void => {
      const root = rootRef.current
      if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
        setPinned(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPinned(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pinned])

  if (!collapsed) return null

  return (
    <span
      ref={rootRef}
      className={css.actionsOverflow}
      onPointerEnter={() => { setHovering(true) }}
      onPointerLeave={() => { setHovering(false) }}
      onFocusCapture={() => { setHovering(true) }}
      onBlurCapture={(event) => {
        const root = rootRef.current
        const next = event.relatedTarget
        if (root !== null && (!(next instanceof Node) || !root.contains(next))) setHovering(false)
      }}
    >
      <button
        type="button"
        className={css.actionsOverflowButton}
        aria-label={label}
        aria-expanded={open}
        data-pinned={pinned || undefined}
        onClick={() => { setPinned(value => !value) }}
      >
        <IconChevronDownOutline14 size={14} />
      </button>
      {open && createPortal(
        <div className={css.actionsOverflowPanel} role="group" aria-label={label}>
          {renderSlot('conversation.session.header.actions', {}) as ReactNode}
        </div>,
        /* v8 ignore next -- open implies the mounted span exists. */
        rootRef.current as Element,
      )}
    </span>
  )
}

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns Session navigation controls, with title and tabs after conversation starts.
 */
export function ConversationSessionHeader({
  sessionId, useSession, useSessions, useConversation, useConversationViews, useViewTabs,
  useStore, renderSlot, open, selectView, t,
}: ConversationSessionHeaderProps) {
  const tabs = useConversationViews(value => value)
  const showTabs = useViewTabs(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  const ancestry = useSessions(s => deriveAncestry(s, sessionId), equalBreadcrumbs)
  const managed = ancestry.at(-1)?.managed === true
  const presentationOwned = useSessions(s => s.byId[sessionId]?.presentation !== undefined)
  const session = useSession(s => s)
  const conversation = useConversation(s => s)
  const hideChrome = !presentationOwned
    && session.blank
    && conversationPhase(session, conversation) === 'blank'
  const showTabStrip = !managed && showTabs && tabs.length > 1

  return (
    <header
      className={clsx(css.header, hideChrome && css.headerBlank, !showTabStrip && css.headerNoTabs)}
      aria-hidden={hideChrome || undefined}
    >
      <div className={css.titleRow} data-dshd-caption={hideChrome ? undefined : 'title'}>
        <div className={css.headerLeading} data-conversation-header-leading="">
          {renderSlot('conversation.session.header.leading', {})}
        </div>
        {hideChrome ? (
          <div className={css.blankCaption} data-dshd-caption="blank" />
        ) : (
          <>
            <div className={css.titleCluster}>
              <nav className={css.crumbs} aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  const last = index === ancestry.length - 1
                  // The current crumb has no navigation, so it is plain text
                  // rather than a disabled button: under a window drag region a
                  // button would subtract itself from the header's drag row
                  // (ui-web base.css) and leave the title inert for dragging too.
                  const title = last
                    ? (
                      <span className={clsx(css.crumb, summary.subagent && css.crumbSubagent, css.crumbCurrent)}>
                        {summary.displayTitle}
                      </span>
                    )
                    : (
                      <button
                        type="button"
                        className={clsx(css.crumb, summary.subagent && css.crumbSubagent)}
                        onClick={() => { open(summary.id) }}
                      >
                        {summary.displayTitle}
                      </button>
                    )
                  const lineage = last || summary.subagent
                  const hideManagedLineage = last && summary.managed
                  const lineageOwner = {
                    lineageSessionId: summary.id,
                    displayTitle: summary.displayTitle,
                    ...last ? {} : { openTitle: () => { open(summary.id) } },
                  }
                  return (
                    <span key={summary.id} className={css.crumbSeg}>
                      {index > 0 && <span className={css.crumbSep}>/</span>}
                      {hideManagedLineage
                        ? title
                        : lineage
                          ? summary.subagent
                            ? renderSlot(
                              'conversation.session.header.lineage',
                              lineageOwner,
                              { fallback: title },
                            )
                            : (
                              <>
                                {title}
                                {renderSlot(
                                  'conversation.session.header.lineage',
                                  lineageOwner,
                                  { fallback: null },
                                )}
                              </>
                            )
                          : title}
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span className={css.crumbCurrent}>{sessionId}</span>}
              </nav>
              {!managed && (
                <div className={css.headerActions}>
                  {renderSlot('conversation.session.header.actions', {})}
                </div>
              )}
            </div>
            {!managed && (
              <div className={css.headerUtilities}>
                <HeaderActionsOverflow renderSlot={renderSlot} label={t('header.actions.more')} />
                {renderSlot('conversation.session.header.utilities', {})}
              </div>
            )}
          </>
        )}
        <div className={css.headerCorner} data-conversation-header-corner="">
          {renderSlot('conversation.session.header.corner', {})}
        </div>
      </div>
      {!hideChrome && showTabStrip && (
        // data-conversation-tabs: marks the tab strip, which the window-chrome
        // geometry and the browser coverage lane anchor on.
        <div className={css.tabs} role="tablist" data-conversation-tabs="">
          {tabs.map(viewTab => (
            <button
              key={viewTab.id}
              type="button"
              role="tab"
              aria-selected={viewTab.id === active?.id}
              className={clsx(css.tab, viewTab.id === active?.id && css.tabActive)}
              onClick={() => { selectView(viewTab.id) }}
            >
              {viewTab.label}
            </button>
          ))}
        </div>
      )}
    </header>
  )
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession(props: ConversationSessionProps) {
  return <DefaultConversationViews {...props} />
}
