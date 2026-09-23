/**
 * Direct-child discovery from a parent-owned `subagent/catalog` projection,
 * plus complete descendant-tree enumeration from the Session corpus. A direct
 * listing owns one parent observation and reads no child log. Descendant
 * enumeration retains the complete corpus and the child identity projection
 * because ordinary Sessions and one-shot children remain traversal nodes.
 *
 * @module @deepseek-ai/dsh-subagent
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import type { SessionProjectionCache } from '@deepseek-ai/dsh-session-projection-cache'
import type { SessionObservation, SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { SubagentListEntry } from './control-types.ts'
import { SubagentError } from './error.ts'
import type { SubagentIdentityProjection } from './projection-types.ts'
import type { SubagentCatalogEntry } from './projection-types.ts'

export type { SubagentListEntry } from './control-types.ts'

/**
 * Concurrent cold observations per explicit catalog listing. Current Session
 * persistence providers are local; a networked provider must promote this to
 * a validated deployment setting.
 */
const COLD_READ_CONCURRENCY = 4

/**
 * One entry of a descendant listing: the interpreted subagent facts plus its
 * position in the complete session tree. `parentId` is the durable direct
 * parent from the enumerated header, and `depth` counts edges from the root.
 */
export type SubagentDescendantListEntry = SubagentListEntry & {
  /** Durable direct parent of this candidate in the enumerated tree. */
  readonly parentId: SessionId
  /** Edge distance from the requested root; direct children are `1`. */
  readonly depth: number
}

type CorpusRecord = { readonly header: SessionHeader; readonly live: Session | undefined }

interface ListingRuntime {
  readonly projections: SessionProjectionRegistry
  readonly query: SessionQueryEngine
  readonly cache: SessionProjectionCache | undefined
  readonly corpus: ReadonlyMap<SessionId, CorpusRecord>
  readonly subagentParents: ReadonlySet<SessionId>
}

interface PositionedCandidate {
  readonly record: CorpusRecord
  readonly parentId: SessionId
  readonly depth: number
}

/**
 * Read one parent's durable catalog through a live-preferred Session observation.
 * @param ctx - context carrying the Session query service.
 * @param parentSessionId - parent whose direct children are requested.
 * @param signal - cancellation forwarded to the Session observation.
 * @returns direct-child rows in parent catalog event order.
 * @throws {@link SubagentError} when query or catalog projection is unavailable.
 */
export async function listChildren(
  ctx: Context,
  parentSessionId: SessionId,
  signal?: AbortSignal,
): Promise<SubagentCatalogEntry[]> {
  const query = ctx.get('sessionQuery')
  if (query === undefined) {
    throw new SubagentError(
      'listing subagents requires the sessionQuery service (load @deepseek-ai/dsh-session-query)',
      'SUBAGENT_CONTROL_QUERY_UNAVAILABLE',
    )
  }
  using parent = await query.observeSession(parentSessionId, {
    ...signal === undefined ? {} : { signal },
  })
  const entries = parent.projections?.values.subagentCatalog
  if (entries === undefined) {
    throw new SubagentError(
      'listing subagents requires the registered subagentCatalog projection',
      'SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE',
    )
  }
  return entries
}

/**
 * Enumerate every session-backed subagent below one root in stable pre-order.
 * Ordinary sessions and one-shot children remain traversal nodes, so a
 * continuable child below either is still discovered. Classification uses the
 * registered child identity projection; no Agent is loaded or resumed.
 * @see SubagentRuntime.listDescendants for the public cancellation and failure contract.
 * @param ctx - context carrying the session store, projection registry, and optional persistence/cache.
 * @param rootSessionId - session whose complete descendant tree is listed.
 * @param signal - caller-owned cancellation observed around every persistence read.
 * @returns interpreted subagents with durable direct-parent and root-relative depth.
 * @throws {@link SubagentError} when listing dependencies are unavailable or the caller cancels.
 */
export async function listDescendants(
  ctx: Context,
  rootSessionId: SessionId,
  signal?: AbortSignal,
): Promise<SubagentDescendantListEntry[]> {
  const listing = await prepareListing(ctx, signal)
  const positioned = descendantCandidates(listing.corpus, rootSessionId)
  const rows = await resolveCandidateRows(
    positioned.map(candidate => candidate.record),
    listing,
    signal,
  )
  const entries: SubagentDescendantListEntry[] = []
  positioned.forEach((position, index) => {
    const row = rows[index]
    if (row !== undefined) {
      entries.push({ ...row, parentId: position.parentId, depth: position.depth })
    }
  })
  return entries
}

/** Resolve listing services once and build one live-preferred session corpus. */
async function prepareListing(
  ctx: Context,
  signal: AbortSignal | undefined,
): Promise<ListingRuntime> {
  const projections = ctx.get('sessionProjections')
  // Checked before any read, even with zero candidates: mode/label are the
  // row's strong contract, so a missing fold capability is a deterministic
  // deployment configuration error, never an empty success.
  if (projections === undefined) {
    throw new SubagentError(
      'listing subagents requires the sessionProjections registry (load @deepseek-ai/dsh-session-projection)',
      'SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE',
    )
  }
  // Strict global read, never the `ctx.sessions` property proxy: the proxy is
  // caller-scope bound, so a consumer plugin without its own `sessions`
  // injection (the model-facing tool, the API proxy) would throw on access.
  const sessions = ctx.get('sessions')
  if (sessions === undefined) {
    throw new SubagentError(
      'listing subagents requires the session store (load @deepseek-ai/dsh-session)',
      'SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE',
    )
  }
  assertListingNotCancelled(signal)
  const query = ctx.get('sessionQuery')
  if (query === undefined) {
    throw new SubagentError(
      'listing subagents requires the sessionQuery service (load @deepseek-ai/dsh-session-query)',
      'SUBAGENT_CONTROL_QUERY_UNAVAILABLE',
    )
  }
  // Optional acceleration only: an absent cache service just means every
  // cold candidate takes the authoritative preparation rung, so it carries
  // no error code and no configuration check.
  const cache = ctx.get('sessionProjectionCache')
  let records: Awaited<ReturnType<SessionQueryEngine['listSessions']>>
  try {
    records = await query.listSessions(signal)
  } catch (error: unknown) {
    assertListingNotCancelled(signal)
    throw error
  }
  assertListingNotCancelled(signal)
  // Live-preferred merge without header reconciliation: a live record wins
  // its id wholesale, exactly as a live-preferred corpus would serve it.
  const corpus = new Map<SessionId, CorpusRecord>()
  for (const record of records) {
    const live = sessions.get(record.header.id)
    corpus.set(record.header.id, {
      header: live?.header ?? record.header,
      live,
    })
  }
  const subagentParents = new Set<SessionId>()
  for (const record of corpus.values()) {
    if (record.header.origin === 'subagent' && record.header.parentSession !== undefined) {
      subagentParents.add(record.header.parentSession)
    }
  }
  return { projections, query, cache, corpus, subagentParents }
}

/** Resolve projection-backed rows for aligned candidates with bounded cold reads. */
async function resolveCandidateRows(
  candidates: readonly CorpusRecord[],
  listing: ListingRuntime,
  signal: AbortSignal | undefined,
): Promise<(SubagentListEntry | undefined)[]> {
  const { projections, query, cache, subagentParents } = listing
  const rows: (SubagentListEntry | undefined)[] = Array.from({ length: candidates.length })
  const coldReads: { index: number; header: SessionHeader }[] = []
  candidates.forEach((candidate, index) => {
    const childId = candidate.header.id
    if (candidate.live === undefined) {
      coldReads.push({ index, header: candidate.header })
      return
    }
    // Read only the identity unit. A live child without an identity yet is the
    // creation window before the establishing provider appends its descriptor.
    let identity: SubagentIdentityProjection | null | undefined
    try {
      identity = projections.snapshot(candidate.live, ['subagent']).values.subagent
    } catch {
      // A rejecting identity fold is deterministic data damage in this child;
      // contain it as one diagnostic instead of failing the whole listing.
      rows[index] = { kind: 'diagnostic', id: childId, reason: 'corrupt' }
      return
    }
    // The unit's serializable no-value sentinel is `null`; `undefined` can
    // only mean the key was dropped at a JSON boundary. Both are no value.
    if (identity === undefined || identity === null
      || !candidate.live.isOwnSeq(identity.seq)) return
    rows[index] = childRow(childId, identity, 'running', subagentParents.has(childId))
  })

  // Cold candidates came from the query corpus and are resolved concurrently.
  if (coldReads.length > 0) {
    const queue = [...coldReads]
    await Promise.all(Array.from(
      { length: Math.min(COLD_READ_CONCURRENCY, queue.length) },
      async () => {
        for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
          rows[job.index] = await resolveColdIdentity(
            query, cache, job.header,
            subagentParents.has(job.header.id), signal,
          )
        }
      },
    ))
  }
  assertListingNotCancelled(signal)
  return rows
}

/** Build origin-classified candidates from the complete tree without recursion. */
function descendantCandidates(
  corpus: ReadonlyMap<SessionId, CorpusRecord>,
  rootSessionId: SessionId,
): PositionedCandidate[] {
  const children = new Map<SessionId, CorpusRecord[]>()
  for (const record of corpus.values()) {
    const parentId = record.header.parentSession
    if (parentId === undefined) continue
    const siblings = children.get(parentId)
    if (siblings === undefined) children.set(parentId, [record])
    else siblings.push(record)
  }
  for (const siblings of children.values()) siblings.sort(compareCorpusRecords)

  const positioned: PositionedCandidate[] = []
  const stack: PositionedCandidate[] = (children.get(rootSessionId) ?? [])
    .map(record => ({ record, parentId: rootSessionId, depth: 1 }))
    .reverse()
  const visited = new Set<SessionId>([rootSessionId])
  while (stack.length > 0) {
    // The length guard proves one frame exists.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const position = stack.pop()!
    const id = position.record.header.id
    if (visited.has(id)) continue
    visited.add(id)
    if (position.record.header.origin === 'subagent') positioned.push(position)
    const descendants = children.get(id) ?? []
    for (const record of [...descendants].reverse()) {
      stack.push({ record, parentId: id, depth: position.depth + 1 })
    }
  }
  return positioned
}

/** Compare siblings by durable creation time, then id. */
function compareCorpusRecords(a: CorpusRecord, b: CorpusRecord): number {
  return a.header.createdAt - b.header.createdAt || a.header.id.localeCompare(b.header.id)
}

/**
 * Resolve one cold candidate down the remaining ladder: an unseeded durable
 * projection-cache row, otherwise one shared Session observation. An absent or transiently failed
 * observation is one `unavailable` row retried on the next listing; an observation
 * source naming another lifecycle, and a
 * settled log the fold cannot identify — or that makes any registered unit
 * throw — are final, so they report `corrupt`.
 */
async function resolveColdIdentity(
  query: SessionQueryEngine,
  cache: SessionProjectionCache | undefined,
  header: SessionHeader,
  hasChildren: boolean,
  signal: AbortSignal | undefined,
): Promise<SubagentListEntry> {
  const childId = header.id
  // A header deliberately exposes only whether a fork cut exists, not its
  // integer. An unseeded lifecycle has the exact cut 0, so its cached
  // descriptor is owned at every valid seq; a seeded lifecycle must read the
  // body before an identity seq can be classified as inherited or owned.
  if (cache !== undefined && !header.isSeeded) {
    let cached: SubagentIdentityProjection | null | undefined
    try {
      cached = cache.cachedSnapshot(header, ['subagent'])?.values.subagent
    } catch {
      // Unlike the preparation fold below, a throwing cache read renders no
      // verdict: the cache is derived data, so its damage (a poisoned stored
      // row of ANY unit) silently falls through to the authoritative re-fold.
      cached = undefined
    }
    // An unseeded child's descriptor is owned at every valid seq. Everything
    // else falls through to preparation: an absent key and the `null`
    // sentinel, whose verdict belongs to the authoritative re-fold, not to a
    // derived row.
    if (cached !== undefined && cached !== null) {
      return childRow(childId, cached, 'inactive', hasChildren)
    }
  }
  assertListingNotCancelled(signal)
  let observation: SessionObservation
  try {
    observation = await query.observeSession(childId, {
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (error: unknown) {
    // Per-child isolation: durable corruption is stable; absence and backend
    // failures remain retryable. Either way, the listing itself still succeeds.
    assertListingNotCancelled(signal)
    return {
      kind: 'diagnostic',
      id: childId,
      reason: sessionQueryCode(error) === 'SESSION_QUERY_CORRUPT_SESSION'
        || sessionQueryCode(error) === 'SESSION_QUERY_SOURCE_CONFLICT'
        ? 'corrupt'
        : 'unavailable',
    }
  }
  using ownedObservation = observation
  assertListingNotCancelled(signal)
  // A session id names a slot, not a lifecycle: a child deleted and
  // re-published under another owner between the enumeration and this read
  // must not leak into the old parent's listing.
  if (!sameLifecycle(ownedObservation.header, header)) {
    return { kind: 'diagnostic', id: childId, reason: 'corrupt' }
  }
  const identity = ownedObservation.projections?.values.subagent
  if (identity === undefined || identity === null
    || identity.seq < ownedObservation.inheritedEventCount) {
    return { kind: 'diagnostic', id: childId, reason: 'corrupt' }
  }
  return childRow(childId, identity, 'inactive', hasChildren)
}

/** Materialize one served identity as its child row. */
function childRow(
  id: SessionId,
  identity: SubagentIdentityProjection,
  activity: 'running' | 'inactive',
  hasChildren: boolean,
): SubagentListEntry {
  return identity.mode === 'one-shot'
    ? {
      kind: 'child',
      id,
      mode: 'one-shot',
      ...identity.label !== undefined ? { label: identity.label } : {},
      activity,
      hasChildren,
    }
    : {
      kind: 'child',
      id,
      mode: 'continuable',
      label: identity.label,
      activity,
      hasChildren,
    }
}

/** Immutable header fields that distinguish one session lifecycle from another under the same id. */
const LIFECYCLE_WITNESS_KEYS = [
  'version', 'id', 'createdAt', 'cwd', 'parentSession', 'isSeeded', 'delegationDepth',
  'origin', 'agentPreset',
] as const

/** Whether an inspected log still belongs to the enumerated lifecycle. */
function sameLifecycle(meta: SessionHeader, expected: SessionHeader): boolean {
  return LIFECYCLE_WITNESS_KEYS.every(key => meta[key] === expected[key])
}

/** Stop a listing at its next cancellation checkpoint. */
function assertListingNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SubagentError('subagent listing was cancelled', 'CANCELLED')
  }
}

function sessionQueryCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined
}
