// @vitest-environment jsdom
/** ui-settings-mcp browser half: source and slot registration for the MCP servers section. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { McpSection } from '../src/client/McpSection.tsx'
import type { McpSectionInjected } from '../src/client/McpSection.tsx'
import { zh } from '../src/client/locales.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(() => { cleanup() })

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const api = { settings: { describe: async () => ({ result: { ok: true, value: { namespaces: [] } } }) } }
  ctx.provide('connection', { api } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, api }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-mcp browser plugin', () => {
  it('declares exactly the services its section contribution uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers the MCP servers section with the localized label and injected api', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entries = b.slots.entries('settings.section')
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.component).toBe(McpSection)
    expect(entry.options).toMatchObject({ id: 'mcp', order: 13 })
    const label = (entry.options as { label?: () => string }).label
    expect(label?.()).toBe(zh.nav)
    const injected = (entry.inject as unknown as () => McpSectionInjected)()
    expect(injected.api).toBe(b.api)
    expect(NS).toBe('settings.mcp')
    await b.ctx.fiber.dispose()
  })

  it('recovers when the settings.section declaration arrives later', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    stop()
    await b.ctx.fiber.dispose()
  })
})
