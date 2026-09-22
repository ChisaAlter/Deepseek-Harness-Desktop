// subagentCostSources: which Sessions a delegated subagent ran in, what they
// billed, and what the tooltip calls them. The walk is the mirror of the
// breadcrumb's ancestry derivation, and it must stay honest about a child
// whose usage value has not arrived.

import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BilledUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import { subagentCostSources } from '../src/client/chat/subagent-cost.ts'

type CatalogSnapshot = SessionListState['subagentsByParent'][keyof SessionListState['subagentsByParent']]
type CatalogEntry = CatalogSnapshot['entries'][number]

const PARENT = SessionId('parent')
const CHILD = SessionId('child')
const GRANDCHILD = SessionId('grandchild')
const OTHER = SessionId('other')

const USAGE: BilledUsageProjection = {
  peak: { missInputTokens: 10, cacheReadTokens: 0, outputTokens: 0 },
  offPeak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
  models: [{ provider: 'relay', model: 'm', peak: { missInputTokens: 10, cacheReadTokens: 0, outputTokens: 0 }, offPeak: { missInputTokens: 0, cacheReadTokens: 0, outputTokens: 0 } }],
}

/** One listed row, subagent-linked when a parent is given. */
function row(opts: {
  id: SessionId
  parentId?: SessionId
  origin?: 'subagent'
  displayTitle?: string
  usage?: BilledUsageProjection
}): SessionSummary {
  return {
    id: opts.id,
    displayTitle: opts.displayTitle ?? String(opts.id),
    running: false,
    blank: false,
    updatedAt: 0,
    ...(opts.parentId === undefined ? {} : { parentId: opts.parentId }),
    ...(opts.origin === undefined ? {} : { origin: opts.origin }),
    ...(opts.usage === undefined ? {} : { projectionValues: { billedUsage: opts.usage } }),
  }
}

/** A list state over the given rows. */
function listOf(rows: readonly SessionSummary[]): SessionListState {
  return {
    ids: rows.map(entry => entry.id),
    byId: Object.fromEntries(rows.map(entry => [entry.id, entry])),
    current: PARENT,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

/** One direct-child catalog row naming a child; a continuable child always has a label. */
function childEntry(id: typeof CHILD, label: string | undefined): CatalogEntry {
  return label === undefined
    ? { kind: 'child', id, activity: 'inactive', hasChildren: false, mode: 'one-shot' }
    : { kind: 'child', id, activity: 'inactive', hasChildren: false, mode: 'continuable', label }
}

/** The list with one parent's loaded catalog naming the given entries. */
function withCatalog(
  parent: SessionId,
  list: SessionListState,
  ...entries: readonly CatalogEntry[]
): SessionListState {
  return {
    ...list,
    subagentsByParent: { ...list.subagentsByParent, [parent]: { entries, state: 'ready', error: null } },
  }
}

describe('subagentCostSources', () => {
  it('returns nothing without a selected Session', () => {
    expect(subagentCostSources(undefined, listOf([row({ id: CHILD, parentId: PARENT, origin: 'subagent' })]))).toEqual([])
  })

  it('walks direct children and grandchildren nearest first', () => {
    const list = listOf([
      row({ id: PARENT }),
      row({ id: CHILD, parentId: PARENT, origin: 'subagent', displayTitle: 'Docs relay', usage: USAGE }),
      row({ id: GRANDCHILD, parentId: CHILD, origin: 'subagent', displayTitle: 'Sub relay', usage: USAGE }),
    ])
    expect(subagentCostSources(PARENT, list).map(source => [source.sessionId, source.label])).toEqual([
      [CHILD, 'Docs relay'],
      [GRANDCHILD, 'Sub relay'],
    ])
    expect(subagentCostSources(PARENT, list)[0]?.usage).toBe(USAGE)
  })

  it('keeps only descendants: a sibling branch and a plain fork are outside the tree', () => {
    const list = listOf([
      row({ id: PARENT }),
      row({ id: OTHER, parentId: PARENT, displayTitle: 'Fork', usage: USAGE }),
      row({ id: CHILD, parentId: OTHER, origin: 'subagent', displayTitle: 'Elsewhere', usage: USAGE }),
    ])
    expect(subagentCostSources(PARENT, list)).toEqual([])
  })

  it('reports a child whose usage value has not arrived with no usage', () => {
    const list = listOf([row({ id: PARENT }), row({ id: CHILD, parentId: PARENT, origin: 'subagent' })])
    const sources = subagentCostSources(PARENT, list)
    expect(sources).toHaveLength(1)
    expect(sources[0]?.usage).toBeUndefined()
  })

  it('prefers the loaded catalog label and falls back to the display title', () => {
    const list = listOf([
      row({ id: PARENT }),
      row({ id: CHILD, parentId: PARENT, origin: 'subagent', displayTitle: 'child id title' }),
    ])
    expect(subagentCostSources(PARENT, withCatalog(PARENT, list, childEntry(CHILD, 'Docs relay')))[0]?.label)
      .toBe('Docs relay')
    // A catalog without a row for the child (or no label on it) leaves the
    // list row's own name in place.
    expect(subagentCostSources(PARENT, list)[0]?.label).toBe('child id title')
    expect(subagentCostSources(PARENT, withCatalog(PARENT, list, childEntry(CHILD, undefined)))[0]?.label)
      .toBe('child id title')
  })

  it('stops at a lineage cycle instead of walking forever', () => {
    // Rows merge while the list hydrates; a transient cycle must not hang the
    // render that reads it.
    const list = listOf([
      row({ id: PARENT }),
      row({ id: CHILD, parentId: PARENT, origin: 'subagent', displayTitle: 'Docs relay' }),
      row({ id: GRANDCHILD, parentId: CHILD, origin: 'subagent', displayTitle: 'Sub relay' }),
    ])
    const cyclic: SessionListState = {
      ...list,
      byId: { ...list.byId, [PARENT]: { ...list.byId[PARENT]!, parentId: GRANDCHILD, origin: 'subagent' } },
    }
    expect(subagentCostSources(PARENT, cyclic).map(source => source.sessionId)).toEqual([CHILD, GRANDCHILD])
  })
})
