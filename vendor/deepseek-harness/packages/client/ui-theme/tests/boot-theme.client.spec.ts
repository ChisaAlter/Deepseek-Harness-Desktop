// @vitest-environment jsdom
/** The theme bootstrap injection row and the resulting pre-plugin browser theme. */
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootThemeInjection, buildThemeBootPayload, injectBootTheme } from '../src/boot-theme.ts'
import { DEFAULT_THEME_SETTINGS, DEFAULT_WALLPAPER_SOURCES, type ThemePreference } from '../src/theme-settings.ts'

const DARK_ATTRIBUTE = 'data-ds-dark-theme'

function mockSystemDark(matches: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches }) as MediaQueryList))
}

function executeBootstrap(preference?: ThemePreference, fontSize?: number): void {
  const row = bootThemeInjection(preference, fontSize)
  if (row.kind !== 'script') throw new Error('theme bootstrap row is not a script')
  runInNewContext(row.text, { document, matchMedia: globalThis.matchMedia })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.documentElement.style.removeProperty('color-scheme')
  document.documentElement.style.fontSize = ''
  document.body.removeAttribute(DARK_ATTRIBUTE)
  document.body.style.cssText = ''
  document.body.style.removeProperty('--dsh-content-font-size')
})

describe('theme bootstrap row', () => {
  it('is a body script row, so it runs before the shell mount', () => {
    mockSystemDark(false)
    const row = bootThemeInjection('dark')
    expect(row).toMatchObject({ kind: 'script', placement: 'body' })
    executeBootstrap('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(true)
  })

  it('lets durable light override a dark OS and clears stale dark state', () => {
    document.body.setAttribute(DARK_ATTRIBUTE, '')
    mockSystemDark(true)
    executeBootstrap('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
  })

  it.each([
    [true, 'dark', true],
    [false, 'light', false],
  ] as const)('resolves system=%s to %s', (matches, colorScheme, dark) => {
    mockSystemDark(matches)
    executeBootstrap('system')
    expect(document.documentElement.style.colorScheme).toBe(colorScheme)
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(dark)
  })

  it('defaults to system and falls back to light when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    executeBootstrap()
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
  })
  it('writes the durable content font size and defaults it to 14px', () => {
    mockSystemDark(false)
    executeBootstrap('light', 17)
    expect(document.body.style.getPropertyValue('--dsh-content-font-size')).toBe('17px')
    executeBootstrap('light')
    expect(document.body.style.getPropertyValue('--dsh-content-font-size')).toBe('14px')
  })

  it('appends the script to a body-less fragment', () => {
    const html = injectBootTheme('<main>loading</main>', 'dark')
    expect(html.startsWith('<main>loading</main><script>')).toBe(true)
  })

  it('embeds derived tokens for a non-DeepSeek half and writes them before React', () => {
    mockSystemDark(false)
    const payload = buildThemeBootPayload({
      preference: 'light',
      fontSize: 14,
      activeLightThemeId: 'celadon',
      activeDarkThemeId: 'deepseek',
      customThemes: [],
      glassOpacity: 70,
      transparentTheme: false,
      wallpaperImage: '',
      wallpaperBlur: 0,
      wallpaperPixelate: 0,
      wallpaperBingEnabled: false,
      wallpaperCatalogUrls: [],
      wallpaperSources: DEFAULT_WALLPAPER_SOURCES,
      wallpaperFavorites: [],
      fontFamilySans: '',
      fontFamilyCode: '',
      fontSizeInterface: 18,
      fontSizeCode: 13,
      fontFamilyComposer: '',
      fontFamilyTerminal: '',
    })
    expect(payload.lightTokens['--dsw-alias-bg-base']).toBe('#f3faf7')
    expect(payload.darkTokens).toEqual({})
    const html = injectBootTheme(
      '<html><body><div id="root"></div></body></html>',
      payload,
    )
    const source = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1]
    if (source === undefined) throw new Error('theme bootstrap script missing')
    runInNewContext(source, { document, matchMedia: globalThis.matchMedia })
    expect(document.documentElement.style.fontSize).toBe('18px')
    expect(document.body.style.getPropertyValue('--dsw-alias-bg-base')).toBe('#f3faf7')
    expect(document.body.style.getPropertyValue('--dsw-alias-glass-opacity')).toBe('70%')
  })

  it('embeds 0% glass while the transparent theme is effective, but only with a wallpaper', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const withWallpaper = buildThemeBootPayload({
      ...DEFAULT_THEME_SETTINGS,
      customThemes: [],
      glassOpacity: 70,
      transparentTheme: true,
      wallpaperImage: png,
    })
    expect(withWallpaper.glassOpacity).toBe(0)
    const withoutWallpaper = buildThemeBootPayload({
      ...DEFAULT_THEME_SETTINGS,
      customThemes: [],
      glassOpacity: 70,
      transparentTheme: true,
    })
    expect(withoutWallpaper.glassOpacity).toBe(70)
  })
})
