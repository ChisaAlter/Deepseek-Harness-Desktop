/** Titlebar plugin injects panel toggles into the trailing cluster at order 40. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import type { PanelTogglesInjected } from '../src/client/PanelToggles.tsx'
import { PanelToggles } from '../src/client/PanelToggles.tsx'
import { SurfacesToggleRow, TerminalToggleRow } from '../src/client/PanelToggleRow.tsx'
import type { PanelToggleRowInjected } from '../src/client/PanelToggleRow.tsx'

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'shell.titlebar.trailing': { kind: 'list', scope: 'root' },
      'settings.interface.item': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

function provideSettings(ctx: Context): void {
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false })
  ctx.provide('remote', { $on: () => () => {} })
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  const layout = { toggleSurfaces: vi.fn(), toggleTerminalDrawer: vi.fn() }
  ctx.provide('layout', layout)
  ctx.provide('locale', new LocaleRuntime(ctx))
  provideSettings(ctx)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, fiber, layout }
}

describe('ui-titlebar apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('injects panel toggles into shell.titlebar.trailing at order 40', async () => {
    const b = await bench()
    const entry = b.slots.entries('shell.titlebar.trailing')[0]
    expect(entry?.component).toBe(PanelToggles)
    expect(entry?.options).toMatchObject({ id: 'panel-toggles', order: 40 })
    const injected = (entry?.inject as unknown as () => PanelTogglesInjected)()
    injected.toggleTerminalDrawer()
    injected.toggleSurfaces()
    expect(b.layout.toggleTerminalDrawer).toHaveBeenCalledOnce()
    expect(b.layout.toggleSurfaces).toHaveBeenCalledOnce()
    const rows = b.slots.entries('settings.interface.item')
    expect(rows.map(row => row.options.id)).toEqual(['terminal-toggle', 'surfaces-toggle'])
    expect(rows[0]?.component).toBe(TerminalToggleRow)
    expect(rows[1]?.component).toBe(SurfacesToggleRow)
    const terminalInjected = (rows[0]?.inject as unknown as () => PanelToggleRowInjected)()
    const surfacesInjected = (rows[1]?.inject as unknown as () => PanelToggleRowInjected)()
    expect(terminalInjected.hooks.visible.getSnapshot()).toBe(true)
    terminalInjected.setVisible(false)
    expect(terminalInjected.hooks.visible.getSnapshot()).toBe(false)
    surfacesInjected.setVisible(false)
    expect(surfacesInjected.hooks.visible.getSnapshot()).toBe(false)
    await b.fiber.dispose()
    expect(b.slots.entries('shell.titlebar.trailing')).toHaveLength(0)
    expect(b.slots.entries('settings.interface.item')).toHaveLength(0)
  })

  it('re-registers after the declaring titlebar slot collapses and returns', async () => {
    const b = await bench()
    b.declaration()
    expect(b.slots.entries('shell.titlebar.trailing')).toHaveLength(0)
    const redeclare = declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('shell.titlebar.trailing')[0]?.component).toBe(PanelToggles)
    expect(b.slots.entries('shell.titlebar.trailing')[0]?.options).toMatchObject({
      id: 'panel-toggles',
      order: 40,
    })
    redeclare()
    await b.fiber.dispose()
  })
})
