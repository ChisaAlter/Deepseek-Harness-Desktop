// Locks formatting semantics: zh integers until 10万, then 万/亿; en K/M/B.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dateCN,
  dateLabel,
  fmtCompact,
  fmtTokens,
  heatLevel,
  monthLabel,
  niceCeil,
  pctOf,
  quartileThresholds,
  weekdayIndexUTC,
} from '../src/shared/format.ts'

test('fmtTokens zh uses integers until 10万', () => {
  assert.equal(fmtTokens(0, 'zh-CN'), '0')
  assert.equal(fmtTokens(9999, 'zh-CN'), '9999')
  assert.equal(fmtTokens(10000, 'zh-CN'), '10000')
  assert.equal(fmtTokens(10641, 'zh-CN'), '10641')
  assert.equal(fmtTokens(10760, 'zh-CN'), '10760')
  assert.equal(fmtTokens(99999, 'zh-CN'), '99999')
  assert.equal(fmtTokens(100000, 'zh-CN'), '10 万')
  assert.equal(fmtTokens(123456, 'zh-CN'), '12.3 万')
  assert.equal(fmtTokens(100000000, 'zh-CN'), '1 亿')
  assert.equal(fmtTokens(123000000, 'zh-CN'), '1.23 亿')
  assert.equal(fmtTokens(150000000, 'zh-CN'), '1.5 亿')
})

test('fmtTokens en uses K/M/B', () => {
  assert.equal(fmtTokens(0, 'en-US'), '0')
  assert.equal(fmtTokens(999, 'en-US'), '999')
  assert.equal(fmtTokens(1200, 'en-US'), '1.2K')
  assert.equal(fmtTokens(1000000, 'en-US'), '1M')
  assert.equal(fmtTokens(2500000, 'en-US'), '2.5M')
  assert.equal(fmtTokens(1000000000, 'en-US'), '1B')
})

test('fmtCompact zh is the compact v0.1.0 form', () => {
  assert.equal(fmtCompact(12345, 'zh-CN'), '1万')
  assert.equal(fmtCompact(123456789, 'zh-CN'), '1.2亿')
  assert.equal(fmtCompact(999, 'zh-CN'), '999')
})

test('fmtCompact en', () => {
  assert.equal(fmtCompact(1234, 'en-US'), '1K')
  assert.equal(fmtCompact(1234567, 'en-US'), '1.2M')
})

test('pctOf one decimal, zero-total safe', () => {
  assert.equal(pctOf(50, 200), '25.0')
  assert.equal(pctOf(1, 3), '33.3')
  assert.equal(pctOf(5, 0), '0.0')
})

test('niceCeil picks 1/2/5×10^n (v0.1.0 semantic)', () => {
  assert.equal(niceCeil(0), 1)
  assert.equal(niceCeil(1), 1)
  assert.equal(niceCeil(7), 10)
  assert.equal(niceCeil(123), 200)
  assert.equal(niceCeil(540), 1000)
  assert.equal(niceCeil(2500), 5000)
  assert.equal(niceCeil(100), 100)
})

test('quartileThresholds + heatLevel reproduce v0.1.0 levels', () => {
  // Non-zero days: outlier-resistant ramp.
  const q = quartileThresholds([1, 1, 2, 3, 1000])
  assert.equal(heatLevel(0, q), 0)
  assert.equal(heatLevel(1, q), 1)
  assert.equal(heatLevel(2, q), 2)
  assert.equal(heatLevel(3, q), 3) // 3 == q3 → level 3 (<= q3)
  assert.equal(heatLevel(1000, q), 4)
  const qEmpty = quartileThresholds([])
  // v0.1.0 semantic: no non-zero baseline → every positive total is level 1.
  assert.equal(heatLevel(1, qEmpty), 1)
  assert.equal(heatLevel(0, qEmpty), 0)
})

test('dateLabel and dateCN', () => {
  assert.equal(dateLabel('2026-08-15'), '08/15')
  assert.equal(dateCN('2026-08-15', 'zh-CN'), '8月15日')
  assert.equal(dateCN('2026-08-15', 'en-US'), '8/15')
})

test('monthLabel formats YYYY-MM for zh and en', () => {
  assert.equal(monthLabel('2026-08', 'zh-CN'), '2026年8月')
  assert.equal(monthLabel('2026-08', 'en-US'), 'Aug 2026')
  assert.equal(monthLabel('2026-01', 'en-US'), 'Jan 2026')
})

test('weekdayIndexUTC is Monday-first', () => {
  // 2026-08-15 is a Saturday.
  assert.equal(weekdayIndexUTC('2026-08-15'), 5)
  // 2026-08-17 is a Monday.
  assert.equal(weekdayIndexUTC('2026-08-17'), 0)
})
