// dsh-usage-panel · shared hover-tooltip renderer (v0.1.0, no native delay).
import type { Tip } from '../hooks.ts'
import * as React from 'react'

export function Tooltip({ tip }: { tip: Tip | null }): JSX.Element | null {
  if (!tip) return null
  return (
    <div className="dsw-ust-tooltip show" style={{ left: tip.left, top: tip.top }}>
      <div className="dsw-ust-tooltip-title">{tip.title}</div>
      {tip.lines.map((l, idx) => (
        <div key={idx} className="dsw-ust-tooltip-row">
          <i style={{ background: l.color || 'var(--dsw-alias-label-secondary)' }} />
          <span className="dsw-ust-tooltip-label">{l.label}</span>
          <span className="dsw-ust-tooltip-value">{l.value}</span>
        </div>
      ))}
    </div>
  )
}
