/**
 * Theme bootstrap row for the browser's pre-plugin interval. Each index
 * render embeds the current durable built-in preference, content font size,
 * derived alias tokens, and glass solidity. Head CSS colors the document
 * canvas before script execution; the body script resolves only `system`, then
 * writes the same DOM fields ui-layout's ThemePresenter owns after the client
 * plugin tree activates.
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { deriveThemeTokens } from './derive.ts'
import {
  DEFAULT_FAMILY_ID, SIDEBAR_RAIL_FILL_TOKEN, SIDEBAR_UNMASKED_FILL, type ThemeTokens,
} from './theme-family.ts'
import { resolveThemeFamily } from './builtin-families.ts'
import {
  DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, DEFAULT_THEME_SETTINGS, resolveThemeSettings,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'
import { TRANSPARENT_GLASS_SOLIDITY, isWallpaperDataUrl } from './wallpaper.ts'

/** Payload embedded in the pre-plugin bootstrap script. */
export interface ThemeBootPayload {
  /** Durable color-scheme preference. */
  preference: ThemePreference
  /** Conversation content font size in px. */
  fontSize: number
  /** Derived tokens for the light half (empty for the DeepSeek family). */
  lightTokens: ThemeTokens
  /** Derived tokens for the dark half (empty for the DeepSeek family). */
  darkTokens: ThemeTokens
  /** Interface font size in px. */
  fontSizeInterface: number
  /** Overlay solidity percent. */
  glassOpacity: number
}

function tokensFor(settings: ThemeSettings, mode: 'light' | 'dark'): ThemeTokens {
  const familyId = mode === 'dark' ? settings.activeDarkThemeId : settings.activeLightThemeId
  const family = resolveThemeFamily(familyId, settings.customThemes)
  const tokens: ThemeTokens = family.id === DEFAULT_FAMILY_ID ? {} : deriveThemeTokens(family[mode])
  // Same rewrite composeActive applies; the pre-plugin interval must not
  // flash the masked rail back.
  if (settings.sidebarMaskHidden) tokens[SIDEBAR_RAIL_FILL_TOKEN] = SIDEBAR_UNMASKED_FILL
  return tokens
}

/**
 * Build the Host bootstrap payload from a durable section.
 * @param section - accepted Host theme section, or undefined.
 * @returns JSON-safe boot fields.
 */
export function buildThemeBootPayload(section: ThemeSettings | undefined): ThemeBootPayload {
  const settings = resolveThemeSettings(section)
  // Effective glass: the transparent theme (wallpaper-gated) bypasses the
  // slider, so the pre-plugin interval already paints see-through chrome.
  const transparent = settings.transparentTheme && isWallpaperDataUrl(settings.wallpaperImage)
  return {
    preference: settings.preference,
    fontSize: settings.fontSize,
    lightTokens: tokensFor(settings, 'light'),
    darkTokens: tokensFor(settings, 'dark'),
    fontSizeInterface: settings.fontSizeInterface,
    glassOpacity: transparent ? TRANSPARENT_GLASS_SOLIDITY : settings.glassOpacity,
  }
}

function resolveBootPayload(
  preferenceOrPayload: ThemeBootPayload | ThemePreference = DEFAULT_PREFERENCE,
  fontSize: number = DEFAULT_FONT_SIZE,
): ThemeBootPayload {
  if (typeof preferenceOrPayload === 'string') {
    const payload = buildThemeBootPayload({ ...DEFAULT_THEME_SETTINGS, preference: preferenceOrPayload })
    return { ...payload, fontSize }
  }
  return preferenceOrPayload
}

const LIGHT_BACKGROUND = '#fff'
const DARK_BACKGROUND = '#151517'

/** CSS that colors the document canvas before any script executes. */
function bootThemeStyle(preference: ThemePreference): string {
  const light = `:root{color-scheme:light}body{background-color:${LIGHT_BACKGROUND};--dsh-boot-bg:${LIGHT_BACKGROUND}}`
  const dark = `:root{color-scheme:dark}body{background-color:${DARK_BACKGROUND};--dsh-boot-bg:${DARK_BACKGROUND}}`
  if (preference === 'light') return light
  if (preference === 'dark') return dark
  return `${light}@media(prefers-color-scheme:dark){${dark}}`
}

/** Build the inline script body for one schema-validated boot payload. */
function bootThemeScript(payload: ThemeBootPayload): string {
  return `(() => {
  const preference = ${JSON.stringify(payload.preference)}
  const lightTokens = ${JSON.stringify(payload.lightTokens)}
  const darkTokens = ${JSON.stringify(payload.darkTokens)}
  const fontSizeInterface = ${JSON.stringify(payload.fontSizeInterface)}
  const glassOpacity = ${JSON.stringify(payload.glassOpacity)}
  const systemDark = preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = preference === 'dark' || systemDark
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  document.documentElement.style.fontSize = fontSizeInterface + 'px'
  document.documentElement.dataset.dsThemeSource = preference
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  const tokens = dark ? darkTokens : lightTokens
  for (const [name, value] of Object.entries(tokens)) {
    document.body.style.setProperty(name, value)
  }
  document.body.style.setProperty('--dsw-alias-glass-opacity', glassOpacity + '%')
  document.body.style.setProperty('--dsh-content-font-size', ${JSON.stringify(`${payload.fontSize}px`)})
})()`
}

/**
 * Insert the theme bootstrap immediately after the opening body tag, before
 * the shell mount and module script. Body-less fragments receive it at the
 * end, where the HTML parser has already synthesized a body.
 * @param html - Raw application index HTML.
 * @param payload - Current Host-backed boot fields, or a bare preference for
 *   the historical single-field call.
 * @returns HTML containing the theme bootstrap.
 */
export function injectBootTheme(
  html: string,
  payload: ThemeBootPayload | ThemePreference = DEFAULT_PREFERENCE,
): string {
  const script = `<script>${bootThemeScript(resolveBootPayload(payload))}</script>`
  const body = /<body(?:\s[^>]*)?>/i.exec(html)
  if (body === null) return `${html}${script}`
  const at = body.index + body[0].length
  return `${html.slice(0, at)}${script}${html.slice(at)}`
}

/**
 * The theme bootstrap as an injection row: an inline script immediately after
 * the opening body tag, before the shell mount and module script.
 * @param preferenceOrPayload - Current Host-backed built-in preference, or a
 *   full boot payload that already includes tokens and glass.
 * @param fontSize - Current Host-backed content font size in px. Ignored when
 *   the first argument is a payload.
 * @returns the body script row.
 */
export function bootThemeInjection(
  preferenceOrPayload: ThemePreference | ThemeBootPayload = DEFAULT_PREFERENCE,
  fontSize: number = DEFAULT_FONT_SIZE,
): IndexInjection {
  return {
    kind: 'script',
    placement: 'body',
    text: bootThemeScript(resolveBootPayload(preferenceOrPayload, fontSize)),
  }
}

/**
 * Theme bootstrap rows: head CSS colors the document canvas before
 * first paint, then the body script installs the palette selector and font
 * size before the shell mount and module script.
 * @param preference - Current Host-backed built-in preference.
 * @param fontSize - Current Host-backed content font size in px.
 * @returns head and body script rows in execution order.
 */
export function bootThemeInjections(
  preferenceOrPayload: ThemePreference | ThemeBootPayload = DEFAULT_PREFERENCE,
  fontSize: number = DEFAULT_FONT_SIZE,
): IndexInjection[] {
  const payload = resolveBootPayload(preferenceOrPayload, fontSize)
  return [
    { kind: 'style', text: bootThemeStyle(payload.preference) },
    { kind: 'script', placement: 'body', text: bootThemeScript(payload) },
  ]
}
