/** Diff plugin injects the panel into surfaces.diff. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { DiffPanel } from '../src/client/DiffPanel.tsx'
import type { DiffShellInjected } from '../src/client/shell.ts'

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'surfaces.diff': { kind: 'single', scope: 'session-maybe' },
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

describe('ui-diff apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('injects DiffPanel into surfaces.diff', async () => {
    const b = await bench()
    expect(b.slots.entries('surfaces.diff')[0]?.component).toBe(DiffPanel)
    await b.fiber.dispose()
    expect(b.slots.entries('surfaces.diff')).toHaveLength(0)
  })

  it('re-registers after the declaring slot collapses and returns', async () => {
    const b = await bench()
    b.declaration()
    expect(b.slots.entries('surfaces.diff')).toHaveLength(0)
    const redeclare = declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('surfaces.diff')[0]?.component).toBe(DiffPanel)
    redeclare()
    await b.fiber.dispose()
  })

  it('binds missing-shell git fallbacks', async () => {
    const b = await bench()
    const injected = (b.slots.entries('surfaces.diff')[0]?.inject as unknown as () => DiffShellInjected)()
    await expect(injected.gitStatus('/tmp')).resolves.toBeNull()
    await expect(injected.gitDiff('/tmp')).resolves.toBeNull()
    await expect(injected.gitStatusEntries('/tmp')).resolves.toBeNull()
    await expect(injected.gitStage('/tmp', 'a.ts')).resolves.toEqual({
      ok: false, message: 'Git status is unavailable.',
    })
    await expect(injected.gitUnstage('/tmp', 'a.ts')).resolves.toEqual({
      ok: false, message: 'Git status is unavailable.',
    })
    await expect(injected.gitDiscard('/tmp', 'a.ts')).resolves.toEqual({
      ok: false, message: 'Git status is unavailable.',
    })
    await expect(injected.gitBranchList('/tmp')).resolves.toBeNull()
    await b.fiber.dispose()
  })
})
