#!/usr/bin/env node
/**
 * CDP smoke: Settings → Remote dual tabs + channels rail; sidebar popup has no LAN/Relay.
 * Env: DSH_CDP_PORT (default 9333)
 */
const port = Number(process.env.DSH_CDP_PORT || 9333)

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`)
  if (!res.ok) throw new Error(`CDP list failed: ${res.status}`)
  return res.json()
}

function cdpSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let nextId = 1
    const pending = new Map()
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const id = nextId++
        return new Promise((res, rej) => {
          pending.set(id, { res, rej })
          ws.send(JSON.stringify({ id, method, params }))
        })
      },
      close() { try { ws.close() } catch { /* ignore */ } },
    }))
    ws.addEventListener('error', (err) => reject(err))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) rej(new Error(JSON.stringify(msg.error)))
        else res(msg.result)
      }
    })
  })
}

async function main() {
  const targets = await listTargets()
  const page = targets.find((t) => t.type === 'page' && /^https?:\/\/(127\.0\.0\.1|localhost):3080/i.test(t.url))
    || targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page?.webSocketDebuggerUrl) throw new Error('no harness page')

  const session = await cdpSession(page.webSocketDebuggerUrl)
  await session.send('Runtime.enable')

  async function ev(expression) {
    const result = await session.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result.result?.value
  }

  let ready = false
  for (let i = 0; i < 60; i++) {
    ready = await ev(`Boolean(document.querySelector('[data-dsh-remote-trigger]'))`)
    if (ready) break
    await new Promise((r) => setTimeout(r, 500))
  }
  if (!ready) {
    console.log(JSON.stringify({ ok: false, reason: 'no remote trigger' }))
    session.close()
    process.exit(1)
  }

  await ev(`(() => { document.querySelector('[data-dsh-remote-trigger]').click(); return true })()`)
  await new Promise((r) => setTimeout(r, 400))
  const popup = await ev(`(() => {
    const dialog = document.querySelector('[role="dialog"]')
    const radios = dialog
      ? [...dialog.querySelectorAll('[role="radio"]')].map((el) => (el.textContent || '').trim())
      : []
    return {
      hasDialog: Boolean(dialog),
      radios,
      hasModeLan: radios.includes('局域网') || radios.includes('LAN'),
      hasModeRelay: radios.includes('服务器中继') || radios.includes('Relay'),
    }
  })()`)
  await ev(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true })()`)
  await new Promise((r) => setTimeout(r, 200))

  // Same contract as settings-jump buildSettingsSectionScript
  const opened = await ev(`(() => {
    const trigger = document.querySelector('[data-dsh-settings-trigger]')
    if (!trigger) return false
    if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click()
    return new Promise((resolve) => {
      let n = 0
      const tick = () => {
        const nav = document.querySelector('[data-dsh-settings-section="remote"]')
        if (nav) {
          nav.click()
          resolve(true)
          return
        }
        if (n++ > 40) {
          resolve(false)
          return
        }
        requestAnimationFrame(tick)
      }
      tick()
    })
  })()`)
  await new Promise((r) => setTimeout(r, 800))

  let settings = null
  for (let i = 0; i < 20; i++) {
    settings = await ev(`(() => {
      const tabs = [...document.querySelectorAll('[role="tab"]')].map((el) => (el.textContent || '').trim())
      const gateway = document.querySelector('[data-dsh-remote-gateway]')
      const text = gateway?.textContent || ''
      const modeGroup = gateway
        ? [...gateway.querySelectorAll('[role="radiogroup"]')].find((el) => {
            const label = (el.getAttribute('aria-label') || '').trim()
            return label === '连接方式' || label === 'Connection'
          })
        : null
      const modeRadios = modeGroup
        ? [...modeGroup.querySelectorAll('[role="radio"]')].map((el) => (el.textContent || '').trim())
        : []
      const urlAt = text.indexOf('中继地址') >= 0 ? text.indexOf('中继地址') : text.indexOf('Relay origin')
      const tokenAt = text.indexOf('中继宿主令牌') >= 0 ? text.indexOf('中继宿主令牌') : text.indexOf('Relay host token')
      const modeAt = text.indexOf('连接方式') >= 0 ? text.indexOf('连接方式') : text.indexOf('Connection')
      return {
        tabs: tabs.slice(0, 30),
        hasGateway: tabs.includes('网关') || tabs.includes('Gateway'),
        hasChannels: tabs.includes('消息渠道') || tabs.includes('Channels'),
        hasGatewayPage: Boolean(gateway),
        modeRadioCount: modeRadios.length,
        modeRadios,
        credentialsBeforeMode: urlAt >= 0 && tokenAt > urlAt && modeAt > tokenAt,
        modeHorizontal: Boolean(modeGroup && getComputedStyle(modeGroup).flexDirection === 'row'),
      }
    })()`)
    if (settings.hasGateway && settings.hasChannels) break
    await new Promise((r) => setTimeout(r, 300))
  }

  if (settings?.hasChannels) {
    await ev(`(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((el) => {
        const t = (el.textContent || '').trim()
        return t === '消息渠道' || t === 'Channels'
      })
      if (tab) tab.click()
      return true
    })()`)
    await new Promise((r) => setTimeout(r, 800))
  }

  const channels = await ev(`(() => {
    const text = document.body?.innerText || ''
    const need = ['微信', '飞书', '钉钉', '企业微信', 'QQ']
    const found = need.filter((name) => text.includes(name))
    const office = text.includes('AI Office') || /\\bOffice\\b/.test(text)
    const rail = [...document.querySelectorAll('[role="tab"], .dim-channel')].map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 20)
    const brand = /DSH-IM/.test(text) || /触手可及/.test(text)
    const githubLink = Boolean(document.querySelector('a.dim-githubLink, a[href*="github.com/xmanrui/dsh-im"]'))
    const storeHeader = Boolean(document.querySelector('header.dim-title, .dim-brandName'))
    const githubWord = /\bGitHub\b/.test(text)
    return {
      found,
      office,
      rail,
      hasDimPage: Boolean(document.querySelector('.dim-page')),
      noStoreChrome: !brand && !githubLink && !storeHeader && !githubWord,
      brand,
      githubLink,
      storeHeader,
      githubWord,
    }
  })()`)

  const remoteSnap = await ev(`(() => {
    if (!window.shell || typeof window.shell.getRemote !== 'function') return null
    return window.shell.getRemote().then((snap) => ({
      relayUrl: snap?.relayUrl || '',
      relayConfigured: Boolean(snap?.relayConfigured),
      relayTokenSet: Boolean(snap?.relayTokenSet),
      mode: snap?.mode || '',
    }))
  })()`)

  const ok = popup.hasDialog && !popup.hasModeLan && !popup.hasModeRelay
    && opened
    && settings?.hasGateway && settings?.hasChannels
    && settings?.credentialsBeforeMode
    && settings?.modeRadioCount === 2
    && channels.found.length >= 5
    && channels.noStoreChrome

  console.log(JSON.stringify({ ok, opened, popup, settings, channels, remoteSnap }, null, 2))
  session.close()
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
