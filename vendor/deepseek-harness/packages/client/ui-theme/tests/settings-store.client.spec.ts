/** Appearance page and font-size row stores: snapshot-mirror actions and revision guards. */
import { describe, expect, it } from 'vitest'
import { createAppearanceRowStore, createFontSizeRowStore } from '../src/client/settings-store.ts'
import type { AppearanceSyncSnapshot } from '../src/client/settings-store.ts'
import { DEFAULT_THEME_SETTINGS } from '../src/theme-settings.ts'

function snap(overrides: Partial<AppearanceSyncSnapshot> = {}): AppearanceSyncSnapshot {
  return {
    preference: DEFAULT_THEME_SETTINGS.preference,
    active: { colorScheme: 'light' },
    activeLightThemeId: 'deepseek',
    activeDarkThemeId: 'deepseek',
    families: [],
    customThemes: [],
    glassOpacity: DEFAULT_THEME_SETTINGS.glassOpacity,
    transparentTheme: false,
    wallpaperImage: '',
    wallpaperBlur: 0,
    wallpaperPixelate: 0,
    fontFamilySans: '',
    fontFamilyCode: '',
    fontSizeInterface: DEFAULT_THEME_SETTINGS.fontSizeInterface,
    fontSizeCode: DEFAULT_THEME_SETTINGS.fontSizeCode,
    fontFamilyComposer: '',
    fontFamilyTerminal: '',
    ...overrides,
  }
}

describe('createAppearanceRowStore', () => {
  it('init shape: system preference with revision at -1', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot()).toMatchObject({ preference: 'system', revision: -1, glassOpacity: 80 })
  })

  it('sync mirrors the snapshot and advances the revision', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync(snap({ preference: 'dark', active: { colorScheme: 'dark' }, glassOpacity: 60, wallpaperBlur: 15 }), 0)
    expect(store.getSnapshot()).toMatchObject({
      preference: 'dark', resolvedMode: 'dark', glassOpacity: 60, wallpaperBlur: 15, revision: 0,
    })
    store.actions.sync(snap({ preference: 'light' }), 2)
    expect(store.getSnapshot().preference).toBe('light')
    expect(store.getSnapshot().revision).toBe(2)
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync(snap({ preference: 'dark' }), 3)
    store.actions.sync(snap({ preference: 'system' }), 2)
    store.actions.sync(snap({ preference: 'system' }), 3)
    expect(store.getSnapshot().preference).toBe('dark')
    expect(store.getSnapshot().revision).toBe(3)
  })

  it('mirrors the transparent-theme flag', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot().transparentTheme).toBe(false)
    store.actions.sync(snap({ transparentTheme: true }), 0)
    expect(store.getSnapshot().transparentTheme).toBe(true)
  })

  it('mirrors wallpaperSources and wallpaperFavorites', () => {
    const store = createAppearanceRowStore().create()
    const favorite = {
      id: 'bing-1',
      sourceId: 'bing',
      title: 'Lake',
      thumbUrl: 'https://example.com/t.jpg',
      imageUrl: 'https://example.com/i.jpg',
    }
    store.actions.sync(snap({ wallpaperSources: [], wallpaperFavorites: [favorite] }), 0)
    expect(store.getSnapshot().wallpaperSources).toEqual([])
    expect(store.getSnapshot().wallpaperFavorites).toEqual([favorite])
  })
})

describe('createFontSizeRowStore', () => {
  it('init shape: default size with revision at -1', () => {
    const store = createFontSizeRowStore().create()
    expect(store.getSnapshot()).toEqual({ fontSize: 14, revision: -1 })
  })

  it('sync mirrors the size; the revision guard drops stale and duplicate writes', () => {
    const store = createFontSizeRowStore().create()
    store.actions.sync(16, 3)
    expect(store.getSnapshot()).toEqual({ fontSize: 16, revision: 3 })
    store.actions.sync(12, 2)
    store.actions.sync(12, 3)
    expect(store.getSnapshot().fontSize).toBe(16)
    expect(store.getSnapshot().revision).toBe(3)
  })
})
