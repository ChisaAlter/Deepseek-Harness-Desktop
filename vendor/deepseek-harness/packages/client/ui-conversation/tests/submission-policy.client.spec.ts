// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  ComposerSubmissionPolicy, DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_COMPOSER_BEAM_PRESETS,
  DEFAULT_COMPOSER_BEAM_STYLE, normalizeComposerBeamPresets, normalizeComposerBeamStyle, resolveSubmitMode,
} from '../src/client/input/submission-policy.ts'
import type { ConversationSettings } from '../src/submission-settings.ts'

function chrome(over: Partial<ConversationSettings> = {}): ConversationSettings {
  return {
    busyEnter: 'queue',
    composerBeam: true,
    composerResize: false,
    composerResizeHeight: null,
    composerResizeWidth: null,
    statsLine: true,
    officialPeakValley: false,
    viewTabs: true,
    ...over,
  }
}

describe('resolveSubmitMode', () => {
  it('queues outside steer-capable busy state and applies the preference to the enter gesture', () => {
    expect(resolveSubmitMode('queue', false, 'enter', true)).toBe('queue')
    expect(resolveSubmitMode('queue', false, 'accelerated', true)).toBe('queue')
    expect(resolveSubmitMode('queue', true, 'enter', true)).toBe('queue')
    expect(resolveSubmitMode('queue', true, 'accelerated', true)).toBe('steer')
    expect(resolveSubmitMode('queue', true, 'enter', false)).toBe('queue')
    expect(resolveSubmitMode('queue', true, 'accelerated', false)).toBe('queue')

    expect(resolveSubmitMode('steer', true, 'enter', true)).toBe('steer')
    expect(resolveSubmitMode('steer', true, 'accelerated', true)).toBe('queue')
    expect(resolveSubmitMode('steer', false, 'enter', true)).toBe('queue')
    expect(resolveSubmitMode('steer', false, 'accelerated', true)).toBe('queue')
    expect(resolveSubmitMode('steer', true, 'enter', false)).toBe('queue')
  })
})

describe('ComposerSubmissionPolicy', () => {
  it('defaults to Queue and publishes preference changes', () => {
    const policy = new ComposerSubmissionPolicy()
    expect(policy.busyEnter.getSnapshot()).toBe(DEFAULT_BUSY_ENTER_BEHAVIOR)

    const changed = vi.fn()
    policy.busyEnter.subscribe(changed)
    policy.setBusyEnter('steer')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
  })

  it('writes an explicit change through the scope after publishing it locally', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const observed: string[] = []
    let liveBehavior = (): string => 'unconstructed'
    const scope: typeof host.scope = {
      ...host.scope,
      set: (field, value) => {
        observed.push(`${field}=${String(value)}:${liveBehavior()}`)
        return host.scope.set(field, value)
      },
    }
    const policy = new ComposerSubmissionPolicy(scope)
    liveBehavior = () => policy.busyEnter.getSnapshot()
    policy.setBusyEnter('steer')
    expect(observed).toEqual(['busyEnter=steer:steer'])
    expect(host.set).toHaveBeenCalledWith('busyEnter', 'steer')
    expect(host.set).toHaveBeenCalledOnce()
  })

  it('adopts a Host preference without writing it back and leaves an identical write untouched', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    host.publish({ status: 'ready', value: chrome({ busyEnter: 'steer' }), revision: 1, writable: true })
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
    policy.setBusyEnter('steer')
    expect(host.set).not.toHaveBeenCalled()
    host.publish({ value: chrome({ busyEnter: 'steer' }), revision: 2 })
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
  })

  it('adopts a section already standing at construction', () => {
    const host = stubSettingsScope<ConversationSettings>()
    host.publish({ status: 'ready', value: chrome({ busyEnter: 'steer' }), revision: 1, writable: true })
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
  })

  it('keeps the composer beam on while the Host section is missing and adopts false independently', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.composerBeam.getSnapshot()).toBe(true)
    expect(policy.writable.getSnapshot()).toBe(false)
    host.publish({ status: 'unavailable', value: undefined, writable: false, mode: 'memory' })
    expect(policy.composerBeam.getSnapshot()).toBe(true)
    host.publish({
      status: 'ready',
      value: chrome({ busyEnter: 'steer', composerBeam: false }),
      revision: 1,
      writable: true,
    })
    expect(policy.busyEnter.getSnapshot()).toBe('steer')
    expect(policy.composerBeam.getSnapshot()).toBe(false)
    expect(policy.writable.getSnapshot()).toBe(true)
    policy.setComposerBeam(true)
    expect(policy.composerBeam.getSnapshot()).toBe(true)
    expect(host.set).toHaveBeenCalledWith('composerBeam', true)
    policy.setComposerBeam(true)
    expect(host.set).toHaveBeenCalledOnce()
  })

  it('treats a missing composerBeam field as shown', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    policy.setComposerBeam(false)
    host.publish({
      status: 'ready',
      value: { busyEnter: 'queue' } as ConversationSettings,
      revision: 1,
      writable: true,
    })
    expect(policy.composerBeam.getSnapshot()).toBe(true)
  })

  it('publishes normalized beam tuning before persisting it and adopts legacy absence', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.composerBeamStyle.getSnapshot()).toBe(DEFAULT_COMPOSER_BEAM_STYLE)

    const observed: number[] = []
    policy.composerBeamStyle.subscribe(() => { observed.push(policy.composerBeamStyle.getSnapshot().period) })
    policy.setComposerBeamStyle({
      ...DEFAULT_COMPOSER_BEAM_STYLE,
      direction: 'counterclockwise', period: 3, intensity: 120, bloom: 80, hue: 45,
    })
    expect(observed).toEqual([3])
    expect(host.set).toHaveBeenCalledWith('composerBeamStyle', {
      ...DEFAULT_COMPOSER_BEAM_STYLE,
      direction: 'counterclockwise', period: 3, intensity: 120, bloom: 80, hue: 45,
    })

    host.publish({
      status: 'ready', value: chrome(), revision: 1, writable: true,
    })
    expect(policy.composerBeamStyle.getSnapshot()).toEqual(DEFAULT_COMPOSER_BEAM_STYLE)
  })

  it('normalizes malformed or out-of-range beam tuning at the adoption boundary', () => {
    expect(normalizeComposerBeamStyle({
      direction: 'sideways', period: 99, intensity: -1, bloom: 999, hue: Number.NaN,
    })).toEqual({
      ...DEFAULT_COMPOSER_BEAM_STYLE,
      direction: 'clockwise', period: 60, intensity: 40, bloom: 160, hue: 0,
    })
  })

  it('publishes active style and presets in one atomic mutation', async () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    host.publish({ status: 'ready', value: chrome(), revision: 7, writable: true })
    const style = {
      ...DEFAULT_COMPOSER_BEAM_STYLE,
      direction: 'pingPong' as const,
      period: 60,
      trackWidth: 4,
      glowBlur: 0,
      breathing: { enabled: true, amplitude: 0.5, period: 9 },
      hueCycle: { enabled: false, range: 180, period: 20 },
      night: { enabled: true, fromMinute: 1320, toMinute: 360, dim: 50 },
      palette: { kind: 'custom' as const, colors: ['#112233', '#aabbcc'] },
    }
    const presets = { Focus: style }
    host.mutate.mockImplementation(async (ops: readonly { path: string[]; value?: unknown }[]) => {
      host.publish({
        status: 'ready',
        value: chrome({
          composerBeamStyle: ops[0]?.value as never,
          composerBeamPresets: ops[1]?.value as never,
        }),
        revision: 8,
        writable: true,
      })
    })
    await policy.setComposerBeamConfiguration(style, presets)
    expect(policy.composerBeamStyle.getSnapshot()).toEqual(style)
    expect(policy.composerBeamPresets.getSnapshot()).toEqual({ Focus: style })
    expect(host.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['composerBeamStyle'], value: style },
      { op: 'set', path: ['composerBeamPresets'], value: { Focus: style } },
    ], 7)
    expect(host.set).not.toHaveBeenCalled()
  })

  it('caps and sanitizes the preset library without mutating the caller', () => {
    const source: Record<string, unknown> = {
      '  one  ': DEFAULT_COMPOSER_BEAM_STYLE,
      two: DEFAULT_COMPOSER_BEAM_STYLE,
      three: DEFAULT_COMPOSER_BEAM_STYLE,
      four: DEFAULT_COMPOSER_BEAM_STYLE,
      five: DEFAULT_COMPOSER_BEAM_STYLE,
      six: DEFAULT_COMPOSER_BEAM_STYLE,
      __proto__: DEFAULT_COMPOSER_BEAM_STYLE,
    }
    expect(normalizeComposerBeamPresets(source)).toEqual({
      one: DEFAULT_COMPOSER_BEAM_STYLE,
      two: DEFAULT_COMPOSER_BEAM_STYLE,
      three: DEFAULT_COMPOSER_BEAM_STYLE,
      four: DEFAULT_COMPOSER_BEAM_STYLE,
      five: DEFAULT_COMPOSER_BEAM_STYLE,
    })
    expect(DEFAULT_COMPOSER_BEAM_PRESETS).toEqual({})
  })

  it('reports a rejected atomic mutation instead of claiming that the save succeeded', async () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    host.publish({ status: 'ready', value: chrome(), revision: 2, writable: true })
    await expect(policy.setComposerBeamConfiguration({ ...DEFAULT_COMPOSER_BEAM_STYLE, hue: 90 }, {})).rejects.toThrow()
    expect(host.mutate).toHaveBeenCalledOnce()
  })

  it('keeps composer resize off while the Host section is missing and adopts true independently', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.composerResize.getSnapshot()).toBe(false)
    host.publish({ status: 'unavailable', value: undefined, writable: false, mode: 'memory' })
    expect(policy.composerResize.getSnapshot()).toBe(false)
    host.publish({
      status: 'ready',
      value: chrome({ composerResize: true }),
      revision: 1,
      writable: true,
    })
    expect(policy.composerResize.getSnapshot()).toBe(true)
    policy.setComposerResizeSize({ height: 180, width: 500 })
    expect(policy.composerResizeHeight.getSnapshot()).toBe(180)
    expect(policy.composerResizeWidth.getSnapshot()).toBe(500)
    policy.setComposerResize(false)
    expect(policy.composerResize.getSnapshot()).toBe(false)
    // Turning the switch off clears the live DOM size, but keeps the remembered
    // box so enabling resize again (or remounting) restores the last drag.
    expect(policy.composerResizeHeight.getSnapshot()).toBe(180)
    expect(policy.composerResizeWidth.getSnapshot()).toBe(500)
    expect(host.set).toHaveBeenCalledWith('composerResize', false)
    const calls = host.set.mock.calls.length
    policy.setComposerResize(false)
    expect(host.set).toHaveBeenCalledTimes(calls)
  })

  it('remembers a dragged composer size through the Host scope', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    policy.setComposerResizeSize({ height: 140, width: 420 })
    expect(host.set).toHaveBeenCalledWith('composerResizeHeight', 140)
    expect(host.set).toHaveBeenCalledWith('composerResizeWidth', 420)
    host.publish({
      status: 'ready',
      value: chrome({ composerResize: true, composerResizeHeight: 140, composerResizeWidth: 420 }),
      revision: 1,
      writable: true,
    })
    expect(policy.composerResizeHeight.getSnapshot()).toBe(140)
    expect(policy.composerResizeWidth.getSnapshot()).toBe(420)
  })

  it('treats a missing composerResize field as off', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    policy.setComposerResize(true)
    host.publish({
      status: 'ready',
      value: { busyEnter: 'queue' } as ConversationSettings,
      revision: 1,
      writable: true,
    })
    expect(policy.composerResize.getSnapshot()).toBe(false)
  })

  it('keeps statsLine and viewTabs on while the Host section is missing and adopts false independently', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.statsLine.getSnapshot()).toBe(true)
    expect(policy.viewTabs.getSnapshot()).toBe(true)
    host.publish({ status: 'unavailable', value: undefined, writable: false, mode: 'memory' })
    expect(policy.statsLine.getSnapshot()).toBe(true)
    expect(policy.viewTabs.getSnapshot()).toBe(true)
    host.publish({
      status: 'ready',
      value: chrome({ statsLine: false, viewTabs: false }),
      revision: 1,
      writable: true,
    })
    expect(policy.statsLine.getSnapshot()).toBe(false)
    expect(policy.viewTabs.getSnapshot()).toBe(false)
    policy.setStatsLine(true)
    expect(policy.statsLine.getSnapshot()).toBe(true)
    expect(host.set).toHaveBeenCalledWith('statsLine', true)
    policy.setViewTabs(true)
    expect(policy.viewTabs.getSnapshot()).toBe(true)
    expect(host.set).toHaveBeenCalledWith('viewTabs', true)
    policy.setStatsLine(true)
    policy.setViewTabs(true)
    expect(host.set).toHaveBeenCalledTimes(2)
  })

  it('treats missing statsLine and viewTabs fields as shown', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    policy.setStatsLine(false)
    policy.setViewTabs(false)
    host.publish({
      status: 'ready',
      value: { busyEnter: 'queue' } as ConversationSettings,
      revision: 1,
      writable: true,
    })
    expect(policy.statsLine.getSnapshot()).toBe(true)
    expect(policy.viewTabs.getSnapshot()).toBe(true)
  })

  it('keeps officialPeakValley off while the Host section is missing and adopts true independently', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    expect(policy.officialPeakValley.getSnapshot()).toBe(false)
    host.publish({ status: 'unavailable', value: undefined, writable: false, mode: 'memory' })
    expect(policy.officialPeakValley.getSnapshot()).toBe(false)
    host.publish({
      status: 'ready',
      value: chrome({ officialPeakValley: true }),
      revision: 1,
      writable: true,
    })
    expect(policy.officialPeakValley.getSnapshot()).toBe(true)
    policy.setOfficialPeakValley(false)
    expect(policy.officialPeakValley.getSnapshot()).toBe(false)
    expect(host.set).toHaveBeenCalledWith('officialPeakValley', false)
    policy.setOfficialPeakValley(false)
    expect(host.set).toHaveBeenCalledOnce()
  })

  it('treats a missing officialPeakValley field as detection-only', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new ComposerSubmissionPolicy(host.scope)
    policy.setOfficialPeakValley(true)
    host.publish({
      status: 'ready',
      value: { busyEnter: 'queue' } as ConversationSettings,
      revision: 1,
      writable: true,
    })
    expect(policy.officialPeakValley.getSnapshot()).toBe(false)
  })
})
