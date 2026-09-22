/** Built-in dual-mode theme families shipped with the Appearance library. */

import { DEFAULT_CONTRAST, DEFAULT_FAMILY_ID, type ThemeFamily, type ThemeSeeds } from './theme-family.ts'

function seeds(
  accent: string,
  background: string,
  foreground: string,
  contrast = DEFAULT_CONTRAST,
): ThemeSeeds {
  return { accent, background, foreground, contrast }
}

function family(
  id: string,
  name: string,
  light: ThemeSeeds,
  dark: ThemeSeeds,
): ThemeFamily {
  return { id, name, origin: 'builtin', light, dark }
}

/**
 * Product default: empty derived tokens so the CSS sheets stay authoritative.
 * Seed colors still drive the library swatches.
 */
export const DEEPSEEK_FAMILY: ThemeFamily = family(
  DEFAULT_FAMILY_ID,
  'DeepSeek',
  seeds('#4176e6', '#ffffff', '#0f1115', 46),
  seeds('#6ea8ff', '#151517', '#f5f5f5', 41),
)

/** Built-in families in display order. */
export const BUILTIN_THEME_FAMILIES: readonly ThemeFamily[] = Object.freeze([
  DEEPSEEK_FAMILY,
  family(
    'midnight',
    '午夜',
    seeds('#3b6fd4', '#f3f6fb', '#1a1f2b', 44),
    seeds('#6ea8ff', '#0b0d12', '#e8eef9', 48),
  ),
  family(
    'celadon',
    '青瓷',
    seeds('#0f766e', '#f3faf7', '#10211c', 44),
    seeds('#3dd6b5', '#071411', '#e7f6f1', 50),
  ),
  family(
    'violet',
    '暮紫',
    seeds('#7c3aed', '#f7f3fc', '#1c1524', 46),
    seeds('#c4a1ff', '#120e18', '#f3eefc', 50),
  ),
  family(
    'amber',
    '琥珀',
    seeds('#b45309', '#fbf6ee', '#1c1915', 48),
    seeds('#e2b15c', '#14100b', '#f6efe4', 52),
  ),
  family(
    'paper',
    '宣纸',
    seeds('#0f766e', '#f3efe6', '#1c1915', 50),
    seeds('#5eead4', '#1a1712', '#f6efe4', 48),
  ),
  family(
    'contrast',
    '对比',
    seeds('#111111', '#ffffff', '#050505', 68),
    seeds('#ffffff', '#050505', '#f5f5f5', 64),
  ),
])

const BUILTIN_BY_ID = new Map(BUILTIN_THEME_FAMILIES.map(item => [item.id, item]))

/**
 * Look up a shipped family.
 * @param id - family id.
 * @returns the builtin family, or undefined.
 */
export function getBuiltinFamily(id: string): ThemeFamily | undefined {
  return BUILTIN_BY_ID.get(id)
}

/**
 * Whether `id` is a shipped family.
 * @param id - candidate id.
 * @returns true when the id is reserved for a builtin.
 */
export function isBuiltinFamilyId(id: string): boolean {
  return BUILTIN_BY_ID.has(id)
}

/**
 * Resolve a family id against builtins then custom documents.
 * @param id - requested id.
 * @param customThemes - user-created families.
 * @returns the matching family, or DeepSeek when the id is unknown.
 */
export function resolveThemeFamily(
  id: string,
  customThemes: ReadonlyArray<ThemeFamily>,
): ThemeFamily {
  return getBuiltinFamily(id)
    ?? customThemes.find(family => family.id === id)
    ?? DEEPSEEK_FAMILY
}

/**
 * Families shown in the library: builtins first, then custom documents.
 * @param customThemes - user-created families.
 * @returns display order.
 */
export function listThemeFamilies(
  customThemes: ReadonlyArray<ThemeFamily>,
): ThemeFamily[] {
  return [...BUILTIN_THEME_FAMILIES, ...customThemes]
}

/**
 * Reserved ids that import/duplicate must not collide with.
 * @returns builtin id set.
 */
export function getReservedThemeIds(): ReadonlySet<string> {
  return new Set(BUILTIN_BY_ID.keys())
}
