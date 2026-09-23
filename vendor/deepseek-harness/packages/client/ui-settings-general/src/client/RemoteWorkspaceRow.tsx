/** Desktop-only Interface row: toggle the built-in dsh-remote remote-workspace mount. */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { desktopShell, type DesktopConfig } from './desktop-shell.ts'
import css from './RemoteWorkspaceRow.module.css'

/** Full Settings-row props. */
export type RemoteWorkspaceRowProps =
  PropsRuntime<'settings.interface.item'>
  & PropsLocale<'settings'>

/**
 * Render the remote workspace (dsh-remote) enable switch; the desktop shell
 * restarts Harness after the write so the overlay composes or drops on the
 * next start.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function RemoteWorkspaceRow({ t }: RemoteWorkspaceRowProps) {
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const persistedEnabled = useRef(true)
  const savePending = useRef(false)
  const shell = desktopShell()

  useEffect(() => {
    let cancelled = false
    void shell?.getConfig?.().then((config: DesktopConfig | null) => {
      if (!cancelled && typeof config?.remoteWorkspaceEnabled === 'boolean') {
        persistedEnabled.current = config.remoteWorkspaceEnabled
        setEnabled(config.remoteWorkspaceEnabled)
      }
    }).catch(() => {
      // Keep the on default when the desktop config cannot be read.
    })
    return () => { cancelled = true }
  }, [shell])

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('remoteWorkspace.title')}</div>
        <div className={css.desc}>{t('remoteWorkspace.description')}</div>
        <div className={css.hint}>{t('remoteWorkspace.restartHint')}</div>
      </div>
      <Switch
        label={t('remoteWorkspace.title')}
        checked={enabled}
        disabled={saving}
        onChange={(next: boolean) => {
          if (!shell?.saveConfig || savePending.current) return
          savePending.current = true
          setSaving(true)
          setEnabled(next)
          void shell.saveConfig({ remoteWorkspaceEnabled: next }).then(config => {
            const saved = typeof config.remoteWorkspaceEnabled === 'boolean'
              ? config.remoteWorkspaceEnabled
              : next
            persistedEnabled.current = saved
            setEnabled(saved)
          }).catch(() => {
            setEnabled(persistedEnabled.current)
          }).finally(() => {
            savePending.current = false
            setSaving(false)
          })
        }}
      />
    </div>
  )
}
