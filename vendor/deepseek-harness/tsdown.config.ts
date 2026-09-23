import { defineConfig } from 'tsdown'
import { globSync } from 'node:fs'
import { dirname } from 'node:path'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

function workspacePackages(client: boolean): string[] {
  const patterns = [
    'vendor/*/package.json',
    'packages/*/*/package.json',
    client ? 'apps/cli/package.json' : 'apps/{cli,desktop,desktop-host}/package.json',
  ]
  return patterns.flatMap(pattern => globSync(pattern, { cwd: import.meta.dirname })
    .map(manifest => dirname(manifest).replaceAll('\\', '/'))).sort()
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs Typert. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  return {
    // A deleted package may leave lib/ and node_modules/ behind locally. Only
    // manifest-bearing workspaces are eligible for the inherited entry glob.
    workspace: workspacePackages(client),
    // Some alpha.4 bundles intentionally have no invariant companion
    // (notably headless/base). Package-local configs build invariant entries
    // where they exist; the workspace aggregate must not require a missing
    // optional file on Windows.
    entry: client ? '' : ['lib/types/{index,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
