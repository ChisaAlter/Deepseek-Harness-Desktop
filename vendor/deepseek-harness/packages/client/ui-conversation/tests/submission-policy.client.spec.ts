// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  ComposerSubmissionPolicy, DEFAULT_BUSY_ENTER_BEHAVIOR,
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

describe('ComposerSubmissionPolicy', () => {
  it('defaults to Queue and only applies the preference while running', () => {
    const policy = new ComposerSubmissionPolicy()
    expect(policy.busyEnter.getSnapshot()).toBe(DEFAULT_BUSY_ENTER_BEHAVIOR)
    expect(policy.resolve(false, 'enter', true)).toBe('queue')
    expect(policy.resolve(false, 'accelerated', true)).toBe('queue')
    expect(policy.resolve(true, 'enter', true)).toBe('queue')
    expect(policy.resolve(true, 'accelerated', true)).toBe('steer')
    expect(policy.resolve(true, 'enter', false)).toBe('queue')
    expect(policy.resolve(true, 'accelerated', false)).toBe('queue')

    const changed = vi.fn()
    policy.busyEnter.subscribe(changed)
    policy.setBusyEnter('steer')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(policy.resolve(true, 'enter', true)).toBe('steer')
    expect(policy.resolve(true, 'accelerated', true)).toBe('queue')
    expect(policy.resolve(false, 'enter', true)).toBe('queue')
    expect(policy.resolve(false, 'accelerated', true)).toBe('queue')
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
