/** Shared running-beam renderer used by InputBar and the Settings preview. */
import type { CSSProperties } from 'react'
import clsx from 'clsx'
import type { ComposerBeamStyle } from '../submission-settings.ts'
import css from './ComposerBeam.module.css'

type BeamVariables = CSSProperties & {
  '--dsh-composer-beam-period': string
  '--dsh-composer-beam-stroke-opacity': number
  '--dsh-composer-beam-inner-opacity': number
  '--dsh-composer-beam-bloom-opacity': number
  '--dsh-composer-beam-hue-offset': string
}

/** Map persisted percentages onto the pinned baseline layer opacities. */
function variables(style: ComposerBeamStyle): BeamVariables {
  const intensity = style.intensity / 100
  const bloom = style.bloom / 100
  const opacity = (value: number): number => Number(value.toFixed(4))
  return {
    '--dsh-composer-beam-period': `${style.period}s`,
    '--dsh-composer-beam-stroke-opacity': opacity(0.6 * intensity),
    '--dsh-composer-beam-inner-opacity': opacity(0.42 * intensity),
    '--dsh-composer-beam-bloom-opacity': opacity(0.36 * intensity * bloom),
    '--dsh-composer-beam-hue-offset': `${style.hue}deg`,
  }
}

/** Render the pointer-inert beam layers without owning their containing card. */
export function ComposerBeam({ active, appearance }: {
  active: boolean
  appearance: ComposerBeamStyle
}) {
  return (
    <div
      className={clsx(css.beamLayer, active && css.cardBeam)}
      data-composer-beam=""
      data-beam-direction={appearance.direction}
      style={variables(appearance)}
      aria-hidden="true"
    >
      <span className={css.beamInner} />
      <span className={css.beamStroke} />
      <span className={css.beamBloom} />
    </div>
  )
}
