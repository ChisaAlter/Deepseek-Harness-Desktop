/** Settings modal for the running composer beam's bounded visual tuning. */
import { useEffect, useState, type ChangeEvent } from 'react'
import {
  Button, Modal, SettingsSelect,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import {
  DEFAULT_COMPOSER_BEAM_STYLE,
  MAX_COMPOSER_BEAM_BLOOM, MAX_COMPOSER_BEAM_HUE, MAX_COMPOSER_BEAM_INTENSITY,
  MAX_COMPOSER_BEAM_PERIOD, MIN_COMPOSER_BEAM_BLOOM, MIN_COMPOSER_BEAM_HUE,
  MIN_COMPOSER_BEAM_INTENSITY, MIN_COMPOSER_BEAM_PERIOD,
  type ComposerBeamStyle,
} from '../../submission-settings.ts'
import { ComposerBeam } from '../ComposerBeam.tsx'
import type { ConversationKey } from '../locales.ts'
import css from './BeamSettingsModal.module.css'

type NumericField = 'period' | 'intensity' | 'bloom' | 'hue'

interface SliderProps {
  label: string
  value: number
  valueText: string
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}

function Slider({ label, value, valueText, min, max, step, onChange }: SliderProps) {
  return (
    <label className={css.controlRow}>
      <span className={css.controlLabel}>{label}</span>
      <input
        className={css.slider}
        type="range"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event: ChangeEvent<HTMLInputElement>) => { onChange(Number(event.target.value)) }}
      />
      <span className={css.value}>{valueText}</span>
    </label>
  )
}

/** Draft-on-open modal: Save publishes once, while Cancel drops every edit. */
export function BeamSettingsModal({ open, value, onClose, onSave, t }: {
  open: boolean
  value: ComposerBeamStyle
  onClose: () => void
  onSave: (value: ComposerBeamStyle) => void
  t: Translate<ConversationKey>
}) {
  const [draft, setDraft] = useState<ComposerBeamStyle>(value)
  useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])

  const setNumber = (field: NumericField) => (next: number): void => {
    setDraft(current => ({ ...current, [field]: next }))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settings.beam.panel.title')}
      description={t('settings.beam.panel.description')}
      closeLabel={t('settings.beam.panel.close')}
      className={css.dialog}
      footer={(
        <div className={css.footer}>
          <Button
            variant="outline"
            onClick={() => { setDraft({ ...DEFAULT_COMPOSER_BEAM_STYLE }) }}
          >
            {t('settings.beam.panel.reset')}
          </Button>
          <span className={css.footerSpacer} />
          <Button variant="outline" onClick={onClose}>{t('settings.beam.panel.cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => {
              onSave(draft)
              onClose()
            }}
          >
            {t('settings.beam.panel.save')}
          </Button>
        </div>
      )}
    >
      <div className={css.body}>
        <div className={css.previewStage} aria-label={t('settings.beam.panel.preview')}>
          <div className={css.previewCard}>
            <ComposerBeam active appearance={draft} />
            <span className={css.previewText}>{t('settings.beam.panel.previewStatus')}</span>
          </div>
        </div>

        <div className={css.selectRow}>
          <span className={css.controlLabel}>{t('settings.beam.panel.direction')}</span>
          <SettingsSelect
            className={css.directionSelect}
            variant="block"
            aria-label={t('settings.beam.panel.direction')}
            value={draft.direction}
            options={[
              { id: 'clockwise', label: t('settings.beam.panel.clockwise') },
              { id: 'counterclockwise', label: t('settings.beam.panel.counterclockwise') },
            ]}
            onChange={(direction) => {
              setDraft(current => ({ ...current, direction: direction as ComposerBeamStyle['direction'] }))
            }}
          />
        </div>

        <Slider
          label={t('settings.beam.panel.period')}
          value={draft.period}
          valueText={t('settings.beam.panel.seconds', { value: draft.period.toFixed(2) })}
          min={MIN_COMPOSER_BEAM_PERIOD}
          max={MAX_COMPOSER_BEAM_PERIOD}
          step={0.01}
          onChange={setNumber('period')}
        />
        <Slider
          label={t('settings.beam.panel.intensity')}
          value={draft.intensity}
          valueText={`${draft.intensity}%`}
          min={MIN_COMPOSER_BEAM_INTENSITY}
          max={MAX_COMPOSER_BEAM_INTENSITY}
          step={5}
          onChange={setNumber('intensity')}
        />
        <Slider
          label={t('settings.beam.panel.bloom')}
          value={draft.bloom}
          valueText={`${draft.bloom}%`}
          min={MIN_COMPOSER_BEAM_BLOOM}
          max={MAX_COMPOSER_BEAM_BLOOM}
          step={5}
          onChange={setNumber('bloom')}
        />
        <Slider
          label={t('settings.beam.panel.hue')}
          value={draft.hue}
          valueText={t('settings.beam.panel.degrees', { value: draft.hue })}
          min={MIN_COMPOSER_BEAM_HUE}
          max={MAX_COMPOSER_BEAM_HUE}
          step={5}
          onChange={setNumber('hue')}
        />
      </div>
    </Modal>
  )
}
