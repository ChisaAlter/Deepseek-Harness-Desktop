/**
 * D5 measurement protocol for the shared review-diff renderer: the built
 * workspace-Diff surface is driven through the shipped-composition Web
 * scaffold while a deterministic `window.shell` stub serves fixed synthetic
 * Git payloads. Every sample boots a private scaffold world and a fresh
 * Chromium browser; warm figures come from same-page refreshes.
 */
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright'
import { describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from '../../apps/web/tests/scaffold.ts'
import { connectFreshWorkspace } from '../../apps/web/tests/support.ts'
import { FIXTURES, type DiffFile, type FixtureName } from './fixtures.ts'

/** Samples per scenario, per the D5 protocol's five-run rule. */
const SAMPLES = 5
/** D5 reference viewport: 1440×900 CSS pixels. */
const VIEWPORT = { width: 1440, height: 900 }
/** Same-file mode-switch iterations required by the protocol. */
const MODE_SWITCHES = 20
/** Hard requirement: every highlighting-related main-thread task stays under 50 ms. */
const HIGHLIGHT_TASK_BUDGET_MS = 50
/** Candidate budgets recorded by the plan; reported per sample, enforced only as findings. */
const CANDIDATE = { coldReadable: 1000, warmReadable: 300, largeReadable: 1000, input: 100 } as const
/** In-page names the renderer emits for observability. */
const SLICE_MEASURE = 'dsh.reviewDiff.slice'
const DISCARD_MARK = 'dsh.reviewDiff.discard'
const WORKER_MARK = 'dsh.reviewDiff.worker'
/** Raw trace destination inside the desktop adoption evidence dir. */
const TRACE_DIR = fileURLToPath(new URL('../../../../docs/superpowers/evidence/2026-09-25-upstream-adoption/', import.meta.url))

interface SliceEntry { readonly start: number; readonly duration: number }
interface LongTaskEntry { readonly start: number; readonly duration: number }

interface Sample {
  readonly coldReadable: number
  readonly warmReadable: number
  readonly highlightSettledCold: number
  readonly highlightSettledWarm: number
  readonly rowsCollapsed: number
  readonly rowsMounted: number
  readonly filesListed: number
  readonly slices: readonly SliceEntry[]
  readonly sliceMax: number
  readonly sliceCount: number
  readonly discards: number
  readonly longTasks: readonly LongTaskEntry[]
  readonly heapBaselineMb: number
  readonly heapPeakMb: number
  readonly heapAfterCloseMb: number
  readonly heapAfterReopenMb: number
  readonly reopenReadable: number
  readonly inputMs: number
  readonly modeSwitches: readonly number[]
  readonly noteKinds: readonly string[]
  readonly highlightSkippedNote: boolean
  readonly truncatedNote: boolean
  /** Highlight jobs the shared Worker completed — the shipped path's own evidence. */
  readonly workerJobs: number
  /** Worker-side tokenize durations per job (off-thread; evidence, not a main-thread budget). */
  readonly workerWorkMs: readonly number[]
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!
}

/** Two rAF callbacks include a rendering opportunity, not a GPU presentation timestamp. */
async function painted(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

/**
 * The diff body is readable once it draws a code row, a note, or a file row.
 * An unavailable verdict still resolves: the sample records it and fails loud.
 */
async function waitReadable(page: Page): Promise<boolean> {
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-diff-panel]')
    if (panel === null) return false
    if (panel.querySelector('[data-diff-unavailable]') !== null) return true
    return panel.querySelector('[data-diff-line], [data-diff-note], [data-disclosure-row]') !== null
  })
  return page.evaluate(() => document.querySelector('[data-diff-panel] [data-diff-unavailable]') !== null)
}

/** Heap in MiB after a forced collection, for close/recovery accounting. */
async function heapMb(cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage')
  const { metrics } = await cdp.send('Performance.getMetrics')
  const heap = metrics.find(metric => metric.name === 'JSHeapUsedSize')
  if (heap === undefined) throw new Error('Chromium heap metric missing')
  return heap.value / 1048576
}

/** Read the renderer's slice measures; each entry is one highlighting task span. */
function sliceEntries(page: Page): Promise<SliceEntry[]> {
  return page.evaluate(name =>
    globalThis.performance.getEntriesByName(name, 'measure')
      .map(entry => ({ start: entry.startTime, duration: entry.duration })), SLICE_MEASURE)
}

/** Worker-side tokenize durations reported per completed job (off-thread evidence). */
function workerMarks(page: Page): Promise<number[]> {
  return page.evaluate(name =>
    globalThis.performance.getEntriesByName(name, 'mark')
      .map(entry => Number((entry as PerformanceMark & { detail?: { workMs?: number } }).detail?.workMs ?? 0)), WORKER_MARK)
}

/** Count stale-work discard marks, summing the job count each mark reports. */
function discardCount(page: Page): Promise<number> {
  return page.evaluate(name =>
    globalThis.performance.getEntriesByName(name, 'mark')
      .reduce((sum, entry) => sum + Number((entry as PerformanceMark & { detail?: number }).detail ?? 0), 0), DISCARD_MARK)
}

/** Install the deterministic `window.shell` Git surface before any app code runs. */
async function installShell(context: BrowserContext, files: DiffFile[]): Promise<void> {
  const filesJson = JSON.stringify(files)
  const entriesJson = JSON.stringify(files.map(file => ({ path: file.path, xy: ' M' })))
  await context.addInitScript(({ filesJson, entriesJson }) => {
    const win = window as unknown as { shell?: Record<string, unknown> }
    win.shell = {
      gitStatus: () => Promise.resolve({ branch: 'main' }),
      gitDiff: () => Promise.resolve({ files: JSON.parse(filesJson), truncated: false }),
      gitStatusEntries: () => Promise.resolve({ ok: true, entries: JSON.parse(entriesJson) }),
      gitBranchList: () => Promise.resolve({ ok: true, branches: [{ name: 'main', isCurrent: true, isDefault: true }], defaultRef: 'main' }),
      gitStage: () => Promise.resolve({ ok: true }),
      gitUnstage: () => Promise.resolve({ ok: true }),
      gitDiscard: () => Promise.resolve({ ok: true }),
    }
  }, { filesJson, entriesJson })
}

/** Observe every >50 ms main-thread task for the lifetime of the page. */
async function watchLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const win = window as unknown as { __d5LongTasks?: { start: number; duration: number }[] }
    win.__d5LongTasks = []
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) win.__d5LongTasks!.push({ start: entry.startTime, duration: entry.duration })
    }).observe({ entryTypes: ['longtask'] })
  })
}

function longTasks(page: Page): Promise<LongTaskEntry[]> {
  return page.evaluate(() => (window as unknown as { __d5LongTasks?: LongTaskEntry[] }).__d5LongTasks ?? [])
}

/** Page-clock time at the moment of evaluation; anchors slice settle detection. */
async function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => globalThis.performance.now())
}

/**
 * Page-clock end of the latest highlight slice starting after `since`. Waits
 * while slices keep landing; returns -1 when none arrives inside `graceMs`
 * (a comparison with no highlightable language legitimately schedules none).
 */
async function waitSlicesAfter(page: Page, since: number, graceMs: number): Promise<number> {
  const deadline = performance.now() + 15_000
  let seen = -1
  let stableRounds = 0
  let emptyFor = 0
  while (performance.now() < deadline) {
    const slices = await sliceEntries(page)
    const fresh = slices.filter(entry => entry.start >= since)
    if (fresh.length === 0) {
      emptyFor += 120
      if (emptyFor >= graceMs) return -1
    } else {
      const latest = Math.max(...fresh.map(entry => entry.start + entry.duration))
      if (latest === seen) {
        stableRounds += 1
        if (stableRounds >= 2) return latest
      } else {
        seen = latest
        stableRounds = 0
      }
      emptyFor = 0
    }
    await new Promise(resolve => setTimeout(resolve, 120))
  }
  return seen
}

interface ScenarioOptions {
  /** Expand every collapsed file row and report both collapsed and mounted rows. */
  expandAll?: boolean
  /** Whether highlight jobs exist: gates the slice settle waits AND the worker-ran assertion. */
  expectSlices?: boolean
}

/**
 * Bring the right column's guide up: expand a collapsed rail, or open a guide
 * tab through the pane's add control when the column shows no guide.
 */
async function openGuide(page: Page): Promise<void> {
  const guide = page.locator('[data-sidebar-right-guide]')
  if (await guide.isVisible()) return
  const expandRail = page.locator('[data-sidebar-right-expand]')
  if (await expandRail.isVisible()) await expandRail.click()
  if (await guide.isVisible()) return
  const addTab = page.locator('[data-dockkit-add-tab]')
  if (await addTab.isVisible()) await addTab.click()
  await guide.waitFor({ state: 'visible' })
}

/**
 * One cold+warm sample against one private scaffold world: connect the
 * workspace, open the Diff tab cold, refresh warm, then close and reopen the
 * tab for heap recovery.
 */
async function runSample(fixture: FixtureName, options: ScenarioOptions = {}): Promise<{ sample: Sample; environment: Record<string, unknown> }> {
  const failures: unknown[] = []
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  const files = FIXTURES[fixture]()
  try {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: VIEWPORT, locale: 'en-US', timezoneId: 'Asia/Shanghai' })
    await installShell(context, files)
    const page = await context.newPage()
    const tripwire = watchConsole(page)
    page.setDefaultTimeout(30_000)
    const dpr = await page.evaluate(() => window.devicePixelRatio).catch(() => -1)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]')
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await watchLongTasks(page)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Performance.enable')
    const heapBaseline = await heapMb(cdp)

    await openGuide(page)
    const coldStart = performance.now()
    await page.locator('[data-sidebar-right-guide-entry="diff"]').click()
    const unavailable = await waitReadable(page)
    await painted(page)
    if (unavailable) failures.push(new Error('diff panel reported unavailable under the installed shell stub'))
    const coldReadable = performance.now() - coldStart
    const coldClickPageAt = await pageNow(page)
    const expectSlices = options.expectSlices ?? true
    const coldSlicesEnd = expectSlices ? await waitSlicesAfter(page, coldClickPageAt, 8000) : -1
    const highlightSettledCold = Math.max(0, coldSlicesEnd - coldClickPageAt)

    const warmClickPageAt = await pageNow(page)
    const warmStart = performance.now()
    await page.locator('[data-diff-panel]').getByRole('button', { name: 'Refresh', exact: true }).click()
    await painted(page)
    const warmReadable = performance.now() - warmStart
    const warmSlicesEnd = expectSlices ? await waitSlicesAfter(page, warmClickPageAt, 2500) : -1
    const highlightSettledWarm = Math.max(0, warmSlicesEnd - warmClickPageAt)

    const diffPanel = page.locator('[data-diff-panel]')
    const rowsCollapsed = await diffPanel.locator('[data-diff-line]').count()
    if (options.expandAll === true) {
      await diffPanel.getByRole('button', { name: 'Expand all', exact: true }).click()
      await painted(page)
    }
    const rowsMounted = await diffPanel.locator('[data-diff-line]').count()
    const filesListed = await diffPanel.locator('[data-disclosure-row]').count()
    const noteKinds = await diffPanel.locator('[data-diff-note]').evaluateAll(notes =>
      notes.map(note => note.getAttribute('data-diff-note') ?? ''))
    const highlightSkippedNote = await diffPanel.locator('[data-diff-highlight-skipped]').count() > 0
    // Panel-level truncation rides the generic note marker; ReviewDiff's own
    // budget cut adds `data-diff-truncated` when a consumer hands it too much.
    const truncatedNote = noteKinds.includes('truncated')
      || await diffPanel.locator('[data-diff-truncated]').count() > 0

    const modeSwitches: number[] = []
    for (let at = 0; at < MODE_SWITCHES; at += 1) {
      const tool = at % 2 === 0 ? 'split' : 'wrap'
      const start = performance.now()
      await diffPanel.locator(`[data-diff-tool="${tool}"]`).click()
      await painted(page)
      modeSwitches.push(performance.now() - start)
    }

    const composer = page.locator('[data-composer-input][contenteditable="true"]').last()
    let inputMs = -1
    if (await composer.count() > 0) {
      const start = performance.now()
      await composer.click()
      await page.keyboard.type('d5')
      inputMs = performance.now() - start
    }

    const slices = await sliceEntries(page)
    const workerWorkMs = await workerMarks(page)
    const heapPeak = await heapMb(cdp)

    const diffTab = page.locator('[data-rightbar-col] [data-dockkit-tab]').filter({ hasText: 'Diff' }).last()
    let reopenReadable = -1
    let heapAfterClose = heapPeak
    let heapAfterReopen = heapPeak
    if (await diffTab.count() > 0) {
      await diffTab.hover()
      await diffTab.locator('[data-dockkit-tab-close]').click()
      await painted(page)
      heapAfterClose = await heapMb(cdp)
      await openGuide(page)
      const reopenStart = performance.now()
      await page.locator('[data-sidebar-right-guide-entry="diff"]').click()
      if (await waitReadable(page)) failures.push(new Error('diff panel reported unavailable after reopen'))
      await painted(page)
      reopenReadable = performance.now() - reopenStart
      heapAfterReopen = await heapMb(cdp)
    }

    const sample: Sample = {
      coldReadable,
      warmReadable,
      highlightSettledCold,
      highlightSettledWarm,
      rowsCollapsed,
      rowsMounted,
      filesListed,
      slices,
      sliceMax: slices.reduce((max, entry) => Math.max(max, entry.duration), 0),
      sliceCount: slices.length,
      discards: await discardCount(page),
      longTasks: await longTasks(page),
      workerJobs: workerWorkMs.length,
      workerWorkMs,
      heapBaselineMb: heapBaseline,
      heapPeakMb: heapPeak,
      heapAfterCloseMb: heapAfterClose,
      heapAfterReopenMb: heapAfterReopen,
      reopenReadable,
      inputMs,
      modeSwitches,
      noteKinds,
      highlightSkippedNote,
      truncatedNote,
    }
    if (tripwire.pageErrors.length > 0) failures.push(new Error(`page errors: ${JSON.stringify(tripwire.pageErrors)}`))
    const environment = {
      viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
      devicePixelRatio: dpr,
      chromium: browser.version(),
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      cpu: cpus()[0]?.model ?? 'unknown',
      cores: cpus().length,
      ramGb: Math.round(totalmem() / 2 ** 30),
      desktopCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('../../..', import.meta.url)) }).toString().trim(),
      upstreamPin: '0.1.7-rc.2',
    }
    if (failures.length > 0) throw new AggregateError(failures, 'review-diff sample failed')
    return { sample, environment }
  } finally {
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length > 0) throw new AggregateError(failures, 'review-diff sample teardown failed')
  }
}

interface Verdict { readonly metric: string; readonly median: number; readonly budget: number; readonly ok: boolean }

function judge(metric: string, samples: readonly Sample[], pick: (sample: Sample) => number, budget: number): Verdict {
  const med = median(samples.map(pick))
  return { metric, median: med, budget, ok: med <= budget }
}

async function runScenario(fixture: FixtureName, options: ScenarioOptions = {}): Promise<{ samples: Sample[]; report: Record<string, unknown> }> {
  if (webSnapshotMode() !== 'replay') throw new Error('browser benchmarks require keyless replay mode')
  const samples: Sample[] = []
  let environment: Record<string, unknown> = {}
  for (let at = 0; at < SAMPLES; at += 1) {
    const { sample, environment: env } = await runSample(fixture, options)
    samples.push(sample)
    environment = env
    console.log(JSON.stringify({ benchmark: 'review-diff/sample', fixture, sample: at, ...sample }))
  }
  const allSlices = samples.flatMap(sample => sample.slices)
  const sliceViolations = allSlices.filter(entry => entry.duration >= HIGHLIGHT_TASK_BUDGET_MS)
  const coldBudget = fixture === 'single-1000' ? CANDIDATE.coldReadable : CANDIDATE.largeReadable
  const verdicts = [
    judge('coldReadable', samples, sample => sample.coldReadable, coldBudget),
    judge('warmReadable', samples, sample => sample.warmReadable, CANDIDATE.warmReadable),
    judge('input', samples, sample => sample.inputMs, CANDIDATE.input),
  ]
  const report: Record<string, unknown> = {
    benchmark: 'review-diff/aggregate',
    fixture,
    environment,
    samples: samples.length,
    sliceCount: allSlices.length,
    sliceMaxMs: allSlices.reduce((max, entry) => Math.max(max, entry.duration), 0),
    sliceViolations: sliceViolations.length,
    workerJobs: samples.map(sample => sample.workerJobs),
    workerWorkMaxMs: samples.reduce((max, sample) => Math.max(max, ...sample.workerWorkMs), 0),
    discards: samples.map(sample => sample.discards),
    rowsCollapsedMedian: median(samples.map(sample => sample.rowsCollapsed)),
    rowsMountedMedian: median(samples.map(sample => sample.rowsMounted)),
    heapPeakMedianMb: median(samples.map(sample => sample.heapPeakMb)),
    heapRecoveryMedianMb: median(samples.map(sample => sample.heapAfterCloseMb - sample.heapBaselineMb)),
    modeSwitchMedianMs: median(samples.flatMap(sample => sample.modeSwitches)),
    candidateVerdicts: verdicts,
  }
  console.log(JSON.stringify(report))
  await writeFile(
    join(TRACE_DIR, `review-diff-${fixture}.trace.json`),
    `${JSON.stringify({ fixture, environment, samples, report }, null, 2)}\n`,
  )
  // The hard requirement is the only gate: every measured highlighting task
  // stays under 50 ms. Candidate budgets are reported, not asserted. A
  // scenario that expects highlighting must show worker completions — without
  // one, an empty slice trace would pass the gate vacuously while the shipped
  // path never ran.
  if (options.expectSlices !== false) {
    for (const [at, sample] of samples.entries()) {
      expect(sample.workerJobs, `sample ${at}: highlight worker completions`).toBeGreaterThan(0)
    }
  }
  expect(sliceViolations, `highlighting tasks ≥${HIGHLIGHT_TASK_BUDGET_MS}ms`).toEqual([])
  return { samples, report }
}

describe('review-diff D5 protocol', () => {
  it('renders the 1000-line comparison inside the readability budgets', async () => {
    const { samples } = await runScenario('single-1000')
    expect(samples.every(sample => sample.rowsMounted > 900)).toBe(true)
  })
  it('bounds the 6000-line comparison at the render budget', async () => {
    const { samples } = await runScenario('single-6000')
    for (const sample of samples) {
      expect(sample.rowsMounted).toBeLessThanOrEqual(5000)
      expect(sample.truncatedNote).toBe(true)
    }
  })
  it('keeps the 100k-character line readable while skipping highlight', async () => {
    const { samples } = await runScenario('long-line-100k', { expectSlices: false })
    for (const sample of samples) {
      expect(sample.rowsMounted).toBe(4)
      expect(sample.highlightSkippedNote).toBe(true)
    }
  })
  it('mounts 100 files lazily and bounds expanded rows', async () => {
    const { samples } = await runScenario('files-100x200', { expandAll: true })
    for (const sample of samples) {
      expect(sample.filesListed).toBe(100)
      expect(sample.rowsCollapsed).toBe(0)
      expect(sample.rowsMounted).toBeLessThanOrEqual(5000)
      expect(sample.noteKinds).toContain('omitted')
    }
  })
  it('renders binary, renamed, pure-addition, and pure-deletion files', async () => {
    const checks: Record<FixtureName, (sample: Sample) => boolean> = {
      'binary': sample => sample.noteKinds.includes('binary'),
      'renamed': sample => sample.noteKinds.includes('renamed'),
      'pure-add': sample => sample.rowsMounted === 120,
      'pure-del': sample => sample.rowsMounted === 120,
      'single-1000': () => true,
      'single-6000': () => true,
      'long-line-100k': () => true,
      'files-100x200': () => true,
    }
    for (const fixture of ['binary', 'renamed', 'pure-add', 'pure-del'] as const) {
      // Binary carries no hunks; the rest produce highlightable sides.
      const { samples } = await runScenario(fixture, { expectSlices: fixture !== 'binary' })
      for (const sample of samples) expect(checks[fixture](sample), `${fixture} assertion`).toBe(true)
    }
  })
})
