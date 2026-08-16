/**
 * usage domain contract: one trailing-window usage summary for the settings
 * page. The host `usageStats` service answers it; absence is
 * `usage-stats-absent`, never 500. This file is the wire contract — it does
 * not import the host package.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Inclusive trailing window accepted by usage.summary. */
export type UsageRangeDays = 7 | 30

/** One model row in a day stack or the period total. */
export interface UsageModelShareView {
  /** Provider model id, or `(unknown)` when no message/header named one. */
  readonly model: string
  /** Token total for this model in the enclosing period. */
  readonly tokens: number
  /** Rounded percent of the enclosing token total; 0 when the total is 0. */
  readonly share: number
}

/** Cross-session usage DTO for one trailing local-calendar window. */
export interface UsageSummaryView {
  /** Window that produced this DTO. */
  readonly rangeDays: UsageRangeDays
  /** Token sum across every session, including subagent children. */
  readonly totalTokens: number
  /** Root sessions with a human prompt in the window. */
  readonly sessionCount: number
  /** Human user/message count in the window, including subagent children. */
  readonly messageCount: number
  /** Local calendar days in the window with tokens or a human prompt. */
  readonly activeDays: number
  /** Consecutive active days ending today, or yesterday when today is idle. */
  readonly currentStreak: number
  /** Model with the most tokens; null when no tokens landed. */
  readonly topModel: { readonly name: string; readonly share: number } | null
  /** One cell per local day in the window, oldest first, including zeros. */
  readonly heatmap: readonly { readonly date: string; readonly tokens: number }[]
  /** Per-day model stacks, same dates as heatmap. */
  readonly daily: readonly {
    readonly date: string
    readonly byModel: readonly { readonly model: string; readonly tokens: number }[]
  }[]
  /** Models with tokens in the window, descending by tokens. */
  readonly models: readonly UsageModelShareView[]
}

/** usage.summary request. */
export interface UsageSummaryRequest {
  /** Trailing local-calendar window, including today. */
  readonly rangeDays: UsageRangeDays
  /** IANA time zone for calendar-day boundaries; UTC when omitted. */
  readonly timeZone?: string
}

/**
 * Usage summary surface. `summary` is answered by the host `usageStats`
 * service; its absence is reported as `usage-stats-absent`, never 500.
 */
export interface UsageApi {
  /** Cuts every known session into one settings-page DTO. */
  summary(
    request: RpcRequest<UsageSummaryRequest>,
    signal: AbortSignal,
  ): Promise<RpcResponse<UsageSummaryView>>
}
