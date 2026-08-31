/** Registers the titlebar panel toggles into the layout-owned trailing cluster. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PanelTogglesInjected } from './PanelToggles.tsx'
import { PanelToggles } from './PanelToggles.tsx'
import type { PanelToggleRowInjected } from './PanelToggleRow.tsx'
import { SurfacesToggleRow, TerminalToggleRow } from './PanelToggleRow.tsx'
import { ChromeVisibility } from './chrome-visibility.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import {
  SURFACES_TOGGLE_FIELD, TERMINAL_TOGGLE_FIELD, TITLEBAR_SETTINGS_NAMESPACE,
  type TitlebarSettings,
} from '../titlebar-settings.ts'
import { en, NS, zh, type TitlebarKey } from './locales.ts'

export type { PanelTogglesInjected, PanelTogglesProps } from './PanelToggles.tsx'
export type { TitlebarKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Titlebar panel-toggle copy. */
    titlebar: TitlebarKey
  }
}

/** Services required by the titlebar plugin. */
export const inject = ['slots', 'layout', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Register the dictionaries, inject the panel toggles at order 40, and
 * contribute the Interface Settings rows.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-titlebar: dictionaries')

  const host = ctx.settingsScope.bind<TitlebarSettings>({ namespace: TITLEBAR_SETTINGS_NAMESPACE })
  const terminalChrome = new ChromeVisibility(host, TERMINAL_TOGGLE_FIELD)
  const surfacesChrome = new ChromeVisibility(host, SURFACES_TOGGLE_FIELD)

  ctx.slots.inject('shell.titlebar.trailing', () => ctx.slots.register({
    name: 'shell.titlebar.trailing',
    id: 'panel-toggles',
    order: 40,
    locale: NS,
    inject: (): PanelTogglesInjected => ({
      toggleSurfaces: () => { ctx.layout.toggleSurfaces() },
      toggleTerminalDrawer: () => { ctx.layout.toggleTerminalDrawer() },
      hooks: {
        terminalToggle: terminalChrome.visible,
        surfacesToggle: surfacesChrome.visible,
      },
    }),
  }, PanelToggles))

  ctx.slots.inject('settings.interface.item', () => ctx.slots.register({
    name: 'settings.interface.item',
    id: 'terminal-toggle',
    order: 30,
    locale: NS,
    inject: (): PanelToggleRowInjected => ({
      hooks: { visible: terminalChrome.visible, writable: terminalChrome.writable },
      setVisible: (value) => { terminalChrome.setVisible(value) },
    }),
  }, TerminalToggleRow))

  ctx.slots.inject('settings.interface.item', () => ctx.slots.register({
    name: 'settings.interface.item',
    id: 'surfaces-toggle',
    order: 40,
    locale: NS,
    inject: (): PanelToggleRowInjected => ({
      hooks: { visible: surfacesChrome.visible, writable: surfacesChrome.writable },
      setVisible: (value) => { surfacesChrome.setVisible(value) },
    }),
  }, SurfacesToggleRow))
}
