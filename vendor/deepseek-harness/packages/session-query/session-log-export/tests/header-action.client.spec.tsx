// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionLogDownloadController } from '../src/client/controller.ts'
import { SessionLogDownloadHeaderAction } from '../src/client/HeaderAction.tsx'
import type { SessionLogDownloadDialogProps } from '../src/client/Dialog.tsx'
import { en } from '../src/client/locales.ts'

const SID = 'session-export-header' as SessionId

function bindSessionExport(controller: SessionLogDownloadController) {
  return function useSessionLogDownload<T>(selector: (state: ReturnType<typeof controller.store.getSnapshot>) => T): T {
    return useSyncExternalStore(
      listener => controller.store.subscribe(listener),
      () => selector(controller.store.getSnapshot()),
    )
  }
}

function bench(sessionId: SessionId | undefined = SID) {
  const controller = new SessionLogDownloadController(async () => new Response('zip'), vi.fn())
  const request = vi.fn((next: SessionId) => controller.download(next))
  const dismiss = vi.fn((next: SessionId) => { controller.dismiss(next) })
  const useSessionLogDownload = bindSessionExport(controller)
  const props = {
    sessionId,
    useSessions: (selector: (state: { current: SessionId | undefined }) => unknown) => selector({ current: sessionId }),
    useSessionLogDownload,
    request,
    dismiss,
    t: (key: keyof typeof en): string => en[key],
  } as unknown as SessionLogDownloadDialogProps
  const view = render(<SessionLogDownloadHeaderAction {...props} />)
  return { controller, request, view, props }
}

afterEach(cleanup)

describe('Session export Header action', () => {
  it('renders the 111×32 text capsule and downloads through the shared controller', async () => {
    const b = bench()
    const button = b.view.getByRole('button', { name: 'Session log' })
    expect(button.querySelector('svg')).not.toBeNull()
    fireEvent.click(button)
    await waitFor(() => { expect(b.request).toHaveBeenCalledWith(SID) })
    expect(await b.view.findByRole('dialog', { name: 'Session download started' })).toBeTruthy()
  })

  it('disables the capsule while either entry path downloads this Session', async () => {
    const b = bench()
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const controller = new SessionLogDownloadController(() => pending, vi.fn())
    const useSessionLogDownload = bindSessionExport(controller)
    b.view.rerender(<SessionLogDownloadHeaderAction {...({
      sessionId: SID,
      useSessions: (selector: (state: { current: SessionId | undefined }) => unknown) => selector({ current: SID }),
      useSessionLogDownload,
      request: (sessionId: SessionId) => controller.download(sessionId),
      dismiss: (sessionId: SessionId) => { controller.dismiss(sessionId) },
      t: (key: keyof typeof en): string => en[key],
    } as unknown as SessionLogDownloadDialogProps)} />)

    const download = controller.download(SID)
    const button = b.view.getByRole('button', { name: 'Session log' })
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('true') })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    release(new Response('zip'))
    await download
    await waitFor(() => { expect(button.getAttribute('aria-busy')).toBe('false') })
  })

  it('keeps the capsule mounted when the current session is empty, then enables after a session arrives', async () => {
    const b = bench(undefined)
    expect(b.view.getByRole('button', { name: 'Session log' })).toBeTruthy()
    b.view.rerender(<SessionLogDownloadHeaderAction {...({
      ...b.props,
      sessionId: SID,
      useSessions: (selector: (state: { current: SessionId | undefined }) => unknown) => selector({ current: SID }),
    } as unknown as SessionLogDownloadDialogProps)} />)
    const button = b.view.getByRole('button', { name: 'Session log' })
    fireEvent.click(button)
    await waitFor(() => { expect(b.request).toHaveBeenCalledWith(SID) })
  })

  it('drops the visible Session log label at cozy density and keeps the accessible name', () => {
    const b = bench()
    b.view.rerender(<SessionLogDownloadHeaderAction {...({
      ...b.props,
      density: 'cozy',
    } as unknown as SessionLogDownloadDialogProps)} />)
    const button = b.view.getByRole('button', { name: 'Session log' })
    expect(b.view.queryByText('Session log')).toBeNull()
    expect(button.querySelector('svg')).not.toBeNull()
  })
})
