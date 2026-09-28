/**
 * Host-backed boolean that hides titlebar chrome without unloading the owner.
 * Loading, unavailable, and remote-memory snapshots keep the local initial
 * default until a concrete section arrives; `value[field] === true` is the
 * only show predicate.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'

/**
 * Live visibility plus Host writability for one boolean chrome field.
 * @typeParam T - durable section whose named field is the chrome flag.
 */
/* jscpd:ignore-start */
export class ChromeVisibility<T extends { [K in keyof T]: boolean }> {
  /** Whether the titlebar cluster/button should paint. */
  readonly visible: SnapshotStore<boolean>
  /** Whether the Interface Switch may write. False while the scope is loading. */
  readonly writable: SnapshotStore<boolean> = createSnapshotStore(false)

  /**
   * @param host - durable preference scope owned by the providing plugin.
   * @param field - section field that draws the cluster when explicitly true.
   * @param initial - local default while no concrete section has arrived.
   */
  constructor(
    private readonly host: ConfigForm<T>,
    private readonly field: keyof T & string,
    private readonly initial = true,
  ) {
    this.visible = createSnapshotStore(initial)
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish a visibility change locally, then start the durable write.
   * @param value - true draws the chrome; false hides the button cluster only.
   */
  setVisible(value: boolean): void {
    if (this.visible.getSnapshot() === value) return
    this.visible.set(value)
    void this.host.set(this.field, value)
  }

  /**
   * Adopt a Host section without writing it back. An undefined section (loading
   * or remote memory) leaves the local initial default in place.
   */
  private adopt(): void {
    const snap = this.host.getSnapshot()
    if (this.writable.getSnapshot() !== snap.writable) this.writable.set(snap.writable)
    const section = snap.value
    if (section === undefined) return
    const next = this.initial ? section[this.field] !== false : section[this.field] === true
    if (this.visible.getSnapshot() !== next) this.visible.set(next)
  }
}
/* jscpd:ignore-end */
