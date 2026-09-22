/** Registers the desktop Browser guest as the right Sidebar's Browser provider. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, NS, zh, type PreviewKey } from './locales.ts'
import { SidebarPreviewPanel, SidebarPreviewTitle } from './PreviewPanel.tsx'
import { appendToDraft } from './draft.ts'
import { readPreviewShell, type PreviewShellInjected } from './shell.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { DshdMiniPlayer } from './DshdMiniPlayer.tsx'

export type { PreviewPanelProps } from './PreviewPanel.tsx'
export type { PreviewKey } from './locales.ts'
export type { PreviewBounds, PreviewResult, PreviewShellInjected } from './shell.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Browser / preview surface copy. */
    preview: PreviewKey
  }
}

/** Services required by the preview plugin. */
export const inject = ['slots', 'locale']

export const PREVIEW_ID = '@deepseek-ai/dsh-client-ui-preview/browser'
const BROWSER_KIND = 'browser'

interface SidebarRightTabsFace {
  register: (definition: {
    id: string
    kind: string
    priority: 'extension'
    title: () => string
    guide: readonly { id: string; order: number; title: () => string; description: () => string }[]
  }) => () => void
}

interface SidebarRightFace {
  openTab: (kind: string, options: { params: { url: string } }) => void
}

interface KeyedSlotsFace {
  inject: (name: string, register: () => () => void) => () => void
  register: (spec: object, component: unknown) => () => void
}

/**
 * Register dictionaries, the desktop Browser provider, and the mini-player.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-preview: dictionaries')
  const shell = readPreviewShell()
  if (!shell.previewAvailable) return

  const t = ctx.locale.bind(NS)
  const slots = ctx.slots as unknown as KeyedSlotsFace
  const inject = (): PreviewShellInjected => ({
      ...readPreviewShell(),
      appendComposerText: (sessionId, text) => appendToDraft(ctx, sessionId, text),
  })

  const tabs = ctx.get('sidebarRightTabs') as SidebarRightTabsFace | undefined
  if (tabs !== undefined) {
    ctx.effect(() => tabs.register({
      id: PREVIEW_ID,
      kind: BROWSER_KIND,
      priority: 'extension',
      title: () => t('title'),
      guide: [{
        id: 'new',
        order: 30,
        title: () => t('title'),
        description: () => t('guideDescription'),
      }],
    }), 'ui-preview: sidebar browser type')
    ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register({
      name: 'sidebar.right.pane.tab',
      key: PREVIEW_ID,
      locale: NS,
      inject,
    }, SidebarPreviewPanel)), 'ui-preview: sidebar browser body')
    ctx.effect(() => slots.inject('sidebar.right.pane.tab.title', () => slots.register({
      name: 'sidebar.right.pane.tab.title',
      key: PREVIEW_ID,
      locale: NS,
    }, SidebarPreviewTitle)), 'ui-preview: sidebar browser title')
  }

  ctx.effect(() => shell.subscribeOpenPreviewUrl((url) => {
    const sidebarRight = ctx.get('sidebarRight') as SidebarRightFace | undefined
    sidebarRight?.openTab(BROWSER_KIND, { params: { url } })
  }), 'ui-preview: open preview URL')

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dshd-mini-player',
    locale: NS,
  }, DshdMiniPlayer))
}
