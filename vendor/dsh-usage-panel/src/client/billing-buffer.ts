// dsh-usage-panel · the billing modal's price buffer and its SEEDING rules.
//
// PURE (no IO) and unit-tested: what the 计费设置 modal shows — the switch
// state and every prefilled row — is a function of the SAVED record, never a
// constant. `bufferFromCustom` used to return `idleChecked: true`
// unconditionally, so a model whose 峰谷计价 switch was turned OFF reopened
// with the switch ON (the reported "保存后打开界面选择也会开启" bug).
//
// Record contract (harness `ui-conversation.sessionCostPrices`, mirrored by
// `SessionCostModelPrice`): the three top-level numbers are the PEAK column and
// the harness derives the off-peak charge as half of them unless an explicit
// `idle` column is present. There is NO `flat` field on the harness side —
// `flat` is this plugin's own marker, restored here and ignored by the
// harness, which is why an OFF save must persist BOTH columns (see
// `BillingSettingsModal` and `repairFlatEntries`).
import { priceText, type ResolvedModelPrice, type SessionCostModelPrice } from '../shared/pricing.ts'

/** One model's editable state: the 高峰 row, the main row, and the switch that decides what is billed. */
export interface PriceBuffer {
  /** 高峰价格 row — editable (and billed) only while the switch is ON. */
  hit: string
  miss: string
  out: string
  /** 峰谷计价: ON = peak row + explicit idle row; OFF = the single main row bills both periods. */
  idleChecked: boolean
  /**
   * The main row, labelled 空闲价格 while the switch is ON and 价格 while it is
   * OFF (with the switch OFF it is not an off-peak price at all — it is the one
   * price both periods bill).
   */
  idleHit: string
  idleMiss: string
  idleOut: string
}

/** Nothing selected, or a model with neither a custom price nor an official column. */
export const EMPTY_BUFFER: PriceBuffer = {
  hit: '',
  miss: '',
  out: '',
  idleChecked: false,
  idleHit: '',
  idleMiss: '',
  idleOut: '',
}

/**
 * Seed the modal's buffer from the saved record for the selected model.
 *
 * The rules, in order — they exist to bill exactly what the record already
 * bills, so opening a model never silently changes its price:
 *
 *  1. no saved entry + a published official column → switch ON, both rows
 *     prefilled from the official peak and idle columns. OFF cannot express a
 *     two-column published price, so defaulting OFF here would bill the
 *     official price wrongly (both periods at the peak column).
 *  2. no saved entry + no official column → switch OFF and empty, one price to
 *     enter.
 *  3. saved entry with `flat === true` (the user switched 峰谷计价 OFF) →
 *     switch OFF, and the single row shows that entry's own price.
 *  4. saved entry with an explicit `idle` column → switch ON, peak row and
 *     idle row from the entry.
 *  5. saved entry with neither `flat` nor `idle` (legacy single-column record)
 *     → switch ON with the idle row prefilled as HALF the saved peaks, which is
 *     exactly what the harness derives for that shape. Reinterpreting such an
 *     entry as a flat price would silently double its off-peak charge.
 *
 * `flat` is checked before `idle` because the marker is the user's switch, and
 * a flat entry bills its own (top-level) triple: the plugin's own writer stores
 * the same numbers in both columns so the two can never disagree.
 *
 * @param custom - the saved record for this model, if any.
 * @param official - the published peak/idle columns, or null when the model has none.
 * @returns a fresh buffer (never the caller's objects); the input is not mutated.
 */
export function seedPriceBuffer(
  custom: SessionCostModelPrice | undefined,
  official: ResolvedModelPrice | null,
): PriceBuffer {
  if (custom === undefined) {
    if (official === null) return { ...EMPTY_BUFFER }
    return {
      hit: priceText(official.peak.inputCacheHit),
      miss: priceText(official.peak.inputCacheMiss),
      out: priceText(official.peak.output),
      idleChecked: true,
      idleHit: priceText(official.idle.inputCacheHit),
      idleMiss: priceText(official.idle.inputCacheMiss),
      idleOut: priceText(official.idle.output),
    }
  }
  const peak = {
    hit: priceText(custom.inputCacheHit),
    miss: priceText(custom.inputCacheMiss),
    out: priceText(custom.output),
  }
  if (custom.flat === true) {
    // The peak row stays EMPTY while the switch is OFF, so toggling it back ON
    // prefills the peaks as twice the idle values (the official 2:1 convention
    // `toggleIdle` implements) instead of resurrecting a stale column.
    return { ...EMPTY_BUFFER, idleHit: peak.hit, idleMiss: peak.miss, idleOut: peak.out }
  }
  const idle = custom.idle !== undefined
    ? { hit: priceText(custom.idle.inputCacheHit), miss: priceText(custom.idle.inputCacheMiss), out: priceText(custom.idle.output) }
    : { hit: priceText(custom.inputCacheHit / 2), miss: priceText(custom.inputCacheMiss / 2), out: priceText(custom.output / 2) }
  return { ...peak, idleChecked: true, idleHit: idle.hit, idleMiss: idle.miss, idleOut: idle.out }
}
