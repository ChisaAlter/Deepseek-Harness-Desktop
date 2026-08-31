/**
 * The root entry's transient layout store: panel geometry as plain widths in
 * px (0 = closed). Module level exports the factory only — a module-level
 * handle would pin the store's identity in the module
 * cache (a de-facto singleton surviving plugin reloads). register() receives
 * the factory (exclusive use: the framework instantiates per entry), AppFrame
 * derives its PropsStore share from the return type, and the service face
 * receives the bound actions through the registration's inject hook.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import {
  clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
  SURFACES_MAX, SURFACES_MIN,
  TERMINAL_DRAWER_MIN,
} from './columns.ts'
import { lastDrawerHeight, lastSurfacesWidth, readLayoutPersist, writeLayoutPersist } from './persist.ts'

/**
 * Layout store state: panel width preferences in px (0 = closed), plus the
 * narrow-viewport pair — `narrow` mirrors AppFrame's breakpoint reading
 * (viewport < SIDEBAR_AUTO_COLLAPSE) so toggleSidebar can pick semantics, and
 * `narrowExpanded` is the manual override that re-expands the auto-collapsed
 * sidebar over the squeezed center without rewriting the width preference.
 */
type LayoutState = {
  sidebar: number
  details: number
  surfaces: number
  terminalDrawer: number
  narrow: boolean
  narrowExpanded: boolean
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  closeNarrowSidebar: (draft: LayoutState) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  setSurfaces: (draft: LayoutState, px: number) => void
  toggleSurfaces: (draft: LayoutState) => void
  openSurfaces: (draft: LayoutState) => void
  closeSurfaces: (draft: LayoutState) => void
  toggleTerminalDrawer: (draft: LayoutState) => void
  setTerminalDrawer: (draft: LayoutState, px: number) => void
}

/**
 * Create the layout panel store handle. Sidebar and details stay session-
 * transient. Surfaces width and terminal-drawer height persist last-open
 * sizes and whether they were open, so reload and toggle restore the drag.
 * Actions are the complete write set: drag writes clamp into the panel's
 * contract range and never cross the open/closed line; open/close
 * transitions write 0 / the last-open size (or the contract default).
 * Below the auto-collapse breakpoint (AppFrame feeds setNarrow) the sidebar
 * toggle flips the narrowExpanded override instead of the preference.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions>  {
  const handle = defineStore({
    init: (): LayoutState => {
      const persisted = readLayoutPersist()
      return {
        sidebar: SIDEBAR_DEFAULT,
        details: 0,
        surfaces: persisted?.surfaces ?? 0,
        terminalDrawer: persisted?.terminalDrawer ?? 0,
        narrow: false,
        narrowExpanded: false,
      }
    },
    actions: {
      setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
      setDetails: (d, px: number) => { d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX) },
      // Narrow toggles flip only the override: the width preference survives
      // untouched, so re-widening restores the pre-squeeze layout.
      toggleSidebar: (d) => {
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      // Crossing the breakpoint in either direction drops the override: the
      // narrow default is auto-collapsed, the wide state is the preference.
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      // Session switch on phone/tablet: drop the overlay/re-expanded drawer
      // without rewriting the wide-window width preference.
      closeNarrowSidebar: (d) => { d.narrowExpanded = false },
      openDetails: (d) => { if (d.details === 0) d.details = DETAILS_DEFAULT },
      closeDetails: (d) => { d.details = 0 },
      setSurfaces: (d, px: number) => {
        d.surfaces = clampWidth(px, SURFACES_MIN, SURFACES_MAX)
        writeLayoutPersist({ surfaces: d.surfaces, lastSurfaces: d.surfaces })
      },
      toggleSurfaces: (d) => {
        d.surfaces = d.surfaces === 0 ? lastSurfacesWidth() : 0
        writeLayoutPersist({
          surfaces: d.surfaces,
          ...(d.surfaces > 0 ? { lastSurfaces: d.surfaces } : {}),
        })
      },
      openSurfaces: (d) => {
        if (d.surfaces === 0) d.surfaces = lastSurfacesWidth()
        writeLayoutPersist({ surfaces: d.surfaces, lastSurfaces: d.surfaces })
      },
      closeSurfaces: (d) => {
        d.surfaces = 0
        writeLayoutPersist({ surfaces: 0 })
      },
      toggleTerminalDrawer: (d) => {
        d.terminalDrawer = d.terminalDrawer === 0 ? lastDrawerHeight() : 0
        writeLayoutPersist({
          terminalDrawer: d.terminalDrawer,
          ...(d.terminalDrawer > 0 ? { lastDrawer: d.terminalDrawer } : {}),
        })
      },
      // Floor only: the drawer has no contract ceiling; 0 is reserved for close.
      setTerminalDrawer: (d, px: number) => {
        d.terminalDrawer = Math.max(TERMINAL_DRAWER_MIN, Math.round(px))
        writeLayoutPersist({ terminalDrawer: d.terminalDrawer, lastDrawer: d.terminalDrawer })
      },
    },
  })
  return handle
}
