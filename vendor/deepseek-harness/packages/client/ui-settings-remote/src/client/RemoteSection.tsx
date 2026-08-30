import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, FlipText, FLIP_TEXT_MS, IconChevronRightOutline14, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { RemotePatch, RemoteSnapshot } from './desktop-shell.ts'
import { humanizeRelayError, humanizeRemoteError } from './relay-copy.ts'
import { qrSvg } from './qr.ts'
import css from './RemoteSection.module.css'

/** Registration-side desktop callbacks used by the Remote popup. */
export interface RemoteSectionInjected {
  /** Read the current gateway snapshot. */
  getRemote: () => Promise<RemoteSnapshot | null>
  /** Persist a remote config patch and return the new snapshot. */
  saveRemote: (patch: RemotePatch) => Promise<RemoteSnapshot | null>
  /** Re-mint the short-lived pairing offer; sticky devices stay bound. */
  rotateRemoteToken: () => Promise<RemoteSnapshot | null>
  /** Drop one bound device; its cookie stops authorizing. */
  unbindRemoteDevice: (id: string) => Promise<RemoteSnapshot | null>
}

/** Full component props assembled by the sidebar footer-action slot. */
export type RemoteSectionProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'settings.remote'>
  & InjectFace<RemoteSectionInjected>

const EMPTY: RemoteSnapshot = { urls: [], devices: [] }
const REFRESH_MS = 2000

function PhoneIcon({ size }: { size: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4" y="1.4" width="8" height="13.2" rx="1.8" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="12.1" r="0.75" fill="currentColor" />
    </svg>
  )
}

function formatStamp(value: string, unknown: string): string {
  const stamp = Date.parse(value)
  if (!Number.isFinite(stamp)) return unknown
  return new Date(stamp).toLocaleString()
}

/**
 * Sidebar-foot Remote control: turn on, scan the QR, manage devices.
 * Connection mode and gateway knobs live under Settings → Remote → Gateway.
 * @param props - composed slot props plus the desktop inject face.
 * @returns the trigger and optional popup.
 */
export function RemoteSection({
  wide,
  t,
  getRemote,
  saveRemote,
  rotateRemoteToken,
  unbindRemoteDevice,
}: RemoteSectionProps): ReactNode {
  const [snap, setSnap] = useState<RemoteSnapshot | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [healFired, setHealFired] = useState(false)
  const healAttemptedRef = useRef(false)

  const applySnap = useCallback((next: RemoteSnapshot | null) => {
    const value = next ?? EMPTY
    setSnap(value)
    setError(value.error || '')
  }, [])

  const load = useCallback(async () => {
    setBusy(true)
    try {
      applySnap(await getRemote())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [applySnap, getRemote])

  const refresh = useCallback(async () => {
    try {
      applySnap(await getRemote())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [applySnap, getRemote])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!open) {
      setDevicesOpen(false)
      healAttemptedRef.current = false
      setHealFired(false)
      setCopied(false)
      return
    }
    void refresh()
    const id = window.setInterval(() => { void refresh() }, REFRESH_MS)
    return () => { window.clearInterval(id) }
  }, [open, refresh])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (devicesOpen) setDevicesOpen(false)
      else setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open, devicesOpen])

  const save = useCallback(async (patch: RemotePatch) => {
    setBusy(true)
    try {
      applySnap(await saveRemote(patch))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [applySnap, saveRemote])

  const rotate = useCallback(async () => {
    setBusy(true)
    try {
      applySnap(await rotateRemoteToken())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [applySnap, rotateRemoteToken])

  const unbind = useCallback(async (id: string) => {
    setBusy(true)
    try {
      applySnap(await unbindRemoteDevice(id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [applySnap, unbindRemoteDevice])

  const pairingUrl = snap?.urls?.[0]?.pairingUrl || ''
  const qr = useMemo(() => qrSvg(pairingUrl), [pairingUrl])
  const enabled = Boolean(snap?.enabled)
  const listening = Boolean(snap?.listening)
  const devices = snap?.devices ?? []
  const relayConnected = Boolean(snap?.relayConnected)
  const relayError = typeof snap?.relayError === 'string' ? snap.relayError : ''

  useEffect(() => {
    if (!open || !snap || busy) return
    if (!enabled) return
    if (listening && pairingUrl) return
    if (healAttemptedRef.current) return
    healAttemptedRef.current = true
    setHealFired(true)
    void save({ remoteEnabled: true })
  }, [open, snap, enabled, listening, pairingUrl, busy, save])

  let statusText: string | null = null
  if (error) {
    statusText = humanizeRemoteError(error) === 'portInUse'
      ? t('errorPortInUse')
      : t('statusErrorGeneric')
  } else if (enabled && !relayConnected) {
    statusText = humanizeRelayError(relayError) === 'disconnected'
      ? t('relayDownDisconnected')
      : t('relayDown')
  } else if (enabled && !listening) {
    statusText = t('startingHint')
  }

  let qrHint: string | null = null
  if (!enabled) qrHint = t('offHint')
  else if (!qr && listening) qrHint = healFired ? t('noQr') : t('mintingHint')


  return (
    <div className={wide ? css.layer : `${css.layer} ${css.rail}`}>
      <button
        type="button"
        className={css.trigger}
        data-dsh-remote-trigger=""
        data-on={enabled || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('trigger')}
        onClick={() => { setOpen(value => !value) }}
      >
        <PhoneIcon size={wide ? 16 : 18} />
        {wide && <span className={css.triggerLabel}>{t('trigger')}</span>}
      </button>
      {open ? (
        <div className={css.overlay} role="presentation">
          <div className={css.mask} aria-hidden="true" onClick={() => { setOpen(false) }} />
          <div
            className={css.panel}
            role="dialog"
            aria-modal="true"
            aria-label={t('heading')}
            data-dsh-remote-panel=""
          >
            <h2 className={css.heading}>{t('heading')}</h2>
            {!snap && error ? (
              <>
                <p className={css.status} role="status">{t('error')}</p>
                <button type="button" className={css.retry} onClick={() => { void load() }}>{t('retry')}</button>
              </>
            ) : !snap ? (
              <p className={css.status} role="status">{t('loading')}</p>
            ) : (
              <>
                <div className={css.modes} role="radiogroup" aria-label={t('enable')}>
                  <Button
                    size="sm"
                    variant={enabled ? 'primary' : 'ghost'}
                    className={css.modeButton}
                    role="radio"
                    aria-checked={enabled}
                    disabled={busy}
                    onClick={() => {
                      if (!enabled || !listening || !pairingUrl) void save({ remoteEnabled: true })
                    }}
                  >
                    {t('enabledOn')}
                  </Button>
                  <Button
                    size="sm"
                    variant={enabled ? 'ghost' : 'primary'}
                    className={css.modeButton}
                    role="radio"
                    aria-checked={!enabled}
                    disabled={busy}
                    onClick={() => { if (enabled) void save({ remoteEnabled: false }) }}
                  >
                    {t('enabledOff')}
                  </Button>
                </div>
                <button
                  type="button"
                  className={css.devices}
                  onClick={() => { setDevicesOpen(true) }}
                >
                  <span>{t('devices')} {devices.length}</span>
                  <span className={css.devicesChevron} aria-hidden="true">
                    <IconChevronRightOutline14 />
                  </span>
                </button>
                {statusText ? (
                  <p className={css.status} role="status" data-dsh-remote-status="">
                    {statusText}
                  </p>
                ) : null}
                {enabled && qr ? (
                  <>
                    <div
                      className={css.qr}
                      role="img"
                      aria-label={t('qr')}
                      data-dsh-remote-qr=""
                      dangerouslySetInnerHTML={{ __html: qr }}
                    />
                    <p className={css.hint}>{t('scanSplitHint')}</p>
                    <div className={css.footer}>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={css.footerButton}
                        data-dsh-remote-copy-link=""
                        onClick={() => {
                          void writeClipboard(pairingUrl).then((ok) => {
                            if (!ok) return
                            setCopied(true)
                            window.setTimeout(() => { setCopied(false) }, FLIP_TEXT_MS)
                          })
                        }}
                      >
                        <FlipText text={copied ? t('copiedLink') : t('copyLink')} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={css.footerButton}
                        data-dsh-remote-rotate=""
                        disabled={busy}
                        onClick={() => { void rotate() }}
                      >
                        {t('rotateToken')}
                      </Button>
                    </div>
                  </>
                ) : qrHint ? (
                  <p className={css.hint}>{qrHint}</p>
                ) : null}
              </>
            )}
          </div>
          {devicesOpen ? (
            <div className={css.deviceLayer} role="presentation">
              <div className={css.mask} aria-hidden="true" onClick={() => { setDevicesOpen(false) }} />
              <div className={css.devicePanel} role="dialog" aria-modal="true" aria-label={t('devicesManage')}>
                <h2 className={css.heading}>{t('devicesManage')}</h2>
                {devices.length === 0 ? (
                  <p className={css.hint}>{t('devicesEmpty')}</p>
                ) : (
                  <ul className={css.deviceList}>
                    {devices.map(device => (
                      <li key={device.id} className={css.deviceRow}>
                        <div className={css.deviceMeta}>
                          <span className={css.deviceName}>
                            {device.name}
                            {device.online ? <span className={css.online}>{t('devicesOnline')}</span> : null}
                          </span>
                          {device.detail ? <span className={css.deviceDetail}>{device.detail}</span> : null}
                          {device.shortId ? <span className={css.deviceSeen}>{t('devicesId', { id: device.shortId })}</span> : null}
                          {device.createdAt ? (
                            <span className={css.deviceSeen}>
                              {t('devicesBound', { time: formatStamp(device.createdAt, t('devicesSeenUnknown')) })}
                            </span>
                          ) : null}
                          <span className={css.deviceSeen}>
                            {device.lastSeenAt
                              ? t('devicesSeen', { time: formatStamp(device.lastSeenAt, t('devicesSeenUnknown')) })
                              : t('devicesSeenUnknown')}
                          </span>
                        </div>
                        <button
                          type="button"
                          className={css.unbind}
                          disabled={busy}
                          onClick={() => { void unbind(device.id) }}
                        >
                          {t('unbind')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
