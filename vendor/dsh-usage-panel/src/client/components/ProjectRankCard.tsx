// dsh-usage-panel · project usage ranking card.
// Groups sessions by working directory (the desktop "project"), showing
// project / estimated cost / token usage with a "sort by tokens/cost"
// selector. "显示更多…" opens the SAME template in a modal (MoreRankModal).
// The RPC is never gated on billing settings: cost cells render "—" until the
// price record arrives, and every call is bounded by the API timeout.
import { useState } from 'react'
import type { ProjectRow } from '../../shared/contract.ts'
import { fmtTokens } from '../../shared/format.ts'
import { totalCostCents } from '../../shared/cost.ts'
import { formatCost } from '../../shared/pricing.ts'
import { callProjectPage } from '../api.ts'
import { useBillingSettings } from '../hooks.ts'
import type { RpcLike } from '../ctx.ts'
import type { I18n } from '../locales.ts'
import { MoreRankModal } from './MoreRankModal.tsx'
import * as React from 'react'

interface ProjectRankCardProps {
  i18n: I18n
  rpc: RpcLike
}

export function ProjectRankCard({ i18n, rpc }: ProjectRankCardProps): JSX.Element {
  const t = i18n.t
  const locale = i18n.locale
  const billing = useBillingSettings(rpc)
  const [sort, setSort] = useState<'tokens' | 'cost'>('tokens')
  const [rows, setRows] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)

  const fetchFirst = (nextSort: 'tokens' | 'cost'): void => {
    setLoading(true)
    setLoadError(null)
    callProjectPage(rpc, 0, nextSort)
      .then((page) => {
        setRows(page.rows)
      })
      .catch((err) => {
        setLoadError(String((err as Error)?.message ?? err))
      })
      .finally(() => setLoading(false))
  }

  React.useEffect(() => {
    fetchFirst(sort)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, sort])

  // Auto-retry every 5s while the first page keeps failing (a busy host must
  // surface as eventual success, never a dead card).
  React.useEffect(() => {
    if (loadError === null) return
    const timer = setInterval(() => {
      fetchFirst(sort)
    }, 5000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadError, sort])

  return (
    <div className="dsw-ust-card">
      <div className="dsw-ust-card-head">
        <div className="dsw-ust-card-title">
          <h3>{t('projects.title')}</h3>
          <span className="dsw-ust-card-sub">{t('projects.sub')}</span>
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
        <span className="dsw-ust-th-session">{t('projects.hProject')}</span>
        <span className="dsw-ust-th-cost">{t('projects.hCost')}</span>
        <span className="dsw-ust-th-tokens">{t('projects.hTokens')}</span>
      </div>
      {loadError !== null && rows.length === 0 ? (
        <div className="dsw-ust-bill-loading">
          <div>{t('billing.loadError', { msg: loadError })}</div>
          <button type="button" className="dsw-ust-bill-cancel" onClick={() => fetchFirst(sort)}>
            {t('billing.retry')}
          </button>
        </div>
      ) : loading && rows.length === 0 ? (
        <div className="dsw-ust-empty">{t('projects.loading')}</div>
      ) : rows.length === 0 ? (
        <div className="dsw-ust-empty">{t('projects.empty')}</div>
      ) : (
        rows.map((row, i) => {
          const cents = billing === null ? null : totalCostCents(row.models, billing.prices, billing.peakValleyEnabled)
          return (
            <div key={i} className="dsw-ust-srow">
              <span className="dsw-ust-srank">{i + 1}</span>
              <span className="dsw-ust-sname" title={row.project ?? ''}>
                {row.name}
              </span>
              <span className={'dsw-ust-scost' + (cents === null ? ' is-unpriced' : '')} title={cents === null ? t('sessions.cost.none') : t('strip.estimate')}>
                {cents === null ? '—' : formatCost(cents)}
              </span>
              <span className="dsw-ust-stokens">{fmtTokens(row.totals.total, locale)}</span>
            </div>
          )
        })
      )}
      <button type="button" className="dsw-ust-more" onClick={() => setMoreOpen(true)} disabled={rows.length === 0}>
        {t('sessions.more')}
      </button>
      <MoreRankModal kind="projects" i18n={i18n} rpc={rpc} open={moreOpen} onClose={() => setMoreOpen(false)} />
    </div>
  )
}
