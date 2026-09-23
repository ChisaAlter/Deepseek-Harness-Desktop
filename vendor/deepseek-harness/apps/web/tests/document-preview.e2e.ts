/** Keyless document-preview smoke through a real Session, Files tab, shipped renderers, and the default-application controls. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { nativeFileManager } from '@deepseek-ai/dsh-native-command'
import { delimiter, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { realOfficeBytes } from './office-fixture.ts'
import { excelFixture, excelHtmlFixture, excelHtmlText, meetingMinutesFixture } from '../../../packages/client/ui-sidebar-documentpreview/tests/excel-fixture.ts'
import { excelDrawingFixture } from '../../../packages/client/ui-sidebar-documentpreview/tests/excel-drawing-fixture.ts'
import { xlsFixture } from '../../../packages/client/ui-sidebar-documentpreview/tests/xls-fixture.ts'
import { pdfFixture, selectionPdfFixture } from '../../../packages/client/ui-sidebar-documentpreview/tests/pdf-fixture.ts'
import { assertFixtureInventory, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { openSettings, connectFreshWorkspace, newEnglishPage, saveFailureShot, scrollIntoView } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.v3.jsonl', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/document-preview', import.meta.url))
const EXPECTED = join(SNAPSHOT_DIR, 'document.expected.md')
const PAGING_PATCH = join(SNAPSHOT_DIR, 'paging.patch.yml')
const PAGE_LINES = 64
const SHOT_DIR = fileURLToPath(new URL('../../../.artifacts/screenshots/0908-document-preview', import.meta.url))
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'
const MODE = webSnapshotMode()
/** The stubbed opener runs as a POSIX script; Windows and WSL keep their real file associations out of the lane. */
const STUB_OPENER = nativeFileManager() !== 'explorer'
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

/** Successful render evidence stays outside the committed snapshot inventory. */
async function successShot(page: Page, name: string): Promise<void> {
  await mkdir(SHOT_DIR, { recursive: true })
  await page.screenshot({ path: join(SHOT_DIR, `${name}-${MODE}-${process.pid}.png`), fullPage: true })
}

/** Exercise native browser selection and copy, including the text overlay's canvas alignment. */
async function copyPdfText(page: Page, preview: Locator, expected: string): Promise<void> {
  const text = preview.locator('[data-pdf-text] span:not(.markedContent)').filter({ hasText: expected }).first()
  await text.waitFor({ state: 'visible' })
  await expect.poll(() => text.evaluate(node => getComputedStyle(node).userSelect)).toBe('text')
  await text.click({ clickCount: 3 })
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim())).toBe(expected)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin })
  await page.keyboard.press('ControlOrMeta+C')
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).trim())).toBe(expected)
  await expect.poll(() => preview.locator('[data-pdf-page]').first().evaluate((node) => {
    const canvas = node.querySelector('canvas')!.getBoundingClientRect()
    const layer = node.querySelector('.textLayer')!.getBoundingClientRect()
    return Math.max(Math.abs(layer.width - canvas.width), Math.abs(layer.height - canvas.height),
      Math.abs(layer.left - canvas.left), Math.abs(layer.top - canvas.top))
  })).toBeLessThan(1)
}

/** Trigger the document owner's native scroll handler after a real first page overflows. */
async function scrollForNextPage(body: Locator): Promise<void> {
  await body.evaluate((node) => {
    if (node.scrollHeight <= node.clientHeight) throw new Error('paging fixture does not overflow the document body')
    node.scrollTop = node.scrollHeight
  })
}

/** Read the solid vector fill away from antialiased page edges. */
async function canvasColor(canvas: Locator): Promise<string> {
  return await canvas.evaluate((node) => {
    const surface = node as HTMLCanvasElement
    const context = surface.getContext('2d')
    if (context === null) throw new Error('PDF canvas has no 2D context')
    const pixel = context.getImageData(Math.floor(surface.width / 2), Math.floor(surface.height / 2), 1, 1).data
    if (Number(pixel[3]) !== 255) return 'transparent'
    if (Number(pixel[0]) - Number(pixel[2]) > 150) return 'red'
    if (Number(pixel[2]) - Number(pixel[0]) > 150) return 'blue'
    return 'other'
  })
}

/** Select a workspace file through the Files tab and wait for its preview identity. */
async function openPreviewFile(column: Locator, filesTab: Locator, preview: Locator, name: string): Promise<void> {
  await filesTab.click()
  await column.locator('[data-files-entry="file"]').getByRole('button', { name, exact: true }).click()
  await expect.poll(async () => (await preview.getAttribute('data-textpreview-url'))?.endsWith(`/${name}`)).toBe(true)
}

/** Move into the bottom reveal zone and wait for the shared zoom control. */
async function revealDocumentZoom(page: Page, preview: Locator): Promise<Locator> {
  const frame = preview.locator('[data-document-zoom-frame]')
  const bounds = await frame.boundingBox()
  if (bounds === null) throw new Error('document zoom frame has no bounds')
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height - 8)
  const controls = preview.locator('[data-document-zoom-controls]')
  await expect.poll(() => controls.getAttribute('data-document-zoom-visible')).toBe('true')
  return preview.getByRole('button', { name: 'Choose zoom', exact: true })
}

/** Leave the bottom reveal zone and wait for the delayed dismissal. */
async function hideDocumentZoom(page: Page, preview: Locator): Promise<void> {
  const frame = preview.locator('[data-document-zoom-frame]')
  const bounds = await frame.boundingBox()
  if (bounds === null) throw new Error('document zoom frame has no bounds')
  await page.mouse.move(bounds.x + 8, bounds.y + 8)
  await expect.poll(() => preview.locator('[data-document-zoom-controls]').getAttribute('data-document-zoom-visible')).toBeNull()
}

it.skipIf(MODE === 'record')('resizes the spreadsheet canvas with its pane while retaining the selected cell', async () => {
  const scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 5, compareReplaySession: false })
  let browser: Browser | undefined
  try {
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    onTestFailed(async () => { await saveFailureShot(page, `screenshots/0908-document-preview/excel-resize-${process.pid}`) })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill(PROMPT)
    await input.press('Enter')
    const sessionId = await settled
    const cwd = scaffold.ctx.agents.get(sessionId)?.session.header.cwd
    if (cwd === undefined) throw new Error('settled Session has no workspace cwd')
    await writeFile(join(cwd, 'budget.xlsx'), await excelFixture())
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor()
    const column = page.locator('[data-rightbar-col]')
    await page.locator('[data-sidebar-right-expand]').click()
    await column.locator('[data-sidebar-right-guide-entry="files"]').click()
    await column.locator('[data-files-state="tree"]').waitFor({ state: 'visible' })
    await column.locator('[data-files-entry="file"]').getByRole('button', { name: 'budget.xlsx', exact: true }).click()
    const excel = column.locator('[data-excel-preview]')
    await excel.locator('.luckysheet-sheets-item-name').getByText('公式与格式', { exact: true }).click()
    await excel.locator('.fortune-sheet-overlay').click({ position: { x: 140, y: 30 } })
    const formula = excel.locator('.fortune-fx-input')
    await expect.poll(() => formula.innerText()).toBe('46281')
    const canvas = excel.locator('canvas').first()
    const originalCanvas = await canvas.elementHandle()
    const original = await canvas.boundingBox()
    if (original === null || originalCanvas === null) throw new Error('spreadsheet canvas is unavailable')
    const panel = page.locator('[data-sidebar-right-panel]')
    const panelBounds = await panel.boundingBox()
    if (panelBounds === null) throw new Error('sidebar panel is unavailable')
    const viewport = page.viewportSize()
    const layout = await page.addStyleTag({ content: `[data-sidebar-right-panel] { width: ${panelBounds.width + 160}px !important; }` })
    await expect.poll(async () => Math.round((await canvas.boundingBox())!.width - original.width)).toBe(160)
    await expect.poll(() => formula.innerText()).toBe('46281')
    expect(await originalCanvas.evaluate(node => node.isConnected)).toBe(true)
    expect(page.viewportSize()).toEqual(viewport)
    await successShot(page, 'excel-resize-wide')
    await layout.evaluate((node) => { node.textContent = '' })
    await expect.poll(async () => Math.round((await canvas.boundingBox())!.width)).toBe(Math.round(original.width))
    expect(await formula.innerText()).toBe('46281')
    await successShot(page, 'excel-resize-restored')
    await originalCanvas.dispose()
  } finally {
    try { await browser?.close() } finally { await scaffold.close() }
  }
})

describe.skipIf(MODE === 'record')('web e2e: document preview through Files', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let outsideRoot: string | undefined
  let nativeRoot: string | undefined
  let openLog = ''
  const opened = async (): Promise<Array<{ path: string; action: 'open' | 'reveal' | 'application' }>> =>
    (await readFile(openLog, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line) as { path: string; action: 'open' | 'reveal' | 'application' })

  beforeAll(async () => {
    outsideRoot = await mkdtemp(join(tmpdir(), 'dsh-preview-outside-'))
    if (STUB_OPENER) {
      // Exercise the built Host through its actual OS command, replacing only the desktop application.
      nativeRoot = await mkdtemp(join(tmpdir(), 'dsh-preview-native-'))
      openLog = join(nativeRoot, 'opened.jsonl')
      await writeFile(openLog, '')
      const command = process.platform === 'darwin' ? 'open' : 'xdg-open'
      await writeFile(join(nativeRoot, command), `#!/usr/bin/env node
const fs = require('node:fs');
const path = process.argv[2] === '-a' ? process.argv[4] : process.argv[2] === '-R' ? process.argv[3] : process.argv[2];
const action = process.argv[2] === '-a' ? 'application' : process.argv[2] === '-R' || fs.statSync(path).isDirectory() ? 'reveal' : 'open';
fs.appendFileSync(${JSON.stringify(openLog)}, JSON.stringify({ path, action }) + '\\n');
`, { mode: 0o700 })
      if (process.platform === 'darwin') {
        const apps = [
          { id: '/Applications/Test Player.app', name: 'Test Player', default: true, icon: `data:image/png;base64,${TINY_PNG.toString('base64')}` },
          { id: '/Applications/Other Player.app', name: 'Other Player', default: false, icon: null },
        ]
        await writeFile(join(nativeRoot, 'osascript'), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(apps))});\n`, { mode: 0o700 })
      }
      if (process.platform === 'linux') {
        const data = join(nativeRoot, 'data')
        await mkdir(join(data, 'applications'), { recursive: true })
        const icon = join(nativeRoot, 'icon.png')
        await writeFile(icon, TINY_PNG)
        await writeFile(join(data, 'applications', 'test.desktop'), `[Desktop Entry]\nName=Test Player\nIcon=${icon}\n`)
        await writeFile(join(data, 'applications', 'other.desktop'), '[Desktop Entry]\nName=Other Player\n')
        await writeFile(join(nativeRoot, 'gio'), `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv[2] === 'info') process.stdout.write('standard::content-type: video/mp4');
else if (process.argv[2] === 'mime') process.stdout.write('Default application for video/mp4: test.desktop\\nRegistered applications:\\n  test.desktop\\n  other.desktop\\n');
else if (process.argv[2] === 'launch') fs.appendFileSync(${JSON.stringify(openLog)}, JSON.stringify({ path: process.argv[4], action: 'application' }) + '\\n');
else process.exit(1);
`, { mode: 0o700 })
        vi.stubEnv('XDG_DATA_HOME', data)
        vi.stubEnv('XDG_DATA_DIRS', '')
      }
      vi.stubEnv('PATH', `${nativeRoot}${delimiter}${process.env.PATH ?? ''}`)
    }
    // The Open In rows carry the default-application controls; the SSH marker
    // keeps the host's application catalog empty, so the Session-header split
    // button stays off every platform while the pinned desktop serves the file controls.
    scaffold = await launchWebScaffold({
      developerTools: false, replayFixture: FIXTURE, paceMs: 5, compareReplaySession: false, extraOverlayPath: [PAGING_PATCH, fileURLToPath(new URL('./fixtures/native-open-on.patch.yml', import.meta.url))],
      openInAppEnvironment: createLaunchEnvironmentSnapshot([{ source: 'process', values: { SSH_CONNECTION: '10.0.0.2 55000 10.0.0.9 22' } }]),
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  })

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      try {
        await scaffold?.close()
      } finally {
        vi.unstubAllEnvs()
        if (outsideRoot !== undefined) await rm(outsideRoot, { recursive: true, force: true })
        if (nativeRoot !== undefined) await rm(nativeRoot, { recursive: true, force: true })
      }
    }
  })

  it('opens text, isolated HTML, width-fitted images, and rendered PDF from the Session workspace', async () => {
    onTestFailed(async () => {
      await mkdir(SHOT_DIR, { recursive: true })
      await saveFailureShot(page, `screenshots/0908-document-preview/smoke-${process.pid}`)
    })
    expect(await page.locator('[data-slot="conversation.hero.agentPreset"] button').count()).toBe(0)
    expect(scaffold.ctx.settings.describe().find(row => row.ns === 'ui-settings')?.value).toEqual({ enabled: false })
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill(PROMPT)
    await input.press('Enter')
    const sessionId = await settled
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    expect(await page.getByRole('tablist').count()).toBe(0)
    const cwd = scaffold.ctx.agents.get(sessionId)?.session.header.cwd
    if (cwd === undefined) throw new Error('settled Session has no workspace cwd')
    if (outsideRoot === undefined) throw new Error('outside fixture directory is unavailable')
    const outsideScript = join(outsideRoot, 'outside.js')
    const outsideReference = relative(cwd, outsideScript).replace(/\\/g, '/')
    let previewNetworkRequests = 0
    await page.route('https://preview.invalid/developer-tools.png', async (route) => {
      previewNetworkRequests += 1
      await route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG })
    })
    const blockedRequests: string[] = []
    await page.route('https://blocked-preview.invalid/**', async (route) => {
      blockedRequests.push(route.request().url())
      await route.fulfill({ status: 200, contentType: 'text/html', body: 'ESCAPED' })
    })
    const markdownText = [
      '# Markdown smoke', '', 'Rendered from the workspace.', '',
      ...Array.from({ length: (PAGE_LINES - 4) / 2 }, (_, index) => [`Paragraph ${index + 1}: ${'visible prefix '.repeat(20)}`, '']).flat(),
      '# Markdown tail',
      '', '![relative image](preview-images/local%20image.png)',
      '', `![absolute image](<${join(cwd, 'tiny.png').replaceAll('\\', '/')}>)`,
      '', '![reference image][local-image]', '', '[local-image]: preview-images/local%20image.png',
    ].join('\n')
    await mkdir(join(cwd, 'preview-images'))
    const codeLines = [
      ...Array.from({ length: PAGE_LINES }, (_, index) => index === 0 ? 'const prefix = "CODE_PREFIX";' : `// prefix line ${index + 1}`),
      'const tail = "CODE_TAIL";',
    ]
    await Promise.all([
      writeFile(join(cwd, 'hostile.html'), `<!doctype html><html lang="en" class="dark"><head>
        <link rel="preconnect" href="https://blocked-preview.invalid">
        <noscript><meta http-equiv="refresh" content="0;url=https://blocked-preview.invalid/refresh"></noscript>
        </head><body style="margin:0"><h1>Static adversarial preview</h1>
        <a id="plain-link" href="https://blocked-preview.invalid/plain">Plain link</a>
        <div><template shadowrootmode="open"><a id="shadow-link" href="https://blocked-preview.invalid/shadow">Shadow link</a><template><iframe src="https://blocked-preview.invalid/frame"></iframe></template></template></div>
        <svg><a id="svg-link" href="https://blocked-preview.invalid/svg"><text y="20">SVG link</text><set attributeName="href" to="https://blocked-preview.invalid/set"/><animate attributeName="href" values="https://blocked-preview.invalid/animate"/></a></svg>
        <img src="https://blocked-preview.invalid/image"><iframe src="https://blocked-preview.invalid/direct-frame"></iframe>
        <math id="math-link" href="https://blocked-preview.invalid/math"><mi>x</mi></math>
        <form><math><mtext></form><form><mglyph><style></math><a id="mutation-link" href="https://blocked-preview.invalid/mutation">Mutation link</a>
        </body></html>`),
      writeFile(join(cwd, 'smoke.md'), markdownText),
      writeFile(join(cwd, 'pages.ts'), codeLines.join('\n')),
      writeFile(join(cwd, 'notes.unknown'), 'UNKNOWN_SUFFIX\nPlain fallback.'),
      writeFile(join(cwd, 'smoke.html'), [
        '<!doctype html><link rel="stylesheet" href="./local.css">',
        '<h1>HTML smoke</h1><p id="result">pending</p><p id="local-result">pending</p><p id="parent-result">pending</p>',
        '<img src="https://preview.invalid/developer-tools.png" width="1" height="1" alt="">',
        '<p id="outside-result">pending</p>',
        '<script>document.getElementById("result").textContent="INLINE_OK";',
        'try{parent.document.documentElement.setAttribute("data-document-preview-escape","true");document.getElementById("parent-result").textContent="parent-accessible"}',
        'catch(error){const result=document.getElementById("parent-result");result.textContent="parent-blocked";result.dataset.error=error.name}</script>',
        '<script src="./local.js"></script>',
        `<script src="${outsideReference}"></script>`,
      ].join('\n')),
      writeFile(join(cwd, 'local.js'), 'document.getElementById("local-result").textContent="LOCAL_JS_OK";'),
      writeFile(join(cwd, 'local.css'), '#local-result { color: rgb(12, 34, 56); }'),
      writeFile(outsideScript, 'document.getElementById("outside-result").textContent="OUTSIDE_JS_OK";'),
      writeFile(join(cwd, 'tiny.png'), TINY_PNG),
      writeFile(join(cwd, 'preview-images', 'local image.png'), TINY_PNG),
      writeFile(join(cwd, 'large.svg'), [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">',
        '<script>parent.document.documentElement.setAttribute("data-image-preview-escape","true")</script>',
        '<rect width="1200" height="1600" fill="#2463eb"/>',
        '</svg>',
      ].join('')),
      writeFile(join(cwd, 'smoke.pdf'), pdfFixture()),
      writeFile(join(cwd, 'user-unit.pdf'), pdfFixture(2)),
      ...[90, 180, 270].map(rotation => writeFile(join(cwd, `rotated-${rotation}.pdf`), pdfFixture(4, rotation))),
      writeFile(join(cwd, 'selection.pdf'), selectionPdfFixture()),
      writeFile(join(cwd, 'budget.xlsx'), await excelFixture()),
      writeFile(join(cwd, 'chart-budget.xlsx'), await excelDrawingFixture()),
      writeFile(join(cwd, 'meeting.xlsx'), await meetingMinutesFixture()),
      writeFile(join(cwd, 'literal-html.xlsx'), await excelHtmlFixture()),
      writeFile(join(cwd, 'budget.xls'), xlsFixture()),
      writeFile(join(cwd, 'table.csv'), '00123,"中文,字段","=SUM(1,2)"\n2024-03-01,,TRUE'),
      writeFile(join(cwd, 'table.tsv'), '00123\t"中文\t字段"\t=SUM(1,2)\n2024-03-01\t\tTRUE'),
      ...['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].map(extension => writeFile(join(cwd, `unavailable.${extension}`), Buffer.from('PK\u0003\u0004OFFICE_BINARY_PREVIEW'))),
      writeFile(join(cwd, 'clip.mp4'), Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])),
    ])

    const column = page.locator('[data-rightbar-col]')
    await page.locator('[data-sidebar-right-expand]').click()
    await column.locator('[data-sidebar-right-guide-entry="files"]').click()
    await column.locator('[data-files-state="tree"]').waitFor({ state: 'visible' })
    await column.locator('[data-files-reload]').click()
    const filesTab = column.locator('[data-dockkit-tab]').filter({ has: page.getByText('Files', { exact: true }) })
    const addTab = column.locator('[data-dockkit-add-tab]')
    expect(await column.locator('[data-dockkit-tab]').count()).toBe(1)
    const defaultTitle = await filesTab.locator('[data-dockkit-tab-title]').innerText()
    const initialFilesClose = await filesTab.locator('[data-dockkit-tab-close]').count()
    expect(initialFilesClose).toBe(1)
    await filesTab.click({ button: 'right' })
    expect(await page.locator('[data-dockkit-tab-menu]:visible').count()).toBe(1)
    await page.keyboard.press('Escape')
    await addTab.waitFor({ state: 'visible' })
    const initialAdd = await addTab.count()
    expect(initialAdd).toBe(1)
    await addTab.click()
    await column.locator('[data-sidebar-right-guide]').waitFor({ state: 'visible' })
    await expect.poll(() => column.locator('[data-dockkit-tab]').count()).toBe(2)
    const guideTab = column.locator('[data-dockkit-tab]').filter({ hasNot: page.getByText('Files', { exact: true }) })
    const guideClose = await guideTab.locator('[data-dockkit-tab-close]').count()
    const filesCloseWithGuide = await filesTab.locator('[data-dockkit-tab-close]').count()
    expect(guideClose).toBe(1)
    expect(filesCloseWithGuide).toBe(1)
    await expect.poll(() => addTab.count()).toBe(0)
    const addWithGuide = await addTab.count()
    await guideTab.hover()
    await guideTab.locator('[data-dockkit-tab-close]').click()
    await column.locator('[data-files-state="tree"]').waitFor({ state: 'visible' })
    await expect.poll(() => column.locator('[data-sidebar-right-guide]').count()).toBe(0)
    await expect.poll(() => column.locator('[data-dockkit-tab]').count()).toBe(1)
    await addTab.waitFor({ state: 'visible' })
    const restoredFilesClose = await filesTab.locator('[data-dockkit-tab-close]').count()
    const restoredAdd = await addTab.count()
    expect(restoredFilesClose).toBe(1)
    expect(restoredAdd).toBe(1)
    const preview = column.locator('[data-textpreview-url]')
    const openFile = openPreviewFile.bind(undefined, column, filesTab, preview)
    const viewer = preview.locator('[data-document-viewer-menu]')
    const body = preview.locator('[data-textpreview-body]')
    const sections = ['# Document preview']
    sections.push([
      '## Sidebar tabs', '',
      `- Default tab: ${defaultTitle}`,
      `- Files close buttons (alone -> with guide -> restored): ${[initialFilesClose, filesCloseWithGuide, restoredFilesClose].join(' -> ')}`,
      `- Manual guide close buttons: ${guideClose}`,
      `- Add buttons (Files -> guide -> Files): ${[initialAdd, addWithGuide, restoredAdd].join(' -> ')}`,
    ].join('\n'))

    await openFile('smoke.md')
    await expect.poll(() => viewer.innerText()).toBe('Markdown')
    await preview.getByRole('heading', { name: 'Markdown smoke', exact: true }).waitFor({ timeout: 15_000 })
    await preview.getByText('Rendered from the workspace.', { exact: true }).waitFor({ state: 'visible' })
    const heading = await preview.getByRole('heading', { name: 'Markdown smoke', exact: true }).innerText()
    const markdownTail = preview.getByRole('heading', { name: 'Markdown tail', exact: true })
    await expect.poll(() => preview.locator('[data-textpreview-more]').isEnabled()).toBe(true)
    expect(await markdownTail.count()).toBe(0)
    await scrollForNextPage(body)
    await markdownTail.waitFor({ timeout: 15_000 })
    await expect.poll(() => preview.locator('[data-textpreview-more]').count()).toBe(0)
    expect(await preview.getByRole('heading', { name: heading, exact: true }).count()).toBe(1)
    expect(await preview.getByText('Rendered from the workspace.', { exact: true }).count()).toBe(1)
    const tailHeading = await markdownTail.innerText()
    const markdownImages: string[] = []
    for (const alt of ['relative image', 'absolute image', 'reference image']) {
      const image = preview.getByRole('img', { name: alt, exact: true })
      await scrollIntoView(image)
      await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
      const source = new URL(await image.getAttribute('src') ?? '')
      expect(source.pathname).toBe('/api/file')
      markdownImages.push(alt)
    }
    await scrollIntoView(preview.getByRole('heading', { name: heading, exact: true }))
    await successShot(page, 'markdown')
    const markdownTab = column.locator('[data-dockkit-tab]').filter({ has: page.getByText('smoke.md', { exact: true }) })
    const markdownTabId = await markdownTab.getAttribute('data-dockkit-tab')
    expect(markdownTabId).not.toBeNull()
    const tabCount = await column.locator('[data-dockkit-tab]').count()
    const markdownViewers = [await viewer.innerText()]
    const sourceFonts: Array<{ fontSize: string; lineHeight: string }> = []
    for (const label of ['Code', 'Plain text']) {
      await viewer.click()
      await page.getByRole('menuitem', { name: label, exact: true }).click()
      await expect.poll(() => viewer.innerText()).toBe(label)
      if (label === 'Code') {
        await preview.locator('.shiki').waitFor({ timeout: 15_000 })
        expect(await preview.locator('.shiki').textContent()).toBe(markdownText)
      } else {
        await expect.poll(async () => (await preview.locator('[data-textpreview-line]').first().textContent())?.trim()).toBe('# Markdown smoke')
      }
      const source = label === 'Code' ? preview.locator('.shiki') : preview.locator('[data-textpreview-line]').first()
      sourceFonts.push(await source.evaluate((node) => {
        const style = getComputedStyle(node)
        return { fontSize: style.fontSize, lineHeight: style.lineHeight }
      }))
      expect(await markdownTab.getAttribute('data-dockkit-tab')).toBe(markdownTabId)
      expect(await column.locator('[data-dockkit-tab]').count()).toBe(tabCount)
      markdownViewers.push(await viewer.innerText())
    }
    expect(sourceFonts[1]).toEqual(sourceFonts[0])
    sections.push([
      '## Markdown', '',
      `- Heading: ${heading}`,
      `- Tail loaded by scrolling: ${tailHeading}`,
      `- Loaded images: ${markdownImages.join(' | ')}`,
      `- Viewers: ${markdownViewers.join(' -> ')}`,
      `- Same tab: ${String(await markdownTab.getAttribute('data-dockkit-tab') === markdownTabId)}`,
    ].join('\n'))

    await openFile('hostile.html')
    const hostileFrame = page.frameLocator('[data-html-preview]')
    await hostileFrame.getByRole('heading', { name: 'Static adversarial preview' }).waitFor()
    expect(await hostileFrame.locator('html').getAttribute('class')).toBe('dark')
    expect(await hostileFrame.locator('body').evaluate(node => getComputedStyle(node).margin)).toBe('0px')
    for (const id of ['plain-link', 'svg-link', 'math-link']) {
      const link = hostileFrame.locator(`#${id}`)
      expect(await link.getAttribute('href')).toBeNull()
      await link.click()
    }
    // DOMPurify leaves ordinary templates inert and removes declarative shadow roots.
    expect(await hostileFrame.locator('#shadow-link').count()).toBe(0)
    expect(await hostileFrame.locator('[href], [xlink\\:href]').count()).toBe(0)
    const mutationLink = hostileFrame.locator('#mutation-link')
    if (await mutationLink.count() > 0) await mutationLink.click()
    expect(await hostileFrame.locator('noscript, link, set, animate, iframe').count()).toBe(0)
    expect(blockedRequests).toEqual([])
    await hostileFrame.getByRole('heading', { name: 'Static adversarial preview' }).waitFor()

    await openFile('smoke.html')
    await expect.poll(() => viewer.innerText()).toBe('HTML')
    const iframe = preview.locator('[data-html-preview]')
    await iframe.waitFor({ timeout: 15_000 })
    expect(await iframe.getAttribute('sandbox')).toBe('')
    const basicHtml = page.frameLocator('[data-html-preview]')
    await basicHtml.getByRole('heading', { name: 'HTML smoke', exact: true }).waitFor()
    expect(await basicHtml.locator('#result').innerText()).toBe('pending')
    expect(await basicHtml.locator('#local-result').innerText()).toBe('pending')
    expect(previewNetworkRequests).toBe(0)
    await successShot(page, 'html-basic')
    sections.push([
      '## Basic HTML', '',
      '- Developer tools: disabled for this scenario',
      '- Sandbox: no permissions',
      `- Inline script: ${await basicHtml.locator('#result').innerText()}`,
      `- Local script: ${await basicHtml.locator('#local-result').innerText()}`,
      `- Network requests: ${previewNetworkRequests}`,
    ].join('\n'))
    await openSettings(page, 'en')
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('switch', { name: 'Developer tools' }).click()
    await expect.poll(() => settings.getByRole('switch', { name: 'Developer tools' }).getAttribute('aria-checked')).toBe('true')
    await successShot(page, 'developer-tools-setting')
    await settings.getByRole('button', { name: 'Close', exact: true }).click()
    await expect.poll(() => iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(await iframe.getAttribute('sandbox')).toBe('allow-scripts')
    expect(await iframe.evaluate((node) => {
      const host = node.closest('[data-textpreview-body]')
      if (!(host instanceof HTMLElement)) throw new Error('HTML preview body is unavailable')
      const outer = host.getBoundingClientRect()
      const frame = node.getBoundingClientRect()
      return {
        top: Math.round(frame.top - outer.top),
        right: Math.round(outer.right - frame.right),
        bottom: Math.round(outer.bottom - frame.bottom),
        left: Math.round(frame.left - outer.left),
      }
    })).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    const html = page.frameLocator('[data-html-preview]')
    await html.getByRole('heading', { name: 'HTML smoke', exact: true }).waitFor({ timeout: 15_000 })
    await expect.poll(() => html.locator('#result').innerText()).toBe('INLINE_OK')
    await expect.poll(() => html.locator('img[src="https://preview.invalid/developer-tools.png"]')
      .evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(1)
    await expect.poll(() => html.locator('#local-result').innerText()).toBe('LOCAL_JS_OK')
    await expect.poll(() => html.locator('#outside-result').innerText()).toBe('OUTSIDE_JS_OK')
    await expect.poll(() => html.locator('#local-result').evaluate(node => getComputedStyle(node).color)).toBe('rgb(12, 34, 56)')
    await expect.poll(() => html.locator('#parent-result').innerText()).toBe('parent-blocked')
    expect(await html.locator('#parent-result').getAttribute('data-error')).toBe('SecurityError')
    expect(await page.locator('html').getAttribute('data-document-preview-escape')).toBeNull()
    expect(previewNetworkRequests).toBe(1)
    const beforeStyleSave = await iframe.getAttribute('src')
    await writeFile(join(cwd, 'local.css'), '#local-result { color: rgb(56, 34, 12); }')
    await expect.poll(() => html.locator('#local-result').evaluate(node => getComputedStyle(node).color)).toBe('rgb(56, 34, 12)')
    expect(await iframe.getAttribute('src')).not.toBe(beforeStyleSave)
    const beforeScriptSave = await iframe.getAttribute('src')
    await writeFile(join(cwd, 'local.js'), 'document.getElementById("local-result").textContent="LOCAL_JS_REFRESHED";')
    await expect.poll(() => html.locator('#local-result').innerText()).toBe('LOCAL_JS_REFRESHED')
    expect(await iframe.getAttribute('src')).not.toBe(beforeScriptSave)
    await page.getByRole('tab', { name: /Trajectory/ }).click()
    await scaffold.ctx.settings.update('ui-settings', { enabled: false })
    await expect.poll(() => page.getByRole('tab', { name: /Trajectory/ }).count()).toBe(0)
    await expect.poll(() => iframe.getAttribute('sandbox')).toBe('')
    expect(await page.getByText('LIGHTHOUSE', { exact: true }).count()).toBeGreaterThan(0)
    await scaffold.ctx.settings.update('ui-settings', { enabled: true })
    await expect.poll(() => iframe.getAttribute('sandbox')).toBe('allow-scripts')
    await expect.poll(() => html.locator('#result').innerText()).toBe('INLINE_OK')
    await successShot(page, 'html')
    sections.push([
      '## HTML', '',
      `- Viewer: ${await viewer.innerText()}`,
      `- Sandbox: ${await iframe.getAttribute('sandbox')}`,
      `- Inline script: ${await html.locator('#result').innerText()}`,
      `- Local script after save: ${await html.locator('#local-result').innerText()}`,
      `- Outside-workspace script: ${await html.locator('#outside-result').innerText()}`,
      `- Local stylesheet after save: ${await html.locator('#local-result').evaluate(node => getComputedStyle(node).color)}`,
      `- Parent access: ${await html.locator('#parent-result').innerText()} (${await html.locator('#parent-result').getAttribute('data-error')})`,
      `- Parent unchanged: ${String(await page.locator('html').getAttribute('data-document-preview-escape') === null)}`,
    ].join('\n'))

    await openFile('smoke.pdf')
    const canvas = preview.getByRole('img', { name: 'PDF page 1', exact: true })
    await canvas.waitFor({ state: 'visible', timeout: 30_000 })
    expect(await viewer.count()).toBe(0)
    const zoomControls = preview.locator('[data-document-zoom-controls]')
    await expect.poll(() => zoomControls.getAttribute('data-document-zoom-visible')).toBeNull()
    let pdfZoom = await revealDocumentZoom(page, preview)
    await hideDocumentZoom(page, preview)
    pdfZoom = await revealDocumentZoom(page, preview)
    const pdfWidth = (await canvas.boundingBox())!.width
    const pdfIntrinsicWidth = await canvas.evaluate(node => Number.parseFloat(node.style.getPropertyValue('--pdf-page-width')))
    await expect.poll(() => pdfZoom.innerText()).toBe(`${String(Math.round(pdfWidth / pdfIntrinsicWidth * 100))}%`)
    await pdfZoom.click()
    await page.getByRole('menuitem', { name: '100%', exact: true }).click()
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBeCloseTo(pdfIntrinsicWidth, 0)
    pdfZoom = await revealDocumentZoom(page, preview)
    await pdfZoom.click()
    await page.getByRole('menuitem', { name: '150%', exact: true }).click()
    await expect.poll(async () => (await canvas.boundingBox())!.width / pdfIntrinsicWidth).toBeCloseTo(1.5, 1)
    pdfZoom = await revealDocumentZoom(page, preview)
    await pdfZoom.click()
    await page.getByRole('menuitem', { name: 'Fit width', exact: true }).click()
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBeCloseTo(pdfWidth, 0)
    expect(await preview.locator('[data-pdf-page]').count()).toBe(2)
    await expect.poll(() => canvasColor(canvas), { timeout: 30_000 }).toBe('red')
    const firstColor = await canvasColor(canvas)
    expect(firstColor).toBe('red')
    const workerNames = await Promise.all(page.workers().map(worker => worker.evaluate(() => self.name)))
    expect(workerNames).toContain('dsh-pdf')
    await scrollIntoView(preview.locator('[data-pdf-page="2"]'))
    const secondPage = preview.getByRole('img', { name: 'PDF page 2', exact: true })
    await secondPage.waitFor({ state: 'visible', timeout: 30_000 })
    await expect.poll(() => canvasColor(secondPage), { timeout: 30_000 }).toBe('blue')
    const secondColor = await canvasColor(secondPage)
    expect(secondColor).toBe('blue')
    expect(await body.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    const pdfTab = column.locator('[data-dockkit-tab]').filter({ has: page.getByText('smoke.pdf', { exact: true }) })
    const pdfTabId = await pdfTab.getAttribute('data-dockkit-tab')
    expect(pdfTabId).not.toBeNull()
    await filesTab.click()
    await column.locator('[data-files-state="tree"]').waitFor({ state: 'visible' })
    await pdfTab.click()
    await scrollIntoView(preview.locator('[data-pdf-page="2"]'))
    await secondPage.waitFor({ state: 'visible', timeout: 30_000 })
    await expect.poll(() => canvasColor(secondPage), { timeout: 30_000 }).toBe('blue')
    const restoredColor = await canvasColor(secondPage)
    expect(restoredColor).toBe('blue')
    expect(await pdfTab.getAttribute('data-dockkit-tab')).toBe(pdfTabId)
    await copyPdfText(page, preview, 'Selectable PDF text')
    await successShot(page, 'pdf')
    sections.push([
      '## PDF', '',
      `- Viewer menu hidden: ${String(await viewer.count() === 0)}`,
      `- Worker: ${workerNames.find(name => name === 'dsh-pdf')}`,
      `- Continuous pages: ${await preview.locator('[data-pdf-page]').count()}`,
      '- Zoom reveal: hidden -> bottom hover -> delayed hidden',
      '- Zoom modes: fit width -> 100% -> 150% -> fit width',
      `- Horizontal overflow: ${String(await body.evaluate(node => node.scrollWidth > node.clientWidth))}`,
      `- Canvas fills: ${[firstColor, secondColor, restoredColor].join(' -> ')}`,
      `- Same tab: ${String(await pdfTab.getAttribute('data-dockkit-tab') === pdfTabId)}`,
      '- Selected and copied text: Selectable PDF text',
    ].join('\n'))

    await openFile('user-unit.pdf')
    await preview.getByRole('img', { name: 'PDF page 1', exact: true }).waitFor({ state: 'visible' })
    await copyPdfText(page, preview, 'Selectable PDF text')
    sections.push('## PDF page units\n\n- UserUnit 2: selected and copied text aligns with the canvas')

    const viewportSize = page.viewportSize()!
    try {
      for (const rotation of [90, 180, 270]) {
        await openFile(`rotated-${rotation}.pdf`)
        for (const width of [viewportSize.width, 1280]) {
          await page.setViewportSize({ ...viewportSize, width })
          await copyPdfText(page, preview, 'Selectable PDF text')
          // The fixture's only black pixels are text; canvas ink is independent of the overlay geometry.
          await expect.poll(() => preview.locator('[data-pdf-page]').first().evaluate((node) => {
            const canvas = node.querySelector('canvas')!
            const canvasBox = canvas.getBoundingClientRect()
            const textBox = node.querySelector('.textLayer span')!.getBoundingClientRect()
            const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
            let ink = 0
            let aligned = 0
            for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i + 3]! < 128 || Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > 80) continue
              ink++
              const x = canvasBox.left + ((i / 4) % canvas.width + 0.5) * canvasBox.width / canvas.width
              const y = canvasBox.top + (Math.floor(i / 4 / canvas.width) + 0.5) * canvasBox.height / canvas.height
              if (x >= textBox.left - 1 && x <= textBox.right + 1 && y >= textBox.top - 1 && y <= textBox.bottom + 1) aligned++
            }
            return ink === 0 ? 0 : aligned / ink
          })).toBeGreaterThan(0.95)
        }
      }
    } finally { await page.setViewportSize(viewportSize) }
    sections.push('## PDF page rotation\n\n- 90, 180, 270 degrees: selection and copied text align with canvas ink before and after resizing')

    await openFile('selection.pdf')
    await preview.getByRole('img', { name: 'PDF page 1', exact: true }).waitFor({ state: 'visible' })
    const selectionLayer = preview.locator('.textLayer')
    const selectionText = selectionLayer.locator('span:not(.markedContent)')
    const titleText = selectionText.filter({ hasText: 'JOURNAL' })
    const priorityText = selectionText.filter({ hasText: 'HIGH / MEDIUM / LOW' }).first()
    // The text resize observer aligns the overlay after the canvas becomes visible.
    await titleText.waitFor({ state: 'visible' })
    await priorityText.waitFor({ state: 'visible' })
    const titleBox = await titleText.boundingBox()
    const priorityBox = await priorityText.boundingBox()
    if (titleBox === null || priorityBox === null) throw new Error('selection fixture text has no bounds')
    const start = { x: titleBox.x + 1, y: titleBox.y + titleBox.height / 2 }
    const end = { x: priorityBox.x + priorityBox.width / 2, y: priorityBox.y - 3 }
    const drag = async (from: typeof start, to: typeof end, through?: typeof end): Promise<string> => {
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      try {
        if (through !== undefined) await page.mouse.move(through.x, through.y, { steps: 15 })
        await page.mouse.move(to.x, to.y, { steps: 15 })
        return await page.evaluate(() => window.getSelection()?.toString() ?? '')
      } finally { await page.mouse.up() }
    }
    const priority = { x: end.x, y: priorityBox.y + priorityBox.height / 2 }
    const forward = await drag(start, end, priority)
    expect(forward).toContain('JOURNAL')
    expect(forward).toContain('THREE TASKS')
    expect(forward).not.toContain('REFLECTION')
    expect(forward).not.toContain('AFTER TABLE')
    const backward = await drag(priority, start)
    expect(backward).toContain('THREE TASKS')
    expect(backward).not.toContain('REFLECTION')
    expect(backward).not.toContain('AFTER TABLE')
    expect(await selectionLayer.locator('br').first().evaluate(node => getComputedStyle(node, '::selection').backgroundColor))
      .toBe('rgba(0, 0, 0, 0)')
    await successShot(page, 'pdf-drag-selection')
    sections.push('## PDF drag selection\n\n- Table selection: forward and backward drags exclude later sections\n- Line-break highlight: transparent')

    const pngResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workspaceFiles/readBytes'
      && (response.request().postDataJSON() as { payload: { args: { path: string } } }).payload.args.path === 'tiny.png')
    await openFile('tiny.png')
    const transferred = await pngResponse
    expect(transferred.headers()['content-type']).toMatch(/^multipart\/form-data;/)
    const transferredBody = await new Response(new Uint8Array(await transferred.body()), { headers: transferred.headers() }).formData()
    const metadata = transferredBody.get('metadata')
    if (typeof metadata !== 'string') throw new Error('missing PNG metadata')
    const { attachments } = JSON.parse(metadata) as { attachments: { path: string[]; codec: string; part: string }[] }
    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({ path: ['data'], codec: 'bytes' })
    expect(attachments[0]!.part).toEqual(expect.any(String))
    const transferredFile = transferredBody.get(attachments[0]!.part)
    if (transferredFile === null || typeof transferredFile === 'string') throw new Error('missing PNG payload')
    expect(Buffer.from(await transferredFile.arrayBuffer())).toEqual(TINY_PNG)
    const tinyImage = preview.getByRole('img', { name: 'Image preview: tiny.png', exact: true })
    await tinyImage.waitFor({ state: 'visible', timeout: 15_000 })
    expect(await viewer.count()).toBe(0)
    expect(await tinyImage.evaluate(node => ({
      width: (node as HTMLImageElement).naturalWidth,
      height: (node as HTMLImageElement).naturalHeight,
      draggable: (node as HTMLImageElement).draggable,
    }))).toEqual({ width: 1, height: 1, draggable: false })
    const centering = await tinyImage.evaluate((node) => {
      const image = node.getBoundingClientRect()
      const scroller = node.closest('[data-textpreview-body]')?.getBoundingClientRect()
      if (scroller === undefined) throw new Error('image document scroller is unavailable')
      return {
        horizontal: Math.abs((image.left + image.width / 2) - (scroller.left + scroller.width / 2)),
        vertical: Math.abs((image.top + image.height / 2) - (scroller.top + scroller.height / 2)),
      }
    })
    expect(centering.horizontal).toBeLessThan(10)
    expect(centering.vertical).toBeLessThan(10)
    let imageZoom = await revealDocumentZoom(page, preview)
    await expect.poll(() => imageZoom.innerText()).toBe('100%')
    const tinyWidth = (await tinyImage.boundingBox())!.width
    await imageZoom.click()
    await page.getByRole('menuitem', { name: '200%', exact: true }).click()
    await expect.poll(async () => (await tinyImage.boundingBox())!.width / tinyWidth).toBeCloseTo(2, 1)
    imageZoom = await revealDocumentZoom(page, preview)
    await imageZoom.click()
    await page.getByRole('menuitem', { name: 'Fit width', exact: true }).click()
    await expect.poll(() => imageZoom.innerText()).toBe('100%')

    await openFile('large.svg')
    await expect.poll(() => viewer.innerText()).toBe('Image')
    await viewer.click()
    await page.getByRole('menuitem', { name: 'Plain text', exact: true }).waitFor({ timeout: 15_000 })
    await page.keyboard.press('Escape')
    const largeImage = preview.getByRole('img', { name: 'Image preview: large.svg', exact: true })
    await largeImage.waitFor({ state: 'visible', timeout: 15_000 })
    const fitted = await largeImage.evaluate((node) => {
      const image = node as HTMLImageElement
      const scroller = image.closest('[data-textpreview-body]')
      if (scroller === null) throw new Error('image document scroller is unavailable')
      const rect = image.getBoundingClientRect()
      return {
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        width: rect.width,
        height: rect.height,
        paneWidth: scroller.clientWidth,
        paneHeight: scroller.clientHeight,
      }
    })
    expect(fitted).toMatchObject({ naturalWidth: 1200, naturalHeight: 1600 })
    expect(fitted.width).toBeLessThan(1200)
    // Width fit: the image fills the frame's 12px-inset box while the aspect ratio holds.
    expect(Math.abs((fitted.paneWidth - 24) - fitted.width)).toBeLessThanOrEqual(1)
    expect(fitted.height / fitted.width).toBeCloseTo(1600 / 1200, 2)
    let svgZoom = await revealDocumentZoom(page, preview)
    await expect.poll(async () => Number.parseInt(await svgZoom.innerText(), 10)).toBeCloseTo(fitted.width / 12, 0)
    const imageScrollport = preview.locator('[data-document-zoom-scrollport]')
    const fitScrolled = await imageScrollport.evaluate((node) => {
      node.scrollLeft = node.scrollWidth
      return { left: node.scrollLeft, horizontalOverflow: node.scrollWidth > node.clientWidth }
    })
    expect(fitScrolled).toEqual({ left: 0, horizontalOverflow: false })
    await svgZoom.click()
    await page.getByRole('menuitem', { name: '100%', exact: true }).click()
    await expect.poll(async () => (await largeImage.boundingBox())!.width).toBeCloseTo(1200, 0)
    expect(await imageScrollport.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true)
    svgZoom = await revealDocumentZoom(page, preview)
    await svgZoom.click()
    await page.getByRole('menuitem', { name: 'Fit width', exact: true }).click()
    await expect.poll(async () => (await largeImage.boundingBox())!.width).toBeCloseTo(fitted.width, 0)
    expect(await imageScrollport.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(false)
    expect(await page.locator('html').getAttribute('data-image-preview-escape')).toBeNull()
    sections.push([
      '## Image zoom', '',
      '- Small PNG fit width remains at intrinsic size; 200% doubles it',
      '- SVG fit width -> 100% -> fit width toggles horizontal overflow: false -> true -> false',
      '- Image and Blob identities remain stable while zoom changes',
    ].join('\n'))

    const releaseRead = Promise.withResolvers<undefined>()
    let waitingForRead = false
    const readPage = scaffold.ctx.workspaceFiles.read.bind(scaffold.ctx.workspaceFiles)
    const heldRead = vi.spyOn(scaffold.ctx.workspaceFiles, 'read').mockImplementation(async (agent, path, range, signal) => {
      if (path === 'pages.ts' && (range.offset ?? 1) === 1) {
        waitingForRead = true
        await releaseRead.promise
      }
      return readPage(agent, path, range, signal)
    })
    let initialReading = false
    try {
      await openFile('pages.ts')
      await expect.poll(() => waitingForRead).toBe(true)
      const reading = preview.locator('[data-document-loading]')
      initialReading = await reading.isVisible()
      expect(initialReading).toBe(true)
      expect(await preview.locator('[data-code-preview]').count()).toBe(0)
      const bounds = await reading.evaluate((node) => {
        const body = node.closest('[data-textpreview-body]')
        if (body === null) throw new Error('reading indicator has no document body')
        const indicator = node.getBoundingClientRect()
        const scroller = body.getBoundingClientRect()
        return { top: indicator.top - scroller.top, bottom: scroller.bottom - indicator.bottom }
      })
      expect(bounds.top).toBeGreaterThanOrEqual(0)
      expect(bounds.bottom).toBeGreaterThanOrEqual(0)
      await successShot(page, 'code-reading')
    } finally {
      releaseRead.resolve(undefined)
      heldRead.mockRestore()
    }
    await expect.poll(() => viewer.innerText()).toBe('Code')
    const highlightedLines = preview.locator('.shiki .line')
    await expect.poll(() => highlightedLines.count(), { timeout: 15_000 }).toBe(PAGE_LINES)
    const codeBlock = preview.locator('.md-code-block')
    const codeScrollport = preview.locator('[data-code-block-content]')
    expect(await codeBlock.getAttribute('data-line-numbers')).toBe('true')
    await expect.poll(() => highlightedLines.first().evaluate(node => getComputedStyle(node, '::before').content))
      .not.toMatch(/^(?:none|normal)$/u)
    const numbering = await highlightedLines.first().evaluate((node) => {
      const line = getComputedStyle(node)
      const before = getComputedStyle(node, '::before')
      return {
        counterIncrement: line.counterIncrement,
        gutterWidth: Number.parseFloat(before.width),
        sourceInset: Number.parseFloat(line.paddingInlineStart),
      }
    })
    expect(numbering.counterIncrement).toBe('source-line 1')
    expect(numbering.gutterWidth).toBeGreaterThan(0)
    expect(numbering.sourceInset).toBeGreaterThan(numbering.gutterWidth)
    const prefix = await highlightedLines.allTextContents()
    expect(prefix).toEqual(codeLines.slice(0, PAGE_LINES))
    await expect.poll(() => preview.locator('[data-textpreview-more]').isEnabled()).toBe(true)
    await scrollForNextPage(codeScrollport)
    await expect.poll(() => highlightedLines.count(), { timeout: 15_000 }).toBe(codeLines.length)
    const completed = await highlightedLines.allTextContents()
    expect(completed).toEqual(codeLines)
    await expect.poll(() => preview.locator('[data-textpreview-more]').count()).toBe(0)
    const scrollTop = await codeScrollport.evaluate((node) => {
      const target = Math.floor((node.scrollHeight - node.clientHeight) / 2)
      if (target <= 0) throw new Error('code fixture does not overflow the document body')
      node.scrollTop = target
      return target
    })
    await expect.poll(() => codeScrollport.evaluate((node) => {
      const codeBlock = node.parentElement
      const banner = codeBlock?.firstElementChild
      const firstLine = node.querySelector('.shiki .line')
      if (!(banner instanceof HTMLElement) || firstLine === null) throw new Error('missing rendered code banner or source line')
      const bounds = node.getBoundingClientRect()
      const clipTop = bounds.top + node.clientTop
      const bannerBounds = banner.getBoundingClientRect()
      return {
        scrollTop: node.scrollTop,
        scrollportBelowBanner: Math.abs(bannerBounds.bottom - bounds.top) < 1,
        firstLineAbove: firstLine.getBoundingClientRect().top < clipTop,
      }
    })).toEqual({ scrollTop, scrollportBelowBanner: true, firstLineAbove: true })
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin })
    await page.evaluate(() => navigator.clipboard.writeText(''))
    const copyCode = codeBlock.getByRole('button', { name: 'Copy', exact: true })
    expect(await codeBlock.getByRole('button').count()).toBe(1)
    expect(await copyCode.textContent()).toBe('')
    await copyCode.hover()
    await page.getByRole('tooltip', { name: 'Copy', exact: true }).waitFor()
    await copyCode.click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(codeLines.join('\n'))
    sections.push([
      '## Code paging', '',
      `- Viewer: ${await viewer.innerText()}`,
      `- Initial reading indicator: ${initialReading}`,
      `- Lines: ${prefix.length} -> ${completed.length}`,
      `- Prefix retained: ${String(JSON.stringify(completed.slice(0, prefix.length)) === JSON.stringify(prefix))}`,
      `- Tail: ${completed.at(-1)}`,
    ].join('\n'))

    const officeMenus: number[] = []
    const configurationGuide = 'Read failed: Office previews are unavailable. Enable the document preview service on the computer running DeepSeek Harness.'
    for (const extension of ['doc', 'docx', 'ppt', 'pptx']) {
      await openFile(`unavailable.${extension}`)
      expect(await preview.locator('[data-document-viewer-menu]').count()).toBe(0)
      await preview.getByText(configurationGuide, { exact: true }).waitFor({ timeout: 15_000 })
      expect(await preview.locator('[data-textpreview-line]').count()).toBe(0)
      expect(await preview.getByText('OFFICE_BINARY_PREVIEW', { exact: false }).count()).toBe(0)
      officeMenus.push(await viewer.count())
    }
    await successShot(page, 'office-unavailable')
    sections.push([
      '## Office unavailable', '',
      `- DOC, DOCX, PPT, PPTX viewer menus: ${officeMenus.join(' | ')}`,
      `- Guidance: ${configurationGuide}`,
      '- Binary text shown: false',
      '- Plain-text option and viewer picker: hidden',
    ].join('\n'))

    await openFile('budget.xlsx')
    const excel = preview.locator('[data-excel-preview]')
    const sheetTabs = excel.locator('.luckysheet-sheets-item-name')
    await sheetTabs.getByText('季度预算', { exact: true }).waitFor({ state: 'visible' })
    expect(await sheetTabs.getByText('隐藏页', { exact: true }).isVisible()).toBe(false)
    await successShot(page, 'excel-budget')
    expect(await preview.locator('[data-pdf-preview]').count()).toBe(0)
    expect(await excel.locator('.fortune-toolbar').count()).toBe(0)
    const sheetOverlay = excel.locator('.fortune-sheet-overlay')
    const formulaInput = excel.locator('.fortune-fx-input')
    await sheetOverlay.click({ position: { x: 500, y: 110 } })
    await expect.poll(() => formulaInput.innerText()).toBe('=C3/B3')
    await page.keyboard.press('ControlOrMeta+C')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('80.0%\n')
    await sheetTabs.getByText('公式与格式', { exact: true }).click()
    await expect.poll(() => excel.locator('.fortune-name-box').innerText()).toBe('A1')
    await sheetOverlay.click({ position: { x: 140, y: 30 } })
    await expect.poll(() => formulaInput.innerText()).toBe('46281')
    await page.keyboard.press('ControlOrMeta+C')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('2026-09-16\n')
    await sheetOverlay.click({ position: { x: 70, y: 30 } })
    await expect.poll(() => formulaInput.innerText()).toBe('=_xlfn.XLOOKUP(1,{1},{42})')
    expect(await formulaInput.getAttribute('contenteditable')).toBe('false')
    await page.keyboard.press('ControlOrMeta+C')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('42\n')
    await page.keyboard.type('999')
    await page.keyboard.press('ControlOrMeta+C')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('42\n')
    await successShot(page, 'excel-cached-formula')
    await openFile('chart-budget.xlsx')
    await sheetTabs.getByText('季度预算', { exact: true }).waitFor({ state: 'visible' })
    const unsupportedNotice = excel.locator('[data-excel-unsupported-notice]')
    const chartNotice = await unsupportedNotice.innerText()
    expect(chartNotice).toBe('This preview does not support charts, conditional formatting in this workbook. Open it in a system application for the full experience.')
    await sheetOverlay.click({ position: { x: 500, y: 110 } })
    await expect.poll(() => formulaInput.innerText()).toBe('=C3/B3')
    await page.keyboard.press('ControlOrMeta+C')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('80.0%\n')
    await successShot(page, 'excel-chart-notice')
    await openFile('meeting.xlsx')
    await sheetTabs.getByText('会议信息', { exact: true }).waitFor({ state: 'visible' })
    expect(await unsupportedNotice.count()).toBe(0)
    expect(await excel.getByText('Read-only preview', { exact: false }).count()).toBe(0)
    expect(await excel.getByText('Some formulas have no saved result', { exact: false }).count()).toBe(0)
    const formulaWarning = excel.locator('[data-excel-formula-warning]')
    await formulaWarning.hover()
    await page.getByText('This workbook contains formulas. Displayed results may be missing or inaccurate.', { exact: true }).waitFor()
    await sheetTabs.getByText('统计看板', { exact: true }).click()
    await expect.poll(() => excel.locator('.fortune-name-box').innerText()).toBe('A1')
    await successShot(page, 'excel-meeting')
    await openFile('budget.xls')
    await sheetTabs.getByText('预算', { exact: true }).waitFor({ state: 'visible' })
    await expect.poll(() => excel.locator('.fortune-name-box').innerText()).toBe('A1')
    await excel.locator('.fortune-sheet-overlay').click({ position: { x: 70, y: 30 } })
    await expect.poll(() => excel.locator('.fortune-fx-input').innerText()).toBe('旧版预算')
    await page.keyboard.press('ControlOrMeta+C')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('旧版预算')
    await sheetTabs.getByText('明细', { exact: true }).click()
    await expect.poll(() => excel.locator('.fortune-name-box').innerText()).toBe('A1')
    await successShot(page, 'excel-legacy')
    await openFile('literal-html.xlsx')
    for (const [sheet, formula, copied] of [
      ['Formula', `="${excelHtmlText}"`, 'saved result'],
      ['Text', excelHtmlText, excelHtmlText],
      ['Cached text', '="cached"', excelHtmlText],
    ] as const) {
      await sheetTabs.getByText(sheet, { exact: true }).click()
      await expect.poll(() => formulaInput.textContent()).toBe(formula)
      expect(await formulaInput.locator('img').count()).toBe(0)
      await excel.locator('.fortune-sheet-overlay').click({ position: { x: 70, y: 30 } })
      await page.keyboard.press('ControlOrMeta+C')
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${copied}\n`)
      const clipboardTable = excel.locator('#fortune-copy-content table')
      expect(await clipboardTable.locator('td').textContent()).toBe(copied)
      expect(await clipboardTable.locator('img').count()).toBe(0)
      expect(await page.evaluate(() => document.documentElement.dataset.spreadsheetHtml)).toBeUndefined()
    }
    const invalidExcel = 'This spreadsheet could not be opened. Check its format, contents, or password protection.'
    for (const extension of ['xls', 'xlsx']) {
      await openFile(`unavailable.${extension}`)
      await preview.getByText(invalidExcel, { exact: true }).waitFor()
    }
    sections.push([
      '## Browser Excel preview', '',
      '- Opens without the Office conversion service',
      '- Sheets: 季度预算 | 公式与格式; hidden worksheet omitted',
      '- Formula workbooks use a compact warning beside fx; notice rows absent',
      `- Unsupported XLSX content: ${chartNotice}`,
      '- Drawing parts omitted; styled cells and cached formulas retained; notice cleared on file replacement',
      '- Formatted percent copied: 80.0%; date copied: 2026-09-16',
      '- Cached XLOOKUP result copied: 42; typing leaves it unchanged',
      '- Formula bar is read-only; PDF body and editing toolbar absent',
      '- HTML-looking formulas, text, and cached results stay literal; copying retains text and table cells without executing HTML',
      '- XLS: merged title copied; worksheet selection retained',
      `- Invalid XLS/XLSX: ${invalidExcel}`,
    ].join('\n'))

    for (const extension of ['csv', 'tsv']) {
      await openFile(`table.${extension}`)
      await expect.poll(() => viewer.innerText()).toBe('Spreadsheet')
      await excel.getByText(extension.toUpperCase(), { exact: true }).waitFor()
      await excel.locator('.fortune-sheet-overlay').click({ position: { x: 70, y: 30 } })
      await expect.poll(() => excel.locator('.fortune-fx-input').innerText()).toBe('00123')
      await page.keyboard.press('ControlOrMeta+C')
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('00123\n')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ControlOrMeta+C')
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('=SUM(1,2)\n')
      await viewer.click()
      await page.getByRole('menuitem', { name: 'Plain text', exact: true }).click()
      await expect.poll(() => preview.locator('[data-textpreview-line]').count()).toBe(2)
      expect((await preview.locator('[data-textpreview-line]').allTextContents()).join('\n')).toContain('00123')
      await viewer.click()
      await page.getByRole('menuitem', { name: 'Spreadsheet', exact: true }).click()
      await excel.getByText(extension.toUpperCase(), { exact: true }).waitFor()
      await writeFile(join(cwd, `table.${extension}`), extension === 'csv' ? '00999,更新' : '00999\t更新')
      await preview.locator('[data-textpreview-tool="reload"]').click()
      await expect.poll(() => excel.locator('.fortune-fx-input').innerText()).toBe('00999')
      await excel.locator('.fortune-sheet-overlay').click({ position: { x: 70, y: 30 } })
      await page.keyboard.press('ControlOrMeta+C')
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('00999\n')
      await successShot(page, `excel-${extension}`)
    }
    sections.push(['## Delimited spreadsheets', '',
      '- CSV and TSV default to Spreadsheet; Plain text remains selectable',
      '- Copied ID: 00123; copied literal formula: =SUM(1,2)',
      '- Plain-text round trip retains complete source lines',
      '- Reload replaces parsed cells: 00123 -> 00999',
    ].join('\n'))

    await openFile('notes.unknown')
    const plainLines = preview.locator('[data-textpreview-line]')
    await expect.poll(() => plainLines.count()).toBe(2)
    // Plain text is the only candidate, so no viewer menu renders.
    expect(await viewer.count()).toBe(0)
    const fallback = (await plainLines.allTextContents()).map(line => line.trim())
    expect(fallback).toEqual(['UNKNOWN_SUFFIX', 'Plain fallback.'])
    sections.push(['## Unknown suffix', '', `- Viewer menu hidden: ${String(await viewer.count() === 0)}`, `- Text: ${fallback.join(' | ')}`].join('\n'))

    await filesTab.click()
    await column.locator('[data-files-entry="file"]').getByRole('button', { name: 'clip.mp4', exact: true }).click()
    const unsupported = column.locator('[data-textpreview-state="unsupported"]')
    await unsupported.waitFor({ timeout: 15_000 })
    const unsupportedLine = await unsupported.locator('[data-textpreview-unsupported] p').innerText()
    expect(unsupportedLine).toContain('Preview is not available for this file type yet.')
    expect(await unsupported.locator('[data-textpreview-path]').innerText()).toContain('clip.mp4')
    expect(await unsupported.locator('[data-document-viewer-menu]').count()).toBe(0)
    expect(await unsupported.locator('[data-textpreview-tool="reload"]').count()).toBe(0)
    // The default-application controls land once the Host answered the pinned desktop read.
    const headerOpen = unsupported.locator('[data-open-path-open]')
    await headerOpen.waitFor({ timeout: 15_000 })
    const emptyOpen = unsupported.locator('[data-textpreview-unsupported] [data-open-path-unpreviewable]')
    await emptyOpen.waitFor({ timeout: 15_000 })
    const prominent = unsupported.locator('[data-open-target="file"][data-size="large"]')
    expect((await prominent.boundingBox())?.height).toBe(36)
    expect((await unsupported.locator('[data-open-path]').boundingBox())?.height).toBe(24)
    await successShot(page, 'unsupported')
    sections.push([
      '## Unviewable binary', '',
      '- State: unsupported',
      `- Line: ${unsupportedLine.trim()}`,
      `- Header control has no text: ${String(await headerOpen.innerText() === '')}`,
      `- Empty-state control has text: ${String((await emptyOpen.innerText()).length > 0)}`,
    ].join('\n'))
    if (STUB_OPENER) {
      // Real Host gestures against the stubbed opener: default application from the empty state, reveal from the header menu.
      const clip = join(cwd, 'clip.mp4')
      await emptyOpen.click()
      await expect.poll(async () => (await opened()).length, { timeout: 15_000 }).toBe(1)
      await unsupported.locator('[data-open-path-more]').click()
      await page.getByRole('menuitem', { name: /^Show file location/ }).click()
      await expect.poll(async () => (await opened()).length, { timeout: 15_000 }).toBe(2)
      const gestures = await opened()
      expect(gestures[0]?.action).toBe('open')
      expect([clip, cwd]).toContain(gestures[0]?.path)
      expect(gestures[1]?.action).toBe('reveal')
      expect([clip, cwd]).toContain(gestures[1]?.path)
      if (STUB_OPENER) {
        await expect.poll(() => headerOpen.locator('img').count()).toBe(1)
        await prominent.getByRole('button', { name: 'More ways to open' }).click()
        await page.getByRole('menuitem', { name: 'Test Player (default)', exact: true }).waitFor()
        await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'applications.expected.md'), await page.getByRole('menu').ariaSnapshot(), MODE)
        await page.getByRole('menuitem', { name: 'Other Player', exact: true }).click()
        await expect.poll(async () => (await opened()).length).toBe(3)
        expect((await opened())[2]).toEqual({ path: clip, action: 'application' })
        await headerOpen.click()
        await expect.poll(async () => (await opened()).length).toBe(4)
        expect((await opened())[3]).toEqual({ path: clip, action: 'open' })
      }
      // Gesture facts stay out of the golden: the stub does not run on Windows.
      expect(await page.getByRole('alert').count()).toBe(0)
    }
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await compareOrRefreshGolden(EXPECTED, sections.join('\n\n'), MODE)
    await assertFixtureInventory(SNAPSHOT_DIR, ['document.expected.md', 'applications.expected.md', 'paging.patch.yml'])
  })
})

describe.skipIf(MODE === 'record')('web e2e: Host Office preview', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  afterAll(async () => {
    try { await browser?.close() } finally { await scaffold?.close() }
  })

  it('rejects renamed text and renders Chinese Office documents through the PDF worker', async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, paceMs: 5, compareReplaySession: false,
      extraOverlayPath: [
        fileURLToPath(new URL('../../../packages/client/ui-sidebar-documentpreview/tests/fixtures/office-cache.patch.yml', import.meta.url)),
        fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
      ],
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    onTestFailed(async () => {
      await saveFailureShot(page, `screenshots/0908-document-preview/office-${process.pid}`)
    })
    const settled = scaffold.whenTurnSettled()
    const input = page.locator('[data-composer-input]').first()
    await input.fill(PROMPT)
    await input.press('Enter')
    const sessionId = await settled
    const cwd = scaffold.ctx.agents.get(sessionId)?.session.header.cwd
    if (cwd === undefined) throw new Error('settled Session has no workspace cwd')
    await Promise.all([
      writeFile(join(cwd, 'renamed.docx'), 'This is plain text renamed to docx.'),
      writeFile(join(cwd, 'chinese.docx'), realOfficeBytes('docx', 'DSH Missing Preview Font')),
      writeFile(join(cwd, 'chinese.pptx'), realOfficeBytes('pptx')),
      ...(['doc', 'ppt'] as const).map(extension => writeFile(join(cwd, `chinese.${extension}`), realOfficeBytes(extension))),
      ...['doc', 'ppt'].map(extension => writeFile(join(cwd, `renamed.${extension}`), 'Plain text is not a binary Office document.')),
    ])
    const convert = vi.spyOn(scaffold.ctx.officeToPdf, 'convert')
    try {
      const column = page.locator('[data-rightbar-col]')
      await page.locator('[data-sidebar-right-expand]').click()
      await column.locator('[data-sidebar-right-guide-entry="files"]').click()
      await column.locator('[data-files-state="tree"]').waitFor({ state: 'visible' })
      await column.locator('[data-files-reload]').click()
      const filesTab = column.locator('[data-dockkit-tab]').filter({ has: page.getByText('Files', { exact: true }) })
      const preview = column.locator('[data-textpreview-url]')
      const pdfResponse = page.waitForResponse(
        response => new URL(response.url()).pathname === '/api/officeToPdf/render',
        { timeout: 60_000 },
      )
      await column.locator('[data-files-entry="file"]').getByRole('button', { name: 'chinese.docx', exact: true }).click()
      const officeTransfer = await pdfResponse
      expect(officeTransfer.headers()['content-type']).toMatch(/^multipart\/form-data;/)
      const officeBody = await new Response(new Uint8Array(await officeTransfer.body()), { headers: officeTransfer.headers() }).formData()
      const officeMetadata = officeBody.get('metadata')
      if (typeof officeMetadata !== 'string') throw new Error('missing Office PDF metadata')
      const { attachments } = JSON.parse(officeMetadata) as { attachments: { path: (string | number)[]; codec: string; part: string }[] }
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({ path: ['data'], codec: 'bytes' })
      const officeFile = officeBody.get(attachments[0]!.part)
      if (officeFile === null || typeof officeFile === 'string') throw new Error('missing Office PDF payload')
      const officePdf = Buffer.from(await officeFile.arrayBuffer())
      expect(officePdf.subarray(0, 5).toString('ascii')).toBe('%PDF-')
      expect(officePdf.subarray(-1024).toString('ascii').trimEnd()).toMatch(/%%EOF$/u)
      expect(await preview.locator('[data-document-viewer-menu]').count()).toBe(0)
      const canvas = preview.getByRole('img', { name: 'PDF page 1', exact: true })
      await canvas.waitFor({ state: 'visible', timeout: 60_000 })
      await expect.poll(() => canvas.evaluate((node) => {
        const canvas = node as HTMLCanvasElement
        const context = canvas.getContext('2d')
        if (context === null) return false
        const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data
        for (let index = 0; index < bytes.length; index += 4) {
          if (bytes[index + 3] === 255 && bytes[index]! < 200 && bytes[index + 1]! < 200 && bytes[index + 2]! < 200) return true
        }
        return false
      }), { timeout: 30_000 }).toBe(true)
      const workerNames = await Promise.all(page.workers().map(worker => worker.evaluate(() => self.name)))
      expect(workerNames).toContain('dsh-pdf')
      expect(workerNames.some(name => /libreoffice|soffice/i.test(name))).toBe(false)
      await copyPdfText(page, preview, 'Office preview')
      await copyPdfText(page, preview, '中文文档')
      expect((await preview.locator('[data-pdf-text]').allTextContents()).join('')).toContain('中文文档')
      const zoomMenu = await revealDocumentZoom(page, preview)
      const initialWidth = (await canvas.boundingBox())!.width
      const intrinsicWidth = await canvas.evaluate(node => Number.parseFloat(node.style.getPropertyValue('--pdf-page-width')))
      const fitPercent = `${String(Math.round(initialWidth / intrinsicWidth * 100))}%`
      await expect.poll(() => zoomMenu.innerText()).toBe(fitPercent)
      await zoomMenu.click()
      await page.getByRole('menuitem', { name: '150%', exact: true }).click()
      await expect.poll(() => zoomMenu.innerText()).toBe('150%')
      await expect.poll(async () => (await canvas.boundingBox())!.width / intrinsicWidth).toBeCloseTo(1.5, 1)
      const zoomScrollport = preview.locator('[data-document-zoom-scrollport]')
      await zoomScrollport.evaluate((node) => {
        const bounds = node.getBoundingClientRect()
        node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
          deltaY: -10, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2 }))
      })
      await expect.poll(() => zoomMenu.innerText()).toBe('166%')
      await expect.poll(async () => (await canvas.boundingBox())!.width / intrinsicWidth).toBeCloseTo(1.66, 1)
      await zoomMenu.click()
      await page.getByRole('menuitem', { name: 'Fit width', exact: true }).click()
      await expect.poll(() => zoomMenu.innerText()).toBe(fitPercent)
      await zoomScrollport.evaluate((node) => { node.scrollTop = 0; node.scrollLeft = 0 })
      expect(convert).toHaveBeenCalledTimes(1)
      await preview.getByRole('button', { name: 'Read the file again', exact: true }).click()
      await canvas.waitFor({ state: 'visible' })
      expect(convert).toHaveBeenCalledTimes(1)
      const warning = preview.locator('[data-office-font-warning]').getByRole('button')
      await warning.waitFor({ state: 'visible' })
      expect(await warning.getAttribute('aria-expanded')).toBe('false')
      expect(await page.getByRole('dialog', { name: 'Missing fonts', exact: true }).count()).toBe(0)
      const warningBox = (await warning.boundingBox())!
      const reload = preview.getByRole('button', { name: 'Read the file again', exact: true })
      const reloadBox = (await reload.boundingBox())!
      expect(warningBox.x + warningBox.width).toBeLessThanOrEqual(reloadBox.x)
      expect(Math.abs(warningBox.y + warningBox.height / 2 - reloadBox.y - reloadBox.height / 2)).toBeLessThan(1)
      expect([warningBox.width, warningBox.height]).toEqual([reloadBox.width, reloadBox.height])
      expect(await warning.evaluate(node => getComputedStyle(node).borderRadius))
        .toBe(await reload.evaluate(node => getComputedStyle(node).borderRadius))
      expect(await warning.locator('svg').evaluate(node => node.getBoundingClientRect().width))
        .toBe(await reload.locator('svg').evaluate(node => node.getBoundingClientRect().width))
      const warningColor = await warning.evaluate(node => getComputedStyle(node).color)
      await warning.hover()
      expect(await warning.evaluate(node => getComputedStyle(node).color)).toBe(warningColor)
      await page.getByRole('tooltip', { name: /Missing fonts:/ }).waitFor({ state: 'visible' })
      const before = await canvas.evaluate(node => node.getBoundingClientRect().top)
      await successShot(page, 'office-font-warning')
      await warning.click()
      const details = page.getByRole('dialog', { name: 'Missing fonts', exact: true })
      await details.getByText('DSH Missing Preview Font', { exact: true }).waitFor({ state: 'visible' })
      expect(await page.getByRole('tooltip', { name: /Missing fonts:/ }).count()).toBe(0)
      await successShot(page, 'office-font-details')
      await page.keyboard.press('Escape')
      await expect.poll(() => details.count()).toBe(0)
      expect(await warning.evaluate(node => node === document.activeElement)).toBe(true)
      await warning.click()
      await page.getByRole('button', { name: 'Close font details', exact: true }).click()
      expect(await warning.isVisible()).toBe(true)
      const after = await canvas.evaluate(node => node.getBoundingClientRect().top)
      expect(after).toBe(before)
      const topInset = await preview.evaluate((node) => {
        const body = node.querySelector('[data-textpreview-body]')!.getBoundingClientRect()
        const canvas = node.querySelector('canvas')!.getBoundingClientRect()
        return canvas.top - body.top
      })
      expect(topInset).toBe(0)
      await compareOrRefreshGolden(fileURLToPath(new URL('./expected/office-font-notice.md', import.meta.url)), [
        '# Office font warning', '',
        '- Warning precedes reload in the same toolbar: true',
        '- Warning and reload share button geometry and icon size: true',
        '- Details open only on request: true',
        '- Requested absent family is listed: true',
        '- Escape restores focus to the warning: true',
        '- Closing details preserves the warning and document position: true',
        '- Fit width, presets, and pinch resize the Office PDF continuously: true',
        '- Pinch updates the displayed percentage during the gesture: 166%',
        `- Document top inset: ${topInset}px`,
      ].join('\n'), MODE)
      await successShot(page, 'office-docx')
      for (const extension of ['doc', 'ppt', 'pptx']) {
        await openPreviewFile(column, filesTab, preview, `chinese.${extension}`)
        await preview.getByRole('img', { name: 'PDF page 1', exact: true }).waitFor({ state: 'visible', timeout: 60_000 })
        await expect.poll(async () => (await preview.locator('[data-pdf-text]').allTextContents()).join(''), { timeout: 30_000 }).toContain('中文文档')
        if (['doc', 'ppt'].includes(extension)) expect(await warning.count()).toBe(0)
        await successShot(page, `office-${extension}`)
      }
      expect(convert).toHaveBeenCalledTimes(4)
      await openPreviewFile(column, filesTab, preview, 'chinese.docx')
      await preview.getByRole('img', { name: 'PDF page 1', exact: true }).waitFor({ state: 'visible' })
      await preview.getByRole('button', { name: 'Read the file again', exact: true }).click()
      await expect.poll(() => convert.mock.calls.length).toBe(5)
      await preview.getByRole('img', { name: 'PDF page 1', exact: true }).waitFor({ state: 'visible' })
      await openPreviewFile(column, filesTab, preview, 'renamed.docx')
      await preview.getByText('Read failed: This Office file cannot be previewed. It may be damaged, password protected, or have the wrong extension.', { exact: true }).waitFor({ timeout: 30_000 })
      expect(await preview.locator('[data-textpreview-line]').count()).toBe(0)
      await successShot(page, 'office-invalid')
      expect(convert).toHaveBeenCalledTimes(6)
      for (const extension of ['doc', 'ppt']) {
        await openPreviewFile(column, filesTab, preview, `renamed.${extension}`)
        await preview.getByText('Read failed: This Office file cannot be previewed. It may be damaged, password protected, or have the wrong extension.', { exact: true }).waitFor({ timeout: 30_000 })
        expect(await preview.locator('[data-textpreview-line]').count()).toBe(0)
      }
      expect(convert).toHaveBeenCalledTimes(8)
      expect(tripwire.pageErrors).toEqual([])
    } finally { convert.mockRestore() }
  })
})
