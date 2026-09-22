// Web e2e: one assembled walk of every desktop UI that survived the rc.8
// vendor merge. Zero model calls. English browser locale. Live assertions,
// no golden files — titlebar/surfaces goldens stay in desktop-chrome.e2e.ts.
// Electron-only chrome (dshbot Bots tab, native BrowserView) is out of this
// lane; src/shared/post-merge-ui.test.js pins those source markers.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE_SKILL = 'post-merge-ui-fixture'

async function dismissOverlays(page: Page): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    if (await page.getByRole('dialog').count() === 0 && await page.locator('[role="menu"]').count() === 0) return
    await page.keyboard.press('Escape')
  }
}

async function waitVisible(locator: Locator, timeout = 10_000): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout })
}

async function pressUntilReleased(page: Page, name: string, pressed: boolean): Promise<void> {
  const toggle = page.getByRole('button', { name })
  if (await toggle.getAttribute('aria-pressed') === String(pressed)) return
  await toggle.click()
  await expect.poll(() => toggle.getAttribute('aria-pressed'), { timeout: 10_000 }).toBe(String(pressed))
}

describe('web e2e: post-merge assembled desktop UI', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      bundledSkills: [{
        name: FIXTURE_SKILL,
        markdown: [
          '---',
          `name: ${FIXTURE_SKILL}`,
          'description: Skill fixture for the post-merge assembled UI walk',
          'whenToUse: Isolated web e2e only',
          'disable-model-invocation: true',
          'user-invocable: true',
          '---',
          '',
          'Keep this fixture inside the temporary scaffold world.',
          '',
        ].join('\n'),
      }],
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.addInitScript(() => {
      const holder = window as Window & { shell?: Record<string, unknown> }
      holder.shell = {
        ...(holder.shell && typeof holder.shell === 'object' ? holder.shell : {}),
        listWallpaperCatalog: async () => ({
          items: [{
            id: 'e2e-wallpaper',
            title: 'Post-merge fixture',
            copyright: 'e2e',
            thumbUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            imageUrl: 'https://example.invalid/wallpaper.jpg',
            source: 'bing',
          }],
        }),
        downloadWallpaper: async () => ({ error: 'e2e-stub' }),
        listDir: async (_cwd: string, relativePath?: string) => {
          if (relativePath === undefined || relativePath === '') {
            return { ok: true, entries: [{ name: 'note.md', kind: 'file' }] }
          }
          return { ok: true, entries: [] }
        },
        readFile: async () => ({ ok: true, text: 'post-merge ui\n' }),
      }
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const workspaceDir = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(workspaceDir, { recursive: true })
    await writeFile(join(workspaceDir, 'note.md'), 'post-merge ui\n')
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('assembles the four-column frame, composer, and titlebar cluster', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-post-merge-frame'))
    const frame = page.locator('[class*="frame"]').first()
    await frame.waitFor({ timeout: 15_000 })
    const columnCount = await frame.evaluate((el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length)
    expect(columnCount).toBe(4)

    const composer = page.locator('[data-composer-card]')
    await composer.waitFor({ timeout: 15_000 })
    await waitVisible(composer.locator('textarea'))
    await waitVisible(page.getByRole('button', { name: 'Commands' }))
    await waitVisible(page.getByRole('button', { name: 'Send message' }))
    await waitVisible(page.getByRole('button', { name: /Access mode/ }))

    const cluster = page.locator('#dshd-shell-titlebar-trailing')
    await cluster.waitFor({ timeout: 15_000 })
    await waitVisible(cluster.getByRole('button', { name: 'Session log' }))
    await waitVisible(cluster.getByRole('button', { name: 'Switch branch' }))
    await waitVisible(cluster.getByRole('button', { name: 'Commit' }))
    await waitVisible(cluster.getByRole('button', { name: 'Git actions' }))
    await waitVisible(cluster.getByRole('button', { name: 'Toggle terminal drawer' }))
    await waitVisible(cluster.getByRole('button', { name: 'Toggle right panel' }))
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })

  it('keeps $skill typing inert without a catalog inject and opens Commands', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-post-merge-composer'))
    const textarea = page.locator('[data-composer-card] textarea')
    await textarea.fill('$fo')
    expect(await page.getByRole('menuitem', { name: 'foo-skill' }).count()).toBe(0)
    expect(await page.getByRole('menuitem', { name: FIXTURE_SKILL }).count()).toBe(0)

    await textarea.fill('@')
    await expect.poll(() => page.locator('[data-source="path"]').count(), { timeout: 3_000 }).toBe(0)
    await textarea.fill('')

    const commands = page.getByRole('button', { name: 'Commands' })
    if (await commands.isEnabled()) {
      await commands.click()
      await waitVisible(page.getByRole('listbox').or(page.locator('[role="menu"]')).first(), 5_000)
      await page.keyboard.press('Escape')
    }
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })

  it('opens the Git branch and actions menus', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-post-merge-git'))
    await dismissOverlays(page)
    const cluster = page.locator('#dshd-shell-titlebar-trailing')
    const branch = cluster.getByRole('button', { name: 'Switch branch' })
    await branch.click()
    await expect.poll(() => branch.getAttribute('aria-expanded'), { timeout: 5_000 }).toBe('true')
    await page.keyboard.press('Escape')

    await cluster.getByRole('button', { name: 'Git actions' }).click()
    await waitVisible(page.getByRole('menu').first(), 5_000)
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })

  it('opens the terminal drawer work-loop chrome', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-post-merge-terminal'))
    await dismissOverlays(page)
    await pressUntilReleased(page, 'Toggle terminal drawer', true)
    const drawer = page.locator('[data-terminal-owner="drawer"]')
    await waitVisible(drawer)
    await waitVisible(drawer.getByRole('button', { name: 'New terminal' }))
    await pressUntilReleased(page, 'Toggle terminal drawer', false)
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })

  it('opens surfaces on the five-card empty grid, then Files, Agents, and Terminal', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-post-merge-surfaces'))
    await dismissOverlays(page)
    await pressUntilReleased(page, 'Toggle right panel', true)

    const empty = page.locator('[data-surfaces-empty]')
    if (await empty.isVisible().catch(() => false)) {
      await waitVisible(empty.getByRole('heading', { name: 'Open a surface' }))
      expect(await empty.getByRole('button', { name: /^Browser/ }).isDisabled()).toBe(true)
      expect(await empty.getByRole('button', { name: /^Diff/ }).isDisabled()).toBe(true)
      expect(await empty.getByRole('button', { name: /^Files/ }).isEnabled()).toBe(true)
      expect(await empty.getByRole('button', { name: /^Agents/ }).isEnabled()).toBe(true)
      expect(await empty.getByRole('button', { name: /^Terminal/ }).isEnabled()).toBe(true)
      await empty.getByRole('button', { name: /^Files/ }).click()
    }

    const tabs = page.locator('[data-surfaces-tabs]')
    await tabs.waitFor({ state: 'visible', timeout: 10_000 })
    await waitVisible(page.getByRole('button', { name: 'Close Files' }))
    const files = page.locator('[data-files-panel]')
    await files.waitFor({ state: 'visible', timeout: 10_000 })
    const search = files.getByRole('textbox', { name: 'Search files' })
    await waitVisible(search)
    await waitVisible(files.getByText('note.md', { exact: true }))
    const mention = files.locator('li').filter({ hasText: 'note.md' }).getByRole('button', { name: 'Mention in composer' })
    await waitVisible(mention)
    await mention.click()
    const composerDraft = page.locator('[data-composer-card] textarea')
    await expect.poll(() => composerDraft.inputValue(), { timeout: 5_000 }).toMatch(/\[note\.md\]\(note\.md\)/)
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
    await search.fill('note')
    await waitVisible(files.getByRole('button', { name: /note\.md/ }).first())

    await page.getByRole('button', { name: 'Open a surface' }).click()
    await page.getByRole('menuitem', { name: 'Agents' }).click()
    await waitVisible(page.getByRole('button', { name: 'Close Agents' }))
    const agents = page.locator('[data-agents-panel]')
    await agents.waitFor({ state: 'visible', timeout: 10_000 })
    await waitVisible(agents.getByText('No agents yet'))

    await page.getByRole('button', { name: 'Open a surface' }).click()
    await page.getByRole('menuitem', { name: 'Terminal' }).click()
    await waitVisible(page.getByRole('button', { name: 'Close Terminal', exact: true }))
    await waitVisible(page.locator('[data-terminal-owner="surface"]'))
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })

  it('keeps Appearance wallpaper as pick/browse and puts gallery sources in the browse window', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-post-merge-wallpaper'))
    await dismissOverlays(page)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Appearance', exact: true }).click()
    await dialog.getByRole('heading', { name: 'Wallpaper', exact: true }).waitFor({ timeout: 10_000 })
    await waitVisible(dialog.getByRole('button', { name: 'Choose image' }))
    await waitVisible(dialog.getByRole('button', { name: 'Browse gallery' }))
    expect(await dialog.getByText('Bing daily wallpapers', { exact: true }).count()).toBe(0)
    expect(await dialog.getByText('Wallpaper catalog URLs', { exact: true }).count()).toBe(0)
    expect(await dialog.getByPlaceholder('https://example.com/wallpapers.json').count()).toBe(0)

    await dialog.getByRole('button', { name: 'Browse gallery' }).click()
    const gallery = page.getByRole('dialog', { name: 'Browse gallery' })
    await gallery.waitFor({ timeout: 10_000 })
    await waitVisible(gallery.getByText('Post-merge fixture'))
    await waitVisible(gallery.getByRole('button', { name: 'Sources' }))
    await gallery.getByRole('button', { name: 'Sources' }).click()
    await waitVisible(gallery.getByRole('button', { name: 'Add source' }))
    await waitVisible(gallery.getByText('Categories come from here. Bing and Wallhaven may each appear only once.'))
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })

  it('opens the shipped MCP and Skills settings pages', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-post-merge-catalogs'))
    await dismissOverlays(page)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.waitFor({ timeout: 10_000 })

    await dialog.getByRole('button', { name: 'MCP', exact: true }).click()
    await dialog.getByRole('heading', { name: 'MCP servers', exact: true }).waitFor({ timeout: 10_000 })
    await waitVisible(dialog.getByRole('searchbox', { name: 'Search name, ID, command, or URL' }))
    await waitVisible(dialog.getByRole('button', { name: 'Add server' }))

    await dialog.getByRole('button', { name: 'Skills', exact: true }).click()
    await dialog.getByRole('heading', { name: 'Skills', exact: true }).waitFor({ timeout: 10_000 })
    await waitVisible(dialog.getByRole('button', { name: 'Add skill' }))
    await waitVisible(dialog.getByText(FIXTURE_SKILL))
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors, tripwire.pageErrors.join('\n')).toEqual([])
  })
})
