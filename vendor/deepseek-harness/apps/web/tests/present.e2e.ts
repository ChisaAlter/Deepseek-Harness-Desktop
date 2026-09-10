/** Recorded source-file delivery, edits, reload, deletion, and Session ZIP behavior. */
import { readFile, unlink, mkdir, mkdtemp, writeFile, rm, realpath } from 'node:fs/promises'
import { join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { unzipSync, strFromU8 } from 'fflate'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { tmpdir, release } from 'node:os'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import {
  acknowledgeReloadConnectionLoss, assertFinalWorkspaceSnapshot, captureExpandedTurnProcessAria,
  compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, recordFixture,
  watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const DIR = fileURLToPath(new URL('../../../snapshots/web/present', import.meta.url))
const FIXTURE = join(DIR, 'session.v3.jsonl')
const MODE = webSnapshotMode()
const PROMPT = 'Use one run_code program to do the following in order. Call present for missing.txt and catch its error without creating that file. '
  + 'Use bash to run exactly `printf "DELIVERED_REPORT\\n" > report.txt; printf "DELIVERED_NOTE\\n" > 说明.txt`. '
  + 'Call present for report.txt and 说明.txt. After present succeeds, deliberately throw the string "AFTER_PRESENT" (not an Error object) from that same run_code program. '
  + 'Do not retry the program or create any other files. Finish by mentioning `report.txt` and `说明.txt` in inline code, and put PRESENT_DONE in a separate paragraph.'

// The recorded Bash scenario and executable opener fixture require a POSIX host outside WSL.
describe.skipIf(process.platform === 'win32' || release().toLowerCase().includes('microsoft'))('web e2e: explicit file delivery', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let sessionId: SessionId
  let cwd: string
  let disposeApproval: (() => void) | undefined
  const events: SessionEvent[] = []
  let nativeRoot: string | undefined
  let openLog: string
  const opened = async (): Promise<Array<{ path: string; content: string | null; action: 'open' | 'reveal' }>> => (await readFile(openLog, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line) as { path: string; content: string | null; action: 'open' | 'reveal' })
  const downloads: string[] = []

  beforeAll(async () => {
    nativeRoot = await mkdtemp(join(tmpdir(), 'dsh-present-native-'))
    openLog = join(nativeRoot, 'opened.jsonl')
    await writeFile(openLog, '')
    // Exercise the built Host through its actual OS command, replacing only the desktop application.
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
    await writeFile(join(nativeRoot, command), `#!${process.execPath}
const fs = require('node:fs');
const path = process.argv[2] === '-R' ? process.argv[3] : process.argv[2];
const action = process.argv[2] === '-R' || fs.statSync(path).isDirectory() ? 'reveal' : 'open';
fs.appendFileSync(${JSON.stringify(openLog)}, JSON.stringify({ path, action, content: action === 'open' ? fs.readFileSync(path, 'utf8') : null }) + '\\n');
`, { mode: 0o700 })
    vi.stubEnv('PATH', `${nativeRoot}${delimiter}${process.env.PATH ?? ''}`)
    await mkdir(DIR, { recursive: true })
    scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./present.overlay.yml', import.meta.url)),
      agentPresets: { roots: [], default: 'ptc' }, compareReplaySession: true,
      ...(MODE === 'record' ? {} : { replayFixture: FIXTURE }),
    })
    disposeApproval = scaffold.ctx.on('approval/request', () => Promise.resolve('allowed-once'), { prepend: true })
    scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    page.on('download', (download) => { downloads.push(download.suggestedFilename()) })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      disposeApproval?.()
      try {
        await scaffold?.close()
      } finally {
        vi.unstubAllEnvs()
        if (nativeRoot !== undefined) await rm(nativeRoot, { recursive: true, force: true })
      }
    }
  })

  it('declares nested deliveries even when the enclosing program subsequently fails', async () => {
    if (MODE !== 'record') expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill(PROMPT)
    await input.press('Enter')
    sessionId = await settled
    const workspace = scaffold.ctx.agents.get(sessionId)?.session.header.cwd
    if (workspace === undefined) throw new Error('present Session has no workspace')
    cwd = workspace
    if (MODE === 'record') await recordFixture(scaffold, sessionId, FIXTURE)
    await page.getByText(/^PRESENT_DONE\.?$/).waitFor({ timeout: 30_000 })
    await assertFinalWorkspaceSnapshot(DIR, cwd)
    expect(events.filter(event => event.type === 'deliverables/presented').flatMap(event => event.data.files.map(file => file.path)))
      .toEqual(['report.txt', '说明.txt'])
    for (const event of events) {
      if (event.type === 'deliverables/presented') {
        expect(event.data.files).toEqual([
          { path: 'report.txt', description: 'delivered report' },
          { path: '说明.txt', description: 'delivered note' },
        ])
      }
    }
    expect(events.some(event => event.type === 'tool/ptc-dispatch' && event.data.name === 'present' && event.data.isError)).toBe(true)
    expect(events.some(event => event.type === 'tool/result' && event.data.message.content[0].isError)).toBe(true)
  }, 200_000)

  it('opens current source files after edits and reload, and reports deletion without downloading', async () => {
    await writeFile(join(cwd, 'report.txt'), 'EDITED_REPORT\n')
    await writeFile(join(cwd, '说明.txt'), 'EDITED_NOTE\n')
    for (const reload of [false, true]) {
      if (reload) {
        const warningStart = tripwire.warnings.length
        await page.reload({ waitUntil: 'load' })
        acknowledgeReloadConnectionLoss(tripwire, warningStart)
        await page.getByText(/^PRESENT_DONE\.?$/).waitFor({ timeout: 30_000 })
      }
      const row = page.locator('[data-presented-files-row]')
      await row.waitFor()
      expect(await row.getByRole('button', { name: /More file actions/ }).count()).toBe(2)
      expect(await row.getByText('report.txt', { exact: true }).innerText()).toBe('report.txt')
      const beforeReveal = (await opened()).length
      await row.getByRole('button', { name: 'More file actions for report.txt', exact: true }).click()
      const revealResponse = page.waitForResponse(response => response.url().includes('action=reveal') && response.request().method() === 'POST')
      await page.getByRole('menuitem', { name: process.platform === 'darwin' ? /Show in Finder/ : /Open containing folder/ }).click()
      expect((await revealResponse).status()).toBe(204)
      expect(await row.getByRole('button', { name: 'Open report.txt in sidebar', exact: true })
        .evaluate(button => button === document.activeElement)).toBe(true)
      await expect.poll(opened).toHaveLength(beforeReveal + 1)
      expect((await opened()).at(-1)).toEqual({ action: 'reveal', content: null, path: await realpath(process.platform === 'darwin' ? join(cwd, 'report.txt') : cwd) })
      for (const [name, bytes] of [['report.txt', 'EDITED_REPORT\n'], ['说明.txt', 'EDITED_NOTE\n']] as const) {
        const count = (await opened()).length
        const response = page.waitForResponse(response => response.url().includes('/api/present.open?') && response.request().method() === 'POST')
        await row.getByRole('button', { name: `More file actions for ${name}`, exact: true }).click()
        await page.getByRole('menuitem', { name: 'Open in default app', exact: true }).click()
        expect((await response).status()).toBe(204)
        await page.waitForFunction(() => document.querySelector('[data-presented-files-row] button:disabled') === null)
        expect(await opened()).toHaveLength(count + 1)
        expect((await opened()).at(-1)).toEqual({ action: 'open', path: await realpath(join(cwd, name)), content: bytes })
      }
    }
    const count = (await opened()).length
    const openedResponse = page.waitForResponse(response => response.url().includes('/api/present.open?') && response.request().method() === 'POST')
    await page.locator('code').getByRole('button', { name: 'Open report.txt in default app', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-presented-files-row] button:disabled') === null)
    expect((await openedResponse).status()).toBe(204)
    expect(await opened()).toHaveLength(count + 1)
    expect((await opened()).at(-1)).toEqual({ action: 'open', path: await realpath(join(cwd, 'report.txt')), content: 'EDITED_REPORT\n' })
    expect(downloads).toEqual([])
    const response = await page.request.get(new URL(`/api/session.export?sessionId=${sessionId}`, scaffold.authenticatedUrl).href)
    expect(response.status()).toBe(200)
    const entries = unzipSync(await response.body())
    expect(Object.keys(entries)).toHaveLength(1)
    const exported = strFromU8(Object.values(entries)[0]!)
    expect(exported).toContain('deliverables/presented')
    const declarations = exported.trim().split('\n').map(line => JSON.parse(line) as SessionEvent)
      .filter(event => event.type === 'deliverables/presented')
    expect(declarations).toHaveLength(1)
    expect(declarations[0]!.data.files).toEqual([
      { path: 'report.txt', description: 'delivered report' },
      { path: '说明.txt', description: 'delivered note' },
    ])
    expect(exported).not.toContain('EDITED_REPORT')
    if (MODE !== 'record') {
      const aria = await captureExpandedTurnProcessAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(join(DIR, 'ui.expected.md'), aria, MODE)
      await page.locator('[data-turn-process]').click()
      const failed = page.locator('[data-tool="present"][data-state="error"]')
      const delivered = page.locator('[data-tool="present"][data-state="ok"]')
      expect(await failed.count()).toBe(1)
      expect(await delivered.count()).toBe(1)
      expect(await failed.innerText()).toContain('Delivery failed')
      expect(await delivered.innerText()).toContain('Delivered')
      await page.locator('[data-turn-process]').click()
      await page.setViewportSize({ width: 480, height: 900 })
      const row = page.locator('[data-presented-files-row]')
      await row.scrollIntoViewIfNeeded()
      for (const card of await row.getByRole('button').all()) {
        const bounds = await card.boundingBox()
        expect(bounds).not.toBeNull()
        expect(bounds!.x).toBeGreaterThanOrEqual(0)
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(480)
      }
    }
    const beforeDelete = (await opened()).length
    await unlink(join(cwd, 'report.txt'))
    const missing = page.waitForResponse(response => response.url().includes('/api/present.open?'))
    await page.locator('[data-presented-files-row]').getByRole('button', { name: 'More file actions for report.txt', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Open in default app', exact: true }).click()
    expect((await missing).status()).toBe(404)
    await page.getByText('Could not open. Click to retry.', { exact: true }).waitFor()
    expect(await opened()).toHaveLength(beforeDelete)
    expect(downloads).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
