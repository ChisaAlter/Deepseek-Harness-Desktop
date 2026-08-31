// dsh-usage-panel · composer cost strip (conversation.composer.dock entry).
//
// One ambient line under the input card: current billing phase (peak/off-peak,
// Beijing wall time), the countdown to the next phase switch, and the current
// session's cost. Hovering reveals the current model's price row (official or
// custom source) — or the "not priced / set a price" hint when the model has
// no price. Everything is an ESTIMATE, never a bill.
//
// Live data: the session's period-classified buckets ride the host's own
// `usagePanel` projection (live registry state for the open session, cold
// cached row otherwise) — prices are applied HERE, so changing a price never
// refolds anything.
import * as React from 'react'
import type { I18n } from './locales.ts'
import type { RpcLike } from './ctx.ts'
import type { BillingSettings, SessionCostData } from '../shared/contract.ts'
import { isPeakBillingTime, formatPeakValleyCountdown, peakValleyState } from '../shared/billing.ts'
import { costCentsFor, costCompositionCents, sumCostCents, type CostComposition } from '../shared/cost.ts'
import { formatCost, priceText, resolveModelPrice } from '../shared/pricing.ts'
import { callBillingGet, callSessionCost } from './api.ts'
import { currentBilling, publishBilling, subscribeBilling } from './billing-bus.ts'
import { BillingSettingsModal } from './BillingSettingsModal.tsx'
import type { Tip } from './hooks.ts'

const POLL_MS = 2000
const BACKOFF_MS = 60_000
const TICK_MS = 1000

export interface CostStripProps {
  rpc: RpcLike
  i18n: I18n
  sessionId: string | null
}

export function CostStrip({ rpc, i18n, sessionId }: CostStripProps): JSX.Element | null {
  const [settings, setSettings] = React.useState<BillingSettings | null>(() => currentBilling())
  const [cost, setCost] = React.useState<SessionCostData | null>(null)
  const [now, setNow] = React.useState<number>(() => Date.now())
  const [tipPos, setTipPos] = React.useState<{ left: number; top: number } | null>(null)
  const [hoverKind, setHoverKind] = React.useState<'price' | 'comp' | null>(null)
  const [billingOpen, setBillingOpen] = React.useState(false)

  // Preferences: load once, then follow the in-bundle bus (the settings
  // modal republishes through it on save).
  React.useEffect(() => {
    let disposed = false
    const off = subscribeBilling((next) => {
      setSettings(next)
    })
    if (currentBilling() === null) {
      callBillingGet(rpc)
        .then((value) => {
          if (disposed) return
          publishBilling(value)
          setSettings(value)
        })
        .catch(() => {
          /* unhealthy host: keep defaults, the strip stays live in memory */
        })
    }
    return () => {
      disposed = true
      off()
    }
  }, [rpc])

  // Session cost poll: 2s while visible; paused when the tab is hidden or the
  // strip is disabled. After two consecutive failures (e.g. a damaged log that
  // cannot be read) the poll backs off to 60s — never a persistent hammer.
  React.useEffect(() => {
    if (sessionId === null) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    const poll = (): void => {
      if (document.visibilityState !== 'visible') {
        timer = setTimeout(poll, POLL_MS)
        return
      }
      callSessionCost(rpc, sessionId)
        .then((value) => {
          failures = 0
          if (!disposed) setCost(value)
        })
        .catch(() => {
          failures += 1
          /* transient failures keep the last readout */
        })
        .finally(() => {
          if (disposed) return
          timer = setTimeout(poll, failures >= 2 ? BACKOFF_MS : POLL_MS)
        })
    }
    poll()
    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [rpc, sessionId])

  // Phase-tick: the countdown is price-free pure math.
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  if (settings === null || !settings.stripVisible) return null

  const phase = isPeakBillingTime(now) ? 'peak' : 'off-peak'
  const switchState = peakValleyState(new Date(now))
  const rows = (cost?.models ?? []).map((m) => ({
    entry: m,
    cents: costCentsFor(m.cost, m.provider, m.model, settings.prices, settings.peakValleyEnabled),
  }))
  const total = sumCostCents(rows.map((r) => r.cents))
  const unpriced = rows.filter((r) => r.cents === null).length
  const hasUsage = total !== null || rows.length > 0

  let costText: string
  if (total !== null) costText = formatCost(total)
  else if (hasUsage) costText = i18n.t('strip.setPrice')
  else costText = i18n.t('strip.noUsage')

  const model = cost?.currentModel ?? ''
  const provider = cost?.currentProvider ?? ''
  const price = model !== '' ? resolveModelPrice(provider, model, settings.prices) : null
  const comp = costCompositionCents(cost?.models ?? [], settings.prices, settings.peakValleyEnabled)
  const costTitle = i18n.t('strip.costLabel') + costText

  // Two trigger zones: the phase group (label + countdown) → current period's
  // prices; the cost text → the session's cost composition.
  const tip = hoverKind === 'price'
    ? buildPeriodPriceTip(i18n, model, provider, price, phase, settings.peakValleyEnabled, costTitle)
    : hoverKind === 'comp'
      ? buildCompositionTip(i18n, costTitle, comp)
      : null
  const hintOn = settings.peakHintVisible

  return (
    <div
      className="dsw-ust-strip"
      data-usage-strip=""
    >
      {hintOn && (
        <span
          className="dsw-ust-strip-phase"
          onMouseMove={(e) => {
            setTipPos({ left: e.clientX, top: e.clientY })
            setHoverKind('price')
          }}
          onMouseLeave={() => {
            setTipPos(null)
            setHoverKind(null)
          }}
        >
          <span className={'dsw-ust-strip-light ' + (phase === 'peak' ? 'is-peak' : 'is-idle')} aria-hidden />
          <span className={'dsw-ust-strip-phase-text ' + (phase === 'peak' ? 'is-peak' : 'is-idle')}>
            {i18n.t(phase === 'peak' ? 'strip.peakLabel' : 'strip.offPeakLabel')}
          </span>
          <span className="dsw-ust-strip-count">{i18n.t('strip.switchIn', { time: formatPeakValleyCountdown(switchState.msRemaining) })}</span>
        </span>
      )}
      <span className="dsw-ust-strip-sep" aria-hidden>
        ·
      </span>
      <span
        className={'dsw-ust-strip-cost' + (total === null && hasUsage ? ' is-unpriced' : '') + (total === null ? ' is-clickable' : '')}
        onMouseMove={(e) => {
          setTipPos({ left: e.clientX, top: e.clientY })
          setHoverKind('comp')
        }}
        onMouseLeave={() => {
          setTipPos(null)
          setHoverKind(null)
        }}
        onClick={() => {
          if (total === null) setBillingOpen(true)
        }}
        title={total === null ? i18n.t('strip.openSettings') : i18n.t('strip.estimate')}
      >
        {i18n.t('strip.costLabel')}{costText}
      </span>
      <BillingSettingsModal rpc={rpc} i18n={i18n} open={billingOpen} onClose={() => setBillingOpen(false)} />
      {tipPos !== null && tip !== null && (
        <div className="dsw-ust-tooltip show" role="tooltip" style={{ left: tipPos.left, top: tipPos.top }}>
          <div className="dsw-ust-tooltip-title">{tip.title}</div>
          {tip.lines.map((line, idx) => (
            <div key={idx} className="dsw-ust-tooltip-row">
              <i style={{ background: line.color || 'var(--dsw-alias-label-secondary)' }} />
              <span className="dsw-ust-tooltip-label">{line.label}</span>
              <span className="dsw-ust-tooltip-value">{line.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Hover tip in the SAME visual language as the session-stats tooltips
 * (dsw-ust-tooltip: fixed, pointer-following, title + colored rows), carrying
 * the CURRENT PERIOD's unit prices: peak hours show the peak column, off-peak
 * hours show the idle column (flat mode always shows the peak column).
 */
function buildPeriodPriceTip(
  i18n: I18n,
  model: string,
  provider: string,
  price: ReturnType<typeof resolveModelPrice>,
  phase: 'peak' | 'off-peak',
  peakValleyEnabled: boolean,
  costTitle: string,
): Tip | null {
  const title = model === ''
    ? costTitle
    : costTitle + ' · ' + (phase === 'peak' ? i18n.t('strip.hoverPeak') : i18n.t('strip.hoverIdle'))
  if (price === null) {
    return { left: 0, top: 0, title, lines: [{ label: i18n.t('strip.notPriced'), value: '' }] }
  }
  const column = !peakValleyEnabled || phase === 'peak' ? price.peak : price.idle
  return {
    left: 0,
    top: 0,
    title,
    lines: [
      { label: i18n.t('strip.compHit'), value: priceText(column.inputCacheHit), color: 'var(--dsw-alias-state-error-primary)' },
      { label: i18n.t('strip.compMiss'), value: priceText(column.inputCacheMiss), color: 'var(--dsw-alias-state-warn-primary)' },
      { label: i18n.t('strip.compOutput'), value: priceText(column.output), color: 'var(--dsw-alias-state-success-primary)' },
      { label: i18n.t('strip.estimate') + ' · ' + (price.source === 'official' ? i18n.t('strip.sourceOfficial') : i18n.t('strip.sourceCustom')), value: '', color: 'var(--dsw-alias-label-tertiary)' },
    ],
  }
}

/**
 * Hover tip over the cost text: the session's cost composition (输入命中 /
 * 输入未命中 / 输出), same visual language as the session-stats tooltips.
 */
function buildCompositionTip(i18n: I18n, title: string, comp: CostComposition | null): Tip | null {
  if (comp === null) {
    return { left: 0, top: 0, title, lines: [{ label: i18n.t('strip.notPriced'), value: '' }] }
  }
  return {
    left: 0,
    top: 0,
    title,
    lines: [
      { label: i18n.t('strip.compHit'), value: formatCost(comp.hit), color: 'var(--dsw-alias-state-error-primary)' },
      { label: i18n.t('strip.compMiss'), value: formatCost(comp.miss), color: 'var(--dsw-alias-state-warn-primary)' },
      { label: i18n.t('strip.compOutput'), value: formatCost(comp.output), color: 'var(--dsw-alias-state-success-primary)' },
      { label: i18n.t('strip.estimate'), value: '', color: 'var(--dsw-alias-label-tertiary)' },
    ],
  }
}
