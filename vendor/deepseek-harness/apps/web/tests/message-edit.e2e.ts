// Keyless, real-profile edit flow: first/later prompts, cancel, resend, repeat,
// reload, and model history all retain the original Session identity.
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { describe, expect, it, vi } from 'vitest'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ReplayOverrideDoc } from '@deepseek-ai/dsh-llm-replay'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold,
  renderSeedFixture, seedSession, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/message-edit', import.meta.url))
const MODE = webSnapshotMode()
const REVISED = 'Answer with EDITED instead.'
const REPEATED = 'Answer with EDITED AGAIN instead.'

function seed(turns: number): string {
  const session = Session.create(SessionId('fixture'))
  for (let turn = 1; turn <= turns; turn++) {
    session.append('turn/start', { turn })
    session.append('step/start', { turn, step: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `Original prompt ${turn}` }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('request/header', {
      header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
      reason: turn === 1 ? 'initial' : 'resume',
    })
    session.append('assistant/message', {
      turn, step: 1, message: createAssistantMessage({
        content: [{ type: 'text', text: `Original reply ${turn}` }],
        source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return renderSeedFixture(JSON.stringify({
    type: 'session', version: 0, id: '{{sessionId}}', createdAt: 0,
  }), session.snapshotEvents())
}

function replies(): ReplayOverrideDoc {
  return ['EDITED-REPLY', 'EDITED-AGAIN-REPLY'].map((text) => {
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'usage', usage: { inputTokens: 64, outputTokens: 8 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    return { kind: 'chunks' as const, chunks }
  })
}

describe('web e2e: editing stays in the current conversation', () => {
  it.skipIf(MODE === 'record').each([1, 2])('edits the latest of %i turns in place', async (turns) => {
    const replayDir = await mkdtemp(join(tmpdir(), 'dsh-message-edit-replay-'))
    const replayOverride = join(replayDir, 'replay.override.json')
    await writeFile(replayOverride, JSON.stringify(replies()))
    const scaffold = await launchWebScaffold({
      replayFixture: join(replayDir, 'override-only.jsonl'), replayOverride,
    })
    const browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const id = SessionId(`message-edit-${turns}-web-e2e`)
    let failed = false
    try {
      await seedSession(scaffold, seed(turns), id)
      const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
      await workspace.attachSession(id)
      await scaffold.ctx.sessionController.selectModel({
        sessionId: id, provider: 'deepseek-official', model: 'deepseek-v4-flash',
      })
      await scaffold.ctx.sessionController.rename({ sessionId: id, title: 'Message edit fixture' })
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      const group = page.getByRole('treeitem').first()
      await group.waitFor({ timeout: 30_000 })
      if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
      await page.getByText('Message edit fixture', { exact: true }).click()
      await expect.poll(() => page.getByText(`Original reply ${turns}`, { exact: true }).count(), { timeout: 20_000 }).toBe(1)
      const count = await page.getByRole('treeitem').count()
      const url = page.url()
      const read = async () => {
        using observed = await scaffold.ctx.sessionQuery.observeSession(id)
        return { header: observed.header, events: [...observed.events] }
      }
      const { header, events: originalLog } = await read()
      const initialAgentIds = scaffold.ctx.agents.list().map(agent => agent.id).sort()
      const prompts = vi.spyOn(scaffold.ctx.sessionController, 'prompt')
      const composer = page.locator('[data-composer-input]')
      const banner = page.locator('[data-edit-session]')
      const bubble = page.locator('[data-message-editing]')
      const pencil = page.getByRole('button', { name: 'Edit', exact: true })

      await composer.fill('saved draft')
      await pencil.click()
      await banner.waitFor()
      await expect.poll(() => composer.innerText()).toBe(`Original prompt ${turns}`)
      expect(scaffold.ctx.agents.list().map(agent => agent.id).sort()).toEqual(initialAgentIds)
      expect((await read()).events).toEqual(originalLog)
      expect(await bubble.count()).toBe(1)
      await page.keyboard.press('Escape')
      await expect.poll(() => banner.count()).toBe(0)
      await expect.poll(() => composer.innerText()).toBe('saved draft')
      expect(await composer.evaluate(el => el === document.activeElement)).toBe(true)

      await pencil.click()
      await bubble.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect.poll(() => banner.count()).toBe(0)
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Edit')
      await pencil.click()
      await banner.waitFor()
      const aria = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)).split(id).join('{{seededId}}')
      await compareOrRefreshGolden(join(SNAPSHOT_DIR, turns === 1 ? 'editor-first.expected.md' : 'editor.expected.md'), aria, MODE)

      for (const [prompt, reply] of [[REVISED, 'EDITED-REPLY'], [REPEATED, 'EDITED-AGAIN-REPLY']] as const) {
        await composer.fill(prompt)
        if (prompt === REPEATED) await composer.press('Enter')
        else await page.getByRole('button', { name: 'Send message', exact: true }).click()
        await expect.poll(() => prompts.mock.calls.length, { timeout: 5_000 }).toBe(prompt === REVISED ? 1 : 2)
        await expect.poll(() => page.getByText(reply, { exact: true }).count(), { timeout: 20_000 }).toBe(1)
        await expect.poll(() => banner.count()).toBe(0)
        expect(await page.getByText(`Original prompt ${turns}`, { exact: true }).count()).toBe(0)
        expect(await page.getByText(`Original reply ${turns}`, { exact: true }).count()).toBe(0)
        if (turns === 2) expect(await page.getByText('Original reply 1', { exact: true }).count()).toBe(1)
        expect(await page.getByRole('treeitem').count()).toBe(count)
        expect(page.url()).toBe(url)
        expect(scaffold.ctx.agents.list().map(agent => agent.id).sort()).toEqual([...new Set([...initialAgentIds, id])].sort())
        const agent = scaffold.ctx.agents.get(id)!
        expect(agent.session.header).toEqual(header)
        expect(agent.session.snapshotEvents().slice(0, originalLog.length)).toEqual(originalLog)
        const modelText = JSON.stringify(agent.session.deriveMessages())
        expect(modelText).toContain(prompt)
        expect(modelText).not.toContain(`Original prompt ${turns}`)
        expect(modelText).not.toContain(`Original reply ${turns}`)
        await expect.poll(() => composer.innerText()).toBe('saved draft')
        if (prompt === REVISED) {
          await expect.poll(() => pencil.getAttribute('aria-disabled')).toBeNull()
          await pencil.click()
          await banner.waitFor()
        }
      }
      expect(await page.getByText(REVISED, { exact: true }).count()).toBe(0)
      await page.reload({ waitUntil: 'load' })
      await expect.poll(() => page.getByText('EDITED-AGAIN-REPLY', { exact: true }).count(), { timeout: 20_000 }).toBe(1)
      expect(await page.getByText(`Original prompt ${turns}`, { exact: true }).count()).toBe(0)
      expect(await page.getByText(REVISED, { exact: true }).count()).toBe(0)
      expect(tripwire.pageErrors).toEqual([])
      await page.screenshot({ path: join(replayDir, `same-session-${turns}.png`), fullPage: true })
    } catch (error) {
      failed = true
      await saveFailureShot(page, `web-e2e-message-edit-${turns}`)
      throw error
    } finally {
      await browser.close()
      try {
        await scaffold.close()
      } catch (error) {
        // A failed UI assertion may leave replay calls unused; retain the first failure.
        if (!failed) throw error
      }
    }
  }, 120_000)
})
