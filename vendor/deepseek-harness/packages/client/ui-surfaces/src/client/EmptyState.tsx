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
import type { SidebarRightGuideBox } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { NS } from './locales.ts'
import type { OpenableKind } from './stores.ts'
import css from './EmptyState.module.css'

/** The upstream guide inventory and the opener the card grid forwards to. */
export interface EmptyStateGuide {
  /** Every entry the native dock's guide offers, in registry order. */
  readonly entries: readonly SidebarRightGuideBox[]
  /** Place the picked kind as a native dock page in this seat's Session. */
  readonly open: (kind: string) => void
}

export type EmptyStateProps = PropsLocale<typeof NS> & {
  /** Open a classic surface; the legacy card set's action. */
  onOpen: (kind: OpenableKind) => void
  /**
   * The native dock's guide mirror. When present the grid lists these entries
   * instead of the legacy five-surface set — the right side's entry inventory
   * then has one source of truth and each card opens its upstream page.
   */
  guide?: EmptyStateGuide | undefined
  /** False outside the desktop app (no preview IPC). */
  browserAvailable?: boolean
  /** False when the workspace is not a git repository. */
  diffAvailable?: boolean
}

type CardIcon = ComponentType<{ size?: number | undefined; className?: string | undefined }>

type CardSpec = {
  kind: OpenableKind
  title: 'card.browser' | 'card.terminal' | 'card.files' | 'card.diff' | 'card.agents'
  description:
    | 'card.browser.description'
    | 'card.terminal.description'
    | 'card.files.description'
    | 'card.diff.description'
    | 'card.agents.description'
  Icon: CardIcon
}

const CARDS: readonly CardSpec[] = [
  { kind: 'preview', title: 'card.browser', description: 'card.browser.description', Icon: IconGlobeOutline14 },
  { kind: 'terminal', title: 'card.terminal', description: 'card.terminal.description', Icon: IconPanelBottomOutline16 },
  { kind: 'files', title: 'card.files', description: 'card.files.description', Icon: IconFolderOpenOutline16 },
  { kind: 'diff', title: 'card.diff', description: 'card.diff.description', Icon: IconCommitOutline16 },
  { kind: 'agents', title: 'card.agents', description: 'card.agents.description', Icon: IconAgentPresetOutline16 },
]

/** One grid cell's resolved content, whichever source the entry came from. */
type CardView = {
  readonly key: string
  readonly title: string
  readonly description: string | undefined
  readonly Icon: CardIcon | undefined
  /** Disabled reason; defined marks the card unavailable. */
  readonly reason: string | undefined
  readonly open: () => void
}

/**
 * The cube an icon-less upstream entry falls back to — mirrors the guide
 * body's CubeGlyph; client packages cannot share a value export.
 */
function CubeGlyph({ size = 16, className }: { size?: number | undefined; className?: string | undefined }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <path d="M7.99998 2.5L12.9 5.2V10.8L7.99998 13.5L3.09998 10.8V5.2L7.99998 2.5Z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M3.09998 5.19995L7.99998 7.89995M7.99998 7.89995L12.9 5.19995M7.99998 7.89995V13.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * 2×N empty-state cards. With a `guide` the grid lists the native dock's
 * registered entries one-for-one and opens them through `guide.open`;
 * without one it keeps the legacy five-surface set with its availability
 * gates.
 * @param props - locale seat, the classic open callback, the guide mirror, and Browser / Diff availability.
 * @returns the empty-state grid.
 */
export function EmptyState({
  onOpen, guide, t, browserAvailable = true, diffAvailable = true,
}: EmptyStateProps): ReactNode {
  const views: readonly CardView[] = guide === undefined
    ? CARDS.map((card): CardView => {
      const available = card.kind === 'preview'
        ? browserAvailable
        : card.kind !== 'diff' || diffAvailable
      const reason = available
        ? undefined
        : card.kind === 'preview' ? t('card.browser.disabled') : t('card.diff.disabled')
      return {
        key: card.kind,
        title: t(card.title),
        description: t(card.description),
        Icon: card.Icon,
        reason,
        open: () => { onOpen(card.kind) },
      }
    })
    : guide.entries.map((entry): CardView => ({
      key: `${entry.providerId}:${entry.id}`,
      title: entry.title(),
      description: entry.description?.(),
      Icon: entry.icon,
      reason: undefined,
      open: () => { guide.open(entry.kind) },
    }))
  return (
    <div className={css.root} data-surfaces-empty>
      <div className={css.inner}>
        <div className={css.heading}>
          <h3 className={css.title}>{t('empty.title')}</h3>
          <p className={css.subtitle}>{t('empty.subtitle')}</p>
        </div>
        <div className={css.grid}>
          {views.map((card) => {
            const available = card.reason === undefined
            const Icon = card.Icon ?? CubeGlyph
            const button = (
              <button
                type="button"
                className={clsx(css.card, !available && css.disabled)}
                disabled={!available}
                title={card.reason}
                onClick={card.open}
              >
                <Icon className={css.icon ?? ''} size={20} />
                <span className={css.cardTitle}>{card.title}</span>
                <span className={css.cardDescription}>{card.description}</span>
              </button>
            )
            const cell = (
              <div className={css.cardWrap} data-surfaces-card-cell>{button}</div>
            )
            if (available) return <Fragment key={card.key}>{cell}</Fragment>
            return (
              <Tooltip key={card.key} label={card.reason ?? ''} side="top">
                {cell}
              </Tooltip>
            )
          })}
        </div>
      </div>
    </div>
  )
}
