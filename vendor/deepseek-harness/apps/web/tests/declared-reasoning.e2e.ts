// Web e2e scenario: a hand-declared model's `reasoningEfforts` reaches the
// composer's effort pane — the levels a settings profile declares are exactly
// what the picker offers, and picking one records it with the Agent default.
// Zero model calls: declaring, describing, and switching are settings/llm
// traffic only, so there is no fixture and a stray stream would fail loud.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, connectFreshWorkspaceZh, saveFailureShot } from './support.ts'

/** Starts the shipped default on this scenario's declared reasoning model. */
const OVERLAY = fileURLToPath(new URL('./declared-reasoning.overlay.yml', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/declared-reasoning', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./expected/declared-reasoning/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()

describe.skipIf(MODE === 'record')('web e2e: declared reasoning efforts reach the composer', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY })
    // The whole reasoning offer is the profile: key = selectable level, value
    // = the wire spelling dispatch would send (`max: ultra` renames; the
    // valueless `off` means "supported, send nothing"). The route sets no
    // deployment default, so the pane leads with the provider-default entry.
    await scaffold.ctx.settings.update('llm-pi-ai', {
      providers: {
        'acme-gateway': {
          displayName: 'Acme Gateway',
          api: 'openai-completions',
          baseURL: 'https://gateway.acme.example/v1',
          models: [{
            id: 'acme-think',
            name: 'Acme Think',
            reasoningEfforts: { off: null, high: 'high', max: 'ultra' },
          }],
        },
      },
    })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('offers exactly the declared levels and records the picked one', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-declared-reasoning'))
    const trigger = page.getByRole('button', { name: /^选择模型/ })
    await trigger.waitFor({ timeout: 15_000 })
    await trigger.click()
    await page.getByRole('menuitem', { name: /推理等级/ }).click()

    // Declared levels, nothing else: the provider-default entry (the route
    // configures no `reasoning`), then Off/High/Max — minimal, low, medium,
    // and xhigh were not declared and must not be offered.
    const levels = page.getByRole('menuitemradio')
    await expect.poll(async () => levels.allTextContents(), { timeout: 10_000 })
      .toEqual(['Default', 'Off', 'High', 'Max'])
    const snapshot = await captureStableAria(page, '[role="menu"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)

    // Keyboard: the clicked cell unmounts with its pane, so the drilled pane's
    // checked row takes the focus it left behind. ↑↓ walk the rows from there
    // and Tab settles the focused one exactly as Enter would.
    await expect.poll(
      () => levels.nth(0).evaluate(element => element === document.activeElement),
      { timeout: 10_000 },
    ).toBe(true)
    await page.keyboard.press('ArrowDown')
    await expect.poll(
      () => levels.nth(1).evaluate(element => element === document.activeElement),
      { timeout: 10_000 },
    ).toBe(true)
    await page.keyboard.press('ArrowDown')
    await expect.poll(
      () => levels.nth(2).evaluate(element => element === document.activeElement),
      { timeout: 10_000 },
    ).toBe(true)

    // Settling with Tab is the same gesture that saves the default selection, so
    // the effort lands in the Agent default Settings section beside provider/model.
    await page.keyboard.press('Tab')
    await expect.poll(() => levels.count(), { timeout: 10_000 }).toBe(0)
    await expect.poll(
      async () => readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8'),
      { timeout: 10_000 },
    ).toContain('reasoningEffort: high')
    await expect.poll(() => trigger.getAttribute('aria-label'), { timeout: 10_000 })
      .toBe('选择模型，当前 Acme Think，推理等级 High')

    // Reopening the drilled pane parks the keyboard on the level in use, and
    // Shift+Tab walks back out like Escape: to the drilled cell, then closed.
    await trigger.click()
    await page.getByRole('menuitem', { name: /推理等级/ }).click()
    const high = page.getByRole('menuitemradio', { name: 'High' })
    await expect.poll(
      () => high.evaluate(element => element === document.activeElement),
      { timeout: 10_000 },
    ).toBe(true)
    await page.keyboard.press('Shift+Tab')
    await expect.poll(
      () => page.getByRole('menuitem', { name: /推理等级/ })
        .evaluate(element => element === document.activeElement),
      { timeout: 10_000 },
    ).toBe(true)
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => page.getByRole('menu').count(), { timeout: 10_000 }).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  })
})
