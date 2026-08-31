/** Preview plugin injects the panel into surfaces.browser. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { PreviewPanel } from '../src/client/PreviewPanel.tsx'

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'surfaces.browser': { kind: 'single', scope: 'session-maybe' },
    },
  } as never, () => null)
}

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declaration = declare(slots)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, slots, declaration, fiber }
}

describe('ui-preview apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('injects PreviewPanel into surfaces.browser', async () => {
    const b = await bench()
    expect(b.slots.entries('surfaces.browser')[0]?.component).toBe(PreviewPanel)
    await b.fiber.dispose()
    expect(b.slots.entries('surfaces.browser')).toHaveLength(0)
  })

  it('re-registers after the declaring slot collapses and returns', async () => {
    const b = await bench()
    b.declaration()
    expect(b.slots.entries('surfaces.browser')).toHaveLength(0)
    const redeclare = declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('surfaces.browser')[0]?.component).toBe(PreviewPanel)
    redeclare()
    await b.fiber.dispose()
  })

  it('binds appendComposerText to the composer draft', async () => {
    const b = await bench()
    const setDraft = vi.fn()
    b.ctx.provide('sessions', { scope: () => ({}) })
    b.ctx.provide('conversation', {
      input: {
        for: () => ({
          setDraft,
          state: { getSnapshot: () => ({ draft: '' }) },
        }),
      },
    })
    const injected = (b.slots.entries('surfaces.browser')[0]?.inject as unknown as () => {
      appendComposerText?: (sessionId: string, text: string) => void
    })()
    injected.appendComposerText?.('sess', '![#save](data:image/png;base64,abc)\n`#save`')
    expect(setDraft).toHaveBeenCalledWith('![#save](data:image/png;base64,abc)\n`#save`')
    await b.fiber.dispose()
  })
})
