import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, expect, it, vi } from 'vitest'
import z from '@deepseek-ai/schemastery'
import { SettingsForms } from '../src/index.ts'

const themeFields = ['preference', 'fontSize', 'backgroundEffectColors', 'backgroundEffectSpeed',
  'backgroundEffectCount', 'backgroundEffectPreset', 'backgroundEffectVariant']
const conversationFields = ['busyEnter', 'statsLine', 'composerResize', 'viewTabs', 'composerResizeHeight']

function fixture(user: Record<string, Record<string, unknown>> = {}) {
  const home = mkdtempSync(join(tmpdir(), 'client-settings-import-'))
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  const update = vi.fn(async (_ns: string, _patch: object, _revision: number) => {})
  const schema = (fields: readonly string[]) => z.object(Object.fromEntries(
    fields.map(key => [key, z.string().volatile()]),
  )).toJSON()
  const describe = () => [
    { ns: 'ui-theme', schema: schema(themeFields),
      user: user['ui-theme'] ?? {}, revision: 2 },
    { ns: 'ui-conversation', schema: schema(conversationFields),
      user: user['ui-conversation'] ?? {}, revision: 4 },
  ]
  const forms = Object.assign(Object.create(SettingsForms.prototype) as SettingsForms, {
    ownerContext: { profileContext: { home, name: 'test' }, logger: { info: vi.fn(), warn: vi.fn() } },
    describe,
    update,
  })
  const importDocument = Reflect.get(forms, 'importLegacyDocument') as () => Promise<void>
  const backup = join(home, 'settings.yaml.imported')
  return { backup, forms, importDocument, update }
}

it('recovers only omitted legacy fields and preserves explicit false and empty overrides', async () => {
  const { backup, forms, importDocument, update } = fixture({
    'ui-theme': { backgroundEffectColors: [] },
    'ui-conversation': { composerResize: false, viewTabs: [] },
  })
  writeFileSync(backup, JSON.stringify({
    'ui-theme': {
      preference: 'dark', fontSize: 16, backgroundEffectColors: ['#112233'],
      backgroundEffectSpeed: 135, backgroundEffectCount: 4, unknownField: true,
    },
    'ui-conversation': {
      busyEnter: 'queue', statsLine: true, composerResize: true,
      viewTabs: true, composerResizeHeight: 188, unknownField: true,
    },
  }))

  await importDocument.call(forms)

  expect(update).toHaveBeenCalledTimes(2)
  expect(update).toHaveBeenCalledWith('ui-theme', { backgroundEffectSpeed: 135, backgroundEffectCount: 4 }, 2)
  expect(update).toHaveBeenCalledWith('ui-conversation', { statsLine: true, composerResizeHeight: 188 }, 4)
  expect(existsSync(`${backup}.ui-theme-migrated`)).toBe(true)
  expect(existsSync(`${backup}.ui-conversation-migrated`)).toBe(true)
  await importDocument.call(forms)
  expect(update).toHaveBeenCalledTimes(2)
})

it('marks an explicitly overridden section without replaying its old fields', async () => {
  const { backup, forms, importDocument, update } = fixture({
    'ui-theme': { backgroundEffectSpeed: 0 },
  })
  writeFileSync(backup, JSON.stringify({ 'ui-theme': { preference: 'dark', backgroundEffectSpeed: 135 } }))

  await importDocument.call(forms)

  expect(update).not.toHaveBeenCalled()
  expect(existsSync(`${backup}.ui-theme-migrated`)).toBe(true)
  expect(existsSync(`${backup}.ui-conversation-migrated`)).toBe(false)
})

it('leaves a failed section retryable and still recovers the other section', async () => {
  const { backup, forms, importDocument, update } = fixture()
  update.mockImplementation(async ns => { if (ns === 'ui-theme') throw new Error('invalid legacy value') })
  writeFileSync(backup, JSON.stringify({
    'ui-theme': { backgroundEffectCount: 4 },
    'ui-conversation': { statsLine: true },
  }))

  await importDocument.call(forms)

  expect(existsSync(`${backup}.ui-theme-migrated`)).toBe(false)
  expect(existsSync(`${backup}.ui-conversation-migrated`)).toBe(true)
  expect(update).toHaveBeenCalledWith('ui-conversation', { statsLine: true }, 4)
})

it('does not create migration markers without an imported backup', async () => {
  const { backup, forms, importDocument, update } = fixture()
  await importDocument.call(forms)
  expect(update).not.toHaveBeenCalled()
  expect(existsSync(`${backup}.ui-theme-migrated`)).toBe(false)
})
