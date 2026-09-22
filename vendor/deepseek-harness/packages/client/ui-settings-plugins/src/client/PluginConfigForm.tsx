/**
 * One plugin's configuration form as its page on the Plugins page shows it:
 * the read-only notice when the deployment stores settings read-only, the
 * plugin's controls, and the save that writes every staged edit. The page
 * draws the plugin's title and one-liner itself.
 *
 * Only a save writes. Leaving the page drops every staged edit, so the form
 * discards on unmount and offers no discard control. A form whose namespace
 * the Host stopped serving says so in place of its controls rather than
 * showing fields nothing would accept.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import type { CardShell } from './card-form.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import css from './PluginConfigForm.module.css'

/** Form chrome shared by every plugin configuration page. */
export interface PluginConfigFormProps {
  /** Locale reader for this package's copy. */
  t: (key: PluginsSettingsLocaleKey) => string
  /** The form state: availability, writability, and what a save would do. */
  state: CardShell
  /** Write every staged edit. */
  onSave: () => void
  /** Drop every staged edit; the form calls it when it leaves the page. */
  onDiscard: () => void
  /** The plugin's controls. */
  children: ReactNode
}

/**
 * Render one plugin's configuration form.
 * @param props - the form state, its controls, and the save and discard actions.
 * @returns the form, or the unavailable line while the namespace is not served.
 */
export function PluginConfigForm(props: PluginConfigFormProps) {
  const { state } = props
  const discard = useRef(props.onDiscard)
  discard.current = props.onDiscard
  useEffect(() => () => { discard.current() }, [])
  if (!state.available) return <p className={css.unavailable} role="status">{props.t('unavailable')}</p>
  const blocked = !state.dirty || state.invalid || state.saving
  return (
    <div className={css.form}>
      {!state.writable ? <p className={css.readOnly} role="status">{props.t('readOnly')}</p> : null}
      {props.children}
      <div className={css.footer}>
        {state.failed ? <p className={css.failed} role="status">{props.t('saveFailed')}</p> : null}
        <button
          type="button"
          className={css.save}
          disabled={blocked}
          onClick={props.onSave}
        >
          {props.t(state.saving ? 'saving' : 'save')}
        </button>
      </div>
    </div>
  )
}
