// dsh-usage-panel · stacked daily bar chart (v0.1.0 port, UTC dates).
// Default 7 days; per-model colors; hover tooltip with per-model breakdown;
// 7/14/30 range switching; count-up-free (CSS grow animation preserved).
import { useState } from 'react'
import type { DayRecord, ModelItem } from '../../shared/contract.ts'
import { fmtCompact, fmtTokens, niceCeil, dateLabel, dateCN } from '../../shared/format.ts'
import type { I18n } from '../locales.ts'
import type { Tip } from '../hooks.ts'
import { modelRows } from '../hooks.ts'
import * as React from 'react'

interface BarChartProps {
  days: DayRecord[]
  byModel: ModelItem[]
  i18n: I18n
  onTip: (tip: Tip | null) => void
}

export function BarChart({ days, byModel, i18n, onTip }: BarChartProps): JSX.Element {
  const t = i18n.t
  const locale = i18n.locale
  const [range, setRange] = useState(7)
  const rows = modelRows(byModel, t('donut.other'))
  const topNames: Record<string, boolean> = {}
  for (let i = 0; i < byModel.length && i < 5; i++) topNames[byModel[i]!.model] = true
  const othersOf = (d: DayRecord): number => {
    let s = 0
    for (const name of Object.keys(d.models)) if (!topNames[name]) s += d.models[name]!.total
    return s
  }
  const rangeDays = days.slice(-range)
  const yMax = niceCeil(Math.max.apply(null, rangeDays.map((d) => d.total).concat(1)))
  const W = 720
  const H = 230
  const PL = 52
  const PR = 12
  const PT = 10
  const PB = 26
  const plotW = W - PL - PR
  const plotH = H - PT - PB
  const n = rangeDays.length
  const band = plotW / n
  const barW = Math.min(44, band * 0.6)

  const yLines: JSX.Element[] = []
  for (let i = 0; i <= 4; i++) {
    const v = (yMax / 4) * i
    const y = PT + plotH - (v / yMax) * plotH
    yLines.push(
      <g key={'y' + i}>
        <line x1={PL} x2={W - PR} y1={y} y2={y} stroke="var(--dsw-alias-border-l1)" strokeWidth={1} strokeDasharray={i === 0 ? 'none' : '3 3'} />
        <text x={PL - 6} y={y + 3} textAnchor="end" className="dsw-ust-axis">
          {fmtCompact(v, locale)}
        </text>
      </g>,
    )
  }

  const bars = rangeDays.map((d, i) => {
    const x = PL + band * i + (band - barW) / 2
    const segs: JSX.Element[] = []
    let acc = 0
    for (const r of rows) {
      const v = r.rest ? othersOf(d) : d.models[r.model] ? d.models[r.model]!.total : 0
      if (v > 0) {
        const h = (v / yMax) * plotH
        segs.push(
          <rect
            key={r.model}
            x={x}
            y={PT + plotH - acc - h}
            width={barW}
            height={h}
            fill={r.rest ? 'var(--dsw-alias-label-secondary)' : r.color!}
            opacity={r.rest ? 0.45 : 1}
            rx={2}
            className="dsw-ust-bar-seg"
            style={{ animationDelay: i * 30 + 'ms' }}
          />,
        )
        acc += h
      }
    }
    if (acc === 0) {
      segs.push(
        <rect
          key="zero"
          x={x}
          y={PT + plotH - 2}
          width={barW}
          height={2}
          fill="var(--dsw-alias-border-l2)"
          className="dsw-ust-bar-seg"
          style={{ animationDelay: i * 30 + 'ms' }}
        />,
      )
    }
    return (
      <g
        key={d.date}
        className="dsw-ust-bar-day"
        onMouseEnter={(e) => {
          const lines: Tip['lines'] = []
          let acc = 0
          for (const r of rows) {
            const v = r.rest ? othersOf(d) : d.models[r.model] ? d.models[r.model]!.total : 0
            if (v > 0) {
              lines.push({ label: r.model, value: fmtTokens(v, locale) + ' Tokens', color: r.rest ? 'var(--dsw-alias-label-secondary)' : r.color })
              acc += v
            }
          }
          const rect = e.currentTarget.getBoundingClientRect()
          onTip({
            left: rect.left + rect.width / 2,
            top: rect.top - 6,
            title: t('bar.day', { date: dateCN(d.date, locale), tokens: fmtTokens(d.total || acc, locale) }),
            lines,
          })
        }}
        onMouseLeave={() => onTip(null)}
      >
        {segs}
      </g>
    )
  })

  const xStep = n <= 7 ? 1 : Math.ceil(n / 7)
  const xLabels = rangeDays.map((d, i) =>
    i % xStep === 0 || i === n - 1 ? (
      <text key={d.date} x={PL + band * i + band / 2} y={H - 8} textAnchor="middle" className="dsw-ust-axis">
        {dateLabel(d.date)}
      </text>
    ) : null,
  )

  return (
    <div className="dsw-ust-card">
      <div className="dsw-ust-card-head">
        <div className="dsw-ust-card-title">
          <h3>{t('bar.title')}</h3>
          <span className="dsw-ust-card-sub">{t('bar.sub')}</span>
        </div>
        <div className="dsw-ust-range">
          {[7, 14, 30].map((r) => (
            <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
              {r + 'd'}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox="0 0 720 230" className="dsw-ust-chart" preserveAspectRatio="xMidYMid meet">
        {yLines}
        {bars}
        {xLabels}
      </svg>
      <div className="dsw-ust-legend">
        {rows.map((r) => (
          <span key={r.model} className="dsw-ust-legend-item">
            <i style={{ background: r.rest ? 'var(--dsw-alias-label-secondary)' : r.color!, opacity: r.rest ? 0.45 : 1 }} />
            {r.model}
          </span>
        ))}
      </div>
    </div>
  )
}
