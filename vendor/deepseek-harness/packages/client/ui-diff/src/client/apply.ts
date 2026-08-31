/** Registers the Diff occupant into surfaces.diff. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-surfaces/client'
import { DiffPanel } from './DiffPanel.tsx'
import { en, NS, zh, type DiffKey } from './locales.ts'
import { readDiffShell, type DiffShellInjected } from './shell.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

export type { DiffPanelProps } from './DiffPanel.tsx'
export type { DiffKey } from './locales.ts'
export type { DiffBranchRef, DiffFile, DiffHunk, DiffLine, DiffShellInjected, GitBranchListResult, GitDiffOptions, GitDiffResult, GitStatusEntriesResult, GitStatusEntry } from './shell.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Diff surface copy. */
    diff: DiffKey
  }
}

/** Services required by the diff plugin. */
export const inject = ['slots', 'locale']

/**
 * Register dictionaries and inject the Diff occupant.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-diff: dictionaries')

  ctx.slots.inject('surfaces.diff', () => ctx.slots.register({
    name: 'surfaces.diff',
    locale: NS,
    inject: (): DiffShellInjected => readDiffShell(),
  }, DiffPanel))
}
