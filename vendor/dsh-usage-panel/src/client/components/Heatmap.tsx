// Compact UTC month calendar with a bounded date filter.
import { useState } from 'react'
import type { DayRecord } from '../../shared/contract.ts'
import type { SessionCostPrices } from '../../shared/pricing.ts'
import { fmtTokens, heatLevel, monthLabel, quartileThresholds, weekdayIndexUTC, dateCN } from '../../shared/format.ts'
import { totalCostCents } from '../../shared/cost.ts'
import { formatCost } from '../../shared/pricing.ts'
import { keyOfDateUTC, listMonthKeys, monthKeyUTC } from '../../shared/usage.ts'
import type { I18n } from '../locales.ts'
import type { Tip } from '../hooks.ts'
import * as UiPrimitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as React from 'react'

// The vendored desktop pin exports these atoms; the published rc.6 type face
// used by this plugin's standalone typecheck predates them.
const { Button, Input, SettingsSelect } = UiPrimitives as typeof UiPrimitives & {
  Input: React.ComponentType<React.InputHTMLAttributes<HTMLInputElement>>
  SettingsSelect: React.ComponentType<{
    value: string
    options: readonly { id: string; label: string }[]
    onChange: (id: string) => void
    'aria-label': string
  }>
}

interface HeatmapProps {
  days: DayRecord[]
  i18n: I18n
  onTip: (tip: Tip | null) => void
  prices?: SessionCostPrices
  peakValley?: boolean
  modelProviders?: Record<string, string>
}

export function Heatmap({ days, i18n, onTip, prices, peakValley = true, modelProviders = {} }: HeatmapProps): JSX.Element {
  const t = i18n.t
  const locale = i18n.locale
  const months = listMonthKeys(days)
  const minDate = days[0]?.date ?? ''
  const maxDate = days[days.length - 1]?.date ?? ''
  const [pickedMonth, setPickedMonth] = useState<string | null>(null)
  const [pickedStart, setPickedStart] = useState<string | null>(null)
  const [pickedEnd, setPickedEnd] = useState<string | null>(null)
  const monthKey = pickedMonth && months.includes(pickedMonth) ? pickedMonth : (months[months.length - 1] ?? '')
  const start = pickedStart && pickedStart >= minDate && pickedStart <= maxDate ? pickedStart : minDate
  const end = pickedEnd && pickedEnd >= start && pickedEnd <= maxDate ? pickedEnd : maxDate
  const byDate = new Map(days.map((day) => [day.date, day]))
  const monthDays = days.filter((day) => monthKeyUTC(day.date) === monthKey)
  const selected = days.filter((day) => day.date >= start && day.date <= end && monthKeyUTC(day.date) === monthKey)
  const q = quartileThresholds(monthDays.filter((day) => day.total > 0).map((day) => day.total))
  const selectedTotal = selected.reduce((sum, day) => sum + day.total, 0)
  const activeDays = selected.filter((day) => day.total > 0).length

  const showTip = (element: HTMLElement, rec: DayRecord) => {
    const rect = element.getBoundingClientRect()
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
      title: t('heat.day', { date: dateCN(rec.date, locale), tokens: fmtTokens(rec.total, locale) }),
      lines,
    })
  }

  const cells: JSX.Element[] = []
  if (monthKey) {
    const [year, month] = monthKey.split('-').map(Number)
    const lead = weekdayIndexUTC(monthKey + '-01')
    const count = new Date(Date.UTC(year!, month!, 0)).getUTCDate()
    const slots = Math.ceil((lead + count) / 7) * 7
    for (let slot = 0; slot < slots; slot++) {
      const date = new Date(Date.UTC(year!, month! - 1, slot - lead + 1))
      const key = keyOfDateUTC(date)
      const rec = monthKeyUTC(key) === monthKey ? byDate.get(key) : undefined
      if (!rec) {
        cells.push(<span key={key + '-blank'} className="dsw-ust-calendar-blank" aria-hidden="true" />)
        continue
      }
      const outside = key < start || key > end
      const level = heatLevel(rec.total, q)
      cells.push(
        <button
          key={key}
          type="button"
          className={'dsw-ust-calendar-day dsw-ust-h' + level + (outside ? ' is-outside' : '')}
          aria-label={t('heat.day', { date: dateCN(key, locale), tokens: fmtTokens(rec.total, locale) })}
          aria-pressed={start === key && end === key}
          onClick={() => { setPickedStart(key); setPickedEnd(key) }}
          onMouseEnter={(event) => showTip(event.currentTarget, rec)}
          onMouseLeave={() => onTip(null)}
          onFocus={(event) => showTip(event.currentTarget, rec)}
          onBlur={() => onTip(null)}
        >{date.getUTCDate()}</button>,
      )
    }
  }
  const weekdays = locale === 'zh-CN' ? ['一', '二', '三', '四', '五', '六', '日'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  return (
    <div className="dsw-ust-card dsw-ust-heat-card">
      <div className="dsw-ust-card-head">
        <div className="dsw-ust-card-title">
          <h3>{t('heat.title')}</h3>
          <span className="dsw-ust-card-sub">{t('heat.sub.fallback')}</span>
        </div>
      </div>
      <div className="dsw-ust-calendar-controls">
        <label className="dsw-ust-calendar-field">
          <span>{t('heat.month')}</span>
          <SettingsSelect value={monthKey} options={months.map((key) => ({ id: key, label: monthLabel(key, locale) }))} onChange={setPickedMonth} aria-label={t('heat.month')} />
        </label>
        <label className="dsw-ust-calendar-field">
          <span>{t('heat.start')}</span>
          <Input type="date" value={start} min={minDate} max={maxDate} onChange={(event) => {
            const value = event.currentTarget.value
            if (value) { setPickedStart(value); if (value > end) setPickedEnd(value); setPickedMonth(monthKeyUTC(value)) }
          }} />
        </label>
        <label className="dsw-ust-calendar-field">
          <span>{t('heat.end')}</span>
          <Input type="date" value={end} min={minDate} max={maxDate} onChange={(event) => {
            const value = event.currentTarget.value
            if (value) { setPickedEnd(value); if (value < start) setPickedStart(value); setPickedMonth(monthKeyUTC(value)) }
          }} />
        </label>
        <Button variant="ghost" size="sm" onClick={() => { setPickedStart(null); setPickedEnd(null) }}>{t('heat.reset')}</Button>
      </div>
      <div className="dsw-ust-heat-layout">
        <div className="dsw-ust-calendar" role="group" aria-label={monthLabel(monthKey, locale)}>
          <div className="dsw-ust-calendar-weekdays">{weekdays.map((day, index) => <span key={index}>{day}</span>)}</div>
          <div className="dsw-ust-calendar-grid">{cells}</div>
        </div>
        <div className="dsw-ust-heat-summary" aria-live="polite">
          <span className="dsw-ust-heat-summary-label">{monthLabel(monthKey, locale)}</span>
          <strong>{fmtTokens(selectedTotal, locale)}</strong>
          <span className="dsw-ust-heat-summary-unit">Tokens</span>
          <span className="dsw-ust-heat-summary-detail">{t('heat.summary', { active: activeDays, total: selected.length })}</span>
          <div className="dsw-ust-heat-legend">
            <span>{t('heat.less')}</span>
            {[0, 1, 2, 3, 4].map((level) => <i key={level} className={'dsw-ust-heat-swatch dsw-ust-h' + level} />)}
            <span>{t('heat.more')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
