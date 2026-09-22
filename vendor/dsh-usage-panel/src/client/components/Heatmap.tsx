// dsh-usage-panel · activity heatmap (UTC calendar month within the half-year window).
// GitHub-contribution layout for one month: weeks as columns, weekdays as rows,
// quartile levels over that month's non-zero days; ‹ › switches months in-window.
// Hover shows the day's tokens AND estimated cost (per-model priced).
import { useState } from 'react'
import type { DayRecord } from '../../shared/contract.ts'
import type { SessionCostPrices } from '../../shared/pricing.ts'
import { fmtTokens, heatLevel, monthLabel, quartileThresholds, weekdayIndexUTC, dateCN } from '../../shared/format.ts'
import { totalCostCents } from '../../shared/cost.ts'
import { formatCost } from '../../shared/pricing.ts'
import { keyOfDateUTC, listMonthKeys, monthKeyUTC } from '../../shared/usage.ts'
import type { I18n } from '../locales.ts'
import type { Tip } from '../hooks.ts'
import * as React from 'react'

interface HeatmapProps {
  days: DayRecord[]
  i18n: I18n
  onTip: (tip: Tip | null) => void
  /** Billing context for the per-day cost line (prices applied here). */
  prices?: SessionCostPrices
  peakValley?: boolean
  modelProviders?: Record<string, string>
}

export function Heatmap({ days, i18n, onTip, prices, peakValley = true, modelProviders = {} }: HeatmapProps): JSX.Element {
  const t = i18n.t
  const locale = i18n.locale
  const months = listMonthKeys(days)
  const [picked, setPicked] = useState<string | null>(null)
  const monthKey = picked && months.includes(picked) ? picked : (months[months.length - 1] ?? '')
  const monthIndex = months.indexOf(monthKey)
  const canPrev = monthIndex > 0
  const canNext = monthIndex >= 0 && monthIndex < months.length - 1

  const byDate: Record<string, DayRecord> = {}
  const nonzero: number[] = []
  for (const d of days) {
    if (monthKeyUTC(d.date) !== monthKey) continue
    byDate[d.date] = d
    if (d.total > 0) nonzero.push(d.total)
  }
  const q = quartileThresholds(nonzero)
  const levelOf = (total: number): number => heatLevel(total, q)

  const gridCells: JSX.Element[] = []
  const weekLabels: string[] = []
  let heatWeeks = 0
  if (monthKey) {
    const parts = monthKey.split('-')
    const year = Number(parts[0])
    const month = Number(parts[1])
    const firstKey = monthKey + '-01'
    const lead = weekdayIndexUTC(firstKey)
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    heatWeeks = Math.ceil((lead + daysInMonth) / 7)
    for (let w = 0; w < heatWeeks; w++) {
      const monday = new Date(Date.UTC(year, month - 1, 1 - lead + w * 7))
      let weekLabel = ''
      for (let r = 0; r < 7; r++) {
        const cur = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + r))
        const key = keyOfDateUTC(cur)
        const inMonth = cur.getUTCFullYear() === year && cur.getUTCMonth() === month - 1
        if (!inMonth) {
          gridCells.push(<div key={key + '-pad'} className="dsw-ust-heat-cell dsw-ust-heat-blank" />)
          continue
        }
        if (!weekLabel) weekLabel = String(cur.getUTCDate())
        const rec = byDate[key]
        if (!rec) {
          // Day falls outside the half-year window (partial first month).
          gridCells.push(<div key={key + '-blank'} className="dsw-ust-heat-cell dsw-ust-heat-blank" />)
          continue
        }
        const level = levelOf(rec.total)
        gridCells.push(
          <div
            key={key}
            className={'dsw-ust-heat-cell dsw-ust-h' + level}
            style={{ animationDelay: (w * 0.018).toFixed(4) + 's' }}
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const lines: Tip['lines'] = []
              if (prices !== undefined) {
                const rows = Object.keys(rec.modelCosts).map((model) => ({
                  model,
                  provider: modelProviders[model] ?? 'unknown',
                  cost: rec.modelCosts[model]!,
                }))
                const cents = totalCostCents(rows, prices, peakValley)
                lines.push({
                  label: t('heat.cost'),
                  value: cents === null ? t('heat.costNone') : formatCost(cents),
                  color: cents === null ? 'var(--dsw-alias-label-tertiary)' : 'var(--dsw-alias-state-success-primary)',
                })
              }
              onTip({
                left: rect.left + rect.width / 2,
                top: rect.top - 6,
                title: t('heat.day', { date: dateCN(key, locale), tokens: fmtTokens(rec.total, locale) }),
                lines,
              })
            }}
            onMouseLeave={() => onTip(null)}
          />,
        )
      }
      weekLabels.push(weekLabel)
    }
  }

  const weekdays = locale === 'zh-CN' ? ['一', '', '三', '', '五', '', ''] : ['M', '', 'W', '', 'F', '', '']
  const minWidth = heatWeeks > 0 ? heatWeeks * 12 + (heatWeeks - 1) * 3 : 0
  const sub = monthKey ? t('heat.sub', { month: monthLabel(monthKey, locale) }) : t('heat.sub.fallback')

  return (
    <div className="dsw-ust-card">
      <div className="dsw-ust-card-head">
        <div className="dsw-ust-card-title">
          <h3>{t('heat.title')}</h3>
          <span className="dsw-ust-card-sub">{sub}</span>
        </div>
        <div className="dsw-ust-heat-tools">
          <div className="dsw-ust-month-nav" role="group" aria-label={t('heat.monthNav')}>
            <button
              type="button"
              disabled={!canPrev}
              aria-label={t('heat.prev')}
              onClick={() => {
                if (canPrev) setPicked(months[monthIndex - 1]!)
              }}
            >
              ‹
            </button>
            <button
              type="button"
              disabled={!canNext}
              aria-label={t('heat.next')}
              onClick={() => {
                if (canNext) setPicked(months[monthIndex + 1]!)
              }}
            >
              ›
            </button>
          </div>
          <div className="dsw-ust-heat-legend">
            <span>{t('heat.less')}</span>
            {[0, 1, 2, 3, 4].map((l) => (
              <i key={l} className={'dsw-ust-heat-swatch dsw-ust-h' + l} />
            ))}
            <span>{t('heat.more')}</span>
          </div>
        </div>
      </div>
      <div className="dsw-ust-heat-wrap">
        <div className="dsw-ust-heat-weekdays">
          {weekdays.map((w, i) => (
            <span key={i}>{w}</span>
          ))}
        </div>
        <div className="dsw-ust-heat-main">
          <div
            className="dsw-ust-heat-months"
            style={{ gridTemplateColumns: 'repeat(' + Math.max(heatWeeks, 1) + ', minmax(12px, 1fr))', minWidth }}
          >
            {weekLabels.map((label, i) => (
              <span key={i} className="dsw-ust-heat-month">
                {label}
              </span>
            ))}
          </div>
          <div
            className="dsw-ust-heat"
            style={{ gridTemplateColumns: 'repeat(' + Math.max(heatWeeks, 1) + ', minmax(12px, 1fr))', minWidth }}
          >
            {gridCells}
          </div>
        </div>
      </div>
    </div>
  )
}
