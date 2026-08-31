/**
 * Composer model facts: the one way another plugin shares the session's
 * current model route with the composer docks.
 *
 * The same dependency rule as the composer blocks (`blocks.ts`) applies — the
 * dependency runs ui-model-selection → ui-conversation, never back — so the
 * plugin that owns the authoritative model directory pushes the route here
 * and the composer-dock entries read their own session's store. The fact is
 * informational (a provider route id), deliberately separate from blocks: a
 * fact must never make the input inert, and a block must never carry
 * presentation data.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One session's current model-route fact. */
export interface ComposerModelFact {
  /**
   * Provider route id of the session's next assembled step; null means the
   * route is unknown (directory not loaded yet, or no model-selection plugin
   * composed). Consumers treat null as "no fact", never as a route name.
   */
  readonly provider: string | null
}

/** The registry face other plugins reach through `ctx.conversation.modelFacts`. */
export interface ComposerModelFacts {
  /**
   * Publish this session's current route. Idempotent: republishing an equal
   * fact notifies nobody.
   * @param sessionId - the session the route belongs to.
   * @param fact - the current route, or a null-provider fact to clear it.
   */
  set(sessionId: SessionId, fact: ComposerModelFact): void
  /**
   * The store one composer-dock entry subscribes to for a session. Created on
   * first read from either side, so a publish may land before the dock mounts.
   * @param sessionId - the session to observe.
   * @returns that session's fact store.
   */
  storeFor(sessionId: SessionId): SnapshotStore<ComposerModelFact>
  /**
   * Drop one session's store alongside the session scope.
   * @param sessionId - the session being torn down.
   */
  forget(sessionId: SessionId): void
}

/** The per-session composer-model-fact registry (one instance per plugin fiber). */
export class ComposerModelFactRegistry implements ComposerModelFacts {
  private readonly stores = new Map<SessionId, SnapshotStore<ComposerModelFact>>()

  /** @inheritdoc */
  set(sessionId: SessionId, fact: ComposerModelFact): void {
    const store = this.storeFor(sessionId)
    if (store.getSnapshot().provider === fact.provider) return
    store.set(fact)
  }

  /** @inheritdoc */
  storeFor(sessionId: SessionId): SnapshotStore<ComposerModelFact> {
    const existing = this.stores.get(sessionId)
    if (existing !== undefined) return existing
    const created = createSnapshotStore<ComposerModelFact>({ provider: null })
    this.stores.set(sessionId, created)
    return created
  }

  /** @inheritdoc */
  forget(sessionId: SessionId): void {
    this.stores.delete(sessionId)
  }
}

/** Shared empty catalog: one reference keeps republishes notification-free. */
const EMPTY_CATALOG: readonly ComposerCatalogModel[] = []

/** One advertised model: its id and the provider route serving it. */
export interface ComposerCatalogModel {
  /** Provider route id serving the model (e.g. `deepseek`). */
  readonly provider: string
  /** Provider-owned model id. */
  readonly id: string
}

/**
 * The registry face other plugins reach through `ctx.conversation.modelCatalog`:
 * the models the session's directory currently advertises, in
 * provider-preferred order. The price panel merges them into its dropdown (a
 * non-official `deepseek-v4` model displays its provider id as a prefix) so
 * every available model can be priced without manual entry. Informational
 * like {@link ComposerModelFacts} — separate from it because the fact shape
 * is pinned to `{provider}`.
 */
export interface ComposerModelCatalog {
  /**
   * Publish this session's advertised models. Idempotent for an equal list.
   * @param sessionId - the session the catalog belongs to.
   * @param models - provider-preferred advertised models.
   */
  set(sessionId: SessionId, models: readonly ComposerCatalogModel[]): void
  /**
   * The store one consumer subscribes to for a session. Created on first read
   * from either side, so a publish may land before the consumer mounts.
   * @param sessionId - the session to observe.
   * @returns that session's catalog store.
   */
  storeFor(sessionId: SessionId): SnapshotStore<readonly ComposerCatalogModel[]>
  /**
   * Drop one session's store alongside the session scope.
   * @param sessionId - the session being torn down.
   */
  forget(sessionId: SessionId): void
}

/** The per-session model-catalog registry (one instance per plugin fiber). */
export class ComposerModelCatalogRegistry implements ComposerModelCatalog {
  private readonly stores = new Map<SessionId, SnapshotStore<readonly ComposerCatalogModel[]>>()

  /** @inheritdoc */
  set(sessionId: SessionId, models: readonly ComposerCatalogModel[]): void {
    const store = this.storeFor(sessionId)
    const current = store.getSnapshot()
    if (
      current.length === models.length
      && current.every((entry, index) => entry.provider === models[index]?.provider && entry.id === models[index]?.id)
    ) return
    store.set([...models])
  }

  /** @inheritdoc */
  storeFor(sessionId: SessionId): SnapshotStore<readonly ComposerCatalogModel[]> {
    const existing = this.stores.get(sessionId)
    if (existing !== undefined) return existing
    const created = createSnapshotStore<readonly ComposerCatalogModel[]>(EMPTY_CATALOG)
    this.stores.set(sessionId, created)
    return created
  }

  /** @inheritdoc */
  forget(sessionId: SessionId): void {
    this.stores.delete(sessionId)
  }
}
