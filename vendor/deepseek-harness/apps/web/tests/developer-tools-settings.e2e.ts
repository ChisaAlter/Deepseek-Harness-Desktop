/** Developer tools default on for a fresh Host and survive browser reload through the ordinary settings UI. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from './scaffold.ts'
import { openSettings, newEnglishPage } from './support.ts'

it('persists developer tools in the Host settings document and restores the accepted choice', async () => {
  const scaffold = await launchWebScaffold()
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  await page.goto(scaffold.authenticatedUrl)
  await openSettings(page, 'en')
  const toggle = page.getByRole('switch', { name: 'Developer tools' })
  expect(await toggle.getAttribute('aria-checked')).toBe('true')
  expect(await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')).not.toMatch(/id: ui-settings(?:\r?\n|$)/)
  await toggle.click()
  await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
  expect(await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8')).toContain('enabled: false')
  await page.reload()
  await openSettings(page, 'en')
  await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')

  await page.getByRole('button', { name: 'Agent presets', exact: true }).click()
  const pickerToggle = page.getByRole('switch', { name: 'Choose a mode for new tasks' })
  await expect.poll(() => page.getByRole('heading', { name: 'Agent presets', exact: true }).count()).toBe(1)
  expect(await pickerToggle.count()).toBe(0)
  await scaffold.ctx.settings.update('ui-settings', { enabled: true })
  await expect.poll(() => pickerToggle.count()).toBe(1)
  await expect.poll(() => pickerToggle.isEnabled()).toBe(true)
  const pickerEnabled = await pickerToggle.getAttribute('aria-checked')
  await scaffold.ctx.settings.update('ui-settings', { enabled: false })
  await expect.poll(() => pickerToggle.count()).toBe(0)
  await scaffold.ctx.settings.update('ui-settings', { enabled: true })
  await expect.poll(() => pickerToggle.isEnabled()).toBe(true)
  await expect.poll(() => pickerToggle.getAttribute('aria-checked')).toBe(pickerEnabled)
})
