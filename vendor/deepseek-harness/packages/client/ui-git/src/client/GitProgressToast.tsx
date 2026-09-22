/**
 * Git progress toast: top-right card with spinner, title,
 * elapsed subtitle, and dismiss. Stays up through hooks; success/error
 * replace the same card.
 * @module @deepseek-ai/dsh-client-ui-git/client/GitProgressToast
 */

import { IconCheckOutline16, IconCloseOutline16, IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useState } from 'react'
import { formatElapsedDescription } from './git-logic.ts'
import css from './GitProgressToast.module.css'

/** Visual tone of the progress card. */
export type GitProgressTone = 'loading' | 'success' | 'error'

/** Live git progress the titlebar owns. */
export interface GitProgressState {
  tone: GitProgressTone
  title: string
  description?: string | undefined
  details?: string
  startedAt: number | null
  actionLabel?: string
  onAction?: () => void
  copyLabel?: string
  detailsLabel?: string
  hideDetailsLabel?: string
}

/** Props for the floating git progress card. */
export interface GitProgressToastProps {
  state: GitProgressState
  dismissLabel: string
  onClose: () => void
}

/**
 * Extra dump for Show details: omitted when it would repeat the headline.
 * @param details - full git/hook dump, if any.
 * @param headline - short subtitle already on the card.
 * @returns the dump when it differs from the headline.
 */
function extraGitDump(details: string | undefined, headline: string | undefined): string | undefined {
  const dump = details?.trim()
  if (!dump) return undefined
  const lead = headline?.trim() ?? ''
  return dump !== lead ? dump : undefined
}

/**
 * Render the top-right git progress card.
 * @param props - live state, dismiss copy, and close handler.
 * @returns the portaled-looking fixed card (owner already sits in the page).
 */
export function GitProgressToast({ state, dismissLabel, onClose }: GitProgressToastProps) {
  const [now, setNow] = useState(() => Date.now())
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (state.tone !== 'loading') return
    const timer = window.setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [state.tone, state.startedAt])

  const subtitle = state.description
    ?? (state.tone === 'loading' ? formatElapsedDescription(state.startedAt, now) : undefined)
  const copyText = state.details ?? state.description
  const extra = extraGitDump(state.details, subtitle)
  const showAction = Boolean(state.actionLabel && state.onAction)
  const showCopy = state.tone === 'error' && Boolean(copyText && state.copyLabel)
  const showDetails = state.tone === 'error' && extra !== undefined && Boolean(state.detailsLabel)

  return (
    <div className={css.card} role="status" aria-live="polite" aria-label={state.title}>
      {state.tone === 'loading' && <span className={css.spinner} aria-hidden="true" />}
      {state.tone === 'success' && <IconCheckOutline16 size={16} />}
      {state.tone === 'error' && <IconWarningOutline16 size={16} />}
      <div className={css.copy}>
        <p className={css.title}>{state.title}</p>
        {subtitle !== undefined && (
          <p className={css.sub}>{subtitle}</p>
        )}
        {expanded && extra !== undefined && (
          <pre className={css.subFull}>{extra}</pre>
        )}
        {(showAction || showCopy || showDetails) && (
          <div className={css.actions}>
            {showAction && state.onAction && (
              <button type="button" className={css.action} onClick={state.onAction}>
                {state.actionLabel}
              </button>
            )}
            {showCopy && copyText && (
              <button
                type="button"
                className={css.action}
                onClick={() => { void navigator.clipboard.writeText(copyText) }}
              >
                {state.copyLabel}
              </button>
            )}
            {showDetails && (
              <button
                type="button"
                className={css.action}
                aria-expanded={expanded}
                onClick={() => { setExpanded(next => !next) }}
              >
                {expanded ? (state.hideDetailsLabel ?? state.detailsLabel) : state.detailsLabel}
              </button>
            )}
          </div>
        )}
      </div>
      <button type="button" className={css.close} aria-label={dismissLabel} onClick={onClose}>
        <IconCloseOutline16 size={12} />
      </button>
    </div>
  )
}
