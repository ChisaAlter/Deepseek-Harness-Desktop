import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SessionLogDownloadHeaderAction } from '../src/client/HeaderAction.tsx'
import { SessionLogChromeRow } from '../src/client/SessionLogChromeRow.tsx'
import { apply, inject } from '../src/client/index.ts'

const SID = 'session-export-apply' as SessionId

afterEach(() => { vi.unstubAllGlobals() })

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'shell.titlebar.trailing': { kind: 'list', scope: 'root' },
      'settings.interface.item': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false })
  ctx.provide('remote', { $on: () => () => {} })
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, fiber }
}

describe('session-log-download browser plugin', () => {
  it('provides one controller and removes its Header contribution on disposal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    const b = await bench()
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
    expect(b.ctx.sessionLogDownload).toBeDefined()
    expect(b.slots.entries('conversation.session.header.actions')).toHaveLength(0)
    const entry = b.slots.entries('shell.titlebar.trailing')[0]
    expect(entry?.component).toBe(SessionLogDownloadHeaderAction)
    expect(entry?.options).toMatchObject({ id: 'session-log-download', order: 10 })
    const chrome = b.slots.entries('settings.interface.item')[0]
    expect(chrome?.component).toBe(SessionLogChromeRow)
    expect(chrome?.options).toMatchObject({ id: 'session-log-export', order: 10 })
    const chromeInjected = (chrome?.inject as unknown as () => import('../src/client/SessionLogChromeRow.tsx').SessionLogChromeRowInjected)()
    expect(chromeInjected.hooks.titlebarAction.getSnapshot()).toBe(true)
    chromeInjected.setTitlebarAction(false)
    expect(chromeInjected.hooks.titlebarAction.getSnapshot()).toBe(false)
    const injected = (entry?.inject as unknown as () => import('../src/client/Dialog.tsx').SessionLogDownloadDialogInjected)()
    await injected.request(SID)
    expect(b.ctx.sessionLogDownload.store.getSnapshot().bySession[SID]?.status).toBe('error')
    injected.dismiss(SID)
    expect(b.ctx.sessionLogDownload.store.getSnapshot().bySession[SID]?.open).toBe(false)

    await b.fiber.dispose()
    expect(b.slots.entries('shell.titlebar.trailing')).toHaveLength(0)
    expect(b.slots.entries('settings.interface.item')).toHaveLength(0)
  })

  it('downloads only for an export execution acknowledged by this browser client', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 500 }))
    vi.stubGlobal('fetch', fetcher)
    const first = await bench()
    const second = await bench()

    first.ctx.emit('command/executed', SID, 'plan', { kind: 'success' })
    expect(fetcher).not.toHaveBeenCalled()
    first.ctx.emit('command/executed', SID, 'export', { kind: 'error', text: 'bad path' })
    expect(fetcher).not.toHaveBeenCalled()
    first.ctx.emit('command/executed', SID, 'export', { kind: 'success' })
    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledOnce()
      expect(first.ctx.sessionLogDownload.store.getSnapshot().bySession[SID]?.status).toBe('error')
    })
    expect(second.ctx.sessionLogDownload.store.getSnapshot().bySession[SID]).toBeUndefined()

    await first.fiber.dispose()
    await second.fiber.dispose()
  })

  it('re-registers after the declaring Header slot collapses and returns', async () => {
    const b = await bench()
    b.declaration()
    expect(b.slots.entries('shell.titlebar.trailing')).toHaveLength(0)
    const redeclare = declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('shell.titlebar.trailing')[0]?.component).toBe(SessionLogDownloadHeaderAction)
    redeclare()
    await b.fiber.dispose()
  })
})
