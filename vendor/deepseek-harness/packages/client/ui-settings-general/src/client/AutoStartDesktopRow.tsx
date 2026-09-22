/** Desktop-only General row: cold start opens the desktop directly or the launcher first. */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SettingsSelect } from '@deepseek-ai/dsh-client-ui-primitives'
import { desktopShell } from './desktop-shell.ts'
import type { SettingsKey } from './locales.ts'
import css from './CloseBehaviorRow.module.css'

/** Full Settings-row props. */
export type AutoStartDesktopRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings'>

const OPTIONS: readonly { id: 'direct' | 'launcher'; label: SettingsKey }[] = [
  { id: 'direct', label: 'autoStartDesktop.direct' },
  { id: 'launcher', label: 'autoStartDesktop.launcher' },
]

/**
 * Render the cold-start preference selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function AutoStartDesktopRow({ t }: AutoStartDesktopRowProps) {
  const [autoStartDesktop, setAutoStartDesktop] = useState(true)
  const shell = desktopShell()

  useEffect(() => {
    let cancelled = false
    void shell?.getConfig?.().then((config) => {
      if (!cancelled && typeof config?.autoStartDesktop === 'boolean') {
        setAutoStartDesktop(config.autoStartDesktop)
      }
    }).catch(() => {
      // Keep the direct-start default when the desktop config cannot be read.
    })
    return () => { cancelled = true }
  }, [shell])

  const selected = autoStartDesktop ? 'direct' : 'launcher'
  const selectedLabel = t(autoStartDesktop ? 'autoStartDesktop.direct' : 'autoStartDesktop.launcher')

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('autoStartDesktop.title')}</div>
        <div className={css.desc}>{t('autoStartDesktop.description')}</div>
      </div>
      <SettingsSelect
        align="end"
        aria-label={selectedLabel}
        value={selected}
        options={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        onChange={(id) => {
          const next = id === 'direct'
          setAutoStartDesktop(next)
          void shell?.saveConfig?.({ autoStartDesktop: next })
        }}
      />
    </div>
  )
}
