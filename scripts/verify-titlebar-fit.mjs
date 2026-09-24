/**
 * Live Electron titlebar geometry check. Start the source app with
 * --remote-debugging-port=9333, leave a normal workspace Session selected,
 * then run `node scripts/verify-titlebar-fit.mjs`.
 */
const port = Number(process.env.DSH_CDP_PORT || 9333)
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
// Conversation titles replace the default page title, so identify the local
// Harness page by URL rather than requiring its title to contain "Harness".
const target = tabs.find(tab => tab.type === 'page' && /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+\//.test(tab.url))
if (!target) throw new Error('Harness renderer target missing')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
let nextId = 0
const pending = new Map()
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data)
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  if (message.error) entry.reject(new Error(message.error.message))
  else entry.resolve(message.result)
})
function call(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`CDP timeout: ${method}`))
    }, 5000)
    pending.set(id, {
      resolve: value => { clearTimeout(timer); resolve(value) },
      reject: error => { clearTimeout(timer); reject(error) },
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text)
  return response.result.value
}
const measure = `(() => {
  const frame = document.querySelector('[data-titlebar-density]')
  const row = document.querySelector('[data-dshd-caption="title"]')
  const trailing = document.querySelector('[data-titlebar-trailing]')
  if (!frame || !row || !trailing) return null
  const rect = element => {
    if (!element || getComputedStyle(element).display === 'none') return null
    const r = element.getBoundingClientRect()
    return { left: r.left, right: r.right, width: r.width }
  }
  return {
    viewport: innerWidth,
    surfacesOpen: !frame.hasAttribute('data-surfaces-collapsed'),
    density: frame.getAttribute('data-titlebar-density'),
    actionButtons: row.querySelector('[class*="headerActions"]')?.querySelectorAll('button').length ?? 0,
    utilityButtons: row.querySelector('[class*="headerUtilities"]')?.querySelectorAll('button').length ?? 0,
    actions: rect(row.querySelector('[class*="headerActions"]')),
    utilities: rect(row.querySelector('[class*="headerUtilities"]')),
    trailing: rect(trailing),
  }
})()`

try {
  let state = await evaluate(measure)
  if (!state) throw new Error('Select a normal Session before running the titlebar geometry check')
  if (!state.surfacesOpen) {
    await evaluate(`document.querySelector('[data-titlebar-trailing] button[aria-label="切换右侧栏"]')?.click()`)
    await new Promise(resolve => setTimeout(resolve, 500))
    state = await evaluate(measure)
  }
  if (!state?.surfacesOpen) throw new Error('Could not open the surfaces column')
  if (state.actionButtons < 1 || state.utilityButtons < 1) {
    throw new Error('Select a normal workspace Session with Agent actions and an application opener')
  }
  if (!state.utilities || !state.trailing) throw new Error('Titlebar utility or trailing cluster missing')
  const actionGap = state.actions ? state.utilities.left - state.actions.right : null
  const trailingGap = state.trailing.left - state.utilities.right
  console.log(JSON.stringify({ ...state, actionGap, trailingGap }, null, 2))
  if (actionGap !== null && actionGap < 8) throw new Error(`Header actions overlap utilities: gap ${actionGap.toFixed(1)}px`)
  if (trailingGap < 8) throw new Error(`Header utilities overlap trailing cluster: gap ${trailingGap.toFixed(1)}px`)
  console.log('PASS: titlebar controls keep at least 8px clearance with the right column open')
} finally {
  socket.close()
}
