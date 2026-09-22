/** Git titlebar visibility stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the git plugin. */
export const GIT_SETTINGS_NAMESPACE = 'ui-git'

/** Field carrying whether the titlebar Git cluster is drawn. */
export const TITLEBAR_GIT_FIELD = 'titlebarGit'

/** Default keeps the Git cluster in the titlebar trailing row. */
export const DEFAULT_TITLEBAR_GIT = true

/** Durable git section shared by the Host schema and the browser scope. */
export interface GitSettings {
  /** Whether GitActionsControl paints the init / branch / commit cluster. */
  titlebarGit: boolean
}

/** Durable git schema; also the wire envelope the browser scope validates against. */
export const GitSettingsSchema: z<GitSettings> = z.object({
  [TITLEBAR_GIT_FIELD]: z.boolean().default(DEFAULT_TITLEBAR_GIT),
})
