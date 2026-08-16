/**
 * Host service that collects per-session `usageDaily` views and cuts them
 * into one trailing-window summary for the settings page.
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session/types'
import type { SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type { UsageDailyProjection, SessionUsageView, UsageSummary, UsageSummaryRequest } from './types.ts'
import { foldSummary } from './summarize.ts'

const EMPTY: UsageDailyProjection = { samples: [], userMessageTimes: [] }
const READ_CONCURRENCY = 4

declare module '@deepseek-ai/cordis' {
  interface Context {
    usageStats: UsageStats
  }
}

function asView(origin: SessionHeader['origin'], usage: UsageDailyProjection | undefined): SessionUsageView {
  return {
    ...origin === undefined ? {} : { origin },
    samples: usage?.samples ?? EMPTY.samples,
    userMessageTimes: usage?.userMessageTimes ?? EMPTY.userMessageTimes,
  }
}

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      out[index] = await map(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return out
}

/**
 * Collect every known session's usage calendar and summarize one window.
 */
export class UsageStats extends Service {
  /**
   * @param ctx - host context; optional persistence/cache/store are read via `ctx.get`.
   */
  constructor(ctx: Context) {
    super(ctx, 'usageStats')
  }

  /**
   * Cut every known session into one settings-page DTO.
   * @param request - trailing window and IANA time zone.
   * @param signal - optional cancellation for persistence listing and reads.
   * @returns the summary DTO.
   */
  async summarize(request: UsageSummaryRequest, signal?: AbortSignal): Promise<UsageSummary> {
    const views = await this.collect(signal)
    return foldSummary(views, request)
  }

  /**
   * Live sessions first; cold sessions use the projection cache, then a
   * fail-soft `readFrom` restore. A failed session contributes an empty view.
   * @param signal - optional cancellation.
   * @returns one view per discovered session.
   */
  async collect(signal?: AbortSignal): Promise<SessionUsageView[]> {
    const registry = this.ctx.sessionProjections
    const store = this.ctx.get('sessions')
    const persistence = this.ctx.get('sessionPersistence')
    const cache = this.ctx.get('sessionProjectionCache')
    const seen = new Set<string>()
    const views: SessionUsageView[] = []

    const live: readonly Session[] = store?.list() ?? []
    for (const session of live) {
      seen.add(session.id)
      const usage = registry.snapshot(session).values.usageDaily
      views.push(asView(session.header.origin, usage))
    }

    if (persistence === undefined) return views

    const snapshots = await persistence.listSnapshots(signal)
    const cold = snapshots.filter(snapshot => !seen.has(snapshot.header.id))
    const coldViews = await mapPool(cold, READ_CONCURRENCY, async (snapshot: SessionPersistenceSnapshot) => {
      signal?.throwIfAborted()
      const cached = cache?.cachedSnapshot(snapshot.header)?.values.usageDaily
      if (cached !== undefined) return asView(snapshot.header.origin, cached)
      try {
        const { events } = await persistence.readFrom(snapshot.header.id, 0, signal)
        signal?.throwIfAborted()
        const restored = registry.restore({}, events, 0).snapshot.values.usageDaily
        return asView(snapshot.header.origin, restored)
      } catch (error) {
        this.ctx.logger.warn(
          'usage.summary: session "' + snapshot.header.id + '" failed (counting it as empty): ' + String(error),
        )
        return asView(snapshot.header.origin, EMPTY)
      }
    })
    views.push(...coldViews)
    return views
  }
}
