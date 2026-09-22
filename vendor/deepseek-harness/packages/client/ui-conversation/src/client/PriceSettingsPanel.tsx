/** Session-cost price settings panel: per-model prices over a modal.
 * Official DeepSeek columns are read-only displays (published peak prices,
 * idle figure beside them); every directory (provider, model) pair edits its
 * own price — a non-official `deepseek-v4` model gets a peak/valley switch for
 * editing both periods, everything else edits a single price. Directory models
 * merge into the dropdown as their own editable entries keyed `provider/model`
 * (two providers may serve the same model id with different real-world prices,
 * so each is listed and priced separately; a directory model whose id is an
 * official column keeps the official read-only column listed and adds its own
 * prefixed editable entry beside it); a clear button drops the selected
 * model's custom price. */

import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Button, Input, Modal, SettingsSelect, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComposerBarProps } from './contract/slots.ts'
import type { ComposerCatalogModel } from './input/model-facts.ts'
import type { SessionCostModelPrice, SessionCostPrices } from '../submission-settings.ts'
import { compositePriceKey, isDeepSeekProvider, knownModelNames, officialPriceFor, priceText } from './price-calculator.ts'
import css from './PriceSettingsPanel.module.css'

/** Panel props: plain data and callbacks only. */
export interface PriceSettingsPanelProps {
  /** Whether the modal is showing (presence-backed exit stays mounted). */
  open: boolean
  /** The session's current model id; seeds the initial selection when known. */
  model: string | null
  /** The session's current provider route id, when known; pairs with `model`
   * to prefer that provider's entry for the initial selection. */
  modelProvider?: string | null
  /** The persisted custom price record the draft seeds from. */
  prices: SessionCostPrices
  /**
   * Models the session's directory advertises, merged into the dropdown
   * after the official and user-added columns so every available model can
   * be priced without manual entry. Directory additions and removals flow
   * through on every republish.
   */
  extraModels?: readonly ComposerCatalogModel[]
  /** Discard the draft and close. */
  onClose: () => void
  /** Persist the draft (already validated) and reprice the session. */
  onSave: (prices: SessionCostPrices) => void
  /** The owning dock's locale seat. */
  t: ComposerBarProps['t']
}

/** One draft entry: three peak-price strings plus the optional idle column. */
interface DraftEntry {
  readonly hit: string
  readonly miss: string
  readonly output: string
  readonly idleHit: string
  readonly idleMiss: string
  readonly idleOutput: string
  /** Peak/valley pricing mode: both periods edited and persisted explicitly. */
  readonly peakValley: boolean
}

const EMPTY_ENTRY: DraftEntry = {
  hit: '', miss: '', output: '', idleHit: '', idleMiss: '', idleOutput: '', peakValley: false,
}

/** Draft field → official price bucket, for the read-only official display. */
const DRAFT_FIELD_TO_PRICE = {
  hit: 'inputCacheHit',
  miss: 'inputCacheMiss',
  output: 'output',
} as const

const seedStrings = (price: SessionCostModelPrice): DraftEntry => ({
  hit: String(price.inputCacheHit),
  miss: String(price.inputCacheMiss),
  output: String(price.output),
  idleHit: price.idle === undefined ? '' : String(price.idle.inputCacheHit),
  idleMiss: price.idle === undefined ? '' : String(price.idle.inputCacheMiss),
  idleOutput: price.idle === undefined ? '' : String(price.idle.output),
  peakValley: price.idle !== undefined,
})

/** Parse one draft field; NaN when not a finite number. */
const parsePrice = (value: string): number => {
  const trimmed = value.trim()
  if (trimmed === '') return Number.NaN
  return Number(trimmed)
}

/** Provider half of a `provider/model` price key; a provider route id never
 * contains a `/`, so the first `/` is the separator. Undefined for a bare
 * (legacy model-id) key. */
function priceKeyProvider(key: string): string | undefined {
  const slash = key.indexOf('/')
  return slash <= 0 ? undefined : key.slice(0, slash)
}

/** Model half of a price key: the part after the first `/`, or the whole key. */
function priceKeyModel(key: string): string {
  const slash = key.indexOf('/')
  return slash <= 0 ? key : key.slice(slash + 1)
}

/** Whether one directory model yields an editable panel row: the read-only
 * official column already represents a DeepSeek-route entry whose id is an
 * official column, so that duplicate is skipped. */
function editableDirectoryModel(entry: ComposerCatalogModel): boolean {
  return !(officialPriceFor(entry.id) !== undefined && isDeepSeekProvider(entry.provider))
}

/**
 * Render the price-settings modal.
 * @param props - open state, session model, persisted prices, directory
 *   models, and save/close callbacks.
 * @returns the modal tree; the draft reseeds every time `open` turns true.
 */
export function PriceSettingsPanel({ open, model, modelProvider = null, prices, extraModels = [], onClose, onSave, t }: PriceSettingsPanelProps) {
  // Draft is keyed exactly like the persisted record: `provider/model` for a
  // directory model (two providers may serve the same id with different
  // prices, so each keeps its own slot), or a bare model id for a legacy
  // record. Official columns are display-only and never enter the draft.
  const [draft, setDraft] = useState<Record<string, DraftEntry>>({})
  const [selected, setSelected] = useState('')
  // Dropdown entries: the official columns first (always listed read-only),
  // then every (provider, model) directory pair as its own editable entry,
  // then priced leftovers whose directory entry is gone. The option value is
  // the persisted price key, so the selected entry's draft lookup is direct.
  const entries = useMemo(() => {
    const byKey = new Map<string, { key: string; provider?: string; id: string; label: string; official: boolean }>()
    for (const id of knownModelNames(draft)) {
      if (officialPriceFor(id) === undefined) continue
      const key = id.toLowerCase()
      byKey.set(`official:${key}`, { key, id, label: id, official: true })
    }
    for (const entry of extraModels) {
      if (!editableDirectoryModel(entry)) continue
      const key = compositePriceKey(entry.provider, entry.id)
      if (byKey.has(key)) continue
      const custom = draft[key] !== undefined
      byKey.set(key, {
        key,
        provider: entry.provider,
        id: entry.id,
        label: `${key}${custom ? ` · ${t('sessionCost.panel.custom')}` : ''}`,
        official: false,
      })
    }
    // A priced model whose directory entry is gone (provider removed) stays
    // listable so the user can see and clear its price.
    for (const key of Object.keys(draft)) {
      if (byKey.has(key)) continue
      const provider = priceKeyProvider(key)
      const id = priceKeyModel(key)
      if (provider !== undefined) {
        byKey.set(key, { key, provider, id, label: `${key} · ${t('sessionCost.panel.custom')}`, official: false })
      } else if ([...byKey.values()].some(item => !item.official && item.id.toLowerCase() === id.toLowerCase())) {
        continue
      } else {
        byKey.set(key, { key, id, label: `${key} · ${t('sessionCost.panel.custom')}`, official: false })
      }
    }
    return [...byKey.values()]
  }, [draft, extraModels, t])
  useEffect(() => {
    if (!open) return
    // Seed the draft, migrating a legacy bare-model price to every editable
    // directory entry serving that model so each provider's model carries it
    // and can be edited separately. A bare official-column id with no serving
    // route stays read-only and its legacy override is dropped on save.
    const seeded: Record<string, DraftEntry> = {}
    for (const [key, price] of Object.entries(prices)) {
      const provider = priceKeyProvider(key)
      if (provider !== undefined) {
        seeded[key] = seedStrings(price)
        continue
      }
      const matches = extraModels.filter(entry =>
        entry.id.toLowerCase() === key.toLowerCase() && editableDirectoryModel(entry))
      if (matches.length > 0) {
        for (const entry of matches) seeded[compositePriceKey(entry.provider, entry.id)] = seedStrings(price)
      } else if (officialPriceFor(key) === undefined) {
        seeded[key] = seedStrings(price)
      }
    }
    setDraft(seeded)
    // Prefer the entry for the session's exact (provider, model), then any
    // editable entry for the model, then the first.
    const initial = model === null
      ? entries[0]?.key ?? ''
      : (
        modelProvider !== null && modelProvider !== undefined
          ? entries.find(entry =>
              entry.provider === modelProvider && entry.id.toLowerCase() === model.toLowerCase() && !entry.official)?.key
          : undefined
      )
        ?? entries.find(entry => entry.id.toLowerCase() === model.toLowerCase() && !entry.official)?.key
        ?? entries.find(entry => entry.id.toLowerCase() === model.toLowerCase())?.key
        ?? entries[0]?.key ?? ''
    setSelected(initial)
    // `entries` is derived from the freshly seeded draft; the seed above is
    // this effect's own input, so the list is final once `prices` and `model`
    // are.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed on open only
  }, [open, model, modelProvider, prices])

  const selectedEntry = entries.find(entry => entry.key === selected)
  const entry = selectedEntry === undefined ? undefined : draft[selectedEntry.key]
  const official = selectedEntry?.official === true ? officialPriceFor(selectedEntry.id) : undefined
  // The peak/valley switch is offered to non-official models whose id carries
  // the deepseek-v4 keyword: ON edits both periods, OFF edits one price.
  const offersPeakValley = official === undefined
    && selectedEntry !== undefined && /deepseek-v4/i.test(selectedEntry.id)
  const invalid = Object.values(draft).some(price =>
    [price.hit, price.miss, price.output].some(value => !(parsePrice(value) > 0))
    || (price.peakValley && [price.idleHit, price.idleMiss, price.idleOutput].some(value => !(parsePrice(value) > 0))))

  const setField = (field: keyof DraftEntry) => (event: ChangeEvent<HTMLInputElement>) => {
    if (official !== undefined || selectedEntry === undefined) return // official columns are display-only
    const value = event.target.value
    setDraft((current) => {
      const base = current[selectedEntry.key] ?? EMPTY_ENTRY
      return { ...current, [selectedEntry.key]: { ...base, [field]: value } }
    })
  }

  const togglePeakValley = (checked: boolean): void => {
    if (selectedEntry === undefined) return
    setDraft((current) => {
      const base = current[selectedEntry.key] ?? EMPTY_ENTRY
      return { ...current, [selectedEntry.key]: { ...base, peakValley: checked } }
    })
  }

  const clearSelected = (): void => {
    if (selectedEntry === undefined) return
    setDraft((current) => {
      const next = { ...current }
      delete next[selectedEntry.key]
      return next
    })
  }

  const priceRow = (field: 'hit' | 'miss' | 'output', label: string) => {
    const officialPair = official?.[DRAFT_FIELD_TO_PRICE[field]]
    return (
      <div className={css.row} key={field}>
        <span className={css.label}>{label}</span>
        <Input
          className={css.priceInput}
          type="number"
          min={0}
          step="0.01"
          aria-label={label}
          value={officialPair !== undefined ? String(officialPair.peak) : entry?.[field] ?? ''}
          disabled={officialPair !== undefined}
          onChange={setField(field)}
        />
        {officialPair !== undefined && (
          <span className={css.hint}>
            {t('sessionCost.panel.offPeakHint', { price: priceText(officialPair.idle) })}
          </span>
        )}
      </div>
    )
  }

  const idleRow = (field: 'idleHit' | 'idleMiss' | 'idleOutput', label: string) => (
    <div className={css.row} key={field}>
      <span className={css.label}>{label}</span>
      <Input
        className={css.priceInput}
        type="number"
        min={0}
        step="0.01"
        aria-label={label}
        value={entry?.[field] ?? ''}
        onChange={setField(field)}
      />
    </div>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('sessionCost.panel.title')}
      description={t('sessionCost.panel.description')}
      closeLabel={t('sessionCost.panel.cancel')}
      className={css.dialogWide}
      contentClassName={css.contentScroll}
      footer={(
        <div className={css.footer}>
          {invalid && <span className={css.error} role="alert">{t('sessionCost.panel.invalid')}</span>}
          <Button variant="outline" onClick={onClose}>{t('sessionCost.panel.cancel')}</Button>
          <Button
            variant="primary"
            disabled={invalid}
            onClick={() => {
              const persisted: SessionCostPrices = {}
              for (const [name, price] of Object.entries(draft)) {
                persisted[name] = {
                  inputCacheHit: parsePrice(price.hit),
                  inputCacheMiss: parsePrice(price.miss),
                  output: parsePrice(price.output),
                  ...(price.peakValley
                    ? {
                        idle: {
                          inputCacheHit: parsePrice(price.idleHit),
                          inputCacheMiss: parsePrice(price.idleMiss),
                          output: parsePrice(price.idleOutput),
                        },
                      }
                    : {}),
                }
              }
              onSave(persisted)
            }}
          >
            {t('sessionCost.panel.save')}
          </Button>
        </div>
      )}
    >
      <div className={css.body}>
        <div className={css.row}>
          <span className={css.label}>{t('sessionCost.panel.model')}</span>
          <SettingsSelect
            className={css.modelSelect}
            variant="block"
            aria-label={t('sessionCost.panel.model')}
            value={selected}
            options={entries.map(entry => ({ id: entry.key, label: entry.label }))}
            onChange={setSelected}
          />
          {official === undefined && entry !== undefined && (
            <Button variant="outline" onClick={clearSelected}>{t('sessionCost.panel.clear')}</Button>
          )}
        </div>
        {offersPeakValley && (
          <div className={css.row}>
            <span className={css.label}>{t('sessionCost.panel.peakValley')}</span>
            <Switch
              checked={entry?.peakValley ?? false}
              aria-label={t('sessionCost.panel.peakValley')}
              onChange={(event: ChangeEvent<HTMLInputElement>) => { togglePeakValley(event.target.checked) }}
            />
          </div>
        )}
        {official !== undefined ? (
          <>
            {priceRow('hit', t('sessionCost.panel.inputCacheHit'))}
            {priceRow('miss', t('sessionCost.panel.inputCacheMiss'))}
            {priceRow('output', t('sessionCost.panel.output'))}
          </>
        ) : entry?.peakValley ? (
          <>
            <div className={css.groupLabel}>{t('sessionCost.panel.peak')}</div>
            {priceRow('hit', t('sessionCost.panel.inputCacheHit'))}
            {priceRow('miss', t('sessionCost.panel.inputCacheMiss'))}
            {priceRow('output', t('sessionCost.panel.output'))}
            <div className={css.groupLabel}>{t('sessionCost.panel.idle')}</div>
            {idleRow('idleHit', t('sessionCost.panel.inputCacheHit'))}
            {idleRow('idleMiss', t('sessionCost.panel.inputCacheMiss'))}
            {idleRow('idleOutput', t('sessionCost.panel.output'))}
          </>
        ) : (
          <>
            {priceRow('hit', t('sessionCost.panel.inputCacheHit'))}
            {priceRow('miss', t('sessionCost.panel.inputCacheMiss'))}
            {priceRow('output', t('sessionCost.panel.output'))}
          </>
        )}
      </div>
    </Modal>
  )
}
