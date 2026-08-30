// ComposerModelFactRegistry: push-contract semantics over per-session stores.

import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { ComposerModelFactRegistry } from '../src/client/input/model-facts.ts'

const A = 'a' as SessionId
const B = 'b' as SessionId

describe('ComposerModelFactRegistry', () => {
  it('publishes idempotently: an equal fact notifies nobody', () => {
    const registry = new ComposerModelFactRegistry()
    const store = registry.storeFor(A)
    const observed: (string | null)[] = []
    store.subscribe(() => { observed.push(store.getSnapshot().provider) })
    registry.set(A, { provider: 'deepseek-official' })
    registry.set(A, { provider: 'deepseek-official' })
    expect(observed).toEqual(['deepseek-official'])
    expect(store.getSnapshot()).toEqual({ provider: 'deepseek-official' })
  })

  it('caches one store per session and forgets on scope teardown', () => {
    const registry = new ComposerModelFactRegistry()
    expect(registry.storeFor(A)).toBe(registry.storeFor(A))
    expect(registry.storeFor(B)).not.toBe(registry.storeFor(A))
    expect(registry.storeFor(B).getSnapshot()).toEqual({ provider: null })
    registry.set(A, { provider: 'deepseek' })
    registry.forget(A)
    // A forgotten session re-reads as an unknown route, never the stale one.
    expect(registry.storeFor(A).getSnapshot()).toEqual({ provider: null })
  })
})
