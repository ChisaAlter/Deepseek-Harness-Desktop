import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as SessionLogDownload from '../src/index.ts'
import { SESSION_LOG_EXPORT_SETTINGS_NAMESPACE } from '../src/export-settings.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('session-log-export host', () => {
  it('registers, validates, and disposes the titlebar Session-log visibility preference', async () => {
    const ctx = new Context()
    ctx.provide('commands', {
      register(_next: CommandDefinition) {
        return () => {}
      },
    } as never)
    ctx.provide('connection', {
      fetch: { register() { return async () => {} } },
    } as never)
    await ctx.plugin(MemorySettings).await()
    const fiber = await ctx.plugin(SessionLogDownload)
    const ns = SESSION_LOG_EXPORT_SETTINGS_NAMESPACE
    expect(ctx.settings.get(ns)).toEqual({ titlebarAction: true })
    await ctx.settings.update(ns, { titlebarAction: false })
    expect(ctx.settings.get(ns)).toEqual({ titlebarAction: false })
    await expect(ctx.settings.update(ns, { titlebarAction: 'no' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })
})
