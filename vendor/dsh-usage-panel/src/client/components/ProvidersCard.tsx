// dsh-usage-panel · provider dimension card (P1-⑦).
// Shown when more than one provider route was seen in the logs; bars are
// relative to the top provider. Names come from llm.listProviders when
// available, else the route id.
import type { ProviderItem } from '../../shared/contract.ts'
import { fmtTokens } from '../../shared/format.ts'
import type { I18n } from '../locales.ts'
import * as React from 'react'

interface ProvidersCardProps {
  providers: ProviderItem[]
  i18n: I18n
}

export function ProvidersCard({ providers, i18n }: ProvidersCardProps): JSX.Element | null {
  const locale = i18n.locale
  if (!providers.length) return null
  // Only meaningful with more than one provider route.
  if (providers.length === 1 && (providers[0]!.id === 'unknown' || providers[0]!.totals.total <= 0)) return null
  if (providers.length === 1 && providers[0]!.id === 'unknown') return null
  const top = Math.max(1, providers[0]!.totals.total)
  return (
    <div className="dsw-ust-card">
      <h3>{i18n.t('providers.title')}</h3>
      {providers.map((p) => (
        <div key={p.id} className="dsw-ust-prow">
          <span className="dsw-ust-pname" title={p.id}>
            {p.name}
          </span>
          <div className="dsw-ust-pbar">
            <i style={{ width: Math.max(2, Math.round((p.totals.total / top) * 100)) + '%' }} />
          </div>
          <span className="dsw-ust-ptokens">{fmtTokens(p.totals.total, locale)}</span>
        </div>
      ))}
    </div>
  )
}
