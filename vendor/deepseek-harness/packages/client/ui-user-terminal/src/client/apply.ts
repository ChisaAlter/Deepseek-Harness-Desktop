/** Registers the bottom-drawer and right-panel Terminal shells on separate stores. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-surfaces/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { appendToDraft } from './draft.ts'
import { OPEN_SURFACE_EVENT, PENDING_PREVIEW_URL_KEY } from './links.ts'
import { formatTerminalDraft } from './selection.ts'
import { TerminalDrawer } from './TerminalDrawer.tsx'
import { TerminalSurface } from './TerminalSurface.tsx'
import { en, NS, zh, type TerminalKey } from './locales.ts'
import { bindPtyListeners } from './pty-bridge.ts'
import { readPtyShell, type TerminalShellInjected } from './shell.ts'
import { createTerminalSessionStore } from './stores.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

export type { TerminalDrawerProps } from './TerminalDrawer.tsx'
export type { TerminalSurfaceProps } from './TerminalSurface.tsx'
export type { TerminalKey } from './locales.ts'
export type { TerminalShellInjected } from './shell.ts'
export { createTerminalSessionStore, MAX_TERMINALS_PER_GROUP } from './stores.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** User-terminal drawer and surface copy. */
    terminal: TerminalKey
  }
}

/** Services required by the user-terminal plugin. */
export const inject = ['slots', 'layout', 'locale']

interface WorkspacesFace {
  openPath?: (path: string, options?: { line?: number }) => Promise<void>
}

function layoutFace(ctx: Context): Pick<TerminalShellInjected, 'toggleTerminalDrawer' | 'setTerminalDrawer'> {
  return {
    toggleTerminalDrawer: () => { ctx.layout.toggleTerminalDrawer() },
    setTerminalDrawer: px => { ctx.layout.setTerminalDrawer(px) },
  }
}

function workflowFace(ctx: Context): Pick<
  TerminalShellInjected,
  'mentionTerminal' | 'writeClipboard' | 'openWorkspacePath' | 'openLocalUrl' | 'openExternal'
> {
  return {
    mentionTerminal: (sessionId, text) => {
      const fragment = formatTerminalDraft(text)
      if (fragment.length === 0) return
      appendToDraft(ctx, sessionId, fragment)
    },
    writeClipboard: async (text) => {
      const clipboard = globalThis.navigator?.clipboard
      if (clipboard === undefined) return
      await clipboard.writeText(text)
    },
    openWorkspacePath: (absolutePath, options) => {
      const workspaces = ctx.get('workspaces') as WorkspacesFace | undefined
      if (options === undefined) void workspaces?.openPath?.(absolutePath)
      else void workspaces?.openPath?.(absolutePath, options)
    },
    openLocalUrl: (url) => {
      try {
        sessionStorage.setItem(PENDING_PREVIEW_URL_KEY, url)
      } catch {
        // Quota / SecurityError: Preview still listens for the event when mounted.
      }
      window.dispatchEvent(new CustomEvent(OPEN_SURFACE_EVENT, { detail: { kind: 'preview', url } }))
      ctx.layout.openSurfaces()
    },
    openExternal: (url) => {
      const shell = (window as Window & { shell?: { openExternal?: (next: string) => Promise<unknown> } }).shell
      void shell?.openExternal?.(url)
    },
  }
}

/**
 * Register dictionaries and inject each terminal shell onto its own store handle.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-user-terminal: dictionaries')
  const drawerStore = createTerminalSessionStore()
  const surfaceStore = createTerminalSessionStore()
  ctx.effect(
    () => bindPtyListeners([drawerStore, surfaceStore], readPtyShell()),
    'ui-user-terminal: pty bridge',
  )
  const injected = (): TerminalShellInjected => ({
    ...readPtyShell(),
    ...layoutFace(ctx),
    ...workflowFace(ctx),
  })

  ctx.slots.inject('shell.terminalDrawer', () => ctx.slots.register({
    name: 'shell.terminalDrawer',
    store: drawerStore,
    locale: NS,
    inject: injected,
  }, TerminalDrawer))

  ctx.slots.inject('surfaces.terminal', () => ctx.slots.register({
    name: 'surfaces.terminal',
    store: surfaceStore,
    locale: NS,
    inject: injected,
  }, TerminalSurface))
}
