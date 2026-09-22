#!/usr/bin/env node
// Gate: docs/features/ card schema — field table (id/status/last verified),
// status enum, `_` filename prefix <-> killed, required sections for live
// cards, and README index <-> live-card sync.
import { join } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { repoRoot, runGate, fail, isMain, read } from './lib/gate.mjs'

const STATUSES = new Set(['active', 'proposed', 'killed'])
const REQUIRED_SECTIONS = ['## User paths', '## Invariants', '## Gates', '## Sources']
const META_FILES = new Set(['README.md', '_template.md'])

export function collect(root) {
  const violations = []
  const dir = join(root, 'docs/features')
  if (!existsSync(dir)) return violations
  const liveIds = []

  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.md') || META_FILES.has(name) || name.endsWith('.en.md')) continue
    const rel = `docs/features/${name}`
    const text = read(join(dir, name))
    const killed = name.startsWith('_')

    const id = text.match(/\|\s*\*\*id\*\*\s*\|\s*`([^`]+)`/)
    if (!id) fail(violations, rel, 'missing `**id**` field row')
    const status = text.match(/\|\s*\*\*status\*\*\s*\|\s*`([a-z]+)`/)
    if (!status) {
      fail(violations, rel, 'missing `**status**` field row')
    } else if (!STATUSES.has(status[1])) {
      fail(violations, rel, `unknown status \`${status[1]}\` (active | proposed | killed)`)
    } else {
      if (status[1] === 'killed' && !killed) fail(violations, rel, 'status killed requires `_` filename prefix')
      if (status[1] !== 'killed' && killed) fail(violations, rel, '`_` filename prefix is reserved for status killed')
    }
    if (!/\|\s*\*\*last verified\*\*\s*\|\s*\d{4}-\d{2}-\d{2}/.test(text)) {
      fail(violations, rel, 'missing or malformed `**last verified**` (needs `YYYY-MM-DD — …`)')
    }
    if (!killed) {
      for (const s of REQUIRED_SECTIONS) {
        if (!text.includes(`\n${s}`) && !text.startsWith(s)) fail(violations, rel, `missing section \`${s}\``)
      }
      // `Decision:` is a declared field in ## Sources — `none` or a link to an
      // existing docs/decisions/ record (the card says WHAT, the record WHY).
      const src = text.split('\n## Sources')[1]?.split('\n## ')[0] ?? ''
      const decision = src.split('\n').find((l) => /Decision/.test(l))
      if (!decision) {
        fail(violations, rel, 'missing `Decision:` line in ## Sources (`- Decision: none` or a docs/decisions/ link)')
      } else {
        for (const m of decision.matchAll(/docs\/decisions\/(\S+?\.md)/g)) {
          if (!existsSync(join(root, m[1]))) fail(violations, rel, `Decision link missing record ${m[1]}`)
        }
      }
      // Allowed touch paths must exist — but only for repo-root-anchored paths.
      // Cards also list package-relative fragments (`boot.css`), RPC endpoints
      // (`/api/respond`), schemes (`pet://`) and globs (`{a,b}.ts`) that are NOT
      // resolvable from the repo root; checking those produces noise. We only
      // verify tokens explicitly rooted at a known top-level dir (src/, scripts/,
      // mobile/, tools/, vendor/, docs/, assets/, build/, .github/). A path that
      // is intentionally not yet implemented must carry `(planned)` right after
      // it, honoured only on `status: proposed` cards — on an `active` card a
      // missing or `(planned)` path is a card<->code drift violation. Closes the
      // structural blind spot where a card could list files the gate never saw.
      const touch = text.split('\n## Allowed touch')[1]?.split('\n## ')[0] ?? ''
      const isActive = status && status[1] === 'active'
      // Only desktop-owned repo files are checkable: `src/`, `scripts/`,
      // `mobile/`, `tools/`, `assets/`, `build/`, `.github/`. Vendor paths are
      // guarded by `harness-desktop-forks` markers (a stronger mechanism), and
      // cards heavily use package-relative continuations (`src/client/index.ts`
      // after a `vendor/.../ui-theme/` anchor) that are NOT root-resolvable —
      // restricting to desktop-owned files keeps the signal noise-free.
      const ROOTED = /^(?:\.github|src|scripts|mobile|tools|assets|build)\/[^/]+\//
      // Cards use `src/client/...`, `src/styles/...`, `src/types.ts` etc. as
      // package-relative continuations under a vendored package (no such root
      // path). Desktop-owned files always use a real desktop area (`src/main/`,
      // `src/shared/`, `src/renderer/`, `src/host/`). Skip the vendored-package
      // continuation shapes; check everything else that resolves from the root.
      const PKG_REL = /^src\/(?:client|styles|host|core|common|server)\//
      for (const m of touch.matchAll(/`([^`]+)`/g)) {
        const token = m[1].trim()
        if (!ROOTED.test(token)) continue // vendor / package-relative / basename / endpoint / scheme
        if (PKG_REL.test(token)) continue // vendored-package continuation, not desktop src/
        if (/[*{}]|\$\{/.test(token)) continue // glob or template, not literal
        // Only concrete FILES are checked; bare dirs act as anchors whose
        // following tokens are package-relative continuations.
        if (!/\.[A-Za-z0-9]+$/.test(token.replace(/\/+$/, ''))) continue
        const planned = /\(planned\)/i.test(touch.slice(m.index + m[0].length, m.index + m[0].length + 24))
        if (planned && !isActive) continue
        if (planned && isActive) {
          fail(violations, rel, `Allowed touch lists not-yet-implemented \`${token}\` on an active card (only allowed on status: proposed)`)
          continue
        }
        const abs = join(root, token.endsWith('/') ? token.slice(0, -1) : token)
        if (!existsSync(abs)) {
          fail(violations, rel, `Allowed touch path missing: \`${token}\``)
        }
      }
      if (id) liveIds.push(id[1])
    }
  }

  // README index <-> live cards sync.
  const readmePath = join(dir, 'README.md')
  if (existsSync(readmePath)) {
    const readme = read(readmePath)
    const indexed = new Set([...readme.matchAll(/\|\s*\[([a-z0-9-]+)\]\(([a-z0-9-]+)\.md\)/g)].map((m) => m[1]))
    for (const id of liveIds) {
      if (!indexed.has(id)) fail(violations, 'docs/features/README.md', `index missing live card \`${id}\``)
    }
    for (const id of indexed) {
      if (!existsSync(join(dir, `${id}.md`))) fail(violations, 'docs/features/README.md', `index links missing card \`${id}.md\``)
    }
  }
  return violations
}

if (isMain(import.meta.url)) {
  runGate('verify-feature-cards', collect, repoRoot())
}
