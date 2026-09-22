/**
 * Desktop navigation adapter: route workspace file opens into the native
 * right Sidebar. The upstream `surfaces` track stays declared but dormant.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { ensureBaseOpenPath, wrapOpenPath, type OpenPathService } from './openpath-intercept.ts'
import { relativeTo } from './paths.ts'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-browser/client'
// The `file` entry of `SidebarRightResourceParamsMap`, which types `{ params: { line } }` below.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import { fileAddressFor, isAbsoluteWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'

/** Owner props the Files occupant receives so it can open a file surface. */
export interface FilesOwnerProps {
  openFile: (relativePath: string) => void
}

/** Owner props the single-file occupant receives. */
export interface FileOwnerProps {
  relativePath: string
  /** 1-based line to scroll into view; omitted when the open was not a jump-to-line. */
  revealLine?: number
  /** Increments on each jump-to-line so the same line can be requested again. */
  revealRequestId?: number
  /** True while this file surface is the active tab (reread on activate). */
  active: boolean
  /** Report whether the editor has unsaved changes (for tab-close confirm). */
  onDirtyChange: (dirty: boolean) => void
  /** Read a remembered buffer for this file (survives occupant remount / session switches). */
  readBuffer: () => { text: string; draft: string } | undefined
  /** Remember or clear the in-memory buffer for this file. */
  writeBuffer: (buffer: { text: string; draft: string } | null) => void
  /** Register a save that returns whether the write succeeded (tab-close Save). */
  registerSave: (save: (() => Promise<boolean>) | null) => void
}

/** Owner props the Browser occupant receives so renderer chrome can hide the guest. */
export interface BrowserOwnerProps {
  /** True while this preview surface is the active tab. */
  active: boolean
  /** True while renderer-owned chrome overlaps the native guest hit-test area. */
  occluded?: boolean
}

/**
 * Dormant upstream seat contracts. Desktop registers no occupant; the
 * declarations stay so the existing fork packages keep type-checking.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'surfaces.browser': { kind: 'single'; scope: 'session-maybe'; owner: BrowserOwnerProps }
    'surfaces.terminal': { kind: 'single'; scope: 'session-maybe'; owner: {} }
    'surfaces.files': { kind: 'single'; scope: 'session-maybe'; owner: FilesOwnerProps }
    'surfaces.file': { kind: 'single'; scope: 'session-maybe'; owner: FileOwnerProps }
    'surfaces.diff': { kind: 'single'; scope: 'session-maybe'; owner: FilesOwnerProps }
    'surfaces.agents': { kind: 'single'; scope: 'session-maybe'; owner: {} }
  }
}

const BROWSER_DOCUMENTS = new Set(['.html', '.htm', '.xhtml', '.pdf'])

interface DesktopShell {
  listDir?: (cwd: string, relativePath?: string) => Promise<unknown>
  previewWorkspaceFile?: (input: {
    cwd: string
    relativePath: string
  }) => Promise<{ ok?: boolean, url?: string } | null | undefined>
}

/**
 * @returns the desktop `window.shell` object, or undefined outside the renderer.
 */
function readWindowShell(): DesktopShell | undefined {
  /* v8 ignore next -- browser-only module; Node coverage never sees a missing window. */
  if (typeof window === 'undefined') return undefined
  return (window as Window & { shell?: DesktopShell }).shell
}

/**
 * @param relative - workspace-relative path using `/` separators.
 * @returns the lowercased extension including the leading dot, or empty.
 */
function documentExtension(relative: string): string {
  const slash = relative.lastIndexOf('/')
  const base = slash >= 0 ? relative.slice(slash + 1) : relative
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot).toLowerCase()
}

/**
 * Load a browser-renderable workspace file into a token-protected URL.
 * Missing or failing IPC yields undefined.
 * @param cwd - Session workspace root.
 * @param relative - path inside cwd.
 * @returns the loopback URL, or undefined when the file is not browser-renderable.
 */
async function browserDocumentUrl(cwd: string, relative: string): Promise<string | undefined> {
  const preview = readWindowShell()?.previewWorkspaceFile
  if (typeof preview !== 'function' || !BROWSER_DOCUMENTS.has(documentExtension(relative))) return undefined
  try {
    const result = await preview({ cwd, relativePath: relative })
    return result?.ok === true && typeof result.url === 'string' && result.url.length > 0
      ? result.url
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Route a desktop file open to the current right Sidebar.
 * @returns false when the Sidebar is absent or its Session has no adopted
 *   store, so the caller falls back to the legacy surfaces column.
 */
async function openInRightSidebar(
  ctx: Context,
  sessionId: string,
  cwd: string | undefined,
  path: string,
  options?: { line?: number },
): Promise<boolean> {
  const sidebarRight = ctx.get('sidebarRight')
  if (sidebarRight === undefined) return false

  const relative = cwd === undefined ? undefined : relativeTo(cwd, path)
  if (cwd !== undefined && relative === undefined) return false
  const target = relative ?? (isAbsoluteWorkspacePath(path) ? path : undefined)
  if (target === undefined) return false

  if (target === '') {
    if (!sidebarRight.openTabIn(sessionId as SessionId, 'files')) {
      throw new Error('surfaces: Files target is unavailable')
    }
    return true
  }

  const address = fileAddressFor(sessionId, cwd, target)
  const opened = options?.line === undefined
    ? sidebarRight.openResourceIn(sessionId as SessionId, address)
    : sidebarRight.openResourceIn(sessionId as SessionId, address, { params: { line: options.line } })
  if (!opened) throw new Error('surfaces: file target is unavailable')

  if (BROWSER_DOCUMENTS.has(documentExtension(target)) && cwd !== undefined && relative !== undefined) {
    const url = await browserDocumentUrl(cwd, relative)
    if (url !== undefined) {
      const openedBrowser = sidebarRight.openTabIn(sessionId as SessionId, 'browser', { params: { url } })
      if (!openedBrowser) throw new Error('surfaces: Browser target is unavailable')
    }
  }
  return true
}

/**
 * True only in the desktop renderer where workspace listing IPC exists.
 * The web e2e lane must fall through to OS `openPath`.
 * @returns whether `window.shell.listDir` is a function.
 */
export function desktopListingAvailable(): boolean {
  return typeof readWindowShell()?.listDir === 'function'
}

/** Services required by the surfaces plugin. */
export const inject = [
  'slots', 'layout', 'locale', 'workspaces', 'sessions', 'remote', 'remote.session',
]

/**
 * Normalize the retired surfaces width, then intercept `workspaces.openPath`
 * into the native right Sidebar on desktop.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  // The native Sidebar owns the visible right panel; normalize any stale
  // legacy width before the first frame.
  ctx.layout.closeSurfaces()

  ctx.effect(() => {
    const workspaces = ctx.workspaces as Partial<OpenPathService>
    const disposeBase = ensureBaseOpenPath(workspaces, async (path) => {
      const result = await ctx.remote.session.openWorkspacePath({ path })
      if (!result.ok) throw new Error(`path open failed: ${result.error.message}`)
    })
    const disposeIntercept = wrapOpenPath(workspaces, {
      takeoverEnabled: desktopListingAvailable,
      currentSessionId: () => Object.values(ctx.sessions.list.getSnapshot().byId)
        .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id,
      openInSurfaces: async (path, sessionId, options) => {
        const summary = ctx.sessions.list.getSnapshot().byId[sessionId as SessionId]
        const cwd = typeof summary?.cwd === 'string' && summary.cwd.length > 0 ? summary.cwd : undefined
        return openInRightSidebar(ctx, sessionId, cwd, path, options)
      },
    })
    return () => {
      disposeIntercept()
      disposeBase()
    }
  }, 'ui-surfaces: openPath intercept')
}
