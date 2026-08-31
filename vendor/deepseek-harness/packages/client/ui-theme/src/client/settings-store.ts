/**
 * Appearance and font-size row slot stores: mirrors of the theme service
 * snapshot. The plugin's apply-world change listener is the only writer; the
 * page and rows read via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { DEFAULT_FAMILY_ID, type ThemeFamily } from '../theme-family.ts'
import {
  DEFAULT_FONT_SIZE, DEFAULT_THEME_SETTINGS, type ThemePreference, type ThemeSettings,
  type WallpaperFavorite, type WallpaperSource,
} from '../theme-settings.ts'

/** Fields the Appearance page mirrors from a theme snapshot. */
export interface AppearanceSyncSnapshot {
  /** Persisted color-scheme preference. */
  preference: ThemePreference
  /** Resolved active theme; only its color scheme is mirrored. */
  active: { colorScheme: 'light' | 'dark' }
  /** Family painting the light half. */
  activeLightThemeId: string
  /** Family painting the dark half. */
  activeDarkThemeId: string
  /** Builtin plus custom families. */
  families: readonly ThemeFamily[]
  /** User-created families. */
  customThemes: readonly ThemeFamily[]
  /** Overlay solidity percent. */
  glassOpacity: number
  /** Transparent theme flag; effective only while a wallpaper is set. */
  transparentTheme: boolean
  /** Wallpaper data URL; empty means no wallpaper. */
  wallpaperImage: string
  /** Frosted-glass blur on the wallpaper, 0–100. */
  wallpaperBlur: number
  /** Pixelation on the wallpaper, 0–100. */
  wallpaperPixelate: number
  /** Whether desktop Bing rows are included in the gallery. */
  wallpaperBingEnabled?: boolean
  /** HTTPS custom wallpaper catalogs. */
  wallpaperCatalogUrls?: readonly string[]
  /** Gallery sources. */
  wallpaperSources?: readonly WallpaperSource[]
  /** Starred gallery items. */
  wallpaperFavorites?: readonly WallpaperFavorite[]
  /** Interface font preference. */
  fontFamilySans: string
  /** Monospace font preference. */
  fontFamilyCode: string
  /** Root font size in px. */
  fontSizeInterface: number
  /** Code font size in px. */
  fontSizeCode: number
  /** Composer font preference. */
  fontFamilyComposer: string
  /** Terminal font preference. */
  fontFamilyTerminal: string
}

/** Store state mirrored from the theme snapshot. */
export interface AppearanceRowState {
  /** Persisted color-scheme preference. */
  preference: ThemePreference
  /** Which half is currently painting (`system` resolved). */
  resolvedMode: 'light' | 'dark'
  /** Family painting the light half. */
  activeLightThemeId: string
  /** Family painting the dark half. */
  activeDarkThemeId: string
  /** Builtin plus custom families. */
  families: readonly ThemeFamily[]
  /** User-created families. */
  customThemes: readonly ThemeFamily[]
  /** Overlay solidity percent. */
  glassOpacity: number
  /** Transparent theme flag; effective only while a wallpaper is set. */
  transparentTheme: boolean
  /** Wallpaper data URL; empty means no wallpaper. */
  wallpaperImage: string
  /** Frosted-glass blur on the wallpaper, 0–100. */
  wallpaperBlur: number
  /** Pixelation on the wallpaper, 0–100. */
  wallpaperPixelate: number
  /** Whether desktop Bing rows are included in the gallery. */
  wallpaperBingEnabled: boolean
  /** HTTPS custom wallpaper catalogs. */
  wallpaperCatalogUrls: readonly string[]
  /** Gallery sources. */
  wallpaperSources: readonly WallpaperSource[]
  /** Starred gallery items. */
  wallpaperFavorites: readonly WallpaperFavorite[]
  /** Interface font preference. */
  fontFamilySans: string
  /** Monospace font preference. */
  fontFamilyCode: string
  /** Root font size in px. */
  fontSizeInterface: number
  /** Code font size in px. */
  fontSizeCode: number
  /** Composer font preference. */
  fontFamilyComposer: string
  /** Terminal font preference. */
  fontFamilyTerminal: string
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type AppearanceRowActions = {
  sync: (draft: AppearanceRowState, snapshot: AppearanceSyncSnapshot, revision: number) => void
}

const EMPTY: Omit<AppearanceRowState, 'revision'> = {
  preference: DEFAULT_THEME_SETTINGS.preference,
  resolvedMode: 'light',
  activeLightThemeId: DEFAULT_FAMILY_ID,
  activeDarkThemeId: DEFAULT_FAMILY_ID,
  families: [],
  customThemes: [],
  glassOpacity: DEFAULT_THEME_SETTINGS.glassOpacity,
  transparentTheme: DEFAULT_THEME_SETTINGS.transparentTheme,
  wallpaperImage: '',
  wallpaperBlur: DEFAULT_THEME_SETTINGS.wallpaperBlur,
  wallpaperPixelate: DEFAULT_THEME_SETTINGS.wallpaperPixelate,
  wallpaperBingEnabled: false,
  wallpaperCatalogUrls: [],
  wallpaperSources: DEFAULT_THEME_SETTINGS.wallpaperSources,
  wallpaperFavorites: [],
  fontFamilySans: '',
  fontFamilyCode: '',
  fontSizeInterface: DEFAULT_THEME_SETTINGS.fontSizeInterface,
  fontSizeCode: DEFAULT_THEME_SETTINGS.fontSizeCode,
  fontFamilyComposer: '',
  fontFamilyTerminal: '',
}

/**
 * Declares the Appearance page state and write surface.
 * @returns the store handle.
 */
export function createAppearanceRowStore(): EngineStoreHandle<AppearanceRowState, AppearanceRowActions> {
  return defineStore({
    init: (): AppearanceRowState => ({ ...EMPTY, families: [], customThemes: [], revision: -1 }),
    actions: {
      sync: (d, snapshot: AppearanceSyncSnapshot, revision: number) => {
        if (revision <= d.revision) return
        d.preference = snapshot.preference
        d.resolvedMode = snapshot.active.colorScheme
        d.activeLightThemeId = snapshot.activeLightThemeId
        d.activeDarkThemeId = snapshot.activeDarkThemeId
        d.families = snapshot.families
        d.customThemes = snapshot.customThemes
        d.glassOpacity = snapshot.glassOpacity
        d.transparentTheme = snapshot.transparentTheme
        d.wallpaperImage = snapshot.wallpaperImage
        d.wallpaperBlur = snapshot.wallpaperBlur
        d.wallpaperPixelate = snapshot.wallpaperPixelate
        d.wallpaperBingEnabled = snapshot.wallpaperBingEnabled ?? false
        d.wallpaperCatalogUrls = snapshot.wallpaperCatalogUrls ?? []
        d.wallpaperSources = snapshot.wallpaperSources ?? DEFAULT_THEME_SETTINGS.wallpaperSources
        d.wallpaperFavorites = snapshot.wallpaperFavorites ?? []
        d.fontFamilySans = snapshot.fontFamilySans
        d.fontFamilyCode = snapshot.fontFamilyCode
        d.fontSizeInterface = snapshot.fontSizeInterface
        d.fontSizeCode = snapshot.fontSizeCode
        d.fontFamilyComposer = snapshot.fontFamilyComposer
        d.fontFamilyTerminal = snapshot.fontFamilyTerminal
        d.revision = revision
      },
    },
  })
}

/** Store state mirrored from the theme snapshot's font size. */
export interface FontSizeRowState {
  /** Persisted content font size in px. */
  fontSize: number
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type FontSizeRowActions = {
  sync: (draft: FontSizeRowState, fontSize: number, revision: number) => void
}

/**
 * Declares the font-size row state and write surface.
 * @returns the store handle.
 */
export function createFontSizeRowStore(): EngineStoreHandle<FontSizeRowState, FontSizeRowActions> {
  return defineStore({
    init: (): FontSizeRowState => ({ fontSize: DEFAULT_FONT_SIZE, revision: -1 }),
    actions: {
      sync: (d, fontSize: number, revision: number) => {
        if (revision <= d.revision) return
        d.fontSize = fontSize
        d.revision = revision
      },
    },
  })
}

export type { ThemeSettings }
