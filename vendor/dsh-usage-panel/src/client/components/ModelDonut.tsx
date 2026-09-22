// dsh-usage-panel · model donut + top-5 list (v0.1.0 port).
// Segment positioning uses strokeDashoffset only — the dsw-ust-donut-spin
// keyframes own rotation, so a CSS transform would be overridden (pitfall §6.2).
// Tooltips anchor at the pointer because a circle's bbox spans the whole donut.
// The list carries a per-model cache hit rate (new): same formula as the KPI
// card, computed per model row from its four disjoint buckets.
import type { ModelItem } from '../../shared/contract.ts'
import { fmtTokens, pctFull, pctOf } from '../../shared/format.ts'
import { hitRate } from '../../shared/usage.ts'
import type { I18n } from '../locales.ts'
import type { Tip } from '../hooks.ts'
import { modelRows } from '../hooks.ts'
import * as React from 'react'

interface ModelDonutProps {
  byModel: ModelItem[]
  total: number
  i18n: I18n
  onTip: (tip: Tip | null) => void
}

export function ModelDonut({ byModel, total, i18n, onTip }: ModelDonutProps): JSX.Element {
  const t = i18n.t
  const locale = i18n.locale
  const rows = modelRows(byModel, t('donut.other'))
  const R = 70
  const C = 2 * Math.PI * R
  const segs: JSX.Element[] = []
  let acc = 0
  for (const r of rows) {
    const frac = total ? r.total / total : 0
    if (frac <= 0) continue
    const len = frac * C
    const rate = hitRate(r.buckets)
    segs.push(
      <circle
        key={r.model}
        cx={90}
        cy={90}
        r={R}
        fill="none"
        className="dsw-ust-donut-seg"
        stroke={r.rest ? 'var(--dsw-alias-label-secondary)' : r.color!}
        strokeOpacity={r.rest ? 0.45 : 1}
        strokeWidth={24}
        strokeDasharray={len + ' ' + (C - len)}
        strokeDashoffset={-acc}
        onMouseEnter={(e) => {
          onTip({
            left: e.clientX,
            top: e.clientY - 6,
            title: r.model,
            lines: [
              { label: t('unit.tokens', { n: '' }).trim() || 'Tokens', value: fmtTokens(r.total, locale) },
              { label: t('donut.share'), value: pctOf(r.total, total) + '%', color: r.rest ? 'var(--dsw-alias-label-secondary)' : r.color },
              { label: t('donut.hitRate'), value: rate === null ? '—' : pctFull(rate) + '%' },
            ],
          })
        }}
        onMouseLeave={() => onTip(null)}
      />,
    )
    acc += len
  }

  const listRows = rows.map((r) => {
    const rate = hitRate(r.buckets)
    return (
      <div key={r.model} className="dsw-ust-mrow">
        <i className="dsw-ust-dot" style={{ background: r.rest ? 'var(--dsw-alias-label-secondary)' : r.color!, opacity: r.rest ? 0.45 : 1 }} />
        <span className="dsw-ust-mname" title={r.model}>
          {r.model}
        </span>
        <span className="dsw-ust-mtokens">{fmtTokens(r.total, locale)}</span>
        <span className="dsw-ust-mpct">{pctOf(r.total, total) + '%'}</span>
        <span className="dsw-ust-mrate">{rate === null ? '—' : pctFull(rate) + '%'}</span>
      </div>
    )
  })

  return (
    <div className="dsw-ust-card">
      <h3>{t('donut.title')}</h3>
      <div className="dsw-ust-models">
        <div className="dsw-ust-donut">
          <svg width={180} height={180} viewBox="0 0 180 180">
            <circle cx={90} cy={90} r={R} fill="none" stroke="var(--dsw-alias-bg-layer-2)" strokeWidth={24} />
            {segs}
            <text x={90} y={86} textAnchor="middle" className="dsw-ust-donut-total">
              {fmtTokens(total, locale)}
            </text>
            <text x={90} y={106} textAnchor="middle" className="dsw-ust-donut-cap">
              {t('donut.cap')}
            </text>
          </svg>
        </div>
        <div className="dsw-ust-mlist">
          <div className="dsw-ust-mhead">
            <span style={{ width: 18, flexShrink: 0 }} />
            <span className="h-model">{t('donut.model')}</span>
            <span>{t('donut.tokens')}</span>
            <span className="h-share">{t('donut.share')}</span>
            <span className="h-rate">{t('donut.hitRate')}</span>
          </div>
          {listRows}
        </div>
      </div>
    </div>
  )
}
