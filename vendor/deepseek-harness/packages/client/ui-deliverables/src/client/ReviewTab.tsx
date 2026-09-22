/**
 * The review tab: one turn's changed files behind a file selector, with the
 * selected file's turn-start and turn-end comparison drawn unified or side by
 * side, wrapped or scrolling, and controls to open the file itself.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, UIEvent } from 'react'
import {
  Button, IconChevronDownOutline14, IconCodeOutline16, IconPanelLeftOutline16, IconRightUpOutline16, IconWrapLinesOutline16, Menu, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { WorkspaceChangedFile, WorkspaceDiffHunk } from '@deepseek-ai/dsh-workspace-changes/types'
import { changedFileUrl, changesDiffUrl, changesSummaryUrl, parseChangesReviewAddress, type ChangesDiff } from '../changes.ts'
import type { ChangesDiffStore } from './changes-diff.ts'
import type { ChangesSummaryStore } from './changes-summary.ts'
import type { PresentedOpenController } from './present-open.ts'
import type { ChangesReviewParams } from './review-definition.ts'
import type { createReviewStore } from './review-store.ts'
import type { NS } from './locales.ts'
import css from './ReviewTab.module.css'

/** Lines drawn before the tab stops; a coarse comparison of a file near the byte cap would otherwise draw every line. */
export const MAX_RENDERED_LINES = 5000

const GROUPED = new Intl.NumberFormat('en-US')

/** Summary and comparison reads, desktop metadata, and the native open supplied by the plugin. */
export interface ReviewInjected {
  hooks: {
    changesSummary: ObservableSnapshot<ReturnType<ChangesSummaryStore['state']['getSnapshot']>>
    changesDiff: ObservableSnapshot<ReturnType<ChangesDiffStore['state']['getSnapshot']>>
    presentedOpen: ObservableSnapshot<ReturnType<PresentedOpenController['state']['getSnapshot']>>
    presentedHost: ObservableSnapshot<ReturnType<PresentedOpenController['host']['getSnapshot']>>
  }
  loadChangesSummary: ChangesSummaryStore['load']
  loadChangesDiff: ChangesDiffStore['load']
  reloadPresentedHost: PresentedOpenController['loadHost']
  openChanged: PresentedOpenController['openChanged']
}

/** The body's composed props: the tab it draws, its store, its injected face, and its copy. */
export type ReviewTabProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsStore<ReturnType<typeof createReviewStore>>
  & InjectFace<ReviewInjected> & PropsLocale<typeof NS>

/** One drawn line of a hunk with its line numbers on each side. */
export interface DiffRow {
  kind: 'add' | 'del' | 'context'
  old: number | undefined
  new: number | undefined
  text: string
}

/** One side-by-side row: the old side, the new side, or both. */
export interface SplitRow {
  left?: { no: number; text: string; kind: 'del' | 'context' }
  right?: { no: number; text: string; kind: 'add' | 'context' }
}

/**
 * Number a hunk's lines: context lines count on both sides, deletions on the
 * old side, additions on the new side.
 * @param hunk - a served hunk.
 * @returns the rows in order.
 */
export function hunkRows(hunk: WorkspaceDiffHunk): DiffRow[] {
  let oldNo = hunk.oldStart
  let newNo = hunk.newStart
  return hunk.lines.map((line) => {
    const text = line.slice(1)
    switch (line[0]) {
      case '+': return { kind: 'add', old: undefined, new: newNo++, text }
      case '-': return { kind: 'del', old: oldNo++, new: undefined, text }
      default: return { kind: 'context', old: oldNo++, new: newNo++, text }
    }
  })
}

/**
 * Pair a hunk's lines for the side-by-side view: each run of deletions is
 * aligned with the run of additions that follows it, row by row, and context
 * lines sit on both sides.
 * @param hunk - a served hunk.
 * @returns the rows in order.
 */
export function splitRows(hunk: WorkspaceDiffHunk): SplitRow[] {
  const rows: SplitRow[] = []
  let dels: NonNullable<SplitRow['left']>[] = []
  let adds: NonNullable<SplitRow['right']>[] = []
  const flush = (): void => {
    for (let at = 0; at < Math.max(dels.length, adds.length); at += 1) {
      const left = dels[at]
      const right = adds[at]
      rows.push({ ...left === undefined ? {} : { left }, ...right === undefined ? {} : { right } })
    }
    dels = []
    adds = []
  }
  for (const row of hunkRows(hunk)) {
    if (row.kind === 'del') dels.push({ no: row.old as number, text: row.text, kind: 'del' })
    else if (row.kind === 'add') adds.push({ no: row.new as number, text: row.text, kind: 'add' })
    else {
      flush()
      rows.push({ left: { no: row.old as number, text: row.text, kind: 'context' }, right: { no: row.new as number, text: row.text, kind: 'context' } })
    }
  }
  flush()
  return rows
}

/**
 * The hunks to draw, cut at {@link MAX_RENDERED_LINES} lines in total.
 * @param hunks - served hunks.
 * @returns the hunks with the last one shortened as needed, and whether anything was cut.
 */
export function renderedHunks(hunks: readonly WorkspaceDiffHunk[]): { hunks: WorkspaceDiffHunk[]; truncated: boolean } {
  let budget = MAX_RENDERED_LINES
  const kept: WorkspaceDiffHunk[] = []
  for (const hunk of hunks) {
    if (budget === 0) return { hunks: kept, truncated: true }
    kept.push(hunk.lines.length <= budget ? hunk : { ...hunk, lines: hunk.lines.slice(0, budget) })
    budget -= Math.min(budget, hunk.lines.length)
  }
  return { hunks: kept, truncated: hunks.some((hunk, at) => kept[at] !== hunk) }
}

/** The one-line fact about a text comparison worth stating above its hunks, if any. */
function noteOf(diff: Extract<ChangesDiff, { kind: 'text' }>): 'diff.created' | 'diff.deleted' | 'diff.unchanged' | undefined {
  if (!diff.before) return 'diff.created'
  if (!diff.after) return 'diff.deleted'
  if (diff.hunks.length === 0) return 'diff.unchanged'
  return undefined
}

/** The file index a navigation names, when it names one. */
function navigatedIndex(params: unknown): number | undefined {
  const index = (params as ChangesReviewParams | undefined)?.index
  return typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 ? index : undefined
}

/** Added and deleted line counts in the card's colors. */
function Counts({ file, t }: { file: WorkspaceChangedFile } & PropsLocale<typeof NS>): ReactNode {
  if (file.binary === true) return <span className={css.label}>{t('changes.binary')}</span>
  if (file.oversized === true) return <span className={css.label}>{t('changes.oversized')}</span>
  return <>
    <span className={css.added}>{t('changes.added', { count: GROUPED.format(file.added) })}</span>
    <span className={css.deleted}>{t('changes.deleted', { count: GROUPED.format(file.deleted) })}</span>
  </>
}

/**
 * The review type's body, registered under `sidebar.right.pane.tab` as `changes-review`.
 * @param props - composed slot props.
 * @returns the selected file's comparison behind the file selector, or the state that stands in for it.
 */
export function ReviewTab({
  useTabInfo, sessionId, useSessions, useStore, actions, useChangesSummary, useChangesDiff, usePresentedOpen, usePresentedHost,
  loadChangesSummary, loadChangesDiff, reloadPresentedHost, openChanged, t,
}: ReviewTabProps): ReactNode {
  const { tab } = useTabInfo()
  const { navigation, signal } = tab
  const coordinates = useMemo(() => parseChangesReviewAddress(tab.contentId), [tab.contentId])
  if (coordinates === undefined) throw new Error(`ui-deliverables: not a review address "${tab.contentId}"`)
  const { seq } = coordinates
  const cwd = useSessions(sessions => sessions.byId[sessionId]?.cwd)
  const summary = useChangesSummary(value => value[changesSummaryUrl(sessionId, seq)])
  const state = useStore(store => store.byTab[tab.id])
  const host = usePresentedHost(value => value)
  // Every navigation to this tab applies its file index once; the first one seeds the tab's choices.
  useEffect(() => {
    if (state?.navigated === navigation.revision) return
    actions.navigated(tab.id, navigation.revision, navigatedIndex(navigation.params) ?? state?.index ?? 0)
  }, [state, navigation.revision, navigation.params, actions, tab.id])
  useEffect(() => {
    const forget = (): void => { actions.forget(tab.id) }
    signal.addEventListener('abort', forget, { once: true })
    return () => { signal.removeEventListener('abort', forget) }
  }, [signal, actions, tab.id])
  useEffect(() => {
    if (summary === undefined) void loadChangesSummary(sessionId, seq)
  }, [summary, sessionId, seq, loadChangesSummary])
  useEffect(() => {
    if (host === null) void reloadPresentedHost()
  }, [host, reloadPresentedHost])
  const files = typeof summary === 'object' ? summary.files : []
  // A navigated index the summary does not list falls back to the first file.
  const index = state !== undefined && files[state.index] !== undefined ? state.index : 0
  const file = files[index]
  const diffState = useChangesDiff(value => file === undefined ? undefined : value[changesDiffUrl(sessionId, seq, index)])
  useEffect(() => {
    if (file !== undefined && diffState === undefined) void loadChangesDiff(sessionId, seq, index)
  }, [file, diffState, sessionId, seq, index, loadChangesDiff])
  const phase = usePresentedOpen(value => file === undefined ? undefined : value[changedFileUrl(sessionId, seq, index)])
  const [menuOpen, setMenuOpen] = useState(false)
  const split = state?.split === true
  const wrap = state?.wrap === true
  const native = host !== null && host !== 'error' && host.available && phase !== 'nativeUnavailable'
  const summaryState = summary === undefined || summary === 'loading' ? 'loading' : summary === 'missing' ? 'missing' : 'ready'
  return (
    <div className={css.root} data-changes-review data-review-state={summaryState}>
      <div className={css.header}>
        {file === undefined
          ? <span className={css.selectorLabel}>{t('review.title', { turn: String(coordinates.turn) })}</span>
          : <Menu className={css.selector} open={menuOpen} autoFocus portal align="start" dense onClose={() => { setMenuOpen(false) }}
            anchor={<button type="button" className={css.selectorButton} aria-haspopup="menu" aria-expanded={menuOpen}
              aria-label={t('review.selectFile')} title={file.display} data-review-file={file.path}
              onClick={() => { setMenuOpen(value => !value) }}>
              <span className={css.selectorText}>{file.display}</span>
              <IconChevronDownOutline14 size={12} />
            </button>}
            items={files.map((entry, at) => ({ id: String(at), label: <span className={css.item}>
              <span className={css.itemPath}>{entry.display}</span>
              <span className={css.itemCounts}><Counts file={entry} t={t} /></span>
            </span> }))}
            selectedId={String(index)}
            onSelect={(id) => { actions.selected(tab.id, Number(id)); setMenuOpen(false) }} />}
        {file !== undefined && <span className={css.counts}><Counts file={file} t={t} /></span>}
        <span className={css.tools}>
          <Tooltip label={t(split ? 'review.unified' : 'review.split')} side="bottom" delayMs={500}>
            <button type="button" className={css.tool} aria-pressed={split} aria-label={t('review.splitAria')} data-review-tool="split"
              onClick={() => { actions.toggledSplit(tab.id) }}><IconPanelLeftOutline16 /></button>
          </Tooltip>
          <Tooltip label={t(wrap ? 'review.nowrap' : 'review.wrap')} side="bottom" delayMs={500}>
            <button type="button" className={css.tool} aria-pressed={wrap} aria-label={t('review.wrapAria')} data-review-tool="wrap"
              onClick={() => { actions.toggledWrap(tab.id) }}><IconWrapLinesOutline16 /></button>
          </Tooltip>
          {file !== undefined && <Tooltip label={t('review.openFile')} side="bottom" delayMs={500}>
            <button type="button" className={css.tool} aria-label={t('review.openFileAria', { name: file.display })} data-review-tool="open-file"
              onClick={() => { tab.actions.openResource(fileAddressFor(sessionId, cwd, file.path)) }}><IconCodeOutline16 /></button>
          </Tooltip>}
          {file !== undefined && native && <Tooltip label={t(phase === 'error' ? 'diff.openNativeError' : 'diff.openNative')} side="bottom" delayMs={500}>
            <button type="button" className={css.tool} disabled={phase === 'opening'} data-review-tool="open-native"
              aria-label={t('diff.openNativeAria', { name: file.display })} data-error={phase === 'error' || undefined}
              onClick={() => { void openChanged(sessionId, seq, index) }}><IconRightUpOutline16 /></button>
          </Tooltip>}
        </span>
      </div>
      {summaryState === 'loading' && <p className={css.status} role="status">{t('diff.loading')}</p>}
      {summaryState === 'missing' && <p className={css.status}>{t('diff.missing')}</p>}
      {file !== undefined && <FileBody state={diffState} split={split} wrap={wrap} t={t}
        retry={() => { void loadChangesDiff(sessionId, seq, index) }} />}
    </div>
  )
}

/** The selected file's comparison, or the state that stands in for it. */
function FileBody({ state, split, wrap, retry, t }: {
  state: ChangesDiffStore['state'] extends { getSnapshot(): infer S } ? (S extends Record<string, infer V> ? V : never) : never
  split: boolean
  wrap: boolean
  retry: () => void
} & PropsLocale<typeof NS>): ReactNode {
  if (state === undefined || state === 'loading') return <p className={css.status} role="status">{t('diff.loading')}</p>
  if (state === 'missing') return <p className={css.status}>{t('diff.missing')}</p>
  if (state === 'error') {
    return <div className={css.status}><span>{t('diff.error')}</span><Button size="sm" onClick={retry}>{t('presented.retry')}</Button></div>
  }
  if (state.kind === 'binary') return <p className={css.status}>{t('diff.binary')}</p>
  if (state.kind === 'oversized') return <p className={css.status}>{t('diff.oversized')}</p>
  return <TextDiff diff={state} split={split} wrap={wrap} t={t} />
}

/** The kind a paired row carries: a deletion or addition on either side, otherwise context. */
function splitRowKind(row: SplitRow): DiffRow['kind'] {
  return row.left?.kind === 'del' ? 'del' : row.right?.kind === 'add' ? 'add' : 'context'
}

function hunkHeader(hunk: WorkspaceDiffHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
}

/**
 * The side-by-side view without wrapping: two columns that clip their long
 * lines and scroll sideways together, so a long line on one side never runs
 * under the other and both sides show the same columns of text. Every line is
 * one fixed-height row, which keeps the sides aligned.
 */
function SplitColumns({ hunks }: { hunks: readonly WorkspaceDiffHunk[] }): ReactNode {
  const paired = useMemo(() => hunks.map(hunk => ({ header: hunkHeader(hunk), rows: splitRows(hunk) })), [hunks])
  const columns = useRef<Record<'left' | 'right', HTMLDivElement | null>>({ left: null, right: null })
  // Mirror one side's horizontal offset onto the other; the mirrored side's own scroll event then finds nothing to change.
  const follow = (side: 'left' | 'right') => (event: UIEvent<HTMLDivElement>): void => {
    const other = columns.current[side === 'left' ? 'right' : 'left']
    if (other !== null && other.scrollLeft !== event.currentTarget.scrollLeft) other.scrollLeft = event.currentTarget.scrollLeft
  }
  return (
    <div className={css.columns}>
      {(['left', 'right'] as const).map(side => (
        <div key={side} className={css.column} data-diff-side={side}
          ref={(element) => { columns.current[side] = element }} onScroll={follow(side)}>
          {paired.map((hunk, position) => (
            <section key={position} className={css.hunk}>
              <div className={css.hunkHeader}>{hunk.header}</div>
              {hunk.rows.map((row, at) => {
                const cell = row[side]
                return (
                  <div key={at} className={`${css.sideLine} ${cell === undefined ? css.empty : css[cell.kind]}`} data-diff-line={splitRowKind(row)}>
                    <span className={css.number}>{cell?.no ?? ''}</span>
                    <span className={css.text}>{cell?.text ?? ''}</span>
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      ))}
    </div>
  )
}

/** The hunks of a text comparison with their line numbers, unified or side by side. */
function TextDiff({ diff, split, wrap, t }: { diff: Extract<ChangesDiff, { kind: 'text' }>; split: boolean; wrap: boolean } & PropsLocale<typeof NS>): ReactNode {
  const note = noteOf(diff)
  const { hunks, truncated } = useMemo(() => renderedHunks(diff.hunks), [diff.hunks])
  return (
    <div className={css.body} data-review-view={split ? 'split' : 'unified'} data-review-wrap={wrap || undefined}>
      {note !== undefined && <p className={css.note}>{t(note)}</p>}
      {diff.coarse && <p className={css.note} data-diff-coarse>{t('diff.coarse')}</p>}
      {truncated && <p className={css.note} data-diff-truncated>{t('diff.truncated', { count: String(MAX_RENDERED_LINES) })}</p>}
      {split && !wrap ? <SplitColumns hunks={hunks} /> : hunks.map((hunk, position) => (
        <section key={position} className={css.hunk}>
          <div className={css.hunkHeader}>{hunkHeader(hunk)}</div>
          {split ? splitRows(hunk).map((row, at) => (
            <div key={at} className={css.splitLine} data-diff-line={splitRowKind(row)}>
              <span className={`${css.cell} ${row.left === undefined ? css.empty : css[row.left.kind]}`}>
                <span className={css.number}>{row.left?.no ?? ''}</span>
                <span className={css.text}>{row.left?.text ?? ''}</span>
              </span>
              <span className={`${css.cell} ${row.right === undefined ? css.empty : css[row.right.kind]}`}>
                <span className={css.number}>{row.right?.no ?? ''}</span>
                <span className={css.text}>{row.right?.text ?? ''}</span>
              </span>
            </div>
          )) : hunkRows(hunk).map((row, at) => (
            <div key={at} className={`${css.line} ${css[row.kind]}`} data-diff-line={row.kind}>
              <span className={css.number}>{row.old ?? ''}</span>
              <span className={css.number}>{row.new ?? ''}</span>
              <span className={css.sign}>{row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}</span>
              <span className={css.text}>{row.text}</span>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
