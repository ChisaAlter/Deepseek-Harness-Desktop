// Shared helpers for scripts/verify-*.mjs gates and their specs.
// Every gate accepts `--root <dir>` so specs can run against a fixture tree.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export function repoRoot(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--root')
  if (i !== -1 && argv[i + 1]) return resolve(argv[i + 1])
  return resolve(import.meta.dirname, '..', '..')
}

export function* walk(dir) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(p)
    else if (st.isFile()) yield p
  }
}

export function rel(root, p) {
  return relative(root, p).split(sep).join('/')
}

export function read(p) {
  return readFileSync(p, 'utf8')
}

export function fail(list, file, msg) {
  list.push(`${file}: ${msg}`)
}

/** Run a gate: collect violations, print them, exit non-zero on any. */
export function runGate(name, collect, root) {
  const violations = collect(root)
  if (violations.length) {
    console.error(`${name}: ${violations.length} violation(s)`)
    for (const v of violations) console.error(`  ${v}`)
    process.exitCode = 1
  } else {
    console.log(`${name}: ok`)
  }
  return violations
}

/** True when argv contains a bare flag like --write or --list. */
export function hasFlag(argv, flag) {
  return argv.includes(flag)
}

/** True when the module is the process entrypoint (cross-platform). */
export function isMain(importMetaUrl, argv = process.argv) {
  return argv[1] && importMetaUrl === pathToFileURL(resolve(argv[1])).href
}
