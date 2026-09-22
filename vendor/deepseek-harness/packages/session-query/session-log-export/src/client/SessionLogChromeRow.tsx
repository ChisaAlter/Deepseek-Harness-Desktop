/** Interface Settings row for the titlebar Session-log button visibility. */
import { useId, type ChangeEvent } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { NS } from './locales.ts'
import css from './SessionLogChromeRow.module.css'

/** Registration-side visibility face. */
export interface SessionLogChromeRowInjected {
  hooks: {
    /** Persisted titlebar Session-log visibility bound as useTitlebarAction. */
    titlebarAction: SnapshotStore<boolean>
    /** Host writability bound as useWritable. */
    writable: SnapshotStore<boolean>
  }
  /** Change whether the titlebar Session log button is drawn. */
  setTitlebarAction: (value: boolean) => void
}

/** Full Settings-row props. */
export type SessionLogChromeRowProps =
  PropsRuntime<'settings.interface.item'>
  & PropsLocale<typeof NS>
  & InjectFace<SessionLogChromeRowInjected>

/**
 * Render the titlebar Session-log Switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
/* jscpd:ignore-start */
export function SessionLogChromeRow({
  useTitlebarAction, useWritable, setTitlebarAction, t,
}: SessionLogChromeRowProps) {
  const visible = useTitlebarAction(value => value)
  const writable = useWritable(value => value)
  const titleId = useId()

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title} id={titleId}>{t('settings.titlebarAction.title')}</div>
        <div className={css.desc}>{t('settings.titlebarAction.description')}</div>
      </div>
      <Switch
        checked={visible}
        disabled={!writable}
        aria-labelledby={titleId}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setTitlebarAction(event.target.checked)
        }}
      />
    </div>
  )
}
/* jscpd:ignore-end */
