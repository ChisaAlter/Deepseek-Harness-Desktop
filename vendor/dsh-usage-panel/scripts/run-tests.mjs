#!/usr/bin/env node
// Compile tests/**/*.test.ts with esbuild (node ESM, deps external) into
// tests-dist/ and run them with the Node built-in test runner.
import { build } from 'esbuild'
import { globSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const entries = globSync('tests/**/*.test.ts', { cwd: pluginRoot }).map((file) => join(pluginRoot, file))
if (!entries.length) {
  console.error('[run-tests] no tests found under tests/**/*.test.ts')
  process.exit(1)
}

await build({
  entryPoints: entries,
  outdir: join(pluginRoot, 'tests-dist'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
})

const testFiles = globSync('tests-dist/**/*.test.js', { cwd: pluginRoot })
const res = spawnSync('node', ['--test', ...testFiles], {
  cwd: pluginRoot,
  stdio: 'inherit',
})
process.exit(res.status ?? 1)
