/** Appearance Settings row for the composer typing effect. */
import { useId, useState, type ChangeEvent } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconSettingsOutline16, Switch, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TypingFxPresets, TypingFxStyle } from '../../submission-settings.ts'
import type { ConversationKey } from '../locales.ts'
import { TypingFxModal } from './TypingFxModal.tsx'
import css from './BeamRow.module.css'

/** Registration-side preference face. */
export interface TypingFxRowInjected {
  hooks: {
    /** Persisted typing-effect preference bound as useTypingFx. */
    typingFx: SnapshotStore<boolean>
    /** Persisted typing-effect visual tuning bound as useTypingFxStyle. */
    typingFxStyle: SnapshotStore<TypingFxStyle>
    /** Persisted user presets bound as useTypingFxPresets. */
    typingFxPresets: SnapshotStore<TypingFxPresets>
    /** Host writability bound as useWritable. */
    writable: SnapshotStore<boolean>
  }
  /** Change whether the composer plays typing echoes and a custom caret. */
  setTypingFx: (value: boolean) => void
  /** Persist the active profile and user presets as one namespace mutation. */
  saveTypingFxConfiguration: (value: TypingFxStyle, presets: TypingFxPresets) => Promise<void>
}

/** Full Settings-row props. */
export type TypingFxRowProps =
  PropsRuntime<'settings.appearance.item'>
  & PropsLocale<'conversation'>
  & InjectFace<TypingFxRowInjected>

/**
 * Render the composer typing-effect Switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
/* jscpd:ignore-start */
export function TypingFxRow({
  useTypingFx, useTypingFxStyle, useTypingFxPresets, useWritable,
  setTypingFx, saveTypingFxConfiguration, t,
}: TypingFxRowProps) {
  const enabled = useTypingFx(value => value)
  const style = useTypingFxStyle(value => value)
  const presets = useTypingFxPresets(value => value)
  const writable = useWritable(value => value)
  const [panelOpen, setPanelOpen] = useState(false)
  const titleId = useId()
  const title: ConversationKey = 'settings.typingFx.title'
  const description: ConversationKey = 'settings.typingFx.description'

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title} id={titleId}>{t(title)}</div>
        <div className={css.desc}>{t(description)}</div>
      </div>
      <div className={css.actions}>
        <Tooltip label={t('settings.typingFx.configure')} side="top" delayMs={500}>
          <button
            type="button"
            className={css.settingsButton}
            aria-label={t('settings.typingFx.configure')}
            disabled={!writable}
            onClick={() => { setPanelOpen(true) }}
          >
            <IconSettingsOutline16 size={16} />
          </button>
        </Tooltip>
        <Switch
          checked={enabled}
          disabled={!writable}
          aria-labelledby={titleId}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setTypingFx(event.target.checked)
          }}
        />
      </div>
      <TypingFxModal
        open={panelOpen}
        value={style}
        presets={presets}
        onClose={() => { setPanelOpen(false) }}
        onSave={saveTypingFxConfiguration}
        t={t}
      />
    </div>
  )
}
/* jscpd:ignore-end */
