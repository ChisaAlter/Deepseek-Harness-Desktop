// Locks the price access over the harness conversation settings section:
// the synchronous snapshot, validation of the stored record, the lazily
// re-checked "section not registered yet" state, the write path through
// settings.update, and the settings/updated adoption that keeps the host-side
// cost ranking correct after an edit made anywhere.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CONVERSATION_SETTINGS_NS, SESSION_COST_PRICES_FIELD, createPricesSource } from '../src/host/prices-source.ts'
import type { HostSettings } from '../src/host/types.ts'
import type { SessionCostPrices } from '../src/shared/pricing.ts'

const PRICES: SessionCostPrices = {
  'deepseek-official/deepseek-v4-flash': { inputCacheHit: 0.1, inputCacheMiss: 3, output: 9 },
}

interface FakeSettings extends HostSettings {
  registered: boolean
  section: Record<string, unknown>
  patches: Array<Record<string, unknown>>
  failWrites: string | null
  failReads: string | null
  /** Optional: the section the service actually commits (schema normalization). */
  reshape: ((patch: Record<string, unknown>) => Record<string, unknown>) | null
}

function fakeSettings(registered = true, section: Record<string, unknown> = {}): FakeSettings {
  const fake: FakeSettings = {
    registered,
    section,
    patches: [],
    failWrites: null,
    failReads: null,
    reshape: null,
    describe(): Array<{ ns: string; value: unknown }> {
      if (fake.failReads !== null) throw new Error(fake.failReads)
      if (!fake.registered) return []
      return [{ ns: CONVERSATION_SETTINGS_NS, value: fake.section }]
    },
    async update(ns: string, patch: object): Promise<void> {
      // The real service REJECTS for an unregistered namespace (it never no-ops).
      if (!fake.registered) throw new Error('settings namespace "' + ns + '" is not registered')
      if (fake.failWrites !== null) throw new Error(fake.failWrites)
      const next = { ...(patch as Record<string, unknown>) }
      fake.patches.push(next)
      fake.section = { ...fake.section, ...(fake.reshape === null ? next : fake.reshape(next)) }
    },
  }
  return fake
}

function collector(): { warns: string[]; warn: (message: string) => void } {
  const warns: string[] = []
  return { warns, warn: (message) => warns.push(message) }
}

test('snapshot reads and validates the section record', () => {
  const settings = fakeSettings(true, { [SESSION_COST_PRICES_FIELD]: PRICES })
  const sink = collector()
  const source = createPricesSource(settings, sink.warn)
  assert.deepEqual(source.snapshot(), PRICES)
  assert.equal(source.isSectionRegistered(), true)
  assert.deepEqual(sink.warns, [])
})

test('an unregistered section is not evidence of "no prices": the read is retried', () => {
  const settings = fakeSettings(false)
  const source = createPricesSource(settings, () => {})
  assert.deepEqual(source.snapshot(), {})
  assert.equal(source.isSectionRegistered(), false)
  // The harness registers the section from its own plugin, possibly after this
  // one: the snapshot must pick the record up without an event or a restart.
  settings.registered = true
  settings.section = { [SESSION_COST_PRICES_FIELD]: PRICES }
  assert.deepEqual(source.snapshot(), PRICES)
})

test('an invalid record reads as empty and warns once per distinct message', () => {
  const sink = collector()
  const invalid = (key: string): Record<string, unknown> => ({
    [SESSION_COST_PRICES_FIELD]: { [key]: { inputCacheHit: -1, inputCacheMiss: 3, output: 9 } },
  })
  const settings = fakeSettings()
  settings.section = invalid('a/b')
  const source = createPricesSource(settings, sink.warn)
  assert.deepEqual(source.snapshot(), {})
  source.refresh()
  assert.deepEqual(source.snapshot(), {})
  assert.equal(sink.warns.length, 1)
  assert.match(sink.warns[0]!, /failed validation/)
  // A different broken key is a different message: still reported.
  settings.section = invalid('c/d')
  source.refresh()
  assert.equal(sink.warns.length, 2)
})

test('a section without the price field, or with a non-object value, reads as empty', () => {
  assert.deepEqual(createPricesSource(fakeSettings(true, { sessionCost: true }), () => {}).snapshot(), {})
  // A registered namespace whose resolved value is not an object cannot carry a record.
  const notAnObject = fakeSettings(true)
  notAnObject.section = 'deepseek' as unknown as Record<string, unknown>
  assert.deepEqual(createPricesSource(notAnObject, () => {}).snapshot(), {})
})

test('save writes through settings.update and caches the committed section', async () => {
  const settings = fakeSettings()
  const source = createPricesSource(settings, () => {})
  await source.save(PRICES)
  assert.deepEqual(settings.patches, [{ [SESSION_COST_PRICES_FIELD]: PRICES }])
  assert.deepEqual(source.snapshot(), PRICES)

  // The committed section — not our argument — is authoritative: a value the
  // service shaped differently is what the next snapshot serves.
  const reshaped: SessionCostPrices = { 'a/b': { inputCacheHit: 1, inputCacheMiss: 2, output: 3, flat: true } }
  settings.reshape = () => ({ [SESSION_COST_PRICES_FIELD]: reshaped })
  await source.save({})
  assert.deepEqual(source.snapshot(), reshaped)
})

test('save never persists a flat record without an idle column', async () => {
  const settings = fakeSettings()
  const source = createPricesSource(settings, () => {})
  // The retired OFF shape: the top-level triple plus the flat marker, no idle
  // column. The harness reads those three numbers as the PEAK column and halves
  // them off-peak, so the write must carry the same triple as the idle column.
  await source.save({
    'hohai/gpt-6-astra': { inputCacheHit: 2, inputCacheMiss: 0.12, output: 12, flat: true },
  })
  const stored: SessionCostPrices = {
    'hohai/gpt-6-astra': {
      inputCacheHit: 2,
      inputCacheMiss: 0.12,
      output: 12,
      idle: { inputCacheHit: 2, inputCacheMiss: 0.12, output: 12 },
      flat: true,
    },
  }
  assert.deepEqual(settings.patches, [{ [SESSION_COST_PRICES_FIELD]: stored }])
  // The snapshot serves the committed section, so the host-side ranking bills
  // what the harness strip bills.
  assert.deepEqual(source.snapshot(), stored)
})

test('save rejects while the section is unregistered and caches nothing', async () => {
  const settings = fakeSettings(false)
  const source = createPricesSource(settings, () => {})
  await assert.rejects(() => source.save(PRICES), /is not registered/)
  assert.equal(settings.patches.length, 0)
  assert.deepEqual(source.snapshot(), {})
})

test('save refuses invalid prices before touching the service', async () => {
  const settings = fakeSettings()
  const source = createPricesSource(settings, () => {})
  await assert.rejects(
    () => source.save({ 'a/b': { inputCacheHit: -1, inputCacheMiss: 3, output: 9 } }),
    /invalid prices/,
  )
  await assert.rejects(() => source.save('nope' as unknown as SessionCostPrices), /invalid prices/)
  assert.equal(settings.patches.length, 0)
  assert.deepEqual(source.snapshot(), {})
})

test('refresh keeps the snapshot fresh from settings/document-updated', () => {
  const settings = fakeSettings()
  const source = createPricesSource(settings, () => {})
  // The event carries only (ns, revision): the committed section is re-read.
  settings.section = { [SESSION_COST_PRICES_FIELD]: PRICES }
  source.refresh()
  assert.deepEqual(source.snapshot(), PRICES)
  // A resolved value that is not a section object is not evidence of anything.
  settings.section = 'deepseek' as unknown as Record<string, unknown>
  source.refresh()
  assert.deepEqual(source.snapshot(), PRICES)
  // An absent record in the resolved section means the user has no custom
  // price for anything, so the cache empties with it.
  settings.section = {}
  source.refresh()
  assert.deepEqual(source.snapshot(), {})
  // A later edit anywhere reprices the ranking: the re-read value wins.
  settings.section = { [SESSION_COST_PRICES_FIELD]: PRICES }
  source.refresh()
  assert.deepEqual(source.snapshot(), PRICES)
})

test('a throwing settings read degrades to empty instead of escaping', () => {
  const settings = fakeSettings()
  settings.failReads = 'service disposed'
  const sink = collector()
  const source = createPricesSource(settings, sink.warn)
  assert.deepEqual(source.snapshot(), {})
  assert.equal(source.isSectionRegistered(), false)
  assert.equal(sink.warns.length, 1)
  assert.match(sink.warns[0]!, /settings read failed/)
})
