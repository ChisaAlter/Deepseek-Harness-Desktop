/** Registers the right-panel surfaces shell into the layout-owned column. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { en, NS, zh, type SurfacesKey } from './locales.ts'
import { ensureBaseOpenPath, wrapOpenPath, type OpenPathService } from './openpath-intercept.ts'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { relativeTo } from './paths.ts'
import { createSurfacesStore } from './stores.ts'
import type { SurfacesRootInjected } from './SurfacesRoot.tsx'
import { SurfacesRoot } from './SurfacesRoot.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'

export type { SurfacesRootInjected, SurfacesRootProps } from './SurfacesRoot.tsx'
export type { SurfacesKey } from './locales.ts'
export type { OpenableKind, Surface, SurfaceKind, SurfacesState } from './stores.ts'
export { createSurfacesStore } from './stores.ts'

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

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Right-panel surfaces copy. */
    surfaces: SurfacesKey
  }
  interface SlotMap {
    /**
     * Browser / preview occupant. ui-preview injects here.
     */
    'surfaces.browser': { kind: 'single'; scope: 'session-maybe'; owner: BrowserOwnerProps }
    /**
     * Terminal occupant. ui-user-terminal already injects here; kind and
     * scope must stay `single` + `session-maybe` so that inject attaches.
     */
    'surfaces.terminal': { kind: 'single'; scope: 'session-maybe'; owner: {} }
    /**
     * Workspace files occupant. ui-files injects here.
     */
    'surfaces.files': { kind: 'single'; scope: 'session-maybe'; owner: FilesOwnerProps }
    /**
     * Single-file preview occupant. ui-files injects here.
     */
    'surfaces.file': { kind: 'single'; scope: 'session-maybe'; owner: FileOwnerProps }
    /**
     * Git diff occupant. ui-diff injects here.
     */
    'surfaces.diff': { kind: 'single'; scope: 'session-maybe'; owner: FilesOwnerProps }
    /**
     * Running-agents occupant. ui-agents-panel injects here.
     */
    'surfaces.agents': { kind: 'single'; scope: 'session-maybe'; owner: {} }
  }
}

const OPEN_SURFACE_EVENT = 'dshd-open-surface'
const PENDING_PREVIEW_URL_KEY = 'dshd-pending-preview-url'
const PENDING_PREVIEW_PRESENTATION_KEY = 'dshd-pending-preview-presentation'
const BROWSER_DOCUMENTS = new Set(['.html', '.htm', '.xhtml', '.pdf'])
/** Office binaries the classic file editor cannot read; the native document
 * preview (Office→PDF, XLSX→Spreadsheet) renders them through the rightbar
 * tab system's authorized conversion path. */
const OFFICE_DOCUMENTS = new Set(['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'])

interface DesktopShell {
  gitStatus?: (cwd: string) => Promise<unknown>
  previewOpen?: (input: { url: string }) => Promise<unknown>
  listDir?: (cwd: string, relativePath?: string) => Promise<unknown>
  previewWorkspaceFile?: (input: {
    cwd: string
    relativePath: string
  }) => Promise<{ ok?: boolean, url?: string } | null | undefined>
  onOpenPreviewUrl?: (handler: (payload: { url?: string }) => void) => () => void
}

interface SurfacesStoreActions {
  open: (sessionId: string, kind: 'files') => void
  openFile: (sessionId: string, relativePath: string, options?: { revealLine?: number }) => void
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
 * Bind desktop gitStatus when `window.shell` is present.
 * @returns a probe that resolves null outside the desktop app or when git is missing.
 */
function readDesktopShell(): Pick<SurfacesRootInjected, 'gitStatus' | 'previewAvailable'> {
  const shell = readWindowShell()
  return {
    previewAvailable: typeof shell?.previewOpen === 'function',
    gitStatus: cwd => shell?.gitStatus?.(cwd) ?? Promise.resolve(null),
  }
}

/** Show the classic DSHD panel as the only visible right column. */
function openClassicSurfaces(ctx: Context): void {
  const native = ctx.get('sidebarRight')
  if (native?.isExpanded()) native.toggleExpanded()
  ctx.layout.closeRightbar()
  ctx.layout.openSurfaces()
}

/**
 * Hand an Office binary to the native document preview: the rightbar column
 * expands for it (the only right column then visible) and the resource opens
 * under the `text` type, whose registered renderers convert DOCX/PPTX to PDF
 * and XLSX to the Spreadsheet view through the authorized Host path.
 * @param ctx - client root context carrying the sidebar service and layout.
 * @param sessionId - the Session whose workspace owns the file.
 * @param relative - workspace-relative path.
 * @returns true when the file was handed to the document preview.
 */
function openOfficeDocument(ctx: Context, sessionId: SessionId, relative: string): boolean {
  if (!OFFICE_DOCUMENTS.has(documentExtension(relative))) return false
  const sidebar = ctx.get('sidebarRight')
  const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
  if (sidebar === undefined || typeof cwd !== 'string' || cwd === '') return false
  if (!sidebar.openResourceIn(sessionId, fileAddressFor(sessionId, cwd, relative))) return false
  ctx.layout.closeSurfaces()
  return true
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
 * Write the pending preview URL and open the Browser surface, matching terminal.
 * @param url - loopback http(s) the guest should load.
 */
function openPreviewSurface(url: string, sessionId?: string, presentation?: 'mini'): void {
  try {
    sessionStorage.setItem(PENDING_PREVIEW_URL_KEY, url)
    if (presentation === 'mini') sessionStorage.setItem(PENDING_PREVIEW_PRESENTATION_KEY, 'mini')
    else sessionStorage.removeItem(PENDING_PREVIEW_PRESENTATION_KEY)
  } catch {
    // Quota / SecurityError: Preview still listens for the event when mounted.
  }
  window.dispatchEvent(new CustomEvent(OPEN_SURFACE_EVENT, {
    detail: { kind: 'preview', url, ...(sessionId === undefined ? {} : { sessionId }),
      ...(presentation === undefined ? {} : { presentation }) },
  }))
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
 * After Files opens, load a browser-renderable workspace file in Browser.
 * Missing or failing IPC leaves Files in place and does not throw.
 * @param cwd - session workspace root, or undefined when the client summary has no cwd.
 * @param relative - path inside cwd.
 */
async function previewBrowserDocument(cwd: string | undefined, relative: string, sessionId: string): Promise<void> {
  if (cwd === undefined) return
  const url = await browserDocumentUrl(cwd, relative)
  if (url !== undefined) openPreviewSurface(url, sessionId)
}

/**
 * Forward main-process loopback popups into the same preview event as terminal.
 * @returns a disposer; a no-op when `onOpenPreviewUrl` is absent.
 */
function subscribeOpenPreviewUrl(): () => void {
  const subscribe = readWindowShell()?.onOpenPreviewUrl
  if (typeof subscribe !== 'function') return () => {}
  return subscribe((payload) => {
    if (typeof payload?.url === 'string' && payload.url.length > 0) {
      openPreviewSurface(payload.url)
    }
  })
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
  'slots', 'layout', 'locale', 'workspaces', 'sessions', 'uiSession', 'remote', 'remote.session',
]

/**
 * Register dictionaries, occupy the layout `surfaces` column, and intercept
 * `workspaces.openPath` into Files (and Browser for html/htm/xhtml/pdf)
 * on desktop.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.layout.closeRightbar()
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-surfaces: dictionaries')
  ctx.effect(() => subscribeOpenPreviewUrl(), 'ui-surfaces: open-preview-url')
  ctx.effect(() => {
    if (desktopListingAvailable()) {
      const key = 'dshd-classic-right-panel-v1'
      try {
        if (localStorage.getItem(key) === null) {
          openClassicSurfaces(ctx)
          localStorage.setItem(key, 'restored')
        }
      } catch {
        // Storage denial still allows the user to open the classic panel manually.
      }
    }
    return () => {}
  }, 'ui-surfaces: restore desktop panel')

  const live: {
    open?: SurfacesStoreActions['open']
    openFile?: SurfacesStoreActions['openFile']
  } = {}

  ctx.slots.inject('surfaces', () => ctx.slots.register({
    name: 'surfaces',
    locale: NS,
    store: createSurfacesStore,
    children: {
      'surfaces.browser': { kind: 'single', scope: 'session-maybe' },
      'surfaces.terminal': { kind: 'single', scope: 'session-maybe' },
      'surfaces.files': { kind: 'single', scope: 'session-maybe' },
      'surfaces.file': { kind: 'single', scope: 'session-maybe' },
      'surfaces.diff': { kind: 'single', scope: 'session-maybe' },
      'surfaces.agents': { kind: 'single', scope: 'session-maybe' },
    },
    inject: (_sessionId, actions): SurfacesRootInjected => {
      if (actions !== undefined) {
        live.open = (sessionId, kind) => { actions.open(sessionId, kind) }
        live.openFile = (sessionId, relativePath, options) => {
          if (options === undefined) actions.openFile(sessionId, relativePath)
          else actions.openFile(sessionId, relativePath, options)
        }
      }
      return {
        openSurfaces: () => { openClassicSurfaces(ctx) },
        openOfficeDocument: (relativePath) =>
          _sessionId === undefined ? false : openOfficeDocument(ctx, _sessionId, relativePath),
        ...readDesktopShell(),
      }
    },
  }, SurfacesRoot))

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
        if (cwd === undefined) return false
        const relative = relativeTo(cwd, path)
        if (relative === undefined) return false
        if (relative === '') {
          if (live.open === undefined) throw new Error('surfaces: Files page is unavailable')
          live.open(sessionId, 'files')
          openClassicSurfaces(ctx)
          return true
        }
        if (openOfficeDocument(ctx, sessionId as SessionId, relative)) return true
        if (options?.presentation === 'mini' && BROWSER_DOCUMENTS.has(documentExtension(relative))) {
          const url = await browserDocumentUrl(cwd, relative)
          if (url !== undefined) {
            const native = ctx.get('sidebarRight')
            if (native?.isExpanded()) native.toggleExpanded()
            ctx.layout.closeRightbar()
            ctx.layout.closeSurfaces()
            openPreviewSurface(url, sessionId, 'mini')
            return true
          }
        }
        if (live.openFile === undefined) throw new Error('surfaces: file preview is unavailable')
        if (options?.line !== undefined) live.openFile(sessionId, relative, { revealLine: options.line })
        else live.openFile(sessionId, relative)
        openClassicSurfaces(ctx)
        await previewBrowserDocument(cwd, relative, sessionId)
        return true
      },
    })
    return () => {
      disposeIntercept()
      disposeBase()
    }
  }, 'ui-surfaces: openPath intercept')
}
