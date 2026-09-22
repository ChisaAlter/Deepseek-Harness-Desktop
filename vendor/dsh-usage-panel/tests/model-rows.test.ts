// Locks the model-list row building: top-5 rows carry their own buckets, the
// merged "other" row carries the SUM of the remaining models, and the
// per-model cache hit rate derives from those buckets (same formula as the
// KPI card, per row).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelRows } from '../src/client/hooks.ts'
import { hitRate } from '../src/shared/usage.ts'

const byModel = [
  { model: 'a', total: 1000, input: 800, output: 100, cacheRead: 200, cacheWrite: 0 },
  { model: 'b', total: 500, input: 100, output: 100, cacheRead: 300, cacheWrite: 0 },
  { model: 'c', total: 300, input: 300, output: 0, cacheRead: 0, cacheWrite: 0 },
  { model: 'd', total: 200, input: 50, output: 50, cacheRead: 50, cacheWrite: 50 },
  { model: 'e', total: 100, input: 100, output: 0, cacheRead: 0, cacheWrite: 0 },
  { model: 'f', total: 90, input: 10, output: 10, cacheRead: 70, cacheWrite: 0 },
  { model: 'g', total: 10, input: 10, output: 0, cacheRead: 0, cacheWrite: 0 },
]

test('modelRows: top-5 rows carry their own buckets', () => {
  const rows = modelRows(byModel, '其他')
  assert.equal(rows.length, 6)
  assert.deepEqual(rows[0]!.buckets, { input: 800, output: 100, cacheRead: 200, cacheWrite: 0 })
  assert.deepEqual(rows[4]!.buckets, { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 })
})

test('modelRows: the merged other row sums the remaining buckets', () => {
  const rows = modelRows(byModel, '其他')
  const other = rows[5]!
  assert.equal(other.rest, true)
  assert.equal(other.total, 100) // f(90) + g(10)
  assert.deepEqual(other.buckets, { input: 20, output: 10, cacheRead: 70, cacheWrite: 0 })
})

test('per-model hit rate derives from each row bucket set', () => {
  const rows = modelRows(byModel, '其他')
  const rates = rows.map((r) => hitRate(r.buckets))
  // a: 200/(800+200) = 20%
  assert.equal(rates[0], 0.2)
  // b: 300/(100+300) = 75%
  assert.equal(rates[1], 0.75)
  // c: 0/(300+0) = 0
  assert.equal(rates[2], 0)
  // d: 50/(50+50+50) = 1/3
  assert.equal(rates[3], 1 / 3)
  // e: no cache → 0
  assert.equal(rates[4], 0)
  // other: 70/(20+70) ≈ 0.7778
  assert.ok(Math.abs(rates[5]! - 70 / 90) < 1e-9)
})

test('modelRows with ≤5 models has no other row', () => {
  const rows = modelRows(byModel.slice(0, 5), '其他')
  assert.equal(rows.length, 5)
  assert.ok(rows.every((r) => !r.rest))
})
