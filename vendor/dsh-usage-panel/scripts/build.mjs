#!/usr/bin/env node
// Build pipeline:
//   1. esbuild  host   : src/host/index.ts        → lib/index.js   (ESM, all deps external)
//   2. esbuild  client : src/client/index.tsx     → .tmp/client.cjs (CJS bundle, react + ui-primitives external)
//   3. wrap-client     : .tmp/client.cjs          → lib/client.js  (window.__ModuleLoader__.load factory)
//   4. tsc             : declaration emit for the host half → lib/host/*.d.ts + lib/shared/*.d.ts
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
mkdirSync(join(pluginRoot, '.tmp'), { recursive: true })

await build({
  entryPoints: [join(pluginRoot, 'src/host/index.ts')],
  outfile: join(pluginRoot, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  packages: 'external',
  sourcemap: false,
  logLevel: 'info',
})

await build({
  entryPoints: [join(pluginRoot, 'src/client/index.tsx')],
  outfile: join(pluginRoot, '.tmp/client.cjs'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'transform',
  external: ['react', '@deepseek-ai/dsh-client-ui-primitives'],
  sourcemap: false,
  logLevel: 'info',
})

const { wrapClient } = await import('./wrap-client.mjs')
wrapClient(join(pluginRoot, '.tmp/client.cjs'), join(pluginRoot, 'lib/client.js'))

try {
  execFileSync('npx', ['tsc', '-p', 'tsconfig.host.json'], { cwd: pluginRoot, stdio: 'inherit', shell: true })
} catch {
  console.warn('[build] skip tsc (typescript not available)')
}
console.log('[build] done: lib/index.js, lib/client.js')
