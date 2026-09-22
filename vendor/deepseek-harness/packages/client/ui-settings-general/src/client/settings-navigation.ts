import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type ObservableSnapshot, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Observable viewing state shared by the Settings shell and its callers. */
export interface SettingsNavigationSnapshot {
  /** Whether the Settings shell is open. */
  readonly open: boolean
  /** Requested section id; the shell resolves unknown ids to its first row. */
  readonly sectionId: string | undefined
}

/** Client service for opening the existing Settings shell at a section. */
export interface SettingsNavigation extends ObservableSnapshot<SettingsNavigationSnapshot> {
  /**
   * Open the Settings shell and optionally request a registered section.
   * @param sectionId - requested section id; omitted, empty, or unknown ids use the shell's first row.
   * @returns nothing.
   */
  open(sectionId?: string): void
  /**
   * Close the Settings shell and clear its requested section.
   * @returns nothing.
   */
  close(): void
}

/** Cordis provider for the shared Settings navigation state. */
export class SettingsNavigationService extends Service implements SettingsNavigation {
  private readonly store: SnapshotStore<SettingsNavigationSnapshot> = createSnapshotStore({
    open: false,
    sectionId: undefined,
  })

  /**
   * @param ctx - context whose fiber owns this service's lifetime.
   */
  constructor(ctx: Context) {
    super(ctx, 'settingsNavigation')
  }

  /**
   * Read the current Settings navigation snapshot.
   * @returns the stable snapshot until the next state change.
   */
  getSnapshot(): SettingsNavigationSnapshot {
    return this.store.getSnapshot()
  }

  /**
   * Subscribe to Settings navigation snapshot changes.
   * @param listener - callback invoked after a state change.
   * @returns disposer removing the listener.
   */
  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  /**
   * Publish an open request for the Settings shell.
   * @param sectionId - requested section id; omitted, empty, or unknown ids use the shell's first row.
   * @returns nothing.
   */
  open(sectionId?: string): void {
    const requested = sectionId === '' ? undefined : sectionId
    const current = this.store.getSnapshot()
    if (current.open && current.sectionId === requested) return
    this.store.set({ open: true, sectionId: requested })
  }

  /**
   * Publish a closed state for the Settings shell.
   * @returns nothing.
   */
  close(): void {
    const current = this.store.getSnapshot()
    if (!current.open && current.sectionId === undefined) return
    this.store.set({ open: false, sectionId: undefined })
  }
}
