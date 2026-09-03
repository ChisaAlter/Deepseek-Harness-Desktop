import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { IconCloseOutline16 } from './icons/index.tsx'
import { usePresence } from './usePresence.ts'
import css from './Modal.module.css'

interface ModalBaseProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  headerActions?: ReactNode
  className?: string | undefined
  contentClassName?: string | undefined
}

type ModalProps = ModalBaseProps & (
  | { headless: true; closeLabel?: never }
  | { headless?: false; closeLabel: string }
)

/**
 * Render a centered, body-portaled modal over a blurred page mask.
 * @param props.open - whether the dialog is showing.
 * @param props.onClose - Escape or mask click.
 * @param props.title - dialog heading (aria-label in every mode).
 * @param props.closeLabel - localized accessible close-button label.
 * @param props.description - optional supporting sentence under the title.
 * @param props.children - body (inputs, etc.).
 * @param props.footer - action row (Cancel / Create).
 * @param props.contentClassName - optional class for a scrollable content region.
 * @param props.headless - render children directly in the card (no default
 * header/close/body chrome); mask, card, Escape, and aria-label remain.
 * @returns null when unmounted; the overlay tree stays mounted through the
 * 200ms exit hold so the shared overlay recipe can play its exit transition.
 */
export function Modal({
  open, onClose, title, closeLabel, description, children, footer, headerActions, className, contentClassName, headless = false,
}: ModalProps) {
  const { mounted, state } = usePresence(open)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, onClose])

  if (!mounted) return null

  return createPortal((
    <div
      className={css.root}
      role="presentation"
      data-dsh-motion="overlay"
      data-state={state}
      aria-hidden={open ? undefined : true}
    >
      <div className={css.mask} data-dsh-motion-part="mask" aria-hidden="true" onClick={onClose} />
      <div
        className={clsx(css.dialog, className)}
        data-dsh-motion-part="panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {headless
          ? children
          : (
            <>
              <div className={clsx(css.content, contentClassName)}>
                <div className={css.header}>
                  <h2 className={css.title}>{title}</h2>
                  <div className={css.headerEnd}>
                    {headerActions}
                    <button type="button" className={css.close} aria-label={closeLabel} onClick={onClose}>
                      <IconCloseOutline16 size={14} />
                    </button>
                  </div>
                </div>
                {description !== undefined && description !== '' && (
                  <p className={css.description}>{description}</p>
                )}
                {children !== undefined && <div className={css.body}>{children}</div>}
              </div>
              {footer !== undefined && <div className={css.footer}>{footer}</div>}
            </>
          )}
      </div>
    </div>
  ), document.body)
}
