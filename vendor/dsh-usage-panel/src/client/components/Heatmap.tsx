// Contribution graph over the rolling HEAT_DAYS window — the GitHub
// contribution-calendar idiom: Monday-first week columns, month labels above
// the grid, weekday labels on Mon/Wed/Fri rows only. Levels come from
// whole-window quartiles, so a token total colors identically in every month
// (the retired month grid rescaled per month, making colors incomparable).
// Selection: click a day for a single-day range, Shift+click to extend it;
// the range only rescopes this card's summary line.
import { useMemo, useRef, useState } from 'react'
import type { DayRecord } from '../../shared/contract.ts'
import type { SessionCostPrices } from '../../shared/pricing.ts'
import { fmtTokens, heatLevel, monthShort, quartileThresholds, dateCN } from '../../shared/format.ts'
import { totalCostCents } from '../../shared/cost.ts'
import { formatCost } from '../../shared/pricing.ts'
import { graphMonthLabels, graphWeeks, keyOfDateUTC, parseDayKeyUTC } from '../../shared/usage.ts'
import type { I18n } from '../locales.ts'
import type { Tip } from '../hooks.ts'
import * as UiPrimitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as React from 'react'

// The vendored desktop pin exports these atoms; the published rc.6 type face
// used by this plugin's standalone typecheck predates them.
const { Button } = UiPrimitives as typeof UiPrimitives

interface HeatmapProps {
  days: DayRecord[]
  i18n: I18n
  onTip: (tip: Tip | null) => void
  prices?: SessionCostPrices
  peakValley?: boolean
  modelProviders?: Record<string, string>
}

/** Weekday rows that carry a label (Mon/Wed/Fri), GitHub convention. */
const LABELED_ROWS = new Set([0, 2, 4])

export function Heatmap({ days, i18n, onTip, prices, peakValley = true, modelProviders = {} }: HeatmapProps): JSX.Element {
  const t = i18n.t
  const locale = i18n.locale
  const minDate = days[0]?.date ?? ''
  const maxDate = days[days.length - 1]?.date ?? ''
  const weeks = useMemo(() => graphWeeks(days), [days])
  const monthLabels = useMemo(() => graphMonthLabels(weeks), [weeks])
  const q = useMemo(
    () => quartileThresholds(days.filter((day) => day.total > 0).map((day) => day.total)),
    [days],
  )
  const [pickedStart, setPickedStart] = useState<string | null>(null)
  const [pickedEnd, setPickedEnd] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const hasRange = pickedStart !== null && pickedEnd !== null && pickedEnd >= minDate
  const start = hasRange ? pickedStart : minDate
  const end = hasRange ? pickedEnd : maxDate
  const selected = days.filter((day) => day.date >= start && day.date <= end)
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

  const pick = (key: string, extend: boolean) => {
    if (extend && pickedStart !== null) {
      if (key >= pickedStart) {
        setPickedEnd(key)
      } else {
        setPickedEnd(pickedEnd ?? pickedStart)
        setPickedStart(key)
      }
    } else {
      setPickedStart(key)
      setPickedEnd(key)
    }
  }

  // Roving tabindex: one cell joins the tab order, arrows move the focus.
  const focusable = focusKey !== null && focusKey >= minDate && focusKey <= maxDate ? focusKey : maxDate
  const moveFocus = (fromKey: string, delta: number) => {
    const d = parseDayKeyUTC(fromKey)
    d.setUTCDate(d.getUTCDate() + delta)
    const key = keyOfDateUTC(d)
    if (key < minDate || key > maxDate) return
    setFocusKey(key)
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${key}"]`)?.focus()
  }
  const onGridKeyDown = (event: React.KeyboardEvent) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-day]')
    if (!cell) return
    const key = cell.dataset.day!
    const delta =
      event.key === 'ArrowLeft' ? -7
        : event.key === 'ArrowRight' ? 7
          : event.key === 'ArrowUp' ? -1
            : event.key === 'ArrowDown' ? 1 : 0
    if (delta !== 0) {
      event.preventDefault()
      moveFocus(key, delta)
    } else if (event.key === 'Home') {
      event.preventDefault()
      moveFocus(minDate, 0)
    } else if (event.key === 'End') {
      event.preventDefault()
      moveFocus(maxDate, 0)
    }
  }

  const cells: JSX.Element[] = []
  for (const week of weeks) {
    for (let r = 0; r < 7; r++) {
      const rec = week[r]
      if (rec === null || rec === undefined) {
        cells.push(<i key={'pad-' + cells.length} className="dsw-ust-graph-pad" aria-hidden="true" />)
        continue
      }
      const key = rec.date
      const outside = key < start || key > end
      cells.push(
        <button
          key={key}
          type="button"
          data-day={key}
          className={'dsw-ust-graph-day dsw-ust-h' + heatLevel(rec.total, q) + (outside ? ' is-outside' : '')}
          tabIndex={key === focusable ? 0 : -1}
          aria-label={t('heat.day', { date: dateCN(key, locale), tokens: fmtTokens(rec.total, locale) })}
          aria-pressed={hasRange && start === key && end === key}
          onClick={(event) => pick(key, event.shiftKey)}
          onMouseEnter={(event) => showTip(event.currentTarget, rec)}
          onMouseLeave={() => onTip(null)}
          onFocus={(event) => { setFocusKey(key); showTip(event.currentTarget, rec) }}
          onBlur={() => onTip(null)}
        />,
      )
    }
  }

  const weekdayText = locale === 'zh-CN'
    ? ['一', '', '三', '', '五', '', '']
    : ['Mon', '', 'Wed', '', 'Fri', '', '']
  const rangeText = start === end ? dateCN(start, locale) : dateCN(start, locale) + ' – ' + dateCN(end, locale)
  const summaryText = hasRange
    ? t('heat.range', { range: rangeText, tokens: fmtTokens(selectedTotal, locale), active: activeDays, total: selected.length })
    : t('heat.window', { tokens: fmtTokens(selectedTotal, locale), active: activeDays })
  return (
    <div className="dsw-ust-card dsw-ust-heat-card">
      <div className="dsw-ust-card-head">
        <div className="dsw-ust-card-title">
          <h3>{t('heat.title')}</h3>
          <span className="dsw-ust-card-sub">{t('heat.sub.fallback')}</span>
        </div>
      </div>
      <div className="dsw-ust-graph-wrap">
        <div className="dsw-ust-graph" role="group" aria-label={t('heat.title')} onKeyDown={onGridKeyDown}>
          <div className="dsw-ust-graph-months" aria-hidden="true"
            style={{ gridTemplateColumns: 'repeat(' + weeks.length + ', 12px)' }}>
            {monthLabels.map((label) => (
              <span key={label.week} style={{ gridRow: 1, gridColumn: label.week + 1 }}>{monthShort(label.monthKey, locale)}</span>
            ))}
          </div>
          <div className="dsw-ust-graph-weekdays" aria-hidden="true">
            {weekdayText.map((text, row) => (
              <span key={row} style={{ gridRow: row + 1 }}>{text}</span>
            ))}
          </div>
          <div className="dsw-ust-graph-cells" ref={gridRef}>{cells}</div>
        </div>
      </div>
      <div className="dsw-ust-graph-footer">
        <span className="dsw-ust-graph-summary" aria-live="polite">{summaryText}</span>
        {hasRange
          ? <Button variant="ghost" size="sm" onClick={() => { setPickedStart(null); setPickedEnd(null) }}>{t('heat.clear')}</Button>
          : <span className="dsw-ust-graph-hint">{t('heat.hint')}</span>}
        <div className="dsw-ust-heat-legend">
          <span>{t('heat.less')}</span>
          {[0, 1, 2, 3, 4].map((level) => <i key={level} className={'dsw-ust-heat-swatch dsw-ust-h' + level} />)}
          <span>{t('heat.more')}</span>
        </div>
      </div>
    </div>
  )
}
