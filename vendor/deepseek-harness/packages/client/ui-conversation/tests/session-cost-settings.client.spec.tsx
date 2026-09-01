// @vitest-environment jsdom
// Session-cost durable settings: the Interface row writes through the policy,
// the policy adopts accepted values, and the schema round-trips the price
// record through the wire envelope shape.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { CostSettingsRow } from '../src/client/settings/CostSettingsRow.tsx'
import type { CostSettingsRowProps } from '../src/client/settings/CostSettingsRow.tsx'
import { ComposerSubmissionPolicy } from '../src/client/input/submission-policy.ts'
import { ConversationSettingsSchema, DEFAULT_SESSION_COST } from '../src/submission-settings.ts'
import type { ConversationSettings } from '../src/submission-settings.ts'

afterEach(cleanup)

const unused = (() => { throw new Error('unused by CostSettingsRow') }) as never

function mount(opts: {
  enabled?: boolean
  writable?: boolean
  prices?: Record<string, unknown>
  catalog?: readonly { provider: string; id: string }[]
} = {}) {
  const setSessionCost = vi.fn()
  const setCostPrices = vi.fn()
  const props: CostSettingsRowProps = {
    useSessions: unused,
    useSessionPendingInteraction: unused,
    useWorkspaces: unused,
    useSessionCost: bindSnapshotSelector(createSnapshotStore(opts.enabled ?? false)),
    useCostPrices: bindSnapshotSelector(createSnapshotStore((opts.prices ?? {}) as never)),
    useWritable: bindSnapshotSelector(createSnapshotStore(opts.writable ?? true)),
    setSessionCost,
    setCostPrices,
    catalogModels: () => opts.catalog ?? [],
    t: key => key,
  }
  render(<CostSettingsRow {...props} />)
  return { setSessionCost, setCostPrices }
}

const MODEL = 'sessionCost.panel.model'

function openModelMenu() {
  if (screen.queryByRole('menu') === null) {
    fireEvent.click(screen.getByRole('button', { name: MODEL }))
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

describe('CostSettingsRow', () => {
  it('writes the Switch immediately and disables it when the Host is not writable', () => {
    const written = mount()
    const toggle = screen.getByRole('switch', { name: 'settings.sessionCost.title' })
    expect(toggle).toHaveProperty('checked', false)
    fireEvent.click(toggle)
    expect(written.setSessionCost).toHaveBeenCalledWith(true)
    written.setSessionCost.mockClear()
    cleanup()
    mount({ enabled: true, writable: false })
    expect(screen.getByRole('switch', { name: 'settings.sessionCost.title' })).toHaveProperty('disabled', true)
  })

  it('picks a model through SettingsSelect instead of a native select', () => {
    mount({ catalog: [{ provider: 'my-relay', id: 'my-relay' }] })
    fireEvent.click(screen.getByRole('button', { name: 'settings.sessionCost.openPrices' }))
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('dialog').querySelector('select')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'sessionCost.panel.model' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'my-relay/my-relay' }))
    const inputs = screen.queryAllByRole('spinbutton')
    expect(inputs.every(input => !input.hasAttribute('disabled'))).toBe(true)
  })

  it('opens the price panel from the row button and saves through setCostPrices', () => {
    const written = mount({ catalog: [{ provider: 'my-relay', id: 'my-relay' }] })
    expect(screen.queryByText('sessionCost.panel.title')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'settings.sessionCost.openPrices' }))
    // The modal is up, seeded from the empty record: the first official model,
    // displayed read-only.
    expect(screen.getByText('sessionCost.panel.title')).toBeTruthy()
    expect(screen.getByRole('button', { name: MODEL }).textContent).toContain('deepseek-v4-flash')
    const officialInputs = screen.queryAllByRole('spinbutton')
    expect(officialInputs.every(input => input.hasAttribute('disabled'))).toBe(true)
    // Switch to the directory model, type prices, save — the record lands in
    // setCostPrices under the provider-scoped key.
    pickModel('my-relay/my-relay')
    const inputs = screen.queryAllByRole('spinbutton')
    fireEvent.change(inputs[0]!, { target: { value: '1' } })
    fireEvent.change(inputs[1]!, { target: { value: '5' } })
    fireEvent.change(inputs[2]!, { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'sessionCost.panel.save' }))
    expect(written.setCostPrices).toHaveBeenCalledWith({
      'my-relay/my-relay': { inputCacheHit: 1, inputCacheMiss: 5, output: 9 },
    })
  })

  it('merges the aggregated directory models into the panel dropdown', () => {
    mount({ catalog: [{ provider: 'deepseek', id: 'deepseek-chat' }, { provider: 'my-relay', id: 'my-relay' }] })
    fireEvent.click(screen.getByRole('button', { name: 'settings.sessionCost.openPrices' }))
    expect(modelLabels()).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'deepseek-v4-flash-vision-exp',
      'deepseek/deepseek-chat',
      'my-relay/my-relay',
    ])
  })

  it('lists a directory model sharing an official column id beside the official column and prices it', () => {
    const written = mount({ catalog: [{ provider: 'my-gateway', id: 'deepseek-v4-flash' }] })
    fireEvent.click(screen.getByRole('button', { name: 'settings.sessionCost.openPrices' }))
    const options = modelLabels()
    // The official read-only column stays listed and the custom provider's
    // same-id model is its own editable entry beside it.
    expect(options).toContain('deepseek-v4-flash')
    const customValue = 'my-gateway/deepseek-v4-flash'
    expect(options).toContain(customValue)
    pickModel(customValue)
    const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    expect(inputs.every(input => !input.hasAttribute('disabled'))).toBe(true)
    fireEvent.change(inputs[0]!, { target: { value: '1' } })
    fireEvent.change(inputs[1]!, { target: { value: '5' } })
    fireEvent.change(inputs[2]!, { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: 'sessionCost.panel.save' }))
    expect(written.setCostPrices).toHaveBeenCalledWith({
      'my-gateway/deepseek-v4-flash': { inputCacheHit: 1, inputCacheMiss: 5, output: 9 },
    })
  })

  it('lists the same model id under each provider and prices them separately', () => {
    const written = mount({ catalog: [
      { provider: 'hohai', id: 'glm-5.3-flash' },
      { provider: 'zai', id: 'glm-5.3-flash' },
    ] })
    fireEvent.click(screen.getByRole('button', { name: 'settings.sessionCost.openPrices' }))
    const options = modelLabels()
    expect(options).toContain('hohai/glm-5.3-flash')
    expect(options).toContain('zai/glm-5.3-flash')
    // Price each provider's model separately.
    pickModel('hohai/glm-5.3-flash')
    let inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    fireEvent.change(inputs[0]!, { target: { value: '1' } })
    fireEvent.change(inputs[1]!, { target: { value: '1' } })
    fireEvent.change(inputs[2]!, { target: { value: '1' } })
    pickModel('zai/glm-5.3-flash')
    inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    fireEvent.change(inputs[0]!, { target: { value: '2' } })
    fireEvent.change(inputs[1]!, { target: { value: '2' } })
    fireEvent.change(inputs[2]!, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'sessionCost.panel.save' }))
    expect(written.setCostPrices).toHaveBeenCalledWith({
      'hohai/glm-5.3-flash': { inputCacheHit: 1, inputCacheMiss: 1, output: 1 },
      'zai/glm-5.3-flash': { inputCacheHit: 2, inputCacheMiss: 2, output: 2 },
    })
  })

  it('migrates a legacy bare-model price to every provider serving that model', () => {
    mount({
      catalog: [
        { provider: 'hohai', id: 'glm-5.3-flash' },
        { provider: 'zai', id: 'glm-5.3-flash' },
      ],
      prices: { 'glm-5.3-flash': { inputCacheHit: 0.15, inputCacheMiss: 0.15, output: 3 } },
    })
    fireEvent.click(screen.getByRole('button', { name: 'settings.sessionCost.openPrices' }))
    const options = modelLabels()
    expect(options.some(label => label.startsWith('hohai/glm-5.3-flash'))).toBe(true)
    expect(options.some(label => label.startsWith('zai/glm-5.3-flash'))).toBe(true)
    pickModel('hohai/glm-5.3-flash')
    const hohaiInputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    expect(hohaiInputs[0]!.value).toBe('0.15')
    pickModel('zai/glm-5.3-flash')
    const zaiInputs = screen.getAllByRole('spinbutton') as HTMLInputElement[]
    expect(zaiInputs[0]!.value).toBe('0.15')
  })
})

describe('session-cost policy', () => {
  it('defaults off and publishes live before the durable write', () => {
    const host = {
      subscribe: vi.fn(() => () => {}),
      getSnapshot: vi.fn(() => ({ writable: true, value: undefined })),
      set: vi.fn(async () => {}),
    }
    const policy = new ComposerSubmissionPolicy(host as never)
    expect(policy.sessionCost.getSnapshot()).toBe(DEFAULT_SESSION_COST)
    policy.setSessionCost(true)
    expect(policy.sessionCost.getSnapshot()).toBe(true)
    expect(host.set).toHaveBeenCalledWith('sessionCost', true)
    // Same value is a no-op on both channels.
    policy.setSessionCost(true)
    expect(host.set).toHaveBeenCalledTimes(1)
  })

  it('replaces the custom price record durably', () => {
    const host = {
      subscribe: vi.fn(() => () => {}),
      getSnapshot: vi.fn(() => ({ writable: true, value: undefined })),
      set: vi.fn(async () => {}),
    }
    const policy = new ComposerSubmissionPolicy(host as never)
    const prices = { 'my-model': { inputCacheHit: 0.5, inputCacheMiss: 5, output: 15 } }
    policy.setSessionCostPrices(prices)
    expect(policy.sessionCostPrices.getSnapshot()).toBe(prices)
    expect(host.set).toHaveBeenCalledWith('sessionCostPrices', prices)
  })

  it('adopts the accepted document values without writing back', () => {
    let snapshot: { writable: boolean; value?: Record<string, unknown> } = { writable: true }
    const listeners = new Set<() => void>()
    const host = {
      subscribe: vi.fn((fn: () => void) => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      }),
      getSnapshot: vi.fn(() => snapshot),
      set: vi.fn(async () => {}),
    }
    const policy = new ComposerSubmissionPolicy(host as never)
    expect(policy.sessionCost.getSnapshot()).toBe(false)
    snapshot = {
      writable: true,
      value: {
        sessionCost: true,
        sessionCostPrices: { 'deepseek-v4-pro': { inputCacheHit: 1, inputCacheMiss: 2, output: 3 } },
      },
    }
    for (const listener of listeners) listener()
    expect(policy.sessionCost.getSnapshot()).toBe(true)
    expect(policy.sessionCostPrices.getSnapshot()).toEqual({
      'deepseek-v4-pro': { inputCacheHit: 1, inputCacheMiss: 2, output: 3 },
    })
    expect(host.set).not.toHaveBeenCalled()
  })
})

describe('session-cost settings schema', () => {
  it('defaults both fields and tolerates an absent price record', () => {
    // Runtime accepts an empty section (every defaulted field fills in); the
    // type wants the full shape, so state the emptiness explicitly.
    const value = ConversationSettingsSchema({} as ConversationSettings)
    // The field is optional without a materialized default, so the registered
    // section defaults keep their pre-cost shape; adoption reads absent as off.
    expect(value.sessionCost ?? false).toBe(false)
    // An absent record reads as "no custom prices" whether the schemastery
    // dict materializes an empty object or leaves the key out.
    expect(value.sessionCostPrices ?? {}).toEqual({})
  })

  it('round-trips a custom price record', () => {
    const record = {
      'deepseek-v4-flash': { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 },
      'my-model': { inputCacheHit: 1, inputCacheMiss: 2, output: 3 },
    }
    const value = ConversationSettingsSchema({
      sessionCost: true,
      sessionCostPrices: record,
    } as unknown as ConversationSettings)
    expect(value.sessionCost).toBe(true)
    expect(value.sessionCostPrices).toEqual(record)
  })
})
