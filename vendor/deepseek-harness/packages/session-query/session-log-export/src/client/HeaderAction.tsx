import type { ReactNode } from 'react'
import { IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionLogDownloadDialog, type SessionLogDownloadDialogProps } from './Dialog.tsx'
import css from './HeaderAction.module.css'

/**
 * Render the titlebar Session-log capsule and its shared result dialog.
 * @param props - titlebar density, current-session list, download controller, and copy.
 * @returns the persistent titlebar action and Session-scoped dialog.
 */
export function SessionLogDownloadHeaderAction(props: SessionLogDownloadDialogProps): ReactNode {
  const {
    density = 'full',
    useSessions,
    useTitlebarAction,
    useSessionLogDownload,
    request,
    t,
  } = props
  const listedId = useSessions(state => state.current)
  const sessionId = listedId ?? props.sessionId
  const showChrome = typeof useTitlebarAction === 'function' ? useTitlebarAction(value => value) : true
  const downloadEntry = useSessionLogDownload(state => (
    sessionId === undefined ? undefined : state.bySession[String(sessionId)]
  ))
  const busy = downloadEntry?.status === 'downloading'
  const compact = density === 'cozy' || density === 'compact'
  const className = compact ? `${css.sessionLogButton} ${css.iconOnly}` : css.sessionLogButton

  return (
    <>
      {showChrome && (
        <button
          type="button"
          className={className}
          disabled={busy || sessionId === undefined}
          aria-busy={busy}
          onClick={() => {
            if (sessionId !== undefined) void request(sessionId)
          }}
        >
          <span>{t('header.action')}</span>
          <IconDownloadOutline16 size={12} />
        </button>
      )}
      {sessionId !== undefined && <SessionLogDownloadDialog {...props} sessionId={sessionId} />}
    </>
  )
}
