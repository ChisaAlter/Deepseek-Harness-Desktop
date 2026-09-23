/** Preset roster and selection policy for the settings section. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AgentPresetRow } from '@deepseek-ai/dsh-agent-preset-registry/types'
import { writeDefaultPreset, writeModeSelectionEnabled } from './settings-store.ts'

/** Settings page state. */
export interface AgentPresetSectionState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  showPicker: boolean
  policySaving: boolean
  rows: readonly AgentPresetRow[]
}
const INITIAL: AgentPresetSectionState = { status: 'idle', error: null, showPicker: true, policySaving: false, rows: [] }
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** Loads the roster and writes the default and chooser policy. */
export class AgentPresetSectionController {
  /** Observable roster and selection state. */
  readonly store: SnapshotStore<AgentPresetSectionState> = createSnapshotStore(INITIAL)
  private loading: Promise<void> | undefined
  constructor(private readonly ctx: Context) {}

  private set(patch: Partial<AgentPresetSectionState>): void { this.store.set({ ...this.store.getSnapshot(), ...patch }) }

  /** Refresh the roster; concurrent calls share one read.
   * @returns Once the roster read settles.
   */
  load(): Promise<void> {
    return this.loading ??= this.readRoster().finally(() => { this.loading = undefined })
  }
  private async readRoster(): Promise<void> {
    try {
      const result = await this.ctx.remote.agentPresets.list()
      if (!result.ok) throw new Error(result.error.message)
      this.set({ status: 'ready', error: null, rows: result.value.presets, showPicker: result.value.modeSelectionEnabled })
    } catch (error) { this.set({ status: 'error', error: message(error) }) }
  }

  /** Set the default and synchronize the current blank task when supplied.
   * @param id Selected default.
   * @param sync Blank-session synchronization callback.
   * @returns Once saved and refreshed.
   */
  async makeDefault(id: string, sync?: (id: string) => Promise<string | undefined>): Promise<void> {
    if (!this.store.getSnapshot().showPicker) return
    await this.policy(() => writeDefaultPreset(this.ctx, id), sync)
  }
  /** Change chooser visibility.
   * @param visible Whether the chooser is visible.
   * @param sync Blank-session synchronization callback.
   * @returns Once saved and refreshed.
   */
  async setPickerVisible(visible: boolean, sync?: (id: string) => Promise<string | undefined>): Promise<void> {
    await this.policy(() => writeModeSelectionEnabled(this.ctx, visible), sync)
  }
  private async policy(write: () => Promise<string | undefined>, sync?: (id: string) => Promise<string | undefined>): Promise<void> {
    if (this.store.getSnapshot().policySaving) return
    this.set({ policySaving: true, error: null })
    try {
      const error = await write()
      await this.load()
      if (error !== undefined) throw new Error(error)
      const selected = this.store.getSnapshot().rows.find(row => row.isDefault)
      if (selected !== undefined) {
        const error = await sync?.(selected.id)
        if (error !== undefined) throw new Error(error)
      }
    } catch (error) { this.set({ error: message(error) }) }
    finally { this.set({ policySaving: false }) }
  }
}
