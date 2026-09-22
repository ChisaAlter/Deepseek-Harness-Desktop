/** Interface Settings row for the Chat/Trajectory header tablist. */
import { useId, type ChangeEvent } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationKey } from '../locales.ts'
import css from './BeamRow.module.css'

/** Registration-side preference face. */
export interface ViewTabsRowInjected {
  hooks: {
    /** Persisted view-tablist preference bound as useViewTabs. */
    viewTabs: SnapshotStore<boolean>
    /** Host writability bound as useWritable. */
    writable: SnapshotStore<boolean>
  }
  /** Change whether the session header paints Chat/Trajectory tabs. */
  setViewTabs: (value: boolean) => void
}

/** Full Settings-row props. */
export type ViewTabsRowProps =
  PropsRuntime<'settings.interface.item'>
  & PropsLocale<'conversation'>
  & InjectFace<ViewTabsRowInjected>

/**
 * Render the Chat/Trajectory tablist Switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
/* jscpd:ignore-start */
export function ViewTabsRow({
  useViewTabs, useWritable, setViewTabs, t,
}: ViewTabsRowProps) {
  const enabled = useViewTabs(value => value)
  const writable = useWritable(value => value)
  const titleId = useId()
  const title: ConversationKey = 'settings.viewTabs.title'
  const description: ConversationKey = 'settings.viewTabs.description'

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
          setViewTabs(event.target.checked)
        }}
      />
    </div>
  )
}
/* jscpd:ignore-end */
