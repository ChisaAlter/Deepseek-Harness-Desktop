/** The changed-files card: a header and per-file rows that open the turn's review, and a four-row fold. */
import { useEffect, useId, useRef, useState } from 'react'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import { HoverCard, IconChevronDownOutlineRegular, IconChevronUpOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, SessionStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { changesDiffUrl, type ChangesSummary } from '../changes.ts'
import type { DeliverablesInjected } from './Deliverables.tsx'
import { FileDiff } from './FileDiff.tsx'
import diffCss from './FileDiff.module.css'
import { IconCodeBracketsOutline16 } from './icons.tsx'
import type { NS } from './locales.ts'
import css from './ChangedFiles.module.css'

type PreviewProps = Pick<InjectFace<DeliverablesInjected>, 'useChangesDiff' | 'loadChangesDiff'>
  & Pick<SessionStandardProps, 'sessionId'>

/** Rows shown before the fold; the design's summary height for a closing message. */
const COLLAPSED_ROWS = 4

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
 * right Sidebar on its first file; each row previews its comparison after a
 * 500ms hover and opens the review on click.
 * @param props - the recorded summary, the review opener, and localized copy.
 * @returns the card.
 */
export function ChangedFiles({ changes, cwd, openReview, t, sessionId, useChangesDiff, loadChangesDiff }: {
  /** The served summary with the sequence of the event that announced it. */
  changes: Pick<ChangesSummary, 'files' | 'total' | 'added' | 'deleted'> & { seq: number }
  cwd: string | undefined
  /** Open the turn's review on the file at an original summary index. */
  openReview: (index: number) => void
} & PropsLocale<typeof NS> & PreviewProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const pathDescriptionId = useId()
  const [expanded, setExpanded] = useState(false)
  const foldable = changes.files.length > COLLAPSED_ROWS
  const rows = foldable && !expanded ? changes.files.slice(0, COLLAPSED_ROWS) : changes.files
  return <div ref={cardRef} className={css.card} data-changed-files>
    <button type="button" className={css.header} aria-label={t('changes.openReview')} onClick={() => { openReview(0) }}>
      <span className={css.tile}>
        <span className={css.tileMark}><IconCodeBracketsOutline16 size={10} /></span>
      </span>
      <span className={css.titles}>
        <span className={css.title}>{t('changes.title', { count: String(changes.total) })}</span>
        <span className={css.stat}>
          <span className={css.statCounts}><Counts t={t} added={changes.added} deleted={changes.deleted} /></span>
          <span className={css.previewHint}>{t('presented.preview')}</span>
        </span>
      </span>
    </button>
    <ul className={css.list}>
      {rows.map((file, index) => (
        <li key={file.display}>
          <HoverCard variant="preview" widthAnchorRef={cardRef} openDelayMs={500}
            content={<ChangedFilePreview sessionId={sessionId} seq={changes.seq} index={index}
              display={resolveWorkspacePath(cwd, file.path)} useChangesDiff={useChangesDiff} loadChangesDiff={loadChangesDiff} t={t} />}
            anchor={<button type="button" className={css.row}
              aria-label={t('changes.viewDiff', { name: file.display })}
              aria-describedby={`${pathDescriptionId}-${index}`}
              onClick={() => { openReview(index) }}>
              <span className={css.path}>{file.display}</span>
              <span className={css.counts}>
                {file.binary === true ? t('changes.binary')
                  : file.oversized === true ? t('changes.oversized')
                    : <Counts t={t} added={file.added} deleted={file.deleted} />}
              </span>
            </button>} />
          <span id={`${pathDescriptionId}-${index}`} hidden>{resolveWorkspacePath(cwd, file.path)}</span>
        </li>
      ))}
    </ul>
    {foldable && <button type="button" className={css.toggle}
      aria-expanded={expanded}
      aria-label={t(expanded ? 'changes.collapseAria' : 'changes.expandAria', { count: String(changes.files.length) })}
      onClick={() => { setExpanded(value => !value) }}>
      <span>{t(expanded ? 'changes.collapse' : 'changes.all', { count: String(changes.files.length) })}</span>
      {expanded ? <IconChevronUpOutlineRegular /> : <IconChevronDownOutlineRegular />}
    </button>}
  </div>
}

/** Mounted only while its hover card is open, so passing over a row does not read a comparison. */
function ChangedFilePreview({ sessionId, seq, index, display, useChangesDiff, loadChangesDiff, t }: PreviewProps & {
  seq: number
  index: number
  display: string
} & PropsLocale<typeof NS>) {
  const state = useChangesDiff(value => value[changesDiffUrl(sessionId, seq, index)])
  useEffect(() => {
    if (state === undefined) void loadChangesDiff(sessionId, seq, index)
  }, [state, sessionId, seq, index, loadChangesDiff])
  return <div className={`${diffCss.root} ${css.preview}`} data-changes-hover-preview>
    <div className={diffCss.header}><span className={css.previewPath} data-changes-preview-path>{display}</span></div>
    <FileDiff state={state} split={false} wrap={false} t={t} retry={() => { void loadChangesDiff(sessionId, seq, index) }} />
  </div>
}
