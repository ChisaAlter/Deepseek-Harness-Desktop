// dsh-usage-panel · Host face (web plugin entry).
//
// Data path: inject waits for sessionProjections / sessionQuery /
// sessionProjectionCache, then register() installs a client-visible unit
// (stateSchema + wire). The framework folds events; scans read
// coldSnapshot.values.usagePanel. A missing cell is pending, never a
// readSession replay. register() throw fails soft to the full rescan.
//
// Reads are served with stale-while-revalidate: fresh for 10 minutes; older
// payloads return instantly with `stale: true` while a background rescan
// refreshes; the refresh button forces a synchronous scan. Read-only.
import type { Context } from '@deepseek-ai/cordis'
import type { SessionQueryEngine, SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type { SessionProjectionCache } from '@deepseek-ai/dsh-session-projection-cache'
import {
  DEFAULT_BILLING_SETTINGS,
  RPC_BILLING_GET,
  RPC_BILLING_MODELS,
  RPC_BILLING_SET,
  RPC_CHANNEL,
  RPC_OVERVIEW,
  RPC_PROJECTS_MORE,
  RPC_REPAIR_SESSION,
  RPC_SESSION_COST,
  RPC_SESSIONS_MORE,
  type BillingModelOption,
  type BillingModelOptions,
  type BillingSettings,
  type CoverageStats,
  type Overview,
  type PageRequest,
  type ProjectPage,
  type RepairResult,
  type RpcResult,
  type SessionCostData,
  type SessionPage,
} from '../shared/contract.ts'
import { DEEPSEEK_OFFICIAL_PRICES, isDeepSeekProvider } from '../shared/pricing.ts'
import { emptyAggregate, emptyOverview, finalizeOverview, mergeSessionValue, pageOf, projectRowsOf, rankSessions, rankSessionsBy, sessionModels, type Aggregate, type SessionAgg } from './aggregate.ts'
import { usagePanelProjectionDefinition } from './projection-unit.ts'
import { USAGE_PANEL_KEY, type UsagePanelState } from './projection.ts'
import { scanFallback } from './scan.ts'
import { BillingStore, openBillingMedium } from './billing-store.ts'
import { repairSessionLog, resolveDshHome, runtimeCodec } from './session-repair.ts'
import { openStatsCache, statsCacheKey, type StatsCache } from './stats-cache.ts'
import { scanPacer, withTimeout } from './pacing.ts'
import type { HostConnection, HostLlm, LlmProviderInfoLike } from './types.ts'

export const name = 'dsh-usage-panel'
export const inject = [
  'timer',
  'connection',
  'sessionProjections',
  'sessionQuery',
  'sessionProjectionCache',
]

const STALE_MS = 10 * 60 * 1000 // cache freshness window
const RESCAN_MS = 10 * 60 * 1000 // periodic keep-warm rescan

export function apply(ctx: Context): void {
  const tag = '[dsh-usage-panel]'
  const sq = ctx.get('sessionQuery') as SessionQueryEngine
  const registry = ctx.get('sessionProjections') as SessionProjectionRegistry
  const projCache = ctx.get('sessionProjectionCache') as SessionProjectionCache
  const connection = ctx.get('connection') as HostConnection | undefined
  const llm = ctx.get('llm') as HostLlm | undefined

  let mode: CoverageStats['mode'] = 'projection'

  console.log(
    tag,
    'boot: mode=' + mode,
    'services: sessionQuery=' + Boolean(sq) + ' sessionProjections=' + Boolean(registry) + ' sessionProjectionCache=' + Boolean(projCache),
  )

  // Registration is an effect on this fiber: the unit's key disappears when
  // the plugin unloads. Fail-soft: any registration problem drops to scan.
  let disposeUnit: (() => void) | null = null
  try {
    disposeUnit = (ctx as Context & { sessionProjections: SessionProjectionRegistry }).sessionProjections.register(
      // Desktop harness register() reads stateSchema + wire; npm rc.6 d.ts still wants schema + view.
      usagePanelProjectionDefinition as never,
    )
  } catch (err) {
    console.warn(tag, 'projection registration failed; falling back to full scan:', String((err as Error)?.message ?? err))
    disposeUnit = null
    mode = 'scan'
  }

  let providerNames: Record<string, string> = {}
  if (llm && typeof llm.listProviders === 'function') {
    Promise.resolve(llm.listProviders())
      .then((infos) => {
        providerNames = Object.fromEntries((infos || []).map((p) => [p.id, p.name]))
      })
      .catch((err) => console.warn(tag, 'listProviders failed:', String((err as Error)?.message ?? err)))
  }

  let cache: { at: number; payload: Overview } | null = null
  let inflight: Promise<Overview> | null = null
  let disposed = false
  // Full ranked session index (all-time, no title) rebuilt each scan — the
  // "显示更多" paging endpoints slice it on demand.
  let sessionIndex: SessionAgg[] = []
  // In-memory carried aggregate: the delta scan merges ONLY changes into it.
  let aggregate: Aggregate | null = null
  // Ledger ids seen in the last full scan (deleted-session detection).
  let ledgerIds = new Set<string>()
  // Failed-session ids (repair candidates) discovered by the last scan.
  let failedSessionIds: string[] = []
  // Sessions whose `session.cost` read already failed once (log dedupe).
  const reportedCostFailures = new Set<string>()
  // SQLite aggregate cache (guarded): lets a cold start serve the previous
  // overview instantly and refresh in the background.
  let statsCache: StatsCache | null = null
  openStatsCache(resolveDshHome(), (message) => console.warn(tag, message)).then((cache) => {
    statsCache = cache
  })

  // Billing preferences: plugin-owned JSON via storageDomain when the
  // facility is present (its activation precedes ours through
  // sessionProjectionCache), fail-soft to memory otherwise. The medium
  // attaches async at boot; the store serves memory until then, so the RPC
  // never waits on the domain.
  const billingStore = new BillingStore(undefined, (message) => console.warn(tag, message))
  openBillingMedium(ctx.get('storageDomain') as never, (message) => console.warn(tag, message)).then((medium) => {
    if (medium) billingStore.attachMedium(medium)
  })

  function logFailure(message: string): void {
    console.warn(tag, message)
  }

  async function scanProjection(now: number): Promise<Overview> {
    let a = emptyAggregate()
    let sessionsTotal = 0
    let sessionsOk = 0
    let sessionsFailed = 0
    let sessionsPending = 0
    const failures: string[] = []
    let sessions: SessionRecord[] = []
    try {
      sessions = await sq.listSessions()
    } catch (err) {
      logFailure('listSessions failed: ' + String((err as Error)?.message ?? err))
      return emptyOverview(now)
    }
    // Cooperative pacing across a large corpus: cold folds (a v2-migration
    // first pass) must not stall the host event loop.
    const pacer = scanPacer((message) => console.log(tag, message))
    const failed: string[] = []
    const ledgerPuts: Array<{ id: string; asOfSeq: number }> = []
    for (let i = 0; i < sessions.length; i += 1) {
      const rec = sessions[i]
      const header = rec && rec.header
      if (!header) {
        sessionsTotal += 1
        sessionsFailed += 1
        await pacer.beat(i + 1, sessions.length)
        continue
      }
      const id = header.id
      sessionsTotal += 1
      if (!rec.persisted) {
        sessionsPending += 1
        await pacer.beat(i + 1, sessions.length)
        continue
      }
      try {
        const snap = await projCache.coldSnapshot(id)
        const value = snap.values.usagePanel
        if (!value) {
          sessionsPending += 1 // cell not folded yet (no events / cold)
          await pacer.beat(i + 1, sessions.length)
          continue
        }
        a = mergeSessionValue(a, value, id, now, 0, header.cwd ?? null)
        sessionsOk += 1
        ledgerPuts.push({ id, asOfSeq: snap.asOfSeq })
      } catch (err) {
        sessionsFailed += 1
        if (failed.length < 50) failed.push(id)
        if (failures.length < 3) failures.push(String((err as Error)?.message ?? err))
      }
      await pacer.beat(i + 1, sessions.length)
    }
    // Full scan refreshes the persistent delta baseline (watermark ledger).
    aggregate = a
    ledgerIds = new Set(ledgerPuts.map((p) => p.id))
    if (statsCache !== null) {
      void (async () => {
        for (const put of ledgerPuts) await statsCache!.ledgerPut(put.id, put.asOfSeq)
      })()
    }
    failedSessionIds = failed
    if (failures.length > 0) {
      logFailure(sessionsFailed + ' session(s) failed to read (first ' + failures.length + '): ' + failures.join(' | '))
    }
    sessionIndex = rankSessions(a.sessions, Number.MAX_SAFE_INTEGER)
    const titles = new Map<string, string | null>()
    await Promise.all(
      rankSessions(a.sessions, 10).map(async (s) => {
        try {
          const t = await sq.readTitle(s.id as SessionId)
          titles.set(s.id, t ? t.title : null)
        } catch {
          titles.set(s.id, null)
        }
      }),
    )
    return finalizeOverview({
      aggregate: a,
      now,
      mode: 'projection',
      sessionsTotal,
      sessionsOk,
      sessionsFailed,
      sessionsPending,
      eventsCounted: 0,
      titles,
      providerNames,
      failedSessionIds: failed,
    })
  }

  async function scan(now: number): Promise<Overview> {
    if (disposed) return cache ? cache.payload : emptyOverview(now)
    if (mode === 'projection') return scanProjection(now)
    return scanFallback({ sq, providerNames, logFailure, storeIndex: (rows) => { sessionIndex = rows }, storeFailed: (ids) => { failedSessionIds = ids } }, now)
  }

  /** Watermark of an overview for the SQLite cache (corpus shape). */
  async function watermarkKey(): Promise<string> {
    const sessions = await sq.listSessions()
    let to: number | null = null
    for (const rec of sessions) {
      const created = rec?.header?.createdAt
      if (typeof created === 'number' && (to === null || created > to)) to = created
    }
    return statsCacheKey({ sessionsTotal: sessions.length, to })
  }

  /** Cold-start fast path: hydrate the in-memory cache from SQLite before any scan. */
  async function hydrateFromCache(): Promise<void> {
    if (cache !== null || statsCache === null) return
    let payload: Overview | null = null
    try {
      payload = await statsCache.get(await watermarkKey())
    } catch {
      payload = null
    }
    if (payload !== null && !disposed) {
      // Serve as stale: the background scan refreshes immediately.
      cache = { at: payload.updatedAt, payload }
      console.log(tag, 'stats cache hit — serving snapshot, refreshing in background')
    }
  }

  /**
   * AGGREGATE-LEVEL INCREMENTAL scan: only sessions whose checkpoint watermark
   * moved (new/changed) are folded via coldSnapshot (tail-only) and merged;
   * unchanged sessions are skipped with ZERO log I/O (`cachedSnapshot` reads
   * the in-memory row watermark only). The in-memory aggregate carries over.
   * Rare consistency events (session deleted, ledger mismatch) fall back to a
   * full scan.
   */
  async function deltaScan(now: number): Promise<Overview> {
    if (aggregate === null) return scan(now)
    let sessions: SessionRecord[] = []
    try {
      sessions = await sq.listSessions()
    } catch (err) {
      logFailure('delta listSessions failed: ' + String((err as Error)?.message ?? err))
      return cache ? cache.payload : emptyOverview(now)
    }
    let a = aggregate
    const seen = new Set<string>()
    const changed: string[] = []
    let deleteDetected = false
    const pacer = scanPacer((message) => console.log(tag, message))
    const failed: string[] = []
    for (let i = 0; i < sessions.length; i += 1) {
      const rec = sessions[i]
      const header = rec && rec.header
      if (!header) continue
      const id = header.id
      seen.add(id)
      const cached = statsCache === null ? undefined : projCache.cachedSnapshot(header)
      const asOf = cached?.asOfSeq
      if (asOf !== undefined) {
        const led = statsCache === null ? null : await statsCache.ledgerGet(id)
        if (led === asOf) {
          await pacer.beat(i + 1, sessions.length)
          continue // UNCHANGED — zero log reads
        }
      }
      // New or changed session: tail fold + merge into the carried aggregate.
      try {
        const snap = await projCache.coldSnapshot(id)
        const value = snap.values.usagePanel
        if (!value) {
          await pacer.beat(i + 1, sessions.length)
          continue
        }
        a = mergeSessionValue(a, value, id, now, 0, header.cwd ?? null)
        changed.push(id)
        if (statsCache !== null) {
          await statsCache.ledgerPut(id, snap.asOfSeq)
          ledgerIds.add(id)
        }
        failedSessionIds = failedSessionIds.filter((f) => f !== id)
      } catch (err) {
        if (failed.length < 50) failed.push(id)
        logFailure('delta read failed for ' + id + ': ' + String((err as Error)?.message ?? err))
      }
      await pacer.beat(i + 1, sessions.length)
    }
    // Deleted sessions (in the ledger, not listed): the aggregate must be
    // rebuilt from scratch — a rare path, correctness first.
    for (const id of ledgerIds) {
      if (!seen.has(id)) deleteDetected = true
    }
    if (deleteDetected) {
      logFailure(tag + ' session deleted since last scan — falling back to a full rescan')
      return scan(now)
    }
    if (changed.length === 0 && cache !== null) {
      // Nothing moved: keep the existing payload (freshness refreshed later).
      return cache.payload
    }
    aggregate = a
    sessionIndex = rankSessions(a.sessions, Number.MAX_SAFE_INTEGER)
    if (failed.length > 0) failedSessionIds = [...new Set([...failedSessionIds, ...failed])].slice(0, 50)
    const titles = new Map<string, string | null>()
    await Promise.all(
      rankSessions(a.sessions, 10).map(async (s) => {
        try {
          const t = await sq.readTitle(s.id as SessionId)
          titles.set(s.id, t ? t.title : null)
        } catch {
          titles.set(s.id, null)
        }
      }),
    )
    const pending = sessions.filter((rec) => !(rec && rec.persisted)).length
    return finalizeOverview({
      aggregate: a,
      now,
      mode: 'projection',
      sessionsTotal: sessions.length,
      sessionsOk: sessions.length - failedSessionIds.length - pending,
      sessionsFailed: failedSessionIds.length,
      sessionsPending: pending,
      eventsCounted: 0,
      titles,
      providerNames,
      failedSessionIds,
    })
  }

  function startScan(): Promise<Overview> {
    if (disposed) return Promise.resolve(cache ? cache.payload : emptyOverview(Date.now()))
    if (inflight) return inflight
    const run = (async (): Promise<Overview> => {
      await hydrateFromCache()
      const payload = aggregate === null ? await scan(Date.now()) : await deltaScan(Date.now())
      if (payload !== null && !disposed) {
        cache = { at: Date.now(), payload }
        // Cache write off the response path: serialize + SQLite round-trip is
        // synchronous work; defer it so the RPC caller is never delayed by it.
        if (statsCache !== null) {
          setImmediate(() => {
            if (disposed) return
            void (async () => {
              try {
                const key = await watermarkKey()
                await statsCache!.put(key, payload)
              } catch {
                /* fail-soft */
              }
            })()
          })
        }
      }
      return payload
    })()
    inflight = run
    run.catch(() => {}).then(() => {
      if (inflight === run) inflight = null
    })
    return run
  }

  function overview(args: { force?: boolean } | undefined): Promise<Overview> {
    const force = !!(args && args.force)
    if (!force && cache) {
      if (Date.now() - cache.at < STALE_MS) return Promise.resolve(cache.payload)
      startScan() // stale-while-revalidate: background refresh
      return Promise.resolve(Object.assign({}, cache.payload, { stale: true }))
    }
    return startScan()
  }

  const ZERO_TOTALS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  const ZERO_PHASE = {
    peak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    offPeak: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }

  /**
   * Price-bearing projection data of ONE session: the live registry state
   * when the session is open (synchronous, no replay), else the cold cached
   * row. A session with neither (no persisted log / no cell yet) reports
   * `found: false` — the strip shows an empty readout, never an error.
   */
  async function sessionCost(payload: { sessionId?: string }): Promise<SessionCostData> {
    const sessionId = payload.sessionId
    if (!sessionId) throw new Error('missing sessionId')
    const sessions = ctx.get('sessions') as { get(id: string): unknown } | undefined
    let value: UsagePanelState | undefined
    try {
      const live = sessions && sessions.get(sessionId)
      if (live) {
        // Desktop harness registry exposes stateOf (live read); the npm rc.6
        // type face does not — local structural cast, same precedent as the
        // register() cast above.
        const liveRegistry = registry as SessionProjectionRegistry & {
          stateOf(session: unknown, key: string): UsagePanelState | undefined
        }
        value = liveRegistry.stateOf(live, USAGE_PANEL_KEY)
      } else {
        const snap = await projCache.coldSnapshot(sessionId as SessionId)
        value = snap.values.usagePanel
      }
    } catch (err) {
      // Deduplicate: the strip polls every 2s and an unreadable session must
      // not flood the log — the first failure is reported, later ones are silent.
      if (!reportedCostFailures.has(sessionId)) {
        reportedCostFailures.add(sessionId)
        logFailure('session.cost read failed for ' + sessionId + ': ' + String((err as Error)?.message ?? err))
        logFailure('session.cost will not retry reporting this session until the plugin reloads; open 设置 → 用量统计 and click the 「修复」 button in the page header (backed up to .bak-<ts> before rewriting)')
      }
      // Union into the repair list: the strip may discover a corruption the
      // last scan snapshot predates; the next overview refresh then counts it.
      if (!failedSessionIds.includes(sessionId)) {
        failedSessionIds = [...failedSessionIds, sessionId]
        cache = null
      }
    }
    if (!value) {
      return { found: false, currentModel: 'unknown', currentProvider: 'unknown', cost: ZERO_PHASE, models: [], totals: { ...ZERO_TOTALS } }
    }
    return {
      found: true,
      currentModel: value.currentModel,
      currentProvider: value.currentProvider,
      cost: value.costTotals,
      models: sessionModels(value),
      totals: {
        ...value.totals,
        total: value.totals.input + value.totals.output + value.totals.cacheRead + value.totals.cacheWrite,
      },
    }
  }

  const PAGE_SIZE = 10

  /** Current billing record for host-side cost ranking (freshened on edits). */
  let billingSnapshot: BillingSettings = { ...DEFAULT_BILLING_SETTINGS }
  billingStore.load().then((s) => {
    billingSnapshot = s
  }).catch(() => {})

  const sortOf = (payload: Partial<PageRequest> | undefined): 'tokens' | 'cost' => payload?.sort ?? 'tokens'

  /** Next page of the ranked session list (titles fetched on demand). */
  async function sessionsMore(payload: Partial<PageRequest> | undefined): Promise<SessionPage> {
    const offset = Math.max(0, payload?.offset ?? 0)
    const sort = sortOf(payload)
    const ranked = rankSessionsBy(sessionIndex, sort, billingSnapshot.prices, billingSnapshot.peakValleyEnabled)
    const { rows, hasMore } = pageOf(ranked, offset, PAGE_SIZE)
    const titles = new Map<string, string | null>()
    await Promise.all(
      rows.map(async (s) => {
        try {
          const t = await sq.readTitle(s.id as SessionId)
          titles.set(s.id, t ? t.title : null)
        } catch {
          titles.set(s.id, null)
        }
      }),
    )
    return {
      sessions: rows.map((s) => ({
        id: s.id,
        title: titles.get(s.id) ?? null,
        totals: s.totals,
        lastActive: s.lastActive,
        depth: s.depth,
        models: s.models,
      })),
      hasMore,
    }
  }

  /** Next page of the project (= working directory) ranking. */
  async function projectsMore(payload: Partial<PageRequest> | undefined): Promise<ProjectPage> {
    const offset = Math.max(0, payload?.offset ?? 0)
    const all = projectRowsOf(sessionIndex, sortOf(payload), billingSnapshot.prices, billingSnapshot.peakValleyEnabled)
    const { rows, hasMore } = pageOf(all, offset, PAGE_SIZE)
    return { rows, hasMore }
  }

  /**
   * Repair ONE damaged session artifact (the exact id the scan reported):
   * decode all rows via the runtime codec, renumber seqs 0-based, re-pack and
   * atomically replace, keeping a timestamped backup. Never automatic; the
   * user triggers it from the stats page. Fails gracefully when the desktop
   * harness packages are unavailable (standalone npm installs).
   */
  async function repairSession(payload: { sessionId?: string }): Promise<RepairResult> {
    const sessionId = payload.sessionId
    if (!sessionId || !/^(?:session-)?[0-9a-f-]+$/i.test(sessionId)) {
      throw new Error('invalid session id')
    }
    const codec = await runtimeCodec()
    const outcome = await repairSessionLog(resolveDshHome(), sessionId, codec.decode)
    // The repaired session must leave the failure set immediately; the cache
    // and the carried aggregate are dropped so the next pass rebuilds from the
    // fixed artifact (the old ledger watermark would otherwise hide the fold).
    failedSessionIds = failedSessionIds.filter((id) => id !== sessionId)
    cache = null
    aggregate = null
    ledgerIds = new Set()
    if (statsCache !== null) {
      await statsCache.ledgerDelete(sessionId)
    }
    return outcome
  }

  /**
   * Priceable model option list for the settings modal: every registered
   * provider (llm directory) plus providers seen in saved sessions, each with
   * its adapter-advertised models, the official DeepSeek columns for
   * deepseek-routed providers, and usage-seen model ids. Adapter failures
   * degrade per provider (the provider still lists), never deny the modal.
   */
  async function billingModels(): Promise<BillingModelOptions> {
    const options = new Map<string, BillingModelOption>()
    const ensure = (provider: string, providerName: string): BillingModelOption => {
      let option = options.get(provider)
      if (option === undefined) {
        option = { provider, providerName, models: [] }
        options.set(provider, option)
      }
      return option
    }
    let providers: LlmProviderInfoLike[] = []
    if (llm) {
      try {
        providers = await withTimeout(Promise.resolve(llm.listProviders()), 2000, 'provider directory')
      } catch (err) {
        logFailure('billing.models listProviders failed/slow: ' + String((err as Error)?.message ?? err))
      }
    }
    for (const p of providers) {
      const option = ensure(p.id, p.name || p.id)
      if (isDeepSeekProvider(p.id)) {
        for (const entry of DEEPSEEK_OFFICIAL_PRICES) {
          if (!option.models.includes(entry.model)) option.models.push(entry.model)
        }
      }
    }
    if (llm && typeof llm.listModels === 'function') {
      await Promise.all(
        providers.map(async (p) => {
          try {
            const infos = await withTimeout(Promise.resolve(llm.listModels!(p.id)), 2000, 'adapter models for ' + p.id)
            const option = ensure(p.id, p.name || p.id)
            for (const info of infos) {
              if (info && info.id && !option.models.includes(info.id)) option.models.push(info.id)
            }
          } catch {
            /* the adapter cannot advertise its models (slow/dead); keep the provider row */
          }
        }),
      )
    }
    if (cache) {
      for (const session of cache.payload.topSessions) {
        for (const row of session.models) {
          const provider = row.provider === 'unknown' ? '(unknown)' : row.provider
          const option = ensure(provider, provider)
          if (!option.models.includes(row.model)) option.models.push(row.model)
        }
      }
    }
    return { options: [...options.values()] }
  }

  // RPC channel for the browser half: /usage-stats/overview + billing + session.cost.
  const disposeRpc =
    connection &&
    connection.rpc.handle(
      RPC_CHANNEL,
      (endpoint, payload): Promise<RpcResult<unknown>> => {
        if (endpoint === RPC_OVERVIEW) {
          return overview(payload as { force?: boolean } | undefined).then(
            (value) => ({ ok: true, value }),
            (err) => ({
              ok: false,
              error: {
                code: 'internal',
                message: String((err as Error)?.message ?? err),
                details: {},
              },
            }),
          )
        }
        if (endpoint === RPC_BILLING_GET) {
          return billingStore.load().then(
            (value) => ({ ok: true, value }),
            (err) => ({
              ok: false,
              error: {
                code: 'internal',
                message: String((err as Error)?.message ?? err),
                details: {},
              },
            }),
          )
        }
        if (endpoint === RPC_BILLING_SET) {
          return billingStore.save((payload ?? { ...DEFAULT_BILLING_SETTINGS }) as BillingSettings).then(
            (value) => {
              billingSnapshot = value
              return { ok: true, value }
            },
            (err) => ({
              ok: false,
              error: {
                code: 'bad-request',
                message: String((err as Error)?.message ?? err),
                details: {},
              },
            }),
          )
        }
        if (endpoint === RPC_BILLING_MODELS) {
          return billingModels().then(
            (value) => ({ ok: true, value }),
            (err) => ({
              ok: false,
              error: {
                code: 'internal',
                message: String((err as Error)?.message ?? err),
                details: {},
              },
            }),
          )
        }
        if (endpoint === RPC_SESSION_COST) {
          return sessionCost((payload ?? {}) as { sessionId?: string }).then(
            (value) => ({ ok: true, value }),
            (err) => ({
              ok: false,
              error: {
                code: 'internal',
                message: String((err as Error)?.message ?? err),
                details: {},
              },
            }),
          )
        }
        if (endpoint === RPC_SESSIONS_MORE) {
          return sessionsMore((payload ?? {}) as PageRequest).then(
            (value) => ({ ok: true, value }),
            (err) => ({
              ok: false,
              error: {
                code: 'internal',
                message: String((err as Error)?.message ?? err),
                details: {},
              },
            }),
          )
        }
        if (endpoint === RPC_PROJECTS_MORE) {
          return projectsMore((payload ?? {}) as PageRequest).then(
            (value) => ({ ok: true, value }),
            (err) => ({
              ok: false,
              error: {
                code: 'internal',
                message: String((err as Error)?.message ?? err),
                details: {},
              },
            }),
          )
        }
        if (endpoint === RPC_REPAIR_SESSION) {
          return repairSession((payload ?? {}) as { sessionId?: string }).then(
            (value) => ({ ok: true, value }),
            (err) => ({
              ok: false,
              error: {
                code: 'internal',
                message: String((err as Error)?.message ?? err),
                details: {},
              },
            }),
          )
        }
        return Promise.resolve({
          ok: false,
          error: { code: 'bad-request', message: 'unknown endpoint: ' + String(endpoint), details: { issues: [] } },
        })
      },
      { authority: 'loopback' },
    )

  // Warm up the moment the plugin loads.
  startScan().then((o) => {
    console.log(
      tag,
      'first scan done:',
      'mode=' + o.coverage.mode,
      'sessions=' + o.coverage.sessionsTotal + '/' + o.coverage.sessionsOk + ' (failed ' + o.coverage.sessionsFailed + ', pending ' + o.coverage.sessionsPending + ')',
      'withUsage=' + o.allTime.sessionCount,
      'dataRange=' + (o.coverage.from === null ? '-' : new Date(o.coverage.from).toISOString()) + '..' + (o.coverage.to === null ? '-' : new Date(o.coverage.to).toISOString()),
    )
  })

  // Keep-warm: light periodic rescan so the cached payload never goes stale.
  const stopTimer = ctx.interval(() => {
    if (!inflight) startScan()
  }, RESCAN_MS)

  ctx.effect(() => () => {
    disposed = true
    if (disposeUnit) disposeUnit()
    if (stopTimer) stopTimer()
    if (disposeRpc) disposeRpc()
  })
}
