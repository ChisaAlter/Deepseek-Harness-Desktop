import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collect } from './verify-feature-cards.mjs'
import { makeFixture } from './lib/fixture.mjs'

const CARD = `# Feature: x

| Field | Value |
| --- | --- |
| **id** | \`x-card\` |
| **status** | \`active\` |
| **last verified** | 2026-09-17 — smoke |

## User paths

1. a

## Invariants

- i

## Gates

| Kind | What |
| --- | --- |
| Automated | none |

## Sources

- Decision: none
`

test('accepts a well-formed card indexed in README', (t) => {
  const root = makeFixture(t, {
    'docs/features/x-card.md': CARD,
    'docs/features/README.md': '# Feature Spine\n\n| [x-card](x-card.md) | a | b | c |\n',
  })
  assert.deepEqual(collect(root), [])
})

test('rejects missing status and unindexed cards', (t) => {
  const root = makeFixture(t, {
    'docs/features/y.md': CARD.replace('| **status** | `active` |\n', '').replace('`x-card`', '`y`'),
    'docs/features/README.md': '# Feature Spine\n',
  })
  const v = collect(root).join('\n')
  assert.match(v, /missing `\*\*status\*\*`/)
  assert.match(v, /index missing live card `y`/)
})

test('flags missing desktop-owned Allowed touch files on active cards', (t) => {
  const root = makeFixture(t, {
    'docs/features/x-card.md': CARD.replace('## Sources', '## Allowed touch\n\n- `src/main/does-not-exist.js` — the thing\n- `src/shared/exists.js` — real\n\n## Sources'),
    'docs/features/README.md': '# Feature Spine\n\n| [x-card](x-card.md) | a | b | c |\n',
    'src/shared/exists.js': '// real\n',
  })
  const v = collect(root).join('\n')
  assert.match(v, /Allowed touch path missing: `src\/main\/does-not-exist\.js`/)
  assert.doesNotMatch(v, /src\/shared\/exists\.js/)
})

test('skips vendored-package continuations and vendor paths', (t) => {
  const root = makeFixture(t, {
    'docs/features/x-card.md': CARD.replace('## Sources', '## Allowed touch\n\n- `vendor/deepseek-harness/packages/client/ui-theme/src/theme-settings.ts`、`src/client/index.ts` — wiring\n- `src/renderer/real.js` — desktop file\n\n## Sources'),
    'docs/features/README.md': '# Feature Spine\n\n| [x-card](x-card.md) | a | b | c |\n',
    'src/renderer/real.js': '// real\n',
  })
  // vendor path + `src/client/index.ts` continuation must NOT be flagged;
  // existing desktop file must NOT be flagged.
  assert.deepEqual(collect(root), [])
})

test('rejects (planned) paths on active cards but allows them on proposed', (t) => {
  const planned = '- `src/main/future.js` (planned) — not yet built\n'
  const activeRoot = makeFixture(t, {
    'docs/features/x-card.md': CARD.replace('## Sources', `## Allowed touch\n\n${planned}\n## Sources`),
    'docs/features/README.md': '# Feature Spine\n\n| [x-card](x-card.md) | a | b | c |\n',
  })
  assert.match(collect(activeRoot).join('\n'), /not-yet-implemented `src\/main\/future\.js` on an active card/)
  const proposedRoot = makeFixture(t, {
    'docs/features/x-card.md': CARD.replace('`active`', '`proposed`').replace('## Sources', `## Allowed touch\n\n${planned}\n## Sources`),
    'docs/features/README.md': '# Feature Spine\n\n| [x-card](x-card.md) | a | b | c |\n',
  })
  assert.deepEqual(collect(proposedRoot), [])
})

test('killed cards need the underscore prefix and vice versa', (t) => {
  const root = makeFixture(t, {
    'docs/features/z.md': CARD.replace('`active`', '`killed`').replace('`x-card`', '`z`'),
    'docs/features/_w.md': CARD.replace('`x-card`', '`w`'),
  })
  const v = collect(root).join('\n')
  assert.match(v, /status killed requires `_`/)
  assert.match(v, /reserved for status killed/)
})
