/**
 * Sidebar-foot update entry: a green button rendered beside the settings
 * trigger while a newer GitHub release exists, opening a dialog that runs the
 * desktop shell's online install (download progress + installer launch).
 * Renders nothing in a plain browser or when the app is current.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, IconRefreshOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { desktopShell, type UpdateInfo } from './desktop-shell.ts'
import css from './UpdateAction.module.css'

/** Dialog flow state; 'ready' shows the install call to action. */
type Phase = 'ready' | 'download' | 'install' | 'error'

/** Props: the sidebar column state plus the settings locale seat. */
export type UpdateActionProps = { wide: boolean } & PropsLocale<'settings'>

/**
 * Render the green update button and its install dialog.
 * @param props - sidebar width flag + bound settings translator.
 * @returns the update entry, or null when no newer release exists.
 */
export function UpdateAction({ wide, t }: UpdateActionProps): ReactNode {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('ready')
  const [percent, setPercent] = useState(0)
  const [message, setMessage] = useState('')
  const shell = desktopShell()

  useEffect(() => {
    if (!shell?.checkUpdate) return
    let cancelled = false
    void shell.checkUpdate().then((next) => {
      if (!cancelled && next.status === 'available') setInfo(next)
    }).catch(() => {})
    return () => { cancelled = true }
    // The bridge is a stable window global; check once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!open || !shell?.onUpdateProgress) return undefined
    return shell.onUpdateProgress((payload) => {
      if (payload.phase === 'download') {
        setPhase('download')
        setPercent(Number(payload.percent) || 0)
      }
      if (payload.phase === 'install') {
        setPhase('install')
        setPercent(100)
      }
    })
  }, [open, shell])

  const close = useCallback(() => {
    setOpen(false)
    setPhase('ready')
    setPercent(0)
    setMessage('')
  }, [])

  const install = useCallback(async () => {
    if (!shell?.installUpdate) return
    setPhase('download')
    setPercent(0)
    try {
      const next = await shell.installUpdate()
      if (next.openedPage) {
        setPhase('error')
        setMessage(t('about.updateOpenedPage'))
        return
      }
      if (next.launched) setPhase('install')
    } catch (error) {
      setPhase('error')
      setMessage(t('about.updateError', { message: error instanceof Error ? error.message : String(error) }))
    }
  }, [shell, t])

  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'download') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, phase, close])

  if (info === null) return null
  const latest = info.latest || ''
  const busy = phase === 'download' || phase === 'install'

  return (
    <>
      <Tooltip label={t('update.tooltip', { latest })} delayMs={500} disabled={wide}>
        <button
          type="button"
          className={clsx(css.badge, !wide && css.rail)}
          aria-label={t('update.tooltip', { latest })}
          onClick={() => { setOpen(true) }}
        >
          <IconRefreshOutline16 size={wide ? 14 : 16} />
          {wide && <span className={css.badgeLabel}>{t('update.badge')}</span>}
        </button>
      </Tooltip>
      {open && (
        <div className={css.overlay} role="presentation">
          <div className={css.mask} aria-hidden="true" onClick={() => { if (!busy) close() }} />
          <div ref={dialogRef} className={css.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}>
            <h2 className={css.title} id={titleId}>{t('update.title', { latest })}</h2>
            <p className={css.body}>
              {t('update.body', { current: info.current || '', latest })}
            </p>
            {phase === 'download' && (
              <div className={css.progressTrack} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                <div className={css.progressFill} style={{ width: `${percent}%` }} />
              </div>
            )}
            {phase === 'download' && <p className={css.status}>{t('about.updateDownloading', { percent: String(percent) })}</p>}
            {phase === 'install' && <p className={css.status}>{t('about.updateInstalling')}</p>}
            {phase === 'error' && <p className={clsx(css.status, css.error)}>{message}</p>}
            <div className={css.actions}>
              <Button variant="outline" size="sm" disabled={phase === 'download'} onClick={close}>
                {t('update.later')}
              </Button>
              <button
                type="button"
                className={css.install}
                disabled={busy}
                onClick={() => { void install() }}
              >
                {phase === 'error' ? t('update.retry') : t('update.install')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
