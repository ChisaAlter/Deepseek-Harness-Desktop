/**
 * Registers the bottom-drawer Terminal shell. The right-panel Terminal is a
 * tab type owned by `ui-sidebar-terminal`, so this plugin no longer occupies
 * `surfaces.terminal`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-surfaces/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { appendToDraft } from './draft.ts'
import { formatTerminalDraft } from './selection.ts'
import { TerminalDrawer } from './TerminalDrawer.tsx'
import { en, NS, zh, type TerminalKey } from './locales.ts'
import { bindPtyListeners } from './pty-bridge.ts'
import { readPtyShell, type TerminalShellInjected } from './shell.ts'
import { createTerminalSessionStore } from './stores.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

export type { TerminalDrawerProps } from './TerminalDrawer.tsx'
export type { TerminalKey } from './locales.ts'
export type { TerminalShellInjected } from './shell.ts'
export { createTerminalSessionStore, MAX_TERMINALS_PER_GROUP } from './stores.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** User-terminal drawer copy. */
    terminal: TerminalKey
  }
}

/** Services required by the user-terminal plugin. */
export const inject = ['slots', 'layout', 'locale']

interface WorkspacesFace {
  openPath?: (path: string, options?: { line?: number }) => Promise<void>
}

/** Right-Sidebar navigation face; provided only while that plugin is mounted. */
interface SidebarRightFace {
  /** @returns false when the Session has no adopted Sidebar store to accept the page. */
  openTabIn: (sessionId: SessionId, kind: 'browser', options: { params: { url: string } }) => boolean
}

/** Composer notice channel, used to report a refused Browser open. */
interface ConversationNoticeFace {
  input: { for: (actx: unknown) => { notify: (level: 'info' | 'error', text: string) => void } }
}

/** Session list face used only to resolve the originating Session's scope. */
interface SessionsScopeFace {
  scope: (sessionId: string) => unknown
}

function layoutFace(ctx: Context): Pick<TerminalShellInjected, 'toggleTerminalDrawer' | 'setTerminalDrawer'> {
  return {
    toggleTerminalDrawer: () => { ctx.layout.toggleTerminalDrawer() },
    setTerminalDrawer: px => { ctx.layout.setTerminalDrawer(px) },
  }
}

/**
 * Report a refused Browser open on the originating Session's composer. With
 * no conversation or Session scope there is no surface to carry a notice, so
 * the refusal is only logged.
 * @param ctx - client root context.
 * @param sessionId - the Session that requested the open.
 * @param text - localized failure copy.
 */
function noticeOpenLinkFailure(ctx: Context, sessionId: string, text: string): void {
  const conversation = ctx.get('conversation') as ConversationNoticeFace | undefined
  const scope = (ctx.get('sessions') as SessionsScopeFace | undefined)?.scope(sessionId)
  if (conversation === undefined || scope === undefined) {
    console.error(`ui-user-terminal: ${text} (${sessionId})`)
    return
  }
  conversation.input.for(scope).notify('error', text)
}

function workflowFace(
  ctx: Context,
  t: (key: TerminalKey) => string,
  sessionId: SessionId | undefined,
): Pick<
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
      // The Session showing when the link was activated owns the tab; never
      // fall back to whichever Session the main view happens to be on.
      if (sessionId === undefined) return
      const sidebarRight = ctx.get('sidebarRight') as SidebarRightFace | undefined
      if (sidebarRight === undefined) {
        noticeOpenLinkFailure(ctx, sessionId, t('error.openLink'))
        return
      }
      let opened = false
      try {
        opened = sidebarRight.openTabIn(sessionId, 'browser', { params: { url } })
      } catch (error) {
        // An unregistered `browser` kind is a wiring gap, not a crash.
        console.error('ui-user-terminal: Browser tab open failed', error)
      }
      if (!opened) noticeOpenLinkFailure(ctx, sessionId, t('error.openLink'))
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
  const t = ctx.locale.bind(NS)
  ctx.effect(
    () => bindPtyListeners([drawerStore], readPtyShell()),
    'ui-user-terminal: pty bridge',
  )
  const injected = (sessionId: SessionId | undefined): TerminalShellInjected => ({
    ...readPtyShell(),
    ...layoutFace(ctx),
    ...workflowFace(ctx, t, sessionId),
  })

  ctx.slots.inject('shell.terminalDrawer', () => ctx.slots.register({
    name: 'shell.terminalDrawer',
    store: drawerStore,
    locale: NS,
    inject: injected,
  }, TerminalDrawer))
}
