/** Persistent transcript cards and pending-review sidebar navigation. */
import { useEffect } from 'react'
import { FileTypeIcon, IconChevronRightOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { shallowEqual } from '@deepseek-ai/dsh-client-store'
import type {} from './plan-definition.ts'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type {} from '@deepseek-ai/dsh-client-ui-user-questions/client'
import type { createPlanReviewStore } from './review-store.ts'
import css from './PlanPreview.module.css'

/** Session-bound navigation for logged plans. */
export interface PlanOpenInjected {
  /** Open or focus the exact submitted plan. */
  openPlan: (callId: ToolCallId) => void
}

/** Session-bound preview navigation for one pending review. */
export interface PlanReviewOpenInjected {
  /** Open the logged plan, or the request's temporary document when no invocation exists. */
  openReview: (review: PropsRuntime<'conversation.plan-review.actions'>['review'], requestKey: string) => void
}

/**
 * Render the completed Turn's submitted plans in invocation order.
 * @param props - Logged plan, localized copy, and Session-bound navigation.
 * @returns keyboard-accessible plan cards, or null for a Turn without plans.
 */
export function PlanCards({ turn, useChat, openPlan, t }: PropsRuntime<'conversation.chat.turnTail'> & InjectFace<PlanOpenInjected> & PropsLocale<'plan'>) {
  const plans = useChat(snapshot => snapshot.nodes.values()
    .filter((node): node is ChatNode<'submitted-plan'> => node.kind === 'submitted-plan'
      && (node.location.kind === 'turn' || node.location.kind === 'step')
      && node.location.turn.turn === turn.turn)
    .sort((a, b) => a.anchorSeq - b.anchorSeq), shallowEqual)
  if (plans.length === 0) return null
  return (
    <div className={css.cards} data-plan-artifacts>
      {plans.map(({ data: plan }) => <button key={plan.callId} type="button" className={css.card} data-plan-card={plan.callId}
        aria-label={t('preview.openNamed', { title: plan.title })}
        onClick={() => { openPlan(plan.callId) }}>
        <span className={css.cardIcon}><FileTypeIcon kind="markdown" size={20} /></span>
        <span className={css.cardDetails}>
          <span className={css.cardTitle}>{plan.title}</span>
          <span className={css.cardDescription}>{t('preview.document')}</span>
        </span>
        <span className={css.cardOpen}>{t('preview.action')}</span>
      </button>)}
    </div>
  )
}

/**
 * Open each pending plan automatically and retain a manual opener without answering it.
 * @param props - Review identity, Session store, localized copy, and navigation.
 * @returns an opener for either logged or temporary plan text.
 */
export function PlanReviewOpen({ review, requestKey, openReview, t, useStore, actions }: PropsRuntime<'conversation.plan-review.actions'> & InjectFace<PlanReviewOpenInjected> & PropsLocale<'plan'> & PropsStore<ReturnType<typeof createPlanReviewStore>>) {
  const identity = review.callId === undefined ? `review:${requestKey}` : `call:${review.callId}`
  const opened = useStore(state => state.opened[identity] === true)
  useEffect(() => {
    if (opened) return
    openReview(review, requestKey)
    actions.markOpened(identity)
  }, [identity, opened, openReview, review, requestKey, actions])
  return <button type="button" className={css.reviewLink} title={t('preview.open')} aria-label={t('preview.open')}
    onClick={() => { openReview(review, requestKey) }}>{t('preview.full')}<IconChevronRightOutline14 size={14} /></button>
}
