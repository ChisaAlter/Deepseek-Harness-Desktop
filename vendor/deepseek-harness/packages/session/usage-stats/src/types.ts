/**
 * Pure types of the usage-stats domain: the one home of the `usageDaily`
 * projection-key declaration and the cross-session summary DTO. Host
 * consumers import `./types`; client aggregates import `./client`.
 *
 * @module @deepseek-ai/dsh-usage-stats/types
 */

export {}

/** One provider-reported usage sample after turn/step dedup. */
export interface UsageSampleView {
  /** Event time of the sample that won for its turn/step. */
  time: number
  /** Model id from the assembled message, else the last request header/context. */
  model: string
  /** Sum of uncached input, output, cache-read, and cache-write tokens. */
  tokens: number
}

/**
 * Per-session usage calendar: timestamped samples and human prompt times.
 * The fold does not bucket by local calendar day so a later summary can cut
 * the same samples in the client's time zone.
 */
export interface UsageDailyProjection {
  /** Deduped usage samples in log order. */
  samples: readonly UsageSampleView[]
  /** Times of `user/message` events whose source kind is `user`. */
  userMessageTimes: readonly number[]
}

/** One session's contribution to a cross-session summary. */
export interface SessionUsageView {
  /** Present when the session header marks a subagent child. */
  origin?: 'subagent'
  /** Deduped usage samples. */
  samples: readonly UsageSampleView[]
  /** Human prompt times. */
  userMessageTimes: readonly number[]
}

/** Inclusive trailing window accepted by {@link UsageSummaryRequest.rangeDays}. */
export type UsageRangeDays = 7 | 30

/** Request that cuts stored samples into one settings-page DTO. */
export interface UsageSummaryRequest {
  /** Trailing local-calendar window, including today. */
  rangeDays: UsageRangeDays
  /** IANA time zone used for calendar-day boundaries; UTC when omitted. */
  timeZone?: string
  /** Clock override for tests; production uses `Date.now()`. */
  now?: number
}

/** One model row in a day stack or the period total. */
export interface UsageModelShare {
  /** Provider model id, or `(unknown)` when no message/header named one. */
  model: string
  /** Token total for this model in the enclosing period. */
  tokens: number
  /** Rounded percent of the enclosing token total; 0 when the total is 0. */
  share: number
}

/** Cross-session usage DTO for one trailing local-calendar window. */
export interface UsageSummary {
  /** Window that produced this DTO. */
  rangeDays: UsageRangeDays
  /** Token sum across every session, including subagent children. */
  totalTokens: number
  /** Root sessions (not `origin: 'subagent'`) with a human prompt in the window. */
  sessionCount: number
  /** Human `user/message` count in the window, including subagent children. */
  messageCount: number
  /** Local calendar days in the window with tokens or a human prompt. */
  activeDays: number
  /**
   * Consecutive active days ending today, or yesterday when today is idle.
   * Days before the window do not extend the streak.
   */
  currentStreak: number
  /** Model with the most tokens in the window; null when no tokens landed. */
  topModel: { name: string; share: number } | null
  /** One cell per local day in the window, oldest first, including zeros. */
  heatmap: readonly { date: string; tokens: number }[]
  /** Per-day model stacks, same dates as {@link UsageSummary.heatmap}. */
  daily: readonly { date: string; byModel: readonly { model: string; tokens: number }[] }[]
  /** Models with tokens in the window, descending by tokens. */
  models: readonly UsageModelShare[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Timestamped usage samples and human prompt times; see {@link UsageDailyProjection}. */
    usageDaily: UsageDailyProjection
  }
}
