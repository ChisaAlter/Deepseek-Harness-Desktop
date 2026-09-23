/** Registers the Desktop file tree and editor in the native right Sidebar. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, NS, zh, type FilesKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import {
  DESKTOP_FILE_ID,
  DESKTOP_FILES_ID,
  desktopFileDefinition,
  desktopFilesDefinition,
} from './desktop-files.ts'
import { SidebarFilePreview } from './FilePreview.tsx'
import { SidebarFilesPanel } from './FilesPanel.tsx'
import { hasFloatingPreview } from './floating-preview.ts'
import { readFilesShell, type FilesShellInjected } from './shell.ts'
import { appendToDraft } from './draft.ts'
import { serializeComposerFileLink } from './composerMention.ts'
import { SidebarFloatingPreviewAction } from './SidebarFloatingPreviewAction.tsx'

export type { FilesPanelProps, SidebarFilesPanelProps } from './FilesPanel.tsx'
export type { FilePreviewProps, SidebarFilePreviewProps } from './FilePreview.tsx'
export type { FilesKey } from './locales.ts'
export type { DirEntry, FilesShellInjected, ListDirResult, ReadFileMediaResult, ReadFileResult, WriteFileResult } from './shell.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Files surface copy. */
    files: FilesKey
  }
}

/** Services required by the files plugin. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sessions']

/**
 * Register dictionaries and inject the tree and preview occupants.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-files: dictionaries')
  const t = ctx.locale.bind(NS)

  const injected = (): FilesShellInjected => ({
    ...readFilesShell(),
    mentionFile: (targetSessionId, relativePath) => {
      appendToDraft(ctx, targetSessionId, serializeComposerFileLink(relativePath))
    },
    appendComposerText: (targetSessionId, text) => {
      appendToDraft(ctx, targetSessionId, text)
    },
  })

  const cwdOf = (sessionId: string): string | undefined => {
    const cwd = ctx.sessions.list.getSnapshot().byId[sessionId as SessionId]?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  }

  ctx.effect(() => ctx.sidebarRightTabs.register(
    desktopFilesDefinition(t),
  ), 'ui-files: desktop files type')
  ctx.effect(() => ctx.sidebarRightTabs.register(
    desktopFileDefinition(t, cwdOf),
  ), 'ui-files: desktop file type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: DESKTOP_FILES_ID,
    locale: NS,
    inject: (): FilesShellInjected => injected(),
  }, SidebarFilesPanel)), 'ui-files: desktop files body')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: DESKTOP_FILE_ID,
    locale: NS,
    inject: (): FilesShellInjected => injected(),
  }, SidebarFilePreview)), 'ui-files: desktop file body')

  ctx.slots.inject('sidebar.right.tab.document.actions', () => {
    if (!hasFloatingPreview()) return () => {}
    return ctx.slots.register({
      name: 'sidebar.right.tab.document.actions',
      id: 'floating-preview',
      locale: NS,
    }, SidebarFloatingPreviewAction)
  })
}
