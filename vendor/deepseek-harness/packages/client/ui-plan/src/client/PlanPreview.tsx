/** Read-only Markdown viewer for logged plans and temporary review documents. */
import { useMemo } from 'react'
import { IconCopyOutline16, IconPlanOutline14, MarkdownText, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from './plan-resource.ts'
import { isReviewPreviewAddress } from './review-preview.ts'
import { planFailureLine } from './failure-line.ts'
import css from './PlanPreview.module.css'

type PlanPreviewProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'plan'>

/**
 * Render the submitted plan with its complete Markdown and a copy action.
 * @param props - Framework-bound tab identity, resource, and copy.
 * @returns the plan document or a localized loading/failure state.
 */
export function PlanPreview({ useTabInfo, useResource, t }: PlanPreviewProps) {
  const tab = useTabInfo()
  const resource = useResource<'plan'>(tab.tab.navigation.address)
  const temporary = isReviewPreviewAddress(tab.tab.navigation.address)
  const params = tab.tab.navigation.params
  const plan = temporary ? (params !== undefined && 'planReview' in params ? params.planReview : undefined) : resource.value
  const labels = useMemo(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])
  if (plan === undefined) return (
    <div className={css.message} role="status">
      {temporary ? t('preview.expired') : resource.status === 'none' ? t('preview.unavailable')
        : resource.status === 'failed' ? t('preview.failed') : t('preview.loading')}
      {!temporary && resource.failure !== undefined && <p>{planFailureLine(t, resource.failure)}</p>}
    </div>
  )
  return (
    <section className={css.preview} data-plan-preview={'callId' in plan ? plan.callId : tab.tab.navigation.address} aria-label={plan.title}>
      <div className={css.toolbar}><button type="button" className={css.iconButton} aria-label={t('copy')}
        onClick={() => { void writeClipboard(plan.markdown) }}><IconCopyOutline16 /></button></div>
      <div className={css.document}><MarkdownText text={plan.markdown} labels={labels} /></div>
    </section>
  )
}

/**
 * Display a plan icon and the heading in its tab after resource recovery.
 * @param props - Framework-bound tab identity and resource reader.
 * @returns a decorative plan icon followed by the recovered title or initial localized label.
 */
export function PlanTitle({ useTabInfo, useResource }: PropsRuntime<'sidebar.right.pane.tab.title'>) {
  const tab = useTabInfo()
  const resource = useResource<'plan'>(tab.tab.navigation.address)
  const params = tab.tab.navigation.params
  const plan = isReviewPreviewAddress(tab.tab.navigation.address)
    ? (params !== undefined && 'planReview' in params ? params.planReview : undefined) : resource.value
  return <><span className={css.titleIcon} aria-hidden="true"><IconPlanOutline14 size={16} /></span>{plan?.title ?? tab.tab.title}</>
}
