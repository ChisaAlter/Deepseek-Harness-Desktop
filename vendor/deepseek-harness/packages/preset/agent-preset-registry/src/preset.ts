import type { Volatile } from '@deepseek-ai/cordis'
/** Public preset roster and selection configuration. */
/** One declared preset and its current activation failure, if any. */
export interface AgentPreset {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
  readonly broken?: string
}

/** Registry selection policy. */
export interface Config {
  /** Deployment default when the caller omits a preset. */
  default: string
  /** User-selected default while the chooser is shown; edited through Settings. */
  selectedDefault: Volatile<string | undefined>
  /** Whether new-session surfaces expose preset selection and the saved default applies. */
  modeSelectionEnabled: Volatile<boolean>
}
