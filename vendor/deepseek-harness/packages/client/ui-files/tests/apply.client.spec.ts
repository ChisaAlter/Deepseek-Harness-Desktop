/** Files plugin injects the tree and preview into surfaces.files / surfaces.file. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { FilePreview } from '../src/client/FilePreview.tsx'
import { FilesPanel } from '../src/client/FilesPanel.tsx'
import type { FilesShellInjected } from '../src/client/shell.ts'

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'surfaces.files': { kind: 'single', scope: 'session-maybe' },
      'surfaces.file': { kind: 'single', scope: 'session-maybe' },
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

describe('ui-files apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('injects the tree into surfaces.files and the preview into surfaces.file', async () => {
    const b = await bench()
    expect(b.slots.entries('surfaces.files')[0]?.component).toBe(FilesPanel)
    expect(b.slots.entries('surfaces.file')[0]?.component).toBe(FilePreview)
    await b.fiber.dispose()
    expect(b.slots.entries('surfaces.files')).toHaveLength(0)
    expect(b.slots.entries('surfaces.file')).toHaveLength(0)
  })

  it('re-registers after the declaring slots collapse and return', async () => {
    const b = await bench()
    b.declaration()
    expect(b.slots.entries('surfaces.files')).toHaveLength(0)
    expect(b.slots.entries('surfaces.file')).toHaveLength(0)
    const redeclare = declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('surfaces.files')[0]?.component).toBe(FilesPanel)
    expect(b.slots.entries('surfaces.file')[0]?.component).toBe(FilePreview)
    redeclare()
    await b.fiber.dispose()
  })

  it('binds mentionFile and missing-shell fallbacks', async () => {
    const b = await bench()
    const injected = (b.slots.entries('surfaces.files')[0]?.inject as unknown as () => FilesShellInjected)()
    injected.mentionFile('sess', 'a.ts')
    await expect(injected.listDir('/tmp', '')).resolves.toEqual({
      ok: false, message: 'Workspace listing is unavailable.',
    })
    await expect(injected.readFile('/tmp', 'a.ts')).resolves.toEqual({
      ok: false, message: 'Workspace listing is unavailable.',
    })
    await expect(injected.readFileMedia('/tmp', 'a.png')).resolves.toEqual({
      ok: false, message: 'Workspace listing is unavailable.',
    })
    await expect(injected.writeFile('/tmp', 'a.ts', 'x')).resolves.toEqual({
      ok: false, message: 'Workspace listing is unavailable.',
    })
    await b.fiber.dispose()
  })

  it('mentions a file as a markdown link in the composer draft', async () => {
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
    const injected = (b.slots.entries('surfaces.files')[0]?.inject as unknown as () => FilesShellInjected)()
    injected.mentionFile('sess', 'docs/My File.md')
    expect(setDraft).toHaveBeenCalledWith('[My File.md](docs/My%20File.md)')
    expect(setDraft).not.toHaveBeenCalledWith('`@docs/My File.md`')
    await b.fiber.dispose()
  })

  it('does not register an @ path source when inputTriggers and sessions are present', async () => {
    const registered: { trigger: string; name: string }[] = []
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    declare(slots)
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('inputTriggers', {
      registerSource: (src: { trigger: string; name: string }) => {
        registered.push(src)
        return () => {}
      },
    })
    ctx.provide('sessions', {
      list: { getSnapshot: () => ({ byId: {} }) },
    })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(inject).not.toContain('sessions')
    expect(inject).not.toContain('inputTriggers')
    expect(registered).toEqual([])
    expect(registered.filter(src => src.name === 'path')).toHaveLength(0)
    await fiber.dispose()
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
    const injected = (b.slots.entries('surfaces.file')[0]?.inject as unknown as () => FilesShellInjected)()
    injected.appendComposerText?.('sess', 'L1 to L2 `src/a.ts`\n\n```text\none\ntwo\n```')
    expect(setDraft).toHaveBeenCalledWith('L1 to L2 `src/a.ts`\n\n```text\none\ntwo\n```')
    await b.fiber.dispose()
  })
})
