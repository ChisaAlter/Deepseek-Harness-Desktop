// @vitest-environment jsdom
// Session-cost half of the PeakValleyRow: trigger matrix (independent switch
// x DeepSeek route), same-line layout, the phase tooltip, the price-settings
// entry, and live repricing when the projection or the price record moves.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { BilledUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { PeakValleyRow, type PeakValleyRowProps } from '../src/client/chat/PeakValleyRow.tsx'
import type { ComposerModelFact } from '../src/client/input/model-facts.ts'
import type { SessionCostPrices } from '../src/submission-settings.ts'
import { en } from '../src/client/locales.ts'

// Mirrors the real lookup chain (conversation namespace, then common).
const tEn = makeTranslate(en, commonEn)

const ZERO_USAGE: BilledUsageProjection = {
  peak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
  offPeak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
}

type ChatSlice = { legacy: { nodes: readonly { kind: string; provenance?: { provider: string; model: string } }[] } }

/** Minimal chat-snapshot stub whose legacy nodes the row reads. */
function snapshotWithNodes(nodes: ChatSlice['legacy']['nodes']): ChatSlice {
  return { legacy: { nodes } }
}

/** One settled assistant node carrying durable provenance. */
function assistantNode(model: string | undefined): ChatSlice['legacy']['nodes'][number] {
  return {
    kind: 'assistant',
    ...(model === undefined ? {} : { provenance: { provider: 'deepseek-official', model } }),
  }
}

function bindProjection(
  store: SnapshotStore<BilledUsageProjection | undefined>,
): UseProjection {
  // The renderer binds projection faces through useSyncExternalStore; the stub
  // mirrors that so store writes re-render the row under test.
  const subscribe = (onStoreChange: () => void) => store.subscribe(onStoreChange)
  return ((key: string) => {
    if (key !== 'billedUsage') return undefined
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- stable per mount, called unconditionally by the row
    return useSyncExternalStore(subscribe, () => store.getSnapshot())
  }) as UseProjection
}

function mount(opts: {
  peakValley?: boolean
  provider?: string | null
  model?: string | null
  sessionCost?: boolean
  prices?: SessionCostPrices
  usage?: BilledUsageProjection | undefined
  catalog?: readonly { provider: string; id: string }[]
  projection?: UseProjection
  t?: PeakValleyRowProps['t']
} = {}) {
  const peakStore = createSnapshotStore(opts.peakValley ?? false)
  const factStore = createSnapshotStore<ComposerModelFact>({ provider: opts.provider ?? null })
  const nodesStore = createSnapshotStore(
    snapshotWithNodes(opts.model === undefined || opts.model === null ? [] : [assistantNode(opts.model)]),
  )
  const costStore = createSnapshotStore(opts.sessionCost ?? false)
  const pricesStore = createSnapshotStore<SessionCostPrices>(opts.prices ?? {})
  const usageStore = createSnapshotStore<BilledUsageProjection | undefined>(opts.usage ?? ZERO_USAGE)
  const catalogStore = createSnapshotStore<readonly { provider: string; id: string }[]>(opts.catalog ?? [])
  const setCostPrices = vi.fn()
  const projection = opts.projection ?? bindProjection(usageStore)
  const view = render(<PeakValleyRow
    usePeakValley={bindSnapshotSelector(peakStore)}
    useModelProvider={bindSnapshotSelector(factStore)}
    useModelCatalog={bindSnapshotSelector(catalogStore)}
    useChat={bindSnapshotSelector(nodesStore)}
    useSessionCost={bindSnapshotSelector(costStore)}
    useCostPrices={bindSnapshotSelector(pricesStore)}
    setCostPrices={setCostPrices}
    useProjection={projection}
    t={opts.t ?? tEn}
  />)
  return {
    view,
    setCostPrices,
    setPeakValley: (value: boolean) => act(() => { peakStore.set(value) }),
    setProvider: (provider: string | null) => act(() => { factStore.set({ provider }) }),
    setSessionCost: (value: boolean) => act(() => { costStore.set(value) }),
    setPrices: (value: SessionCostPrices) => act(() => { pricesStore.set(value) }),
    setUsage: (value: BilledUsageProjection | undefined) => act(() => { usageStore.set(value) }),
    setCatalog: (value: readonly { provider: string; id: string }[]) => act(() => { catalogStore.set(value) }),
  }
}

const rowOf = (view: ReturnType<typeof mount>): HTMLElement | null =>
  view.view.container.querySelector('[data-phase]')

function openModelMenu() {
  if (screen.queryByRole('menu') === null) {
    fireEvent.click(screen.getByRole('button', { name: 'Model' }))
  }
}

function modelLabels() {
  openModelMenu()
  return screen.getAllByRole('menuitem').map(item => item.textContent ?? '')
}

function pickModel(id: string) {
  openModelMenu()
  const item = screen.getAllByRole('menuitem').find(el =>
    el.textContent === id || (el.textContent?.startsWith(`${id} ·`) ?? false))
  if (item === undefined) throw new Error(`missing model ${id}`)
  fireEvent.click(item)
}

beforeEach(() => {
  vi.useFakeTimers()
  // Beijing Monday 2026-03-02 10:00 — peak, so the phase half is stable.
  vi.setSystemTime(new Date(Date.UTC(2026, 2, 2, 2, 0, 0, 0)))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('session cost trigger matrix', () => {
  it('paints no cost while the session-cost switch is off, even on a DeepSeek route', () => {
    const view = mount({ provider: 'deepseek-official' })
    expect(rowOf(view)).not.toBeNull()
    expect(screen.queryByText('Session cost: ¥0.00')).toBeNull()
  })

  it('shows the set-price reminder for an unnamed model on a non-DeepSeek route', () => {
    // No settled node yet, but the switch is on and the projection is live:
    // the row names the missing price instead of hiding or showing a figure.
    mount({
      provider: 'anthropic-relay',
      sessionCost: true,
      usage: {
        peak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
        offPeak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
      },
    })
    expect(screen.getByText('No price set for the current model')).toBeTruthy()
    expect(screen.queryByText(/Session cost:/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Prices' })).toBeTruthy()
  })

  it('shows the cost for a user-priced model even on a non-DeepSeek route', () => {
    // The user priced this relay model, so the figure is meaningful without a
    // DeepSeek route; the phase half stays hidden (no route, preference off)
    // and the row paints the cost alone. The hover title lists the model's
    // peak prices (no idle line for a non-official model).
    mount({
      provider: 'anthropic-relay',
      model: 'my-relay',
      sessionCost: true,
      prices: { 'my-relay': { inputCacheHit: 0, inputCacheMiss: 1, output: 0 } },
      usage: {
        peak: { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 },
        offPeak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
      },
    })
    expect(screen.getByText('Session cost: ¥1.00')).toBeTruthy()
    expect(screen.queryByText('Peak hours')).toBeNull()
    const costSpan = screen.getByText('Session cost: ¥1.00')
    expect(costSpan.getAttribute('title')).toBe('Price: hit 0 / miss 1 / output 0 (CNY per million tokens)')
  })

  it('names an unpriced default-column model and its hover title says no price is set', () => {
    // DeepSeek route, but the session model is not in the official table and
    // has no user price: the segment reminds instead of showing a guessed
    // figure, and the hover title says no price is set.
    mount({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      sessionCost: true,
      usage: {
        peak: { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 },
        offPeak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
      },
    })
    const reminder = screen.getByText('No price set for the current model')
    expect(screen.queryByText(/Session cost:/)).toBeNull()
    expect(reminder.getAttribute('title')).toBe('No price set')
    // The entry point stays beside the reminder.
    expect(screen.getByRole('button', { name: 'Prices' })).toBeTruthy()
  })

  it('lists both periods in the hover title for an official model', () => {
    mount({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      sessionCost: true,
      usage: {
        peak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
        offPeak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
      },
    })
    const costSpan = screen.getByText('Session cost: ¥0.00')
    expect(costSpan.getAttribute('title')).toBe(
      'Peak: hit 0.3 / miss 9 / output 27 (CNY per million tokens)\n'
      + 'Off-peak: hit 0.15 / miss 4.5 / output 13.5 (CNY per million tokens)',
    )
  })

  it('merges directory models into the price panel dropdown', () => {
    mount({
      provider: 'deepseek',
      sessionCost: true,
      catalog: [
        { provider: 'deepseek', id: 'deepseek-chat' },
        { provider: 'deepseek', id: 'deepseek-v4-chat' },
        { provider: 'my-relay', id: 'gpt-x' },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Prices' }))
    const options = modelLabels()
    expect(options).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-v4-flash-vision-exp',
      'deepseek/deepseek-chat',
      'deepseek/deepseek-v4-chat',
      'my-relay/gpt-x',
    ])
    // Every advertised model that is not an official column shows its provider
    // id as a prefix; the official columns stay un-prefixed.
    expect(options).toContain('deepseek/deepseek-chat')
    expect(options).toContain('deepseek/deepseek-v4-chat')
    expect(options).toContain('my-relay/gpt-x')
    expect(options).toContain('deepseek-v4-flash')
  })

  it('opens the custom entry for a session model that shares an official column id', () => {
    mount({
      provider: 'my-gateway',
      model: 'deepseek-v4-flash',
      sessionCost: true,
      catalog: [
        { provider: 'deepseek-official', id: 'deepseek-v4-flash' },
        { provider: 'my-gateway', id: 'deepseek-v4-flash' },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Prices' }))
    const options = modelLabels()
    // The official read-only column stays listed next to the custom entry.
    expect(options).toContain('deepseek-v4-flash')
    const customValue = 'my-gateway/deepseek-v4-flash'
    expect(options).toContain(customValue)
    // The session's model is served by the custom route, so its entry opens
    // ready to price instead of the locked official column.
    expect(screen.getByRole('button', { name: 'Model' }).textContent).toContain(customValue)
    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs.every(input => !input.hasAttribute('disabled'))).toBe(true)
  })

  it('offers the peak/valley switch to a non-official deepseek-v4 model and persists both periods', () => {
    const view = mount({
      provider: 'deepseek',
      sessionCost: true,
      catalog: [{ provider: 'deepseek', id: 'deepseek-v4-chat' }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Prices' }))
    pickModel('deepseek/deepseek-v4-chat')
    // No idle inputs until the switch turns on.
    expect(screen.getAllByRole('spinbutton')).toHaveLength(3)
    fireEvent.click(screen.getByRole('switch', { name: 'Peak/valley prices' }))
    expect(screen.getAllByRole('spinbutton')).toHaveLength(6)
    const inputs = screen.getAllByRole('spinbutton')
    const values = ['1', '2', '3', '0.5', '1', '1.5']
    inputs.forEach((input, index) => { fireEvent.change(input, { target: { value: values[index]! } }) })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(view.setCostPrices).toHaveBeenCalledWith({
      'deepseek/deepseek-v4-chat': {
        inputCacheHit: 1,
        inputCacheMiss: 2,
        output: 3,
        idle: { inputCacheHit: 0.5, inputCacheMiss: 1, output: 1.5 },
      },
    })
  })

  it('clears the selected model price with the clear button', () => {
    const view = mount({
      provider: 'deepseek',
      sessionCost: true,
      catalog: [{ provider: 'deepseek', id: 'deepseek-v4-chat' }],
      prices: { 'deepseek-v4-chat': { inputCacheHit: 1, inputCacheMiss: 2, output: 3 } },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Prices' }))
    pickModel('deepseek/deepseek-v4-chat')
    // The clear button sits beside the model dropdown for a priced model.
    fireEvent.click(screen.getByRole('button', { name: 'Clear price' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(view.setCostPrices).toHaveBeenCalledWith({})
  })

  it('paints the cost when the switch is on and a DeepSeek route is detected', () => {
    mount({ provider: 'deepseek', model: 'deepseek-v4-flash', sessionCost: true })
    expect(screen.getByText('Session cost: ¥0.00')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Prices' })).toBeTruthy()
  })

  it('keeps the cost visible with the phase switch off, in neutral period colors', () => {
    const view = mount({ provider: 'deepseek-official', sessionCost: true })
    const row = rowOf(view)
    expect(row).not.toBeNull()
    // Peak phase is present for the schedule readout, but the preference is
    // off, so no phase coloring is requested.
    expect(row?.getAttribute('data-phase')).toBe('peak')
    expect(row?.hasAttribute('data-phase-color')).toBe(false)
  })

  it('colors the period only while the peak/valley preference is on', () => {
    const view = mount({ provider: 'deepseek-official', sessionCost: true, peakValley: true })
    expect(rowOf(view)?.hasAttribute('data-phase-color')).toBe(true)
  })

  it('keeps the phase half alive when only the cost switch turns off, and drops the row when both triggers disappear', () => {
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionCost: true })
    view.setSessionCost(false)
    // The DeepSeek route alone still carries the phase half.
    expect(rowOf(view)).not.toBeNull()
    expect(screen.queryByText(/Session cost:/)).toBeNull()
    view.setProvider(null)
    // No route and the cost switch is off: nothing paints.
    expect(rowOf(view)).toBeNull()
    view.setSessionCost(true)
    // The named model alone revives the row with its figure.
    expect(rowOf(view)).not.toBeNull()
    expect(screen.getByText('Session cost: ¥0.00')).toBeTruthy()
  })

  it('paints no cost without the projection seat even when the switch is on', () => {
    const view = mount({ provider: 'deepseek', sessionCost: true, projection: (() => undefined) as UseProjection })
    // An absent billedUsage key means the host unit is not composed; a
    // fabricated ¥0.00 would be worse than no figure.
    expect(rowOf(view)).not.toBeNull()
    expect(screen.queryByText(/Session cost:/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Prices' })).toBeNull()
  })
})

describe('session cost figure and same-line layout', () => {
  it('shows the phase text and the cost on the same row element', () => {
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionCost: true, peakValley: true })
    const row = rowOf(view)!
    expect(row.textContent).toContain('Peak hours')
    expect(row.textContent).toContain('Switches in')
    expect(row.textContent).toContain('Session cost:')
    // Same line: the cost span is a child of the row div, not a sibling block.
    expect(row.querySelector('[class*="cost"]')).not.toBeNull()
  })

  it('prices the projected usage with the session model column', () => {
    mount({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      sessionCost: true,
      usage: {
        peak: { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 },
        offPeak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
      },
    })
    // v4-pro miss input at 9.0 CNY/M peak = 9.00 CNY.
    expect(screen.getByText('Session cost: ¥9.00')).toBeTruthy()
  })

  it('derives the price column from the newest settled assistant node only', () => {
    // A stale earlier node must not win the walk-back.
    const nodes = [assistantNode('deepseek-v4-flash'), assistantNode('deepseek-v4-pro')]
    const store = createSnapshotStore(snapshotWithNodes(nodes))
    const factStore = createSnapshotStore<ComposerModelFact>({ provider: 'deepseek-official' })
    const peakStore = createSnapshotStore(true)
    const usageStore = createSnapshotStore<BilledUsageProjection | undefined>({
      peak: { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 },
      offPeak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
    })
    render(<PeakValleyRow
      usePeakValley={bindSnapshotSelector(peakStore)}
      useModelProvider={bindSnapshotSelector(factStore)}
      useChat={bindSnapshotSelector(store)}
      useSessionCost={bindSnapshotSelector(createSnapshotStore(true))}
      useProjection={bindProjection(usageStore)}
      t={tEn}
    />)
    expect(screen.getByText('Session cost: ¥9.00')).toBeTruthy()
  })

  it('reprices live when the usage projection moves (incremental host fold)', () => {
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-flash', sessionCost: true })
    expect(screen.getByText('Session cost: ¥0.00')).toBeTruthy()
    view.setUsage({
      peak: { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 },
      offPeak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
    })
    expect(screen.getByText('Session cost: ¥3.00')).toBeTruthy()
  })

  it('reprices live when a custom price is saved', () => {
    const view = mount({
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      sessionCost: true,
      usage: {
        peak: { missInputTokens: 1_000_000, cacheReadTokens: 0, outputTokens: 0 },
        offPeak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
      },
    })
    expect(screen.getByText('Session cost: ¥3.00')).toBeTruthy()
    view.setPrices({ 'deepseek-v4-flash': { inputCacheHit: 0.1, inputCacheMiss: 1, output: 9 } })
    expect(screen.getByText('Session cost: ¥1.00')).toBeTruthy()
  })
})

describe('phase tooltip', () => {
  it('shows a hover bubble carrying the same phase and countdown text', () => {
    const view = mount({ provider: 'deepseek-official', sessionCost: true, peakValley: true })
    const phaseGroup = view.view.container.querySelector('[class*="phaseGroup"]')!
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.mouseEnter(phaseGroup)
    act(() => { vi.advanceTimersByTime(400) })
    const bubble = screen.getByRole('tooltip')
    expect(bubble.textContent).toContain('Peak hours')
    expect(bubble.textContent).toContain('Switches in 02:00:00')
    fireEvent.mouseLeave(phaseGroup)
    act(() => { vi.advanceTimersByTime(50) })
    // Presence-backed exit: the bubble stays mounted and reads aria-hidden
    // (getByRole skips aria-hidden nodes, so query the DOM directly).
    const exited = document.querySelector('[role="tooltip"]')
    expect(exited).not.toBeNull()
    expect(exited!.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('price-settings entry', () => {
  it('shows official DeepSeek columns read-only with their idle figure, and never persists them', () => {
    const view = mount({ provider: 'deepseek-official', model: 'deepseek-v4-pro', sessionCost: true })
    fireEvent.click(screen.getByRole('button', { name: 'Prices' }))
    const dialog = screen.getByRole('dialog', { name: 'Price settings' })
    expect(dialog).toBeTruthy()
    // The current session model is selected; its peak prices display in the
    // disabled inputs and the idle figure sits beside them.
    expect(screen.getByRole('button', { name: 'Model' }).textContent).toContain('deepseek-v4-pro')
    const inputs = screen.queryAllByRole('spinbutton')
    expect(inputs).toHaveLength(3)
    expect(inputs.every(input => input.hasAttribute('disabled'))).toBe(true)
    expect((inputs[0] as HTMLInputElement).value).toBe('0.3')
    expect(screen.getAllByText('Off-peak: 0.15')).toHaveLength(1)
    // Saving an untouched official view persists nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(view.setCostPrices).toHaveBeenCalledWith({})
  })

  it('edits a directory model freely with no idle hint and persists the record', () => {
    const view = mount({
      provider: 'deepseek-official',
      sessionCost: true,
      catalog: [{ provider: 'my-relay', id: 'my-relay' }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Prices' }))
    pickModel('my-relay/my-relay')
    const inputs = screen.queryAllByRole('spinbutton')
    expect(inputs.every(input => input.hasAttribute('disabled'))).toBe(false)
    // No idle hint exists for a model without an official column.
    expect(screen.queryByText(/Off-peak:/)).toBeNull()
    fireEvent.change(inputs[0]!, { target: { value: '2' } })
    fireEvent.change(inputs[1]!, { target: { value: '5' } })
    fireEvent.change(inputs[2]!, { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(view.setCostPrices).toHaveBeenCalledWith({
      'my-relay/my-relay': { inputCacheHit: 2, inputCacheMiss: 5, output: 15 },
    })
  })

  it('blocks saving a non-positive draft and reports the reason', () => {
    const view = mount({ provider: 'deepseek-official', sessionCost: true, catalog: [{ provider: 'my-relay', id: 'my-relay' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Prices' }))
    pickModel('my-relay/my-relay')
    const inputs = screen.queryAllByRole('spinbutton')
    fireEvent.change(inputs[1]!, { target: { value: '0' } })
    expect(screen.getByRole('alert').textContent).toBe('Prices must be positive numbers')
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true)
    // The modal chrome's own close button shares the Cancel name; the footer
    // one is the last in document order.
    const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelButtons.at(-1)!)
    expect(view.setCostPrices).not.toHaveBeenCalled()
  })

  it('drops legacy official-model overrides from the record on save', () => {
    const view = mount({
      provider: 'deepseek-official',
      sessionCost: true,
      catalog: [{ provider: 'my-relay', id: 'my-relay' }],
      prices: { 'deepseek-v4-pro': { inputCacheHit: 2, inputCacheMiss: 9, output: 27 } },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Prices' }))
    // The legacy override still lists as a custom-marked row...
    expect(modelLabels().some(label => label.startsWith('deepseek-v4-pro'))).toBe(true)
    // ...but editing the directory model and saving persists only that model.
    pickModel('my-relay/my-relay')
    const inputs = screen.queryAllByRole('spinbutton')
    fireEvent.change(inputs[0]!, { target: { value: '2' } })
    fireEvent.change(inputs[1]!, { target: { value: '5' } })
    fireEvent.change(inputs[2]!, { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(view.setCostPrices).toHaveBeenCalledWith({
      'my-relay/my-relay': { inputCacheHit: 2, inputCacheMiss: 5, output: 15 },
    })
  })
})
