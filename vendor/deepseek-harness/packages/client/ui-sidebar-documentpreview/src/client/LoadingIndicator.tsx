/** Shared indeterminate loading feedback for document reads and rendering. */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { IconLoadingOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './LoadingIndicator.module.css'

/** @param props - localized status label and optional placement style. @returns an animated, accessible loading status. */
export function LoadingIndicator({ label, className }: { label: string; className?: string | undefined }): ReactNode {
  return <span className={clsx(css.loading, className)} role="status" data-document-loading>
    <span className={css.icon} aria-hidden="true"><IconLoadingOutline16 /></span>
    <span>{label}</span>
  </span>
}
