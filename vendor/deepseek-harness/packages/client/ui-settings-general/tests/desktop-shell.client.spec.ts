// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { canPersistCloseBehavior, desktopShell } from '../src/client/desktop-shell.ts'

afterEach(() => {
  delete (window as Window & { shell?: unknown }).shell
})

describe('desktopShell', () => {
  it('returns null without a shell bridge', () => {
    expect(desktopShell()).toBeNull()
    expect(canPersistCloseBehavior()).toBe(false)
  })

  it('returns the preload object when present', () => {
    const api = {
      getConfig: async () => ({ closeToTray: true }),
      saveConfig: async () => ({ closeToTray: true }),
    }
    ;(window as Window & { shell?: unknown }).shell = api
    expect(desktopShell()).toBe(api)
    expect(canPersistCloseBehavior()).toBe(true)
  })

  it('requires both getConfig and saveConfig to persist close behavior', () => {
    ;(window as Window & { shell?: unknown }).shell = {
      getConfig: async () => ({ closeToTray: true }),
    }
    expect(canPersistCloseBehavior()).toBe(false)
    ;(window as Window & { shell?: unknown }).shell = {
      saveConfig: async () => ({ closeToTray: true }),
    }
    expect(canPersistCloseBehavior()).toBe(false)
    expect(canPersistCloseBehavior(null)).toBe(false)
  })
})
