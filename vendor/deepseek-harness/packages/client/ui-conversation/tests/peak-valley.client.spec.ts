// Official peak/valley schedule math: Beijing wall-clock windows, next-switch
// search, countdown formatting, and DeepSeek route matching. Every instant is
// built from a UTC epoch, so the assertions hold on any host timezone.

import { describe, expect, it } from 'vitest'
import {
  formatPeakValleyCountdown, isDeepSeekProvider, peakValleyState,
} from '../src/client/chat/peak-valley.ts'

/** 2026-03-02 is a Monday; Beijing wall time = UTC + 8h. */
const MON_MORNING_PEAK = Date.UTC(2026, 2, 2, 2, 0, 0) // Beijing Mon 10:00:00
const MON_BREAK = Date.UTC(2026, 2, 2, 4, 30, 0) // Beijing Mon 12:30:00
const MON_BEFORE_OPEN = Date.UTC(2026, 2, 2, 0, 59, 59, 500) // Beijing Mon 08:59:59.500
const MON_OPEN_EXACT = Date.UTC(2026, 2, 2, 1, 0, 0) // Beijing Mon 09:00:00.000
const MON_LUNCH_EXACT = Date.UTC(2026, 2, 2, 4, 0, 0) // Beijing Mon 12:00:00.000
const FRI_LATE_PEAK = Date.UTC(2026, 2, 6, 9, 59, 30) // Beijing Fri 17:59:30
const FRI_AFTER_CLOSE = Date.UTC(2026, 2, 6, 10, 0, 1) // Beijing Fri 18:00:01
const SAT_NOON = Date.UTC(2026, 2, 7, 4, 0, 0) // Beijing Sat 12:00:00
const NEXT_MON_OPEN = Date.UTC(2026, 2, 9, 1, 0, 0) // Beijing Mon 09:00:00.000

describe('peakValleyState', () => {
  it('classifies weekday peak windows inclusively at the open and exclusively at the close', () => {
    expect(peakValleyState(new Date(MON_MORNING_PEAK)).phase).toBe('peak')
    expect(peakValleyState(new Date(MON_OPEN_EXACT)).phase).toBe('peak')
    expect(peakValleyState(new Date(MON_LUNCH_EXACT)).phase).toBe('off-peak')
    expect(peakValleyState(new Date(MON_BREAK)).phase).toBe('off-peak')
    expect(peakValleyState(new Date(MON_BEFORE_OPEN)).phase).toBe('off-peak')
  })

  it('treats the whole weekend as off-peak', () => {
    expect(peakValleyState(new Date(SAT_NOON)).phase).toBe('off-peak')
  })

  it('names the next switch and the time remaining inside one window', () => {
    // Monday 10:00 → the 12:00 close, two hours out.
    expect(peakValleyState(new Date(MON_MORNING_PEAK))).toEqual({
      phase: 'peak',
      nextSwitchMs: Date.UTC(2026, 2, 2, 4, 0, 0),
      msRemaining: 2 * 3_600_000,
    })
    // Lunch break → the 14:00 reopen.
    expect(peakValleyState(new Date(MON_BREAK))).toEqual({
      phase: 'off-peak',
      nextSwitchMs: Date.UTC(2026, 2, 2, 6, 0, 0),
      msRemaining: 1.5 * 3_600_000,
    })
    // Half a second before the open: the boundary is strictly future.
    expect(peakValleyState(new Date(MON_BEFORE_OPEN))).toEqual({
      phase: 'off-peak',
      nextSwitchMs: MON_OPEN_EXACT,
      msRemaining: 500,
    })
  })

  it('crosses into the next weekday morning over a weekend boundary', () => {
    // Friday 18:00:01 → the next switch is Monday 09:00 Beijing (63h − 1s).
    const friday = peakValleyState(new Date(FRI_AFTER_CLOSE))
    expect(friday.phase).toBe('off-peak')
    expect(friday.nextSwitchMs).toBe(NEXT_MON_OPEN)
    expect(friday.msRemaining).toBe(NEXT_MON_OPEN - FRI_AFTER_CLOSE)
    // Saturday noon keeps the same target: weekend hours are not boundaries.
    expect(peakValleyState(new Date(SAT_NOON)).nextSwitchMs).toBe(NEXT_MON_OPEN)
    // Friday 17:59:30 is still peak with the 18:00 close 30s out.
    expect(peakValleyState(new Date(FRI_LATE_PEAK))).toEqual({
      phase: 'peak',
      nextSwitchMs: Date.UTC(2026, 2, 6, 10, 0, 0),
      msRemaining: 30_000,
    })
  })

  it('flips the phase exactly at the boundary instant', () => {
    const before = peakValleyState(new Date(MON_OPEN_EXACT - 1))
    const after = peakValleyState(new Date(MON_OPEN_EXACT))
    expect(before.phase).toBe('off-peak')
    expect(after.phase).toBe('peak')
    // The after-side recompute starts a fresh window, not a zero countdown.
    expect(after.nextSwitchMs).toBe(Date.UTC(2026, 2, 2, 4, 0, 0))
    expect(after.msRemaining).toBeGreaterThan(0)
  })
})

describe('formatPeakValleyCountdown', () => {
  it('renders zero-padded hours, minutes, and seconds', () => {
    expect(formatPeakValleyCountdown(0)).toBe('00:00:00')
    expect(formatPeakValleyCountdown(500)).toBe('00:00:00')
    expect(formatPeakValleyCountdown(30_000)).toBe('00:00:30')
    expect(formatPeakValleyCountdown(3_725_000)).toBe('01:02:05')
  })

  it('keeps multi-day gaps in the leading hours field', () => {
    expect(formatPeakValleyCountdown(63 * 3_600_000)).toBe('63:00:00')
  })

  it('clamps negative remainders to zero', () => {
    expect(formatPeakValleyCountdown(-1)).toBe('00:00:00')
  })
})

describe('isDeepSeekProvider', () => {
  it('matches the DeepSeek API routes and rejects everything else', () => {
    expect(isDeepSeekProvider('deepseek-official')).toBe(true)
    expect(isDeepSeekProvider('deepseek')).toBe(true)
    expect(isDeepSeekProvider('DeepSeek-Official')).toBe(true)
    expect(isDeepSeekProvider('openai')).toBe(false)
    expect(isDeepSeekProvider('')).toBe(false)
    expect(isDeepSeekProvider(null)).toBe(false)
  })
})
