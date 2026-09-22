import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SettingsNavigation } from '../src/client/settings-navigation.ts'
import { SettingsNavigationService } from '../src/client/settings-navigation.ts'

async function bench() {
  const ctx = new Context()
  const fiber = ctx.plugin({ apply: pluginCtx => { new SettingsNavigationService(pluginCtx) } })
  await fiber.await()
  return { ctx, fiber, navigation: ctx.get('settingsNavigation') as SettingsNavigation }
}

describe('SettingsNavigationService', () => {
  it('opens, switches, and closes through one observable snapshot', async () => {
    const { fiber, navigation } = await bench()
    const changed = vi.fn()
    const off = navigation.subscribe(changed)

    expect(navigation.getSnapshot()).toEqual({ open: false, sectionId: undefined })
    navigation.open('skills')
    expect(navigation.getSnapshot()).toEqual({ open: true, sectionId: 'skills' })
    navigation.open('models')
    expect(navigation.getSnapshot()).toEqual({ open: true, sectionId: 'models' })
    navigation.open('')
    expect(navigation.getSnapshot()).toEqual({ open: true, sectionId: undefined })
    navigation.close()
    expect(navigation.getSnapshot()).toEqual({ open: false, sectionId: undefined })
    expect(changed).toHaveBeenCalledTimes(4)

    off()
    await fiber.dispose()
    expect(navigation.getSnapshot()).toEqual({ open: false, sectionId: undefined })
  })

  it('retains an early open request until the Settings shell consumes it', async () => {
    const { fiber, navigation } = await bench()
    navigation.open('skills')
    expect(navigation.getSnapshot()).toEqual({ open: true, sectionId: 'skills' })
    navigation.close()
    expect(navigation.getSnapshot()).toEqual({ open: false, sectionId: undefined })
    await fiber.dispose()
  })

  it('replaces the service on reload and removes it on disposal', async () => {
    const { ctx, fiber, navigation } = await bench()
    await fiber.restart()
    const replacement = ctx.get('settingsNavigation') as SettingsNavigation
    expect(replacement).not.toBe(navigation)
    expect(replacement.getSnapshot()).toEqual({ open: false, sectionId: undefined })
    await fiber.dispose()
    expect(ctx.get('settingsNavigation')).toBeUndefined()
  })
})
