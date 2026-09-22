/**
 * Color-scheme tiles: Light / Dark / System. Selection follows the persisted
 * preference, never the resolved active family.
 */
import clsx from 'clsx'
import {
  IconDarkOutline16, IconFollowsystemOutline16, IconLightOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ThemePreference } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import css from './AppearanceSection.module.css'

/** Tile order and icons. */
const CUBES: readonly { id: ThemePreference; labelKey: ThemeKey; Icon: typeof IconLightOutline16 }[] = [
  { id: 'light', labelKey: 'appearance.light', Icon: IconLightOutline16 },
  { id: 'dark', labelKey: 'appearance.dark', Icon: IconDarkOutline16 },
  { id: 'system', labelKey: 'appearance.system', Icon: IconFollowsystemOutline16 },
]

/**
 * Render the three color-scheme tiles.
 * @param props.preference - persisted preference.
 * @param props.t - localized copy.
 * @param props.setTheme - preference write.
 * @returns the tile row.
 */
export function ColorSchemeTiles({
  preference,
  t,
  setTheme,
}: {
  preference: ThemePreference
  t: (key: ThemeKey) => string
  setTheme: (id: ThemePreference) => void
}) {
  return (
    <div className={css.cubeRow}>
      {CUBES.map(({ id, labelKey, Icon }) => (
        <button
          key={id}
          type="button"
          className={clsx(css.themeCube, preference === id && css.selected)}
          aria-pressed={preference === id}
          onClick={() => { setTheme(id) }}
        >
          <Icon />
          {t(labelKey)}
        </button>
      ))}
    </div>
  )
}
