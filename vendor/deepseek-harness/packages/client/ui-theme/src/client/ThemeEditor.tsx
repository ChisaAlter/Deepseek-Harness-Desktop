/**
 * Custom-theme editor: name, three seed colors per half, contrast, and
 * optional alias-token overrides.
 */
import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ThemeFamily, ThemeSeeds } from '../theme-family.ts'
import type { ThemeKey } from './locales.ts'
import { sliderFillStyle } from './slider.ts'
import css from './AppearanceSection.module.css'

const OVERRIDE_FIELDS = [
  '--dsw-alias-bg-base',
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-overlay',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-brand-primary',
  '--dsw-alias-state-business-primary',
  '--dsw-alias-button-info-fill',
  '--dsw-alias-border-l1',
  '--dsw-alias-border-l2',
  '--dsw-specific-sidebar-fill',
  '--dsw-specific-bubble',
] as const

/**
 * Render the custom-theme editor. Edits preview live through the theme
 * service; only the half matching `resolvedMode` is visible on screen, so the
 * other half is labeled as hidden until the color scheme switches.
 * @param props.family - draft family.
 * @param props.resolvedMode - which half the UI is currently painting.
 * @param props.t - localized copy.
 * @param props.onChange - draft write.
 * @param props.onSave - persist the draft.
 * @param props.onCancel - close without saving.
 * @returns the editor tree.
 */
export function ThemeEditor({
  family,
  resolvedMode,
  t,
  onChange,
  onSave,
  onCancel,
}: {
  family: ThemeFamily
  resolvedMode: 'light' | 'dark'
  t: (key: ThemeKey) => string
  onChange: (family: ThemeFamily) => void
  onSave: () => void
  onCancel: () => void
}) {
  const [advanced, setAdvanced] = useState(false)
  return (
    <div className={css.editor}>
      <p className={css.hint}>
        {t(resolvedMode === 'dark' ? 'editor.previewHintDark' : 'editor.previewHintLight')}
        {' '}
        {t('editor.accentHint')}
      </p>
      <label className={css.field}>
        <span>{t('editor.name')}</span>
        <Input
          value={family.name}
          onChange={(event) => { onChange({ ...family, name: event.currentTarget.value }) }}
        />
      </label>
      <HalfEditor
        title={t('editor.light')}
        current={resolvedMode === 'light'}
        seeds={family.light}
        advanced={advanced}
        t={t}
        onChange={(light) => { onChange({ ...family, light }) }}
      />
      <HalfEditor
        title={t('editor.dark')}
        current={resolvedMode === 'dark'}
        seeds={family.dark}
        advanced={advanced}
        t={t}
        onChange={(dark) => { onChange({ ...family, dark }) }}
      />
      <button type="button" className={css.linkButton} onClick={() => { setAdvanced(value => !value) }}>
        {t('library.advanced')}
      </button>
      <div className={css.editorActions}>
        <Button type="button" variant="outline" onClick={onCancel}>{t('editor.cancel')}</Button>
        <Button type="button" onClick={onSave}>{t('editor.save')}</Button>
      </div>
    </div>
  )
}

function HalfEditor({
  title,
  current,
  seeds,
  advanced,
  t,
  onChange,
}: {
  title: string
  current: boolean
  seeds: ThemeSeeds
  advanced: boolean
  t: (key: ThemeKey) => string
  onChange: (seeds: ThemeSeeds) => void
}) {
  return (
    <fieldset className={css.editorHalf}>
      <legend>
        {title}
        {current ? <span className={css.halfCurrent}>{t('library.currentMode')}</span> : null}
      </legend>
      <div className={css.colorRow}>
        <ColorField label={t('editor.accent')} value={seeds.accent} onChange={(accent) => { onChange({ ...seeds, accent }) }} />
        <ColorField label={t('editor.background')} value={seeds.background} onChange={(background) => { onChange({ ...seeds, background }) }} />
        <ColorField label={t('editor.foreground')} value={seeds.foreground} onChange={(foreground) => { onChange({ ...seeds, foreground }) }} />
      </div>
      <label className={css.field}>
        <span>{t('editor.contrast')} ({seeds.contrast})</span>
        <input
          type="range"
          className={css.slider}
          min={0}
          max={100}
          value={seeds.contrast}
          style={sliderFillStyle(seeds.contrast, 0, 100)}
          onChange={(event) => { onChange({ ...seeds, contrast: Number(event.currentTarget.value) }) }}
        />
      </label>
      {advanced ? (
        <div className={css.overrides}>
          {OVERRIDE_FIELDS.map(name => (
            <label key={name} className={css.field}>
              <span>{name}</span>
              <Input
                value={seeds.overrides?.[name] ?? ''}
                placeholder="Auto"
                onChange={(event) => {
                  const next = { ...seeds.overrides, [name]: event.currentTarget.value }
                  onChange({ ...seeds, overrides: next })
                }}
              />
            </label>
          ))}
        </div>
      ) : null}
    </fieldset>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className={css.colorField}>
      <input type="color" value={value} onChange={(event) => { onChange(event.currentTarget.value) }} />
      <span>
        <span className={css.colorLabel}>{label}</span>
        <code>{value}</code>
      </span>
    </label>
  )
}
