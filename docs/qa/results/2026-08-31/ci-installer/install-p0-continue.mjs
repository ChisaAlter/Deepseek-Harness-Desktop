#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertOfficialLauncherBg,
  attachHarness,
  attachLauncher,
  CI_RUN,
  killProduct,
  LAUNCHER_SAMPLE_JS,
  listUrls,
  loadConfig,
  productExe,
  saveConfigPatch,
  SETUP_SHA256,
  sleep,
  spawnInstalled,
  uiSample,
  userData,
  waitFor,
  waitForHarnessUrl,
} from './install-qa-lib.mjs'

const outDir = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.DSHD_QA_PORT || 9474)

const report = {
  at: new Date().toISOString(),
  productExe,
  userData,
  ciRun: CI_RUN,
  setupSha256: SETUP_SHA256,
  checks: [],
  pass: false,
}

const priorConfig = loadConfig()
killProduct()
await sleep(2000)

try {
  // TC-LAUNCH-002: autoStartDesktop true, non-empty home → auto ready
  saveConfigPatch({ autoStartDesktop: true, quitAfterStart: false, askOnUpdate: false, theme: 'celadon' })
  spawnInstalled(port)
  const autoHarness = await waitForHarnessUrl(port, 300_000)
  let cdp = null
  try {
    cdp = await attachLauncher(port, 30_000)
  } catch {
    cdp = null
  }
  const auto = cdp
    ? await waitFor(async () => {
      const sample = await uiSample(cdp)
      const urls = await listUrls(port)
      const ok = (sample.state === 'ready' || /关闭桌面端/.test(sample.btnStart))
        && urls.some((url) => /127\.0\.0\.1:\d+/i.test(url))
      return { ok, sample, urls }
    }, 60_000, 2000)
    : { ok: autoHarness.ok, sample: null, urls: autoHarness.urls, via: 'harness-only' }
  report.checks.push({ id: 'TC-LAUNCH-002-auto', pass: auto.ok, ...auto })
  if (cdp) await cdp.shot(outDir, '05-auto-start-ready.png')

  // TC-INST-002: second launch focuses existing instance
  if (!cdp) {
    cdp = await attachLauncher(port, 60_000)
  }
  const beforeCount = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Deepseek-Harness-Desktop.exe', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  }).stdout.split('\n').filter((line) => /Deepseek-Harness-Desktop\.exe/i.test(line)).length
  spawnInstalled(null)
  await sleep(2500)
  const afterCount = spawnSync('tasklist', ['/FI', 'IMAGENAME eq Deepseek-Harness-Desktop.exe', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  }).stdout.split('\n').filter((line) => /Deepseek-Harness-Desktop\.exe/i.test(line)).length
  const stillOneHarness = (await listUrls(port)).filter((url) => /127\.0\.0\.1:\d+/i.test(url)).length === 1
  report.checks.push({
    id: 'TC-INST-002',
    pass: stillOneHarness && afterCount <= beforeCount + 2,
    beforeCount,
    afterCount,
    stillOneHarness,
  })

  // TC-LAUNCH-006 (partial): close launcher, harness keeps running
  await cdp.eval(`window.shell?.windowAction?.('close')`)
  await sleep(1500)
  const urlsAfterClose = await listUrls(port)
  const harnessUp = urlsAfterClose.some((url) => /127\.0\.0\.1:\d+/i.test(url))
  const launcherHidden = !urlsAfterClose.some((url) => /launcher\.html/i.test(url))
  report.checks.push({
    id: 'TC-LAUNCH-006-close-launcher',
    pass: harnessUp && launcherHidden,
    urlsAfterClose,
  })

  let reopen = { pass: false, blocked: true, note: 'openLauncher IPC missing on installed build' }
  try {
    const harnessCdp = await attachHarness(port, 30_000)
    try {
      const invoked = await harnessCdp.eval(`Promise.resolve(typeof window.shell?.openLauncher === 'function'
        ? window.shell.openLauncher()
        : { ok: false, reason: 'missing' })`)
      await sleep(1500)
      const urlsAfterReopen = await listUrls(port)
      const launcherVisible = urlsAfterReopen.some((url) => /launcher\.html/i.test(url))
      reopen = {
        pass: Boolean(launcherVisible && invoked?.ok !== false),
        blocked: false,
        invoked,
        launcherVisible,
        urlsAfterReopen,
      }
      if (reopen.pass) {
        try {
          const launcherCdp = await attachLauncher(port, 15_000)
          await launcherCdp.shot(outDir, '06-launcher-reopen.png')
          launcherCdp.close()
        } catch {
          // screenshot is optional evidence
        }
      }
    } finally {
      harnessCdp.close()
    }
  } catch (error) {
    reopen = {
      pass: false,
      blocked: false,
      error: String(error instanceof Error ? error.message : error),
    }
  }
  report.checks.push({ id: 'TC-LAUNCH-006-reopen', ...reopen })

  // TC-LAUNCH-007: celadon family in config but launcher uses official chrome
  killProduct()
  await sleep(4000)
  saveConfigPatch({ autoStartDesktop: false, theme: 'celadon' })
  spawnInstalled(port)
  let themeCdp
  try {
    themeCdp = await attachLauncher(port, 240_000)
  } catch (error) {
    report.checks.push({
      id: 'TC-LAUNCH-007-dark',
      pass: false,
      blocked: true,
      note: `launcher attach after restart: ${error.message}`,
    })
    throw error
  }
  await themeCdp.eval(`document.querySelector('[data-tab="home"]')?.click()`)
  await sleep(500)
  const darkSample = await themeCdp.eval(LAUNCHER_SAMPLE_JS)
  const scheme = darkSample.dark ? 'dark' : 'light'
  const themeFails = assertOfficialLauncherBg(darkSample, scheme)
  await themeCdp.shot(outDir, '06-launcher-dark-official.png')

  // Force light: save preference via harness settings yaml is heavy; toggle via shell theme if exposed
  const configProbe = await themeCdp.eval(`Promise.resolve(window.shell?.getConfig?.() || null)`)
  report.checks.push({
    id: 'TC-LAUNCH-007-official-chrome',
    pass: themeFails.length === 0,
    scheme,
    sample: darkSample,
    themeFails,
    configProbe,
    note: 'launcher chrome stays official while harness theme may differ (theme is not launcher-writable)',
  })

  report.checks.push({
    id: 'TC-LAUNCH-003',
    pass: false,
    blocked: true,
    note: 'installed 0.2.7 newer than /releases/latest 0.2.6; cannot prompt update without downgrading',
  })
  report.checks.push({
    id: 'TC-LAUNCH-004',
    pass: false,
    blocked: true,
    note: 'dest sessions non-empty (29 importable rows in scan); empty-home path not applicable',
  })

  themeCdp.close()
  report.pass = report.checks.filter((row) => !row.blocked).every((row) => row.pass)
} catch (error) {
  report.error = error.message || String(error)
  report.pass = false
} finally {
  killProduct()
  saveConfigPatch({
    autoStartDesktop: priorConfig.autoStartDesktop,
    quitAfterStart: priorConfig.quitAfterStart,
    askOnUpdate: priorConfig.askOnUpdate,
    theme: priorConfig.theme,
  })
}

writeFileSync(path.join(outDir, 'install-p0-continue-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({
  pass: report.pass,
  checks: report.checks.map((row) => ({ id: row.id, pass: row.pass, blocked: row.blocked })),
  error: report.error,
}, null, 2))
if (!report.pass) process.exitCode = 1
