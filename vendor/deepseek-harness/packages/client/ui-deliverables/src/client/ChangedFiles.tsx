/** The changed-files card: a header and per-file rows that open the turn's review, and a three-row fold. */
import { useState } from 'react'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import { IconChevronDownOutline14, IconChevronUpOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangesSummary } from '../changes.ts'
import { IconCodeBracketsOutline16 } from './icons.tsx'
import type { NS } from './locales.ts'
import css from './ChangedFiles.module.css'

/** Rows shown before the fold; the design's summary height for a closing message. */
const COLLAPSED_ROWS = 3

const GROUPED = new Intl.NumberFormat('en-US')

/** Added and deleted line counts in the card's colors. */
function Counts({ added, deleted, t }: { added: number; deleted: number } & PropsLocale<typeof NS>) {
  return <>
    <span className={css.added}>{t('changes.added', { count: GROUPED.format(added) })}</span>
    <span className={css.deleted}>{t('changes.deleted', { count: GROUPED.format(deleted) })}</span>
  </>
}

/**
 * Render one turn's changed files. The header opens the turn's review in the
 * right Sidebar on its first file; each row opens it on that row's file.
 * @param props - the recorded summary, the review opener, and localized copy.
 * @returns the card.
 */
export function ChangedFiles({ changes, cwd, openReview, t }: {
  /** The served summary with the sequence of the event that announced it. */
  changes: Pick<ChangesSummary, 'files' | 'total' | 'added' | 'deleted'> & { seq: number }
  cwd: string | undefined
  /** Open the turn's review on the file at an original summary index. */
  openReview: (index: number) => void
} & PropsLocale<typeof NS>) {
  const [expanded, setExpanded] = useState(false)
  const foldable = changes.files.length > COLLAPSED_ROWS
  const rows = foldable && !expanded ? changes.files.slice(0, COLLAPSED_ROWS) : changes.files
  return <div className={css.card} data-changed-files>
    <button type="button" className={css.header} aria-label={t('changes.openReview')} onClick={() => { openReview(0) }}>
      <span className={css.tile}><IconCodeBracketsOutline16 size={18} /></span>
      <span className={css.titles}>
        <span className={css.title}>{t('changes.title', { count: String(changes.total) })}</span>
        <span className={css.stat}><Counts t={t} added={changes.added} deleted={changes.deleted} /></span>
      </span>
    </button>
    <ul className={css.list}>
      {rows.map((file, index) => (
        <li key={file.display}>
          <button type="button" className={css.row} title={resolveWorkspacePath(cwd, file.path)}
            aria-label={t('changes.viewDiff', { name: file.display })}
            onClick={() => { openReview(index) }}>
            <span className={css.path}>{file.display}</span>
            <span className={css.counts}>
              {file.binary === true ? t('changes.binary')
                : file.oversized === true ? t('changes.oversized')
                  : <Counts t={t} added={file.added} deleted={file.deleted} />}
            </span>
          </button>
        </li>
      ))}
    </ul>
    {foldable && <button type="button" className={css.toggle}
      aria-expanded={expanded}
      aria-label={t(expanded ? 'changes.collapseAria' : 'changes.expandAria', { count: String(changes.files.length) })}
      onClick={() => { setExpanded(value => !value) }}>
      <span>{t(expanded ? 'changes.collapse' : 'changes.all', { count: String(changes.files.length) })}</span>
      {expanded ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
    </button>}
  </div>
}
