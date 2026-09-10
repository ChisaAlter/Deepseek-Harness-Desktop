/** Shared running-beam renderer used by InputBar and the Settings preview. */
import { useEffect, useState, type CSSProperties } from 'react'
import clsx from 'clsx'
import {
  COMPOSER_BEAM_PALETTE_COLORS,
  normalizeComposerBeamStyle,
  type ComposerBeamStyle,
} from '../submission-settings.ts'
import css from './ComposerBeam.module.css'

type BeamVariables = CSSProperties & Record<string, string | number>

const EASING_VALUES: Record<ComposerBeamStyle['easing'], string> = {
  linear: 'linear',
  ease: 'ease',
  'ease-in-out': 'ease-in-out',
  'cubic-bezier': 'cubic-bezier(.4, 0, .2, 1)',
}

const opacity = (value: number): number => Number(value.toFixed(4))

const withAlpha = (color: string, alpha: string): string => `${color}${alpha}`

function paletteColors(style: ComposerBeamStyle): readonly string[] {
  return style.palette.kind === 'custom'
    ? style.palette.colors
    : COMPOSER_BEAM_PALETTE_COLORS[style.palette.id]
}

function paletteGradient(colors: readonly string[]): string {
  const stops = colors.map((color, index) => {
    const percent = (index / (colors.length - 1)) * 100
    return `${color} ${percent.toFixed(2)}%`
  }).join(', ')
  return ['conic-gradient(from var(--dsh-composer-beam-angle), ', stops, ')'].join('')
}

/** Resolve the local-clock dimming factor for an injected clock value. */
export function composerBeamNightFactor(style: ComposerBeamStyle, now = new Date()): number {
  if (!style.night.enabled) return 1
  const minute = now.getHours() * 60 + now.getMinutes()
  const { fromMinute, toMinute } = style.night
  const inWindow = fromMinute === toMinute
    ? true
    : fromMinute < toMinute
      ? minute >= fromMinute && minute < toMinute
      : minute >= fromMinute || minute < toMinute
  return inWindow ? 1 - style.night.dim / 100 : 1
}

/** Map persisted percentages onto the pinned baseline layer opacities. */
function variables(style: ComposerBeamStyle, now: number): BeamVariables {
  const intensity = style.intensity / 100
  const bloom = style.bloom / 100
  const result: BeamVariables = {
    '--dsh-composer-beam-period': `${style.period}s`,
    '--dsh-composer-beam-stroke-opacity': opacity(0.6 * intensity),
    '--dsh-composer-beam-inner-opacity': opacity(0.42 * intensity),
    '--dsh-composer-beam-bloom-opacity': opacity(0.36 * intensity * bloom),
    '--dsh-composer-beam-hue-offset': `${style.hue}deg`,
    '--dsh-composer-beam-track-width': `${style.trackWidth}px`,
    '--dsh-composer-beam-glow-blur': `${style.glowBlur}px`,
    '--dsh-composer-beam-hue-cycle-range': `${style.hueCycle.range}deg`,
    '--dsh-composer-beam-hue-cycle-period': `${style.hueCycle.period}s`,
    '--dsh-composer-beam-breathing-amplitude': style.breathing.amplitude,
    '--dsh-composer-beam-breathing-period': `${style.breathing.period}s`,
    '--dsh-composer-beam-night-factor': opacity(composerBeamNightFactor(style, new Date(now))),
    '--dsh-composer-beam-easing': EASING_VALUES[style.easing],
  }
  if (style.palette.kind === 'custom' || style.palette.id !== 'legacy') {
    const colors = paletteColors(style)
    const firstColor = colors[0] ?? '#ffffff'
    const lastColor = colors[colors.length - 1] ?? firstColor
    result['--dsh-composer-beam-palette-gradient'] = paletteGradient(colors)
    result['--dsh-composer-beam-inner-shadow'] = [
      `inset 0 0 18px 3px ${withAlpha(firstColor, '66')}`,
      `inset 0 0 42px 10px ${withAlpha(lastColor, '33')}`,
    ].join(', ')
  }
  return result
}

/** Render the pointer-inert beam layers without owning their containing card. */
export function ComposerBeam({ active, appearance }: {
  active: boolean
  appearance: ComposerBeamStyle
}) {
  const style = normalizeComposerBeamStyle(appearance)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active || !style.night.enabled) return
    const update = () => { setNow(Date.now()) }
    update()
    const timer = window.setInterval(update, 60_000)
    return () => { window.clearInterval(timer) }
  }, [active, style.night.enabled])

  return (
    <div
      className={clsx(css.beamLayer, active && css.cardBeam)}
      data-composer-beam=""
      data-beam-direction={style.direction}
      data-beam-mode={style.mode}
      data-beam-breathing={style.breathing.enabled ? 'on' : 'off'}
      data-beam-hue-cycle={style.hueCycle.enabled ? 'on' : 'off'}
      style={variables(style, now)}
      aria-hidden="true"
    >
      <span className={css.beamInner} />
      <span className={css.beamStroke} />
      <span className={css.beamBloom} />
    </div>
  )
}
