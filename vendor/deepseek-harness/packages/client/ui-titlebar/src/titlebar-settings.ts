/** Titlebar panel-toggle visibility stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the titlebar plugin. */
export const TITLEBAR_SETTINGS_NAMESPACE = 'ui-titlebar'

/** Field carrying whether the terminal-drawer titlebar button is drawn. */
export const TERMINAL_TOGGLE_FIELD = 'terminalToggle'

/** Field carrying whether the surfaces-column titlebar button is drawn. */
export const SURFACES_TOGGLE_FIELD = 'surfacesToggle'

/** Default keeps both panel toggles in the titlebar trailing row. */
export const DEFAULT_PANEL_TOGGLE = true

/** Durable titlebar section shared by the Host schema and the browser scope. */
export interface TitlebarSettings {
  /** Whether PanelToggles paints the terminal-drawer button. */
  terminalToggle: boolean
  /** Whether PanelToggles paints the surfaces-column button. */
  surfacesToggle: boolean
}

/** Durable titlebar schema; also the wire envelope the browser scope validates against. */
export const TitlebarSettingsSchema: z<TitlebarSettings> = z.object({
  [TERMINAL_TOGGLE_FIELD]: z.boolean().default(DEFAULT_PANEL_TOGGLE),
  [SURFACES_TOGGLE_FIELD]: z.boolean().default(DEFAULT_PANEL_TOGGLE),
})
