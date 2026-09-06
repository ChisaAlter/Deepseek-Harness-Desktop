// Real-profile first-send geometry, including the frames before Host admission.
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { describe, expect, it, vi } from 'vitest'
import {
  compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const EXPECTED = fileURLToPath(new URL('./expected/composer-draft-transition/geometry.expected.md', import.meta.url))
const CASES = [
  { name: 'desktop-click', width: 1680, height: 1000, reduced: false, enter: false, lines: 1 },
  { name: 'desktop-reduced', width: 1680, height: 1000, reduced: true, enter: true, lines: 1 },
  { name: 'mobile-enter', width: 390, height: 844, reduced: false, enter: true, lines: 1 },
  { name: 'desktop-multiline', width: 1680, height: 1000, reduced: false, enter: true, lines: 5 },
] as const

describe('web e2e: draft composer transition', () => {
  it.skipIf(MODE === 'record').each(CASES)('$name: keeps first-send geometry continuous', async (scenario) => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-draft-transition-'))
    const replayOverride = join(dir, 'replay.override.json')
    await writeFile(replayOverride, JSON.stringify(['TRANSITION-REPLY', 'SECOND-REPLY'].map(text => ({ kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text },
      { type: 'block-end', index: 0, block: { type: 'text', text } },
      { type: 'finish', reason: { kind: 'stop' } },
    ] }))))
    const scaffold = await launchWebScaffold({
      replayFixture: join(dir, 'override-only.jsonl'), replayOverride,
    })
    const browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    let failed = false
    try {
      await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
      const prompt = scaffold.ctx.sessionController.prompt.bind(scaffold.ctx.sessionController)
      vi.spyOn(scaffold.ctx.sessionController, 'prompt').mockImplementation(async (...args) => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return prompt(...args)
      })
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.locator('[data-phase="hero"] [data-composer-input][contenteditable="true"]')
        .waitFor({ timeout: 30_000 })
      await page.getByRole('button', { name: /Select model/ }).click()
      await page.getByRole('menuitem').filter({ hasText: 'Model' }).click()
      await page.getByRole('menuitemradio').filter({ hasText: 'DeepSeek-V4-Flash' }).click()
      await page.setViewportSize({ width: scenario.width, height: scenario.height })
      await page.emulateMedia({ reducedMotion: scenario.reduced ? 'reduce' : 'no-preference' })
      const composer = page.locator('[data-composer-input]')
      await page.locator('[data-phase="hero"] [data-composer-input][contenteditable="true"]')
        .waitFor({ timeout: 30_000 })
      await composer.fill(Array.from({ length: scenario.lines }, () => 'Respond with TRANSITION-REPLY.').join('\n'))
      // Await the sidebar track and the final draft size before sampling.
      await composer.evaluate(async (input) => {
        let previous = input.getBoundingClientRect().top
        let stable = 0
        while (stable < 6) {
          await new Promise<void>(resolve => requestAnimationFrame(() => { resolve() }))
          const top = input.getBoundingClientRect().top
          stable = Math.abs(top - previous) < 0.01 ? stable + 1 : 0
          previous = top
        }
      })
      const capture = page.evaluate(async () => {
        const card = document.querySelector<HTMLElement>('[data-composer-card]')!
        const input = document.querySelector<HTMLElement>('[data-composer-input]')!
        const host = document.querySelector<HTMLElement>('[data-conversation-scroll]')!
        const measure = () => {
          const rect = card.getBoundingClientRect()
          return {
            top: rect.top, bottom: rect.bottom, height: rect.height,
            phase: card.closest('[data-phase]')?.getAttribute('data-phase'),
            sameInput: document.querySelector('[data-composer-input]') === input,
            scrollTop: host.scrollTop,
            entering: card.closest('[data-composer-entering]') !== null,
            time: performance.now(),
          }
        }
        const samples = [measure()]
        for (let frame = 0; frame < 90; frame++) {
          await new Promise<void>(resolve => requestAnimationFrame(() => { resolve() }))
          samples.push(measure())
        }
        return samples
      })
      if (scenario.enter) await composer.press('Enter')
      else await page.getByRole('button', { name: 'Send message', exact: true }).click()
      const frames = await capture
      await writeFile(join(dir, 'frames.json'), JSON.stringify(frames, null, 2))
      await page.screenshot({ path: join(dir, 'settled.png') })
      const last = frames.at(-1)!
      await page.getByText('TRANSITION-REPLY', { exact: true }).waitFor({ timeout: 20_000 })
      expect(frames.every(frame => frame.sameInput)).toBe(true)
      expect(last.phase).toBe('active')
      expect(last.top - frames[0]!.top).toBeGreaterThan(20)
      expect(Math.max(...frames.map(frame => frame.top)) - last.top).toBeLessThanOrEqual(1)
      expect(Math.max(...frames.slice(1).map((frame, index) =>
        frames[index]!.top - frame.top))).toBeLessThanOrEqual(1)
      const intermediate = frames.some(frame => frame.phase === 'active'
        && frame.top > frames[0]!.top + 1 && frame.top < last.top - 1)
      expect(intermediate).toBe(!scenario.reduced)
      expect(last.bottom).toBeLessThanOrEqual(scenario.height)
      expect(last.entering).toBe(false)
      await composer.fill('Respond with SECOND-REPLY.')
      await composer.press('Enter')
      await page.getByText('SECOND-REPLY', { exact: true }).waitFor({ timeout: 20_000 })
      expect(await page.locator('[data-composer-entering]').count()).toBe(0)
      const secondTop = await page.locator('[data-composer-card]').evaluate(card => card.getBoundingClientRect().top)
      expect(secondTop).toBe(last.top)
      await compareOrRefreshGolden(EXPECTED, [
        '# First draft submission geometry', '',
        '- Editor DOM is retained: true',
        '- Card overshoots its settled position: false',
        '- Normal motion includes intermediate positions: true',
        '- Reduced motion settles without intermediate positions: true',
        '- Subsequent sends retain the dock position: true',
        '- Card stays inside the viewport: true',
      ].join('\n'), MODE)
      expect(tripwire.pageErrors).toEqual([])
    } catch (error) {
      failed = true
      await saveFailureShot(page, 'web-e2e-draft-transition')
      throw error
    } finally {
      await browser.close()
      try { await scaffold.close() } catch (error) { if (!failed) throw error }
    }
  }, 120_000)
})
