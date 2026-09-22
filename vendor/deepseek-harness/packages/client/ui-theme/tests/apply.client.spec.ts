/** ui-theme apply wiring: service provision, settings dictionaries riding the
 * locale service, declaration-aware Appearance section + font-size row
 * registration, snapshot projection into the stores, and HMR collapse recovery. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, SETTINGS_NS } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { AppearanceSectionInjected, FontSizeRowInjected, ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import { THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema } from '../src/theme-settings.ts'
import { AppearanceSection } from '../src/client/AppearanceSection.tsx'
import { FontSizeRow } from '../src/client/FontSizeRow.tsx'
import type { createAppearanceRowStore, createFontSizeRowStore } from '../src/client/settings-store.ts'

// These specs assert the shipped Chinese copy. The lane has no jsdom `window`,
// so browser-language detection never runs and a fresh LocaleRuntime opens on
// FALLBACK_LOCALE (en); bench stages zh explicitly on the locale instead.

const SECTION_SLOT = 'settings.section'
const ITEM_SLOT = 'settings.general.item'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function bench(isLoopback = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  ctx.provide('connection', {
    api: { settings: { describe: () => Promise.resolve({
      rpcId: 'theme-apply' as never,
      result: { ok: true, value: { writable: true, hasDocument: false, namespaces: [] } },
    }) } },
    isLoopback: true,
  } as never)
  const section: Record<string, unknown> = { preference: 'system', fontSize: 14 }
  const namespace = () => ({
    ns: THEME_SETTINGS_NAMESPACE,
    schema: ThemeSettingsSchema.toJSON(),
    value: { ...section },
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  })
  const describe = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: { writable: true, hasDocument: true, namespaces: [namespace()] },
  }))
  const mutate = vi.fn((_ns: string, ops: { path: string[]; value: unknown }[]) => {
    const op = ops[0]!
    section[op.path[0]!] = op.value
    return Promise.resolve({ ok: true as const, value: namespace() })
  })
  const events = new TestRemote(ctx, { settings: { describe, mutate } })
  events.$host = { home: undefined, isLoopback }
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale, describe, mutate, events,
    setHostSection: (next: Record<string, unknown>) => { Object.assign(section, next) },
  }
}

/** Stand in for the settings shell: declare Appearance section + General item slots. */
function declareSlots(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        [SECTION_SLOT]: { kind: 'list', scope: 'root' },
        [ITEM_SLOT]: { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

/** Mirror the framework's inject choreography for the Appearance section. */
function faceOf(slots: SlotRegistry) {
  const entry = slots.entries(SECTION_SLOT).find(e => e.component === AppearanceSection)!
  const handle = entry.store as ReturnType<typeof createAppearanceRowStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => AppearanceSectionInjected)(instance.actions)
  return { entry, instance, face }
}

/** The same choreography for the font-size row entry. */
function fontSizeFaceOf(slots: SlotRegistry) {
  const entry = slots.entries(ITEM_SLOT).find(e => e.component === FontSizeRow)!
  const handle = entry.store as ReturnType<typeof createFontSizeRowStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => FontSizeRowInjected)(instance.actions)
  return { entry, instance, face }
}

describe('ui-theme apply', () => {
  it('declares the slot and locale services', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('provides the service, registers localized copy, and registers the section and font-size row', async () => {
    const before = await bench()
    declareSlots(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.locale.bind(SETTINGS_NS)('appearance.title')).toBe('外观')
    expect(before.locale.bind(SETTINGS_NS)('fontSize.title')).toBe('字号大小')
    before.locale.setLocale('en')
    expect(before.locale.bind(SETTINGS_NS)('appearance.title')).toBe('Appearance')
    const entry = before.slots.entries(SECTION_SLOT).find(e => e.component === AppearanceSection)!
    expect(entry.options).toMatchObject({ id: 'appearance', order: 5 })
    const fontEntry = before.slots.entries(ITEM_SLOT).find(e => e.component === FontSizeRow)!
    expect(fontEntry.options).toMatchObject({ id: 'font-size', order: 11 })
    expect(fontEntry.locale).toBe(SETTINGS_NS)

    const after = await bench()
    const fiber = after.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(after.slots.entries(SECTION_SLOT)).toHaveLength(0)
    expect(after.slots.entries(ITEM_SLOT)).toHaveLength(0)
    declareSlots(after.slots)
    await Promise.resolve()
    expect(after.slots.entries(SECTION_SLOT).some(e => e.component === AppearanceSection)).toBe(true)
    expect(after.slots.entries(ITEM_SLOT).some(e => e.component === FontSizeRow)).toBe(true)
  })

  it('projects service snapshots into the section store and routes face writes back', async () => {
    const b = await bench()
    declareSlots(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    // An event ahead of any inject hits the unbound-actions arm.
    theme.setTheme('dark')

    const { instance, face } = faceOf(b.slots)
    // The inject-time re-sync sealed the init window: the mirror is current.
    expect(instance.getSnapshot().preference).toBe('dark')
    expect(b.slots.entries(SECTION_SLOT).find(e => e.component === AppearanceSection)!.locale).toBe(SETTINGS_NS)

    face.setTheme('system')
    expect(theme.getTheme().preference).toBe('system')
    expect(instance.getSnapshot().preference).toBe('system')
    // Desktop fork: preference writes debounce 300ms per field, so the dark
    // pick and the system pick collapse into ONE Host mutation.
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledTimes(1) })
    expect(b.mutate.mock.calls.at(-1)?.[1].at(-1)?.value).toBe('system')
  })

  it('projects font-size snapshots into its row store and routes face writes back', async () => {
    const b = await bench()
    declareSlots(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    // An event ahead of any inject hits the unbound-actions arm.
    theme.setFontSize(16)

    const { instance, face } = fontSizeFaceOf(b.slots)
    // The inject-time re-sync sealed the init window: the mirror is current.
    expect(instance.getSnapshot().fontSize).toBe(16)

    face.setFontSize(12)
    expect(theme.getTheme().fontSize).toBe(12)
    expect(instance.getSnapshot().fontSize).toBe(12)
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledTimes(2) })
  })

  it('loads Host settings at boot, refreshes its namespace, and keeps remote browsers process-local', async () => {
    const b = await bench()
    b.setHostSection({ preference: 'dark', fontSize: 17 })
    b.events.emit('settings/document-updated', [THEME_SETTINGS_NAMESPACE, 0])
    declareSlots(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('dark') })
    expect(theme.getTheme().fontSize).toBe(17)
    b.events.emit('settings/document-updated', ['unrelated', 0])
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledTimes(3) })
    expect(theme.getTheme().preference).toBe('dark')
    b.setHostSection({ preference: 'light' })
    b.events.emit('settings/document-updated', [THEME_SETTINGS_NAMESPACE, 0])
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('light') })
    b.setHostSection({ preference: 'dark' })
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('dark') })

    const remote = await bench(false)
    declareSlots(remote.slots)
    await remote.ctx.plugin({ inject: [...inject], apply }).await()
    const remoteTheme = remote.ctx.get('theme') as ThemeRuntime
    remoteTheme.setTheme('dark')
    await Promise.resolve()
    expect(remote.describe).not.toHaveBeenCalled()
    expect(remote.mutate).not.toHaveBeenCalled()
  })

  it('activates before a slow settings refresh and converges when it settles', async () => {
    const b = await bench()
    b.setHostSection({ preference: 'dark' })
    const describe = b.describe.getMockImplementation()!
    const pending = deferred<Awaited<ReturnType<typeof describe>>>()
    b.describe.mockImplementationOnce(() => pending.promise)
    b.events.emit('settings/document-updated', [THEME_SETTINGS_NAMESPACE, 0])
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    expect(theme.getTheme().preference).toBe('system')
    pending.resolve(await describe())
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('dark') })
    await fiber.dispose()
  })

  it('ignores an invalid preference crossing the settings wire', async () => {
    const b = await bench()
    b.setHostSection({ preference: 'sepia' })
    b.events.emit('settings/document-updated', [THEME_SETTINGS_NAMESPACE, 0])
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledTimes(2) })
    expect(theme.getTheme().preference).toBe('system')
  })

  it('recovers after an HMR collapse of the declaring entry (stale disposer must not block)', async () => {
    const b = await bench()
    const host = declareSlots(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries(SECTION_SLOT)).toHaveLength(1)
    expect(b.slots.entries(ITEM_SLOT)).toHaveLength(1)

    host()
    expect(b.slots.entries(SECTION_SLOT)).toHaveLength(0)
    expect(b.slots.entries(ITEM_SLOT)).toHaveLength(0)

    declareSlots(b.slots)
    await Promise.resolve()
    expect(b.slots.entries(SECTION_SLOT).some(e => e.component === AppearanceSection)).toBe(true)
    expect(b.slots.entries(ITEM_SLOT).some(e => e.component === FontSizeRow)).toBe(true)
  })

  it('teardown removes the section, the font-size row, and the dictionaries; teardown without a declaration is quiet', async () => {
    const b = await bench()
    declareSlots(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries(SECTION_SLOT)).toHaveLength(1)
    expect(b.slots.entries(ITEM_SLOT)).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries(SECTION_SLOT)).toHaveLength(0)
    expect(b.slots.entries(ITEM_SLOT)).toHaveLength(0)
    expect(b.locale.bind(SETTINGS_NS)('appearance.title')).toBe('appearance.title')

    const quiet = await bench()
    const f2 = quiet.ctx.plugin({ inject: [...inject], apply })
    await f2.await()
    await f2.dispose()
    expect(quiet.slots.entries(SECTION_SLOT)).toHaveLength(0)
    expect(quiet.slots.entries(ITEM_SLOT)).toHaveLength(0)
  })
})
