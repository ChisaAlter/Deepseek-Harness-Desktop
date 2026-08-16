/** Pure window cut: 7/30 days, root vs subagent, streak, time zone. */

import { describe, expect, it } from 'vitest'
import { foldSummary } from '@deepseek-ai/dsh-usage-stats/src/summarize.ts'
import type { SessionUsageView } from '@deepseek-ai/dsh-usage-stats/types'

// 2026-08-16 12:00 UTC
const NOW = Date.UTC(2026, 7, 16, 12, 0, 0)
const AUG15 = Date.UTC(2026, 7, 15, 12, 0, 0)
const AUG16 = Date.UTC(2026, 7, 16, 8, 0, 0)
const JUL20 = Date.UTC(2026, 6, 20, 12, 0, 0)

function root(partial: Partial<SessionUsageView> = {}): SessionUsageView {
  return { samples: [], userMessageTimes: [], ...partial }
}

describe('foldSummary', () => {
  it('returns zeros for an empty account', () => {
    const summary = foldSummary([], { rangeDays: 7, timeZone: 'UTC', now: NOW })
    expect(summary.totalTokens).toBe(0)
    expect(summary.sessionCount).toBe(0)
    expect(summary.messageCount).toBe(0)
    expect(summary.activeDays).toBe(0)
    expect(summary.currentStreak).toBe(0)
    expect(summary.topModel).toBeNull()
    expect(summary.heatmap).toHaveLength(7)
    expect(summary.heatmap[6]).toEqual({ date: '2026-08-16', tokens: 0 })
    expect(summary.models).toEqual([])
  })

  it('counts tokens, messages, and only root sessions with a prompt in the window', () => {
    const sessions: SessionUsageView[] = [
      root({
        userMessageTimes: [AUG16],
        samples: [{ time: AUG16, model: 'glm-5.3', tokens: 100 }],
      }),
      root({
        origin: 'subagent',
        userMessageTimes: [AUG16],
        samples: [{ time: AUG16, model: 'glm-5.3', tokens: 50 }],
      }),
      root({
        userMessageTimes: [JUL20],
        samples: [{ time: JUL20, model: 'old', tokens: 9_000 }],
      }),
    ]
    const summary = foldSummary(sessions, { rangeDays: 7, timeZone: 'UTC', now: NOW })
    expect(summary.totalTokens).toBe(150)
    expect(summary.sessionCount).toBe(1)
    expect(summary.messageCount).toBe(2)
    expect(summary.activeDays).toBe(1)
    expect(summary.topModel).toEqual({ name: 'glm-5.3', share: 100 })
  })

  it('cuts 30 days independently of 7', () => {
    const sessions = [root({
      userMessageTimes: [JUL20],
      samples: [{ time: JUL20, model: 'm', tokens: 10 }],
    })]
    const week = foldSummary(sessions, { rangeDays: 7, timeZone: 'UTC', now: NOW })
    const month = foldSummary(sessions, { rangeDays: 30, timeZone: 'UTC', now: NOW })
    expect(week.totalTokens).toBe(0)
    expect(week.heatmap).toHaveLength(7)
    expect(month.totalTokens).toBe(10)
    expect(month.heatmap).toHaveLength(30)
  })

  it('assigns a late-UTC sample to the previous civil day in America/Los_Angeles', () => {
    // 2026-08-16 06:00 UTC = 2026-08-15 23:00 PDT
    const late = Date.UTC(2026, 7, 16, 6, 0, 0)
    const sessions = [root({ samples: [{ time: late, model: 'm', tokens: 4 }] })]
    const utc = foldSummary(sessions, { rangeDays: 7, timeZone: 'UTC', now: NOW })
    const la = foldSummary(sessions, { rangeDays: 7, timeZone: 'America/Los_Angeles', now: NOW })
    expect(utc.heatmap.find(cell => cell.date === '2026-08-16')?.tokens).toBe(4)
    expect(la.heatmap.find(cell => cell.date === '2026-08-15')?.tokens).toBe(4)
    expect(la.heatmap.find(cell => cell.date === '2026-08-16')?.tokens).toBe(0)
  })

  it('starts the streak from yesterday when today is idle', () => {
    const sessions = [root({
      userMessageTimes: [AUG15],
      samples: [{ time: AUG15, model: 'm', tokens: 1 }],
    })]
    const summary = foldSummary(sessions, { rangeDays: 7, timeZone: 'UTC', now: NOW })
    expect(summary.currentStreak).toBe(1)
    expect(summary.activeDays).toBe(1)
  })

  it('does not extend a streak past the window', () => {
    const days: SessionUsageView = root({
      userMessageTimes: [
        Date.UTC(2026, 7, 10, 12),
        Date.UTC(2026, 7, 11, 12),
        Date.UTC(2026, 7, 12, 12),
        Date.UTC(2026, 7, 13, 12),
        Date.UTC(2026, 7, 14, 12),
        Date.UTC(2026, 7, 15, 12),
        Date.UTC(2026, 7, 16, 12),
      ],
      samples: [],
    })
    const summary = foldSummary([days], { rangeDays: 7, timeZone: 'UTC', now: NOW })
    expect(summary.currentStreak).toBe(7)
    expect(summary.activeDays).toBe(7)
  })

  it('splits daily stacks by model and reports shares', () => {
    const sessions = [root({
      samples: [
        { time: AUG16, model: 'glm-5.3', tokens: 72 },
        { time: AUG16, model: 'deepseek-v4-flash', tokens: 15 },
        { time: AUG16, model: 'GLM-5.3', tokens: 13 },
      ],
    })]
    const summary = foldSummary(sessions, { rangeDays: 7, timeZone: 'UTC', now: NOW })
    expect(summary.models.map(row => ({ model: row.model, share: row.share }))).toEqual([
      { model: 'glm-5.3', share: 72 },
      { model: 'deepseek-v4-flash', share: 15 },
      { model: 'GLM-5.3', share: 13 },
    ])
    expect(summary.daily[6]?.byModel).toEqual([
      { model: 'glm-5.3', tokens: 72 },
      { model: 'deepseek-v4-flash', tokens: 15 },
      { model: 'GLM-5.3', tokens: 13 },
    ])
  })
})
