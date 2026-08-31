/** Registers the titlebar Git split button into the layout-owned trailing cluster. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { GitActionsInjected } from './GitActionsControl.tsx'
import { GitActionsControl } from './GitActionsControl.tsx'
import type { GitChromeRowInjected } from './GitChromeRow.tsx'
import { GitChromeRow } from './GitChromeRow.tsx'
import { ChromeVisibility } from './chrome-visibility.ts'
import type { BranchRef } from './branches.ts'
import type { GitProgressEvent, GitResult, VcsStatus } from './git-logic.ts'
import { GIT_SETTINGS_NAMESPACE, TITLEBAR_GIT_FIELD, type GitSettings } from '../git-settings.ts'
import { en, NS, zh, type GitKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

export type { GitActionsInjected, GitActionsProps } from './GitActionsControl.tsx'
export type { GitKey } from './locales.ts'
export type { GitResult, VcsStatus } from './git-logic.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Titlebar Git action copy. */
    git: GitKey
  }
}

/** Desktop git methods the Electron preload exposes on `window.shell`. */
interface GitShell {
  gitStatus?: (cwd: string) => Promise<VcsStatus | null>
  gitFetchForStatus?: (cwd: string) => Promise<VcsStatus | null>
  gitReadPullRequest?: (cwd: string) => Promise<GitResult & { pr?: VcsStatus['pr'] }>
  gitInit?: (cwd: string) => Promise<GitResult>
  gitCommit?: (cwd: string, message: string, filePaths?: readonly string[], actionId?: number, options?: { featureBranch?: boolean }) => Promise<GitResult>
  gitPush?: (cwd: string, actionId?: number) => Promise<GitResult>
  gitPull?: (cwd: string, actionId?: number) => Promise<GitResult>
  onGitProgress?: (handler: (event: GitProgressEvent) => void) => () => void
  onGitWorkspacesChanged?: (handler: () => void) => () => void
  gitCreateChangeRequest?: (cwd: string, input?: { title?: string; body?: string }, actionId?: number) => Promise<GitResult>
  gitPublishRepository?: (cwd: string, input: { name: string; visibility: 'public' | 'private'; remoteUrl?: string }, actionId?: number) => Promise<GitResult>
  gitBranchList?: (cwd: string) => Promise<{ ok: boolean; message?: string; branches?: import('./branches.ts').BranchRef[] }>
  gitSwitchBranch?: (cwd: string, ref: string) => Promise<GitResult & { refName?: string }>
  gitCreateBranch?: (cwd: string, name: string) => Promise<GitResult & { refName?: string }>
  openExternal?: (url: string) => Promise<boolean>
  openWorkspacePath?: (cwd: string, relativePath: string) => Promise<GitResult>
}

function noBranchList(): Promise<{ ok: boolean; message: string; branches: BranchRef[] }> {
  return Promise.resolve({ ok: false, message: unavailable().message ?? 'Git status is unavailable.', branches: [] })
}

function unavailable(): GitResult {
  return { ok: false, message: 'Git status is unavailable.' }
}

/**
 * Bind desktop git IPC when `window.shell` is present.
 * @returns injected git callbacks; each call no-ops outside the desktop app.
 */
function readGitShell(): Omit<GitActionsInjected, 'hooks'> {
  /* v8 ignore next -- browser-only module; Node coverage never sees a missing window. */
  const shell = typeof window === 'undefined'
    ? undefined
    : (window as Window & { shell?: GitShell }).shell
  return {
    gitStatus: cwd => shell?.gitStatus?.(cwd) ?? Promise.resolve(null),
    gitFetchForStatus: cwd => shell?.gitFetchForStatus?.(cwd) ?? Promise.resolve(null),
    gitReadPullRequest: cwd => shell?.gitReadPullRequest?.(cwd) ?? Promise.resolve({ ...unavailable(), pr: null }),
    gitInit: cwd => shell?.gitInit?.(cwd) ?? Promise.resolve(unavailable()),
    gitCommit: (cwd, message, filePaths, actionId, options) => shell?.gitCommit?.(cwd, message, filePaths, actionId, options) ?? Promise.resolve(unavailable()),
    gitPush: (cwd, actionId) => shell?.gitPush?.(cwd, actionId) ?? Promise.resolve(unavailable()),
    gitPull: (cwd, actionId) => shell?.gitPull?.(cwd, actionId) ?? Promise.resolve(unavailable()),
    onGitProgress: handler => shell?.onGitProgress?.(handler) ?? (() => {}),
    onWorkspacesChanged: handler => shell?.onGitWorkspacesChanged?.(handler) ?? (() => {}),
    gitCreateChangeRequest: (cwd, input, actionId) =>
      shell?.gitCreateChangeRequest?.(cwd, input, actionId) ?? Promise.resolve(unavailable()),
    gitPublishRepository: (cwd, input, actionId) =>
      shell?.gitPublishRepository?.(cwd, input, actionId) ?? Promise.resolve(unavailable()),
    gitBranchList: cwd => shell?.gitBranchList?.(cwd) ?? noBranchList(),
    gitSwitchBranch: (cwd, ref) => shell?.gitSwitchBranch?.(cwd, ref) ?? Promise.resolve(unavailable()),
    gitCreateBranch: (cwd, name) => shell?.gitCreateBranch?.(cwd, name) ?? Promise.resolve(unavailable()),
    openExternal: url => shell?.openExternal?.(url) ?? Promise.resolve(false),
    openWorkspacePath: (cwd, relativePath) => shell?.openWorkspacePath?.(cwd, relativePath) ?? Promise.resolve(unavailable()),
  }
}

/** Services required by the git plugin. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

/**
 * Register the dictionaries, inject the Git split button at order 20, and
 * contribute the Interface Settings row.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-git: dictionaries')

  const gitChrome = new ChromeVisibility<GitSettings>(
    ctx.settingsScope.bind<GitSettings>({ namespace: GIT_SETTINGS_NAMESPACE }),
    TITLEBAR_GIT_FIELD,
  )

  ctx.slots.inject('shell.titlebar.trailing', () => ctx.slots.register({
    name: 'shell.titlebar.trailing',
    id: 'git-actions',
    order: 20,
    locale: NS,
    inject: (): GitActionsInjected => ({
      ...readGitShell(),
      hooks: { titlebarGit: gitChrome.visible },
    }),
  }, GitActionsControl))

  ctx.slots.inject('settings.interface.item', () => ctx.slots.register({
    name: 'settings.interface.item',
    id: 'titlebar-git',
    order: 20,
    locale: NS,
    inject: (): GitChromeRowInjected => ({
      hooks: { titlebarGit: gitChrome.visible, writable: gitChrome.writable },
      setTitlebarGit: (value) => { gitChrome.setVisible(value) },
    }),
  }, GitChromeRow))
}
