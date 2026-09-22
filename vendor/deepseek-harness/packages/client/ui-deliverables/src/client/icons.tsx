/**
 * Package-local glyph for the changed-files card until the shared icon set
 * carries it; its props already match the shared icon contract.
 */
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/** Angle brackets, the code mark the card's header tile shows. */
export const IconCodeBracketsOutline16 = ({ size = 16, className }: IconProps) => (
  <svg
    width={size}
    height={size}
    className={className}
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M5.6 3.4 1 8l4.6 4.6M10.4 3.4 15 8l-4.6 4.6"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
