import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { GIT_SETTINGS_NAMESPACE, apply } from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-git host', () => {
  it('registers, validates, and disposes the titlebar Git visibility preference', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = GIT_SETTINGS_NAMESPACE
    expect(ctx.settings.get(ns)).toEqual({ titlebarGit: true })
    await ctx.settings.update(ns, { titlebarGit: false })
    expect(ctx.settings.get(ns)).toEqual({ titlebarGit: false })
    await expect(ctx.settings.update(ns, { titlebarGit: 'no' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
