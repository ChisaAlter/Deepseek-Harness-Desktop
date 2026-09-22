/** Blank Session reuse after a released plugin presentation through real Web + Host. */

import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterEach, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, readPersistedEvents, seedSession, watchConsole,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const WORKSPACE_MANIFEST = fileURLToPath(new URL(
  '../../../snapshots/web/workspace-management/snapshot.yml', import.meta.url,
))
const TITLE = '千咲'
const OWNER = 'dshbot'
const RELEASED_PRESENTATION_TITLE = 'Released plugin room'
const PROVIDER = 'blank-reuse-test'
const PROMPT = 'https://github.com/t59688/tunneldock 看看这个项目'
const REPLY = 'Blank Session test response.'
type EntryPoint = 'workspace' | 'no-directory'

/** Exercise a real first send without using credentials or an external model. */
class BlankReuseAdapter extends LlmAdapter {
  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: REPLY } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

interface ScenarioState {
  readonly historyId: SessionId
  readonly workspaceTitle: string
  readonly pinnedId: SessionId
  readonly releasedId: SessionId
  readonly historyEvents: readonly unknown[]
  readonly pinnedEvents: readonly unknown[]
  readonly releasedEvents: readonly unknown[]
}

/** Reuse the workspace-management seed through its authored manifest, read-only. */
async function readWorkspaceManagementSeed(): Promise<string> {
  const manifest = await readFile(WORKSPACE_MANIFEST, 'utf8')
  const source = /^\s+source:\s+(\S+)\s*$/mu.exec(manifest)?.[1]
  if (source === undefined) throw new Error('workspace-management snapshot has no session source')
  return await readFile(join(dirname(WORKSPACE_MANIFEST), source), 'utf8')
}

async function selectedSessionId(page: Page): Promise<string | undefined> {
  return await page.evaluate(() => {
    const raw = localStorage.getItem('dsh.sessions.current')
    if (raw === null) return undefined
    const value = JSON.parse(raw) as { sessionId?: unknown }
    return typeof value.sessionId === 'string' ? value.sessionId : undefined
  })
}

describe('web e2e: released plugin blank Session is never reused', () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  let tripwire: ReturnType<typeof watchConsole> | undefined

  afterEach(async () => {
    await browser?.close()
    browser = undefined
    page = undefined
    tripwire = undefined
    await scaffold?.close()
    scaffold = undefined
  })

  async function setup(entryPoint: EntryPoint): Promise<ScenarioState> {
    scaffold = await launchWebScaffold({})
    const host = scaffold.ctx
    host.effect(() => host.llm.registerAdapter([PROVIDER], new BlankReuseAdapter()), 'blank reuse test adapter')
    await host.agentDefaultModel.saveSelection({ provider: PROVIDER, model: 'reply' })
    const historyId = await seedSession(
      scaffold, await readWorkspaceManagementSeed(), `blank-session-reuse-${entryPoint}-history`,
    )
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    expect(workspace.sessionIds).toContain(historyId)

    const target = entryPoint === 'workspace'
      ? { workspaceId: workspace.id }
      : { cwd: scaffold.ctx.workspaceController.scratchCwd }
    const released = await scaffold.ctx.sessionController.create({
      ...target,
      presentation: { owner: OWNER, title: RELEASED_PRESENTATION_TITLE },
    })
    const releasedId = released.sessionId
    await scaffold.ctx.sessionController.setPresentation({ sessionId: releasedId, presentation: null })

    const pinned = await scaffold.ctx.sessionController.create({
      ...target,
      presentation: { owner: OWNER, title: TITLE },
    })
    const pinnedId = pinned.sessionId
    await scaffold.ctx.sessionController.rename({ sessionId: pinnedId, title: TITLE })
    await scaffold.ctx.sessionController.setPresentation({ sessionId: pinnedId, presentation: null })

    for (const id of [releasedId, pinnedId]) {
      const agent = scaffold.ctx.agents.get(id)
      if (agent === undefined) throw new Error(`plugin Session ${id} has no active Agent`)
      await scaffold.ctx.sessions.flush(agent.session)
    }
    const pinnedEvents = await readPersistedEvents(scaffold, pinnedId)
    const releasedEvents = await readPersistedEvents(scaffold, releasedId)
    const historyEvents = await readPersistedEvents(scaffold, historyId)
    const hasConversationHistory = (event: { type: string }): boolean => [
      'turn/start', 'system/message', 'user/message', 'assistant/message', 'tool/result',
    ].includes(event.type)
    expect(pinnedEvents.some(hasConversationHistory)).toBe(false)
    expect(releasedEvents.some(hasConversationHistory)).toBe(false)
    const pinReuse = await scaffold.ctx.sessionController.blankReuse(
      { sessionId: pinnedId }, new AbortController().signal,
    )
    const releasedReuse = await scaffold.ctx.sessionController.blankReuse(
      { sessionId: releasedId }, new AbortController().signal,
    )
    expect(pinReuse).toEqual({ reusable: false })
    expect(releasedReuse).toEqual({ reusable: false })
    for (const id of [pinnedId, releasedId]) {
      const agent = scaffold.ctx.agents.get(id)
      if (agent === undefined) throw new Error(`plugin Session ${id} has no active Agent`)
      expect(agent.session.header.parentSession).toBeUndefined()
      expect(agent.session.header.isSeeded).toBe(false)
      expect(agent.session.header.origin).toBeUndefined()
      expect(agent.session.inheritedEventCount).toBe(0)
    }
    const pinnedPresentations = pinnedEvents.filter(event => event.type === 'session/presentation')
    const pinnedTitles = pinnedEvents.filter(event => event.type === 'session/title')
    const releasedPresentations = releasedEvents.filter(event => event.type === 'session/presentation')
    const releasedTitles = releasedEvents.filter(event => event.type === 'session/title')
    expect(pinnedPresentations).toHaveLength(2)
    expect(pinnedTitles).toHaveLength(1)
    expect(releasedPresentations).toHaveLength(2)
    expect(releasedTitles).toHaveLength(0)
    expect(pinnedTitles[0]).toMatchObject({
      type: 'session/title', data: { title: TITLE, source: { kind: 'user' } },
    })
    expect(pinnedPresentations[0]).toMatchObject({
      type: 'session/presentation', data: { owner: OWNER, title: TITLE },
    })
    const lastPinnedPresentation = pinnedPresentations[pinnedPresentations.length - 1]
    expect(lastPinnedPresentation).toMatchObject({ type: 'session/presentation', data: null })
    expect(releasedPresentations[0]).toMatchObject({
      type: 'session/presentation', data: { owner: OWNER, title: RELEASED_PRESENTATION_TITLE },
    })
    const lastReleasedPresentation = releasedPresentations[releasedPresentations.length - 1]
    expect(lastReleasedPresentation).toMatchObject({ type: 'session/presentation', data: null })

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    // Resume the released blank as the current Session. Other blanks are
    // deliberately hidden by the sidebar, so selecting a hidden row is invalid.
    await page.addInitScript((id: string) => {
      if (localStorage.getItem('dsh.sessions.current') === null) {
        localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id }))
      }
    }, String(pinnedId))
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.locator('[role="treeitem"][aria-selected="true"]').waitFor({ timeout: 15_000 })
    expect(await selectedSessionId(page)).toBe(String(pinnedId))

    return {
      historyId,
      workspaceTitle: basename(scaffold.workspaceCwd),
      pinnedId,
      releasedId,
      historyEvents,
      pinnedEvents,
      releasedEvents,
    }
  }

  async function clickNewSession(entryPoint: EntryPoint, workspaceTitle: string): Promise<void> {
    const label = entryPoint === 'workspace' ? workspaceTitle : 'No workspace folder'
    const groupRow = page!.locator('[role="treeitem"][aria-expanded]')
      .filter({ has: page!.getByText(label, { exact: true }) }).first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    await groupRow.hover()
    await page!.getByRole('button', { name: `New session in ${label}`, exact: true }).click()
  }

  async function assertNewSessionAndReload(
    entryPoint: EntryPoint, state: ScenarioState, firstId: string,
  ): Promise<void> {
    expect(firstId).not.toBe(String(state.pinnedId))
    expect(firstId).not.toBe(String(state.releasedId))
    const selectedRow = page!.locator('[role="treeitem"][aria-selected="true"]')
    await expect.poll(() => selectedRow.count(), { timeout: 15_000 }).toBe(1)
    expect(await selectedRow.textContent()).not.toContain(TITLE)

    // A genuinely ordinary blank remains reusable on the next New Session.
    await clickNewSession(entryPoint, state.workspaceTitle)
    await expect.poll(() => selectedSessionId(page!), { timeout: 15_000 }).toBe(firstId)
    expect(await selectedRow.textContent()).not.toContain(TITLE)

    const warningStart = tripwire!.warnings.length
    await page!.reload({ waitUntil: 'load' })
    await page!.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await expect.poll(() => selectedSessionId(page!), { timeout: 15_000 }).toBe(firstId)
    acknowledgeReloadConnectionLoss(tripwire!, warningStart)
    await expect.poll(() => page!.locator('[role="treeitem"][aria-selected="true"]').count(), {
      timeout: 15_000,
    }).toBe(1)
    expect(await page!.locator('[role="treeitem"][aria-selected="true"]').textContent()).not.toContain(TITLE)
    expect(tripwire!.warnings).toEqual([])

    const composer = page!.locator('[data-composer-input][contenteditable="true"]')
    await composer.fill(PROMPT)
    await composer.press('Enter')
    await page!.getByText(REPLY, { exact: true }).waitFor({ timeout: 20_000 })
    const freshId = SessionId(firstId)
    await expect.poll(async () => {
      const events = await readPersistedEvents(scaffold!, freshId)
      return events.filter(event => event.type === 'user/message').map(event => event.data)
    }, { timeout: 15_000 }).toContainEqual(expect.objectContaining({
      content: expect.arrayContaining([{ type: 'text', text: PROMPT }]),
    }))
    await expect.poll(async () => {
      const events = await readPersistedEvents(scaffold!, freshId)
      return events.filter(event => event.type === 'assistant/message').map(event => event.data)
    }, { timeout: 15_000 }).toContainEqual(expect.objectContaining({
      message: expect.objectContaining({
        content: expect.arrayContaining([{ type: 'text', text: REPLY }]),
      }),
    }))
    await expect.poll(async () => {
      const events = await readPersistedEvents(scaffold!, freshId)
      return events.filter(event => event.type === 'session/title').map(event => event.data)
    }, { timeout: 15_000 }).toContainEqual(expect.objectContaining({
      title: expect.stringContaining('tunneldock'), source: { kind: 'fallback' },
    }))
    expect(await selectedSessionId(page!)).toBe(firstId)
    expect(await page!.locator('[role="treeitem"][aria-selected="true"]').textContent()).not.toContain(TITLE)
  }

  async function waitForNewSessionId(state: ScenarioState): Promise<string> {
    const excluded = new Set([
      String(state.historyId), String(state.pinnedId), String(state.releasedId),
    ])
    await expect.poll(async () => {
      const id = await selectedSessionId(page!)
      return id === undefined || excluded.has(id) ? undefined : id
    }, { timeout: 15_000 }).toMatch(/.+/)
    const id = await selectedSessionId(page!)
    if (id === undefined || excluded.has(id)) {
      throw new Error('New Session action did not select a fresh Session')
    }
    return id
  }

  it('creates a fresh Workspace Session after a released plugin title pin', async () => {
    onTestFailed(() => page === undefined ? undefined : saveFailureShot(page, 'web-e2e-blank-session-reuse-workspace'))
    const state = await setup('workspace')
    const beforePinned = await readPersistedEvents(scaffold!, state.pinnedId)
    const beforeReleased = await readPersistedEvents(scaffold!, state.releasedId)
    await clickNewSession('workspace', state.workspaceTitle)
    const firstId = await waitForNewSessionId(state)
    await assertNewSessionAndReload('workspace', state, firstId)
    expect(await readPersistedEvents(scaffold!, state.historyId)).toEqual(state.historyEvents)
    expect(await readPersistedEvents(scaffold!, state.pinnedId)).toEqual(beforePinned)
    expect(await readPersistedEvents(scaffold!, state.releasedId)).toEqual(beforeReleased)
    expect(await readPersistedEvents(scaffold!, state.pinnedId)).toEqual(state.pinnedEvents)
    expect(await readPersistedEvents(scaffold!, state.releasedId)).toEqual(state.releasedEvents)
    expect(tripwire!.pageErrors).toEqual([])
  }, 90_000)

  it('creates a fresh no-directory Session after a released plugin title pin', async () => {
    onTestFailed(() => page === undefined ? undefined : saveFailureShot(page, 'web-e2e-blank-session-reuse-no-directory'))
    const state = await setup('no-directory')
    const beforePinned = await readPersistedEvents(scaffold!, state.pinnedId)
    const beforeReleased = await readPersistedEvents(scaffold!, state.releasedId)
    await clickNewSession('no-directory', state.workspaceTitle)
    const firstId = await waitForNewSessionId(state)
    await assertNewSessionAndReload('no-directory', state, firstId)
    expect(await readPersistedEvents(scaffold!, state.historyId)).toEqual(state.historyEvents)
    expect(await readPersistedEvents(scaffold!, state.pinnedId)).toEqual(beforePinned)
    expect(await readPersistedEvents(scaffold!, state.releasedId)).toEqual(beforeReleased)
    expect(await readPersistedEvents(scaffold!, state.pinnedId)).toEqual(state.pinnedEvents)
    expect(await readPersistedEvents(scaffold!, state.releasedId)).toEqual(state.releasedEvents)
    expect(tripwire!.pageErrors).toEqual([])
  }, 90_000)
})
