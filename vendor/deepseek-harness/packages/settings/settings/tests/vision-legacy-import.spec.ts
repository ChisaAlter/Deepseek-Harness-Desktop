import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, expect, it, vi } from 'vitest'
import { SettingsForms } from '../src/index.ts'

function fixture(override: Record<string, unknown> = {}) {
  const home = mkdtempSync(join(tmpdir(), 'vision-settings-import-'))
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  let selected = false
  const update = vi.fn(async (entry: string) => {
    if (entry === 'llm-vision-fallback') selected = true
  })
  // Exercise the import methods against a minimal service face; profile boot
  // and config reconciliation have separate coverage in configuration.spec.ts.
  const forms = Object.assign(Object.create(SettingsForms.prototype) as SettingsForms, {
    ownerContext: {
      profileContext: { home, name: 'test' },
      configEditor: { configuration: () => [{ entry: { options: { id: 'llm-vision-fallback' } }, override }] },
      logger: { info: vi.fn(), warn: vi.fn() },
    },
    describe: () => [{ ns: 'llm-vision-fallback', value: selected ? { provider: 'mock', model: 'vision' } : {} }],
    update,
  })
  const importDocument = Reflect.get(forms, 'importLegacyDocument') as () => Promise<void>
  return { home, forms, update, importDocument }
}

it('maps a fresh legacy vision section into the live configuration entry', async () => {
  const { home, forms, update, importDocument } = fixture()
  writeFileSync(join(home, 'settings.yaml'), 'vision-fallback:\n  provider: mock\n  model: vision\n')

  await importDocument.call(forms)

  expect(update).toHaveBeenCalledWith('llm-vision-fallback', { provider: 'mock', model: 'vision' })
  expect(existsSync(join(home, 'settings.yaml'))).toBe(false)
  expect(readFileSync(join(home, 'settings.yaml.imported'), 'utf8')).toContain('vision-fallback:')
  expect(existsSync(join(home, 'settings.yaml.imported.vision-fallback-migrated'))).toBe(true)
})

it('recovers a selection skipped by an earlier import once, then respects Off', async () => {
  const { home, forms, update, importDocument } = fixture()
  writeFileSync(join(home, 'settings.yaml.imported'), 'vision-fallback:\n  provider: mock\n  model: vision\n')

  await importDocument.call(forms)
  expect(update).toHaveBeenCalledWith('llm-vision-fallback', { provider: 'mock', model: 'vision' })

  update.mockClear()
  await importDocument.call(forms)
  expect(update).not.toHaveBeenCalled()
})

it.each([
  { provider: '', model: '' },
  { provider: false },
  { maxOutputTokens: 1024 },
])('keeps an explicit profile override instead of restoring an old route: %j', async override => {
  const { home, forms, update, importDocument } = fixture(override)
  writeFileSync(join(home, 'settings.yaml.imported'), 'vision-fallback:\n  provider: mock\n  model: vision\n')

  await importDocument.call(forms)

  expect(update).not.toHaveBeenCalled()
  expect(existsSync(join(home, 'settings.yaml.imported.vision-fallback-migrated'))).toBe(true)
  expect(readFileSync(join(home, 'settings.yaml.imported'), 'utf8')).toContain('provider: mock')
})
