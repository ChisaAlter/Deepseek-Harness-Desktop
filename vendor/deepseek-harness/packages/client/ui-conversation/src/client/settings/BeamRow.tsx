/** Interface Settings row for the composer send/think border beam. */
import { useId, type ChangeEvent } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationKey } from '../locales.ts'
import css from './BeamRow.module.css'

/** Registration-side preference face. */
export interface BeamRowInjected {
  hooks: {
    /** Persisted composer-beam preference bound as useComposerBeam. */
    composerBeam: SnapshotStore<boolean>
    /** Host writability bound as useWritable. */
    writable: SnapshotStore<boolean>
  }
  /** Change whether the composer plays the send/think border beam. */
  setComposerBeam: (value: boolean) => void
}

/** Full Settings-row props. */
export type BeamRowProps =
  PropsRuntime<'settings.interface.item'>
  & PropsLocale<'conversation'>
  & InjectFace<BeamRowInjected>

/**
 * Render the composer thinking-beam Switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
/* jscpd:ignore-start */
export function BeamRow({
  useComposerBeam, useWritable, setComposerBeam, t,
}: BeamRowProps) {
  const enabled = useComposerBeam(value => value)
  const writable = useWritable(value => value)
  const titleId = useId()
  const title: ConversationKey = 'settings.beam.title'
  const description: ConversationKey = 'settings.beam.description'

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
          setComposerBeam(event.target.checked)
        }}
      />
    </div>
  )
}
/* jscpd:ignore-end */
