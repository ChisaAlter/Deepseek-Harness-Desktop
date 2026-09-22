/** Session-log titlebar visibility stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the Session-log export plugin. */
export const SESSION_LOG_EXPORT_SETTINGS_NAMESPACE = 'session-log-export'

/** Field carrying whether the titlebar Session log button is drawn. */
export const TITLEBAR_ACTION_FIELD = 'titlebarAction'

/** Default keeps the Session log capsule in the titlebar trailing row. */
export const DEFAULT_TITLEBAR_ACTION = true

/** Durable Session-log section shared by the Host schema and the browser scope. */
export interface SessionLogExportSettings {
  /** Whether HeaderAction paints the Session log button. */
  titlebarAction: boolean
}

/** Durable Session-log schema; also the wire envelope the browser scope validates against. */
export const SessionLogExportSettingsSchema: z<SessionLogExportSettings> = z.object({
  [TITLEBAR_ACTION_FIELD]: z.boolean().default(DEFAULT_TITLEBAR_ACTION),
})
