/** Terminal glyphs for the sidebar guide and tab title. */
import type { ReactNode } from 'react'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Render the tab title's terminal prompt in the surrounding text color.
 * @returns a decorative sixteen-pixel line glyph.
 */
export function TerminalIcon(): ReactNode {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 4L7 8L3 12" stroke="currentColor" />
    <path d="M9 12H13" stroke="currentColor" />
  </svg>
}

/**
 * Render the guide's terminal card within the folder glyph's painted bounds.
 * @param props - canvas size and layout class supplied by the guide.
 * @returns a dark rounded terminal card with a white prompt.
 */
export function TerminalGuideIcon({ size = 26, className }: IconProps): ReactNode {
  return <svg width={size} height={size} className={className} viewBox="0 0 28 28" fill="none" aria-hidden="true">
    <path d="M22 5H6C4.34315 5 3 6.34315 3 8V21C3 22.6569 4.34315 24 6 24H22C23.6569 24 25 22.6569 25 21V8C25 6.34315 23.6569 5 22 5Z" fill="#17191D" />
    <path d="M8 10L12 14L8 18M15 18H17.5H20" stroke="white" strokeWidth="1.7" strokeLinejoin="round" />
  </svg>
}
