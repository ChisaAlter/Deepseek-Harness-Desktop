import { describe, expect, it } from 'vitest'
import { civilWeekday, formatCompactNumber, heatLevel, padHeatmap } from '../src/client/format.ts'

describe('formatCompactNumber', () => {
  it('uses 万 for Chinese mid-range totals', () => {
    expect(formatCompactNumber(29987000, 'zh')).toBe('2998.7万')
    expect(formatCompactNumber(12, 'zh')).toBe('12')
  })

  it('uses k/M for English', () => {
    expect(formatCompactNumber(1500, 'en')).toBe('1.5k')
    expect(formatCompactNumber(2_000_000, 'en')).toBe('2M')
  })
})

describe('heatmap padding', () => {
  it('pads so the first column starts on Sunday', () => {
    // 2026-08-16 is a Sunday.
    expect(civilWeekday('2026-08-16')).toBe(0)
    expect(padHeatmap([{ date: '2026-08-16', tokens: 4 }])).toEqual([
      { date: '2026-08-16', tokens: 4 },
    ])
    // 2026-08-17 is a Monday — one Sunday pad.
    expect(padHeatmap([{ date: '2026-08-17', tokens: 1 }])[0]).toEqual({ date: null, tokens: 0 })
    expect(padHeatmap([{ date: '2026-08-17', tokens: 1 }])[1]).toEqual({ date: '2026-08-17', tokens: 1 })
  })

  it('maps tokens to discrete heat levels', () => {
    expect(heatLevel(0, 100)).toBe(0)
    expect(heatLevel(10, 100)).toBe(1)
    expect(heatLevel(100, 100)).toBe(4)
  })
})
