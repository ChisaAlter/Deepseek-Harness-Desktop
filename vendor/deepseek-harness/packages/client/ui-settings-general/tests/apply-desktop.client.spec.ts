// @vitest-environment jsdom
/** Desktop-only close-window row: present only when the shell can persist it. */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope, TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-general/client'
import { CloseBehaviorRow } from '../src/client/CloseBehaviorRow.tsx'
import { AutoStartDesktopRow } from '../src/client/AutoStartDesktopRow.tsx'

usePinnedBrowserLanguages('zh-CN')

afterEach(() => {
  delete (window as Window & { shell?: unknown }).shell
})

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  ctx.provide('connection', {
    api: { settings: { describe: async () => ({ result: { ok: false } }) } },
    isLoopback: false,
  } as never)
  const remote = new TestRemote(ctx, { settings: { describe: async () => ({ ok: false }) } })
  remote.$host = { home: undefined, isLoopback: false }
  // apply() injects `settingsScope` (the ui-settings domain service); the
  // stub stands in for the binder the real settings plugin would provide.
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.trigger': { kind: 'single', scope: 'root' },
        'settings.header': { kind: 'single', scope: 'root' },
        'settings.action': { kind: 'list', scope: 'root' },
        'settings.close': { kind: 'single', scope: 'root' },
        'settings.section': { kind: 'list', scope: 'root' },
        'settings.onboarding': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

describe('ui-settings-general desktop close-behavior row', () => {
  it('registers the row when the desktop shell can persist closeToTray', async () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ closeToTray: true }),
      saveConfig: async () => ({ closeToTray: true }),
    }
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const rows = b.slots.entries('settings.general.item')
    const closeRow = rows.find(row => row.options.id === 'close-behavior')!
    expect(closeRow.component).toBe(CloseBehaviorRow)
    expect(closeRow.options).toMatchObject({ id: 'close-behavior', order: 25 })
    expect(closeRow.locale).toBe('settings')
    const autoStartRow = rows.find(row => row.options.id === 'auto-start-desktop')!
    expect(autoStartRow.component).toBe(AutoStartDesktopRow)
    expect(autoStartRow.options).toMatchObject({ id: 'auto-start-desktop', order: 26 })
    await fiber.dispose()
    expect(b.slots.entries('settings.general.item')).toEqual([])
  })

  it('withholds the row without a persistable desktop shell', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.general.item')).toEqual([])
  })
})
