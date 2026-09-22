#!/usr/bin/env node
// Gate: in-file format of docs/decisions/ records — fixed header, folder-agreeing
// Status, ## Problem opener, mandatory ## Alternatives considered, and the
// per-lifecycle section skeleton. Both .md and .en.md are checked; the
// machine-checked tokens (# Decision:, Status:) stay English in both.
import { join } from 'node:path'
import { repoRoot, runGate, fail, walk, isMain, read } from './lib/gate.mjs'

const PROPOSAL_ERA = ['## Proposal', '## Plan', '## Migration plan', '## Acceptance criteria', '## Risks']
const STATUS_OK = {
  proposed: /^Status: proposed$/,
  implemented: /^Status: implemented$/,
  rejected: /^Status: rejected — \S/,
  archived: /^Status: implemented$/,
}
const REQUIRED = {
  proposed: ['## Problem', '## Proposal', '## Alternatives considered', '## Acceptance criteria', '## Risks'],
  implemented: ['## Problem', '## Decision', '## Alternatives considered', '## Consequences'],
  rejected: ['## Problem', '## Alternatives considered'],
  archived: ['## Problem', '## Decision', '## Alternatives considered', '## Consequences'],
}

export function collect(root) {
  const violations = []
  const dir = join(root, 'docs/decisions')
  for (const p of walk(dir)) {
    const rel = p.slice(dir.length + 1).replace(/\\/g, '/')
    const m = rel.match(/^([^/]+)\/[^/]+\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+(?:\.en)?\.md$/)
    if (!m) continue
    const lifecycle = m[1]
    if (!STATUS_OK[lifecycle]) continue // unknown lifecycle dir — the tree gate reports it
    const lines = read(p).replace(/\r\n/g, '\n').split('\n')

    if (!lines[0]?.startsWith('# Decision: ') || lines[0].length <= 12) {
      fail(violations, `docs/decisions/${rel}`, 'line 1 must be `# Decision: <title>`')
    }
    if (lines[1] !== '') fail(violations, `docs/decisions/${rel}`, 'line 2 must be blank')
    const statusLine = lines[2] ?? ''
    if (!statusLine.startsWith('Status: ')) {
      fail(violations, `docs/decisions/${rel}`, 'line 3 must be `Status: <status>`')
    } else if (!STATUS_OK[lifecycle].test(statusLine)) {
      fail(violations, `docs/decisions/${rel}`, `Status does not match lifecycle folder ${lifecycle}: \`${statusLine}\``)
    }
    if (lifecycle === 'archived') {
      const archived = lines.slice(3, 6).some((l) => /^Archived: \d{4}-\d{2}-\d{2}$/.test(l))
      if (!archived) fail(violations, `docs/decisions/${rel}`, 'archived record needs `Archived: YYYY-MM-DD` directly below Status')
    }

    const sections = lines.filter((l) => l.startsWith('## ')).map((l) => l.trim())
    for (const req of REQUIRED[lifecycle]) {
      if (!sections.includes(req)) fail(violations, `docs/decisions/${rel}`, `missing required section \`${req}\``)
    }
    if (sections[0] !== '## Problem') {
      fail(violations, `docs/decisions/${rel}`, 'first section must be `## Problem`')
    }
    if (lifecycle === 'implemented' || lifecycle === 'archived') {
      for (const s of sections) {
        if (PROPOSAL_ERA.includes(s)) fail(violations, `docs/decisions/${rel}`, `proposal-era section \`${s}\` is not allowed in ${lifecycle}`)
      }
    }
  }
  return violations
}

if (isMain(import.meta.url)) {
  runGate('verify-decision-format', collect, repoRoot())
}
