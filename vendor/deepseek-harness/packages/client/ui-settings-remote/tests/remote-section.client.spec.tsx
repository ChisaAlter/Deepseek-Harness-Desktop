// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteSection } from '../src/client/RemoteSection.tsx'
import type { RemoteSectionProps } from '../src/client/RemoteSection.tsx'
import type { RemotePatch, RemoteSnapshot } from '../src/client/desktop-shell.ts'
import { en, type RemoteLocaleKey } from '../src/client/locales.ts'
import { humanizeRelayError, humanizeRemoteError } from '../src/client/relay-copy.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const actual = await vi.importActual<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(
    '@deepseek-ai/dsh-client-ui-primitives',
  )
  return {
    ...actual,
    writeClipboard: vi.fn(async () => true),
  }
})

import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

const t = ((key: RemoteLocaleKey, vars?: Record<string, string>): string => {
  let text: string = en[key]
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, value)
  return text
}) as RemoteSectionProps['t']

const SNAP: RemoteSnapshot = {
  enabled: true,
  listening: true,
  port: 3180,
  mode: 'lan',
  bindAddress: '0.0.0.0',
  lanTls: false,
  addresses: ['10.0.0.4'],
  relayUrl: 'https://relay.example',
  relayConfigured: true,
  relayConnected: false,
  urls: [
    { address: '10.0.0.4', url: 'http://10.0.0.4:3180/', pairingUrl: 'http://10.0.0.4:3180/#offer=abc' },
  ],
}

function snap(overrides: Partial<RemoteSnapshot> = {}): RemoteSnapshot {
  return { ...SNAP, ...overrides }
}

function renderRemote(overrides: Partial<RemoteSectionProps> = {}) {
  const props = {
    wide: true,
    t,
    getRemote: vi.fn(async () => SNAP),
    saveRemote: vi.fn(async () => SNAP),
    rotateRemoteToken: vi.fn(async () => SNAP),
    unbindRemoteDevice: vi.fn(async () => SNAP),
    ...overrides,
  } as RemoteSectionProps
  render(<RemoteSection {...props} />)
  return props
}

describe('relay-copy', () => {
  it('maps relay_control_disconnected without exposing wire tokens elsewhere', () => {
    expect(humanizeRelayError('relay_control_disconnected')).toBe('disconnected')
    expect(humanizeRelayError('Unexpected server response: 401')).toBe('generic')
  })

  it('maps port-in-use English and Chinese messages', () => {
    expect(humanizeRemoteError('EADDRINUSE :3180')).toBe('portInUse')
    expect(humanizeRemoteError('手机配对页端口 3180 已被占用，请关闭占用进程')).toBe('portInUse')
    expect(humanizeRemoteError('gateway down')).toBe('generic')
  })
})

describe('RemoteSection', () => {
  it('keeps the Remote trigger dim until remote is on, then lights it', async () => {
    const props = renderRemote({
      getRemote: vi.fn(async () => snap({ enabled: false, listening: false, urls: [] })),
      saveRemote: vi.fn(async (patch: RemotePatch) => snap({
        enabled: patch.remoteEnabled ?? false,
        listening: Boolean(patch.remoteEnabled),
        urls: patch.remoteEnabled ? SNAP.urls : [],
      })),
    })
    const trigger = await screen.findByRole('button', { name: en.trigger })
    expect(trigger.getAttribute('data-dsh-remote-trigger')).toBe('')
    expect(trigger.getAttribute('data-on')).toBeNull()
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('radio', { name: en.enabledOn }))
    await waitFor(() => { expect(props.saveRemote).toHaveBeenCalledWith({ remoteEnabled: true }) })
    expect(screen.getByRole('button', { name: en.trigger }).hasAttribute('data-on')).toBe(true)
  })

  it('opens a popup with on/off, the QR plus copy link, without LAN/relay controls or bare offer text', async () => {
    renderRemote({ getRemote: vi.fn(async () => snap({ relayConnected: true })) })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByRole('dialog', { name: en.heading })
    expect(screen.getByRole('radio', { name: en.enabledOn })).toBeTruthy()
    expect(screen.getByRole('radio', { name: en.enabledOff })).toBeTruthy()
    expect(screen.queryByRole('radio', { name: en.modeLan })).toBeNull()
    expect(screen.queryByRole('radio', { name: en.modeRelay })).toBeNull()
    expect(screen.getByRole('img', { name: en.qr })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.copyLink })).toBeTruthy()
    expect(screen.getByRole('button', { name: en.rotateToken })).toBeTruthy()
    expect(screen.queryByText(/#offer=/)).toBeNull()
    expect(screen.getByText(en.scanSplitHint)).toBeTruthy()
  })

  it('keeps the entry-split hint tied to the QR (absent while off)', async () => {
    renderRemote({ getRemote: vi.fn(async () => snap({ enabled: false, listening: false, urls: [] })) })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByText(en.offHint)
    expect(screen.queryByText(en.scanSplitHint)).toBeNull()
  })

  it('states plainly that pairing cannot finish while the relay is offline', async () => {
    renderRemote()
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByRole('dialog', { name: en.heading })
    expect(screen.getByText(en.relayDown)).toBeTruthy()
    cleanup()
    renderRemote({
      getRemote: vi.fn(async () => snap({ relayConnected: false, relayError: 'Unexpected server response: 401' })),
    })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByText(en.relayDown)
    expect(screen.queryByText(/401/)).toBeNull()
    expect(screen.queryByText(/Unexpected/)).toBeNull()
    cleanup()
    renderRemote({ getRemote: vi.fn(async () => snap({ relayConnected: true })) })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByRole('img', { name: en.qr })
    expect(screen.queryByText(en.relayDown)).toBeNull()
  })

  it('maps relay_control_disconnected to relayDownDisconnected without wire token', async () => {
    renderRemote({
      getRemote: vi.fn(async () => snap({
        relayConnected: false,
        relayError: 'relay_control_disconnected',
      })),
    })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByText(en.relayDownDisconnected)
    expect(screen.queryByText(/relay_control/)).toBeNull()
  })

  it('shows the off hint until the gateway is enabled', async () => {
    renderRemote({
      getRemote: vi.fn(async () => snap({ enabled: false, listening: false, urls: [] })),
    })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByText(en.offHint)
  })

  it('keeps connection mode, bind scope, and LAN TLS off the pairing popup', async () => {
    renderRemote({ getRemote: vi.fn(async () => snap({ relayConnected: true })) })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByRole('dialog', { name: en.heading })
    expect(screen.queryByRole('radio', { name: en.modeLan })).toBeNull()
    expect(screen.queryByRole('radio', { name: en.modeRelay })).toBeNull()
    expect(screen.queryByText(en.relayNeedsBoth)).toBeNull()
    expect(screen.queryByText(en.relayNeedsToken)).toBeNull()
    expect(screen.queryByText(en.relayNeedsUrl)).toBeNull()
    expect(screen.queryByRole('radio', { name: en.bindAll })).toBeNull()
    expect(screen.queryByRole('radio', { name: en.bindLoopback })).toBeNull()
    expect(screen.queryByRole('radio', { name: en.transportPlain })).toBeNull()
    expect(screen.queryByRole('radio', { name: en.transportTls })).toBeNull()
    expect(screen.queryByText(en.lanPlaintextWarning)).toBeNull()
    expect(screen.queryByText('10.0.0.4')).toBeNull()
  })

  it('shows loading while the first read is in flight', async () => {
    let finish: (value: RemoteSnapshot) => void = () => {}
    renderRemote({
      getRemote: vi.fn(() => new Promise<RemoteSnapshot>((resolve) => { finish = resolve })),
    })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByText(en.loading)
    finish(snap({ relayConnected: true }))
    await screen.findByRole('img', { name: en.qr })
  })

  it('shows a retry control when the first read fails, then the QR', async () => {
    const getRemote = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(snap({ relayConnected: true }))
    renderRemote({ getRemote })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByText(en.error)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await screen.findByRole('img', { name: en.qr })
  })

  it('surfaces a save failure with human copy and stringifies non-Error load failures', async () => {
    renderRemote({ getRemote: vi.fn(async () => { throw 'offline' }) })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByText(en.error)
    cleanup()
    const props = renderRemote({
      getRemote: vi.fn(async () => snap({ relayConnected: true })),
      saveRemote: vi.fn(async () => { throw 'write failed' }),
    })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    fireEvent.click(await screen.findByRole('radio', { name: en.enabledOff }))
    await waitFor(() => { expect(props.saveRemote).toHaveBeenCalled() })
    await screen.findByText(en.statusErrorGeneric)
    cleanup()
    const fromSnap = renderRemote({
      getRemote: vi.fn(async () => snap({ error: 'gateway down', relayConnected: true })),
      saveRemote: vi.fn(async () => { throw new Error('save exploded') }),
    })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByText(en.statusErrorGeneric)
    fireEvent.click(screen.getByRole('radio', { name: en.enabledOff }))
    await waitFor(() => { expect(fromSnap.saveRemote).toHaveBeenCalled() })
    await screen.findByText(en.statusErrorGeneric)
  })

  it('closes on mask click and Escape', async () => {
    renderRemote({ getRemote: vi.fn(async () => snap({ relayConnected: true })) })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByRole('dialog', { name: en.heading })
    const dialog = screen.getByRole('dialog', { name: en.heading })
    fireEvent.click(dialog.previousElementSibling as Element)
    expect(screen.queryByRole('dialog', { name: en.heading })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.trigger }))
    await screen.findByRole('dialog', { name: en.heading })
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('dialog', { name: en.heading })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: en.heading })).toBeNull()
  })

  it('shows a no-QR hint when enabled without a pairing URL after heal', async () => {
    const empty = snap({ urls: [], relayConnected: true })
    renderRemote({
      getRemote: vi.fn(async () => empty),
      saveRemote: vi.fn(async () => empty),
    })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByText(en.noQr)
  })

  it('auto-saves remoteEnabled true once when open enabled without listening', async () => {
    const props = renderRemote({
      getRemote: vi.fn(async () => snap({
        enabled: true,
        listening: false,
        urls: [],
        error: 'EADDRINUSE :3180',
      })),
      saveRemote: vi.fn(async () => snap({ relayConnected: true })),
    })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByText(en.errorPortInUse)
    expect(screen.queryByText(/EADDRINUSE/)).toBeNull()
    await waitFor(() => { expect(props.saveRemote).toHaveBeenCalledWith({ remoteEnabled: true }) })
    await screen.findByRole('img', { name: en.qr })
    expect(props.saveRemote).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('radio', { name: en.enabledOn }))
    expect(props.saveRemote).toHaveBeenCalledTimes(1)
  })

  it('auto-saves once when open enabled listening without pairing url', async () => {
    const empty = snap({ urls: [], relayConnected: true })
    const props = renderRemote({
      getRemote: vi.fn(async () => empty),
      saveRemote: vi.fn(async () => snap({ relayConnected: true })),
    })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await waitFor(() => { expect(props.saveRemote).toHaveBeenCalledWith({ remoteEnabled: true }) })
    await screen.findByRole('img', { name: en.qr })
    expect(props.saveRemote).toHaveBeenCalledTimes(1)
  })

  it('refreshes remote snapshot immediately when the popup opens', async () => {
    const getRemote = vi.fn(async () => snap({ relayConnected: true }))
    renderRemote({ getRemote })
    await waitFor(() => { expect(getRemote).toHaveBeenCalled() })
    const beforeOpen = getRemote.mock.calls.length
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByRole('img', { name: en.qr })
    expect(getRemote.mock.calls.length).toBeGreaterThan(beforeOpen)
  })

  it('rotateRemoteToken only on refresh control click not on open', async () => {
    const rotateRemoteToken = vi.fn(async () => snap({ relayConnected: true }))
    renderRemote({
      getRemote: vi.fn(async () => snap({ relayConnected: true })),
      rotateRemoteToken,
    })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByRole('img', { name: en.qr })
    expect(rotateRemoteToken).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.rotateToken }))
    await waitFor(() => { expect(rotateRemoteToken).toHaveBeenCalledTimes(1) })
  })

  it('copy link uses writeClipboard and shows copied feedback', async () => {
    vi.mocked(writeClipboard).mockClear()
    renderRemote({ getRemote: vi.fn(async () => snap({ relayConnected: true })) })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    fireEvent.click(await screen.findByRole('button', { name: en.copyLink }))
    await waitFor(() => {
      expect(writeClipboard).toHaveBeenCalledWith('http://10.0.0.4:3180/#offer=abc')
    })
    await screen.findByRole('button', { name: en.copiedLink })
  })

  it('renders the rail trigger without a text label', async () => {
    renderRemote({ wide: false })
    const trigger = await screen.findByRole('button', { name: en.trigger })
    expect(trigger.textContent).toBe('')
  })

  it('applies an empty snapshot when getRemote returns null', async () => {
    renderRemote({ getRemote: vi.fn(async () => null) })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    await screen.findByText(en.offHint)
  })

  it('shows the bound-device count and unbinds from the management dialog', async () => {
    const device = {
      id: 'dev-1',
      name: 'iPhone',
      detail: 'iPhone · iOS 18 · Safari',
      shortId: 'ev-1',
      createdAt: '2026-08-14T11:00:00.000Z',
      lastSeenAt: '2026-08-14T12:00:00.000Z',
      online: true,
    }
    const withDevice = snap({ devices: [device], relayConnected: true })
    const props = renderRemote({
      getRemote: vi.fn(async () => withDevice),
      unbindRemoteDevice: vi.fn(async () => snap({ devices: [], relayConnected: true })),
    })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    fireEvent.click(await screen.findByRole('button', { name: `${en.devices} 1` }))
    const manage = within(await screen.findByRole('dialog', { name: en.devicesManage }))
    expect(manage.getByText('iPhone')).toBeTruthy()
    expect(manage.getByText(en.devicesOnline)).toBeTruthy()
    expect(manage.getByText('iPhone · iOS 18 · Safari')).toBeTruthy()
    expect(manage.getByText(en.devicesId.replace('{id}', device.shortId))).toBeTruthy()
    expect(manage.getByText(new RegExp(`^${en.devicesBound.split('{time}')[0]}`))).toBeTruthy()
    expect(manage.getByText(new RegExp(`^${en.devicesSeen.split('{time}')[0]}`))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.unbind }))
    await waitFor(() => { expect(props.unbindRemoteDevice).toHaveBeenCalledWith('dev-1') })
    await screen.findByText(en.devicesEmpty)
  })

  it('opens an empty device dialog, surfaces unbind failures, and closes inner then outer on Escape', async () => {
    const props = renderRemote({
      getRemote: vi.fn(async () => snap({
        relayConnected: true,
        devices: [
          { id: 'dev-2', name: 'Android' },
          { id: 'dev-3', name: 'Mac', lastSeenAt: 'not-a-date' },
        ],
      })),
      unbindRemoteDevice: vi.fn(async () => { throw 'drop failed' }),
    })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    fireEvent.click(await screen.findByRole('button', { name: `${en.devices} 2` }))
    expect(screen.getByText(en.devicesSeenUnknown)).toBeTruthy()
    expect(screen.getByText(en.devicesSeen.replace('{time}', en.devicesSeenUnknown))).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: en.unbind })[0]!)
    await waitFor(() => { expect(props.unbindRemoteDevice).toHaveBeenCalledWith('dev-2') })
    await screen.findByText(en.statusErrorGeneric)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: en.devicesManage })).toBeNull()
    expect(screen.getByRole('dialog', { name: en.heading })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: en.heading })).toBeNull()
    cleanup()
    const exploded = renderRemote({
      getRemote: vi.fn(async () => snap({
        relayConnected: true,
        devices: [{ id: 'dev-4', name: 'Windows' }],
      })),
      unbindRemoteDevice: vi.fn(async () => { throw new Error('drop exploded') }),
    })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    fireEvent.click(await screen.findByRole('button', { name: `${en.devices} 1` }))
    fireEvent.click(screen.getByRole('button', { name: en.unbind }))
    await waitFor(() => { expect(exploded.unbindRemoteDevice).toHaveBeenCalledWith('dev-4') })
    await screen.findByText(en.statusErrorGeneric)
    cleanup()
    renderRemote({
      getRemote: vi.fn(async () => snap({ devices: [], relayConnected: true })),
    })
    fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
    fireEvent.click(await screen.findByRole('button', { name: `${en.devices} 0` }))
    await screen.findByText(en.devicesEmpty)
    fireEvent.click(screen.getByRole('dialog', { name: en.devicesManage }).previousElementSibling as Element)
    expect(screen.queryByRole('dialog', { name: en.devicesManage })).toBeNull()
  })

  it('refreshes the snapshot while the popup is open', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const getRemote = vi.fn()
        .mockResolvedValueOnce(snap({ relayConnected: true }))
        .mockResolvedValueOnce(snap({
          relayConnected: true,
          devices: [{ id: 'later', name: 'Android' }],
        }))
        .mockRejectedValue('poll fail')
      renderRemote({ getRemote })
      fireEvent.click(await screen.findByRole('button', { name: en.trigger }))
      await screen.findByRole('button', { name: `${en.devices} 0` })
      await vi.advanceTimersByTimeAsync(2000)
      await screen.findByRole('button', { name: `${en.devices} 1` })
      await vi.advanceTimersByTimeAsync(2000)
      await screen.findByText(en.statusErrorGeneric)
    } finally {
      vi.useRealTimers()
    }
  })
})
