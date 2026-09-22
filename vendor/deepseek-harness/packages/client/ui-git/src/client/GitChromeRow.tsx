/** Interface Settings row for the titlebar Git cluster visibility. */
import { useId, type ChangeEvent } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { NS } from './locales.ts'
import css from './GitChromeRow.module.css'

/** Registration-side visibility face. */
export interface GitChromeRowInjected {
  hooks: {
    /** Persisted titlebar Git visibility bound as useTitlebarGit. */
    titlebarGit: SnapshotStore<boolean>
    /** Host writability bound as useWritable. */
    writable: SnapshotStore<boolean>
  }
  /** Change whether the titlebar Git cluster is drawn. */
  setTitlebarGit: (value: boolean) => void
}

/** Full Settings-row props. */
export type GitChromeRowProps =
  PropsRuntime<'settings.interface.item'>
  & PropsLocale<typeof NS>
  & InjectFace<GitChromeRowInjected>

/**
 * Render the titlebar Git cluster Switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
/* jscpd:ignore-start */
export function GitChromeRow({
  useTitlebarGit, useWritable, setTitlebarGit, t,
}: GitChromeRowProps) {
  const visible = useTitlebarGit(value => value)
  const writable = useWritable(value => value)
  const titleId = useId()

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title} id={titleId}>{t('settings.titlebarGit.title')}</div>
        <div className={css.desc}>{t('settings.titlebarGit.description')}</div>
      </div>
      <Switch
        checked={visible}
        disabled={!writable}
        aria-labelledby={titleId}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setTitlebarGit(event.target.checked)
        }}
      />
    </div>
  )
}
/* jscpd:ignore-end */
