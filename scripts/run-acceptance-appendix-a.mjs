#!/usr/bin/env node
/**
 * Appendix-A multi-turn probe against the configured OpenAI-compatible gateway.
 * Does NOT replace in-app tool-card acceptance; records gateway+memory evidence.
 *
 * Env:
 *   DSH_ACCEPT_API_KEY   (required)
 *   DSH_ACCEPT_BASE_URL  (default https://ayase.cn/v1)
 *   DSH_ACCEPT_MODEL     (default grok-4.6)
 *   DSH_ACCEPT_WORKSPACE  (default cwd) — used to inject real README + cwd for turns 3–5
 *   DSH_ACCEPT_OUT        (optional JSON result path)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const baseURL = (process.env.DSH_ACCEPT_BASE_URL || 'https://ayase.cn/v1').replace(/\/$/, '')
const model = process.env.DSH_ACCEPT_MODEL || 'grok-4.6'
const apiKey = process.env.DSH_ACCEPT_API_KEY || ''
const workspace = process.env.DSH_ACCEPT_WORKSPACE || process.cwd()
const outPath = process.env.DSH_ACCEPT_OUT || ''

if (!apiKey) {
  console.error('DSH_ACCEPT_API_KEY is required')
  process.exit(2)
}

function readReadme() {
  for (const name of ['README.md', 'README.en.md', 'README']) {
    const p = path.join(workspace, name)
    if (existsSync(p)) return { name, text: readFileSync(p, 'utf8').slice(0, 8000) }
  }
  return { name: '(missing)', text: '(no README in workspace)' }
}

function cwdName() {
  const r = spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'bash',
    process.platform === 'win32' ? ['/c', 'cd'] : ['-lc', 'pwd'],
    { cwd: workspace, encoding: 'utf8', windowsHide: true })
  return (r.stdout || '').trim() || workspace
}

async function chat(messages) {
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, messages, temperature: 0.2 }),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`)
  }
  const json = JSON.parse(text)
  const content = json.choices?.[0]?.message?.content
  if (!content) throw new Error(`empty content: ${text.slice(0, 300)}`)
  return String(content)
}

const readme = readReadme()
const dirPrinted = cwdName()
const messages = []
const turns = []

async function userTurn(id, content, expect) {
  messages.push({ role: 'user', content })
  const reply = await chat(messages)
  messages.push({ role: 'assistant', content: reply })
  const ok = expect(reply)
  turns.push({ id, ok, user: content, reply: reply.slice(0, 1200) })
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id}`)
  console.log(reply.slice(0, 800))
  console.log('---')
  return ok
}

let code = 0
try {
  let verifyCode = null
  const t1 = await userTurn('TC-CHAT-001', '用一句话回复：你已连通，并给出一个三位数验证码。', (r) => {
    const m = r.match(/(?<!\d)(\d{3})(?!\d)/)
    if (m) verifyCode = m[1]
    return /连通|已连|PING|ok|好|收到/i.test(r) && Boolean(verifyCode)
  })
  const t2 = await userTurn('TC-CHAT-002', '刚才的验证码是多少？只回答数字。', (r) => {
    const digits = (r.match(/\d{3}/) || [])[0]
    return Boolean(verifyCode) && digits === verifyCode
  })
  // Tool rounds: inject real workspace facts as the next user message context
  // (gateway-only probe). In-app must still show tool cards separately.
  const t3 = await userTurn(
    'TC-CHAT-003',
    `下面是工作区文件 ${readme.name} 的内容，用三句话总结它是什么产品：\n\n${readme.text}`,
    (r) => r.length > 20 && /Deepseek|Harness|Desktop|桌面|客户端|产品/i.test(r),
  )
  const t4 = await userTurn(
    'TC-CHAT-004',
    `工作区执行 cd/pwd 得到的目录输出是：\n${dirPrinted}\n请把该输出原样贴给我。`,
    (r) => r.includes(dirPrinted) || r.includes(path.basename(workspace)),
  )
  const t5 = await userTurn(
    'TC-CHAT-005',
    '汇总：验证码、产品一句话、目录名各一行。',
    (r) => Boolean(verifyCode) && r.includes(verifyCode) && r.length > 10,
  )
  if (![t1, t2, t3, t4, t5].every(Boolean)) code = 1
} catch (error) {
  console.error(String(error))
  code = 1
}

const result = {
  ok: code === 0,
  mode: 'gateway-appendix-a',
  note: 'Gateway multi-turn only; in-app tool UI still required for full P0.',
  baseURL,
  model,
  workspace,
  turns,
}
if (outPath) writeFileSync(outPath, JSON.stringify(result, null, 2))
console.log(JSON.stringify({ ok: result.ok, turns: turns.map((t) => ({ id: t.id, ok: t.ok })) }, null, 2))
process.exit(code)
