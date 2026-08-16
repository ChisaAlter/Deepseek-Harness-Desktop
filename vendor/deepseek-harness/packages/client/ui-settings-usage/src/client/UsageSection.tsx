/**
 * Usage settings section: trailing-window cards, heatmap, stacked daily
 * bars, and a model donut. Data arrives from `usage.summary`.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient, UsageRangeDays, UsageSummaryView } from '@deepseek-ai/dsh-api-remotes/client'
import { IconDataOutline16, IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { formatCompactNumber, heatLevel, padHeatmap } from './format.ts'
import type { UsageKey } from './locales.ts'
import styles from './UsageSection.module.css'

/** Injected dependencies of {@link UsageSection}. */
export interface UsageSectionInjected {
  /** Wire face for usage.summary. */
  api: Pick<IApiClient, 'usage'>
  /** Section copy. */
  t: Translate<UsageKey>
  /** Active product locale, used for compact numbers and date labels. */
  locale: 'zh' | 'en'
}

/** Props delivered by the slot outlet. */
export type UsageSectionProps = Partial<UsageSectionInjected>

const CHART_VARS = [
  'var(--dsw-alias-chart-1)',
  'var(--dsw-alias-chart-2)',
  'var(--dsw-alias-chart-3)',
  'var(--dsw-alias-chart-4)',
  'var(--dsw-alias-chart-5)',
] as const

function colorOf(index: number): string {
  return CHART_VARS[index % CHART_VARS.length]!
}

function dateLabel(date: string, locale: 'zh' | 'en'): string {
  const [, month, day] = date.split('-')
  const m = Number(month)
  const d = Number(day)
  if (locale === 'zh') return m + '月' + d + '日'
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return names[m - 1] + ' ' + d
}

/**
 * Render the Usage section, guarded until the shell supplies the inject face.
 * @param props - injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function UsageSection(props: UsageSectionProps): ReactNode {
  const { api, t, locale } = props
  if (api === undefined || t === undefined || locale === undefined) return null
  return <Loaded api={api} t={t} locale={locale} />
}

function Loaded({ api, t, locale }: UsageSectionInjected): ReactNode {
  const [rangeDays, setRangeDays] = useState<UsageRangeDays>(30)
  const [summary, setSummary] = useState<UsageSummaryView | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  useEffect(() => {
    let stale = false
    setSummary(undefined)
    setFailure(undefined)
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    void (async () => {
      try {
        const response = await api.usage.summary({ rangeDays, timeZone })
        if (stale) return
        if (!response.result.ok) {
          setFailure(t('loadFailed'))
          return
        }
        setSummary(response.result.value)
      } catch {
        if (stale) return
        setFailure(t('loadFailed'))
      }
    })()
    return () => { stale = true }
  }, [api, rangeDays, t])

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('title')}</h2>
        <span className={styles.tab}>{t('tabApp')}</span>
      </header>
      <div className={styles.rangeRow}>
        <span className={styles.rangeLabel}>{t('range')}</span>
        <div className={styles.segment} role="group" aria-label={t('range')}>
          <button
            type="button"
            className={rangeDays === 7 ? styles.segmentActive : styles.segmentIdle}
            aria-pressed={rangeDays === 7}
            onClick={() => setRangeDays(7)}
          >
            {t('last7')}
          </button>
          <button
            type="button"
            className={rangeDays === 30 ? styles.segmentActive : styles.segmentIdle}
            aria-pressed={rangeDays === 30}
            onClick={() => setRangeDays(30)}
          >
            {t('last30')}
          </button>
        </div>
      </div>
      {failure !== undefined ? <p className={styles.error} role="alert">{failure}</p> : null}
      {summary === undefined && failure === undefined ? <p className={styles.notice}>{t('loading')}</p> : null}
      {summary !== undefined ? <Dashboard summary={summary} t={t} locale={locale} /> : null}
    </section>
  )
}

function Dashboard({
  summary, t, locale,
}: { summary: UsageSummaryView; t: Translate<UsageKey>; locale: 'zh' | 'en' }): ReactNode {
  const maxHeat = Math.max(0, ...summary.heatmap.map(cell => cell.tokens))
  const padded = padHeatmap(summary.heatmap)
  const n = (value: number): string => formatCompactNumber(value, locale)
  return (
    <>
      <div className={styles.cards}>
        <StatCard icon={<IconDataOutline16 size={16} />} label={t('tokens')} value={n(summary.totalTokens)} />
        <StatCard icon={<IconNewChatOutline16 size={16} />} label={t('sessions')} value={n(summary.sessionCount)} />
        <StatCard icon={<IconNewChatOutline16 size={16} />} label={t('messages')} value={n(summary.messageCount)} />
        <StatCard icon={<IconDataOutline16 size={16} />} label={t('activeDays')} value={n(summary.activeDays)} />
        <StatCard icon={<IconDataOutline16 size={16} />} label={t('streak')} value={n(summary.currentStreak)} />
        <StatCard
          icon={<IconDataOutline16 size={16} />}
          label={t('topModel')}
          value={summary.topModel === null ? t('none') : summary.topModel.name}
          {...summary.topModel === null ? {} : { hint: t('share', { share: summary.topModel.share }) }}
        />
      </div>
      <article className={styles.panel}>
        <div className={styles.panelHead}>
          <h3 className={styles.panelTitle}>{t('heatmap')}</h3>
          <div className={styles.legend}>
            <span>{t('less')}</span>
            <span className={styles.swatch + ' ' + styles.heat0} />
            <span className={styles.swatch + ' ' + styles.heat1} />
            <span className={styles.swatch + ' ' + styles.heat2} />
            <span className={styles.swatch + ' ' + styles.heat3} />
            <span className={styles.swatch + ' ' + styles.heat4} />
            <span>{t('more')}</span>
          </div>
        </div>
        <div className={styles.heatGrid} role="img" aria-label={t('heatmap')}>
          {padded.map((cell, index) => {
            const level = cell.date === null ? 0 : heatLevel(cell.tokens, maxHeat)
            const heatClass = [styles.heat0, styles.heat1, styles.heat2, styles.heat3, styles.heat4][level]
            return (
              <span
                key={cell.date ?? 'pad-' + index}
                className={styles.heatCell + ' ' + heatClass}
                title={cell.date === null ? undefined : cell.date + ' · ' + cell.tokens}
              />
            )
          })}
        </div>
      </article>
      <article className={styles.panel}>
        <h3 className={styles.panelTitle}>{t('daily')}</h3>
        <DailyBars summary={summary} locale={locale} />
      </article>
      <article className={styles.panel}>
        <h3 className={styles.panelTitle}>{t('models')}</h3>
        <ModelBreakdown summary={summary} t={t} locale={locale} />
      </article>
    </>
  )
}

function StatCard({
  icon, label, value, hint,
}: { icon: ReactNode; label: string; value: string; hint?: string }): ReactNode {
  return (
    <article className={styles.card}>
      <div className={styles.cardLabel}>
        <span className={styles.cardIcon} aria-hidden>{icon}</span>
        {label}
      </div>
      <div className={styles.cardValue}>{value}</div>
      {hint === undefined ? null : <div className={styles.cardHint}>{hint}</div>}
    </article>
  )
}

function DailyBars({ summary, locale }: { summary: UsageSummaryView; locale: 'zh' | 'en' }): ReactNode {
  const modelIndex = useMemo(() => {
    const map = new Map<string, number>()
    summary.models.forEach((row, index) => map.set(row.model, index))
    return map
  }, [summary.models])
  const max = Math.max(1, ...summary.daily.map(day => day.byModel.reduce((sum, row) => sum + row.tokens, 0)))
  const tickEvery = summary.daily.length <= 7 ? 1 : Math.ceil(summary.daily.length / 7)
  return (
    <div>
      <div className={styles.bars} role="img" aria-label={summary.daily.length + ' days'}>
        {summary.daily.map(day => {
          const total = day.byModel.reduce((sum, row) => sum + row.tokens, 0)
          return (
            <div key={day.date} className={styles.barCol} title={day.date + ' · ' + total}>
              <div className={styles.barStack} style={{ height: ((total / max) * 100) + '%' }}>
                {day.byModel.map(row => (
                  <span
                    key={row.model}
                    className={styles.barSeg}
                    style={{
                      flexGrow: row.tokens,
                      background: colorOf(modelIndex.get(row.model) ?? 0),
                    }}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <div className={styles.barTicks}>
        {summary.daily.map((day, index) => (
          <span key={day.date} className={styles.barTick}>
            {index % tickEvery === 0 ? dateLabel(day.date, locale) : ''}
          </span>
        ))}
      </div>
      {summary.models.length === 0 ? null : (
        <div className={styles.barLegend}>
          {summary.models.map((row, index) => (
            <span key={row.model} className={styles.legendItem}>
              <span className={styles.dot} style={{ background: colorOf(index) }} />
              {row.model}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ModelBreakdown({
  summary, t, locale,
}: { summary: UsageSummaryView; t: Translate<UsageKey>; locale: 'zh' | 'en' }): ReactNode {
  const radius = 42
  const circ = 2 * Math.PI * radius
  let offset = 0
  const slices = summary.models.map((row, index) => {
    const length = summary.totalTokens === 0 ? 0 : (row.tokens / summary.totalTokens) * circ
    const slice = { row, index, length, offset }
    offset += length
    return slice
  })
  return (
    <div className={styles.modelRow}>
      <svg className={styles.donut} viewBox="0 0 120 120" role="img" aria-label={t('models')}>
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--dsw-alias-chart-empty)"
          strokeWidth="16"
        />
        {slices.map(slice => (
          <circle
            key={slice.row.model}
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke={colorOf(slice.index)}
            strokeWidth="16"
            strokeDasharray={slice.length + ' ' + (circ - slice.length)}
            strokeDashoffset={-slice.offset}
            transform="rotate(-90 60 60)"
          />
        ))}
        <text x="60" y="56" textAnchor="middle" className={styles.donutValue}>
          {formatCompactNumber(summary.totalTokens, locale)}
        </text>
        <text x="60" y="74" textAnchor="middle" className={styles.donutUnit}>
          {t('tokensUnit')}
        </text>
      </svg>
      <ul className={styles.modelList}>
        {summary.models.map((row, index) => (
          <li key={row.model} className={styles.modelItem}>
            <span className={styles.dot} style={{ background: colorOf(index) }} />
            <span className={styles.modelName}>{row.model}</span>
            <span className={styles.modelTokens}>{formatCompactNumber(row.tokens, locale)} {t('tokensUnit')}</span>
            <span className={styles.modelShare}>{row.share}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
