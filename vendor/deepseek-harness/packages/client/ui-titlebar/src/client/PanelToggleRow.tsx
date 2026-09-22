/** Interface Settings rows for titlebar panel-toggle visibility. */
import { useId, type ChangeEvent } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TitlebarKey } from './locales.ts'
import { NS } from './locales.ts'
import css from './PanelToggleRow.module.css'

/** Registration-side visibility face shared by both panel-toggle rows. */
export interface PanelToggleRowInjected {
  hooks: {
    /** Persisted button visibility bound as useVisible. */
    visible: SnapshotStore<boolean>
    /** Host writability bound as useWritable. */
    writable: SnapshotStore<boolean>
  }
  /** Change whether the matching titlebar button is drawn. */
  setVisible: (value: boolean) => void
}

/** Full Settings-row props. */
export type PanelToggleRowProps =
  PropsRuntime<'settings.interface.item'>
  & PropsLocale<typeof NS>
  & InjectFace<PanelToggleRowInjected>

/* jscpd:ignore-start */
function PanelToggleRow({
  useVisible, useWritable, setVisible, t, titleKey, descriptionKey,
}: PanelToggleRowProps & { titleKey: TitlebarKey; descriptionKey: TitlebarKey }) {
  const visible = useVisible(value => value)
  const writable = useWritable(value => value)
  const titleId = useId()

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title} id={titleId}>{t(titleKey)}</div>
        <div className={css.desc}>{t(descriptionKey)}</div>
      </div>
      <Switch
        checked={visible}
        disabled={!writable}
        aria-labelledby={titleId}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setVisible(event.target.checked)
        }}
      />
    </div>
  )
}

/**
 * Render the terminal-drawer titlebar Switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function TerminalToggleRow(props: PanelToggleRowProps) {
  return (
    <PanelToggleRow
      {...props}
      titleKey="settings.terminalToggle.title"
      descriptionKey="settings.terminalToggle.description"
    />
  )
}

/**
 * Render the surfaces-column titlebar Switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function SurfacesToggleRow(props: PanelToggleRowProps) {
  return (
    <PanelToggleRow
      {...props}
      titleKey="settings.surfacesToggle.title"
      descriptionKey="settings.surfacesToggle.description"
    />
  )
}
/* jscpd:ignore-end */
