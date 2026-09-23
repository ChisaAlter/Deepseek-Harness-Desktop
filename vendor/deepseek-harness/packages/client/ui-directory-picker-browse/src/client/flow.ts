/**
 * The browse picking occupant (package-internal; the `./client` surface
 * exposes only the Loader exports). Same-package tests exercise it directly
 * through this module.
 */
import { createElement } from 'react'
import type { ReactElement } from 'react'
import type { DirectoryListing } from '@deepseek-ai/dsh-api-remotes/client'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import type { HostObservable, PropsHooks, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the SlotMap merge declaring the directory-flow holes.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { DirectoryBrowser } from './DirectoryBrowser.tsx'

/** Injected face: the browse wire calls and copy the dialog drives (bound in apply's closure). */
export interface BrowseFlowInjected {
  /** List one directory level (absent path = the Host home directory); the signal aborts a superseded scan. */
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  /** Create one child directory under an existing parent. */
  createDirectory: (path: string, name: string) => Promise<string>
  hooks: {
    /** True while this entry's remote-workspace child hole is occupied. */
    remoteFlow: HostObservable<boolean>
  }
  /** Localized dialog copy (this package's namespace). */
  t: Translate
}

/** Component-side view of the injected hooks compartment: the bound occupancy selector hook. */
export type BrowseFlowHooks = PropsHooks<BrowseFlowInjected['hooks']>

type HeroRemoteSlot = 'conversation.hero.workspace.directoryFlow.remote'
type SidebarRemoteSlot = 'sidebar.workspaces.directoryFlow.remote'

type HeroFlowProps =
  PropsRuntime<'conversation.hero.workspace.directoryFlow'>
  & Omit<BrowseFlowInjected, 'hooks'>
  & BrowseFlowHooks
  & PropsRenderSlots<HeroRemoteSlot>

type SidebarFlowProps =
  PropsRuntime<'sidebar.workspaces.directoryFlow'>
  & Omit<BrowseFlowInjected, 'hooks'>
  & BrowseFlowHooks
  & PropsRenderSlots<SidebarRemoteSlot>

/**
 * Hero-hole occupant: declares the hero remote-workspace child and renders
 * it through the dialog's tab strip. Browse failures (unreadable targets,
 * create conflicts) stay inside the dialog's own alert surfaces, so the
 * owner's `onError` arm is never driven by this occupant.
 * @param props - owner conversation plus the injected browse face.
 * @returns the dialog element (renders nothing while closed).
 */
export function BrowseDirectoryFlowHero(props: HeroFlowProps): ReactElement {
  const remoteAvailable = props.useRemoteFlow(occupied => occupied)
  return createElement(DirectoryBrowser, {
    open: props.open,
    busy: props.busy,
    listDirectory: props.listDirectory,
    createDirectory: props.createDirectory,
    t: props.t,
    onOpen: props.onPicked,
    onClose: props.onCancel,
    onError: props.onError,
    remoteAvailable,
    remoteSlot: 'conversation.hero.workspace.directoryFlow.remote',
    renderSlot: props.renderSlot,
  })
}

/**
 * Sidebar-hole occupant: declares the sidebar remote-workspace child and
 * renders it through the dialog's tab strip. Same contract as the hero
 * occupant.
 * @param props - owner conversation plus the injected browse face.
 * @returns the dialog element (renders nothing while closed).
 */
export function BrowseDirectoryFlowSidebar(props: SidebarFlowProps): ReactElement {
  const remoteAvailable = props.useRemoteFlow(occupied => occupied)
  return createElement(DirectoryBrowser, {
    open: props.open,
    busy: props.busy,
    listDirectory: props.listDirectory,
    createDirectory: props.createDirectory,
    t: props.t,
    onOpen: props.onPicked,
    onClose: props.onCancel,
    onError: props.onError,
    remoteAvailable,
    remoteSlot: 'sidebar.workspaces.directoryFlow.remote',
    renderSlot: props.renderSlot,
  })
}
