/** Composer-dock official peak/valley status row: colored phase indicator,
 * phase name, and a per-second countdown to the next Beijing-time switch, plus
 * the opt-in session cost figure on the same line with its price-settings
 * entry. Mounted on 'conversation.composer.dock' (after the stats entry) so it
 * sticks with the composer in the active conversation scrollport. */

import { memo, useEffect, useMemo, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ConversationSnapshot, SnapshotStore, UseProjection,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComposerBarProps } from '../contract/slots.ts'
import type { ComposerCatalogModel, ComposerModelFact } from '../input/model-facts.ts'
import type { SessionCostPrices } from '../../submission-settings.ts'
import {
  billedCostCents, formatCost, priceText, resolveModelPrice,
} from '../price-calculator.ts'
import { formatPeakValleyCountdown, isDeepSeekProvider, peakValleyState } from './peak-valley.ts'
import { PriceSettingsPanel } from '../PriceSettingsPanel.tsx'
import css from './PeakValleyRow.module.css'

/** Registration-side preference + fact face for the composer-dock entry. */
export interface PeakValleyRowInjected {
  hooks: {
    /** Persisted force-enable preference bound as usePeakValley. */
    peakValley: SnapshotStore<boolean>
    /** The session's current model-route fact bound as useModelProvider. */
    modelProvider: SnapshotStore<ComposerModelFact>
    /** The session's advertised models bound as useModelCatalog. */
    modelCatalog: SnapshotStore<readonly ComposerCatalogModel[]>
    /** Persisted session-cost preference bound as useSessionCost. */
    sessionCost: SnapshotStore<boolean>
    /** Persisted per-model custom prices bound as useCostPrices. */
    costPrices: SnapshotStore<SessionCostPrices>
  }
  /** Replace the user's per-model custom peak prices; persists durably. */
  setCostPrices: (prices: SessionCostPrices) => void
}

/**
 * Full component props: the bound hooks, the projection seat, and the owning
 * dock's locale seat. The session-cost seats are optional so a mount without
 * the inject face (tests, hand assembly) simply renders with the cost half
 * off; the production registration always binds them.
 */
export interface PeakValleyRowProps {
  /** Persisted official-peak-valley preference (true force-paints the row). */
  usePeakValley: SnapshotSelectorHook<boolean>
  /** The session's current model-route fact (null provider = unknown route). */
  useModelProvider: SnapshotSelectorHook<ComposerModelFact>
  /** The session's advertised models (the price panel merges them into its dropdown). */
  useModelCatalog?: SnapshotSelectorHook<readonly ComposerCatalogModel[]>
  /** The conversation snapshot seat; the cost column reads the session's last-used model from it. */
  useSession?: SnapshotSelectorHook<ConversationSnapshot>
  /** Persisted session-cost preference (cost paints only while a DeepSeek route is known). */
  useSessionCost?: SnapshotSelectorHook<boolean>
  /** Persisted per-model custom prices backing the cost math and the price panel. */
  useCostPrices?: SnapshotSelectorHook<SessionCostPrices>
  /** Replace the user's per-model custom peak prices; the inject face's durable write path. */
  setCostPrices?: (prices: SessionCostPrices) => void
  /** The session projection read seat ('billedUsage'). */
  useProjection?: UseProjection
  /** The owning dock's locale seat. */
  t: ComposerBarProps['t']
}

/** Absent-inject-face price record: every model bills at its official/default column. */
const NO_CUSTOM_PRICES: SessionCostPrices = {}

/** Absent-inject-face catalog: the panel lists official columns and user-added models only. */
const NO_CATALOG_MODELS: readonly ComposerCatalogModel[] = []

/**
 * The session's last-used model selection: the newest settled assistant node's
 * durable provenance, walked back over the loaded window. Pure derivation
 * over the framework snapshot — no second subscription. The provider rides
 * along because two providers may serve the same model id with different
 * user-priced columns.
 */
function lastUsedModel(nodes: ConversationSnapshot['chat']['legacy']['nodes'] | undefined): { provider: string; model: string } | null {
  if (nodes === undefined) return null
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i]
    if (node !== undefined && node.kind === 'assistant' && node.provenance !== undefined) {
      return { provider: node.provenance.provider, model: node.provenance.model }
    }
  }
  return null
}

export const PeakValleyRow = memo(function PeakValleyRow({
  usePeakValley, useModelProvider, useModelCatalog, useSession, useSessionCost, useCostPrices, setCostPrices, useProjection, t,
}: PeakValleyRowProps) {
  const forceEnabled = usePeakValley(value => value)
  const fact = useModelProvider(value => value)
  const settledNodes = useSession?.(s => s.chat.legacy.nodes)
  const costEnabled = useSessionCost?.(value => value) ?? false
  const customPrices = useCostPrices?.(value => value) ?? NO_CUSTOM_PRICES
  const catalogModels = useModelCatalog?.(value => value) ?? NO_CATALOG_MODELS
  // Trigger matrix. The phase half paints when the Interface Settings switch
  // is on OR a DeepSeek API route is detected. The cost half requires its own
  // independent switch and a live billed-usage projection (absent key = the
  // host unit is not composed, and a made-up ¥0.00 would lie); it paints on
  // every route and even with an unnamed model — a priced or official model
  // shows the figure, and anything else shows the set-price reminder, so the
  // row never fabricates a figure but always names the missing price.
  const deepseek = isDeepSeekProvider(fact.provider)
  const phaseVisible = forceEnabled || deepseek
  const usage = useProjection?.('billedUsage')
  const sessionSelection = lastUsedModel(settledNodes)
  const sessionModel = sessionSelection?.model ?? null
  // The last-used message's route prices the session; before the first
  // message the composer's current route fact stands in for it.
  const sessionProvider = sessionSelection?.provider ?? fact.provider ?? null
  const costVisible = costEnabled && usage !== undefined
  // One per-second evaluation of the schedule while the row paints. The timer
  // re-anchors to each wall-clock second, so the countdown increments in
  // lockstep and the phase flip at a boundary lands on the next tick after
  // the boundary with no drift accumulating.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!phaseVisible && !costVisible) return
    setNow(new Date())
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = (): void => {
      timer = setTimeout(() => {
        setNow(new Date())
        schedule()
      }, 1_000 - (Date.now() % 1_000) + 5)
    }
    schedule()
    return () => { clearTimeout(timer) }
  }, [phaseVisible, costVisible])
  // The cost figure rides the durable period-bucketed projection (read above):
  // the host refolds incrementally per usage sample, so a new message repaints
  // the figure within the projection push latency (well under one second)
  // without the client ever re-reading the log.
  const resolved = useMemo(
    () => resolveModelPrice(sessionProvider, sessionModel, customPrices),
    [sessionProvider, sessionModel, customPrices],
  )
  const cost = useMemo(
    () => usage === undefined ? 0 : billedCostCents(usage, resolved),
    [usage, resolved],
  )
  // Hover title: the current model's prices — official columns list peak and
  // idle; a user-priced model lists its peak line (plus idle when it prices
  // both periods), or the plain price line for a single price; an unpriced
  // model shows the no-price notice.
  const priceTitle = useMemo(() => {
    if (resolved.source === 'default') return t('sessionCost.priceTitle.none')
    const listIdle = resolved.source === 'official' || resolved.idleExplicit
    const peakLabel = listIdle ? 'sessionCost.priceTitle.peak' : 'sessionCost.priceTitle.plain'
    const peak = t(peakLabel, {
      hit: priceText(resolved.peak.inputCacheHit),
      miss: priceText(resolved.peak.inputCacheMiss),
      output: priceText(resolved.peak.output),
    })
    if (!listIdle) return peak
    const idle = t('sessionCost.priceTitle.idle', {
      hit: priceText(resolved.idle.inputCacheHit),
      miss: priceText(resolved.idle.inputCacheMiss),
      output: priceText(resolved.idle.output),
    })
    return `${peak}\n${idle}`
  }, [resolved, t])
  const [panelOpen, setPanelOpen] = useState(false)
  if (!phaseVisible && !costVisible) return null
  const state = peakValleyState(now)
  const peak = state.phase === 'peak'
  const phaseLabel = t(peak ? 'peakValley.peak' : 'peakValley.offPeak')
  const countdownLabel = t('peakValley.countdown', { time: formatPeakValleyCountdown(state.msRemaining) })
  return (
    <div
      className={css.root}
      data-phase={state.phase}
      data-phase-color={forceEnabled || undefined}
      title={t(peak ? 'peakValley.hint.peak' : 'peakValley.hint.offPeak')}
    >
      {phaseVisible && (
        <Tooltip label={`${phaseLabel} ${countdownLabel}`} side="top" delayMs={300}>
          <span className={css.phaseGroup}>
            <span className={css.dot} aria-hidden />
            <span className={css.phase}>{phaseLabel}</span>
            <span className={css.countdown}>{countdownLabel}</span>
          </span>
        </Tooltip>
      )}
      {phaseVisible && costVisible && <span className={css.sep} aria-hidden>·</span>}
      {costVisible && (resolved.source === 'default'
        ? (
          // The current model has no official column and no user price: the
          // segment names that instead of a guessed default-column figure, so
          // the row doubles as the reminder and the entry point.
          <span className={css.cost} title={priceTitle}>{t('sessionCost.noPrice')}</span>
        )
        : (
          <span className={css.cost} title={priceTitle}>{t('sessionCost.label', { cost: formatCost(cost) })}</span>
        ))}
      {costVisible && (
        <button type="button" className={css.costSettings} onClick={() => { setPanelOpen(true) }}>
          {t('sessionCost.openSettings')}
        </button>
      )}
      <PriceSettingsPanel
        open={panelOpen}
        model={sessionModel}
        modelProvider={sessionProvider}
        prices={customPrices}
        extraModels={catalogModels}
        onClose={() => { setPanelOpen(false) }}
        onSave={(prices) => {
          setPanelOpen(false)
          // The snapshot-store write republishes synchronously, so the figure
          // reprices this render; the durable write follows behind it.
          setCostPrices?.(prices)
        }}
        t={t}
      />
    </div>
  )
})
