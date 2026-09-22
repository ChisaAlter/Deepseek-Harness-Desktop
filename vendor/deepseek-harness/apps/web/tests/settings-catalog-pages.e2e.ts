// Web e2e scenario: the shipped Settings composition reaches the real MCP and
// Skills catalog pages through browser gestures. The world is keyless and
// isolated: a deterministic read-only skill lives under the scaffold's temp
// bundled root and resolves through the live standard preset, while the MCP page
// remains read-only and starts no server.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { describe, expect, it, onTestFailed } from 'vitest'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/settings-catalog-pages', import.meta.url))
const MCP_EXPECTED = join(SNAPSHOT_DIR, 'mcp.expected.md')
const SKILLS_EXPECTED = join(SNAPSHOT_DIR, 'skills.expected.md')
const FIXTURE_SKILL = 'settings-catalog-fixture'
const SCAFFOLD_MODULE = './scaffold.ts'

type SnapshotMode = 'replay' | 'record' | 'refresh'

interface CatalogScaffold {
  readonly baseUrl: string
  readonly harnessHome: string
  readonly workspaceCwd: string
  close(): Promise<void>
}

interface ScaffoldApi {
  launchWebScaffold(options?: object): Promise<CatalogScaffold>
  webSnapshotMode(): SnapshotMode
  captureStableAria(page: Page, selector: string, workspaceCwd: string): Promise<string>
  compareOrRefreshGolden(path: string, actual: string, mode: SnapshotMode): Promise<void>
  assertFixtureInventory(path: string, expected: string[]): Promise<void>
  watchConsole(page: Page): { warnings: string[]; pageErrors: string[] }
}

describe('web e2e: shipped MCP and Skills settings catalogs', () => {
  it.skipIf(process.env.DSH_SNAPSHOT === 'record')('opens both real catalog pages without errors or user configuration writes', async () => {
    const scaffoldApi = await import(SCAFFOLD_MODULE) as ScaffoldApi
    const mode = scaffoldApi.webSnapshotMode()
    let scaffold: CatalogScaffold | undefined
    let browser: Browser | undefined
    let page: Page | undefined
    try {
      scaffold = await scaffoldApi.launchWebScaffold({
        bundledSkills: [{
          name: FIXTURE_SKILL,
          markdown: [
            '---',
            `name: ${FIXTURE_SKILL}`,
            'description: Deterministic skill for Settings composition coverage',
            'whenToUse: Use only in the isolated Web scaffold test',
            'disable-model-invocation: true',
            'user-invocable: false',
            '---',
            '',
            'Keep this fixture inside the temporary scaffold world.',
            '',
          ].join('\n'),
        }],
      })
      expect(scaffold.harnessHome.startsWith(scaffold.workspaceCwd)).toBe(true)

      browser = await chromium.launch()
      page = await newEnglishPage(browser)
      const tripwire = scaffoldApi.watchConsole(page)
      onTestFailed(() => { if (page !== undefined) void saveFailureShot(page, 'web-e2e-settings-catalog-pages') })

      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await connectFreshWorkspace(page, scaffold.workspaceCwd, 'settings-catalog')
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Settings' })
      await dialog.waitFor({ timeout: 10_000 })

      const mcpNav = dialog.getByRole('button', { name: 'MCP', exact: true })
      const skillsNav = dialog.getByRole('button', { name: 'Skills', exact: true })
      await mcpNav.click()
      await dialog.getByRole('heading', { name: 'MCP servers', exact: true }).waitFor({ timeout: 10_000 })
      await dialog.getByRole('searchbox', { name: 'Search name, ID, command, or URL' }).waitFor({ timeout: 10_000 })
      expect(await mcpNav.getAttribute('aria-current')).toBe('true')
      expect(await skillsNav.getAttribute('aria-current')).toBeNull()
      expect(await dialog.getByRole('alert').count()).toBe(0)
      // Desktop fork: filter chips are SettingsSelect pills (button + img).
      const mcpSnapshot = await scaffoldApi.captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
      await scaffoldApi.compareOrRefreshGolden(MCP_EXPECTED, mcpSnapshot, mode)

      await skillsNav.click()
      await dialog.getByRole('heading', { name: 'Skills', exact: true }).waitFor({ timeout: 10_000 })
      try {
        await dialog.getByText(FIXTURE_SKILL, { exact: true }).waitFor({ timeout: 10_000 })
      } catch (error) {
        const state = await scaffoldApi.captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
        throw new Error(`fixture skill did not resolve through the active preset:\n${state}`, { cause: error })
      }
      expect(await skillsNav.getAttribute('aria-current')).toBe('true')
      expect(await mcpNav.getAttribute('aria-current')).toBeNull()
      expect(await dialog.getByRole('alert').count()).toBe(0)
      const skillsSnapshot = await scaffoldApi.captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd)
      await scaffoldApi.compareOrRefreshGolden(SKILLS_EXPECTED, skillsSnapshot, mode)

      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
      if (mode !== 'record') {
        await scaffoldApi.assertFixtureInventory(SNAPSHOT_DIR, ['mcp.expected.md', 'skills.expected.md'])
      }
    } finally {
      await browser?.close()
      await scaffold?.close()
    }
  }, 120_000)
})
