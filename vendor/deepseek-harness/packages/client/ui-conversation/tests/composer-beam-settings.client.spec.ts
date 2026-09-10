// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { ComposerBeam, composerBeamNightFactor } from '../src/client/ComposerBeam.tsx'
import {
  parseComposerBeamConfiguration,
  serializeComposerBeamConfiguration,
} from '../src/client/settings/BeamSettingsModal.tsx'
import {
  DEFAULT_COMPOSER_BEAM_STYLE,
  normalizeComposerBeamStyle,
} from '../src/submission-settings.ts'

const style = {
  ...DEFAULT_COMPOSER_BEAM_STYLE,
  direction: 'pingPong' as const,
  period: 60,
  trackWidth: 4,
  glowBlur: 0,
  palette: { kind: 'custom' as const, colors: ['#112233', '#aabbcc'] },
  night: { enabled: true, fromMinute: 1320, toMinute: 360, dim: 50 },
}

afterEach(cleanup)

describe('composer beam settings', () => {
  it('normalizes new ranges, enums, and custom colors while preserving the legacy defaults', () => {
    expect(normalizeComposerBeamStyle({
      ...style,
      direction: 'backwards',
      period: 999,
      trackWidth: -1,
      glowBlur: 99,
      palette: { kind: 'custom', colors: ['#112233', 'rgb(1, 2, 3)'] },
    })).toEqual({
      ...style,
      period: 60,
      direction: 'clockwise',
      trackWidth: 0.5,
      glowBlur: 12,
      palette: { kind: 'preset', id: 'legacy' },
    })
    expect(normalizeComposerBeamStyle({
      ...DEFAULT_COMPOSER_BEAM_STYLE,
      direction: 'pingPong',
      trackWidth: 0.5,
      glowBlur: 12,
      palette: { kind: 'custom', colors: ['#112233', '#AABBCC'] },
    })).toMatchObject({
      direction: 'pingPong',
      trackWidth: 0.5,
      glowBlur: 12,
      palette: { kind: 'custom', colors: ['#112233', '#aabbcc'] },
    })
  })

  it('applies night dimming to normal, cross-midnight, and all-day windows', () => {
    const crossMidnight = { ...style, night: { enabled: true, fromMinute: 1320, toMinute: 360, dim: 50 } }
    expect(composerBeamNightFactor(crossMidnight, new Date(2026, 0, 1, 23, 0))).toBe(0.5)
    expect(composerBeamNightFactor(crossMidnight, new Date(2026, 0, 1, 2, 0))).toBe(0.5)
    expect(composerBeamNightFactor(crossMidnight, new Date(2026, 0, 1, 12, 0))).toBe(1)

    const daytime = { ...style, night: { enabled: true, fromMinute: 540, toMinute: 1020, dim: 25 } }
    expect(composerBeamNightFactor(daytime, new Date(2026, 0, 1, 9, 0))).toBe(0.75)
    expect(composerBeamNightFactor(daytime, new Date(2026, 0, 1, 17, 0))).toBe(1)

    const allDay = { ...style, night: { enabled: true, fromMinute: 600, toMinute: 600, dim: 80 } }
    expect(composerBeamNightFactor(allDay, new Date(2026, 0, 1, 12, 0))).toBeCloseTo(0.2)
  })

  it('round-trips only the beam envelope and ignores unknown JSON fields', () => {
    const serialized = serializeComposerBeamConfiguration(style, { Calm: style })
    const parsed = parseComposerBeamConfiguration(serialized)
    expect(parsed.style).toEqual(style)
    expect(parsed.presets).toEqual({ Calm: style })

    const withUnknown = JSON.parse(serialized) as Record<string, unknown>
    withUnknown.unrelated = { shouldBeIgnored: true }
    withUnknown.style = { ...(withUnknown.style as object), unrelated: true }
    expect(parseComposerBeamConfiguration(JSON.stringify(withUnknown)).style).toEqual(style)
  })

  it('emits the extended renderer variables and data switches from the shared style', () => {
    const { container } = render(createElement(ComposerBeam, { active: true, appearance: style }))
    const beam = container.querySelector('[data-composer-beam]') as HTMLElement
    expect(beam.dataset.beamDirection).toBe('pingPong')
    expect(beam.dataset.beamMode).toBe('legacy')
    expect(beam.dataset.beamBreathing).toBe('off')
    expect(beam.dataset.beamHueCycle).toBe('on')
    expect(beam.style.getPropertyValue('--dsh-composer-beam-track-width')).toBe('4px')
    expect(beam.style.getPropertyValue('--dsh-composer-beam-glow-blur')).toBe('0px')
    expect(beam.style.getPropertyValue('--dsh-composer-beam-palette-gradient')).toContain('#112233')
  })

  it('rejects unsupported JSON envelopes and inputs larger than 64KiB', () => {
    expect(() => parseComposerBeamConfiguration(JSON.stringify({ core: 'other', version: 1 }))).toThrow()
    expect(() => parseComposerBeamConfiguration(JSON.stringify({ core: 'dsh-composer-beam', version: 2 }))).toThrow()
    expect(() => parseComposerBeamConfiguration('x'.repeat(65 * 1024))).toThrow()

    const invalidColor = JSON.parse(serializeComposerBeamConfiguration(style, {})) as {
      style: { palette: unknown }
    }
    invalidColor.style.palette = { kind: 'custom', colors: ['#112233', 'var(--bad)'] }
    expect(() => parseComposerBeamConfiguration(JSON.stringify(invalidColor))).toThrow()

    const invalidName = JSON.parse(serializeComposerBeamConfiguration(style, {})) as {
      presets: Record<string, unknown>
    }
    invalidName.presets = { ' bad ': style }
    expect(() => parseComposerBeamConfiguration(JSON.stringify(invalidName))).toThrow()

    const tooMany = JSON.parse(serializeComposerBeamConfiguration(style, {})) as {
      presets: Record<string, unknown>
    }
    tooMany.presets = Object.fromEntries(Array.from({ length: 6 }, (_unused, index) => [`p${index}`, style]))
    expect(() => parseComposerBeamConfiguration(JSON.stringify(tooMany))).toThrow()
  })
})
