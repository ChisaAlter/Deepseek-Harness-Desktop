// Locks the official peak/valley schedule on a boundary grid and the
// countdown formatting. The schedule: Monday–Friday 09:00–12:00 and
// 14:00–18:00 Beijing (UTC+8, DST-free) are peak; everything else is
// off-peak.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatPeakValleyCountdown,
  isPeakBillingTime,
  nextPeakSwitchMs,
  peakValleyState,
} from '../src/shared/billing.ts'

const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1000

/** Beijing wall time `iso` parsed as epoch ms. */
function bj(iso: string): number {
  return Date.parse(iso + 'Z') - BEIJING_UTC_OFFSET_MS
}

test('weekday morning and afternoon windows are peak, boundary-exact', () => {
  assert.equal(isPeakBillingTime(bj('2026-08-24T08:59:59')), false)
  assert.equal(isPeakBillingTime(bj('2026-08-24T09:00:00')), true)
  assert.equal(isPeakBillingTime(bj('2026-08-24T10:30:00')), true)
  assert.equal(isPeakBillingTime(bj('2026-08-24T11:59:59')), true)
  assert.equal(isPeakBillingTime(bj('2026-08-24T12:00:00')), false)
  assert.equal(isPeakBillingTime(bj('2026-08-24T14:00:00')), true)
  assert.equal(isPeakBillingTime(bj('2026-08-24T17:59:59')), true)
  assert.equal(isPeakBillingTime(bj('2026-08-24T18:00:00')), false)
})

test('weekends are off-peak all day', () => {
  assert.equal(isPeakBillingTime(bj('2026-08-22T10:00:00')), false)
  assert.equal(isPeakBillingTime(bj('2026-08-23T15:00:00')), false)
})

test('the classification is timezone-independent (fixed +8 offset)', () => {
  const instant = bj('2026-08-24T10:00:00')
  assert.equal(instant, Date.parse('2026-08-24T02:00:00Z'))
  assert.equal(isPeakBillingTime(instant), true)
})

test('nextPeakSwitchMs returns the window close inside a phase', () => {
  const at = bj('2026-08-24T10:00:00')
  assert.equal(nextPeakSwitchMs(at), bj('2026-08-24T12:00:00'))
  const onClose = bj('2026-08-24T12:00:00')
  assert.equal(nextPeakSwitchMs(onClose), bj('2026-08-24T14:00:00'))
})

test('nextPeakSwitchMs returns the window open inside a gap', () => {
  const at = bj('2026-08-24T12:30:00')
  assert.equal(nextPeakSwitchMs(at), bj('2026-08-24T14:00:00'))
  const atNight = bj('2026-08-24T19:00:00')
  assert.equal(nextPeakSwitchMs(atNight), bj('2026-08-25T09:00:00'))
})

test('nextPeakSwitchMs jumps the weekend: Friday 18:00 → Monday 09:00', () => {
  const fridayEvening = bj('2026-08-28T18:20:00')
  assert.equal(nextPeakSwitchMs(fridayEvening), bj('2026-08-31T09:00:00'))
})

test('nextPeakSwitchMs always returns a boundary strictly after the input', () => {
  for (const instant of [bj('2026-08-24T08:59:59'), bj('2026-08-24T09:00:00'), bj('2026-08-29T23:00:00')]) {
    const next = nextPeakSwitchMs(instant)
    assert.ok(next > instant, 'boundary strictly after now')
    assert.equal(nextPeakSwitchMs(next - 1), next, 'the instant before a boundary flips to it')
  }
})

test('peakValleyState reports phase, next switch and remaining time', () => {
  const state = peakValleyState(new Date(bj('2026-08-24T10:00:00')))
  assert.equal(state.phase, 'peak')
  assert.equal(state.nextSwitchMs, bj('2026-08-24T12:00:00'))
  assert.equal(state.msRemaining, 2 * 60 * 60 * 1000)
  const idle = peakValleyState(new Date(bj('2026-08-24T12:00:00')))
  assert.equal(idle.phase, 'off-peak')
  assert.equal(idle.nextSwitchMs, bj('2026-08-24T14:00:00'))
})

test('formatPeakValleyCountdown renders HH:MM:SS with unbounded hours', () => {
  assert.equal(formatPeakValleyCountdown(0), '00:00:00')
  assert.equal(formatPeakValleyCountdown(-5), '00:00:00')
  assert.equal(formatPeakValleyCountdown(3_661_000), '01:01:01')
  assert.equal(formatPeakValleyCountdown(63 * 60 * 60 * 1000), '63:00:00')
  assert.equal(formatPeakValleyCountdown(59_999), '00:00:59')
})
