/** Browser dictation submits only reviewed text through the ordinary recorded Session flow. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { SpeechInput, SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import {
  captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, webSnapshotMode, watchConsole,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const fixture = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.v3.jsonl', import.meta.url))
const expected = fileURLToPath(new URL('../../../snapshots/web/voice-input/ui.expected.md', import.meta.url))
const interruptedExpected = fileURLToPath(new URL('../../../snapshots/web/voice-input/interrupted.expected.md', import.meta.url))
const recordingExpected = fileURLToPath(new URL('../../../snapshots/web/voice-input/recording.expected.md', import.meta.url))
const bundle = fileURLToPath(new URL('../../../packages/experimental/voice-input-bundle', import.meta.url))

it.skipIf(webSnapshotMode() === 'record')('records from cached standby and submits only the reviewed transcript through Session replay', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-voice-browser-'))
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally {
      try { await resources.scaffold?.close() } finally { await rm(scratch, { recursive: true, force: true }) }
    }
  })
  const overlay = join(scratch, 'voice.patch.yml')
  await writeFile(overlay, '- id: speech-to-text-sensevoice\n  disabled: true\n')
  const prompt = fixtureUserPrompts(await readFile(fixture, 'utf8'))[0]!
  const prefix = 'Use the bash tool to '
  const scaffold = await launchWebScaffold({ profile: { packages: [{ dir: bundle, enabled: true }] },
    extraOverlayPath: overlay, replayFixture: fixture, compareReplaySession: 'read-only',
  })
  resources.scaffold = scaffold
  const recognize = vi.fn(async (input: SpeechInput) => {
    expect(Buffer.from(input.audio).subarray(0, 4).toString()).toBe('RIFF')
    expect(input.audio.byteLength).toBeGreaterThan(44)
    return { text: prompt.slice(prefix.length), audioSeconds: 1, inferenceSeconds: 0.1 }
  })
  await scaffold.ctx.plugin({ inject: ['speechToText'], apply(ctx) {
    ctx.effect(() => ctx.speechToText.register({
      info: { id: 'sensevoice-local' as SpeechProviderId, name: 'Recorded recognizer', location: 'host-local', languages: ['auto'] },
      preparation: {
        snapshot: () => ({ phase: 'standby' }), subscribe: () => () => {},
        prepare: () => { throw new Error('Cached resources must allow recording without preparation') },
        cancel: async () => {},
      },
      transcribe: recognize,
    }))
  } })
  let messages = 0
  scaffold.ctx.on('session/event', (_session, event) => {
    if (event.type === 'user/message' && event.data.source.kind === 'user') messages++
  })
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  resources.browser = browser
  const page = await newEnglishPage(browser), tripwire = watchConsole(page)
  await page.addInitScript(() => {
    const holder = window as Window & { voiceTestRecorder?: MediaRecorder }
    const NativeRecorder = window.MediaRecorder
    window.MediaRecorder = class extends NativeRecorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) { super(stream, options); holder.voiceTestRecorder = this }
    }
  })
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const input = page.locator('[data-composer-input]'), mic = page.getByRole('button', { name: 'Start recording', exact: true })
  await mic.waitFor()
  const micBox = await mic.boundingBox(), modelBox = await page.getByRole('button', { name: /^Select model, current/ }).boundingBox()
  const sendBox = await page.getByRole('button', { name: 'Send message', exact: true }).boundingBox()
  expect(micBox!.x).toBeGreaterThan(modelBox!.x)
  expect(micBox!.x).toBeLessThan(sendBox!.x)
  await input.fill(prefix)
  await mic.click()
  await page.getByRole('button', { name: 'Stop and transcribe', exact: true }).waitFor()
  await compareOrRefreshGolden(recordingExpected,
    await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd), webSnapshotMode())
  expect(await page.getByRole('dialog').count()).toBe(0)
  // Controlled fake microphone audio occupies this recording interval; it is not a readiness wait.
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Stop and transcribe', exact: true }).click()
  await expect.poll(() => input.innerText()).toBe(prompt)
  expect(recognize).toHaveBeenCalledOnce()
  expect(messages).toBe(0)
  await compareOrRefreshGolden(expected, await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd), webSnapshotMode())
  const settled = scaffold.whenTurnSettled()
  await input.press('Enter')
  await settled
  await page.getByText('DONE', { exact: true }).waitFor()
  const meter = page.getByRole('button', { name: /% of context used/ })
  await meter.waitFor()
  for (const width of [1280, 420]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(async () => {
      const micRect = await mic.boundingBox(), meterRect = await meter.boundingBox()
      return micRect !== null && meterRect !== null && meterRect.y >= micRect.y + micRect.height
    }).toBe(true)
    await meter.click()
    await page.getByRole('dialog', { name: 'of context used', exact: true }).waitFor()
    await page.keyboard.press('Escape')
  }
  await mic.hover()
  await page.getByRole('tooltip', { name: 'Dictate', exact: true }).waitFor()
  const controlBackground = await page.getByRole('button', { name: 'Add files or run commands', exact: true })
    .evaluate(element => getComputedStyle(element).backgroundColor)
  await mic.click()
  const stop = page.getByRole('button', { name: 'Stop and transcribe', exact: true })
  await stop.waitFor()
  for (const width of [1280, 420]) {
    await page.setViewportSize({ width, height: 900 })
    const waveformBox = await page.getByRole('img', { name: 'Recording…', exact: true }).boundingBox()
    const stopBox = await stop.boundingBox(), cancelBox = await page.getByRole('button', { name: 'Cancel', exact: true }).boundingBox()
    expect(waveformBox!.height).toBeLessThanOrEqual(Math.min(stopBox!.height, cancelBox!.height))
  }
  await input.hover()
  expect(await meter.isVisible()).toBe(false)
  expect(await stop.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(controlBackground)
  expect(await page.getByRole('button', { name: 'Cancel', exact: true })
    .evaluate(element => getComputedStyle(element).backgroundColor)).toBe(controlBackground)
  await page.keyboard.press('Escape')
  await mic.waitFor()
  await meter.waitFor()
  await meter.click()
  await page.getByRole('dialog', { name: 'of context used', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await mic.click()
  await stop.waitFor()
  await page.evaluate(() => {
    const recorder = (window as Window & { voiceTestRecorder?: MediaRecorder }).voiceTestRecorder
    if (!recorder) throw new Error('No active test microphone')
    recorder.dispatchEvent(new Event('error'))
  })
  await page.getByRole('button', { name: 'Record again', exact: true }).waitFor()
  expect(await stop.count()).toBe(0)
  await compareOrRefreshGolden(interruptedExpected,
    await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd), webSnapshotMode())
  expect(recognize).toHaveBeenCalledOnce()
  await page.getByRole('button', { name: 'Record again', exact: true }).click()
  await stop.waitFor()
  await page.keyboard.press('Escape')
  expect(messages).toBe(1)
  expect(tripwire.pageErrors).toEqual([])
}, 120_000)
