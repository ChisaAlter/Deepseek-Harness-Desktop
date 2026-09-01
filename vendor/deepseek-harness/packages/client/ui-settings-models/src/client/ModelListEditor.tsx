/**
 * The model list of one pi-ai provider profile, plus the action that asks the
 * provider what it serves.
 *
 * The list is the profile's `models` array as the card holds it: an empty list
 * means "serve this route's built-in catalog", and any entry replaces that
 * catalog, so a row is only ever added deliberately. Fetching asks the endpoint
 * **the form currently shows** — including a key typed but not yet saved — so
 * adding a provider is one pass instead of save-then-return; the reply is
 * candidates the user picks from, never configuration written behind them.
 *
 * A provider that cannot be interrogated (an unreachable endpoint, a protocol
 * with no readable listing) is not a dead end: the failure is shown next to the
 * rows the user can still fill in by hand.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatCapacity, parseCapacity } from './DeepSeekModelsEditor.tsx'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import {
  enrichDiscoveredModelsBestEffort,
  type EnrichedDiscoveredModel,
} from './models-dev-metadata.ts'
import { discoveredModelsOf, type ModelsOperations } from './operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One configured model row. Fields this card does not edit must survive an
 * edit rather than being dropped by a rebuild.
 */
export type ModelDraft = DeepSeekModelDraft

/** A row's text field, or the empty string when unset or not a string. */
function textOf(model: ModelDraft, key: string): string {
  const value = model[key]
  return typeof value === 'string' ? value : ''
}

/** A row's numeric field, or `undefined` when unset or not a number. */
function numberOf(model: ModelDraft, key: string): number | undefined {
  const value = model[key]
  return typeof value === 'number' ? value : undefined
}

/** What an interrogation needs, taken from the live form. */
export interface ProbeTarget {
  /** Settings namespace whose adapter family answers. */
  settingsNs: string
  /**
   * Route being edited, when the card edits one. An adapter that already
   * describes it answers from its own registry, so such a card can ask without
   * an endpoint at all.
   */
  provider?: string
  /** Endpoint as the form currently shows it. */
  baseURL?: string
  /** Wire protocol the form names, when it names one. */
  api?: string
  /** Key typed into the form and not yet stored, when there is one. */
  apiKey?: string
}

/** Props of {@link ModelListEditor}. */
export interface ModelListEditorProps {
  /** The rows as currently drafted. */
  models: readonly ModelDraft[]
  /** Whether the user layer currently owns the whole array; absent on a create. */
  overridden?: boolean
  /** Replace the drafted rows. */
  onChange: (models: ModelDraft[]) => void
  /** Remove the user-owned array and return to inheritance; absent on a create. */
  onReset?: () => void
  /** Endpoint facts for the fetch action. */
  probe: ProbeTarget
  /**
   * Copy key naming why the fetch action is unavailable, or `undefined` when
   * it is. The card owns this because the key it would send is judged there:
   * asking with a key the form has already refused spends a round trip to be
   * told what the field already says.
   */
  probeBlocked?: keyof typeof en | undefined
  /** The Host operations whose interrogation answers the fetch action. */
  operations: ModelsOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every control (read-only deployment or a pending write). */
  disabled: boolean
}

/** Removal glyph for one model row. */
function IconTrash(): ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

/** The two token counts edited as K/M-suffixed text behind a row's disclosure. */
type CapacityField = 'contextWindow' | 'maxTokens'

/**
 * Thinking levels this form can declare, in pi-ai's escalation order. Ids are
 * canonical keys. A checked level other than `off` writes that same string as
 * the wire spelling (`high: high`). `off` is the one valueless key: checking
 * it writes `off: null` (offer Off, send nothing). A custom wire rename stays
 * YAML-only.
 */
const EFFORT_CHOICES = [
  { id: 'off', key: 'effort.off' },
  { id: 'minimal', key: 'effort.minimal' },
  { id: 'low', key: 'effort.low' },
  { id: 'medium', key: 'effort.medium' },
  { id: 'high', key: 'effort.high' },
  { id: 'xhigh', key: 'effort.xhigh' },
  { id: 'max', key: 'effort.max' },
] as const satisfies readonly { id: string; key: keyof typeof en }[]

type EffortId = (typeof EFFORT_CHOICES)[number]['id']

/** One model's `reasoningEfforts` dict, or empty when the field is absent / false. */
function effortsOf(model: ModelDraft): Record<string, string | null> {
  const value = model['reasoningEfforts']
  if (value === false || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return { ...(value as Record<string, string | null>) }
}

/**
 * Input types this form can declare, in the canonical pi-ai order (text
 * first). The wire spelling is the same string (`text: text`); audio and
 * other modalities wait for pi-ai upstream support.
 */
const INPUT_CHOICES = [
  { id: 'text', key: 'inputText' },
  { id: 'image', key: 'inputImage' },
] as const satisfies readonly { id: string; key: keyof typeof en }[]

type InputId = (typeof INPUT_CHOICES)[number]['id']

/** One model's declared input types, or `undefined` when it declares none. */
function inputOf(model: ModelDraft): readonly InputId[] | undefined {
  const value = model['input']
  if (!Array.isArray(value)) return undefined
  const declared = value.filter((id): id is InputId => id === 'text' || id === 'image')
  return declared.length === 0 ? undefined : declared
}

/** Reorder a declared set into the canonical choice order. */
function orderedInput(selected: readonly InputId[]): InputId[] {
  return INPUT_CHOICES.filter(choice => selected.includes(choice.id)).map(choice => choice.id)
}

/**
 * What an empty capacity field is worth, shown as its placeholder so a row left
 * blank does not read as a model with no capacity at all.
 *
 * The magnitudes are the adapter's own route-level fallbacks (`llm-pi-ai`'s
 * `defaultContextWindow` and `defaultMaxTokens`), spelled the way a person
 * would say them. They are a hint, not a mirror: this page counts `K` as 1000,
 * so typing `256K` stores 256000 while leaving the field blank keeps the
 * adapter's 262144. A deployment that overrides those defaults is not
 * reflected here — nothing on this page can read them.
 */
const CAPACITY_HINT: Readonly<Record<CapacityField, string>> = {
  contextWindow: '256K',
  maxTokens: '32K',
}

/**
 * Spell a stored count for a field that may be unset. The spelling itself is
 * {@link formatCapacity}, shared with the DeepSeek catalog editor so both
 * surfaces read and write one K/M vocabulary.
 * @param value - stored capacity, or `undefined` for an unset field.
 * @returns the field text, empty when unset.
 */
function capacitySpelling(value: number | undefined): string {
  return value === undefined ? '' : formatCapacity(value)
}

/**
 * Adopt a candidate, keeping disclosed capacities plus any models.dev fills
 * (missing context/maxTokens and declared reasoning efforts).
 */
function adopt(candidate: EnrichedDiscoveredModel): ModelDraft {
  return {
    id: candidate.id,
    ...candidate.name === undefined ? {} : { name: candidate.name },
    ...candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow },
    ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
    ...candidate.reasoningEfforts === undefined ? {} : { reasoningEfforts: candidate.reasoningEfforts },
  }
}

/**
 * Render the model list with its fetch action.
 * @param props - the drafted rows, probe target, wire face, and copy.
 * @returns the model-list editor.
 */
export function ModelListEditor(props: ModelListEditorProps): ReactNode {
  const { models, onChange, probe, operations, t, disabled } = props
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [candidates, setCandidates] = useState<readonly EnrichedDiscoveredModel[] | undefined>(undefined)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  // Capacities are edited as text, so a field's keystrokes are held here rather
  // than re-derived from the parsed count on every change — that would rewrite
  // `1000` to `1K` mid-word. Unreadable text is kept past blur so the refusal
  // names a row the user can still see, which is why this is one entry PER
  // FIELD: a single buffer would be displaced by editing any other field, and
  // the abandoned one would render its stored NaN as the literal `NaN`.
  const [editing, setEditing] = useState<ReadonlyMap<string, string>>(new Map())

  /** Buffer key for one capacity field; the row half moves when rows do. */
  const bufferKey = (index: number, field: CapacityField): string => `${String(index)}:${field}`

  const editCapacity = (index: number, field: CapacityField, text: string): void => {
    setEditing(current => new Map(current).set(bufferKey(index, field), text))
    patch(index, { [field]: parseCapacity(text) })
  }

  /** What a capacity field shows: the buffer while typing, else the stored count. */
  const capacityText = (model: ModelDraft, index: number, field: CapacityField): string =>
    editing.get(bufferKey(index, field)) ?? capacitySpelling(numberOf(model, field))

  /** Drop one row's entries and shift the rows after it down, in one pass. */
  const reindexOnRemove = (
    current: ReadonlyMap<string, string>,
    index: number,
  ): Map<string, string> => {
    const next = new Map<string, string>()
    for (const [key, value] of current) {
      const at = Number(key.slice(0, key.indexOf(':')))
      if (at === index) continue
      // Only the row number moves; the field half of the key is untouched.
      next.set(at > index ? key.replace(/^\d+/, String(at - 1)) : key, value)
    }
    return next
  }

  const patch = (index: number, next: Record<string, unknown>): void => {
    onChange(models.map((model, at) => {
      if (at !== index) return model
      // Rebuilt rather than spread over: an emptied optional field has to leave
      // the profile, not be stored as a value its schema would reject.
      // Spread first so a field this card does not edit survives; an emptied
      // optional field is then dropped rather than stored as a value its
      // schema would reject.
      const cleared = new Set(
        Object.entries(next).filter(([, value]) => value === undefined || value === '').map(([key]) => key),
      )
      return Object.fromEntries(
        Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key)),
      )
    }))
  }

  const toggleEffort = (index: number, model: ModelDraft, id: EffortId): void => {
    const dict = effortsOf(model)
    if (Object.prototype.hasOwnProperty.call(dict, id)) delete dict[id]
    else dict[id] = id === 'off' ? null : id
    const stillOffers = EFFORT_CHOICES.some(choice => Object.prototype.hasOwnProperty.call(dict, choice.id))
    patch(index, { reasoningEfforts: stillOffers ? dict : undefined })
  }

  /** Toggle one declared input type; an empty set removes the field (inherit). */
  const toggleInput = (index: number, model: ModelDraft, id: InputId): void => {
    const current = inputOf(model) ?? []
    const next = current.includes(id) ? current.filter(existing => existing !== id) : [...current, id]
    patch(index, { input: next.length === 0 ? undefined : orderedInput(next) })
  }

  const fetchModels = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const answer = await operations.discoverModels(probe.settingsNs, {
        ...probe.provider === undefined ? {} : { provider: probe.provider },
        ...probe.baseURL === undefined || probe.baseURL.length === 0 ? {} : { baseURL: probe.baseURL },
        ...probe.api === undefined ? {} : { api: probe.api },
        ...probe.apiKey === undefined ? {} : { apiKey: probe.apiKey },
      })
      if (answer.kind === 'refused') {
        setFailure(answer.message)
        return
      }
      const found = discoveredModelsOf(answer.models)
      if (found.length === 0) {
        setFailure(t('fetchEmpty'))
        return
      }
      // Fill missing capacities and thinking levels from models.dev when a
      // record matches; a failed or unmatched catalog leaves rows as discovered.
      const enriched = await enrichDiscoveredModelsBestEffort(found)
      // Everything already configured starts unchecked, so adopting a
      // selection never silently rewrites a capacity the user corrected.
      const known = new Set(models.map(model => textOf(model, 'id')))
      setCandidates(enriched)
      setPicked(new Set(enriched.filter(model => !known.has(model.id)).map(model => model.id)))
    } catch (error) {
      // The transport rejected rather than answering; without this the button
      // would stay busy with nothing shown.
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const closePicker = (): void => {
    setCandidates(undefined)
    setPicked(new Set())
  }

  const adoptPicked = (): void => {
    /* v8 ignore next -- the dialog only renders with candidates loaded */
    if (candidates === undefined) return
    const byId = new Map(models.map(model => [textOf(model, 'id'), model]))
    for (const candidate of candidates) {
      if (!picked.has(candidate.id)) continue
      // A row the user already tuned wins over the provider's own numbers.
      // Keyed by id, so a half-typed row whose id is still empty is not a
      // match and the candidate joins as its own row — correct, since a row
      // without an id is not yet a model and the create/apply gates refuse it.
      byId.set(candidate.id, byId.get(candidate.id) ?? adopt(candidate))
    }
    onChange([...byId.values()])
    closePicker()
  }

  const toggle = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const activeCandidates = Array.isArray(candidates) ? candidates : []
  const allCandidatesPicked = activeCandidates.length > 0
    && activeCandidates.every(candidate => picked.has(candidate.id))

  const toggleAllCandidates = (): void => {
    setPicked((current) => {
      return activeCandidates.every(candidate => current.has(candidate.id))
        ? new Set()
        : new Set(activeCandidates.map(candidate => candidate.id))
    })
  }

  // A route the adapter already describes answers without an endpoint; only a
  // draft with neither has nothing to ask about.
  const askable = probe.provider !== undefined || (probe.baseURL !== undefined && probe.baseURL.length > 0)
  return (
    <section className={styles['modelCatalog']} aria-label={t('models')}>
      <div className={styles['modelListHead']}>
        <div className={styles['modelCatalogHeading']}>
          <span className={styles['modelCatalogTitle']}>{t('models')}</span>
          {props.overridden === undefined
            ? null
            : (
              <span className={styles['modelCatalogMeta']}>
                {props.overridden ? t('modelsCustomized') : t('modelsInherited')}
              </span>
            )}
        </div>
        {props.overridden === true && props.onReset !== undefined
          ? (
            <button
              type="button"
              className={styles['linkButton']}
              disabled={disabled}
              onClick={props.onReset}
            >
              {t('resetModels')}
            </button>
          )
          : null}
        <button
          type="button"
          className={styles['linkButton']}
          disabled={disabled || busy || !askable || props.probeBlocked !== undefined}
          title={props.probeBlocked !== undefined
            ? t(props.probeBlocked)
            : askable ? undefined : t('fetchNeedsBaseUrl')}
          onClick={() => { void fetchModels() }}
        >
          {busy ? t('fetching') : t('fetchModels')}
        </button>
      </div>
      {models.length === 0 ? <p className={styles['modelEmpty']}>{t('modelsEmpty')}</p> : null}
      {models.map((model, index) => (
        <div key={index} className={styles['modelEntry']}>
          <div className={styles['modelRow']}>
            <input
              className={styles['input']}
              type="text"
              value={textOf(model, 'id')}
              placeholder={t('modelId')}
              aria-label={`${t('modelId')} ${index + 1}`}
              disabled={disabled}
              onChange={(event) => { patch(index, { id: event.target.value }) }}
            />
            <input
              className={styles['input']}
              type="text"
              value={textOf(model, 'name')}
              placeholder={t('modelName')}
              aria-label={`${t('modelName')} ${index + 1}`}
              disabled={disabled}
              onChange={(event) => { patch(index, { name: event.target.value === '' ? undefined : event.target.value }) }}
            />
            <button
              type="button"
              className={`${styles['iconButton']} ${styles['iconButtonDanger']}`}
              aria-label={`${t('removeModel')} ${index + 1}`}
              title={t('removeModel')}
              disabled={disabled}
              onClick={() => {
                onChange(models.filter((_model, at) => at !== index))
                // Capacity edit buffers are keyed by position, so every row
                // after this one shifts down and would otherwise inherit its
                // neighbour's half-typed text.
                setEditing(current => reindexOnRemove(current, index))
              }}
            >
              <IconTrash />
            </button>
          </div>
          <fieldset className={styles['effortGroup']}>
            <legend className={styles['modelFieldLabel']}>{t('effortTitle')}</legend>
            <div className={styles['effortOptions']}>
              {EFFORT_CHOICES.map((choice) => {
                const checked = Object.prototype.hasOwnProperty.call(effortsOf(model), choice.id)
                return (
                  <label className={styles['effortOption']} key={choice.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      aria-label={`${t(choice.key)} ${index + 1}`}
                      onChange={() => { toggleEffort(index, model, choice.id) }}
                    />
                    <span>{t(choice.key)}</span>
                  </label>
                )
              })}
            </div>
          </fieldset>
          <fieldset className={`${styles['effortGroup']} ${styles['inputGroup']}`}>
            <legend className={styles['modelFieldLabel']}>{t('inputTitle')}</legend>
            <div className={styles['inputGroupBody']}>
              <div className={styles['inputOptions']}>
                {INPUT_CHOICES.map((choice) => {
                  const checked = (inputOf(model) ?? []).includes(choice.id)
                  return (
                    <label className={styles['effortOption']} key={choice.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        aria-label={`${t(choice.key)} ${index + 1}`}
                        onChange={() => { toggleInput(index, model, choice.id) }}
                      />
                      <span>{t(choice.key)}</span>
                    </label>
                  )
                })}
              </div>
              {inputOf(model) === undefined
                ? <p className={styles['inputHint']}>{t('inputInherited')}</p>
                : null}
            </div>
          </fieldset>
          <div className={styles['modelAdvanced']}>
            <label className={styles['modelField']}>
              <span className={styles['modelFieldLabel']}>{t('modelContextWindow')}</span>
              <input
                className={styles['input']}
                type="text"
                inputMode="numeric"
                value={capacityText(model, index, 'contextWindow')}
                placeholder={CAPACITY_HINT.contextWindow}
                aria-label={`${t('modelContextWindow')} ${index + 1}`}
                disabled={disabled}
                onChange={(event) => { editCapacity(index, 'contextWindow', event.target.value) }}
              />
            </label>
            <label className={styles['modelField']}>
              <span className={styles['modelFieldLabel']}>{t('modelMaxTokens')}</span>
              <input
                className={styles['input']}
                type="text"
                inputMode="numeric"
                value={capacityText(model, index, 'maxTokens')}
                placeholder={CAPACITY_HINT.maxTokens}
                aria-label={`${t('modelMaxTokens')} ${index + 1}`}
                disabled={disabled}
                onChange={(event) => { editCapacity(index, 'maxTokens', event.target.value) }}
              />
            </label>
          </div>
        </div>
      ))}
      <button
        type="button"
        className={styles['addModelButton']}
        disabled={disabled}
        onClick={() => { onChange([...models, { id: '' }]) }}
      >
        {t('addModel')}
      </button>
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      <Modal
        open={candidates !== undefined}
        onClose={closePicker}
        title={t('fetchTitle')}
        closeLabel={t('close')}
        description={t('fetchDescription')}
        className={styles['fetchDialog'] as string}
        footer={(
          <>
            <Button variant="outline" onClick={closePicker}>{t('cancel')}</Button>
            <Button variant="outline" onClick={adoptPicked}>{t('fetchAdopt')}</Button>
          </>
        )}
      >
        <div className={styles['candidateActions']}>
          <Button variant="ghost" size="sm" onClick={toggleAllCandidates}>
            {t(allCandidatesPicked ? 'fetchDeselectAll' : 'fetchSelectAll')}
          </Button>
        </div>
        <ul className={styles['candidateList']}>
          {activeCandidates.map(candidate => (
            <li key={candidate.id} className={styles['candidate']}>
              <label className={styles['candidateLabel']}>
                <input
                  type="checkbox"
                  checked={picked.has(candidate.id)}
                  onChange={() => { toggle(candidate.id) }}
                />
                {/* The id alone: it is the string adoption writes, and the
                    capacities the endpoint reported are adopted with it and
                    editable in the row that appears. */}
                <span className={styles['candidateId']}>{candidate.id}</span>
              </label>
            </li>
          ))}
        </ul>
      </Modal>
    </section>
  )
}
