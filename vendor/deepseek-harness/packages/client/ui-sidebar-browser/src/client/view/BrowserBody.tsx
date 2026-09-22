/** Browser toolbar and Web iframe renderer. */
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconLinkOutline14,
  IconRefreshOutline14,
  IconRightUpOutline16,
  SHIELD_OUTLINE_PATH,
  SHIELD_OUTLINE_STROKE,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserInjected } from '../browser/BrowserController.ts'
import type { BrowserFrameState } from '../browser/BrowserFrame.ts'
import { BrowserNavigation } from '../browser/BrowserNavigation.ts'
import type { BrowserAddressFailure } from '../browser/url.ts'
import type { BrowserStore } from '../browser/store.ts'
import css from './Browser.module.css'

/** Fixed Web iframe sandbox; popups escape the sandbox while top navigation remains absent. */
export const WEB_BROWSER_SANDBOX = 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox'

const INITIAL_BROWSER_FRAME: BrowserFrameState = { document: undefined, sandboxed: true, loadFailed: false }

function SandboxPolicyIcon({ sandboxed }: { readonly sandboxed: boolean }): ReactNode {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={SHIELD_OUTLINE_PATH} stroke="currentColor" strokeWidth={SHIELD_OUTLINE_STROKE} strokeLinejoin="round" />
      {sandboxed
        ? <path d="M12.1654 5.7552L8.9447 9.41475C8.73044 9.65816 8.53628 9.8804 8.35774 10.0423C8.1713 10.2114 7.94235 10.3717 7.64016 10.4254C7.48207 10.4535 7.32 10.4552 7.16151 10.4294C6.85843 10.3801 6.62728 10.2223 6.43836 10.0559C6.25752 9.89653 6.06037 9.67732 5.84264 9.43705L4.72925 8.20897L5.63557 7.38707L6.74897 8.61594C6.98603 8.87755 7.12974 9.03533 7.24673 9.13839C7.31033 9.19443 7.34485 9.21476 7.35823 9.22122C7.38068 9.22484 7.40352 9.22515 7.42593 9.22122C7.40522 9.22502 7.42893 9.23294 7.53583 9.136C7.65132 9.03126 7.79316 8.87139 8.02643 8.60638L11.2479 4.94763L12.1654 5.7552Z" fill="currentColor" />
        : <path d="M10.6074 4.40278L8.00975 6.99973L10.6074 9.59739L9.59736 10.6074L6.9997 8.00978L4.40274 10.6074L3.3927 9.59739L5.98966 6.99973L3.3927 4.40278L4.40274 3.39273L6.9997 5.98969L9.59736 3.39273L10.6074 4.40278Z" fill="currentColor" transform="translate(1.2 0.8)" />}
    </svg>
  )
}

/** Browser body props assembled by the tab seat. */
export type BrowserBodyProps = PropsRuntime<'sidebar.right.pane.tab'>
  & PropsStore<BrowserStore>
  & PropsLocale<'sidebarBrowser'>
  & InjectFace<BrowserInjected>

/** Translate one parser refusal without matching display strings in logic. */
function failureText(reason: BrowserAddressFailure, t: BrowserBodyProps['t']): string {
  return t(`error.${reason}`)
}

function useBrowserDraft(
  controlledUrl: string | undefined,
  requestId: number | undefined,
): readonly [string, (value: string) => void] {
  const [edit, setEdit] = useState<{ readonly requestId: number | undefined; readonly value: string }>()
  const value = edit !== undefined && edit.requestId === requestId ? edit.value : controlledUrl ?? ''
  return [value, (draft) => { setEdit({ requestId, value: draft }) }]
}

/** Browser tab renderer for a controller-owned URL state and Web iframe carrier. */
export function BrowserBody(props: BrowserBodyProps): ReactNode {
  const {
    goBack, goForward, loadUrl, mount, reload, reportLoaded, reportLoadFailed, toggleSandbox,
    useBrowserFrame, useStore, useTabInfo, t,
  } = props
  const { tab } = useTabInfo()
  const state = useStore(snapshot => snapshot.byTab[tab.id]) ?? BrowserNavigation.empty()
  const initialState = useRef(state)
  const initialUrl = useRef(tab.navigation.params?.url)
  const current = BrowserNavigation.current(state)
  const [draft, setDraft] = useBrowserDraft(current?.url ?? initialUrl.current, state.request?.revision)
  const [mountCount, setMountCount] = useState(0)

  useEffect(() => {
    mount(tab.id, tab.signal, window.location.origin, initialState.current)
    setMountCount(count => count + 1)
  }, [mount, tab.id, tab.signal])

  useEffect(() => {
    if (mountCount === 0) return
    const resumed = BrowserNavigation.current(initialState.current)
    if (resumed !== undefined) {
      reload(tab.id)
      return
    }
    const url = initialUrl.current
    if (url !== undefined) loadUrl(tab.id, url)
  }, [loadUrl, mountCount, reload, tab.id])

  const frameState = useBrowserFrame(tab.id) ?? INITIAL_BROWSER_FRAME
  const { document, sandboxed, loadFailed } = frameState

  const navigationUnknown = state.navigation.status === 'unknown'
  const externalUrl = navigationUnknown ? undefined : current?.url
  const submit = (event: FormEvent): void => { event.preventDefault(); loadUrl(tab.id, draft) }
  const failure = state.failure === undefined ? undefined : failureText(state.failure.reason, t)
  const placeholder = current === undefined ? t('start') : t('loading')

  return (
    <div className={css.root}>
      <form className={css.toolbar} onSubmit={submit}>
        <button type="button" className={css.tool} aria-label={t('back')} title={t('back')} disabled={!BrowserNavigation.canGoBack(state)} onClick={() => { goBack(tab.id) }}><IconChevronLeftOutline14 /></button>
        <button type="button" className={css.tool} aria-label={t('forward')} title={t('forward')} disabled={!BrowserNavigation.canGoForward(state)} onClick={() => { goForward(tab.id) }}><IconChevronRightOutline14 /></button>
        <button type="button" className={css.tool} aria-label={t('reload')} title={t('reload')} disabled={current === undefined} onClick={() => { reload(tab.id) }}><IconRefreshOutline14 /></button>
        <div className={css.addressBox}>
          <input
            className={`${css.address} ${navigationUnknown ? css.addressUnknown : ''}`}
            value={draft}
            aria-label={t('address.placeholder')}
            placeholder={t('address.placeholder')}
            spellCheck={false}
            onChange={(event) => { setDraft(event.currentTarget.value) }}
          />
          {navigationUnknown && <span className={css.addressChanged}>{t('address.changed')}</span>}
          <button type="submit" className={`${css.tool} ${css.addressGo}`} aria-label={t('go')} title={t('go')}><IconLinkOutline14 /></button>
        </div>
        <button
          type="button"
          className={css.tool}
          aria-label={t('external')}
          title={t('external')}
          disabled={externalUrl === undefined}
          onClick={() => {
            /* v8 ignore next -- React does not dispatch clicks from this disabled button. */
            if (externalUrl !== undefined) window.open(externalUrl, '_blank', 'noopener,noreferrer')
          }}
        ><IconRightUpOutline16 size={14} /></button>
        <button
          type="button"
          className={`${css.tool} ${sandboxed ? '' : css.sandboxOff}`}
          aria-label={t(sandboxed ? 'sandbox.disable' : 'sandbox.enable')}
          title={t(sandboxed ? 'sandbox.disable' : 'sandbox.enable')}
          aria-pressed={!sandboxed}
          disabled={mountCount === 0}
          onClick={() => { toggleSandbox(tab.id) }}
        ><SandboxPolicyIcon sandboxed={sandboxed} /></button>
      </form>
      {!sandboxed && <div className={css.sandboxWarning} role="status">{t('sandbox.warning')}</div>}
      {loadFailed && <div className={css.failure} role="status">{t('web.loadFailed')}</div>}
      {failure !== undefined && <div className={css.failure} role="alert">{failure}</div>}
      {document === undefined
        ? <div className={css.start}>{placeholder}</div>
        : <iframe
          key={`${document.target.url}:${String(document.revision)}`}
          className={css.frame}
          src={document.src}
          sandbox={sandboxed ? WEB_BROWSER_SANDBOX : undefined}
          referrerPolicy="no-referrer"
          title={document.target.title}
          onLoad={() => { reportLoaded(tab.id, document.revision) }}
          /* v8 ignore next -- jsdom does not dispatch React iframe error events; BrowserFrame owns the tested behavior. */
          onError={() => { reportLoadFailed(tab.id, document.revision) }}
          data-sidebar-browser-frame
        />}
      {navigationUnknown && <p className={css.limit}>{t('web.unknown')}</p>}
    </div>
  )
}
