// Locks the vendored storage-row decoder: packed `*-chunks` rows expand to
// their exact original assistant/chunk events (seq0+k ordering, dt-accumulated
// times), plain values pass through, malformed rows throw, and an
// unrecognised packed tag aborts instead of corrupting a newer format. The
// decoder is the repair path's only codec — no `@deepseek-ai/dsh-session`
// runtime import exists anymore (pin drift class, AGENTS §6.5).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeStorageRecord } from '../src/host/storage-rows.ts'
import { compressZstdFrame, decompressZstdFrame, scanZstdFrames } from '../src/host/zstd-frames.ts'
import { rebuildSessionLog } from '../src/host/session-repair.ts'

test('plain values pass through as single events', () => {
  assert.deepEqual(decodeStorageRecord('str'), ['str'])
  assert.deepEqual(decodeStorageRecord(42), [42])
  const event = { type: 'assistant/message', seq: 3, time: 1, data: { usage: { input: 1 } } }
  assert.deepEqual(decodeStorageRecord(event), [event])
})

test('unrelated record types pass through unvalidated', () => {
  const row = { type: 'session/title', seq: 2, data: { title: 'x' } }
  assert.deepEqual(decodeStorageRecord(row), [row])
})

test('an unrecognised -chunks tag throws instead of passing through', () => {
  const row = { type: 'image-chunks', seq0: 0, time0: 1, data: { dt: [], payloads: ['x'] } }
  assert.throws(() => decodeStorageRecord(row), /unrecognised packed storage row tag/)
})

test('text-chunks expand to ordered assistant/chunk events with dt-accumulated times', () => {
  const row = {
    type: 'text-chunks',
    seq0: 5,
    time0: 1000,
    data: { turn: 2, step: 3, index: 0, dt: [50, 60], texts: ['a', 'b', 'c'] },
  }
  const events = decodeStorageRecord(row) as { seq: number; time: number; data: { chunk: { type: string; text: string } } }[]
  assert.equal(events.length, 3)
  assert.deepEqual(
    events.map((e) => [e.seq, e.time, e.data.chunk.type, e.data.chunk.text]),
    [
      [5, 1000, 'text-delta', 'a'],
      [6, 1050, 'text-delta', 'b'],
      [7, 1110, 'text-delta', 'c'],
    ],
  )
  assert.deepEqual([events[0]!.data.turn, events[0]!.data.step], [2, 3])
})

test('reasoning-chunks expand as reasoning-delta', () => {
  const row = {
    type: 'reasoning-chunks',
    seq0: 0,
    time0: 7,
    data: { turn: 0, step: 1, index: 4, dt: [3], texts: ['r1', 'r2'] },
  }
  const events = decodeStorageRecord(row) as { data: { chunk: { type: string; index: number } } }[]
  assert.equal(events.length, 2)
  assert.equal(events[0]!.data.chunk.type, 'reasoning-delta')
  assert.equal(events[0]!.data.chunk.index, 4)
})

test('tool-call-chunks expand with id, optional name, and argumentsDelta', () => {
  const base = {
    type: 'tool-call-chunks',
    seq0: 10,
    time0: 2000,
    data: { turn: 1, step: 0, index: 2, id: 'call_1', dt: [10], args: ['{', '}'] },
  }
  const withName = decodeStorageRecord({ ...base, data: { ...base.data, name: 'read' } }) as {
    data: { chunk: { type: string; id: string; name?: string; argumentsDelta: string } }
  }[]
  assert.equal(withName.length, 2)
  assert.deepEqual(withName[0]!.data.chunk, {
    type: 'tool-call-delta',
    index: 2,
    id: 'call_1',
    name: 'read',
    argumentsDelta: '{',
  })
  const noName = decodeStorageRecord(base) as { data: { chunk: Record<string, unknown> } }[]
  assert.equal(Object.hasOwn(noName[0]!.data.chunk, 'name'), false)
})

test('malformed packed rows throw the storage-row diagnostic', () => {
  const base = { type: 'text-chunks', seq0: 0, time0: 1, data: { turn: 0, step: 0, index: 0, dt: [], texts: ['x'] } }
  assert.throws(() => decodeStorageRecord({ ...base, extra: 1 }), /malformed text-chunks storage row: envelope/)
  assert.throws(() => decodeStorageRecord({ ...base, seq0: -1 }), /seq0 must be a non-negative/)
  assert.throws(
    () => decodeStorageRecord({ ...base, data: { ...base.data, texts: ['a', 'b'], dt: [] } }),
    /dt length 0 does not match 2 members/,
  )
  assert.throws(
    () => decodeStorageRecord({ ...base, data: { ...base.data, texts: [] } }),
    /texts must be a non-empty string array/,
  )
})

test('rebuildSessionLog expands real packed rows then renumbers 0-based', async () => {
  const header = JSON.stringify({ type: 'session', version: 0, id: 'session-x' })
  const packed = JSON.stringify({
    type: 'text-chunks',
    seq0: 9,
    time0: 100,
    data: { turn: 0, step: 0, index: 0, dt: [5], texts: ['a', 'b'] },
  })
  const event = JSON.stringify({ type: 'session/title', seq: 4, time: 50, data: { title: 't' } })
  const bytes = Buffer.concat([
    await compressZstdFrame(header + '\n'),
    await compressZstdFrame(event + '\n' + packed + '\n'),
  ])
  const rebuilt = await rebuildSessionLog(bytes, decodeStorageRecord)
  assert.equal(rebuilt.events, 3)
  const { frames } = scanZstdFrames(rebuilt.rebuilt)
  let text = ''
  for (const f of frames) {
    text += (await decompressZstdFrame(rebuilt.rebuilt.subarray(f.start, f.end))).toString('utf8')
  }
  const seqs = text.split('\n').slice(1).filter((l) => l.trim()).map((l) => (JSON.parse(l) as { seq: number }).seq)
  assert.deepEqual(seqs, [0, 1, 2])
})
