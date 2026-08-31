/** Interface Settings row for composer drag-resize. */
import { useId, type ChangeEvent } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationKey } from '../locales.ts'
import css from './BeamRow.module.css'

/** Registration-side preference face. */
export interface ResizeRowInjected {
  hooks: {
    /** Persisted composer-resize preference bound as useComposerResize. */
    composerResize: SnapshotStore<boolean>
    /** Host writability bound as useWritable. */
    writable: SnapshotStore<boolean>
  }
  /** Change whether the composer text box can be drag-resized. */
  setComposerResize: (value: boolean) => void
}

/** Full Settings-row props. */
export type ResizeRowProps =
  PropsRuntime<'settings.interface.item'>
  & PropsLocale<'conversation'>
  & InjectFace<ResizeRowInjected>

/**
 * Render the composer drag-resize Switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
/* jscpd:ignore-start */
export function ResizeRow({
  useComposerResize, useWritable, setComposerResize, t,
}: ResizeRowProps) {
  const enabled = useComposerResize(value => value)
  const writable = useWritable(value => value)
  const titleId = useId()
  const title: ConversationKey = 'settings.resize.title'
  const description: ConversationKey = 'settings.resize.description'

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
          setComposerResize(event.target.checked)
        }}
      />
    </div>
  )
}
/* jscpd:ignore-end */
