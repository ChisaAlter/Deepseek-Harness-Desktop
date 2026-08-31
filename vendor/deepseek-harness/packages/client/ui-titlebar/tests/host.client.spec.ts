import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { TITLEBAR_SETTINGS_NAMESPACE, apply } from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-titlebar host', () => {
  it('registers, validates, and disposes the panel-toggle visibility preferences', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = TITLEBAR_SETTINGS_NAMESPACE
    expect(ctx.settings.get(ns)).toEqual({ terminalToggle: true, surfacesToggle: true })
    await ctx.settings.update(ns, { terminalToggle: false, surfacesToggle: false })
    expect(ctx.settings.get(ns)).toEqual({ terminalToggle: false, surfacesToggle: false })
    await expect(ctx.settings.update(ns, { terminalToggle: 'no' })).rejects.toThrow()
    await expect(ctx.settings.update(ns, { surfacesToggle: 'no' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
