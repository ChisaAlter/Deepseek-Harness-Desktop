/** Registers the Browser occupant into surfaces.browser. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-surfaces/client'
import { en, NS, zh, type PreviewKey } from './locales.ts'
import { PreviewPanel } from './PreviewPanel.tsx'
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

/**
 * Register dictionaries and inject the Browser occupant.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-preview: dictionaries')

  ctx.slots.inject('surfaces.browser', () => ctx.slots.register({
    name: 'surfaces.browser',
    locale: NS,
    inject: (): PreviewShellInjected => ({
      ...readPreviewShell(),
      appendComposerText: (sessionId, text) => appendToDraft(ctx, sessionId, text),
    }),
  }, PreviewPanel))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dshd-mini-player',
    locale: NS,
  }, DshdMiniPlayer))
}
