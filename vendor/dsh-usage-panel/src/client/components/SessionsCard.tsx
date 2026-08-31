// dsh-usage-panel · session drill-down card (P0-④).
// Top sessions by all-time usage, with titles folded from session/title
// (zero extra log reads in scan mode; per-session readTitle in projection
// mode, only for the ranked top-10). Headers, a "sort by tokens/cost"
// selector, and a paged "显示更多…" button. Cost column: estimate per session
// (unpriced models show an em dash — never a guessed figure).
import { useState } from 'react'
import type { SessionSummary } from '../../shared/contract.ts'
import { fmtTokens } from '../../shared/format.ts'
import { costCentsFor, sumCostCents } from '../../shared/cost.ts'
import { formatCost } from '../../shared/pricing.ts'
import { useBillingSettings } from '../hooks.ts'
import type { RpcLike } from '../ctx.ts'
import type { I18n } from '../locales.ts'
import { MoreRankModal } from './MoreRankModal.tsx'
import * as React from 'react'

interface SessionsCardProps {
  sessions: SessionSummary[]
  i18n: I18n
  rpc: RpcLike
}

export function SessionsCard({ sessions, i18n, rpc }: SessionsCardProps): JSX.Element {
  const t = i18n.t
  const locale = i18n.locale
  const billing = useBillingSettings(rpc)
  const [sort, setSort] = useState<'tokens' | 'cost'>('tokens')
  const [moreOpen, setMoreOpen] = useState(false)

  const rows = sessions

  return (
    <div className="dsw-ust-card">
      <div className="dsw-ust-card-head">
        <div className="dsw-ust-card-title">
          <h3>{t('sessions.title')}</h3>
          <span className="dsw-ust-card-sub">{t('sessions.sub')}</span>
        </div>
        <label className="dsw-ust-sort">
          <span>{t('sort.by')}</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as 'tokens' | 'cost')}>
            <option value="tokens">{t('sort.tokens')}</option>
            <option value="cost">{t('sort.cost')}</option>
          </select>
        </label>
      </div>
      <div className="dsw-ust-table-head">
        <span className="dsw-ust-th-rank">#</span>
        <span className="dsw-ust-th-session">{t('sessions.hSession')}</span>
        <span className="dsw-ust-th-type">{t('sessions.hType')}</span>
        <span className="dsw-ust-th-date">{t('sessions.hActive')}</span>
        <span className="dsw-ust-th-cost">{t('sessions.hCost')}</span>
        <span className="dsw-ust-th-tokens">{t('sessions.hTokens')}</span>
      </div>
      {rows.map((s, i) => {
        const d = new Date(s.lastActive)
        const date =
          d.getUTCFullYear() +
          '-' +
          String(d.getUTCMonth() + 1).padStart(2, '0') +
          '-' +
          String(d.getUTCDate()).padStart(2, '0')
        const cents = billing === null
          ? null
          : sumCostCents(s.models.map((m) => costCentsFor(m.cost, m.provider, m.model, billing.prices, billing.peakValleyEnabled)))
        return (
          <div key={s.id} className="dsw-ust-srow">
            <span className="dsw-ust-srank">{i + 1}</span>
            <span className="dsw-ust-sname" title={s.id}>
              {s.title || t('sessions.untitled')}
            </span>
            <span className={'dsw-ust-stag' + (s.depth > 0 ? ' sub' : '')}>{s.depth > 0 ? t('sessions.subagent') : t('sessions.main')}</span>
            <span className="dsw-ust-smeta">{date}</span>
            <span className={'dsw-ust-scost' + (cents === null ? ' is-unpriced' : '')} title={cents === null ? t('sessions.cost.none') : t('strip.estimate')}>
              {cents === null ? '—' : formatCost(cents)}
            </span>
            <span className="dsw-ust-stokens">{fmtTokens(s.totals.total, locale)}</span>
          </div>
        )
      })}
      {rows.length > 0 && (
        <button type="button" className="dsw-ust-more" onClick={() => setMoreOpen(true)}>
          {t('sessions.more')}
        </button>
      )}
      <MoreRankModal kind="sessions" i18n={i18n} rpc={rpc} open={moreOpen} onClose={() => setMoreOpen(false)} />
    </div>
  )
}
