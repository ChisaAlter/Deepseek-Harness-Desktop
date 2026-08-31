/**
 * Composer submission policy. It owns the live busy-Enter
 * preference and resolves keyboard gestures into queue/steer delivery modes;
 * Host and Agent keep the actual delivery-window authority.
 */
import {
  createSnapshotStore, type SettingsScope, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  BusyEnterBehavior, ComposerSubmitGesture, InputSubmitMode,
} from '../contract/composer-submission.ts'
import {
  BUSY_ENTER_FIELD, COMPOSER_BEAM_FIELD, COMPOSER_RESIZE_FIELD,
  COMPOSER_RESIZE_HEIGHT_FIELD, COMPOSER_RESIZE_WIDTH_FIELD,
  DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_COMPOSER_BEAM, DEFAULT_COMPOSER_RESIZE,
  DEFAULT_COMPOSER_RESIZE_HEIGHT, DEFAULT_COMPOSER_RESIZE_WIDTH,
  DEFAULT_STATS_LINE, DEFAULT_VIEW_TABS, STATS_LINE_FIELD, VIEW_TABS_FIELD,
} from '../../submission-settings.ts'
import type { ConversationSettings } from '../../submission-settings.ts'

export {
  DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_COMPOSER_BEAM, DEFAULT_COMPOSER_RESIZE,
  DEFAULT_COMPOSER_RESIZE_HEIGHT, DEFAULT_COMPOSER_RESIZE_WIDTH,
  DEFAULT_STATS_LINE, DEFAULT_VIEW_TABS,
} from '../../submission-settings.ts'

/** Last drag-committed composer box size (null = that axis is not customized). */
export interface ComposerResizeSize {
  height: number | null
  width: number | null
}

/**
 * Busy-Enter policy used by both the composer inject face and its Settings row.
 * Direct `steer` is intentionally best-effort: AgentLoop turns a closed-window
 * submission into the next waking Queue item.
 */
export class ComposerSubmissionPolicy {
  /** Reactive preference source for the Settings row. */
  readonly busyEnter: SnapshotStore<BusyEnterBehavior> = createSnapshotStore(DEFAULT_BUSY_ENTER_BEHAVIOR)
  /** Reactive composer-beam source for the Settings row and InputBar. */
  readonly composerBeam: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_COMPOSER_BEAM)
  /** Reactive composer drag-resize source for the Settings row and InputBar. */
  readonly composerResize: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_COMPOSER_RESIZE)
  /** Reactive last-dragged scrollport height for InputBar / ApprovalPanel remounts. */
  readonly composerResizeHeight: SnapshotStore<number | null> = createSnapshotStore(DEFAULT_COMPOSER_RESIZE_HEIGHT)
  /** Reactive last-dragged card width for InputBar / ApprovalPanel remounts. */
  readonly composerResizeWidth: SnapshotStore<number | null> = createSnapshotStore(DEFAULT_COMPOSER_RESIZE_WIDTH)
  /** Reactive stats-strip source for the Settings row and StatsLine. */
  readonly statsLine: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_STATS_LINE)
  /** Reactive view-tablist source for the Settings row and ConversationSessionHeader. */
  readonly viewTabs: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_VIEW_TABS)
  /** Host writability for the Interface Switch; true when no scope is bound. */
  readonly writable: SnapshotStore<boolean>
  private readonly host: SettingsScope<ConversationSettings> | undefined

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime — a disposed scope never publishes again, so
   * the policy needs no release hook.
   */
  constructor(host?: SettingsScope<ConversationSettings>) {
    this.host = host
    this.writable = createSnapshotStore(host === undefined)
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Resolve one keyboard gesture without changing state.
   * @param running - whether the addressed agent currently reports busy.
   * @param gesture - plain Enter or the Cmd/Ctrl-accelerated chord.
   * @param steeringAvailable - whether this session transport supports steering.
   * @returns Queue outside steer-capable busy state; otherwise the preferred mode or its opposite.
   */
  resolve(
    running: boolean,
    gesture: ComposerSubmitGesture,
    steeringAvailable: boolean,
  ): InputSubmitMode {
    if (!running || !steeringAvailable) return 'queue'
    const preferred = this.busyEnter.getSnapshot()
    if (gesture === 'enter') return preferred
    return preferred === 'queue' ? 'steer' : 'queue'
  }

  /**
   * Change the plain-Enter behavior used during busy state; the live value
   * publishes before the durable write starts.
   * @param behavior - Queue or Steer.
   */
  setBusyEnter(behavior: BusyEnterBehavior): void {
    if (this.busyEnter.getSnapshot() === behavior) return
    this.busyEnter.set(behavior)
    void this.host?.set(BUSY_ENTER_FIELD, behavior)
  }

  /**
   * Change whether the composer plays the send/think border beam; the live
   * value publishes before the durable write starts.
   * @param value - true paints `.cardBeam`; false suppresses it.
   */
  setComposerBeam(value: boolean): void {
    if (this.composerBeam.getSnapshot() === value) return
    this.composerBeam.set(value)
    void this.host?.set(COMPOSER_BEAM_FIELD, value)
  }

  /**
   * Change whether the composer text box can be drag-resized; the live value
   * publishes before the durable write starts. Turning resize off also clears
   * any remembered box size so the next opt-in starts from auto-grow.
   * @param value - true shows the edge handles; false restores auto-grow.
   */
  setComposerResize(value: boolean): void {
    if (this.composerResize.getSnapshot() === value) return
    this.composerResize.set(value)
    void this.host?.set(COMPOSER_RESIZE_FIELD, value)
  }

  /**
   * Remember the last dragged composer box so remounts / session switches
   * restore it while resize stays enabled.
   * @param size - axes to update; omitted axes keep their previous value.
   */
  setComposerResizeSize(size: Partial<ComposerResizeSize>): void {
    if (size.height !== undefined && this.composerResizeHeight.getSnapshot() !== size.height) {
      this.composerResizeHeight.set(size.height)
      if (size.height !== null) void this.host?.set(COMPOSER_RESIZE_HEIGHT_FIELD, size.height)
    }
    if (size.width !== undefined && this.composerResizeWidth.getSnapshot() !== size.width) {
      this.composerResizeWidth.set(size.width)
      if (size.width !== null) void this.host?.set(COMPOSER_RESIZE_WIDTH_FIELD, size.width)
    }
  }

  /**
   * Change whether the composer dock paints the session stats strip; the live
   * value publishes before the durable write starts.
   * @param value - true paints StatsLine figures; false hides them and keeps the row gap.
   */
  setStatsLine(value: boolean): void {
    if (this.statsLine.getSnapshot() === value) return
    this.statsLine.set(value)
    void this.host?.set(STATS_LINE_FIELD, value)
  }

  /**
   * Change whether the session header paints Chat/Trajectory tabs; the live
   * value publishes before the durable write starts.
   * @param value - true paints the tablist when more than one view exists.
   */
  setViewTabs(value: boolean): void {
    if (this.viewTabs.getSnapshot() === value) return
    this.viewTabs.set(value)
    void this.host?.set(VIEW_TABS_FIELD, value)
  }

  /**
   * Adopt the scope's accepted durable behavior without writing it back.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: SettingsScope<ConversationSettings>): void {
    const snap = host.getSnapshot()
    if (this.writable.getSnapshot() !== snap.writable) this.writable.set(snap.writable)
    const section = snap.value
    if (section === undefined) return
    if (this.busyEnter.getSnapshot() !== section.busyEnter) this.busyEnter.set(section.busyEnter)
    const nextBeam = section.composerBeam !== false
    if (this.composerBeam.getSnapshot() !== nextBeam) this.composerBeam.set(nextBeam)
    const nextResize = section.composerResize === true
    if (this.composerResize.getSnapshot() !== nextResize) this.composerResize.set(nextResize)
    const nextHeight = typeof section.composerResizeHeight === 'number' ? section.composerResizeHeight : null
    if (this.composerResizeHeight.getSnapshot() !== nextHeight) this.composerResizeHeight.set(nextHeight)
    const nextWidth = typeof section.composerResizeWidth === 'number' ? section.composerResizeWidth : null
    if (this.composerResizeWidth.getSnapshot() !== nextWidth) this.composerResizeWidth.set(nextWidth)
    const nextStats = section.statsLine !== false
    if (this.statsLine.getSnapshot() !== nextStats) this.statsLine.set(nextStats)
    const nextTabs = section.viewTabs !== false
    if (this.viewTabs.getSnapshot() !== nextTabs) this.viewTabs.set(nextTabs)
  }
}
