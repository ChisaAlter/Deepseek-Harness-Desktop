// @vitest-environment jsdom
/** Renderer-owned loads retain displayed versions and retire work on reload, replacement, and close. */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { makeTranslate, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { OwnerOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { OfficeToPdfGeneration } from '@deepseek-ai/dsh-office-to-pdf/types'
import type { DocumentPreviewDefinition } from '../src/client/document/registry.ts'
import type { DocumentContent } from '../src/client/document/contract.ts'
import { TextPreview, type TextPreviewProps } from '../src/client/TextPreview.tsx'
import { OfficeBody, type OfficeBodyProps } from '../src/client/office/OfficeBody.tsx'
import { createOfficeStore, type OfficeState } from '../src/client/office/store.ts'
import type { ReadOfficeDocument } from '../src/client/office/cache.ts'
import { en } from '../src/client/office/locales.ts'
import { harness, ABSOLUTE_PATH, TAB_ID, settle } from './fixtures.client.ts'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('lets a non-Office renderer load content, report its version, and reload through the shared toolbar', async () => {
  const h = harness()
  const custom: DocumentPreviewDefinition = {
    id: 'custom-viewer', extensions: ['md'], binaryExtensions: ['md'], title: () => 'Custom', loading: 'renderer',
  }
  const read = vi.fn<(signal: AbortSignal) => Promise<{ text: string; version: string }>>()
    .mockResolvedValueOnce({ text: 'Custom content v1', version: 'v1' })
    .mockResolvedValueOnce({ text: 'Custom content v2', version: 'v2' })
  function CustomBody({ content }: { content: DocumentContent }) {
    const [file, setFile] = useState<{ text: string; version: string; revision: number }>()
    const request = content.kind === 'renderer' ? content : undefined
    const revision = request?.revision
    const displayed = file?.revision === revision ? file : undefined
    useEffect(() => {
      if (revision === undefined) return
      const controller = new AbortController()
      void read(controller.signal).then((file) => {
        if (controller.signal.aborted) return
        setFile({ ...file, revision })
      })
      return () => { controller.abort() }
    }, [revision])
    useEffect(() => { if (displayed !== undefined) request?.loaded(displayed.version) }, [displayed, request?.loaded])
    return <p>{displayed?.text ?? 'Loading custom content'}</p>
  }
  const renderSlot: TextPreviewProps['renderSlot'] = (name, input) => {
    if (name === 'sidebar.right.tab.document.actions') return null
    const owner = input as unknown as OwnerOf<'sidebar.right.tab.document'>
    return <CustomBody content={owner.content} />
  }
  const useDocumentPreviews: TextPreviewProps['useDocumentPreviews'] = selector => selector([custom])
  const view = render(<TextPreview {...h.props()} renderSlot={renderSlot} useDocumentPreviews={useDocumentPreviews} />)
  expect(read).toHaveBeenCalledTimes(1)
  expect(await screen.findByText('Custom content v1')).toBeTruthy()
  expect(h.instance.getSnapshot().byTab[TAB_ID]?.version).toBe('v1')
  h.setVersion('v2')
  view.rerender(<TextPreview {...h.props()} renderSlot={renderSlot} useDocumentPreviews={useDocumentPreviews} />)
  expect(screen.getByText('changed')).toBeTruthy()
  expect(read).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'reloadNow' }))
  expect(await screen.findByText('Custom content v2')).toBeTruthy()
  expect(read).toHaveBeenCalledTimes(2)
  expect(h.instance.getSnapshot().byTab[TAB_ID]?.version).toBe('v2')
  expect(screen.queryByText('changed')).toBeNull()
  expect(h.read).not.toHaveBeenCalled()
  expect(h.bytes).not.toHaveBeenCalled()
  expect(h.instance.getSnapshot().byTab[TAB_ID]?.complete).toBeUndefined()
})

const definition: DocumentPreviewDefinition = {
  id: 'office', extensions: ['md'], binaryExtensions: ['md'], title: () => 'Office', loading: 'renderer',
}
type Result = Awaited<ReturnType<ReadOfficeDocument>>
const result = (version = 'v1'): Result => ({ ok: true, value: {
  absolutePath: ABSOLUTE_PATH, version, data: new TextEncoder().encode(`PDF ${version}`),
  offset: 0, eof: true, missingFonts: [], generation: 'engine' as OfficeToPdfGeneration,
} })

function setup() {
  const h = harness()
  const office = createOfficeStore().create()
  const pending: { signal: AbortSignal; deferred: ReturnType<typeof Promise.withResolvers<Result>> }[] = []
  const read = vi.fn<ReadOfficeDocument>().mockImplementation((_file, signal) => {
    const deferred = Promise.withResolvers<Result>()
    pending.push({ signal, deferred })
    return deferred.promise
  })
  const retained = new Set<AbortSignal>()
  const retainTab: OfficeBodyProps['retainTab'] = (tab, signal) => {
    if (retained.has(signal)) return
    retained.add(signal)
    signal.addEventListener('abort', () => { office.actions.forget(tab) }, { once: true })
  }
  const subscribe = (listener: () => void) => office.subscribe(listener)
  const snapshot = () => office.getSnapshot()
  function useOffice<T>(selector: (state: OfficeState) => T): T {
    return selector(useSyncExternalStore(subscribe, snapshot))
  }
  const describeFailure: OfficeBodyProps['describeFailure'] = error => error.message
  let request: Extract<DocumentContent, { kind: 'renderer' }> | undefined
  const slots: TextPreviewProps['renderSlot'] = (key, input, options) => {
    if (key === 'sidebar.right.tab.document.actions') return null
    const owner = input as unknown as OwnerOf<'sidebar.right.tab.document'>
    if (owner.content.kind !== 'renderer') return <p>Raw bytes</p>
    request = owner.content
    // The component fixture supplies the standard seats used by Office; the real slot binding is exercised by the browser scenario.
    const props = { ...h.props(), ...owner, useTabInfo: options.hookContext, useStore: useOffice,
      actions: office.actions, read, retainTab, describeFailure,
      t: makeTranslate(en), renderSlot: (_name: string, child: { content: DocumentContent }) => (
        <p data-test-pdf>{child.content.kind === 'bytes' ? new TextDecoder().decode(child.content.data) : ''}</p>
      ),
    } as unknown as OfficeBodyProps
    return <OfficeBody {...props} />
  }
  function View({ renderer = true }: { renderer?: boolean }) {
    return <TextPreview {...h.props()} renderSlot={slots}
      useDocumentPreviews={selector => selector([renderer ? definition : { ...definition, id: 'raw', loading: 'bytes-complete' }])} />
  }
  onTestFinished(async () => {
    h.controller.abort()
    for (const { deferred } of pending) deferred.resolve(result())
    await Promise.allSettled(pending.map(item => item.deferred.promise))
  })
  return { h, office, pending, read, View, request: () => request! }
}

it('loads without reading raw bytes, retains content across remounts, and reloads only after a source-change action', async () => {
  const h = setup()
  let mounted = render(<h.View />)
  expect(screen.getByRole('status').getAttribute('aria-label')).toBe(en.loading)
  expect(h.h.bytes).not.toHaveBeenCalled()
  await act(async () => { h.pending[0]!.deferred.resolve(result()) })
  expect(screen.getByText('PDF v1')).toBeTruthy()
  expect(h.h.instance.getSnapshot().byTab[TAB_ID]?.version).toBe('v1')
  expect(h.h.instance.getSnapshot().byTab[TAB_ID]?.complete).toBeUndefined()
  mounted.unmount()
  mounted = render(<h.View />)
  expect(screen.getByText('PDF v1')).toBeTruthy()
  expect(h.read).toHaveBeenCalledTimes(1)
  h.h.setVersion('v2')
  mounted.rerender(<h.View />)
  expect(screen.getByText('changed')).toBeTruthy()
  expect(h.read).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'reloadNow' }))
  expect(h.read).toHaveBeenCalledTimes(2)
  await act(async () => { h.pending[1]!.deferred.resolve(result('v2')) })
  expect(screen.queryByText('changed')).toBeNull()
  expect(screen.getByText('PDF v2')).toBeTruthy()
})

it('aborts a superseded load and rejects its late bytes and version report', async () => {
  const h = setup()
  render(<h.View />)
  const previous = h.request()
  fireEvent.click(screen.getByRole('button', { name: 'reload' }))
  expect(h.pending[0]!.signal.aborted).toBe(true)
  await act(async () => { h.pending[1]!.deferred.resolve(result('v2')) })
  await act(async () => { h.pending[0]!.deferred.resolve(result('v1')); previous.loaded('v1') })
  expect(screen.getByText('PDF v2')).toBeTruthy()
  expect(h.h.instance.getSnapshot().byTab[TAB_ID]?.version).toBe('v2')
})

it.each(['replace', 'close', 'hide'] as const)('retires pending conversion on %s and ignores a late rejection', async (transition) => {
  const h = setup()
  h.h.bytes.mockResolvedValue({ ok: true, value: { absolutePath: ABSOLUTE_PATH, version: 'v1', offset: 0, eof: true, data: new Uint8Array() } })
  const mounted = render(<h.View />)
  if (transition === 'replace') mounted.rerender(<h.View renderer={false} />)
  else if (transition === 'close') act(() => { h.h.controller.abort() })
  else mounted.unmount()
  expect(h.pending[0]!.signal.aborted).toBe(true)
  await act(async () => { h.pending[0]!.deferred.reject(new Error('late error')) })
  if (transition === 'close') {
    expect(h.office.getSnapshot().byTab[TAB_ID]).toBeUndefined()
    expect(h.h.instance.getSnapshot().byTab[TAB_ID]).toBeUndefined()
  } else expect(h.office.getSnapshot().byTab[TAB_ID]?.failure).toBeUndefined()
  if (transition === 'replace') {
    await settle()
    expect(screen.getByText('Raw bytes')).toBeTruthy()
  }
})

it.each(['declared', 'exception', 'foreign'] as const)('shows %s conversion failures and retries only while the resource is available', async (kind) => {
  const h = setup()
  const mounted = render(<h.View />)
  await act(async () => {
    if (kind === 'declared') h.pending[0]!.deferred.resolve({ ok: false, error: new RemoteError('workspace-file/not-found', 'Missing file', { path: ABSOLUTE_PATH }) })
    else h.pending[0]!.deferred.reject(kind === 'exception' ? new Error('Conversion failed') : 'Conversion failed')
  })
  expect(screen.getByText(kind === 'declared' ? 'Missing file' : 'Conversion failed')).toBeTruthy()
  const resource = h.h.useResource()
  h.h.useResource.mockReturnValue({ status: 'none', value: undefined, failure: undefined })
  mounted.rerender(<h.View />)
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  expect(h.read).toHaveBeenCalledTimes(1)
  expect(screen.getByText(kind === 'declared' ? 'Missing file' : 'Conversion failed')).toBeTruthy()
  h.h.useResource.mockReturnValue(resource)
  mounted.rerender(<h.View />)
  fireEvent.click(screen.getByRole('button', { name: en.retry }))
  expect(h.read).toHaveBeenCalledTimes(2)
  await act(async () => { h.pending[1]!.deferred.resolve(result()) })
  expect(screen.getByText('PDF v1')).toBeTruthy()
  expect(h.h.bytes).not.toHaveBeenCalled()
})

it('starts no conversion when a body receives ordinary shared content', () => {
  const h = setup()
  const props = { ...h.h.props(), content: { kind: 'bytes', data: new Uint8Array() },
    useStore: () => undefined, read: h.read, retainTab: vi.fn(), describeFailure: vi.fn(),
  } as unknown as OfficeBodyProps
  const view = render(<OfficeBody {...props} />)
  expect(view.container.childElementCount).toBe(0)
  expect(h.read).not.toHaveBeenCalled()
})
