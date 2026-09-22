/**
 * Appearance button-sheen row (按钮悬停光泽): a single switch gating the
 * metallic-paint hover sweep. The sheet stays mounted either way; the switch
 * only flips the document-root attribute the CSS rule keys on.
 */
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ThemeKey } from './locales.ts'
import css from './AppearanceSection.module.css'

/**
 * Render the button-sheen row: title/description left, enable Switch right.
 * @param props - stored flag, copy, and the write callback.
 * @returns the button-sheen block.
 */
export function MetallicPaintRow({
  metallicPaintEnabled,
  t,
  setMetallicPaint,
}: {
  metallicPaintEnabled: boolean
  t: (key: ThemeKey) => string
  setMetallicPaint: (value: boolean) => void
}) {
  return (
    <section className={css.block} aria-labelledby="appearance-metallic-paint-heading">
      <div className={css.effectRow}>
        <div className={css.effectText}>
          <h2 id="appearance-metallic-paint-heading" className={css.heading}>{t('metallicPaint.title')}</h2>
          <p className={css.hint}>{t('metallicPaint.description')}</p>
        </div>
        <div className={css.effectActions}>
          <Switch
            checked={metallicPaintEnabled}
            aria-label={t('metallicPaint.title')}
            onChange={(event) => { setMetallicPaint(event.currentTarget.checked) }}
          />
        </div>
      </div>
    </section>
  )
}
