import { Fragment, type ComponentType, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconAgentPresetOutline16,
  IconCommitOutline16,
  IconFolderOpenOutline16,
  IconGlobeOutline14,
  IconPanelBottomOutline16,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type { OpenableKind } from './stores.ts'
import css from './EmptyState.module.css'

export type EmptyStateProps = PropsLocale<typeof NS> & {
  /** Open the chosen kind and the surfaces column. */
  onOpen: (kind: OpenableKind) => void
  /** False outside the desktop app (no preview IPC). */
  browserAvailable?: boolean
  /** False when the workspace is not a git repository. */
  diffAvailable?: boolean
}

type CardSpec = {
  kind: OpenableKind
  title: 'card.browser' | 'card.terminal' | 'card.files' | 'card.diff' | 'card.agents'
  description:
    | 'card.browser.description'
    | 'card.terminal.description'
    | 'card.files.description'
    | 'card.diff.description'
    | 'card.agents.description'
  Icon: ComponentType<{ size?: number; className?: string }>
}

const CARDS: readonly CardSpec[] = [
  { kind: 'preview', title: 'card.browser', description: 'card.browser.description', Icon: IconGlobeOutline14 },
  { kind: 'terminal', title: 'card.terminal', description: 'card.terminal.description', Icon: IconPanelBottomOutline16 },
  { kind: 'files', title: 'card.files', description: 'card.files.description', Icon: IconFolderOpenOutline16 },
  { kind: 'diff', title: 'card.diff', description: 'card.diff.description', Icon: IconCommitOutline16 },
  { kind: 'agents', title: 'card.agents', description: 'card.agents.description', Icon: IconAgentPresetOutline16 },
]

/**
 * 2×N empty-state cards for the five surfaces.
 * @param props - locale seat, the open callback, and Browser / Diff availability.
 * @returns the empty-state grid.
 */
export function EmptyState({
  onOpen, t, browserAvailable = true, diffAvailable = true,
}: EmptyStateProps): ReactNode {
  return (
    <div className={css.root} data-surfaces-empty>
      <div className={css.inner}>
        <div className={css.heading}>
          <h3 className={css.title}>{t('empty.title')}</h3>
          <p className={css.subtitle}>{t('empty.subtitle')}</p>
        </div>
        <div className={css.grid}>
          {CARDS.map((card) => {
            const available = card.kind === 'preview'
              ? browserAvailable
              : card.kind !== 'diff' || diffAvailable
            const reason = available
              ? undefined
              : card.kind === 'preview' ? t('card.browser.disabled') : t('card.diff.disabled')
            const button = (
              <button
                type="button"
                className={clsx(css.card, !available && css.disabled)}
                disabled={!available}
                title={reason}
                onClick={() => { onOpen(card.kind) }}
              >
                <card.Icon className={css.icon ?? ''} size={20} />
                <span className={css.cardTitle}>{t(card.title)}</span>
                <span className={css.cardDescription}>{t(card.description)}</span>
              </button>
            )
            const cell = (
              <div className={css.cardWrap} data-surfaces-card-cell>{button}</div>
            )
            if (available) return <Fragment key={card.kind}>{cell}</Fragment>
            return (
              <Tooltip key={card.kind} label={reason ?? ''} side="top">
                {cell}
              </Tooltip>
            )
          })}
        </div>
      </div>
    </div>
  )
}
