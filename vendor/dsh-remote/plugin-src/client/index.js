// Browser half of the desktop's built-in SSH remote workspace. Three surfaces:
// the「远程工作区」settings section (machine registry + forwards + audit), the
//「远程」occupants of the directory picker's remote-flow child holes, and the
// session-bound remote explorer + file tabs on the right sidebar.
import { en, NS, zh } from './i18n.js'
import { remoteFileTarget } from './api.js'
import { installRemoteStyles } from './styles.js'
import { RemoteSettingsSection } from './RemoteSettingsSection.jsx'
import { RemoteFlowPane } from './RemoteFlowPane.jsx'
import { RemoteExplorerBody } from './RemoteExplorerBody.jsx'
import { RemoteExplorerTitle } from './RemoteExplorerTitle.jsx'
import { RemoteFileBody } from './RemoteFileBody.jsx'
import { RemoteFileTitle } from './RemoteFileTitle.jsx'

export const name = 'dsh-remote'
export const inject = ['slots', 'locale']

/** Explorer tab type identity — also its keyed slot `key`. */
export const REMOTE_EXPLORER_ID = 'dsh-remote/explorer'
/** Remote file viewer/editor type identity (address-claimed). */
export const REMOTE_FILE_ID = 'dsh-remote/file'

const REMOTE_FLOW_SLOTS = [
  'conversation.hero.workspace.directoryFlow.remote',
  'sidebar.workspaces.directoryFlow.remote',
]

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-remote: dictionaries')
  ctx.effect(installRemoteStyles, 'dsh-remote: styles')
  const t = ctx.locale.bind(NS)

  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'remote-workspace',
    order: 45,
    label: () => t('settings.nav'),
    locale: NS,
  }, RemoteSettingsSection)), 'dsh-remote: settings section')

  // Each picker parent declares its own remote child hole; the same pane
  // occupies both (owner conversation is identical by contract).
  for (const key of REMOTE_FLOW_SLOTS) {
    ctx.effect(() => ctx.slots.inject(key, () => ctx.slots.register(
      { name: key, locale: NS },
      RemoteFlowPane,
    )), 'dsh-remote: remote flow ' + key)
  }

  // The sidebar services arrive with the ui-sidebar-right client bundle; a
  // composition without it must not take the settings section or the picker
  // occupants down with it.
  ctx.inject(['sidebarRightTabs'], (inner) => {
    const tabs = inner.get('sidebarRightTabs')
    const slots = inner.get('slots')
    inner.effect(() => tabs.register({
      id: REMOTE_EXPLORER_ID,
      kind: REMOTE_EXPLORER_ID,
      title: () => t('explorer.tabTitle'),
      guide: [{ id: 'remote', order: 55, title: () => t('explorer.tabTitle') }],
    }), 'dsh-remote: explorer tab type')
    inner.effect(() => tabs.register({
      id: REMOTE_FILE_ID,
      kind: REMOTE_FILE_ID,
      patterns: ['dsh-resource://dsh-remote/**'],
      title: (address) => {
        try { return remoteFileTarget(address).path.split(/[\\/]/).pop() || t('explorer.tabTitle') }
        catch { return t('explorer.tabTitle') }
      },
    }), 'dsh-remote: file tab type')
    inner.effect(() => slots.inject('sidebar.right.pane.tab', () => {
      const disposers = [
        slots.register({ name: 'sidebar.right.pane.tab', key: REMOTE_EXPLORER_ID, locale: NS }, RemoteExplorerBody),
        slots.register({ name: 'sidebar.right.pane.tab', key: REMOTE_FILE_ID, locale: NS }, RemoteFileBody),
      ]
      return () => disposers.forEach((dispose) => dispose())
    }), 'dsh-remote: sidebar tab bodies')
    inner.effect(() => slots.inject('sidebar.right.pane.tab.title', () => {
      const disposers = [
        slots.register({ name: 'sidebar.right.pane.tab.title', key: REMOTE_EXPLORER_ID }, RemoteExplorerTitle),
        slots.register({ name: 'sidebar.right.pane.tab.title', key: REMOTE_FILE_ID }, RemoteFileTitle),
      ]
      return () => disposers.forEach((dispose) => dispose())
    }), 'dsh-remote: sidebar tab titles')
  })
}
