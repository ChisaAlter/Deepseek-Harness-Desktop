/**
 * Theme-family grid: split-preview cards, create / import / duplicate /
 * delete, and the live-previewing editor.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { getReservedThemeIds } from '../builtin-families.ts'
import {
  duplicateThemeFamily, normalizeImportedThemeFamily,
  parseThemeFamilyJson, replaceCustomTheme, serializeThemeFamily,
  type ThemeFamily,
} from '../theme-family.ts'
import { ThemeEditor } from './ThemeEditor.tsx'
import type { ThemeKey } from './locales.ts'
import css from './AppearanceSection.module.css'

/**
 * Render the theme library grid and editor.
 * @param props - families, selected halves, and write callbacks.
 * @returns the library tree.
 */
export function ThemeLibrary({
  families,
  customThemes,
  activeLightThemeId,
  activeDarkThemeId,
  resolvedMode,
  t,
  setThemeHalf,
  setCustomThemes,
  previewTheme,
}: {
  families: readonly ThemeFamily[]
  customThemes: readonly ThemeFamily[]
  activeLightThemeId: string
  activeDarkThemeId: string
  resolvedMode: 'light' | 'dark'
  t: (key: ThemeKey) => string
  setThemeHalf: (mode: 'light' | 'dark', id: string) => void
  setCustomThemes: (families: ThemeFamily[]) => void
  previewTheme: (family: ThemeFamily | null) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<ThemeFamily | null>(null)

  // The preview layer belongs to the open editor; leaving the page (or
  // unmounting mid-edit) must restore the stored theme.
  useEffect(() => () => { previewTheme(null) }, [previewTheme])

  const openDraft = (family: ThemeFamily): void => {
    setDraft(family)
    previewTheme(family)
  }

  const updateDraft = (family: ThemeFamily): void => {
    setDraft(family)
    previewTheme(family)
  }

  const closeDraft = (): void => {
    setDraft(null)
    previewTheme(null)
  }

  const reserved = new Set([...getReservedThemeIds(), ...customThemes.map(family => family.id)])

  const startCreate = (): void => {
    const source = families.find(family => family.id === activeDarkThemeId)
      ?? families.find(family => family.id === activeLightThemeId)
      ?? families[0]!
    openDraft(duplicateThemeFamily(source, reserved))
  }

  const saveDraft = (next: ThemeFamily): void => {
    setCustomThemes(replaceCustomTheme(customThemes, next))
    setThemeHalf('light', next.id)
    setThemeHalf('dark', next.id)
    closeDraft()
  }

  const importFile = async (file: File): Promise<void> => {
    try {
      const raw = await file.text()
      const imported = normalizeImportedThemeFamily(parseThemeFamilyJson(raw), reserved)
      setCustomThemes(replaceCustomTheme(customThemes, imported))
    } catch {
      /* invalid JSON or schema — leave the library unchanged */
    }
  }

  const half = (family: ThemeFamily, mode: 'light' | 'dark') => {
    const active = (mode === 'light' ? activeLightThemeId : activeDarkThemeId) === family.id
    const current = mode === resolvedMode
    const seeds = family[mode]
    return (
      <button
        type="button"
        className={clsx(css.half, active && css.halfActive)}
        style={{ background: seeds.background, color: seeds.foreground }}
        aria-label={`${family.name} ${t(mode === 'light' ? 'editor.light' : 'editor.dark')}`}
        aria-pressed={active}
        onClick={() => { setThemeHalf(mode, family.id) }}
      >
        <span className={css.miniUi} aria-hidden="true">
          <span className={css.miniDot} style={{ background: seeds.accent }} />
          <span className={css.miniLines}>
            <span className={css.miniLine} />
            <span className={clsx(css.miniLine, css.miniLineShort)} />
          </span>
        </span>
        <span className={css.halfLabel}>
          {t(mode === 'light' ? 'appearance.light' : 'appearance.dark')}
          {current ? <span className={css.halfCurrent}>{t('library.currentMode')}</span> : null}
        </span>
        {active ? <span className={css.halfBadge} aria-hidden="true">✓</span> : null}
      </button>
    )
  }

  return (
    <div className={css.library}>
      <div className={css.libraryHeader}>
        <h3 className={css.subtitle}>{t('library.title')}</h3>
        <div className={css.libraryActions}>
          <Button type="button" variant="outline" onClick={startCreate}>{t('library.create')}</Button>
          <Button type="button" variant="outline" onClick={() => { fileRef.current?.click() }}>
            {t('library.import')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file) void importFile(file)
            }}
          />
        </div>
      </div>
      <div className={css.grid}>
        {families.map(family => (
          <article key={family.id} className={css.card}>
            <div className={css.preview}>
              {half(family, 'light')}
              {half(family, 'dark')}
            </div>
            <div className={css.cardFoot}>
              <p className={css.cardName}>{family.name}</p>
              <div className={css.cardActions}>
                <button
                  type="button"
                  className={css.iconButton}
                  aria-label={t('library.duplicate')}
                  title={t('library.duplicate')}
                  onClick={() => { openDraft(duplicateThemeFamily(family, reserved)) }}
                >
                  +
                </button>
                {family.origin === 'custom' ? (
                  <>
                    <button
                      type="button"
                      className={css.iconButton}
                      aria-label={t('library.edit')}
                      title={t('library.edit')}
                      onClick={() => { openDraft(family) }}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className={css.iconButton}
                      aria-label={t('library.export')}
                      title={t('library.export')}
                      onClick={() => { void writeClipboard(serializeThemeFamily(family)) }}
                    >
                      ↗
                    </button>
                    <button
                      type="button"
                      className={css.iconButton}
                      aria-label={t('library.delete')}
                      title={t('library.delete')}
                      onClick={() => {
                        setCustomThemes(customThemes.filter(item => item.id !== family.id))
                      }}
                    >
                      ×
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
      {draft !== null ? (
        <ThemeEditor
          family={draft}
          resolvedMode={resolvedMode}
          t={t}
          onChange={updateDraft}
          onSave={() => { saveDraft(draft) }}
          onCancel={closeDraft}
        />
      ) : null}
    </div>
  )
}
