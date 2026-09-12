/** Desktop-only Interface row: toggle the built-in dshbot Bots plugin mount. */
import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { desktopShell, type DesktopConfig } from './desktop-shell.ts'
import css from './DshbotRow.module.css'

/** Full Settings-row props. */
export type DshbotRowProps =
  PropsRuntime<'settings.interface.item'>
  & PropsLocale<'settings'>

/** 12px conical-flask glyph for the Beta tag; ui-primitives ships no flask icon. */
function FlaskIcon() {
  return (
    <svg
      aria-hidden="true"
      className={css.betaIcon}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.8 2.5h4.4" />
      <path d="M6.5 2.5v3.8L3.2 12a1.6 1.6 0 0 0 1.4 2.4h6.8a1.6 1.6 0 0 0 1.4-2.4L9.5 6.3V2.5" />
    </svg>
  )
}

/**
 * Render the Bots (dshbot) enable switch; the desktop shell restarts Harness
 * after the write so the overlay composes or drops on the next start.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function DshbotRow({ t }: DshbotRowProps) {
  const [enabled, setEnabled] = useState(false)
  const shell = desktopShell()

  useEffect(() => {
    let cancelled = false
    void shell?.getConfig?.().then((config: DesktopConfig | null) => {
      if (!cancelled && typeof config?.dshbotEnabled === 'boolean') {
        setEnabled(config.dshbotEnabled)
      }
    }).catch(() => {
      // Keep the off default when the desktop config cannot be read.
    })
    return () => { cancelled = true }
  }, [shell])

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.titleRow}>
          <div className={css.title}>{t('dshbot.title')}</div>
          <Tag tone="warning"><FlaskIcon />{t('dshbot.beta')}</Tag>
        </div>
        <div className={css.desc}>{t('dshbot.description')}</div>
        <div className={css.hint}>{t('dshbot.restartHint')}</div>
      </div>
      <Switch
        label={t('dshbot.title')}
        checked={enabled}
        onChange={(next: boolean) => {
          setEnabled(next)
          void shell?.saveConfig?.({ dshbotEnabled: next })
        }}
      />
    </div>
  )
}
