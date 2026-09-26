// C-acceptance stage 1: add C:\Ai\dshd-c1-workspace via the in-page directory
// browser, then verify the workspace lands in the sidebar.
import { chromium } from 'file:///C:/Ai/Deepseek-Harness-Desktop/vendor/deepseek-harness/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/index.mjs'
import fs from 'node:fs'

const OUT = 'docs/superpowers/evidence/2026-09-25-upstream-adoption/c-phase'
fs.mkdirSync(OUT, { recursive: true })
const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png` }) }

const browser = await chromium.connectOverCDP('http://localhost:9333')
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('127.0.0.1:3080'))
if (!page) throw new Error('web page not found')
page.setDefaultTimeout(8000)

const newSessBtn = page.locator('[aria-label="在“dshd-c1-workspace”中新建会话"]')
let landed = await newSessBtn.count() > 0
if (!landed) {
  await page.getByLabel('添加工作区').first().click()
  const dialog = page.locator('[role="dialog"]').last()
  await dialog.waitFor({ state: 'visible' })
  await shot(page, 'c-stage1-browser-open')

  // Path zone: click "编辑路径" button -> the path input appears; type + Enter.
  await dialog.getByRole('button', { name: '编辑路径' }).click()
  const input = dialog.getByRole('textbox', { name: '编辑路径' })
  await input.fill('C:\\Ai\\dshd-c1-workspace')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
  await shot(page, 'c-stage1-path-typed')

  await dialog.getByRole('button', { name: '打开', exact: true }).click()
  await page.waitForTimeout(1500)
}
landed = await newSessBtn.count() > 0
await shot(page, 'c-stage1-workspace-listed')
fs.writeFileSync(`${OUT}/stage1.json`, JSON.stringify({ landed, ts: Date.now() }, null, 2))
console.log(JSON.stringify({ landed }, null, 1))
await browser.close()
if (!landed) process.exit(1)
