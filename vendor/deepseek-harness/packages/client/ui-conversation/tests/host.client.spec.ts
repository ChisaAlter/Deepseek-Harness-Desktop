import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  CONVERSATION_SETTINGS_NAMESPACE, DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_COMPOSER_BEAM,
  DEFAULT_COMPOSER_RESIZE, DEFAULT_OFFICIAL_PEAK_VALLEY, DEFAULT_STATS_LINE, DEFAULT_VIEW_TABS, apply,
} from '@deepseek-ai/dsh-client-ui-conversation'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-conversation host', () => {
  it('registers, validates, and disposes the durable busy-Enter, composer-beam, composer-resize, stats-line, peak-valley, and view-tabs preferences', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(CONVERSATION_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({
      busyEnter: DEFAULT_BUSY_ENTER_BEHAVIOR,
      composerBeam: DEFAULT_COMPOSER_BEAM,
      composerResize: DEFAULT_COMPOSER_RESIZE,
      statsLine: DEFAULT_STATS_LINE,
      officialPeakValley: DEFAULT_OFFICIAL_PEAK_VALLEY,
      viewTabs: DEFAULT_VIEW_TABS,
    })
    await ctx.settings.update(ns, {
      busyEnter: 'steer', composerBeam: false, composerResize: true,
      composerResizeHeight: 160, composerResizeWidth: 480,
      statsLine: false, officialPeakValley: true, viewTabs: false,
    })
    expect(ctx.settings.get(ns)).toEqual({
      busyEnter: 'steer', composerBeam: false, composerResize: true,
      composerResizeHeight: 160, composerResizeWidth: 480,
      statsLine: false, officialPeakValley: true, viewTabs: false,
    })
    await expect(ctx.settings.update(ns, { busyEnter: 'invalid' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { composerBeam: 'yes' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { composerResize: 'yes' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { composerResizeHeight: 'tall' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { composerResizeWidth: 'wide' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { statsLine: 'yes' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { officialPeakValley: 'yes' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { viewTabs: 'yes' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
