import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { chromium } from '../../../../vendor/deepseek-harness/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/index.mjs'

const browser = await chromium.connectOverCDP('http://localhost:9335')
try {
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('127.0.0.1:3080'))
  assert.ok(page, 'source desktop must be running')
  if (!await page.getByRole('button', { name: '用量统计', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '账号菜单', exact: true }).click()
    await page.getByRole('menuitem', { name: /设置/ }).click()
  }
  await page.getByRole('button', { name: '用量统计', exact: true }).click()
  const cache = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('dsh-usage-panel:overview:'))
    return key ? JSON.parse(localStorage[key]) : null
  })
  const samples = []
  for (let i = 0; i < 3; i++) {
    const before = await cache()
    await page.getByRole('button', { name: '刷新', exact: true }).click()
    await page.waitForFunction(savedAt => {
      const key = Object.keys(localStorage).find(k => k.startsWith('dsh-usage-panel:overview:'))
      return key && JSON.parse(localStorage[key]).savedAt > savedAt
    }, before?.savedAt ?? 0)
    const { payload } = await cache()
    assert.ok(payload.allTime.totals.total > 0)
    assert.equal(payload.coverage.sessionsFailed, 0)
    const ids = payload.topSessions.map(s => s.id)
    assert.equal(new Set(ids).size, ids.length, 'refresh must not duplicate session rows')
    const original = payload.topSessions.find(s => s.title === '你好')
    assert.equal(original?.totals.total, 14284, 'original reported conversation must be counted')
    samples.push({ total: payload.allTime.totals.total, sessions: payload.allTime.sessionCount, originalTokens: original.totals.total })
  }
  assert.deepEqual(samples[1], samples[0], 'unchanged corpus must remain stable on refresh')
  assert.deepEqual(samples[2], samples[0])
  assert.equal(await page.getByText('暂无统计数据', { exact: true }).count(), 0)
  await writeFile(new URL('result.json', import.meta.url), JSON.stringify({ passed: true, samples }, null, 2) + '\n')
  await page.getByRole('dialog').screenshot({ path: new URL('dashboard.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') })
  console.log(JSON.stringify({ passed: true, samples }))
} finally {
  await browser.close()
}
