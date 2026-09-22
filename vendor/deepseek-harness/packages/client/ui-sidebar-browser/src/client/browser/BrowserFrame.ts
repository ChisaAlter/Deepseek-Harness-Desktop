/** BrowserFrame interface and the current iframe implementation. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserTarget } from './url.ts'

/** One prepared document rendered by a BrowserFrame implementation. */
export interface BrowserDocument {
  readonly target: BrowserTarget
  readonly src: string
  readonly revision: number
}

/** Current renderer-facing state for one Browser tab. */
export interface BrowserFrameState {
  readonly document: BrowserDocument | undefined
  readonly sandboxed: boolean
  readonly loadFailed: boolean
}

/** Browser rendering operations shared by Web and future Electron implementations. */
export interface BrowserFrame extends HostObservable<BrowserFrameState> {
  /** Toggle sandbox enforcement for this tab occurrence. */
  toggleSandbox(): void
  /** @param document - current prepared document. */
  setDocument(document: BrowserDocument): void
  /** Remove the current prepared document. */
  clearDocument(): void
  /** @param revision - rendered document revision reported by the carrier. */
  reportLoaded(revision: number): void
  /** @param revision - rendered document revision whose carrier reported an error. */
  reportLoadFailed(revision: number): void
}

/** Owns transient iframe and sandbox-toggle state independently from URL navigation. */
export class IframeImpl implements BrowserFrame {
  private readonly store: SnapshotStore<BrowserFrameState> = createSnapshotStore({
    document: undefined,
    sandboxed: true,
    loadFailed: false,
  })

  /**
   * @param sandboxChanged - applies the new policy to the current controlled target.
   * @param documentLoaded - reports an iframe load to the navigation state machine.
   */
  constructor(
    private readonly sandboxChanged: (sandboxed: boolean) => void,
    private readonly documentLoaded: (revision: number) => void,
  ) {}

  /** @returns the immutable renderer snapshot. */
  getSnapshot = (): BrowserFrameState => this.store.getSnapshot()

  /**
   * Subscribe to iframe or sandbox-mode changes.
   * @param listener - invalidation callback.
   * @returns the unsubscribe function.
   */
  subscribe = (listener: () => void): (() => void) => this.store.subscribe(listener)

  /** Toggle sandbox enforcement for this tab occurrence. */
  toggleSandbox(): void {
    const current = this.store.getSnapshot()
    const sandboxed = !current.sandboxed
    this.store.set({ ...current, sandboxed })
    this.sandboxChanged(sandboxed)
  }

  /**
   * Publish a prepared frame from the owning controller.
   * @param document - current prepared document.
   */
  setDocument(document: BrowserDocument): void {
    this.store.set({ ...this.store.getSnapshot(), document, loadFailed: false })
  }

  /** Remove the current prepared frame and transient load failure. */
  clearDocument(): void {
    const current = this.store.getSnapshot()
    const { document } = current
    if (document !== undefined) {
      this.store.set({ ...current, document: undefined, loadFailed: false })
    }
  }

  /** @param revision - rendered document revision reported by the iframe. */
  reportLoaded(revision: number): void {
    this.documentLoaded(revision)
  }

  /** @param revision - rendered document revision whose iframe emitted `error`. */
  reportLoadFailed(revision: number): void {
    const current = this.store.getSnapshot()
    if (current.document?.revision !== revision || current.loadFailed) return
    this.store.set({ ...current, loadFailed: true })
  }
}
