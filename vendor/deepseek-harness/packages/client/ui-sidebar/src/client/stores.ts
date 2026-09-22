/**
 * Sidebar shell viewing store: which region tab is selected when plugin
 * tabs occupy `sidebar.nav.tab`. Module level exports the factory only
 * (a module-level handle would pin identity across plugin reloads).
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** Built-in sessions region id; plugin tabs use their list-slot `id`. */
export const SESSIONS_TAB_ID = 'sessions'

/** One projected `sidebar.nav.tab` row (id/label from registration options). */
export type SidebarNavTabRow = {
  id: string
  order: number
  label: string
}

/** Selected region tab. `sessions` is the shipped workspace browser. */
type SidebarNavState = {
  selectedTab: string
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type SidebarNavActions = {
  selectTab: (draft: SidebarNavState, id: string) => void
}

/**
 * Create the sidebar region-tab store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createSidebarNavStore(): EngineStoreHandle<SidebarNavState, SidebarNavActions> {
  return defineStore({
    init: (): SidebarNavState => ({ selectedTab: SESSIONS_TAB_ID }),
    persist: 'dsh.sidebar.nav.v1',
    actions: {
      selectTab: (d, id: string) => { d.selectedTab = id },
    },
  })
}
