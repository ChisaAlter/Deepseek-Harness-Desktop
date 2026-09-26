// Locks the retired plugin-owned price record → conversation settings section
// one-time import: the pure merge (the section wins on conflicts) plus the
// precondition gates this plugin actually hit in the field — the section is
// registered by another plugin and the domain attaches asynchronously, so a
// deferral must be retried rather than assumed done, the section write must
// precede clearing the legacy record, and nothing may reach the RPC path.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLegacyBillingImport, mergeLegacyPrices } from '../src/host/legacy-billing-import.ts'
import { createPricesSource, SESSION_COST_PRICES_FIELD } from '../src/host/prices-source.ts'
import type { HostSettings } from '../src/host/types.ts'
import type { BillingSettings } from '../src/shared/contract.ts'
import type { SessionCostPrices } from '../src/shared/pricing.ts'

const LEGACY_FLASH: SessionCostPrices = {
  'deepseek-official/deepseek-v4-flash': { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 },
}
const LEGACY_PRO: SessionCostPrices = {
  'deepseek-official/deepseek-v4-pro': { inputCacheHit: 0.3, inputCacheMiss: 9, output: 27 },
}

// --- the pure merge -------------------------------------------------------

test('merge adopts legacy-only keys and keeps the section value on conflicts', () => {
  const section: SessionCostPrices = { 'a/b': { inputCacheHit: 1, inputCacheMiss: 2, output: 3 } }
  const legacy: SessionCostPrices = {
    'a/b': { inputCacheHit: 9, inputCacheMiss: 9, output: 9 },
    'c/d': { inputCacheHit: 4, inputCacheMiss: 5, output: 6 },
  }
  const { prices, imported } = mergeLegacyPrices(legacy, section)
  assert.deepEqual(prices, {
    'a/b': { inputCacheHit: 1, inputCacheMiss: 2, output: 3 },
    'c/d': { inputCacheHit: 4, inputCacheMiss: 5, output: 6 },
  })
  assert.deepEqual(imported, ['c/d'])
})

test('merge never mutates its arguments and handles empty sides', () => {
  const section: SessionCostPrices = { 'a/b': { inputCacheHit: 1, inputCacheMiss: 2, output: 3 } }
  const legacy: SessionCostPrices = { 'c/d': { inputCacheHit: 4, inputCacheMiss: 5, output: 6 } }
  const { prices } = mergeLegacyPrices(legacy, section)
  assert.notEqual(prices, section)
  assert.deepEqual(Object.keys(section), ['a/b'])
  assert.deepEqual(Object.keys(legacy), ['c/d'])
  assert.deepEqual(mergeLegacyPrices({}, section), { prices: section, imported: [] })
  assert.deepEqual(mergeLegacyPrices(legacy, {}), { prices: legacy, imported: ['c/d'] })
  assert.deepEqual(mergeLegacyPrices({}, {}), { prices: {}, imported: [] })
})

// --- the gated one-time import -------------------------------------------

interface FakeSettings extends HostSettings {
  registered: boolean
  section: Record<string, unknown>
  /** Order of the section writes, for the write-before-clear assertion. */
  events: string[]
  failWrites: string | null
}

function fakeSettings(registered = true): FakeSettings {
  const fake: FakeSettings = {
    registered,
    section: {},
    events: [],
    failWrites: null,
    describe(): Array<{ ns: string; value: unknown }> {
      if (!fake.registered) return []
      return [{ ns: 'ui-conversation', value: fake.section }]
    },
    async update(ns: string, patch: object): Promise<void> {
      if (!fake.registered) throw new Error('settings namespace "' + ns + '" is not registered')
      if (fake.failWrites !== null) throw new Error(fake.failWrites)
      fake.events.push('section')
      fake.section = { ...fake.section, ...(patch as Record<string, unknown>) }
    },
  }
  return fake
}

interface FakeStore {
  mode: 'durable' | 'memory'
  record: BillingSettings
  reads: number
  clears: number
  events: string[]
  failLoad: string | null
}

function fakeStore(record: BillingSettings = { prices: {}, peakValleyEnabled: true }): FakeStore {
  return { mode: 'memory', record, reads: 0, clears: 0, events: [], failLoad: null }
}

function readerOf(store: FakeStore) {
  return {
    get mode(): 'durable' | 'memory' {
      return store.mode
    },
    async load(): Promise<BillingSettings> {
      store.reads += 1
      if (store.failLoad !== null) throw new Error(store.failLoad)
      return store.record
    },
    async clearPrices(): Promise<void> {
      store.clears += 1
      store.events.push('clear')
      store.record = { prices: {}, peakValleyEnabled: true }
    },
  }
}

function harness(options: { store: FakeStore; settings: FakeSettings }): {
  attempt: () => Promise<void>
  isDone: () => boolean
  notices: string[]
  warns: string[]
} {
  const notices: string[] = []
  const warns: string[] = []
  const prices = createPricesSource(options.settings, (message) => warns.push(message))
  const importer = createLegacyBillingImport({
    store: readerOf(options.store),
    prices,
    warn: (message) => warns.push(message),
    log: (message) => notices.push(message),
  })
  return { attempt: () => importer.attempt(), isDone: () => importer.isDone(), notices, warns }
}

test('memory mode defers WITHOUT reading, and the next attempt imports once the domain attaches', async () => {
  const settings = fakeSettings()
  const store = fakeStore({ prices: LEGACY_FLASH, peakValleyEnabled: true })
  const run = harness({ store, settings })

  await run.attempt()
  assert.equal(store.reads, 0, 'a memory-phase read would cache "no prices" and complete the import early')
  assert.equal(run.isDone(), false)
  assert.deepEqual(settings.events, [])
  assert.match(run.warns[0]!, /has not attached yet/)

  store.mode = 'durable'
  await run.attempt()
  assert.equal(store.reads, 1)
  assert.deepEqual(settings.section[SESSION_COST_PRICES_FIELD], LEGACY_FLASH)
  assert.equal(store.clears, 1)
  assert.equal(run.isDone(), true)
  assert.match(run.notices.join(' '), /imported 1 legacy price/)
})

test('an unregistered section defers, and a later billing.get retries it', async () => {
  const settings = fakeSettings(false)
  const store = fakeStore({ prices: LEGACY_FLASH, peakValleyEnabled: true })
  store.mode = 'durable'
  const run = harness({ store, settings })

  await run.attempt()
  assert.equal(run.isDone(), false)
  assert.equal(store.clears, 0, 'nothing may be cleared before the prices reached the section')
  assert.match(run.warns[0]!, /section is not registered yet/)

  settings.registered = true
  await run.attempt()
  assert.equal(run.isDone(), true)
  assert.deepEqual(settings.section[SESSION_COST_PRICES_FIELD], LEGACY_FLASH)
  assert.equal(store.clears, 1)
})

test('the section is written before the legacy record is cleared', async () => {
  const settings = fakeSettings()
  const store = fakeStore({ prices: LEGACY_PRO, peakValleyEnabled: true })
  store.mode = 'durable'
  const run = harness({ store, settings })
  await run.attempt()
  assert.deepEqual([...settings.events, ...store.events], ['section', 'clear'])
})

test('a failed section write keeps the legacy record and retries on the next attempt', async () => {
  const settings = fakeSettings()
  const store = fakeStore({ prices: LEGACY_FLASH, peakValleyEnabled: true })
  store.mode = 'durable'
  settings.failWrites = 'read-only provider'
  const run = harness({ store, settings })

  await run.attempt() // must resolve, never reject into the RPC path
  assert.equal(store.clears, 0)
  assert.equal(run.isDone(), false)
  assert.equal(store.record.prices['deepseek-official/deepseek-v4-flash'] !== undefined, true, 'the only copy survives')
  assert.match(run.warns.at(-1)!, /import failed \(retried on the next billing\.get\)/)

  settings.failWrites = null
  await run.attempt()
  assert.equal(run.isDone(), true)
  assert.deepEqual(settings.section[SESSION_COST_PRICES_FIELD], LEGACY_FLASH)
  assert.equal(store.clears, 1)
})

test('a section that already priced the model wins; the legacy record is still cleared', async () => {
  const settings = fakeSettings()
  const section: SessionCostPrices = { 'deepseek-official/deepseek-v4-flash': { inputCacheHit: 1, inputCacheMiss: 1, output: 1 } }
  settings.section = { [SESSION_COST_PRICES_FIELD]: section }
  const store = fakeStore({ prices: { ...LEGACY_FLASH, ...LEGACY_PRO }, peakValleyEnabled: true })
  store.mode = 'durable'
  const run = harness({ store, settings })

  await run.attempt()
  assert.deepEqual(settings.section[SESSION_COST_PRICES_FIELD], { ...section, ...LEGACY_PRO })
  assert.equal(store.clears, 1)
  assert.match(run.notices.join(' '), /imported 1 legacy price/)
})

test('an empty legacy record completes without writing or clearing anything', async () => {
  const settings = fakeSettings()
  const store = fakeStore()
  store.mode = 'durable'
  const run = harness({ store, settings })
  await run.attempt()
  assert.equal(run.isDone(), true)
  assert.deepEqual(settings.events, [])
  assert.equal(store.clears, 0)
  assert.deepEqual(run.notices, [])
})

test('a completed import never reads or writes again', async () => {
  const settings = fakeSettings()
  const store = fakeStore({ prices: LEGACY_FLASH, peakValleyEnabled: true })
  store.mode = 'durable'
  const run = harness({ store, settings })
  await run.attempt()
  await run.attempt()
  assert.equal(store.reads, 1)
  assert.equal(store.clears, 1)
  assert.deepEqual(settings.events, ['section'])
})

test('concurrent attempts share one run, and a throwing reader never escapes', async () => {
  const settings = fakeSettings()
  const store = fakeStore({ prices: LEGACY_FLASH, peakValleyEnabled: true })
  store.mode = 'durable'
  store.failLoad = 'domain exploded'
  const run = harness({ store, settings })
  await Promise.all([run.attempt(), run.attempt()])
  assert.equal(store.reads, 1, 'the in-flight run is shared')
  assert.equal(run.isDone(), false)
  assert.match(run.warns.join(' '), /domain exploded/)

  store.failLoad = null
  await run.attempt()
  assert.equal(run.isDone(), true)
  assert.deepEqual(settings.section[SESSION_COST_PRICES_FIELD], LEGACY_FLASH)
})
