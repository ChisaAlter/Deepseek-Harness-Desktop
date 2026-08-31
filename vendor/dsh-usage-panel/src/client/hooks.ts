// dsh-usage-panel · shared client hooks and helpers.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Buckets, BillingSettings } from '../shared/contract.ts'
import type { I18n } from './locales.ts'
import type { RpcLike } from './ctx.ts'
import { callBillingGet } from './api.ts'
import { currentBilling, publishBilling, subscribeBilling } from './billing-bus.ts'

export const PALETTE = [
  'var(--dsw-static-deepseek-500)',
  'var(--dsw-alias-state-success-primary)',
  'var(--dsw-alias-state-warn-primary)',
  'var(--dsw-alias-state-error-primary)',
  'var(--dsw-static-deepseek-600)',
  'var(--dsw-static-deepseek-400)',
  'color-mix(in srgb, var(--dsw-static-deepseek-500) 70%, var(--dsw-alias-state-warn-primary))',
  'color-mix(in srgb, var(--dsw-alias-state-success-primary) 70%, var(--dsw-static-deepseek-500))',
  'color-mix(in srgb, var(--dsw-alias-state-error-primary) 65%, var(--dsw-static-deepseek-800))',
  'color-mix(in srgb, var(--dsw-static-deepseek-500) 50%, var(--dsw-alias-label-secondary))',
]

/** Top-5 models with stable colors + a merged "其他/other" row (v0.1.0). */
export interface ModelRow {
  model: string
  total: number
  color: string | null
  rest: boolean
  /** The row's four disjoint buckets (top-5 rows own buckets; the merged
   *  "other" row carries the SUM of the remaining models) — feeds the
   *  per-model cache hit rate in the donut list. */
  buckets: Buckets
}

export function modelRows(
  byModel: Array<{ model: string; total: number; input: number; output: number; cacheRead: number; cacheWrite: number }>,
  otherLabel: string,
): ModelRow[] {
  const rows: ModelRow[] = []
  for (let i = 0; i < byModel.length && i < 5; i++) {
    const m = byModel[i]!
    rows.push({
      model: m.model,
      total: m.total,
      color: PALETTE[i % PALETTE.length]!,
      rest: false,
      buckets: { input: m.input, output: m.output, cacheRead: m.cacheRead, cacheWrite: m.cacheWrite },
    })
  }
  if (byModel.length > 5) {
    const rest = byModel.slice(5)
    rows.push({
      model: otherLabel,
      total: rest.reduce((s, m) => s + m.total, 0),
      color: null,
      rest: true,
      buckets: rest.reduce(
        (acc, m) => ({
          input: acc.input + m.input,
          output: acc.output + m.output,
          cacheRead: acc.cacheRead + m.cacheRead,
          cacheWrite: acc.cacheWrite + m.cacheWrite,
        }),
        { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ),
    })
  }
  return rows
}

/** Count-up hook (easeOutCubic) driving the KPI number entrance (v0.1.0). */
export function useCountUp(target: number, duration: number): number {
  const [value, setValue] = useState(0)
  useEffect(() => {
    const start = performance.now()
    let raf = 0
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(target * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      if (raf) cancelAnimationFrame(raf)
    }
  }, [target, duration])
  return value
}

/** Subscribe a component to locale switches (re-renders on 'locale/change'). */
export function useI18n(i18n: I18n): I18n {
  const subscribe = useCallback((cb: () => void) => i18n.subscribe(cb), [i18n])
  const active = useSyncExternalStore(subscribe, i18n.getSnapshot, i18n.getSnapshot)
  return active === i18n.locale ? i18n : { ...i18n, locale: active }
}

/**
 * Subscribe a component to the billing preferences (loaded once from the
 * host, then republished through the in-bundle bus by the settings modal).
 */
export function useBillingSettings(rpc: RpcLike): BillingSettings | null {
  const [settings, setSettings] = useState<BillingSettings | null>(() => currentBilling())
  useEffect(() => {
    let disposed = false
    const off = subscribeBilling((next) => setSettings(next))
    if (currentBilling() === null) {
      callBillingGet(rpc)
        .then((value) => {
          if (disposed) return
          publishBilling(value)
          setSettings(value)
        })
        .catch(() => {
          /* unhealthy host: keep defaults, stats still render without prices */
        })
    }
    return () => {
      disposed = true
      off()
    }
  }, [rpc])
  return settings
}

/** Keep a ref of the latest value without re-rendering (for effect deps). */
export function useLatest<T>(value: T): { current: T } {
  const ref = useRef(value)
  ref.current = value
  return ref
}

/** Simple auto-hide for popup menus. */
export function useClickAway(onAway: () => void): (node: HTMLElement | null) => void {
  const ref = useRef<HTMLElement | null>(null)
  const cbRef = useLatest(onAway)
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      if (ref.current) document.removeEventListener('mousedown', handle)
      ref.current = node
      if (node) document.addEventListener('mousedown', handle)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  function handle(e: MouseEvent): void {
    if (ref.current && !ref.current.contains(e.target as Node)) cbRef.current()
  }
  useEffect(() => () => document.removeEventListener('mousedown', handle), [])
  return setRef
}

/** Tooltip payload shared by all charts. */
export interface Tip {
  left: number
  top: number
  title: string
  lines: Array<{ label: string; value: string; color?: string | null }>
}
