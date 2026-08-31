/** Interface Settings row for the composer-dock session stats strip. */
import { useId, type ChangeEvent } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationKey } from '../locales.ts'
import css from './BeamRow.module.css'

/** Registration-side preference face. */
export interface StatsLineRowInjected {
  hooks: {
    /** Persisted stats-strip preference bound as useStatsLine. */
    statsLine: SnapshotStore<boolean>
    /** Host writability bound as useWritable. */
    writable: SnapshotStore<boolean>
  }
  /** Change whether the composer dock shows session-stats figures. */
  setStatsLine: (value: boolean) => void
}

/** Full Settings-row props. */
export type StatsLineRowProps =
  PropsRuntime<'settings.interface.item'>
  & PropsLocale<'conversation'>
  & InjectFace<StatsLineRowInjected>

/**
 * Render the session-stats Switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
/* jscpd:ignore-start */
export function StatsLineRow({
  useStatsLine, useWritable, setStatsLine, t,
}: StatsLineRowProps) {
  const enabled = useStatsLine(value => value)
  const writable = useWritable(value => value)
  const titleId = useId()
  const title: ConversationKey = 'settings.statsLine.title'
  const description: ConversationKey = 'settings.statsLine.description'

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title} id={titleId}>{t(title)}</div>
        <div className={css.desc}>{t(description)}</div>
      </div>
      <Switch
        checked={enabled}
        disabled={!writable}
        aria-labelledby={titleId}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setStatsLine(event.target.checked)
        }}
      />
    </div>
  )
}
/* jscpd:ignore-end */
