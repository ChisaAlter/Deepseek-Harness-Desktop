import { useState } from 'react'
import { DisclosureRow, IconDataOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnTokenUsage } from '../contract/chat-nodes.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatCacheHitPercent, formatExactTokens, formatTokens } from './token-format.ts'
import css from './TurnUsageDisclosure.module.css'

export interface TurnUsageDisclosureProps {
  usage: TurnTokenUsage
  t: ChatViewSlotProps['t']
}

function formatCompactCount(value: number, t: ChatViewSlotProps['t']): string {
  return t('message.turnUsage.count', { count: formatTokens(value, t) })
}

function formatExactCount(value: number, t: ChatViewSlotProps['t']): string {
  return t('message.turnUsage.count', { count: formatExactTokens(value, t) })
}

/** Compact per-Turn usage summary with an opt-in bucket breakdown. */
export function TurnUsageDisclosure({ usage, t }: TurnUsageDisclosureProps) {
  const [open, setOpen] = useState(false)
  const cacheHit = usage.cacheReadTokens === undefined
    ? null
    : formatCacheHitPercent(usage.cacheReadTokens, usage.totalTokens - usage.outputTokens, 1)
  const total = formatCompactCount(usage.totalTokens, t)
  const summary = cacheHit === null
    ? total
    : t('message.turnUsage.summaryWithCache', { total, percent: cacheHit })
  const routes = usage.routes?.map(route => `${route.provider}/${route.model}`).join(', ') ?? ''

  return (
    <DisclosureRow
      icon={<IconDataOutline16 />}
      title={t('message.turnUsage.title')}
      open={open}
      expandable
      onToggle={() => { setOpen(value => !value) }}
      expandOnRowClick
      keepContentWhenOpen
      collapsedContent={(
        <>
          <span className={css.separator} aria-hidden />
          <span className={css.summary}>{summary}</span>
        </>
      )}
      className={css.root}
      chevronClassName={css.chevron}
    >
      <dl className={css.details} data-turn-usage-details>
        {routes !== '' && (
          <>
            <dt>{t('message.turnUsage.model')}</dt>
            <dd className={css.route}>{routes}</dd>
          </>
        )}
        <dt>{t('message.turnUsage.input')}</dt>
        <dd>{formatExactCount(usage.uncachedInputTokens, t)}</dd>
        {usage.cacheReadTokens !== undefined && (
          <>
            <dt>{t('message.turnUsage.cacheRead')}</dt>
            <dd>{formatExactCount(usage.cacheReadTokens, t)}</dd>
          </>
        )}
        {usage.cacheWriteTokens !== undefined && (
          <>
            <dt>{t('message.turnUsage.cacheWrite')}</dt>
            <dd>{formatExactCount(usage.cacheWriteTokens, t)}</dd>
          </>
        )}
        <dt>{t('message.turnUsage.output')}</dt>
        <dd>
          {formatExactCount(usage.outputTokens, t)}
          {usage.reasoningTokens !== undefined && (
            <span className={css.reasoning}>
              {t('message.turnUsage.reasoning', { tokens: formatExactCount(usage.reasoningTokens, t) })}
            </span>
          )}
        </dd>
        <dt className={css.totalLabel}>{t('message.turnUsage.total')}</dt>
        <dd className={css.totalValue}>{formatExactCount(usage.totalTokens, t)}</dd>
      </dl>
    </DisclosureRow>
  )
}
