/** PDF page presentation; binary content and tab information come from the document owner. */
import { useCallback, useEffect, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { DocumentPreviewProps } from '../document/contract.ts'
import type { PdfStore, PdfView } from './store.ts'
import { renderPdfPage, type PdfDocument } from './document.ts'
import { openPdf } from './runtime.ts'
import { PdfWorkerFailure } from './errors.ts'
import { pdfTextRenderer } from './text.ts'
import type { ZoomViewportProps } from '../zoom/ZoomViewport.tsx'
import type { ZoomLabels, ZoomPreference } from '../zoom/types.ts'
import type {} from './locales.ts'
import css from './PdfBody.module.css'

/** A record's viewing preferences survive body unmounts and leave with the tab. */
export interface PdfBodyInjected {
  /**
   * Retain viewing preferences until the tab record ends.
   * @param tabId - owning tab.
   * @param signal - tab-record lifetime, not body visibility.
   */
  readonly retainTab: (tabId: TabId, signal: AbortSignal) => void
  /** Main-bundle viewport reused by the lazy PDF body. */
  readonly ZoomViewport: ComponentType<ZoomViewportProps>
  /** Main-bundle class implementing fit-width and fixed-size surfaces. */
  readonly zoomSurfaceClass: string
}

/** Standard document props plus the PDF entry's locale, viewing store, and lifetime callback. */
export type PdfBodyProps = DocumentPreviewProps & PropsLocale<'sidebarPdf'> & PropsStore<PdfStore> & PdfBodyInjected

type LoadState =
  | { readonly kind: 'loaded'; readonly data: Uint8Array<ArrayBuffer>; readonly document: PdfDocument }
  | { readonly kind: 'failed'; readonly data: Uint8Array<ArrayBuffer>; readonly error: unknown }

const DEFAULT_PDF_VIEW: PdfView = { page: 1 }
const FIT_WIDTH: ZoomPreference = { kind: 'fit-width' }
/**
 * Present a PDF with tab-local viewing preferences and component-owned rendering resources.
 * @param props - complete bytes and framework-owned tab/store/locale seats.
 * @returns the PDF reader.
 */
export function PdfBody(props: PdfBodyProps): ReactNode {
  const { tab } = props.useTabInfo()
  const view = props.useStore(state => state.byTab[tab.id] ?? DEFAULT_PDF_VIEW)
  const data = props.content.kind === 'bytes' ? props.content.data : undefined
  const [load, setLoad] = useState<LoadState>()
  const [attempt, setAttempt] = useState(0)
  const [pageWidth, setPageWidth] = useState<number>()
  const { retainTab, actions, t, ZoomViewport, zoomSurfaceClass } = props
  const preference = view.zoom ?? FIT_WIDTH
  const labels: ZoomLabels = {
    controls: t('zoomControls'), menu: t('zoomMenu'), out: t('zoomOut'), into: t('zoomIn'),
    fitWidth: t('zoomFitWidth'), value: percent => t('zoomValue', { percent }),
  }
  const pageVisible = useCallback((page: number): void => {
    actions.page(tab.id, page)
  }, [actions, tab.id])
  const setPreference = useCallback((value: ZoomPreference): void => {
    actions.zoom(tab.id, value)
  }, [actions, tab.id])

  useEffect(() => { retainTab(tab.id, tab.signal) }, [retainTab, tab.id, tab.signal])
  useEffect(() => {
    if (data === undefined || tab.signal.aborted) return
    const lifetime = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, tab.signal])
    setLoad(undefined)
    const session = openPdf(data, signal, (error) => {
      if (!signal.aborted) setLoad({ kind: 'failed', data, error })
    })
    void session.document.then(
      (document) => { if (!signal.aborted) setLoad({ kind: 'loaded', data, document }) },
      (error: unknown) => { if (!signal.aborted) setLoad({ kind: 'failed', data, error }) },
    )
    return () => {
      lifetime.abort()
      void session.dispose()
    }
  }, [data, tab.signal, attempt])
  if (data === undefined) return <p className={css.status} role="alert">{t('unsupported')}</p>
  // The open wait centres like the owner's read spinner before it, so one
  // spinner position covers everything until the first page block appears.
  if (load?.data !== data) return <span className={`${css.status} ${css.opening}`} role="status"
    aria-label={t('loading')} data-document-loading>
    <StateDot state="ongoing" />
  </span>
  if (load.kind === 'failed') {
    return <div className={css.status} role="alert">
      <span>{failureText(load.error, t)}</span>
      <Button size="sm" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</Button>
    </div>
  }
  const pages = <section className={css.body} data-pdf-preview>
    {Array.from({ length: load.document.numPages }, (_, index) => (
      <PdfPage key={index} document={load.document} page={index + 1}
        requested={index === 0 || view.page === index + 1} onVisible={pageVisible} signal={tab.signal}
        onWidth={index === 0 ? setPageWidth : undefined} zoomSurfaceClass={zoomSurfaceClass} t={t} />
    ))}
  </section>
  return <ZoomViewport preference={preference} intrinsicWidth={pageWidth} labels={labels}
    signal={tab.signal} scrollportRef={props.scrollportRef} onPreference={setPreference}>
    {pages}
  </ZoomViewport>
}

function PdfPage({ document, page, requested: initiallyRequested, onVisible, signal, onWidth, zoomSurfaceClass, t }: {
  readonly document: PdfDocument
  readonly page: number
  readonly requested: boolean
  readonly onVisible: (page: number) => void
  readonly signal: AbortSignal
  readonly onWidth: ((width: number) => void) | undefined
  readonly zoomSurfaceClass: string
} & PropsLocale<'sidebarPdf'>): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number>()
  const [requested, setRequested] = useState(initiallyRequested)
  const [state, setState] = useState<'loading' | 'ready'>('loading')
  const [failure, setFailure] = useState<{ readonly error: unknown }>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const node = host.current as HTMLDivElement
    if (typeof IntersectionObserver === 'undefined') {
      setRequested(true)
      return
    }
    let disposed = false
    const observer = new IntersectionObserver((entries) => {
      if (disposed || !entries.some(entry => entry.isIntersecting)) return
      setRequested(true)
      onVisible(page)
      observer.disconnect()
    }, { rootMargin: '100% 0px' })
    observer.observe(node)
    return () => {
      disposed = true
      observer.disconnect()
    }
  }, [page, onVisible])
  useEffect(() => {
    if (!requested) return
    // The canvas is unconditional; this effect runs after its ref is committed.
    const node = canvas.current as HTMLCanvasElement
    const lifetime = new AbortController()
    const renderSignal = AbortSignal.any([lifetime.signal, signal])
    setState('loading')
    setFailure(undefined)
    const createText = pdfTextRenderer(text.current as HTMLDivElement)
    let textTask: ReturnType<typeof createText> | undefined
    void renderPdfPage(document, page, node, renderSignal, window.devicePixelRatio, (pdfPage, viewport) => {
      textTask = createText(pdfPage, viewport)
      return textTask
    }).then(
      (size) => { if (!renderSignal.aborted) { setWidth(size.width); onWidth?.(size.width); setState('ready') } },
      (error: unknown) => { if (!renderSignal.aborted) setFailure({ error }) },
    )
    return () => { lifetime.abort(); textTask?.cancel() }
  }, [document, page, requested, signal, attempt, onWidth])
  return <div ref={host} className={css.page} data-pdf-page={page}>
    {failure === undefined && state !== 'ready' && (requested
      ? <div className={css.placeholder} role="status" aria-label={t('rendering')} />
      : <div className={css.placeholder} />)}
    {failure !== undefined && <div className={css.status} role="alert">
      <span>{failureText(failure.error, t)}</span>
      <Button size="sm" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</Button>
    </div>}
    <div className={`${css.surface} ${zoomSurfaceClass}`} data-document-zoom-surface
      style={{ '--document-zoom-width': `${width ?? 0}px` } as CSSProperties}
      hidden={state !== 'ready' || failure !== undefined}>
      <canvas ref={canvas} className={css.canvas} role="img" aria-label={t('pageImage', { page })} />
      <div ref={text} className={css.text} data-pdf-text />
    </div>
  </div>
}

function failureText(error: unknown, t: PropsLocale<'sidebarPdf'>['t']): string {
  if (error instanceof PdfWorkerFailure) return t('workerFailed')
  if (error instanceof Error && error.name === 'PasswordException') return t('password')
  return t('failed', { message: error instanceof Error ? error.message : String(error) })
}
