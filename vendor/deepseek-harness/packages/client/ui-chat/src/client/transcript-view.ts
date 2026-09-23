/** Host-backed work-details presentation policy. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_TRANSCRIPT_VIEW_MODE, LEGACY_TRANSCRIPT_VIEW_MODE, TRANSCRIPT_VIEW_FIELD,
  type ChatSettings, type TranscriptViewMode,
} from '../chat-settings.ts'

/** Live work-details preference consumed by Chat and its Settings row. */
export class TranscriptViewPolicy {
  private readonly unsubscribe: () => void
  /** Reactive current mode; defaults to Compact before Host settings arrive. */
  readonly mode: SnapshotStore<TranscriptViewMode> = createSnapshotStore(DEFAULT_TRANSCRIPT_VIEW_MODE)

  /**
   * @param host - durable Chat settings scope.
   */
  constructor(private readonly host: ConfigForm<ChatSettings>) {
    this.unsubscribe = host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /** Release the accepted-value subscription. */
  dispose(): void { this.unsubscribe() }

  /**
   * Publish and persist one explicit user choice.
   * @param mode - Compact, Detailed, or Expanded work details.
   */
  setMode(mode: TranscriptViewMode): void {
    if (this.mode.getSnapshot() === mode) return
    this.mode.set(mode)
    void this.host.set(TRANSCRIPT_VIEW_FIELD, mode)
  }

  /** Adopt the latest accepted Host section without writing it back. */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    const mode = section.transcriptView === LEGACY_TRANSCRIPT_VIEW_MODE ? 'detailed' : section.transcriptView
    if (this.mode.getSnapshot() !== mode) this.mode.set(mode)
  }
}
