/** Shared file comparison for the turn-tail hover preview and Sidebar review. */
import type { ReactNode } from 'react'
import {
  Button, languageForPath, MAX_RENDERED_LINES, ReviewDiff,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReviewNote } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangesDiff } from '../changes.ts'
import type { ChangesDiffState } from './changes-diff.ts'
import type { NS } from './locales.ts'
import css from './FileDiff.module.css'

/** The one-line fact about a text comparison worth stating above its hunks, if any. */
function noteOf(diff: Extract<ChangesDiff, { kind: 'text' }>): 'diff.created' | 'diff.deleted' | 'diff.unchanged' | undefined {
  if (!diff.before) return 'diff.created'
  if (!diff.after) return 'diff.deleted'
  if (diff.hunks.length === 0) return 'diff.unchanged'
  return undefined
}

/**
 * Render a file comparison with the same states and highlighting in previews and review tabs.
 * The hunk body is the shared {@link ReviewDiff}; state mapping and localized notes stay here.
 * @param props - comparison state, layout choices, retry action, and localized copy.
 * @returns the comparison or its loading, unavailable, or error state.
 */
export function FileDiff({ state, split, wrap, retry, t }: {
  state: ChangesDiffState | undefined
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
  const note = noteOf(state)
  const notes: ReviewNote[] = []
  if (note !== undefined) notes.push({ text: t(note), attrs: { 'data-diff-note': state.hunks.length === 0 ? 'empty' : 'metadata' } })
  if (state.coarse) notes.push({ text: t('diff.coarse'), attrs: { 'data-diff-coarse': '' } })
  return (
    <ReviewDiff
      hunks={state.hunks}
      language={languageForPath(state.path)}
      split={split}
      wrap={wrap}
      notes={notes}
      truncatedNote={t('diff.truncated', { count: String(MAX_RENDERED_LINES) })}
      skippedNote={t('diff.highlightSkipped')}
    />
  )
}
