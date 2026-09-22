/** Missing-font notice and a non-modal details panel for one source version. */
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconCloseOutline16, IconWarningOutline16, useAnchoredPosition, useDismissOnOutsidePointer } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './FontNotice.module.css'

/** Notice inputs supplied by the document owner and Office locale registration. */
export type FontNoticeProps = PropsLocale<'sidebarOffice'> & {
  readonly resourceAddress: string
  readonly sourceVersion: string
  readonly fonts: readonly string[]
}

/**
 * Show missing fonts; dismissal applies to the same source version while this component stays mounted.
 * @param props - source identity, converted content, and localized copy.
 * @returns a collapsible notice and its anchored details, or nothing when fonts are available.
 */
export function FontNotice({ resourceAddress, sourceVersion, fonts, t }: FontNoticeProps): ReactNode {
  const identity = JSON.stringify([resourceAddress, sourceVersion])
  const [dismissed, setDismissed] = useState<string>()
  const [expanded, setExpanded] = useState<string>()
  const visible = fonts.length > 0 && dismissed !== identity
  const open = visible && expanded === identity
  const root = useRef<HTMLDivElement>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const message = useRef<HTMLSpanElement>(null)
  const id = useId()
  const position = useAnchoredPosition({ open, anchorRef: anchor, panelRef: panel, gap: 8, margin: 12 })
  useDismissOnOutsidePointer(root, open, () => { setExpanded(undefined) }, panel)
  const closeDetails = (): void => {
    setExpanded(undefined)
    anchor.current?.querySelector('button')?.focus()
  }
  const positioned = position !== null
  useLayoutEffect(() => {
    if (!open || !positioned) return
    panel.current?.focus()
  }, [open, positioned])
  useLayoutEffect(() => {
    const element = message.current
    if (element === null) return
    const label = element.firstElementChild as HTMLSpanElement
    const measure = (): void => { element.dataset.clipped = String(label.scrollWidth > element.clientWidth) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [fonts, t])
  if (fonts.length === 0) return null
  return <>
    <div className={css.space} data-office-font-notice data-dismissed={!visible} aria-hidden={!visible} {...(!visible ? { inert: '' } : {})}>
      <div className={css.clip}>
        <div ref={root} className={css.notice}>
          <IconWarningOutline16 className={css.warning} />
          <span ref={message} className={css.message} role="status">
            <span>{t('missingFonts', { fonts: fonts.join(', ') })}</span>
          </span>
          <span ref={anchor} className={css.anchor}>
            <Button size="sm" className={css.more} aria-expanded={open} aria-controls={open ? id : undefined}
              aria-haspopup="dialog" onClick={() => { setExpanded(open ? undefined : identity) }}>
              {t('showMore')}
            </Button>
          </span>
          <Button size="sm" className={css.close} aria-label={t('dismissNotice')}
            onClick={() => { setDismissed(identity); setExpanded(undefined) }} icon={<IconCloseOutline16 />} />
        </div>
      </div>
    </div>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`} tabIndex={-1} className={css.panel}
      style={{ ...position, visibility: position === null ? 'hidden' : undefined }}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDetails() } }}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)
          && !anchor.current?.contains(event.relatedTarget)) setExpanded(undefined)
      }}>
      <div className={css.panelHeader}>
        <h3 id={`${id}-title`}>{t('missingFontsTitle')}</h3>
        <Button size="sm" aria-label={t('closeDetails')} onClick={closeDetails} icon={<IconCloseOutline16 />} />
      </div>
      <p id={`${id}-description`} className={css.description}>{t('missingFontsDescription')}</p>
      <p className={css.count}>{t('missingFontsCount', { count: fonts.length })}</p>
      <ul className={css.fonts}>{fonts.map(font => <li key={font}>{font}</li>)}</ul>
    </div>, document.body)}
  </>
}
