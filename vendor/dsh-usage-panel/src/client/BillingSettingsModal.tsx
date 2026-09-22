// dsh-usage-panel · billing settings modal (opened from the toolbar's 设置 button).
//
// Minimal SELECT + INPUT form over one model at a time: pick a provider →
// pick a model → the price inputs show the DEFAULT price (official DeepSeek
// columns, including a third-party relay serving an official id) and an
// unknown model starts empty with a "set your own price" hint. 保存 commits
// ONLY the selected model: values equal to the default remove any custom
// override (revert to official), edited values are stored as a custom
// override; every other model's stored override is preserved. There is no
// configured-list and no per-model flat switch — peak/valley is global.
import * as React from 'react'
import { Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { I18n } from './locales.ts'
import type { RpcLike } from './ctx.ts'
import { type BillingModelOption, type BillingModelOptions, type BillingSettings } from '../shared/contract.ts'
import type { SessionCostPrices } from '../shared/pricing.ts'
import {
  DEEPSEEK_OFFICIAL_PRICES,
  OFFICIAL_PRICES_AS_OF,
  OFFICIAL_PRICES_SOURCE,
  compositePriceKey,
  priceText,
  resolveModelPrice,
} from '../shared/pricing.ts'
import { callBillingGet, callBillingModels, callBillingSet } from './api.ts'
import { currentBilling, publishBilling } from './billing-bus.ts'

export interface BillingSettingsModalProps {
  rpc: RpcLike
  i18n: I18n
  open: boolean
  onClose: () => void
}

interface PriceBuffer {
  hit: string
  miss: string
  out: string
  idleChecked: boolean
  idleHit: string
  idleMiss: string
  idleOut: string
}

const EMPTY_BUFFER: PriceBuffer = {
  hit: '',
  miss: '',
  out: '',
  idleChecked: false,
  idleHit: '',
  idleMiss: '',
  idleOut: '',
}

function rowKey(provider: string, model: string): string {
  return compositePriceKey(provider, model)
}

function validPrice(value: string): boolean {
  if (value.trim() === '') return false
  const n = Number(value)
  return Number.isFinite(n) && n >= 0
}

/** The default price of a model: the official column when known, else null. */
function defaultPrice(provider: string, model: string): ReturnType<typeof resolveModelPrice> {
  return resolveModelPrice(provider, model, {})
}

function bufferFromCustom(custom: SessionCostPrices[string] | undefined): PriceBuffer {
  if (custom === undefined) return { ...EMPTY_BUFFER }
  const peak = { hit: String(custom.inputCacheHit), miss: String(custom.inputCacheMiss), out: String(custom.output) }
  const half = (n: number): string => String(n / 2)
  // The MAIN row is 空闲价格: the explicit idle column when present, the flat
  // price when flat, else the derived half-peaks (legacy single-price entries).
  const idle = custom.idle !== undefined
    ? { hit: String(custom.idle.inputCacheHit), miss: String(custom.idle.inputCacheMiss), out: String(custom.idle.output) }
    : custom.flat === true
      ? peak
      : { hit: half(custom.inputCacheHit), miss: half(custom.inputCacheMiss), out: half(custom.output) }
  return {
    ...peak,
    idleChecked: true,
    idleHit: idle.hit,
    idleMiss: idle.miss,
    idleOut: idle.out,
  }
}

/**
 * Bound a client RPC with a timeout: the modal must never spin forever on a
 * cold-start host (a large boot fold can block the host loop for seconds).
 * The losing side is guarded so its late settlement never goes unhandled.
 */
function withClientTimeout<T>(source: Promise<T>, ms: number, label: string): Promise<T> {
  source.catch(() => {
    /* guarded: the caller only observes the race result */
  })
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label + ' timed out')), ms)
    source.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export function BillingSettingsModal({ rpc, i18n, open, onClose }: BillingSettingsModalProps): JSX.Element | null {
  const t = i18n.t
  // Seed from the in-bundle bus: the plugin prefetches billing settings at
  // apply time, so a cold-start open renders instantly from the snapshot.
  const [settings, setSettings] = React.useState<BillingSettings | null>(() => currentBilling())
  const [options, setOptions] = React.useState<BillingModelOptions>({ options: [] })
  const [providerId, setProviderId] = React.useState('')
  const [modelName, setModelName] = React.useState('')
  const [buffer, setBuffer] = React.useState<PriceBuffer>({ ...EMPTY_BUFFER })
  const [editError, setEditError] = React.useState<string | null>(null)
  const [updated, setUpdated] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [loadNonce, setLoadNonce] = React.useState(0)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)

  const bumpLoad = (): void => setLoadNonce((n) => n + 1)

  // Two-stage load with a client-side timeout: a cold-start host busy with a
  // large boot fold must surface as an error + retry, never an endless
  // spinner. The bus snapshot (prefetched at apply) renders immediately.
  React.useEffect(() => {
    if (!open) return
    let disposed = false
    const snapshot = currentBilling()
    setLoadError(null)
    setSaveError(null)
    setEditError(null)
    setUpdated(null)
    setOptions({ options: [] })
    setProviderId('')
    setModelName('')
    setBuffer({ ...EMPTY_BUFFER })
    if (snapshot !== null) {
      setSettings(snapshot)
      setLoading(false)
    } else {
      setSettings(null)
      setLoading(true)
    }
    withClientTimeout(callBillingGet(rpc), 6000, 'billing settings')
      .then((current) => {
        if (disposed) return
        publishBilling(current)
        setSettings(current)
        setLoading(false)
      })
      .catch((err) => {
        if (disposed) return
        if (currentBilling() === null) {
          setLoadError(String((err as Error)?.message ?? err))
          setLoading(false)
        }
      })
    callBillingModels(rpc)
      .then((modelOptions) => {
        if (!disposed) setOptions(modelOptions)
      })
      .catch(() => {
        if (!disposed) setOptions({ options: [] })
      })
    return () => {
      disposed = true
    }
  }, [rpc, open, loadNonce])

  React.useEffect(() => {
    if (!open || options.options.length === 0) return
    setProviderId((prev) => (prev !== '' ? prev : options.options[0]!.provider))
  }, [open, options])

  const providerOptions = React.useMemo(() => {
    const map = new Map<string, BillingModelOption>()
    for (const option of options.options) {
      map.set(option.provider, { ...option, models: [...option.models] })
    }
    // Providers that only appear in stored custom prices stay reachable.
    if (settings !== null) {
      for (const key of Object.keys(settings.prices)) {
        const provider = key.includes('/') ? key.slice(0, key.indexOf('/')) : '(unknown)'
        if (!map.has(provider)) map.set(provider, { provider, providerName: provider, models: [] })
      }
    }
    if (map.size === 0) map.set('(unknown)', { provider: '(unknown)', providerName: '(unknown)', models: [] })
    return [...map.values()]
  }, [options, settings])

  const providerModels = React.useMemo(() => {
    const option = providerOptions.find((p) => p.provider === providerId)
    return option ? option.models : []
  }, [providerOptions, providerId])

  /** Load the selected model into the buffer: custom override, else the
   *  official default (peak and idle columns BOTH shown, idle auto-opened),
   *  else empty (unknown model — user sets a price). */
  const selectModel = (provider: string, model: string): void => {
    setProviderId(provider)
    setModelName(model)
    setEditError(null)
    const custom = settings?.prices[rowKey(provider, model)] ?? settings?.prices[model]
    if (custom !== undefined) {
      setBuffer(bufferFromCustom(custom))
      return
    }
    const def = defaultPrice(provider, model)
    if (def !== null) {
      // Peak/valley-capable model: open the idle column AND prefill the
      // official idle prices, so both periods are visible immediately.
      setBuffer({
        hit: String(def.peak.inputCacheHit),
        miss: String(def.peak.inputCacheMiss),
        out: String(def.peak.output),
        idleChecked: true,
        idleHit: String(def.idle.inputCacheHit),
        idleMiss: String(def.idle.inputCacheMiss),
        idleOut: String(def.idle.output),
      })
      return
    }
    setBuffer({ ...EMPTY_BUFFER })
  }

  /** Toggle per-model 峰谷计价: ON shows the 高峰价格 row, OFF bills both
   *  periods at the entered 空闲价格 (flat). Opening prefills the peak row as
   *  twice the idle values when the peak fields are empty. */
  const toggleIdle = (checked: boolean): void => {
    if (!checked) {
      setBuffer({ ...buffer, idleChecked: false })
      return
    }
    const double = (n: string): string => (n.trim() === '' ? '' : String(Number(n) * 2))
    setBuffer({
      ...buffer,
      idleChecked: true,
      hit: buffer.hit === '' ? double(buffer.idleHit) : buffer.hit,
      miss: buffer.miss === '' ? double(buffer.idleMiss) : buffer.miss,
      out: buffer.out === '' ? double(buffer.idleOut) : buffer.out,
    })
  }

  const switchProvider = (provider: string): void => {
    setProviderId(provider)
    setModelName('')
    setBuffer({ ...EMPTY_BUFFER })
    setEditError(null)
  }

  /** Commit the selected model; values equal to the default revert it to
   *  the official column (no custom record), edited values override. With no
   *  model selected, 保存 simply persists the switch settings (no forced pick).
   *  @param close - true = also close the modal (footer 保存); false = stay open (添加/更新). */
  const commitModel = (close: boolean): void => {
    if (settings === null) return
    if (modelName === '') {
      if (!close) return // 添加/更新 is disabled without a model anyway
      setSaving(true)
      setSaveError(null)
      callBillingSet(rpc, settings)
        .then((saved) => {
          publishBilling(saved)
          setSettings(saved)
          onClose()
        })
        .catch((err) => {
          setSaveError(t('billing.saveError', { msg: String((err as Error)?.message ?? err) }))
        })
        .finally(() => setSaving(false))
      return
    }
    const key = rowKey(providerId, modelName)
    const prices: SessionCostPrices = { ...settings.prices }
    const def = defaultPrice(providerId, modelName)
    const unchanged = def !== null && buffer.idleChecked
      && Number(buffer.idleHit) === def.idle.inputCacheHit
      && Number(buffer.idleMiss) === def.idle.inputCacheMiss
      && Number(buffer.idleOut) === def.idle.output
      && Number(buffer.hit) === def.peak.inputCacheHit
      && Number(buffer.miss) === def.peak.inputCacheMiss
      && Number(buffer.out) === def.peak.output
    if (unchanged) {
      // Reverting to the default never stores a duplicate of the official column.
      delete prices[key]
      delete prices[modelName]
    } else if (buffer.idleChecked) {
      // 峰谷计价 ON: peak row (fields) + explicit idle row.
      if (!validPrice(buffer.hit) || !validPrice(buffer.miss) || !validPrice(buffer.out)) {
        setSaveError(t('billing.err.invalidPrice', { key: modelName }))
        return
      }
      if (!validPrice(buffer.idleHit) || !validPrice(buffer.idleMiss) || !validPrice(buffer.idleOut)) {
        setSaveError(t('billing.err.invalidIdle', { key: modelName }))
        return
      }
      delete prices[modelName] // legacy bare key never wins alongside the composite
      prices[key] = {
        inputCacheHit: Number(buffer.hit),
        inputCacheMiss: Number(buffer.miss),
        output: Number(buffer.out),
        idle: { inputCacheHit: Number(buffer.idleHit), inputCacheMiss: Number(buffer.idleMiss), output: Number(buffer.idleOut) },
      }
    } else {
      // 峰谷计价 OFF: the main (空闲价格) row IS the single flat price.
      if (!validPrice(buffer.idleHit) || !validPrice(buffer.idleMiss) || !validPrice(buffer.idleOut)) {
        setSaveError(t('billing.err.invalidIdle', { key: modelName }))
        return
      }
      delete prices[modelName]
      prices[key] = {
        inputCacheHit: Number(buffer.idleHit),
        inputCacheMiss: Number(buffer.idleMiss),
        output: Number(buffer.idleOut),
        flat: true,
      }
    }
    setSaving(true)
    setSaveError(null)
    setUpdated(null)
    callBillingSet(rpc, { ...settings, prices })
      .then((saved) => {
        publishBilling(saved)
        setSettings(saved)
        if (close) onClose()
        else setUpdated(t('billing.updated', { model: modelName }))
      })
      .catch((err) => {
        setSaveError(t('billing.saveError', { msg: String((err as Error)?.message ?? err) }))
      })
      .finally(() => setSaving(false))
  }

  const save = (): void => commitModel(true)
  const addUpdate = (): void => commitModel(false)

  const peakValley = settings?.peakValleyEnabled !== false
  const def = modelName !== '' ? defaultPrice(providerId, modelName) : null
  const defaultValue = def !== null

  const body = loadError !== null ? (
    <div className="dsw-ust-bill-loading">
      <div>{t('billing.loadError', { msg: loadError })}</div>
      <button type="button" onClick={bumpLoad} className="dsw-ust-bill-cancel">
        {t('billing.retry')}
      </button>
    </div>
  ) : loading || settings === null ? (
    <div className="dsw-ust-bill-loading">{t('billing.loading')}</div>
  ) : (
    <div className="dsw-ust-bill">
      <section className="dsw-ust-bill-section">
        <div className="dsw-ust-bill-section-head">
          <h4>{t('billing.modelsTitle')}</h4>
        </div>
        <div className="dsw-ust-bill-pick">
          <label className="dsw-ust-bill-select">
            <span>{t('billing.providerLabel')}</span>
            <select
              value={providerId}
              onChange={(e) => switchProvider(e.target.value)}
            >
              {providerOptions.map((option) => (
                <option key={option.provider} value={option.provider}>
                  {option.providerName}
                </option>
              ))}
            </select>
          </label>
          <label className="dsw-ust-bill-select">
            <span>{t('billing.modelLabel')}</span>
            <select
              value={modelName}
              onChange={(e) => selectModel(providerId, e.target.value)}
            >
              <option value="">{t('billing.pickModel')}</option>
              {providerModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          {peakValley && (
            <label className="dsw-ust-bill-switch-inline">
              <span>{t('billing.idleToggle')}</span>
              <Switch
                checked={buffer.idleChecked}
                onChange={(e) => toggleIdle(e.target.checked)}
              />
            </label>
          )}
        </div>
        <div className="dsw-ust-bill-prices" data-period="idle">
          <span className="dsw-ust-bill-period is-idle">{t('billing.periodIdle')}</span>
          <PriceInput label={t('billing.hit')} value={buffer.idleHit} onChange={(v) => setBuffer({ ...buffer, idleHit: v })} />
          <PriceInput label={t('billing.miss')} value={buffer.idleMiss} onChange={(v) => setBuffer({ ...buffer, idleMiss: v })} />
          <PriceInput label={t('billing.out')} value={buffer.idleOut} onChange={(v) => setBuffer({ ...buffer, idleOut: v })} />
        </div>
        {buffer.idleChecked && (
          <div className="dsw-ust-bill-prices">
            <span className="dsw-ust-bill-period is-peak">{t('billing.periodPeak')}</span>
            <PriceInput label={t('billing.hit')} value={buffer.hit} onChange={(v) => setBuffer({ ...buffer, hit: v })} />
            <PriceInput label={t('billing.miss')} value={buffer.miss} onChange={(v) => setBuffer({ ...buffer, miss: v })} />
            <PriceInput label={t('billing.out')} value={buffer.out} onChange={(v) => setBuffer({ ...buffer, out: v })} />
          </div>
        )}
        <div className="dsw-ust-bill-commit-row">
          <button type="button" className="dsw-ust-bill-commit" onClick={addUpdate} disabled={saving || modelName === ''}>
            {t('billing.commit')}
          </button>
        </div>
        {updated !== null && <div className="dsw-ust-bill-error is-ok">{updated}</div>}
        {editError !== null && <div className="dsw-ust-bill-error">{editError}</div>}
      </section>

      <div className="dsw-ust-bill-divider" />

      <details className="dsw-ust-bill-ref">
        <summary>{t('billing.refTitle')}</summary>
        <div className="dsw-ust-bill-ref-note">
          {t('billing.refAsOf', { date: OFFICIAL_PRICES_AS_OF })} ·{' '}
          <a href={OFFICIAL_PRICES_SOURCE} target="_blank" rel="noreferrer">
            {t('billing.refSource')}
          </a>
        </div>
        <table>
          <thead>
            <tr>
              <th>{t('billing.refModel')}</th>
              <th>{t('billing.colHit')}</th>
              <th>{t('billing.colMiss')}</th>
              <th>{t('billing.colOutput')}</th>
            </tr>
            <tr className="dsw-ust-bill-ref-subhead">
              <th></th>
              <th>{t('billing.peakIdle')}</th>
              <th>{t('billing.peakIdle')}</th>
              <th>{t('billing.peakIdle')}</th>
            </tr>
          </thead>
          <tbody>
            {DEEPSEEK_OFFICIAL_PRICES.map((entry) => (
              <tr key={entry.model}>
                <td>{entry.model}</td>
                <td>{priceText(entry.price.inputCacheHit.peak)} / {priceText(entry.price.inputCacheHit.idle)}</td>
                <td>{priceText(entry.price.inputCacheMiss.peak)} / {priceText(entry.price.inputCacheMiss.idle)}</td>
                <td>{priceText(entry.price.output.peak)} / {priceText(entry.price.output.idle)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      {saveError !== null && <div className="dsw-ust-bill-error">{saveError}</div>}
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('billing.title')}
      closeLabel={t('billing.close')}
      className="dsw-ust-modal"
      contentClassName="dsw-ust-modal-content"
      footer={
        <div className="dsw-ust-bill-footer">
          <button type="button" className="dsw-ust-bill-cancel" onClick={onClose}>
            {t('billing.close')}
          </button>
          <button type="button" className="dsw-ust-bill-save" onClick={save} disabled={saving || loading}>
            {saving ? t('billing.saving') : t('billing.save')}
          </button>
        </div>
      }
    >
      {body}
    </Modal>
  )
}

function PriceInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): JSX.Element {
  return (
    <label className="dsw-ust-bill-input">
      <span>{label}</span>
      <input
        value={value}
        inputMode="decimal"
        placeholder="0.00"
        onChange={(e) => onChange(e.target.value)}
        className={value === '' ? '' : validPrice(value) ? 'is-ok' : 'is-bad'}
      />
    </label>
  )
}
