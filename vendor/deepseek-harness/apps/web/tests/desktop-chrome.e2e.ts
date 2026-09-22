// Web e2e: assembled desktop chrome on the shipped web composition —
// titlebar trailing cluster (Session log, Git, terminal + surfaces toggles)
// and the right-panel empty five-card grid. Zero model calls: a connected
// workspace unlocks the current Session so Session log mounts; Git IPC is
// absent in this lane, so the split button stays on the disabled Commit
// label. A stray stream fails loud on the open llm seam.
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/desktop-chrome', import.meta.url))
const TITLEBAR_EXPECTED = join(SNAPSHOT_DIR, 'titlebar.expected.md')
const EMPTY_EXPECTED = join(SNAPSHOT_DIR, 'empty-five-cards.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: titlebar cluster and surfaces empty five cards', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    await mkdir(SNAPSHOT_DIR, { recursive: true })
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows Session log, Git, and two panel toggles left of the frame edge', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-desktop-chrome-titlebar'))
    const cluster = page.locator('#dshd-shell-titlebar-trailing')
    await cluster.waitFor({ timeout: 15_000 })
    const sessionLog = cluster.getByRole('button', { name: 'Session log' })
    const branch = cluster.getByRole('button', { name: 'Switch branch' })
    const git = cluster.getByRole('button', { name: 'Commit' })
    const gitMenu = cluster.getByRole('button', { name: 'Git actions' })
    const terminal = cluster.getByRole('button', { name: 'Toggle terminal drawer' })
    const surfaces = cluster.getByRole('button', { name: 'Toggle right panel' })
    expect(await sessionLog.isVisible()).toBe(true)
    expect(await branch.isVisible()).toBe(true)
    expect(await git.isVisible()).toBe(true)
    expect(await gitMenu.isVisible()).toBe(true)
    expect(await terminal.isVisible()).toBe(true)
    expect(await surfaces.isVisible()).toBe(true)
    const boxes = await Promise.all([
      sessionLog.boundingBox(),
      branch.boundingBox(),
      git.boundingBox(),
      terminal.boundingBox(),
      surfaces.boundingBox(),
    ])
    for (const box of boxes) expect(box).not.toBeNull()
    for (let index = 1; index < boxes.length; index += 1) {
      const previous = boxes[index - 1]!
      const current = boxes[index]!
      expect(current.x + 1).toBeGreaterThanOrEqual(previous.x + previous.width)
    }
    const snapshot = await captureStableAria(page, '#dshd-shell-titlebar-trailing', scaffold.workspaceCwd)
    await compareOrRefreshGolden(TITLEBAR_EXPECTED, snapshot, MODE)
    expect(snapshot).toContain('Session log')
    expect(snapshot).toContain('Switch branch')
    expect(snapshot).toContain('Commit')
    expect(snapshot).toContain('Git actions')
    expect(snapshot).toContain('Toggle terminal drawer')
    expect(snapshot).toContain('Toggle right panel')
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })

  it('publishes complete platform UI exports to runtime-loaded plugins', async () => {
    const exportTypes = await page.evaluate(async () => {
      const modules = (window as Window & {
        __DSH_MODULES__?: {
          import: (specifier: string, parentURL: string, attrs: Record<string, never>) => Promise<unknown>
        }
      }).__DSH_MODULES__
      if (modules === undefined) throw new Error('client module system missing')
      const primitives = await modules.import(
        '@deepseek-ai/dsh-client-ui-primitives',
        '',
        {},
      ) as Record<string, unknown>
      return {
        cloudUpload: typeof primitives.IconCloudUploadOutline16,
        commit: typeof primitives.IconCommitOutline16,
        pullRequest: typeof primitives.IconPullRequestOutline16,
      }
    })
    expect(exportTypes).toEqual({
      cloudUpload: 'function',
      commit: 'function',
      pullRequest: 'function',
    })
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })

  it('opens the right panel on the empty five-card grid', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-desktop-chrome-surfaces'))
    const surfaces = page.getByRole('button', { name: 'Toggle right panel' })
    if (await surfaces.getAttribute('aria-pressed') !== 'true') {
      await surfaces.click()
    }
    await expect.poll(() => surfaces.getAttribute('aria-pressed'), { timeout: 10_000 }).toBe('true')
    const empty = page.locator('[data-surfaces-empty]')
    await empty.waitFor({ state: 'visible', timeout: 10_000 })
    const snapshot = await captureStableAria(page, '[data-surfaces-empty]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(EMPTY_EXPECTED, snapshot, MODE)
    expect(snapshot).toContain('Open a surface')
    expect(snapshot).toContain('Browser')
    expect(snapshot).toContain('Terminal')
    expect(snapshot).toContain('Files')
    expect(snapshot).toContain('Diff')
    expect(snapshot).toContain('Agents')
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })

  it('opens Files from the empty grid and keeps the add-tab control', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-desktop-chrome-files-tabs'))
    const surfaces = page.getByRole('button', { name: 'Toggle right panel' })
    if (await surfaces.getAttribute('aria-pressed') !== 'true') {
      await surfaces.click()
    }
    await page.locator('[data-surfaces-empty]').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
    const filesCard = page.getByRole('button', { name: /^Files/ }).first()
    if (await page.locator('[data-surfaces-empty]').isVisible()) {
      await filesCard.click()
    }
    const tabs = page.locator('[data-surfaces-tabs]')
    await tabs.waitFor({ state: 'visible', timeout: 10_000 })
    expect(await page.getByRole('button', { name: 'Close Files' }).isVisible()).toBe(true)
    expect(await page.getByRole('button', { name: 'Open a surface' }).isVisible()).toBe(true)
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })

  it('keeps trailing controls apart and opens the branch menu while surfaces is open', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-desktop-chrome-surfaces-titlebar'))
    const surfaces = page.getByRole('button', { name: 'Toggle right panel' })
    if (await surfaces.getAttribute('aria-pressed') !== 'true') {
      await surfaces.click()
    }
    await expect.poll(() => surfaces.getAttribute('aria-pressed'), { timeout: 10_000 }).toBe('true')
    const cluster = page.locator('#dshd-shell-titlebar-trailing')
    const sessionLog = cluster.getByRole('button', { name: 'Session log' })
    const branch = cluster.getByRole('button', { name: 'Switch branch' })
    const git = cluster.getByRole('button', { name: 'Commit' })
    const boxes = await Promise.all([
      sessionLog.boundingBox(),
      branch.boundingBox(),
      git.boundingBox(),
    ])
    for (const box of boxes) expect(box).not.toBeNull()
    for (let index = 1; index < boxes.length; index += 1) {
      const previous = boxes[index - 1]!
      const current = boxes[index]!
      expect(current.x + 1).toBeGreaterThanOrEqual(previous.x + previous.width)
    }
    await branch.click()
    await expect.poll(() => branch.getAttribute('aria-expanded'), { timeout: 5_000 }).toBe('true')
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })

  it('commits exactly the fixtures it reads', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['titlebar.expected.md', 'empty-five-cards.expected.md'])
  })
})
