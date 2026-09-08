/**
 * Desktop shell bridge used by the marketplace settings section.
 * Absent outside the desktop app, so registration branches on it.
 * The section is desktop-owned: the curated catalog, install, update,
 * and uninstall all run in the Electron main process; this file only
 * types that preload face.
 */

/** One curated catalog row mapped by the desktop main process. */
export type MarketItem = {
  /** Registry `owner/name` id — the install key. */
  id: string
  owner: string
  repo: string
  description: string
  stars: number
  /** npm package name when the row installs from the registry, else ''. */
  packageName: string
  homepage: string
  /** CLI spec the desktop engine resolved for this row. */
  installSpec: string
  category: string
  deprecated?: boolean
  npm?: string | null
  screenshots?: string[]
  added?: string
}

/** Durable desktop operation summary; logs are redacted in the main process. */
export type MarketOperation = {
  id: string
  kind: 'install' | 'update' | 'uninstall' | 'batch'
  target: string
  status: 'running' | 'succeeded' | 'failed' | 'interrupted'
  startedAt: number
  finishedAt?: number
  log: string
  error?: string
}

/** Preferences and recent operations owned by the desktop user-data directory. */
export type MarketplaceState = { ok: boolean; favorites: string[]; operations: MarketOperation[] }

/** Bounded public README and manifest facts; requirements are declarations, not a verdict. */
export type MarketplaceDetails = { ok: boolean; partial: boolean; readme: string; version: string; requirements: string[] }

/** One catalog category chip with its localized label. */
export type MarketCategory = {
  id: string
  label: string
  count: number
}

/** Catalog payload returned by `window.shell.listMarketplace`. */
export type MarketCatalog = {
  ok: boolean
  items: MarketItem[]
  categories: MarketCategory[]
  fetchedAt: number
  source: string
  /** Cache/offline notice; empty when the catalog is live. */
  warning: string
}

/** One installed plugin row from `window.shell.listInstalledPlugins`. */
export type InstalledPlugin = {
  name: string
  spec: string
  bundle?: boolean
  dropped?: boolean
}

/** Installed-plugin payload from the desktop profile manifest. */
export type InstalledPayload = {
  ok: boolean
  plugins?: InstalledPlugin[]
}

/** One installed catalog row's current-to-latest comparison. */
export type MarketplaceUpdateStatus = {
  id: string
  packageName: string
  kind: 'npm' | 'github' | 'linked' | 'unknown'
  current: string | null
  latest: string | null
  updateAvailable: boolean
  checkFailed?: boolean
}

/** Update-check payload keyed by catalog id. */
export type MarketplaceUpdatesPayload = {
  ok: boolean
  updates: Record<string, MarketplaceUpdateStatus>
  checkedAt: number
  warning?: string
}

/** Result of an install, update, or uninstall (profile write + Harness restart). */
export type PluginOpResult = {
  ok: boolean
  error?: string
  /** The plugin needs approval to run build scripts on this machine. */
  needsAllowBuilds?: boolean
  /** allowBuilds keys to pass back once the user approves. */
  allowBuilds?: string[]
  log?: string
  /** False when the profile write landed but Harness did not come back. */
  harnessStarted?: boolean
  rolledBack?: boolean
  rollbackError?: string
  historyWarning?: string
}

/** One `shell:plugin-progress` line during install/uninstall/restart. */
export type PluginProgress = {
  phase: string
  line?: string
}

/** The preload-exposed desktop API used by the marketplace section. */
export type DesktopShell = {
  getMarketplaceDetails?: (id: string, options?: { force?: boolean }) => Promise<MarketplaceDetails>
  getMarketplaceState?: () => Promise<MarketplaceState>
  setMarketplaceFavorite?: (id: string, favorite: boolean) => Promise<MarketplaceState>
  updateMarketplacePlugins?: (ids: string[]) => Promise<PluginOpResult>
  listMarketplace?: (options?: { refresh?: boolean; locale?: string }) => Promise<MarketCatalog>
  listInstalledPlugins?: () => Promise<InstalledPayload>
  checkMarketplaceUpdates?: (options?: { force?: boolean }) => Promise<MarketplaceUpdatesPayload>
  installMarketplacePlugin?: (id: string, options?: { allowBuilds?: string[] }) => Promise<PluginOpResult>
  updateMarketplacePlugin?: (id: string, options?: { allowBuilds?: string[] }) => Promise<PluginOpResult>
  uninstallPlugin?: (name: string) => Promise<PluginOpResult>
  onPluginProgress?: (listener: (payload: PluginProgress) => void) => () => void
}

/**
 * Read the desktop bridge if present.
 * @returns the preload API, or null in a plain browser.
 */
export function desktopShell(): DesktopShell | null {
  /* v8 ignore next -- the browser bundle always has window */
  if (typeof window === 'undefined') return null
  const api = (window as Window & { shell?: DesktopShell }).shell
  return api && typeof api === 'object' ? api : null
}

/** Desktop shell object that actually implements the marketplace IPC methods. */
type MarketDesktopApi = Required<Pick<
  DesktopShell,
  'listMarketplace' | 'listInstalledPlugins' | 'checkMarketplaceUpdates'
  | 'getMarketplaceState' | 'setMarketplaceFavorite' | 'updateMarketplacePlugins'
  | 'getMarketplaceDetails'
  | 'installMarketplacePlugin' | 'updateMarketplacePlugin' | 'uninstallPlugin' | 'onPluginProgress'
>>

/**
 * Whether the preload object can drive the marketplace section.
 * @param shell - `window.shell`, or null in a plain browser.
 * @returns true only when catalog, update, mutation, and progress APIs are functions.
 */
export function hasMarketApi(shell: DesktopShell | null): shell is MarketDesktopApi {
  return Boolean(
    shell?.listMarketplace
    && shell.listInstalledPlugins
    && shell.checkMarketplaceUpdates
    && shell.installMarketplacePlugin
    && shell.updateMarketplacePlugin
    && shell.getMarketplaceState
    && shell.getMarketplaceDetails
    && shell.setMarketplaceFavorite
    && shell.updateMarketplacePlugins
    && shell.uninstallPlugin
    && shell.onPluginProgress,
  )
}
