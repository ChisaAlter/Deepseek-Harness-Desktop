import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './Brand.module.css'

/**
 * Suppress the image mark while occupying the sidebar slot so its fish fallback
 * cannot reappear in official builds.
 */
export function OfficialBrandMark(_props: SidebarBrandMarkOwnerProps) {
  return null
}

/**
 * Render the Whale Isle wordmark with the transparent head and Harness attribution.
 * @returns the Whale Isle wordmark.
 */
export function OfficialBrandName() {
  return (
    <span className={css.wordmark} data-whale-isle-brand="name">
      <img className={css.avatar} src="/whale-isle-head.png" alt="" />
      <span className={css.nameBlock}>
        <span className={css.titleRow}>
          <span className={css.chineseName}><span>鲸</span><span className={css.isleGlyph}>屿</span></span>
          <span className={css.englishName}>WHALE ISLE</span>
        </span>
        <span className={css.attribution}>BASED ON DEEPSEEK HARNESS</span>
      </span>
    </span>
  )
}
